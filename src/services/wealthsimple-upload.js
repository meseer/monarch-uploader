/**
 * Wealthsimple Upload Service
 * Handles uploading Wealthsimple account data to Monarch
 */

import { debugLog, getDefaultLookbackDays } from '../core/utils';
import { STORAGE } from '../core/config';
import toast from '../ui/toast';
import wealthsimpleApi from '../api/wealthsimple';
import {
  resolveWealthsimpleAccountMapping,
  uploadWealthsimpleBalance,
  uploadWealthsimpleTransactions,
  markAccountAsSkipped,
  syncAccountListWithAPI,
  getAccountData,
  applyTransactionRetentionEviction,
  syncCreditLimit,
} from './wealthsimple/account';
import {
  getDefaultDateRange,
  extractDateFromISO,
  accountNeedsBalanceReconstruction,
  calculateCheckpointDate,
  getBalanceAtDate,
  reconstructBalanceFromTransactions,
} from './wealthsimple/balance';
import { fetchAndProcessTransactions, reconcilePendingTransactions, formatReconciliationMessage } from './wealthsimple/transactions';
import { showDatePickerWithOptionsPromise } from '../ui/components/datePicker';
import { showProgressDialog } from '../ui/components/progressDialog';

/**
 * Create a balance checkpoint after first sync with reconstruction
 * The checkpoint date is set to toDate - lookbackDays so it aligns with the next sync's transaction fetch window
 *
 * @param {string} accountId - Wealthsimple account ID
 * @param {string} fromDate - Start date of the sync (YYYY-MM-DD)
 * @param {string} toDate - End date of the sync (YYYY-MM-DD)
 * @returns {Promise<boolean>} Success status
 */
async function createBalanceCheckpoint(accountId, fromDate, toDate) {
  try {
    const accountData = getAccountData(accountId);
    if (!accountData) {
      debugLog(`Cannot create checkpoint: account ${accountId} not found`);
      return false;
    }

    const account = accountData.wealthsimpleAccount;
    const lookbackDays = GM_getValue(STORAGE.WEALTHSIMPLE_LOOKBACK_DAYS, getDefaultLookbackDays('wealthsimple'));

    // Calculate checkpoint date: toDate - lookbackDays
    const checkpointDate = calculateCheckpointDate(toDate, lookbackDays, account.createdAt);

    if (!checkpointDate) {
      debugLog('Failed to calculate checkpoint date');
      return false;
    }

    // Fetch transactions from fromDate to toDate to calculate checkpoint balance
    const transactions = await fetchAndProcessTransactions(accountData, fromDate, toDate);

    // Reconstruct balance history to get the balance at checkpoint date
    const balanceHistory = reconstructBalanceFromTransactions(transactions || [], fromDate, toDate, 0);

    // Get the balance at checkpoint date
    const checkpointBalance = getBalanceAtDate(balanceHistory, checkpointDate);

    if (checkpointBalance === null) {
      debugLog(`Could not find balance at checkpoint date ${checkpointDate}`);
      return false;
    }

    // Store the checkpoint
    const { updateAccountInList } = await import('./wealthsimple/account');
    updateAccountInList(accountId, {
      balanceCheckpoint: {
        date: checkpointDate,
        amount: checkpointBalance,
      },
    });

    debugLog(`Created balance checkpoint for account ${accountId}: ${checkpointDate} = ${checkpointBalance}`);
    return true;
  } catch (error) {
    debugLog('Error creating balance checkpoint:', error);
    return false;
  }
}

/**
 * Update balance checkpoint after subsequent sync
 * The new checkpoint is set to toDate - lookbackDays for the next sync
 *
 * @param {string} accountId - Wealthsimple account ID
 * @param {string} toDate - End date of the sync (YYYY-MM-DD)
 * @param {Object} currentBalance - Current balance object {amount, currency}
 * @returns {Promise<boolean>} Success status
 */
