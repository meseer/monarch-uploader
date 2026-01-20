/**
 * Rogers Bank Upload Service
 * Handles downloading transactions from Rogers Bank and uploading to Monarch Money
 */

import {
  debugLog, getTodayLocal, calculateFromDateWithLookback, saveLastUploadDate, formatDate, parseLocalDate,
} from '../core/utils';
import toast from '../ui/toast';
import { STORAGE, LOGO_CLOUDINARY_IDS } from '../core/config';
import stateManager from '../core/state';
import { getRogersBankCredentials, fetchRogersBankAccountDetails } from '../api/rogersbank';
import monarchApi from '../api/monarch';
import { showMonarchAccountSelectorWithCreate } from '../ui/components/accountSelectorWithCreate';
import { convertTransactionsToMonarchCSV } from '../utils/csv';
import { showDatePickerWithOptionsPromise } from '../ui/components/datePicker';
import { applyCategoryMapping, saveUserCategorySelection, calculateAllCategorySimilarities } from '../mappers/category';
import { showMonarchCategorySelector } from '../ui/components/categorySelector';
import { showProgressDialog } from '../ui/components/progressDialog';
import { getUploadedTransactionIds, saveUploadedTransactions } from '../utils/transactionStorage';

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
 * Check if this is the first sync for the account (no previous upload date)
 * @param {string} rogersAccountId - Rogers account ID
 * @returns {boolean} True if first sync
 */
