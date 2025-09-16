/**
 * Rogers Bank Upload Service
 * Handles downloading transactions from Rogers Bank and uploading to Monarch Money
 */

import { debugLog, formatDaysAgoLocal } from '../core/utils';
import toast from '../ui/toast';
import { STORAGE } from '../core/config';
import { getRogersBankCredentials } from '../api/rogersbank';
import monarchApi from '../api/monarch';
import { showMonarchAccountSelector } from '../ui/components/accountSelector';
import { convertTransactionsToMonarchCSV } from '../utils/csv';
import { showDatePickerPromise } from '../ui/components/datePicker';
import { applyCategoryMapping, saveUserCategorySelection } from '../mappers/category';
import { showMonarchCategorySelector } from '../ui/components/categorySelector';
import { showProgressDialog } from '../ui/components/progressDialog';

/**
 * Extract Rogers account name from DOM
 * @returns {string} The Rogers account name
 */
function getRogersAccountName() {
  const accountElement = document.querySelector('#mastercard-title');
  if (accountElement) {
    const spans = Array.from(accountElement.querySelectorAll('span'));
    const accountName = spans.map((span) => span.textContent.trim()).join(' ');
    debugLog('Rogers account name extracted:', accountName);
    return accountName;
  }
  debugLog('Could not extract account name, using default');
  return 'Rogers Mastercard';
}

/**
 * Get saved from date or prompt user for one
 * @returns {Promise<string|null>} The from date in YYYY-MM-DD format or null if cancelled
 */
async function getFromDate() {
  try {
    // Check for persisted nextSyncFromDate (7 days before last successful upload)
    const nextSyncFromDate = GM_getValue(STORAGE.ROGERSBANK_NEXT_SYNC_FROM_DATE, null);
    let defaultDateStr;

    if (nextSyncFromDate) {
      debugLog('Using persisted nextSyncFromDate as default:', nextSyncFromDate);
      defaultDateStr = nextSyncFromDate;
    } else {
      // Default to 14 days ago (two weeks) if no persisted date
      const defaultDate = new Date();
      defaultDate.setDate(defaultDate.getDate() - 14);
      [defaultDateStr] = defaultDate.toISOString().split('T');
      debugLog('No persisted nextSyncFromDate found, defaulting to 14 days ago:', defaultDateStr);
    }

    // Use date picker component with the calculated default
    const selectedDate = await showDatePickerPromise(
      defaultDateStr,
      'Select the start date for transaction download',
    );

    if (!selectedDate) {
      debugLog('User cancelled date input');
      return null;
    }

    return selectedDate;
  } catch (error) {
    debugLog('Error getting from date:', error);
    throw error;
  }
}

/**
 * Get the last day of the current month
 * @returns {string} Date in YYYY-MM-DD format
 */
function getEndOfCurrentMonth() {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return lastDay.toISOString().split('T')[0];
}

/**
 * Get stored reference numbers for de-duplication
 * @param {string} accountId - Rogers account ID
 * @returns {Set<string>} Set of uploaded reference numbers
 */
function getUploadedReferenceNumbers(accountId) {
  try {
    const storedRefs = GM_getValue(`${STORAGE.ROGERSBANK_UPLOADED_REFS_PREFIX}${accountId}`, []);
    return new Set(storedRefs);
  } catch (error) {
    debugLog('Error getting uploaded reference numbers:', error);
    return new Set();
  }
}

/**
 * Save reference numbers after successful upload
 * @param {string} accountId - Rogers account ID
 * @param {Array<string>} referenceNumbers - Array of reference numbers to save
 */
function saveUploadedReferenceNumbers(accountId, referenceNumbers) {
  try {
    const existingRefs = getUploadedReferenceNumbers(accountId);
    referenceNumbers.forEach((ref) => existingRefs.add(ref));

    // Convert Set to Array for storage (limit to last 1000 references to avoid storage bloat)
    const refsArray = Array.from(existingRefs);
    const limitedRefs = refsArray.slice(-1000);

    GM_setValue(`${STORAGE.ROGERSBANK_UPLOADED_REFS_PREFIX}${accountId}`, limitedRefs);
    debugLog(`Saved ${referenceNumbers.length} new reference numbers for account ${accountId}`);
  } catch (error) {
    debugLog('Error saving uploaded reference numbers:', error);
  }
}