async function updateBalanceCheckpoint(accountId, toDate, _currentBalance) {
  try {
    const accountData = getAccountData(accountId);
    if (!accountData) {
      debugLog(`Cannot update checkpoint: account ${accountId} not found`);
      return false;
    }

    const account = accountData.wealthsimpleAccount;
    const existingCheckpoint = accountData.balanceCheckpoint;

    if (!existingCheckpoint) {
      debugLog(`No existing checkpoint for account ${accountId}, cannot update`);
      return false;
    }

    const lookbackDays = GM_getValue(STORAGE.WEALTHSIMPLE_LOOKBACK_DAYS, getDefaultLookbackDays('wealthsimple'));

    // Calculate new checkpoint date: toDate - lookbackDays
    const newCheckpointDate = calculateCheckpointDate(toDate, lookbackDays, account.createdAt);

    if (!newCheckpointDate) {
      debugLog('Failed to calculate new checkpoint date');
      return false;
    }

    // Fetch transactions from existing checkpoint date to today
    const transactions = await fetchAndProcessTransactions(accountData, existingCheckpoint.date, toDate);

    // Reconstruct balance history from existing checkpoint
    const balanceHistory = reconstructBalanceFromTransactions(
      transactions || [],
      existingCheckpoint.date,
      toDate,
      existingCheckpoint.amount,
    );

    // Get the balance at new checkpoint date
    let newCheckpointBalance = getBalanceAtDate(balanceHistory, newCheckpointDate);

    // If we couldn't calculate, use reconstructed value or fallback
    if (newCheckpointBalance === null) {
      debugLog(`Could not find balance at new checkpoint date ${newCheckpointDate}, using last reconstructed value`);
      // Try to find the closest available date
      if (balanceHistory && balanceHistory.length > 0) {
        const closestEntry = balanceHistory.find((entry) => entry.date <= newCheckpointDate);
        if (closestEntry) {
          newCheckpointBalance = closestEntry.amount;
        }
      }
    }

    if (newCheckpointBalance === null) {
      debugLog('Failed to determine new checkpoint balance');
      return false;
    }

    // Store the updated checkpoint
    const { updateAccountInList } = await import('./wealthsimple/account');
    updateAccountInList(accountId, {
      balanceCheckpoint: {
        date: newCheckpointDate,
        amount: newCheckpointBalance,
      },
    });

    debugLog(`Updated balance checkpoint for account ${accountId}: ${newCheckpointDate} = ${newCheckpointBalance}`);
    return true;
  } catch (error) {
    debugLog('Error updating balance checkpoint:', error);
    return false;
  }
}

/**
 * Check if this is the first sync for an account that needs balance reconstruction
 * These are accounts where the FetchIdentityHistoricalFinancials API doesn't work
 * (credit cards and cash accounts)
 * @param {Object} consolidatedAccount - Consolidated account object
 * @returns {boolean} True if first sync for non-investment account
 */
function isFirstSyncNonInvestment(consolidatedAccount) {
  const account = consolidatedAccount.wealthsimpleAccount;
  const accountType = account?.type || '';

  // Only apply to accounts that need balance reconstruction
  if (!accountNeedsBalanceReconstruction(accountType)) {
    return false;
  }

  // First sync if no lastSyncDate and no uploaded transactions
  const hasLastSyncDate = Boolean(consolidatedAccount.lastSyncDate);
  const hasUploadedTransactions = consolidatedAccount.uploadedTransactions && consolidatedAccount.uploadedTransactions.length > 0;

  return !hasLastSyncDate && !hasUploadedTransactions;
}

/**
 * Upload a single Wealthsimple account to Monarch
 * @param {Object} consolidatedAccount - Consolidated account object with wealthsimpleAccount property
 * @param {string} fromDate - Start date (YYYY-MM-DD)
 * @param {string} toDate - End date (YYYY-MM-DD)
 * @param {Object|null} currentBalance - Current balance object {amount, currency}
 * @returns {Promise<Object>} Result object with success status and optional signals
 */