function isFirstSync(rogersAccountId) {
  const lastUploadDate = GM_getValue(`${STORAGE.ROGERSBANK_LAST_UPLOAD_DATE_PREFIX}${rogersAccountId}`, null);
  return !lastUploadDate;
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
 * Filter out already uploaded transactions
 * @param {Array} transactions - Array of transactions
 * @param {string} accountId - Rogers account ID
 * @returns {Object} Filtered transactions and statistics
 */
function filterDuplicateTransactions(transactions, accountId) {
  const uploadedIds = getUploadedTransactionIds(accountId, 'rogersbank');
  const uploadedRefs = new Set(uploadedIds);
  const originalCount = transactions.length;

  const newTransactions = transactions.filter(
    (transaction) => !uploadedRefs.has(transaction.referenceNumber),
  );

  const duplicateCount = originalCount - newTransactions.length;

  if (duplicateCount > 0) {
    debugLog(`Filtered out ${duplicateCount} duplicate transactions`);
    toast.show(`Skipping ${duplicateCount} already uploaded transactions`, 'debug');
  }

  return { transactions: newTransactions, duplicateCount, originalCount };
}

/**
 * Resolve categories for transactions
 * @param {Array} transactions - Array of transactions to process
 * @returns {Promise<Array>} Transactions with resolved Monarch categories
 */
async function resolveCategoriesForTransactions(transactions) {
  if (!transactions || transactions.length === 0) {
    return transactions;
  }

  debugLog('Starting category resolution for transactions');

  let availableCategories = [];
  try {
    const categoryData = await monarchApi.getCategoriesAndGroups();
    availableCategories = categoryData.categories || [];
  } catch (error) {
    debugLog('Failed to fetch categories from Monarch:', error);
  }

  const uniqueBankCategories = new Map();
  const categoriesToResolve = [];

  transactions.forEach((transaction) => {
    const bankCategory = transaction.merchant?.categoryDescription
      || transaction.merchant?.category
      || 'Uncategorized';

    if (!uniqueBankCategories.has(bankCategory)) {
      uniqueBankCategories.set(bankCategory, transaction);
      const mappingResult = applyCategoryMapping(bankCategory, availableCategories);

      if (mappingResult && typeof mappingResult === 'object' && mappingResult.needsManualSelection) {
        categoriesToResolve.push({ ...mappingResult, exampleTransaction: transaction });
      }
    }
  });

  if (categoriesToResolve.length > 0) {
    toast.show(`Resolving ${categoriesToResolve.length} categories...`, 'debug');

    for (let i = 0; i < categoriesToResolve.length; i += 1) {
      const categoryToResolve = categoriesToResolve[i];
      const similarityData = calculateAllCategorySimilarities(categoryToResolve.bankCategory, availableCategories);

      const transactionDetails = {};
      if (categoryToResolve.exampleTransaction) {
        const exampleTx = categoryToResolve.exampleTransaction;
        transactionDetails.merchant = exampleTx.description || exampleTx.merchant?.name || 'Unknown';
        transactionDetails.amount = exampleTx.transactionAmount || exampleTx.amount || 0;
        if (exampleTx.activityDate) {
          transactionDetails.date = new Date(exampleTx.activityDate).toLocaleDateString('en-US', {
            year: 'numeric', month: 'short', day: 'numeric',
          });
        }
      }

      const selectedCategory = await new Promise((resolve) => {
        showMonarchCategorySelector(categoryToResolve.bankCategory, resolve, similarityData, transactionDetails);
      });

      if (!selectedCategory) {
        throw new Error(`Category selection cancelled for "${categoryToResolve.bankCategory}".`);
      }

      saveUserCategorySelection(categoryToResolve.bankCategory, selectedCategory.name);
    }
  }

  return transactions.map((transaction) => {
    const bankCategory = transaction.merchant?.categoryDescription
      || transaction.merchant?.category
      || 'Uncategorized';
    const mappingResult = applyCategoryMapping(bankCategory, availableCategories);
    const resolvedCategory = typeof mappingResult === 'string' ? mappingResult : 'Uncategorized';

    return { ...transaction, resolvedMonarchCategory: resolvedCategory, originalBankCategory: bankCategory };
  });
}

/**
 * Fetch Rogers Bank transactions
 * @param {string} fromDate - Start date (YYYY-MM-DD)
 * @param {string} toDate - End date (YYYY-MM-DD)
 * @returns {Promise<Object>} API response with transactions
 */
async function fetchRogersBankTransactions(fromDate, toDate) {
  const credentials = getRogersBankCredentials();

  if (!credentials.authToken || !credentials.accountId || !credentials.customerId
      || !credentials.accountIdEncoded || !credentials.customerIdEncoded || !credentials.deviceId) {
    throw new Error('Missing Rogers Bank credentials.');
  }

  let offset = 10;
  let allTransactions = [];
  let totalCount = 0;

  do {
    const url = `https://selfserve.apis.rogersbank.com/corebank/v1/account/${credentials.accountId}/customer/${credentials.customerId}/transactions?limit=0&offset=${offset}&fromDate=${fromDate}&toDate=${toDate}`;

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
      throw new Error(`API request failed: ${response.status}`);
    }

    const data = await response.json();
    if (!data.activitySummary) throw new Error('Invalid API response');

    totalCount = data.activitySummary.totalCount || 0;
    if (data.activitySummary.activities?.length > 0) {
      allTransactions = allTransactions.concat(data.activitySummary.activities);
    }

    if (allTransactions.length < totalCount) {
      offset += 10;
    } else {
      break;
    }
  } while (allTransactions.length < totalCount && offset <= 100);

  return { success: true, transactions: allTransactions, totalCount, fromDate, toDate };
}

/**
 * Build sync steps for progress dialog
 */
function buildRogersBankSteps(hasTransactions = true, includeCreditLimit = true) {
  const steps = [];
  if (includeCreditLimit) steps.push({ key: 'creditLimit', name: 'Credit limit sync' });
  steps.push({ key: 'balance', name: 'Balance upload' });
  if (hasTransactions) steps.push({ key: 'transactions', name: 'Transaction sync' });
  return steps;
}

/**
 * Reconstruct balance history from transactions starting with 0 balance
 */
