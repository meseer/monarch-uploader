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
import { fetchAndProcessTransactions } from './wealthsimple/transactions';
import { showDatePickerWithOptionsPromise } from '../ui/components/datePicker';

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
      toast.show(`Skipped ${account.nickname || account.id}`, 'info');
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
        toast.show('Sync cancelled', 'info');
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

      toast.show(`Processed ${account.nickname || account.id}`, 'info');
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
 * Upload all Wealthsimple accounts to Monarch
 * @returns {Promise<void>}
 */
export async function uploadAllWealthsimpleAccountsToMonarch() {
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

    // Fetch all account balances upfront
    const accountIds = accountsToSync.map((acc) => acc.wealthsimpleAccount.id);
    debugLog('Fetching balances for all accounts...');
    const balanceResult = await wealthsimpleApi.fetchAccountBalances(accountIds);

    if (!balanceResult.success) {
      debugLog('Failed to fetch account balances:', balanceResult.error);
      toast.show('Failed to fetch account balances. Please try again.', 'error');
      return;
    }

    // Process all non-skipped accounts
    let successCount = 0;
    let failureCount = 0;
    let skippedDuringSync = 0;
    let balanceUnavailableCount = 0;

    for (const consolidatedAccount of accountsToSync) {
      const account = consolidatedAccount.wealthsimpleAccount;

      // Get balance for this account
      const currentBalance = balanceResult.balances.get(account.id);

      // Skip if balance is unavailable
      if (currentBalance === null || currentBalance === undefined) {
        debugLog(`Skipping account ${account.id} (${account.nickname}) - balance unavailable`);
        balanceUnavailableCount += 1;
        continue;
      }

      // Get date range for this account (respects account creation date and last sync)
      const { fromDate, toDate } = getDefaultDateRange(consolidatedAccount);
      debugLog(`Using date range for ${account.nickname}: ${fromDate} to ${toDate}`);

      const result = await uploadWealthsimpleAccountToMonarch(consolidatedAccount, fromDate, toDate, currentBalance);

      // Check if user cancelled the entire sync
      if (result && result.cancelled) {
        debugLog('Sync cancelled by user, stopping processing');
        toast.show('Sync cancelled', 'warning');
        break;
      }

      // Check if user skipped this account
      if (result && result.skipped) {
        skippedDuringSync += 1;
        continue;
      }

      // Check success
      if (result && result.success !== false) {
        successCount += 1;
      } else {
        failureCount += 1;
      }
    }

    // Show final summary
    const totalSkipped = skippedCount + skippedDuringSync;
    if (failureCount === 0 && totalSkipped === 0 && balanceUnavailableCount === 0) {
      toast.show(`Successfully uploaded all ${successCount} Wealthsimple account(s)`, 'info');
    } else {
      const parts = [];
      if (successCount > 0) parts.push(`${successCount} uploaded`);
      if (failureCount > 0) parts.push(`${failureCount} failed`);
      if (balanceUnavailableCount > 0) parts.push(`${balanceUnavailableCount} failed (balance unavailable)`);
      if (totalSkipped > 0) parts.push(`${totalSkipped} skipped`);
      toast.show(parts.join(', '), failureCount > 0 || balanceUnavailableCount > 0 ? 'warning' : 'info');
    }
  } catch (error) {
    debugLog('Error fetching Wealthsimple accounts:', error);
    toast.show(`Error fetching accounts: ${error.message}`, 'error');
  }
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