export async function uploadWealthsimpleAccountToMonarch(consolidatedAccount, fromDate, toDate, currentBalance = null) {
  try {
    const account = consolidatedAccount.wealthsimpleAccount;
    debugLog(`Uploading Wealthsimple account ${account.id} to Monarch...`);

    // Resolve account mapping (shows selector with create option)
    const result = await resolveWealthsimpleAccountMapping(consolidatedAccount, currentBalance);

    // Handle skip signal
    if (result && result.skipped) {
      debugLog(`User skipped account ${account.id}`);
      markAccountAsSkipped(account.id, true);
      toast.show(`Skipped ${account.nickname || account.id}`, 'debug');
      return { success: false, skipped: true };
    }

    // Handle cancel signal
    if (result && result.cancelled) {
      debugLog('User cancelled sync');
      return { success: false, cancelled: true };
    }

    // Handle null (user closed without action)
    if (!result) {
      debugLog('Account mapping cancelled by user');
      return { success: false, cancelled: true };
    }

    const monarchAccount = result;

    // Determine the actual from date and whether to reconstruct balance
    let actualFromDate = fromDate;
    let reconstructBalance = false;

    // For first sync of non-investment accounts (credit cards, cash), show date picker with reconstruction option
    if (isFirstSyncNonInvestment(consolidatedAccount)) {
      debugLog('First sync for non-investment account detected, showing date picker with reconstruction option');

      // Get account creation date as default
      const accountCreatedAt = account.createdAt;
      let defaultDate = fromDate; // Fallback to provided fromDate

      if (accountCreatedAt) {
        const createdDateStr = extractDateFromISO(accountCreatedAt);
        if (createdDateStr) {
          defaultDate = createdDateStr;
          debugLog(`Using account creation date as default: ${defaultDate} (from ${accountCreatedAt})`);
        }
      }

      // Show date picker with reconstruction checkbox
      const datePickerResult = await showDatePickerWithOptionsPromise(
        defaultDate,
        `Select the start date for syncing "${account.nickname || account.id}". Default is the account creation date.`,
        {
          showReconstructCheckbox: true,
          reconstructCheckedByDefault: true,
        },
      );

      if (!datePickerResult) {
        debugLog('User cancelled date selection');
        toast.show('Sync cancelled', 'debug');
        return { success: false, cancelled: true };
      }

      actualFromDate = datePickerResult.date;
      reconstructBalance = datePickerResult.reconstructBalance;
      debugLog(`User selected start date: ${actualFromDate}, reconstruct balance: ${reconstructBalance}`);
    }

    // Upload balance with current balance and reconstruction flag
    const balanceSuccess = await uploadWealthsimpleBalance(
      account.id,
      monarchAccount.id,
      actualFromDate,
      toDate,
      currentBalance,
      reconstructBalance,
    );

    // Upload transactions
    const transactionsSuccess = await uploadWealthsimpleTransactions(
      account.id,
      monarchAccount.id,
      actualFromDate,
      toDate,
    );

    const success = balanceSuccess || transactionsSuccess;

    if (success) {
      // Only update lastSyncDate if BOTH balance and transactions were successful
      // This ensures first sync detection works properly for transactions
      if (balanceSuccess && transactionsSuccess) {
        // Update lastSyncDate in consolidated account data
        const { updateAccountInList } = await import('./wealthsimple/account');
        updateAccountInList(account.id, { lastSyncDate: toDate });

        debugLog(`Updated lastSyncDate for account ${account.id} to ${toDate}`);

        // Create balance checkpoint for accounts that need balance reconstruction
        // This enables ongoing balance reconstruction for subsequent syncs
        if (accountNeedsBalanceReconstruction(account.type) && reconstructBalance) {
          // For first sync with reconstruction, calculate and store the checkpoint
          await createBalanceCheckpoint(account.id, actualFromDate, toDate);
        } else if (accountNeedsBalanceReconstruction(account.type) && consolidatedAccount.balanceCheckpoint) {
          // For subsequent syncs with existing checkpoint, update the checkpoint
          await updateBalanceCheckpoint(account.id, toDate, currentBalance);
        }
      }

      // Sync credit limit for credit card accounts
      // This runs after balance/transaction sync to ensure account mapping is established
      // Re-fetch the consolidated account to get the latest data
      const updatedConsolidatedAccount = getAccountData(account.id);
      if (updatedConsolidatedAccount) {
        await syncCreditLimit(updatedConsolidatedAccount, monarchAccount.id);
      }

      // Apply time-based eviction to clean up old transaction IDs
      // This is performed after each successful account sync
      applyTransactionRetentionEviction(account.id);

      toast.show(`Processed ${account.nickname || account.id}`, 'debug');
    }

    return success;
  } catch (error) {
    const account = consolidatedAccount.wealthsimpleAccount;
    debugLog(`Error uploading Wealthsimple account ${account.id}:`, error);
    toast.show(`Error uploading account: ${error.message}`, 'error');
    return false;
  }
}