function reconstructBalanceFromTransactions(transactions, fromDate, toDate, currentBalance) {
  const transactionsByDate = new Map();
  if (transactions?.length > 0) {
    transactions.forEach((tx) => {
      const dateStr = tx.activityDate?.substring(0, 10);
      if (!dateStr) return;
      const amount = tx.transactionAmount || tx.amount || 0;
      if (!transactionsByDate.has(dateStr)) transactionsByDate.set(dateStr, []);
      transactionsByDate.get(dateStr).push(amount);
    });
  }

  const balanceHistory = [];
  let runningBalance = 0;
  const fromDateObj = parseLocalDate(fromDate);
  const toDateObj = parseLocalDate(toDate);
  const todayStr = getTodayLocal();
  const currentDateObj = new Date(fromDateObj);

  while (currentDateObj <= toDateObj) {
    const dateStr = formatDate(currentDateObj);
    const dayTransactions = transactionsByDate.get(dateStr) || [];
    const dayTotal = dayTransactions.reduce((sum, amt) => sum + amt, 0);
    runningBalance += dayTotal;

    if (dateStr === todayStr && currentBalance !== null && currentBalance !== undefined) {
      balanceHistory.push({ date: dateStr, amount: currentBalance });
    } else {
      balanceHistory.push({ date: dateStr, amount: Math.round(runningBalance * 100) / 100 });
    }
    currentDateObj.setDate(currentDateObj.getDate() + 1);
  }

  return balanceHistory;
}

/**
 * Generate CSV for balance history
 */
function generateBalanceHistoryCSV(balanceHistory, accountName) {
  let csvContent = '"Date","Total Equity","Account Name"\n';
  balanceHistory.forEach((entry) => {
    csvContent += `"${entry.date}","${entry.amount}","${accountName}"\n`;
  });
  return csvContent;
}

/**
 * Generate CSV for single-day balance
 */
function generateBalanceCSV(balance, accountName) {
  const todayFormatted = getTodayLocal();
  let csvContent = '"Date","Total Equity","Account Name"\n';
  csvContent += `"${todayFormatted}","${balance}","${accountName}"\n`;
  return csvContent;
}

/**
 * Sync credit limit from Rogers Bank to Monarch
 */
async function syncCreditLimit(rogersAccountId, monarchAccountId, creditLimit) {
  if (creditLimit === null || creditLimit === undefined) return true;

  const storedCreditLimit = GM_getValue(`${STORAGE.ROGERSBANK_LAST_CREDIT_LIMIT_PREFIX}${rogersAccountId}`, null);
  if (storedCreditLimit !== null && storedCreditLimit === creditLimit) return true;

  try {
    await monarchApi.setCreditLimit(monarchAccountId, creditLimit);
    GM_setValue(`${STORAGE.ROGERSBANK_LAST_CREDIT_LIMIT_PREFIX}${rogersAccountId}`, creditLimit);
    return true;
  } catch (error) {
    debugLog('Error syncing credit limit:', error);
    return false;
  }
}

/**
 * Get or store balance checkpoint
 */
function getOrStoreBalanceCheckpoint(accountId, checkpoint = null) {
  const storageKey = `${STORAGE.ROGERSBANK_BALANCE_CHECKPOINT_PREFIX}${accountId}`;
  if (checkpoint) {
    GM_setValue(storageKey, JSON.stringify(checkpoint));
    return checkpoint;
  }
  const stored = GM_getValue(storageKey, null);
  if (stored) {
    try { return JSON.parse(stored); } catch (e) { return null; }
  }
  return null;
}

/**
 * Upload Rogers Bank transactions to Monarch Money
 * @returns {Promise<Object>} Upload result
 */
