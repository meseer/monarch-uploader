/**
 * Rogers Bank Upload Service
 * Handles downloading transactions from Rogers Bank and uploading to Monarch Money
 */

import {
  debugLog, getTodayLocal, calculateFromDateWithLookback, saveLastUploadDate, formatDate, parseLocalDate,
  getLastUpdateDate, formatDaysAgoLocal,
} from '../core/utils';
import toast from '../ui/toast';
import { LOGO_CLOUDINARY_IDS } from '../core/config';
import stateManager from '../core/state';
import { getRogersBankCredentials, fetchRogersBankAccountDetails } from '../api/rogersbank';
import monarchApi from '../api/monarch';
import { showMonarchAccountSelectorWithCreate } from '../ui/components/accountSelectorWithCreate';
import { convertTransactionsToMonarchCSV } from '../utils/csv';
import { showDatePickerWithOptionsPromise } from '../ui/components/datePicker';
import { applyCategoryMapping, saveUserCategorySelection, calculateAllCategorySimilarities } from '../mappers/category';
import { showMonarchCategorySelector } from '../ui/components/categorySelector';
import { showProgressDialog } from '../ui/components/progressDialog';
import {
  getTransactionIdsFromArray,
  mergeAndRetainTransactions,
  getRetentionSettingsFromAccount,
} from '../utils/transactionStorage';
import accountService from './common/accountService';
import { INTEGRATIONS, ACCOUNT_SETTINGS } from '../core/integrationCapabilities';
import {
  separateAndDeduplicateTransactions,
  reconcileRogersPendingTransactions,
  formatReconciliationMessage,
  formatPendingIdForNotes,
} from './rogersbank/pendingTransactions';

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
 * Uses consolidated storage via getLastUpdateDate()
 * @param {string} rogersAccountId - Rogers account ID
 * @returns {boolean} True if first sync
 */
function isFirstSync(rogersAccountId) {
  const lastUploadDate = getLastUpdateDate(rogersAccountId, 'rogersbank');
  return !lastUploadDate;
}

/**
 * Get the last day of the current month
 * @returns {string} Date in YYYY-MM-DD format
 */
function getEndOfCurrentMonth() {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return formatDate(lastDay);
}

/**
 * Compute the deduplication key for a settled Rogers Bank transaction.
 *
 * Fee transactions (activityClassification === 'FEES') share the same
 * referenceNumber as the purchase they are associated with. To prevent
 * the fee from being incorrectly filtered as a duplicate of the purchase,
 * we append a ':fee' suffix to the key.
 *
 * @param {Object} tx - Rogers Bank transaction
 * @returns {string|undefined} Dedup key or undefined if none available
 */
function computeSettledDedupKey(tx) {
  let key = tx.referenceNumber || tx.generatedId;
  if (key && tx.activityClassification === 'FEES') {
    key = `${key}:fee`;
  }
  return key;
}

/**
 * Filter out already uploaded settled transactions
 * Uses consolidated storage for uploaded transaction IDs
 * @param {Array} transactions - Array of settled transactions
 * @param {string} accountId - Rogers account ID
 * @returns {Object} Filtered transactions and statistics
 */
function filterDuplicateSettledTransactions(transactions, accountId) {
  // Read from consolidated storage (uploadedTransactions in account object)
  const accountData = accountService.getAccountData(INTEGRATIONS.ROGERSBANK, accountId);
  const uploadedRefs = getTransactionIdsFromArray((accountData?.uploadedTransactions as unknown[]) || []);
  const originalCount = transactions.length;

  debugLog(`[DEDUP DEBUG] Account: ${accountId}`);
  debugLog(`[DEDUP DEBUG] Stored transaction IDs count: ${uploadedRefs.size}`);
  if (uploadedRefs.size > 0) {
    debugLog('[DEDUP DEBUG] Sample stored IDs (first 5):', Array.from(uploadedRefs).slice(0, 5));
  }

  const newTransactions = transactions.filter((transaction) => {
    // Use qualified dedup key (appends :fee suffix for FEES classification)
    const dedupKey = computeSettledDedupKey(transaction);
    const isNew = !dedupKey || !uploadedRefs.has(dedupKey);

    if (isNew) {
      debugLog(`[DEDUP DEBUG] Settled transaction PASSED filter - dedupKey: "${dedupKey}", date: ${transaction.date}, merchant: ${transaction.merchant?.name || 'N/A'}`);
    } else {
      debugLog(`[DEDUP DEBUG] Settled transaction FILTERED (duplicate) - dedupKey: "${dedupKey}", date: ${transaction.date}, merchant: ${transaction.merchant?.name || 'N/A'}, classification: ${transaction.activityClassification || 'N/A'}`);
    }

    return isNew;
  });

  const duplicateCount = originalCount - newTransactions.length;

  if (duplicateCount > 0) {
    debugLog(`Filtered out ${duplicateCount} duplicate settled transactions`);
  }

  return { transactions: newTransactions, duplicateCount, originalCount };
}

/**
 * Filter out already uploaded pending transactions
 * Uses generated hash IDs stored in uploadedTransactions
 * @param {Array} pendingTransactions - Array of pending transactions with generatedId property
 * @param {string} accountId - Rogers account ID
 * @returns {Object} Filtered transactions and statistics
 */