/**
 * Build the list of sync steps for a Wealthsimple account
 * Steps are dynamically determined based on account type
 * Order is important: transaction sync and reconciliation happen before balance upload
 * because deleting pending transactions may implicitly adjust the balance in Monarch
 * @param {Object} consolidatedAccount - Consolidated account object
 * @returns {Array} Array of step definitions [{key, name}]
 */
function buildSyncStepsForAccount(consolidatedAccount) {
  const steps = [];
  const accountType = consolidatedAccount.wealthsimpleAccount?.type || '';

  // Account types that support transaction sync
  // Note: Using WEALTHSIMPLE_TRANSACTION_SUPPORTED_TYPES from config
  const transactionSupportedTypes = ['CREDIT_CARD', 'PORTFOLIO_LINE_OF_CREDIT', 'CASH', 'CASH_USD'];
  if (transactionSupportedTypes.includes(accountType)) {
    steps.push({ key: 'transactions', name: 'Transaction sync' });
  }

  // Pending transaction reconciliation for credit card and CASH accounts
  // Deleting cancelled transactions may adjust balance in Monarch
  const pendingReconciliationTypes = ['CREDIT_CARD', 'CASH', 'CASH_USD'];
  if (pendingReconciliationTypes.includes(accountType)) {
    steps.push({ key: 'pendingReconciliation', name: 'Pending reconciliation' });
  }

  // Credit limit sync only for credit card accounts
  if (accountType === 'CREDIT_CARD') {
    steps.push({ key: 'creditLimit', name: 'Credit limit sync' });
  }

  // Balance upload is always a step (last, to capture any adjustments from reconciliation)
  steps.push({ key: 'balance', name: 'Balance upload' });

  // TODO: Add position sync step when implemented for investment accounts
  // if (isInvestmentAccount(accountType)) {
  //   steps.push({ key: 'positions', name: 'Position sync' });
  // }

  return steps;
}

/**
 * Upload all Wealthsimple accounts to Monarch
 * Uses progress dialog to show per-account status and summary with step-by-step tracking
 * @returns {Promise<void>}
 */
