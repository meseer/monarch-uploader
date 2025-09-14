/**
 * Rogers Bank Upload Service
 * Handles downloading transactions from Rogers Bank and uploading to Monarch Money
 */

import { debugLog } from '../core/utils';
import toast from '../ui/toast';
import { STORAGE } from '../core/config';
import { getRogersBankCredentials } from '../api/rogersbank';
import monarchApi from '../api/monarch';
import { showMonarchAccountSelector } from '../ui/components/accountSelector';
import { convertTransactionsToMonarchCSV } from '../utils/csv';
import { showDatePickerPromise } from '../ui/components/datePicker';

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
    // Check for saved date - commented out per requirements
    // const savedDate = GM_getValue(STORAGE.ROGERSBANK_FROM_DATE, null);
    // if (savedDate) {
    //   debugLog('Using saved from date:', savedDate);
    //   return savedDate;
    // }

    // Default to 14 days ago (two weeks)
    const defaultDate = new Date();
    defaultDate.setDate(defaultDate.getDate() - 14);
    const defaultDateStr = defaultDate.toISOString().split('T')[0];

    // Use date picker component
    const selectedDate = await showDatePickerPromise(
      defaultDateStr,
      'Select the start date for transaction download',
    );

    if (!selectedDate) {
      debugLog('User cancelled date input');
      return null;
    }

    // Save the date for future use - commented out per requirements
    // GM_setValue(STORAGE.ROGERSBANK_FROM_DATE, selectedDate);
    // debugLog('Saved new from date:', selectedDate);

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
 * Fetch Rogers Bank transactions
 * @param {string} fromDate - Start date for transactions (YYYY-MM-DD)
 * @param {string} toDate - End date for transactions (YYYY-MM-DD)
 * @returns {Promise<Object>} API response with transactions
 */
async function fetchRogersBankTransactions(fromDate, toDate) {
  try {
    const credentials = getRogersBankCredentials();

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

    // Show progress
    toast.show(`Fetching transactions from ${fromDate} to ${toDate}...`, 'info');

    // Fetch transactions
    const result = await fetchRogersBankTransactions(fromDate, toDate);

    if (result.success && result.transactions.length > 0) {
      // Log first 3 transactions for testing
      debugLog('First 3 transactions:', result.transactions.slice(0, 3));
      console.log('Rogers Bank - First 3 Transactions:', result.transactions.slice(0, 3));

      // Filter only approved transactions
      const approvedTransactions = result.transactions.filter(
        (transaction) => transaction.activityStatus === 'APPROVED',
      );

      debugLog(`Filtered ${approvedTransactions.length} approved transactions from ${result.transactions.length} total`);

      if (approvedTransactions.length === 0) {
        toast.show('No approved transactions found to upload', 'info');
        return {
          success: true,
          message: 'No approved transactions found',
          data: { ...result, transactions: approvedTransactions },
        };
      }

      // Extract Rogers account name from DOM
      const rogersAccountName = getRogersAccountName();

      // Create a unique ID for this Rogers account
      const rogersAccountId = `rogers_${rogersAccountName.replace(/\s+/g, '_').toLowerCase()}`;

      // Filter out duplicate transactions
      const filterResult = filterDuplicateTransactions(approvedTransactions, rogersAccountId);
      const transactionsToUpload = filterResult.transactions;

      if (transactionsToUpload.length === 0) {
        const message = filterResult.duplicateCount > 0
          ? `All ${filterResult.duplicateCount} transactions have already been uploaded`
          : 'No new transactions to upload';
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

      // If no mapping exists, show the account selector
      if (!monarchAccount) {
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
        toast.show(`Mapped ${rogersAccountName} to ${monarchAccount.displayName}`, 'success');
      }

      // Convert transactions to Monarch CSV format (use filtered transactions)
      toast.show('Converting transactions to CSV format...', 'info');
      const csvData = convertTransactionsToMonarchCSV(transactionsToUpload, rogersAccountName);

      if (!csvData) {
        throw new Error('Failed to convert transactions to CSV');
      }

      // Upload to Monarch with balance update enabled
      const uploadMessage = filterResult.duplicateCount > 0
        ? `Uploading ${transactionsToUpload.length} new transactions to Monarch (${filterResult.duplicateCount} duplicates skipped)...`
        : `Uploading ${transactionsToUpload.length} transactions to Monarch...`;
      toast.show(uploadMessage, 'info');

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

        const successMessage = filterResult.duplicateCount > 0
          ? `Successfully uploaded ${transactionsToUpload.length} new transactions to Monarch! (${filterResult.duplicateCount} duplicates skipped)`
          : `Successfully uploaded ${transactionsToUpload.length} transactions to Monarch!`;
        toast.show(successMessage, 'success');

        // Note: Not saving fromDate per requirements
        // Future enhancement: Save the last successful upload date

        return {
          success: true,
          message: successMessage,
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
      toast.show('No transactions found in the specified date range', 'info');
      return {
        success: true,
        message: 'No transactions found',
        data: result,
      };
    }

    // Fallback return for any edge case
    return {
      success: false,
      message: 'Unexpected error occurred',
    };
  } catch (error) {
    debugLog('Error in Rogers Bank upload service:', error);
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