function filterDuplicatePendingTransactions(pendingTransactions, accountId) {
  const accountData = accountService.getAccountData(INTEGRATIONS.ROGERSBANK, accountId);
  const uploadedRefs = getTransactionIdsFromArray((accountData?.uploadedTransactions as unknown[]) || []);
  const originalCount = pendingTransactions.length;

  const newTransactions = pendingTransactions.filter((transaction) => {
    const hashId = transaction.generatedId;
    const isNew = !uploadedRefs.has(hashId);

    if (isNew) {
      debugLog(`[DEDUP DEBUG] Pending transaction PASSED filter - hashId: "${hashId}", date: ${transaction.date}, merchant: ${transaction.merchant?.name || 'N/A'}`);
    }

    return isNew;
  });

  const duplicateCount = originalCount - newTransactions.length;

  if (duplicateCount > 0) {
    debugLog(`Filtered out ${duplicateCount} duplicate pending transactions`);
  }

  return { transactions: newTransactions, duplicateCount, originalCount };
}

/**
 * Resolve categories for transactions
 * @param {Array} transactions - Array of transactions to process
 * @param {Object} options - Options for category resolution
 * @param {boolean} options.skipCategorization - Skip manual category prompts, use empty category (optional)
 * @returns {Promise<Array>} Transactions with resolved Monarch categories
 */
interface ResolveCategoriesOptions {
  skipCategorization?: boolean;
}

async function resolveCategoriesForTransactions(transactions, options: ResolveCategoriesOptions = {}) {
  const { skipCategorization = false } = options;
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

  // If skip categorization is enabled, set Uncategorized for all transactions
  // and return immediately (no manual prompts)
  if (skipCategorization) {
    debugLog('Skip categorization enabled - setting Uncategorized for all Rogers Bank transactions');
    return transactions.map((transaction) => {
      const bankCategory = transaction.merchant?.categoryDescription
        || transaction.merchant?.category
        || 'Uncategorized';
      return { ...transaction, resolvedMonarchCategory: 'Uncategorized', originalBankCategory: bankCategory };
    });
  }

  const uniqueBankCategories = new Map();
  const categoriesToResolve = [];
  // Track categories that have been resolved via "Skip All" to apply empty category
  let skipAllTriggered = false;

  transactions.forEach((transaction) => {
    // Skip FEES transactions — they are auto-categorized as "Financial Fees"
    // and should never trigger manual category prompts
    if (transaction.activityClassification === 'FEES') return;

    // Skip CASH/CASH transactions — they are auto-categorized as "Cash & ATM"
    // Only when BOTH fields are 'CASH' (other activityCategory values use normal mapping)
    if (transaction.activityClassification === 'CASH' && transaction.activityCategory === 'CASH') return;

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

      const transactionDetails: { merchant?: string; amount?: number; date?: string } = {};
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

      const selectedCategory = await new Promise<Record<string, unknown> | null>((resolve) => {
        showMonarchCategorySelector(categoryToResolve.bankCategory, resolve, similarityData, transactionDetails);
      });

      if (!selectedCategory) {
        throw new Error(`Category selection cancelled for "${categoryToResolve.bankCategory}".`);
      }

      // Handle "Skip All (this sync)" response
      if (selectedCategory.skipAll === true) {
        debugLog('User chose "Skip All" - setting Uncategorized for all remaining Rogers Bank transactions');
        skipAllTriggered = true;
        break;
      }

      // Handle "Skip single" - don't save as rule, just continue to next
      if (selectedCategory.skipped) {
        debugLog(`Skipped categorization for "${categoryToResolve.bankCategory}" (single transaction)`);
        continue;
      }

      saveUserCategorySelection(categoryToResolve.bankCategory, selectedCategory.name as string);
    }
  }

  return transactions.map((transaction) => {
    const bankCategory = transaction.merchant?.categoryDescription
      || transaction.merchant?.category
      || 'Uncategorized';

    // Auto-categorize FEES transactions (e.g. cash advance fees, annual fees)
    // activityClassification is a more reliable signal than merchant.category
    if (transaction.activityClassification === 'FEES') {
      debugLog(`Auto-categorizing FEES transaction as "Financial Fees": ${transaction.merchant?.name || 'N/A'}`);
      return { ...transaction, resolvedMonarchCategory: 'Financial Fees', originalBankCategory: bankCategory };
    }

    // Auto-categorize CASH transactions (e.g. cash advances, ATM withdrawals)
    // Only when BOTH activityClassification AND activityCategory are 'CASH'
    if (transaction.activityClassification === 'CASH' && transaction.activityCategory === 'CASH') {
      debugLog(`Auto-categorizing CASH transaction as "Cash & ATM": ${transaction.merchant?.name || 'N/A'}`);
      return { ...transaction, resolvedMonarchCategory: 'Cash & ATM', originalBankCategory: bankCategory };
    }

    const mappingResult = applyCategoryMapping(bankCategory, availableCategories);

    // If skip all was triggered, unresolved categories get Uncategorized
    if (skipAllTriggered && typeof mappingResult !== 'string') {
      return { ...transaction, resolvedMonarchCategory: 'Uncategorized', originalBankCategory: bankCategory };
    }

    const resolvedCategory = typeof mappingResult === 'string' ? mappingResult : 'Uncategorized';

    return { ...transaction, resolvedMonarchCategory: resolvedCategory, originalBankCategory: bankCategory };
  });
}