/**
 * Save next sync from date (7 days before today) after successful upload
 * This date will be used as the default start date for the next upload
 */
function saveNextSyncFromDate() {
  try {
    // Calculate 7 days before today using existing utility function
    const nextSyncFromDate = formatDaysAgoLocal(7);

    // Save to storage
    GM_setValue(STORAGE.ROGERSBANK_NEXT_SYNC_FROM_DATE, nextSyncFromDate);
    debugLog('Saved nextSyncFromDate for future uploads:', nextSyncFromDate);
  } catch (error) {
    debugLog('Error saving nextSyncFromDate:', error);
  }
}

/**
 * Filter out already uploaded transactions
 * @param {Array} transactions - Array of transactions
 * @param {string} accountId - Rogers account ID
 * @returns {Object} Filtered transactions and statistics
 */
function filterDuplicateTransactions(transactions, accountId) {
  const uploadedRefs = getUploadedReferenceNumbers(accountId);
  const originalCount = transactions.length;

  const newTransactions = transactions.filter(
    (transaction) => !uploadedRefs.has(transaction.referenceNumber),
  );

  const duplicateCount = originalCount - newTransactions.length;

  if (duplicateCount > 0) {
    debugLog(`Filtered out ${duplicateCount} duplicate transactions`);
    toast.show(`Skipping ${duplicateCount} already uploaded transactions`, 'info');
  }

  return {
    transactions: newTransactions,
    duplicateCount,
    originalCount,
  };
}

/**
 * Resolve categories for transactions, handling both automatic mapping and manual selection
 * @param {Array} transactions - Array of transactions to process
 * @returns {Promise<Array>} Transactions with resolved Monarch categories
 */
async function resolveCategoriesForTransactions(transactions) {
  if (!transactions || transactions.length === 0) {
    return transactions;
  }

  debugLog('Starting category resolution for transactions');

  // Find all unique bank categories that need resolution
  const uniqueBankCategories = new Set();
  const categoriesToResolve = [];

  transactions.forEach((transaction) => {
    const bankCategory = transaction.merchant?.categoryDescription
      || transaction.merchant?.category
      || 'Uncategorized';

    if (!uniqueBankCategories.has(bankCategory)) {
      uniqueBankCategories.add(bankCategory);

      // Test the category mapping
      const mappingResult = applyCategoryMapping(bankCategory);

      if (mappingResult && typeof mappingResult === 'object' && mappingResult.needsManualSelection) {
        // This category needs manual selection
        categoriesToResolve.push(mappingResult);
      }
    }
  });

  debugLog(`Found ${uniqueBankCategories.size} unique bank categories, ${categoriesToResolve.length} need manual selection`);

  // Handle categories that need manual selection
  if (categoriesToResolve.length > 0) {
    toast.show(`Resolving ${categoriesToResolve.length} categories that need manual selection...`, 'info');

    for (let i = 0; i < categoriesToResolve.length; i += 1) {
      const categoryToResolve = categoriesToResolve[i];

      debugLog(`Showing category selector for: ${categoryToResolve.bankCategory} (${i + 1}/${categoriesToResolve.length})`);

      // Show progress in toast
      toast.show(`Selecting category ${i + 1} of ${categoriesToResolve.length}: "${categoryToResolve.bankCategory}"`, 'info');

      // Show the category selector and wait for user selection
      const selectedCategory = await new Promise((resolve) => {
        showMonarchCategorySelector(categoryToResolve.bankCategory, resolve);
      });

      if (!selectedCategory) {
        // User cancelled - this will abort the upload
        throw new Error(`Category selection cancelled for "${categoryToResolve.bankCategory}". Upload aborted.`);
      }

      // Save the user's selection for future use
      saveUserCategorySelection(categoryToResolve.bankCategory, selectedCategory.name);
      debugLog(`User selected category mapping: ${categoryToResolve.bankCategory} -> ${selectedCategory.name}`);

      toast.show(`Mapped "${categoryToResolve.bankCategory}" to "${selectedCategory.name}"`, 'success');
    }
  }

  // Now resolve all categories (they should all have mappings now)
  const resolvedTransactions = transactions.map((transaction) => {
    const bankCategory = transaction.merchant?.categoryDescription
      || transaction.merchant?.category
      || 'Uncategorized';

    const mappingResult = applyCategoryMapping(bankCategory);

    // At this point, all categories should resolve to strings (Monarch category names)
    const resolvedCategory = typeof mappingResult === 'string' ? mappingResult : 'Uncategorized';

    return {
      ...transaction,
      resolvedMonarchCategory: resolvedCategory,
      originalBankCategory: bankCategory,
    };
  });

  debugLog('Category resolution completed for all transactions');
  return resolvedTransactions;
}