export async function uploadAllWealthsimpleAccountsToMonarch() {
  let progressDialog = null;
  let isCancelled = false;

  try {
    debugLog('Starting fetch of all Wealthsimple accounts...');

    // Sync account list with API (merges with cached settings like skip flags)
    const accounts = await syncAccountListWithAPI();

    if (!accounts || accounts.length === 0) {
      toast.show('No Wealthsimple accounts found', 'warning');
      return;
    }

    // Filter out disabled accounts
    const accountsToSync = accounts.filter((acc) => acc.syncEnabled !== false);
    const skippedCount = accounts.length - accountsToSync.length;

    if (skippedCount > 0) {
      debugLog(`Skipping ${skippedCount} account(s) marked as skipped`);
    }

    if (accountsToSync.length === 0) {
      toast.show('All accounts are marked as skipped', 'warning');
      return;
    }

    debugLog(`Processing ${accountsToSync.length} Wealthsimple account(s):`, accountsToSync);

    // Prepare accounts for progress dialog
    const accountsForDialog = accountsToSync.map((acc) => ({
      key: acc.wealthsimpleAccount.id,
      nickname: acc.wealthsimpleAccount.nickname,
      name: acc.wealthsimpleAccount.nickname || acc.wealthsimpleAccount.id,
    }));

    // Create progress dialog
    progressDialog = showProgressDialog(accountsForDialog, 'Uploading Wealthsimple Accounts to Monarch');

    // Set up cancel callback
    progressDialog.onCancel(() => {
      debugLog('Upload cancellation requested');
      isCancelled = true;
      toast.show('Upload cancelled by user', 'warning');
    });

    // Fetch all account balances upfront
    // Pass account objects with id, type, and currency for proper API selection
    const accountsForBalanceFetch = accountsToSync.map((acc) => ({
      id: acc.wealthsimpleAccount.id,
      type: acc.wealthsimpleAccount.type,
      currency: acc.wealthsimpleAccount.currency,
    }));
    debugLog('Fetching balances for all accounts...');
    const balanceResult = await wealthsimpleApi.fetchAccountBalances(accountsForBalanceFetch);

    if (!balanceResult.success) {
      debugLog('Failed to fetch account balances:', balanceResult.error);
      toast.show('Failed to fetch account balances. Please try again.', 'error');
      progressDialog.hideCancel();
      progressDialog.close();
      return;
    }

    // Initialize stats
    const stats = { success: 0, failed: 0, total: accountsToSync.length };
    let skippedDuringSync = 0;
    let balanceUnavailableCount = 0;

    // Process all non-skipped accounts
    for (const consolidatedAccount of accountsToSync) {
      // Check for cancellation before processing each account
      if (isCancelled) {
        debugLog('Upload cancelled, stopping account processing');
        break;
      }

      const account = consolidatedAccount.wealthsimpleAccount;

      // Initialize steps for this account
      const steps = buildSyncStepsForAccount(consolidatedAccount);
      progressDialog.initSteps(account.id, steps);

      // Get balance for this account
      const currentBalance = balanceResult.balances.get(account.id);

      // Skip if balance is unavailable
      if (currentBalance === null || currentBalance === undefined) {
        debugLog(`Skipping account ${account.id} (${account.nickname}) - balance unavailable`);
        progressDialog.updateStepStatus(account.id, 'balance', 'error', 'Balance unavailable');
        balanceUnavailableCount += 1;
        continue;
      }

      // Get date range for this account (respects account creation date and last sync)
      const { fromDate, toDate } = getDefaultDateRange(consolidatedAccount);
      debugLog(`Using date range for ${account.nickname}: ${fromDate} to ${toDate}`);

      // Check cancellation before upload
      if (isCancelled) break;

      // Process the account with step-by-step progress tracking
      const result = await uploadWealthsimpleAccountToMonarchWithSteps(
        consolidatedAccount,
        fromDate,
        toDate,
        currentBalance,
        progressDialog,
      );

      // Check if user cancelled the entire sync
      if (result && result.cancelled) {
        debugLog('Sync cancelled by user, stopping processing');
        isCancelled = true;
        break;
      }

      // Check if user skipped this account
      if (result && result.skipped) {
        skippedDuringSync += 1;
        continue;
      }

      // Check success
      if (result && result.success) {
        stats.success += 1;
      } else {
        stats.failed += 1;
      }
    }

    // Show final summary in progress dialog
    const totalSkipped = skippedCount + skippedDuringSync;
    const totalFailed = stats.failed + balanceUnavailableCount;
    progressDialog.showSummary({
      success: stats.success,
      failed: totalFailed,
      skipped: totalSkipped,
    });
    progressDialog.hideCancel();

    // Show final summary toast
    if (isCancelled) {
      toast.show('Upload process was cancelled', 'warning');
    } else if (totalFailed === 0 && totalSkipped === 0) {
      toast.show(`Successfully uploaded all ${stats.success} Wealthsimple account(s)`, 'info');
    } else if (stats.success > 0) {
      const parts = [];
      if (stats.success > 0) parts.push(`${stats.success} uploaded`);
      if (stats.failed > 0) parts.push(`${stats.failed} failed`);
      if (balanceUnavailableCount > 0) parts.push(`${balanceUnavailableCount} balance unavailable`);
      if (totalSkipped > 0) parts.push(`${totalSkipped} skipped`);
      toast.show(parts.join(', '), totalFailed > 0 ? 'warning' : 'info');
    }
  } catch (error) {
    debugLog('Error fetching Wealthsimple accounts:', error);
    toast.show(`Error fetching accounts: ${error.message}`, 'error');

    // Clean up progress dialog on error
    if (progressDialog) {
      progressDialog.hideCancel();
    }
  }
}

/**
 * Upload a single Wealthsimple account to Monarch with step-by-step progress tracking
 * @param {Object} consolidatedAccount - Consolidated account object
 * @param {string} fromDate - Start date (YYYY-MM-DD)
 * @param {string} toDate - End date (YYYY-MM-DD)
 * @param {Object} currentBalance - Current balance object {amount, currency}
 * @param {Object} progressDialog - Progress dialog instance
 * @returns {Promise<Object>} Result object with success status
 */