/**
 * Fetch Rogers Bank transactions
 *
 * IMPORTANT: Rogers Bank API offset parameter is counter-intuitive!
 * The offset does NOT skip transactions - instead it specifies how many "pages" of 50 transactions
 * to load in a single request. The API returns ALL transactions from the beginning up to (offset * 50).
 *
 * Examples:
 * - offset=10 → loads up to 500 transactions (10 pages × 50 per page)
 * - offset=20 → loads up to 1000 transactions (20 pages × 50 per page) - API MAXIMUM
 *
 * The API has a hard limit of 1000 transactions maximum. If totalCount == 1000, there may be
 * more transactions that cannot be retrieved.
 *
 * @param {string} fromDate - Start date (YYYY-MM-DD)
 * @param {string} toDate - End date (YYYY-MM-DD)
 * @param {boolean} fullHistory - If true, fetch maximum transactions (offset=20, ~1000 transactions).
 *                                 If false, fetch recent transactions (offset=10, ~500 transactions).
 * @returns {Promise<Object>} API response with transactions
 */
async function fetchRogersBankTransactions(fromDate, toDate, fullHistory = false) {
  const credentials = getRogersBankCredentials();

  if (!credentials.authToken || !credentials.accountId || !credentials.customerId
      || !credentials.accountIdEncoded || !credentials.customerIdEncoded || !credentials.deviceId) {
    throw new Error('Missing Rogers Bank credentials.');
  }

  // Rogers Bank API offset explanation:
  // - offset specifies number of "pages" to load, NOT transactions to skip
  // - Each "page" contains 50 transactions
  // - offset=10 → 500 transactions max (sufficient for regular sync)
  // - offset=20 → 1000 transactions max (API limit, needed for balance reconstruction)
  const offset = fullHistory ? 20 : 10;

  const url = `https://selfserve.apis.rogersbank.com/corebank/v1/account/${credentials.accountId}/customer/${credentials.customerId}/transactions?limit=0&offset=${offset}&fromDate=${fromDate}&toDate=${toDate}`;

  debugLog(`Fetching Rogers Bank transactions (offset=${offset}, fullHistory=${fullHistory})`);

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
  if (!data.activitySummary) throw new Error('Invalid API response: missing activitySummary');

  const totalCount = data.activitySummary.totalCount || 0;
  const transactions = data.activitySummary.activities || [];

  debugLog(`Rogers Bank API returned ${transactions.length} transactions (totalCount: ${totalCount})`);

  return {
    success: true,
    transactions,
    totalCount,
    fromDate,
    toDate,
    // Flag to indicate if we hit the API limit (may be missing older transactions)
    truncated: totalCount >= 1000,
  };
}

/**
 * Build sync steps for progress dialog
 * Order: credit limit → pending reconciliation → transactions → balance
 * (Reconciliation before transactions prevents duplicate uploads of settled transactions)
 */
function buildRogersBankSteps(hasTransactions = true, includeCreditLimit = true, includePendingReconciliation = true) {
  const steps = [];
  if (includeCreditLimit) steps.push({ key: 'creditLimit', name: 'Credit limit sync' });
  if (includePendingReconciliation) steps.push({ key: 'pendingReconciliation', name: 'Pending reconciliation' });
  if (hasTransactions) steps.push({ key: 'transactions', name: 'Transaction sync' });
  steps.push({ key: 'balance', name: 'Balance upload' });
  return steps;
}

/**
 * Normalize Rogers Bank transaction for balance reconstruction
 * Rogers API returns: { date: "2024-01-19", amount: { value: "10.99", currency: "CAD" } }
 * Reconstruction expects: { date: "2024-01-19", amount: 10.99 }
 * @param {Object} tx - Raw Rogers Bank transaction
 * @returns {Object} Normalized transaction with date and numeric amount
 */
function normalizeRogersTransaction(tx) {
  // Rogers API uses 'date' field directly in YYYY-MM-DD format
  const date = tx.date || null;

  // Rogers API has amount as { value: "10.99", currency: "CAD" }
  // Parse the string value to a number
  let amount = 0;
  if (tx.amount?.value !== undefined) {
    amount = parseFloat(tx.amount.value) || 0;
  }

  return { date, amount };
}

/**
 * Reconstruct balance history from transactions starting with 0 balance
 *
 * When applyCorrection is true (typically when transaction history is truncated at 1000),
 * the function calculates a correction factor based on the difference between the actual
 * current balance and the reconstructed today's balance, then applies this correction
 * to all historical balance entries. This ensures:
 * 1. Today's balance matches the actual current balance exactly
 * 2. Historical balances are reasonable approximations (shifted by the correction factor)
 *
 * @param {Array} transactions - Array of normalized transactions with date and amount
 * @param {string} fromDate - Start date
 * @param {string} toDate - End date
 * @param {number} currentBalance - Current balance
 * @param {boolean} invertBalance - If true, invert (negate) all balance values
 * @param {boolean} applyCorrection - If true, apply correction factor to align reconstructed balance with actual
 */