/**
 * Fetch Rogers Bank transactions
 * @param {string} fromDate - Start date for transactions (YYYY-MM-DD)
 * @param {string} toDate - End date for transactions (YYYY-MM-DD)
 * @returns {Promise<Object>} API response with transactions
 */
async function fetchRogersBankTransactions(fromDate, toDate) {
  try {
    const credentials = getRogersBankCredentials(); // Get credentials for API calls

    // Check if we have all required credentials
    if (!credentials.authToken || !credentials.accountId || !credentials.customerId
        || !credentials.accountIdEncoded || !credentials.customerIdEncoded || !credentials.deviceId) {
      throw new Error('Missing Rogers Bank credentials. Please navigate to your account page first.');
    }

    // Start with offset of 10 (will fetch up to 500 transactions)
    let offset = 10;
    let allTransactions = [];
    let totalCount = 0;

    do {
      const url = `https://selfserve.apis.rogersbank.com/corebank/v1/account/${credentials.accountId}/customer/${credentials.customerId}/transactions?limit=0&offset=${offset}&fromDate=${fromDate}&toDate=${toDate}`;

      debugLog('Fetching transactions with offset:', offset);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          accept: 'application/json, text/plain, */*',
          accountid: credentials.accountIdEncoded,
          authorization: credentials.authToken,
          channel: '101',
          customerid: credentials.customerIdEncoded,
          deviceid: credentials.deviceId,
          isrefresh: 'false',
        },
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      if (!data.activitySummary) {
        throw new Error('Invalid API response: missing activitySummary');
      }

      totalCount = data.activitySummary.totalCount || 0;
      const currentBatchSize = data.activitySummary.activities?.length || 0;

      debugLog(`Fetched ${currentBatchSize} transactions. Total available: ${totalCount}`);

      if (data.activitySummary.activities && data.activitySummary.activities.length > 0) {
        allTransactions = allTransactions.concat(data.activitySummary.activities);
      }

      // Check if we need to fetch more
      if (allTransactions.length < totalCount) {
        // Increment offset for next batch
        offset += 10;
        debugLog(`Need to fetch more transactions. Current: ${allTransactions.length}, Total: ${totalCount}`);
      } else {
        break;
      }
    } while (allTransactions.length < totalCount && offset <= 100); // Safety limit

    debugLog(`Fetched total of ${allTransactions.length} transactions`);

    return {
      success: true,
      transactions: allTransactions,
      totalCount,
      fromDate,
      toDate,
    };
  } catch (error) {
    debugLog('Error fetching Rogers Bank transactions:', error);
    throw error;
  }
}

/**
 * Upload Rogers Bank transactions to Monarch Money
 * @returns {Promise<Object>} Upload result
 */