async function uploadWealthsimpleAccountToMonarchWithSteps(consolidatedAccount, fromDate, toDate, currentBalance, progressDialog) {
  const account = consolidatedAccount.wealthsimpleAccount;
  const accountType = account?.type || '';

  try {
    debugLog(`Uploading Wealthsimple account ${account.id} to Monarch with step tracking...`);

    // Resolve account mapping first (shows selector with create option)
    const mappingResult = await resolveWealthsimpleAccountMapping(consolidatedAccount, currentBalance);

    // Account types that support transaction sync (same as buildSyncStepsForAccount)
    const transactionSupportedTypes = ['CREDIT_CARD', 'PORTFOLIO_LINE_OF_CREDIT', 'CASH', 'CASH_USD'];

    // Handle skip signal
    if (mappingResult && mappingResult.skipped) {
      debugLog(`User skipped account ${account.id}`);
      markAccountAsSkipped(account.id, true);
      // Update first visible step
      const firstStep = transactionSupportedTypes.includes(accountType) ? 'transactions' : 'balance';
      progressDialog.updateStepStatus(account.id, firstStep, 'skipped', 'Skipped by user');
      return { success: false, skipped: true };
    }

    // Handle cancel signal
    if (mappingResult && mappingResult.cancelled) {
      debugLog('User cancelled sync');
      const firstStep = transactionSupportedTypes.includes(accountType) ? 'transactions' : 'balance';
      progressDialog.updateStepStatus(account.id, firstStep, 'error', 'Cancelled');
      return { success: false, cancelled: true };
    }

    // Handle null (user closed without action)
    if (!mappingResult) {
      debugLog('Account mapping cancelled by user');
      const firstStep = transactionSupportedTypes.includes(accountType) ? 'transactions' : 'balance';
      progressDialog.updateStepStatus(account.id, firstStep, 'error', 'Cancelled');
      return { success: false, cancelled: true };
    }

    const monarchAccount = mappingResult;

    // Determine the actual from date and whether to reconstruct balance
    let actualFromDate = fromDate;
    let reconstructBalance = false;

    // For first sync of non-investment accounts, show date picker with reconstruction option
    if (isFirstSyncNonInvestment(consolidatedAccount)) {
      debugLog('First sync for non-investment account detected, showing date picker with reconstruction option');

      const accountCreatedAt = account.createdAt;
      let defaultDate = fromDate;

      if (accountCreatedAt) {
        const createdDateStr = extractDateFromISO(accountCreatedAt);
        if (createdDateStr) {
          defaultDate = createdDateStr;
        }
      }

      const datePickerResult = await showDatePickerWithOptionsPromise(
        defaultDate,
        `Select the start date for syncing "${account.nickname || account.id}". Default is the account creation date.`,
        {
          showReconstructCheckbox: true,
          reconstructCheckedByDefault: true,
        },
      );

      if (!datePickerResult) {
        debugLog('User cancelled date selection');
        const firstStep = transactionSupportedTypes.includes(accountType) ? 'transactions' : 'balance';
        progressDialog.updateStepStatus(account.id, firstStep, 'error', 'Date selection cancelled');
        return { success: false, cancelled: true };
      }

      actualFromDate = datePickerResult.date;
      reconstructBalance = datePickerResult.reconstructBalance;
    }

    // Step 1: Transaction sync (for supported account types)
    // Transactions are synced first so pending reconciliation can delete cancelled transactions
    // before balance upload captures any implicit balance adjustments
    let rawWealthsimpleTransactions = null; // Store for pending reconciliation

    if (transactionSupportedTypes.includes(accountType)) {
      progressDialog.updateStepStatus(account.id, 'transactions', 'processing', 'Syncing transactions');

      // Fetch raw transactions from Wealthsimple API ONCE
      // These are passed to both transaction sync (for early filtering) and pending reconciliation
      try {
        rawWealthsimpleTransactions = await wealthsimpleApi.fetchTransactions(account.id, actualFromDate);
        debugLog(`Fetched ${rawWealthsimpleTransactions?.length || 0} raw transactions for account ${account.id}`);
      } catch (fetchError) {
        debugLog('Error fetching raw transactions:', fetchError);
        rawWealthsimpleTransactions = [];
      }

      // Pass raw transactions to avoid duplicate fetch
      const transactionsResult = await uploadWealthsimpleTransactions(
        account.id,
        monarchAccount.id,
        actualFromDate,
        toDate,
        { rawTransactions: rawWealthsimpleTransactions },
      );

      if (transactionsResult && transactionsResult.success) {
        // Format transaction count message
        const txMessage = formatTransactionCountMessage(transactionsResult.synced, transactionsResult.skipped);
        progressDialog.updateStepStatus(account.id, 'transactions', 'success', txMessage);
      } else if (transactionsResult && transactionsResult.unsupported) {
        progressDialog.updateStepStatus(account.id, 'transactions', 'skipped', 'Not supported');
      } else {
        const errorMsg = transactionsResult?.error || 'Sync failed';
        progressDialog.updateStepStatus(account.id, 'transactions', 'error', errorMsg);
      }
    }

    // Step 2: Pending transaction reconciliation (for credit card and CASH accounts)
    // Deleting cancelled transactions may implicitly adjust the balance in Monarch
    const pendingReconciliationTypes = ['CREDIT_CARD', 'CASH', 'CASH_USD'];
    if (pendingReconciliationTypes.includes(accountType)) {
      progressDialog.updateStepStatus(account.id, 'pendingReconciliation', 'processing', 'Reconciling pending');

      try {
        // Get lookback days from settings
        const lookbackDays = GM_getValue(STORAGE.WEALTHSIMPLE_LOOKBACK_DAYS, getDefaultLookbackDays('wealthsimple'));

        // Run pending transaction reconciliation
        // Pass account type so reconciliation can handle different status fields
        const reconciliationResult = await reconcilePendingTransactions(
          monarchAccount.id,
          rawWealthsimpleTransactions || [],
          lookbackDays,
          accountType,
        );

        // Format and display the result
        const reconciliationMessage = formatReconciliationMessage(reconciliationResult);
        const reconciliationStatus = reconciliationResult.success ? 'success' : 'error';

        progressDialog.updateStepStatus(account.id, 'pendingReconciliation', reconciliationStatus, reconciliationMessage);
        debugLog(`Pending reconciliation completed for ${account.id}:`, reconciliationResult);
      } catch (reconciliationError) {
        debugLog('Error during pending transaction reconciliation:', reconciliationError);
        progressDialog.updateStepStatus(account.id, 'pendingReconciliation', 'error', reconciliationError.message);
      }
    }

    // Step 3: Credit limit sync (for credit cards only)
    if (accountType === 'CREDIT_CARD') {
      progressDialog.updateStepStatus(account.id, 'creditLimit', 'processing', 'Syncing credit limit');

      // Re-fetch the consolidated account to get the latest data
      const updatedConsolidatedAccount = getAccountData(account.id);
      if (updatedConsolidatedAccount) {
        const creditLimitSuccess = await syncCreditLimit(updatedConsolidatedAccount, monarchAccount.id);
        if (creditLimitSuccess) {
          // Get the synced credit limit for display
          const refreshedAccount = getAccountData(account.id);
          const creditLimit = refreshedAccount?.lastSyncedCreditLimit;
          const message = creditLimit ? `$${creditLimit.toLocaleString()}` : 'Synced';
          progressDialog.updateStepStatus(account.id, 'creditLimit', 'success', message);
        } else {
          progressDialog.updateStepStatus(account.id, 'creditLimit', 'error', 'Sync failed');
        }
      } else {
        progressDialog.updateStepStatus(account.id, 'creditLimit', 'skipped', 'Account data unavailable');
      }
    }

    // Step 4: Balance upload (last, to capture any implicit balance adjustments from transaction deletion)
    progressDialog.updateStepStatus(account.id, 'balance', 'processing', 'Uploading balance');

    const balanceSuccess = await uploadWealthsimpleBalance(
      account.id,
      monarchAccount.id,
      actualFromDate,
      toDate,
      currentBalance,
      reconstructBalance,
    );

    if (balanceSuccess) {
      // Calculate balance info for display
      const daysUploaded = calculateDaysBetween(actualFromDate, toDate);
      const balanceMessage = formatBalanceMessage(currentBalance?.amount, daysUploaded);
      progressDialog.updateStepStatus(account.id, 'balance', 'success', balanceMessage);

      // Update balance change display with current balance
      progressDialog.updateBalanceChange(account.id, {
        newBalance: currentBalance?.amount,
        daysUploaded,
      });
    } else {
      progressDialog.updateStepStatus(account.id, 'balance', 'error', 'Upload failed');
      return { success: false };
    }

    // Update lastSyncDate after successful sync
    if (balanceSuccess) {
      const { updateAccountInList } = await import('./wealthsimple/account');
      updateAccountInList(account.id, { lastSyncDate: toDate });
      debugLog(`Updated lastSyncDate for account ${account.id} to ${toDate}`);

      // Handle balance checkpoint for accounts that need reconstruction
      if (accountNeedsBalanceReconstruction(accountType) && reconstructBalance) {
        await createBalanceCheckpoint(account.id, actualFromDate, toDate);
      } else if (accountNeedsBalanceReconstruction(accountType) && consolidatedAccount.balanceCheckpoint) {
        await updateBalanceCheckpoint(account.id, toDate, currentBalance);
      }

      // Apply time-based eviction
      applyTransactionRetentionEviction(account.id);
    }

    return { success: true };
  } catch (error) {
    debugLog(`Error uploading Wealthsimple account ${account.id}:`, error);
    const errorSupportedTypes = ['CREDIT_CARD', 'PORTFOLIO_LINE_OF_CREDIT', 'CASH', 'CASH_USD'];
    const firstStep = errorSupportedTypes.includes(accountType) ? 'transactions' : 'balance';
    progressDialog.updateStepStatus(account.id, firstStep, 'error', error.message);
    return { success: false };
  }
}