export async function uploadRogersBankToMonarch() {
  let progressDialog = null;
  const abortController = new AbortController();
  let rogersAccountId = null;

  try {
    debugLog('Rogers Bank upload service started');

    const credentials = getRogersBankCredentials();
    const rogersAccountName = getRogersAccountName();

    if (credentials.accountId) {
      rogersAccountId = credentials.accountId;
    } else {
      rogersAccountId = `rogers_${rogersAccountName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()}`;
    }

    // Fetch account details (balance, credit limit, openedDate) in ONE API call
    let accountDetails;
    try {
      accountDetails = await fetchRogersBankAccountDetails();
    } catch (error) {
      toast.show('Failed to fetch account details from Rogers Bank', 'error');
      return { success: false, message: error.message };
    }

    const { balance: currentBalance, creditLimit, openedDate } = accountDetails;
    const firstSync = isFirstSync(rogersAccountId);

    debugLog(`First sync: ${firstSync}, Balance: ${currentBalance}, Credit limit: ${creditLimit}, Opened: ${openedDate}`);

    // Determine fromDate and reconstruction
    let fromDate;
    let reconstructBalance = false;

    if (firstSync) {
      const defaultDate = openedDate || (() => {
        const d = new Date();
        d.setDate(d.getDate() - 14);
        return d.toISOString().split('T')[0];
      })();

      const datePickerResult = await showDatePickerWithOptionsPromise(
        defaultDate,
        `Select the start date for syncing "${rogersAccountName}". Default is the account creation date.`,
        { showReconstructCheckbox: true, reconstructCheckedByDefault: true },
      );

      if (!datePickerResult) {
        toast.show('Sync cancelled', 'info');
        return { success: false, message: 'Date selection cancelled' };
      }

      fromDate = datePickerResult.date;
      reconstructBalance = datePickerResult.reconstructBalance;
    } else {
      fromDate = calculateFromDateWithLookback('rogersbank', rogersAccountId) || (() => {
        const d = new Date();
        d.setDate(d.getDate() - 14);
        return d.toISOString().split('T')[0];
      })();
    }

    const toDate = getEndOfCurrentMonth();
    stateManager.setAccount(rogersAccountId, rogersAccountName);

    // Create progress dialog
    progressDialog = showProgressDialog(
      [{ key: rogersAccountId, nickname: rogersAccountName, name: 'Rogers Bank Upload' }],
      'Uploading Rogers Bank Data to Monarch Money',
    );
    progressDialog.initSteps(rogersAccountId, buildRogersBankSteps(true, true));
    progressDialog.onCancel(() => abortController.abort());

    // Resolve Monarch account mapping
    let monarchAccount = null;
    const savedMapping = GM_getValue(`${STORAGE.ROGERSBANK_ACCOUNT_MAPPING_PREFIX}${rogersAccountId}`, null);

    if (savedMapping) {
      try { monarchAccount = JSON.parse(savedMapping); } catch (e) { /* ignore */ }
    }

    if (!monarchAccount) {
      progressDialog.updateProgress(rogersAccountId, 'processing', 'Getting Monarch account mapping...');

      const monarchAccounts = await monarchApi.listAccounts('credit');
      if (!monarchAccounts?.length) throw new Error('No Monarch credit card accounts found.');

      monarchAccount = await new Promise((resolve) => {
        showMonarchAccountSelectorWithCreate(monarchAccounts, resolve, null, 'credit', {
          defaultName: rogersAccountName,
          defaultType: 'credit',
          defaultSubtype: 'credit_card',
          defaultBalance: currentBalance,
          currentBalance: { amount: currentBalance, currency: 'CAD' },
          accountType: 'Credit Card',
        });
      });

      if (!monarchAccount) {
        progressDialog.updateProgress(rogersAccountId, 'error', 'Cancelled');
        progressDialog.hideCancel();
        progressDialog.showSummary({ success: 0, failed: 1, total: 1 });
        return { success: false, message: 'Account selection cancelled' };
      }

      if (monarchAccount.newlyCreated) {
        try {
          await monarchApi.setAccountLogo(monarchAccount.id, LOGO_CLOUDINARY_IDS.ROGERS);
        } catch (e) { /* ignore */ }
      }

      GM_setValue(`${STORAGE.ROGERSBANK_ACCOUNT_MAPPING_PREFIX}${rogersAccountId}`, JSON.stringify(monarchAccount));
    }

    // STEP 1: Sync credit limit
    progressDialog.updateStepStatus(rogersAccountId, 'creditLimit', 'processing', 'Syncing...');
    const creditLimitSuccess = await syncCreditLimit(rogersAccountId, monarchAccount.id, creditLimit);
    if (creditLimitSuccess && creditLimit) {
      progressDialog.updateStepStatus(rogersAccountId, 'creditLimit', 'success', `$${creditLimit.toLocaleString()}`);
    } else if (creditLimit === null || creditLimit === undefined) {
      progressDialog.updateStepStatus(rogersAccountId, 'creditLimit', 'skipped', 'Not available');
    } else {
      progressDialog.updateStepStatus(rogersAccountId, 'creditLimit', 'error', 'Sync failed');
    }

    // STEP 2: Upload balance
    progressDialog.updateStepStatus(rogersAccountId, 'balance', 'processing', 'Preparing...');
    let balanceUploadSuccess = false;
    const todayFormatted = getTodayLocal();

    if (firstSync && reconstructBalance) {
      progressDialog.updateStepStatus(rogersAccountId, 'balance', 'processing', 'Fetching transactions...');
      const txResult = await fetchRogersBankTransactions(fromDate, toDate);
      const approvedTx = (txResult.transactions || []).filter((tx) => tx.activityStatus === 'APPROVED');

      progressDialog.updateStepStatus(rogersAccountId, 'balance', 'processing', 'Reconstructing...');
      const balanceHistory = reconstructBalanceFromTransactions(approvedTx, fromDate, todayFormatted, currentBalance);

      if (balanceHistory.length > 0) {
        const balanceCSV = generateBalanceHistoryCSV(balanceHistory, rogersAccountName);
        progressDialog.updateStepStatus(rogersAccountId, 'balance', 'processing', 'Uploading...');
        balanceUploadSuccess = await monarchApi.uploadBalance(monarchAccount.id, balanceCSV, fromDate, todayFormatted);

        if (balanceUploadSuccess) {
          getOrStoreBalanceCheckpoint(rogersAccountId, { date: todayFormatted, amount: currentBalance });
          progressDialog.updateStepStatus(rogersAccountId, 'balance', 'success', `${balanceHistory.length} days`);
          progressDialog.updateBalanceChange(rogersAccountId, { newBalance: currentBalance });
        } else {
          progressDialog.updateStepStatus(rogersAccountId, 'balance', 'error', 'Upload failed');
        }
      } else {
        progressDialog.updateStepStatus(rogersAccountId, 'balance', 'error', 'No data');
      }
    } else {
      const balanceCSV = generateBalanceCSV(currentBalance, rogersAccountName);
      balanceUploadSuccess = await monarchApi.uploadBalance(monarchAccount.id, balanceCSV, todayFormatted, todayFormatted);

      if (balanceUploadSuccess) {
        const formatted = `$${Math.abs(currentBalance).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
        progressDialog.updateStepStatus(rogersAccountId, 'balance', 'success', formatted);
        progressDialog.updateBalanceChange(rogersAccountId, { newBalance: currentBalance });
      } else {
        progressDialog.updateStepStatus(rogersAccountId, 'balance', 'error', 'Upload failed');
      }
    }

    // STEP 3: Upload transactions
    if (abortController.signal.aborted) {
      progressDialog.updateProgress(rogersAccountId, 'error', 'Cancelled');
      progressDialog.hideCancel();
      return { success: false, message: 'Cancelled' };
    }

    progressDialog.updateStepStatus(rogersAccountId, 'transactions', 'processing', 'Fetching...');
    const txResult = await fetchRogersBankTransactions(fromDate, toDate);

    if (txResult.success && txResult.transactions.length > 0) {
      const approvedTx = txResult.transactions.filter((tx) => tx.activityStatus === 'APPROVED');

      if (approvedTx.length === 0) {
        progressDialog.updateStepStatus(rogersAccountId, 'transactions', 'success', 'No approved');
        progressDialog.hideCancel();
        progressDialog.showSummary({ success: 1, failed: 0, total: 1 });
        return { success: true, message: 'Balance uploaded. No approved transactions.' };
      }

      progressDialog.updateStepStatus(rogersAccountId, 'transactions', 'processing', 'Checking duplicates...');
      const filterResult = filterDuplicateTransactions(approvedTx, rogersAccountId);

      if (filterResult.transactions.length === 0) {
        const msg = filterResult.duplicateCount > 0 ? `${filterResult.duplicateCount} already uploaded` : 'No new';
        progressDialog.updateStepStatus(rogersAccountId, 'transactions', 'success', msg);
        progressDialog.hideCancel();
        progressDialog.showSummary({ success: 1, failed: 0, total: 1 });
        return { success: true, message: `Balance uploaded. ${msg}` };
      }

      progressDialog.updateStepStatus(rogersAccountId, 'transactions', 'processing', 'Resolving categories...');
      const resolvedTx = await resolveCategoriesForTransactions(filterResult.transactions);

      progressDialog.updateStepStatus(rogersAccountId, 'transactions', 'processing', 'Converting...');
      const csvData = convertTransactionsToMonarchCSV(resolvedTx, rogersAccountName);
      if (!csvData) throw new Error('Failed to convert transactions to CSV');

      progressDialog.updateStepStatus(rogersAccountId, 'transactions', 'processing', 'Uploading...');
      const filename = `rogers_transactions_${fromDate}_to_${toDate}.csv`;
      const uploadSuccess = await monarchApi.uploadTransactions(monarchAccount.id, csvData, filename, true, false);

      if (uploadSuccess) {
        const refs = filterResult.transactions.map((tx) => tx.referenceNumber).filter(Boolean);
        if (refs.length > 0) {
          let txDate = getTodayLocal();
          const withDates = filterResult.transactions.filter((tx) => tx.activityDate);
          if (withDates.length > 0) {
            txDate = withDates.map((tx) => new Date(tx.activityDate)).sort((a, b) => b - a)[0].toISOString().split('T')[0];
          }
          saveUploadedTransactions(rogersAccountId, refs, 'rogersbank', txDate);
        }

        saveLastUploadDate(rogersAccountId, getTodayLocal(), 'rogersbank');

        const msg = filterResult.duplicateCount > 0
          ? `${filterResult.transactions.length} uploaded (${filterResult.duplicateCount} skipped)`
          : `${filterResult.transactions.length} uploaded`;

        progressDialog.updateStepStatus(rogersAccountId, 'transactions', 'success', msg);
        progressDialog.hideCancel();
        progressDialog.showSummary({ success: 1, failed: 0, total: 1 });
        toast.show(`${msg} to Monarch!`, 'info');

        return { success: true, message: `${msg} to Monarch!` };
      }
      throw new Error('Upload to Monarch failed');
    }

    progressDialog.updateStepStatus(rogersAccountId, 'transactions', 'success', 'No transactions');
    progressDialog.hideCancel();
    progressDialog.showSummary({ success: 1, failed: 0, total: 1 });
    return { success: true, message: 'Balance uploaded. No transactions found.' };
  } catch (error) {
    debugLog('Error in Rogers Bank upload:', error);
    if (progressDialog && rogersAccountId) {
      progressDialog.updateProgress(rogersAccountId, 'error', `Failed: ${error.message}`);
      progressDialog.hideCancel();
      progressDialog.showSummary({ success: 0, failed: 1, total: 1 });
    }
    toast.show(`Error: ${error.message}`, 'error');
    return { success: false, message: error.message, error };
  }
}

export default {
  uploadRogersBankToMonarch,
  fetchRogersBankTransactions,
  isFirstSync,
  getEndOfCurrentMonth,
};