export async function uploadRogersBankToMonarch() {
  let progressDialog = null;
  const abortController = new AbortController();
  let rogersAccountId = null; // Declare at function level for catch block access

  try {
    debugLog('Rogers Bank upload service started');

    // Get date range
    const fromDate = await getFromDate();
    if (!fromDate) {
      return {
        success: false,
        message: 'Date selection cancelled',
      };
    }

    const toDate = getEndOfCurrentMonth();
    debugLog(`Date range: ${fromDate} to ${toDate}`);

    // Extract Rogers account name and create progress dialog
    const rogersAccountName = getRogersAccountName();
    rogersAccountId = `rogers_${rogersAccountName.replace(/\s+/g, '_').toLowerCase()}`;

    // Create progress dialog for Rogers Bank account
    const accountForDialog = {
      key: rogersAccountId,
      nickname: rogersAccountName,
      name: 'Rogers Bank Transaction Upload',
    };

    progressDialog = showProgressDialog(
      [accountForDialog],
      'Uploading Rogers Bank Transactions to Monarch Money',
    );

    // Set up cancellation callback
    progressDialog.onCancel(() => {
      debugLog('Upload cancellation requested by user');
      abortController.abort();
    });

    // Update progress - fetching transactions
    progressDialog.updateProgress(rogersAccountId, 'processing', `Fetching transactions from ${fromDate} to ${toDate}...`);

    // Check for cancellation before fetching
    if (abortController.signal.aborted) {
      progressDialog?.updateProgress(rogersAccountId, 'error', 'Upload cancelled');
      progressDialog?.hideCancel();
      return { success: false, message: 'Upload cancelled by user' };
    }

    // Fetch transactions
    const result = await fetchRogersBankTransactions(fromDate, toDate);

    // Check for cancellation after fetching
    if (abortController.signal.aborted) {
      progressDialog?.updateProgress(rogersAccountId, 'error', 'Upload cancelled');
      progressDialog?.hideCancel();
      return { success: false, message: 'Upload cancelled by user' };
    }

    if (result.success && result.transactions.length > 0) {
      // Log first 3 transactions for testing
      debugLog('First 3 transactions:', result.transactions.slice(0, 3));
      console.log('Rogers Bank - First 3 Transactions:', result.transactions.slice(0, 3));

      // Update progress - filtering transactions
      progressDialog.updateProgress(rogersAccountId, 'processing', `Processing ${result.transactions.length} transactions...`);

      // Filter only approved transactions
      const approvedTransactions = result.transactions.filter(
        (transaction) => transaction.activityStatus === 'APPROVED',
      );

      debugLog(`Filtered ${approvedTransactions.length} approved transactions from ${result.transactions.length} total`);

      if (approvedTransactions.length === 0) {
        progressDialog.updateProgress(rogersAccountId, 'success', 'No approved transactions found to upload');
        progressDialog.hideCancel();
        progressDialog.showSummary({ success: 0, failed: 0, total: 1 });
        toast.show('No approved transactions found to upload', 'info');
        return {
          success: true,
          message: 'No approved transactions found',
          data: { ...result, transactions: approvedTransactions },
        };
      }

      // Filter out duplicate transactions
      progressDialog.updateProgress(rogersAccountId, 'processing', `Checking for duplicate transactions among ${approvedTransactions.length} approved transactions...`);
      const filterResult = filterDuplicateTransactions(approvedTransactions, rogersAccountId);
      const transactionsToUpload = filterResult.transactions;

      if (transactionsToUpload.length === 0) {
        const message = filterResult.duplicateCount > 0
          ? `All ${filterResult.duplicateCount} transactions have already been uploaded`
          : 'No new transactions to upload';
        progressDialog.updateProgress(rogersAccountId, 'success', message);
        progressDialog.hideCancel();
        progressDialog.showSummary({ success: 0, failed: 0, total: 1 });
        toast.show(message, 'info');
        return {
          success: true,
          message,
          data: {
            ...result,
            transactions: transactionsToUpload,
            skippedDuplicates: filterResult.duplicateCount,
          },
        };
      }

      // Show info about duplicates if any
      if (filterResult.duplicateCount > 0) {
        debugLog(`Processing ${transactionsToUpload.length} new transactions (skipped ${filterResult.duplicateCount} duplicates)`);
        progressDialog.updateProgress(rogersAccountId, 'processing', `Found ${transactionsToUpload.length} new transactions (${filterResult.duplicateCount} duplicates skipped)`);
      } else {
        progressDialog.updateProgress(rogersAccountId, 'processing', `Found ${transactionsToUpload.length} new transactions to upload`);
      }

      // Check for existing Monarch account mapping
      let monarchAccount = null;
      const savedMapping = GM_getValue(`${STORAGE.ROGERSBANK_ACCOUNT_MAPPING_PREFIX}${rogersAccountId}`, null);

      if (savedMapping) {
        try {
          monarchAccount = JSON.parse(savedMapping);
          debugLog('Using existing Monarch account mapping:', monarchAccount);
        } catch (e) {
          debugLog('Error parsing saved mapping, will prompt for new one:', e);
        }
      }

      // Check for cancellation before account mapping
      if (abortController.signal.aborted) {
        progressDialog?.updateProgress(rogersAccountId, 'error', 'Upload cancelled');
        progressDialog?.hideCancel();
        return { success: false, message: 'Upload cancelled by user' };
      }

      // If no mapping exists, show the account selector
      if (!monarchAccount) {
        progressDialog.updateProgress(rogersAccountId, 'processing', 'Getting Monarch account mapping...');
        debugLog('No Monarch account mapping found, showing account selector');

        // Fetch Monarch credit card accounts (for Rogers Bank)
        const monarchAccounts = await monarchApi.listAccounts('credit');
        if (!monarchAccounts || monarchAccounts.length === 0) {
          throw new Error('No Monarch credit card accounts found. Please ensure you have credit card accounts in Monarch.');
        }

        // Show account selector and wait for user selection (pass 'credit' as account type)
        monarchAccount = await new Promise((resolve) => {
          showMonarchAccountSelector(monarchAccounts, resolve, null, 'credit');
        });

        if (!monarchAccount) {
          // User cancelled selection
          progressDialog.updateProgress(rogersAccountId, 'error', 'Account mapping cancelled by user');
          progressDialog.hideCancel();
          progressDialog.showSummary({ success: 0, failed: 1, total: 1 });
          toast.show('Account selection cancelled', 'info');
          return {
            success: false,
            message: 'Account selection cancelled by user',
          };
        }

        // Save the mapping for future use
        GM_setValue(
          `${STORAGE.ROGERSBANK_ACCOUNT_MAPPING_PREFIX}${rogersAccountId}`,
          JSON.stringify(monarchAccount),
        );
        debugLog(`Saved account mapping: ${rogersAccountName} -> ${monarchAccount.displayName}`);
        progressDialog.updateProgress(rogersAccountId, 'processing', `Mapped to Monarch account: ${monarchAccount.displayName}`);
      } else {
        progressDialog.updateProgress(rogersAccountId, 'processing', `Using existing Monarch account mapping: ${monarchAccount.displayName}`);
      }

      // Check for cancellation before category resolution
      if (abortController.signal.aborted) {
        progressDialog?.updateProgress(rogersAccountId, 'error', 'Upload cancelled');
        progressDialog?.hideCancel();
        return { success: false, message: 'Upload cancelled by user' };
      }

      // Resolve categories for all transactions (handle automatic mapping and manual selection)
      progressDialog.updateProgress(rogersAccountId, 'processing', 'Resolving transaction categories...');
      const transactionsWithResolvedCategories = await resolveCategoriesForTransactions(transactionsToUpload);

      // Check for cancellation after category resolution
      if (abortController.signal.aborted) {
        progressDialog?.updateProgress(rogersAccountId, 'error', 'Upload cancelled');
        progressDialog?.hideCancel();
        return { success: false, message: 'Upload cancelled by user' };
      }

      // Convert transactions to Monarch CSV format (use transactions with resolved categories)
      progressDialog.updateProgress(rogersAccountId, 'processing', `Converting ${transactionsToUpload.length} transactions to CSV format...`);
      const csvData = convertTransactionsToMonarchCSV(transactionsWithResolvedCategories, rogersAccountName);

      if (!csvData) {
        throw new Error('Failed to convert transactions to CSV');
      }

      // Check for cancellation before upload
      if (abortController.signal.aborted) {
        progressDialog?.updateProgress(rogersAccountId, 'error', 'Upload cancelled');
        progressDialog?.hideCancel();
        return { success: false, message: 'Upload cancelled by user' };
      }

      // Upload to Monarch with balance update enabled
      const uploadMessage = filterResult.duplicateCount > 0
        ? `Uploading ${transactionsToUpload.length} new transactions to Monarch (${filterResult.duplicateCount} duplicates skipped)...`
        : `Uploading ${transactionsToUpload.length} transactions to Monarch...`;
      progressDialog.updateProgress(rogersAccountId, 'processing', uploadMessage);

      const filename = `rogers_transactions_${fromDate}_to_${toDate}.csv`;
      const uploadSuccess = await monarchApi.uploadTransactions(
        monarchAccount.id,
        csvData,
        filename,
        true, // shouldUpdateBalance = true
        false, // skipCheckForDuplicates = false
      );

      if (uploadSuccess) {
        // Save reference numbers for successful uploads
        const referenceNumbers = transactionsToUpload
          .map((transaction) => transaction.referenceNumber)
          .filter((ref) => ref); // Filter out any null/undefined references

        if (referenceNumbers.length > 0) {
          saveUploadedReferenceNumbers(rogersAccountId, referenceNumbers);
        }

        // Save nextSyncFromDate (7 days before today) for future uploads
        saveNextSyncFromDate();

        const successMessage = filterResult.duplicateCount > 0
          ? `Successfully uploaded ${transactionsToUpload.length} new transactions (${filterResult.duplicateCount} duplicates skipped)`
          : `Successfully uploaded ${transactionsToUpload.length} transactions`;

        progressDialog.updateProgress(rogersAccountId, 'success', successMessage);
        progressDialog.hideCancel();
        progressDialog.showSummary({ success: 1, failed: 0, total: 1 });

        // Also show toast for user confirmation
        toast.show(`${successMessage} to Monarch!`, 'success');

        return {
          success: true,
          message: `${successMessage} to Monarch!`,
          data: {
            ...result,
            transactions: transactionsToUpload,
            skippedDuplicates: filterResult.duplicateCount,
            monarchAccountId: monarchAccount.id,
            monarchAccountName: monarchAccount.displayName,
          },
        };
      }
      throw new Error('Upload to Monarch failed');
    }

    if (result.transactions.length === 0) {
      progressDialog.updateProgress(rogersAccountId, 'success', 'No transactions found in the specified date range');
      progressDialog.hideCancel();
      progressDialog.showSummary({ success: 0, failed: 0, total: 1 });
      toast.show('No transactions found in the specified date range', 'info');
      return {
        success: true,
        message: 'No transactions found',
        data: result,
      };
    }

    // Fallback return for any edge case
    progressDialog?.updateProgress(rogersAccountId, 'error', 'Unexpected error occurred');
    progressDialog?.hideCancel();
    progressDialog?.showSummary({ success: 0, failed: 1, total: 1 });
    return {
      success: false,
      message: 'Unexpected error occurred',
    };
  } catch (error) {
    debugLog('Error in Rogers Bank upload service:', error);

    // Update progress dialog with error if it exists
    if (progressDialog && rogersAccountId) {
      progressDialog.updateProgress(rogersAccountId, 'error', `Upload failed: ${error.message}`);
      progressDialog.hideCancel();
      progressDialog.showSummary({ success: 0, failed: 1, total: 1 });
    }

    // Also show error toast for user confirmation
    toast.show(`Error: ${error.message}`, 'error');
    return {
      success: false,
      message: error.message,
      error,
    };
  }
}

export default {
  uploadRogersBankToMonarch,
  fetchRogersBankTransactions,
  getFromDate,
  getEndOfCurrentMonth,
};