/**
 * Calculate number of days between two dates
 * @param {string} fromDate - Start date (YYYY-MM-DD)
 * @param {string} toDate - End date (YYYY-MM-DD)
 * @returns {number} Number of days
 */
function calculateDaysBetween(fromDate, toDate) {
  const from = new Date(fromDate);
  const to = new Date(toDate);
  const diffTime = Math.abs(to - from);
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // +1 to include both start and end dates
}

/**
 * Format transaction count message for display in step status
 * @param {number} synced - Number of transactions synced
 * @param {number} skipped - Number of transactions skipped (duplicates)
 * @returns {string} Formatted message
 */
function formatTransactionCountMessage(synced, skipped) {
  const parts = [];

  if (synced > 0) {
    parts.push(`${synced} synced`);
  }

  if (skipped > 0) {
    parts.push(`${skipped} skipped`);
  }

  if (parts.length === 0) {
    return 'No transactions';
  }

  return parts.join(', ');
}

/**
 * Format balance message for display in step status
 * @param {number} balance - Current balance amount
 * @param {number} daysUploaded - Number of days uploaded
 * @returns {string} Formatted message
 */
function formatBalanceMessage(balance, daysUploaded) {
  const parts = [];

  if (balance !== undefined && balance !== null) {
    const formattedBalance = `$${Math.abs(balance).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    parts.push(formattedBalance);
  }

  if (daysUploaded && daysUploaded > 1) {
    parts.push(`${daysUploaded} days`);
  }

  return parts.length > 0 ? parts.join(' | ') : 'Uploaded';
}

/**
 * Get the last upload date for an account
 * @param {string} accountId - Account ID
 * @returns {string|null} Last upload date or null
 */
export function getLastUploadDate(accountId) {
  const accountData = getAccountData(accountId);
  return accountData?.lastSyncDate || null;
}

/**
 * Clear last upload date for an account
 * @param {string} accountId - Account ID
 */
export function clearLastUploadDate(accountId) {
  const { updateAccountInList } = require('./wealthsimple/account');
  updateAccountInList(accountId, { lastSyncDate: null });
}

export default {
  uploadWealthsimpleAccountToMonarch,
  uploadAllWealthsimpleAccountsToMonarch,
  getLastUploadDate,
  clearLastUploadDate,
};