function reconstructBalanceFromTransactions(transactions, fromDate: string, toDate: string, currentBalance: number, invertBalance: boolean = false, applyCorrection: boolean = false) {
  const transactionsByDate = new Map();
  if (transactions?.length > 0) {
    transactions.forEach((tx) => {
      const dateStr = tx.date;
      if (!dateStr) return;
      const amount = tx.amount || 0;
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

  // First pass: calculate raw running balance for each day
  while (currentDateObj <= toDateObj) {
    const dateStr = formatDate(currentDateObj);
    const dayTransactions = transactionsByDate.get(dateStr) || [];
    const dayTotal = dayTransactions.reduce((sum, amt) => sum + amt, 0);
    runningBalance += dayTotal;

    const dayBalance = Math.round(runningBalance * 100) / 100;
    balanceHistory.push({ date: dateStr, amount: dayBalance });
    currentDateObj.setDate(currentDateObj.getDate() + 1);
  }

  // Calculate correction factor if needed
  // This corrects for incomplete transaction history (e.g., when truncated at 1000 transactions)
  let correctionFactor = 0;
  if (applyCorrection && currentBalance !== null && currentBalance !== undefined && balanceHistory.length > 0) {
    // Find today's reconstructed balance (or the last entry if today is not in range)
    const todayEntry = balanceHistory.find((entry) => entry.date === todayStr);
    const currentReconstructedBalance = todayEntry ? todayEntry.amount : balanceHistory[balanceHistory.length - 1].amount;
    correctionFactor = currentBalance - currentReconstructedBalance;

    if (correctionFactor !== 0) {
      debugLog(`Balance correction applied: factor=${correctionFactor}, reconstructed=${currentReconstructedBalance}, actual=${currentBalance}`);
    }
  }

  // Apply correction factor and inversion to all entries
  // Only apply correction starting from first non-zero balance to preserve leading zeros
  let hasSeenNonZeroBalance = false;
  return balanceHistory.map((entry) => {
    // Track when we see the first non-zero balance
    if (entry.amount !== 0) {
      hasSeenNonZeroBalance = true;
    }

    // Only apply correction once we've seen a non-zero balance
    let adjustedAmount = hasSeenNonZeroBalance ? entry.amount + correctionFactor : entry.amount;
    adjustedAmount = Math.round(adjustedAmount * 100) / 100;

    // Apply inversion if needed
    const finalAmount = invertBalance ? -adjustedAmount : adjustedAmount;
    return { date: entry.date, amount: finalAmount };
  });
}

/**
 * Generate CSV for balance history
 * @param {Array} balanceHistory - Array of balance entries with date and amount
 * @param {string} accountName - Account name for CSV
 * @param {boolean} invertBalance - If true, invert (negate) all balance values (applied if not already inverted during reconstruction)
 */
function generateBalanceHistoryCSV(balanceHistory, accountName, invertBalance = false) {
  let csvContent = '"Date","Total Equity","Account Name"\n';
  balanceHistory.forEach((entry) => {
    const amount = invertBalance ? -entry.amount : entry.amount;
    csvContent += `"${entry.date}","${amount}","${accountName}"\n`;
  });
  return csvContent;
}

/**
 * Generate CSV for single-day balance
 * @param {number} balance - Current balance
 * @param {string} accountName - Account name for CSV
 * @param {boolean} invertBalance - If true, invert (negate) the balance value
 */
function generateBalanceCSV(balance, accountName, invertBalance = false) {
  const todayFormatted = getTodayLocal();
  const finalBalance = invertBalance ? -balance : balance;
  let csvContent = '"Date","Total Equity","Account Name"\n';
  csvContent += `"${todayFormatted}","${finalBalance}","${accountName}"\n`;
  return csvContent;
}

/**
 * Sync credit limit from Rogers Bank to Monarch
 * Uses consolidated storage for credit limit tracking
 * @param {string} rogersAccountId - Rogers account ID
 * @param {string} monarchAccountId - Monarch account ID
 * @param {number} creditLimit - Credit limit to set
 * @returns {Promise<boolean>} True if credit limit was synced successfully
 */
async function syncCreditLimit(rogersAccountId, monarchAccountId, creditLimit) {
  if (creditLimit === null || creditLimit === undefined) return true;

  // Check consolidated storage for last synced credit limit
  const accountData = accountService.getAccountData(INTEGRATIONS.ROGERSBANK, rogersAccountId);
  const storedCreditLimit = accountData?.lastSyncedCreditLimit;
  if (storedCreditLimit !== null && storedCreditLimit !== undefined && storedCreditLimit === creditLimit) return true;

  try {
    const updatedAccount = await monarchApi.setCreditLimit(monarchAccountId, creditLimit);

    // Verify the credit limit was actually set before caching
    if (updatedAccount && updatedAccount.limit === creditLimit) {
      // Save to consolidated storage
      accountService.updateAccountInList(INTEGRATIONS.ROGERSBANK, rogersAccountId, {
        lastSyncedCreditLimit: creditLimit,
      });
      debugLog(`Credit limit synced: $${creditLimit}`);
      return true;
    }

    // API call succeeded but limit wasn't applied correctly
    debugLog(`Credit limit update returned but value not applied. Expected: ${creditLimit}, Got: ${updatedAccount?.limit}`);
    return false;
  } catch (error) {
    debugLog('Error syncing credit limit:', error);
    return false;
  }
}

/**
 * Extract balance change information for a Rogers Bank account
 * @param {string} accountId - Account ID
 * @param {number} currentBalance - Current balance
 * @returns {Object|null} Balance change data or null if not available
 */
function extractRogersBankBalanceChange(accountId, currentBalance) {
  try {
    if (currentBalance === null || currentBalance === undefined) {
      debugLog(`No current balance found for Rogers account ${accountId}`);
      return null;
    }

    // Get last upload date
    const lastUploadDate = getLastUpdateDate(accountId, 'rogersbank');
    if (!lastUploadDate) {
      debugLog(`No last upload date found for Rogers account ${accountId}`);
      return null;
    }

    // Get previous balance from checkpoint
    const checkpoint = getOrStoreBalanceCheckpoint(accountId);
    if (!checkpoint || checkpoint.amount === undefined || checkpoint.amount === null) {
      debugLog(`No balance checkpoint found for Rogers account ${accountId}`);
      return null;
    }

    const oldBalance = checkpoint.amount;
    const compareDate = checkpoint.date || lastUploadDate;

    // Calculate percentage change
    const changePercent = oldBalance !== 0
      ? ((currentBalance - oldBalance) / Math.abs(oldBalance)) * 100
      : 0;

    debugLog(`Balance change for Rogers account ${accountId}: ${oldBalance} (${compareDate}) -> ${currentBalance} (${changePercent.toFixed(2)}%)`);

    return {
      oldBalance,
      newBalance: currentBalance,
      lastUploadDate: compareDate,
      changePercent,
      accountType: 'credit',
      debtAsPositive: true, // Rogers tracks debt as positive balance, so increase = more debt (bad)
    };
  } catch (error) {
    debugLog(`Error extracting balance change for Rogers account ${accountId}:`, error);
    return null;
  }
}

/**
 * Get or store balance checkpoint
 * Uses consolidated storage for balance checkpoint tracking
 * @param {string} accountId - Rogers account ID
 * @param {Object|null} checkpoint - Checkpoint to store, or null to retrieve
 * @returns {Object|null} Stored checkpoint or null
 */
function getOrStoreBalanceCheckpoint(accountId, checkpoint = null) {
  if (checkpoint) {
    accountService.updateAccountInList(INTEGRATIONS.ROGERSBANK, accountId, {
      balanceCheckpoint: checkpoint,
    });
    return checkpoint;
  }
  const accountData = accountService.getAccountData(INTEGRATIONS.ROGERSBANK, accountId);
  return accountData?.balanceCheckpoint || null;
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

    const { balance: currentBalance, creditLimit, openedDate } = accountDetails as {
      balance: number;
      creditLimit: number | null;
      openedDate: string | null;
    };
    const firstSync = isFirstSync(rogersAccountId);

    debugLog(`First sync: ${firstSync}, Balance: ${currentBalance}, Credit limit: ${creditLimit}, Opened: ${openedDate}`);

    // Determine fromDate and reconstruction
    let fromDate;
    let reconstructBalance = false;

    if (firstSync) {
      const defaultDate = openedDate || formatDaysAgoLocal(14);

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
      fromDate = calculateFromDateWithLookback('rogersbank', rogersAccountId) || formatDaysAgoLocal(14);
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

    // Resolve Monarch account mapping using accountService (consolidated storage first, legacy fallback)
    let monarchAccount = null;
    let accountWarningMessage = null;

    // Check consolidated storage first via accountService
    monarchAccount = accountService.getMonarchAccountMapping(INTEGRATIONS.ROGERSBANK, rogersAccountId);

    if (monarchAccount) {
      // Validate the mapping is still valid (account not deleted in Monarch)
      progressDialog.updateProgress(rogersAccountId, 'processing', 'Validating Monarch account...');
      const validation = await monarchApi.validateAndRefreshAccountMapping(
        monarchAccount.id,
        null, // No legacy storage key to update
        monarchAccount.displayName,
      );

      if (!validation.valid) {
        // Account was deleted - show warning in account selector
        accountWarningMessage = validation.warningMessage;
        monarchAccount = null;
      } else {
        monarchAccount = validation.account;
      }
    }

    if (!monarchAccount) {
      progressDialog.updateProgress(rogersAccountId, 'processing', 'Getting Monarch account mapping...');

      const monarchAccounts = await monarchApi.listAccounts('credit');
      if (!monarchAccounts?.length) throw new Error('No Monarch credit card accounts found.');

      monarchAccount = await new Promise((resolve) => {
        showMonarchAccountSelectorWithCreate(monarchAccounts as unknown as Parameters<typeof showMonarchAccountSelectorWithCreate>[0], resolve, null, 'credit', {
          defaultName: rogersAccountName,
          defaultType: 'credit',
          defaultSubtype: 'credit_card',
          currentBalance: { amount: currentBalance, currency: 'CAD' },
          accountType: 'Credit Card',
          warningMessage: accountWarningMessage,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
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

      // Save mapping to consolidated storage using accountService.upsertAccount()
      // Include invertBalance flag: true for newly created manual accounts, false for linked accounts
      accountService.upsertAccount(INTEGRATIONS.ROGERSBANK, {
        rogersbankAccount: {
          id: rogersAccountId,
          nickname: rogersAccountName,
        },
        monarchAccount,
        invertBalance: monarchAccount.newlyCreated === true,
      });
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

    // STEP 2 & 3 COMBINED: Fetch transactions ONCE and use for both balance and transaction upload
    // On first sync, use fullHistory=true to get up to 1000 transactions
    // On regular sync, use fullHistory=false (500 transactions is sufficient)
    const useFullHistory = firstSync;

    progressDialog.updateStepStatus(rogersAccountId, 'pendingReconciliation', 'processing', 'Fetching transactions...');
    const txResult = await fetchRogersBankTransactions(fromDate, toDate, useFullHistory);

    // Warn if we hit the API limit on first sync
    if (txResult.truncated && firstSync) {
      toast.show('⚠️ Transaction history may be incomplete (>1000 transactions). Balance reconstruction may not be accurate for early dates.', 'warning');
      debugLog('Warning: Transaction history truncated at 1000 transactions');
    }

    // Separate transactions into settled and pending, and deduplicate
    // (removes pending duplicates when a settled version exists with the same hash)
    const allTransactions = txResult.transactions || [];

    const separationResult = await separateAndDeduplicateTransactions(allTransactions);
    const { settled: allSettledTx, pending: allPendingTx } = separationResult;

    // Read includePendingTransactions setting from account data
    const accountDataForPending = accountService.getAccountData(INTEGRATIONS.ROGERSBANK, rogersAccountId);
    const includePendingTransactions = accountDataForPending?.[ACCOUNT_SETTINGS.INCLUDE_PENDING_TRANSACTIONS] !== false;

    debugLog(`Rogers Bank transactions: ${allSettledTx.length} settled, ${allPendingTx.length} pending (include pending: ${includePendingTransactions})`);
    if (separationResult.duplicatesRemoved > 0) {
      debugLog(`Removed ${separationResult.duplicatesRemoved} pending duplicates that matched settled transactions`);
    }

    // Use only settled (APPROVED) transactions for balance reconstruction
    const allApprovedTx = allSettledTx;

    // STEP 2: Pending transaction reconciliation
    // Runs BEFORE transaction upload so settled ref IDs are saved to dedup store,
    // preventing the settled version from being uploaded as a duplicate.
    progressDialog.updateStepStatus(rogersAccountId, 'pendingReconciliation', 'processing', 'Reconciling...');
    try {
      const lookbackDays = 90; // Rogers Bank lookback for reconciliation
      const reconciliationResult = await reconcileRogersPendingTransactions(
        monarchAccount.id,
        allTransactions,
        lookbackDays,
      );

      // Save settled ref IDs to dedup store so transaction upload skips them
      const settledRefIds = reconciliationResult.settledRefIds || [];
      if (settledRefIds.length > 0) {
        debugLog(`Saving ${settledRefIds.length} reconciled settled ref IDs to dedup store`);
        const reconAcctData = accountService.getAccountData(INTEGRATIONS.ROGERSBANK, rogersAccountId);
        const reconExisting = (reconAcctData?.uploadedTransactions as unknown[]) || [];
        const reconRetention = getRetentionSettingsFromAccount(reconAcctData);
        const reconUpdated = mergeAndRetainTransactions(reconExisting, settledRefIds, reconRetention, getTodayLocal());
        accountService.updateAccountInList(INTEGRATIONS.ROGERSBANK, rogersAccountId, {
          uploadedTransactions: reconUpdated,
        });
      }

      const reconciliationMsg = formatReconciliationMessage(reconciliationResult);
      const reconciliationStatus = reconciliationResult.success !== false ? 'success' : 'error';
      progressDialog.updateStepStatus(rogersAccountId, 'pendingReconciliation', reconciliationStatus, reconciliationMsg);
      debugLog('Rogers Bank pending reconciliation result:', reconciliationResult);
    } catch (reconciliationError) {
      debugLog('Error during Rogers Bank pending reconciliation:', reconciliationError);
      progressDialog.updateStepStatus(rogersAccountId, 'pendingReconciliation', 'error', reconciliationError.message);
    }

    // STEP 3: Upload transactions
    if (abortController.signal.aborted) {
      progressDialog.updateProgress(rogersAccountId, 'error', 'Cancelled');
      progressDialog.hideCancel();
      return { success: false, message: 'Cancelled' };
    }

    progressDialog.updateStepStatus(rogersAccountId, 'transactions', 'processing', 'Checking duplicates...');

    let transactionUploadSuccess = false;
    let totalNewSettled = 0;
    let totalNewPending = 0;
    let totalDuplicates = 0;

    if (txResult.success && (allSettledTx.length > 0 || allPendingTx.length > 0)) {
      // Filter out already-uploaded settled transactions
      // (includes ref IDs saved by reconciliation above, so reconciled transactions are skipped)
      const settledFilterResult = filterDuplicateSettledTransactions(allSettledTx, rogersAccountId);
      totalDuplicates += settledFilterResult.duplicateCount;

      // Filter out already-uploaded pending transactions
      let newPendingTx = [];
      if (includePendingTransactions && allPendingTx.length > 0) {
        const pendingFilterResult = filterDuplicatePendingTransactions(allPendingTx, rogersAccountId);
        newPendingTx = pendingFilterResult.transactions;
        totalDuplicates += pendingFilterResult.duplicateCount;
      }

      const allNewTransactions = [...settledFilterResult.transactions, ...newPendingTx];
      totalNewSettled = settledFilterResult.transactions.length;
      totalNewPending = newPendingTx.length;

      if (totalDuplicates > 0) {
        toast.show(`Skipping ${totalDuplicates} already uploaded transactions`, 'debug');
      }

      if (allNewTransactions.length === 0) {
        const msg = totalDuplicates > 0 ? `${totalDuplicates} already uploaded` : 'No new';
        progressDialog.updateStepStatus(rogersAccountId, 'transactions', 'success', msg);
      } else {
        progressDialog.updateStepStatus(rogersAccountId, 'transactions', 'processing', 'Resolving categories...');
        const accountDataForSkip = accountService.getAccountData(INTEGRATIONS.ROGERSBANK, rogersAccountId);
        const skipCategorization = accountDataForSkip?.skipCategorization === true;

        // Prepare pending transactions with isPending flag and pendingId for CSV
        const transactionsForCategorization = allNewTransactions.map((tx) => {
          if (tx.generatedId) {
            // Pending transaction — add metadata for CSV
            return { ...tx, isPending: true, pendingId: formatPendingIdForNotes(tx.generatedId) };
          }
          return tx;
        });

        const resolvedTx = await resolveCategoriesForTransactions(transactionsForCategorization, { skipCategorization });

        progressDialog.updateStepStatus(rogersAccountId, 'transactions', 'processing', 'Converting...');
        const accountData = accountService.getAccountData(INTEGRATIONS.ROGERSBANK, rogersAccountId);
        const storeTransactionDetailsInNotes = (accountData?.storeTransactionDetailsInNotes ?? false) as boolean;
        const csvData = convertTransactionsToMonarchCSV(resolvedTx, rogersAccountName, { storeTransactionDetailsInNotes });
        if (!csvData) throw new Error('Failed to convert transactions to CSV');

        progressDialog.updateStepStatus(rogersAccountId, 'transactions', 'processing', 'Uploading...');
        const filename = `rogers_transactions_${fromDate}_to_${toDate}.csv`;
        const uploadSuccess = await monarchApi.uploadTransactions(monarchAccount.id, csvData, filename, false, false);

        if (uploadSuccess) {
          transactionUploadSuccess = true;

          // Save settled transaction dedup keys to store
          // Use computeSettledDedupKey to apply :fee suffix for FEES classification
          const settledRefs = settledFilterResult.transactions.map((tx) => computeSettledDedupKey(tx)).filter(Boolean);
          // Save pending transaction hash IDs to dedup store
          const pendingRefs = newPendingTx.map((tx) => tx.generatedId).filter(Boolean);
          const allRefs = [...settledRefs, ...pendingRefs];

          if (allRefs.length > 0) {
            let txDate = getTodayLocal();
            const withDates = allNewTransactions.filter((tx) => tx.date);
            if (withDates.length > 0) {
              withDates.sort((a, b) => b.date.localeCompare(a.date));
              txDate = withDates[0].date;
            }
            const txAccountData = accountService.getAccountData(INTEGRATIONS.ROGERSBANK, rogersAccountId);
            const existingTransactions = (txAccountData?.uploadedTransactions as unknown[]) || [];
            const retentionSettings = getRetentionSettingsFromAccount(txAccountData);
            const updatedTransactions = mergeAndRetainTransactions(existingTransactions, allRefs, retentionSettings, txDate);
            accountService.updateAccountInList(INTEGRATIONS.ROGERSBANK, rogersAccountId, {
              uploadedTransactions: updatedTransactions,
            });
          }

          saveLastUploadDate(rogersAccountId, getTodayLocal(), 'rogersbank');

          // Build transaction count message
          const parts = [];
          if (totalNewSettled > 0) parts.push(`${totalNewSettled} settled`);
          if (totalNewPending > 0) parts.push(`${totalNewPending} pending`);
          const uploadedMsg = parts.join(', ');
          const msg = totalDuplicates > 0
            ? `${uploadedMsg} uploaded (${totalDuplicates} skipped)`
            : `${uploadedMsg} uploaded`;

          progressDialog.updateStepStatus(rogersAccountId, 'transactions', 'success', msg);
        } else {
          throw new Error('Upload to Monarch failed');
        }
      }
    } else {
      progressDialog.updateStepStatus(rogersAccountId, 'transactions', 'success', 'No transactions');
    }

    // STEP 4: Upload balance (after reconciliation so deleted pending transactions don't affect balance)
    progressDialog.updateStepStatus(rogersAccountId, 'balance', 'processing', 'Preparing...');
    let balanceUploadSuccess = false;
    const todayFormatted = getTodayLocal();

    // Get invertBalance setting from saved account data
    // For migration: if undefined, derive from monarchAccount.newlyCreated (persisted) and save it
    const accountDataForInvert = accountService.getAccountData(INTEGRATIONS.ROGERSBANK, rogersAccountId);
    let invertBalanceRaw = accountDataForInvert?.invertBalance as boolean | undefined;

    if (invertBalanceRaw === undefined) {
      // Migration: derive from persisted newlyCreated flag (matches previous dynamic calculation)
      const monarchAccountData = accountDataForInvert?.monarchAccount as Record<string, unknown> | undefined;
      invertBalanceRaw = monarchAccountData?.newlyCreated === true;
      // Save for future syncs
      accountService.updateAccountInList(INTEGRATIONS.ROGERSBANK, rogersAccountId, { invertBalance: invertBalanceRaw });
      debugLog(`Migrated invertBalance setting: ${invertBalanceRaw} (derived from newlyCreated)`);
    }

    const invertBalance: boolean = invertBalanceRaw === true;

    if (invertBalance) {
      debugLog('Inverting balance (invertBalance setting enabled)');
    }

    if (firstSync && reconstructBalance) {
      progressDialog.updateStepStatus(rogersAccountId, 'balance', 'processing', 'Reconstructing...');

      // Normalize Rogers transactions for balance reconstruction
      // Rogers API returns: { date: "2024-01-19", amount: { value: "10.99" } }
      // Reconstruction expects: { date: "2024-01-19", amount: 10.99 }
      const normalizedTx = allApprovedTx.map(normalizeRogersTransaction);
      debugLog(`Normalized ${normalizedTx.length} transactions for balance reconstruction`);

      // Always apply balance correction during reconstruction to ensure today's balance matches actual
      // When history is complete, the correction factor will be 0 (or negligible)
      // When history is truncated (>1000 transactions), the correction adjusts for missing older transactions
      const balanceHistory = reconstructBalanceFromTransactions(
        normalizedTx,
        fromDate,
        todayFormatted,
        currentBalance,
        invertBalance,
        true, // applyCorrection: always true during reconstruction
      );

      if (balanceHistory.length > 0) {
        const balanceCSV = generateBalanceHistoryCSV(balanceHistory, rogersAccountName);
        progressDialog.updateStepStatus(rogersAccountId, 'balance', 'processing', 'Uploading...');
        balanceUploadSuccess = await monarchApi.uploadBalance(monarchAccount.id, balanceCSV, fromDate, todayFormatted);

        if (balanceUploadSuccess) {
          // Save lastUploadDate immediately after balance upload so balance change works on next sync
          saveLastUploadDate(rogersAccountId, todayFormatted, 'rogersbank');
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
      const balanceCSV = generateBalanceCSV(currentBalance, rogersAccountName, invertBalance);
      balanceUploadSuccess = await monarchApi.uploadBalance(monarchAccount.id, balanceCSV, todayFormatted, todayFormatted);

      if (balanceUploadSuccess) {
        const formatted = `$${Math.abs(currentBalance).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
        progressDialog.updateStepStatus(rogersAccountId, 'balance', 'success', formatted);

        // Extract and display balance change BEFORE updating checkpoint
        const balanceChange = extractRogersBankBalanceChange(rogersAccountId, currentBalance);
        if (balanceChange) {
          progressDialog.updateBalanceChange(rogersAccountId, balanceChange);
        } else {
          progressDialog.updateBalanceChange(rogersAccountId, { newBalance: currentBalance });
        }

        // Save lastUploadDate and update checkpoint after displaying change
        saveLastUploadDate(rogersAccountId, todayFormatted, 'rogersbank');
        getOrStoreBalanceCheckpoint(rogersAccountId, { date: todayFormatted, amount: currentBalance });
      } else {
        progressDialog.updateStepStatus(rogersAccountId, 'balance', 'error', 'Upload failed');
      }
    }

    // Increment sync count and cleanup legacy storage if ready
    const newSyncCount = accountService.incrementSyncCount(INTEGRATIONS.ROGERSBANK, rogersAccountId);
    debugLog(`Rogers Bank sync count for ${rogersAccountId}: ${newSyncCount}`);
    if (accountService.isReadyForLegacyCleanup(INTEGRATIONS.ROGERSBANK, rogersAccountId)) {
      const cleanupResult = accountService.cleanupLegacyStorage(INTEGRATIONS.ROGERSBANK, rogersAccountId);
      if (cleanupResult.cleaned && cleanupResult.keysDeleted > 0) {
        debugLog(`Cleaned up ${cleanupResult.keysDeleted} legacy storage keys for Rogers Bank account ${rogersAccountId}`);
      }
    }

    // Build summary message
    const summaryParts = [];
    if (totalNewSettled > 0 || totalNewPending > 0) {
      const txParts = [];
      if (totalNewSettled > 0) txParts.push(`${totalNewSettled} settled`);
      if (totalNewPending > 0) txParts.push(`${totalNewPending} pending`);
      summaryParts.push(`${txParts.join(', ')} uploaded`);
    }
    if (totalDuplicates > 0) summaryParts.push(`${totalDuplicates} skipped`);
    const summaryMsg = summaryParts.length > 0 ? summaryParts.join(', ') : 'Balance uploaded';

    progressDialog.hideCancel();
    progressDialog.showSummary({ success: 1, failed: 0, total: 1 });
    if (transactionUploadSuccess) {
      toast.show(`${summaryMsg} to Monarch!`, 'info');
    }
    return { success: true, message: summaryMsg };
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

