/**
 * Sync Orchestrator Service
 * Coordinates synchronization of balances, positions, and (future) transactions
 * between Questrade and Monarch
 */

import { debugLog, getTodayLocal, formatDate, calculateFromDateWithLookback } from '../../core/utils';
import { INTEGRATIONS } from '../../core/integrationCapabilities';
import stateManager from '../../core/state';
import accountService from '../common/accountService';
import balanceService, { fetchBalanceHistory, extractBalanceChange, getAccountsForSync, markAccountAsClosed } from './balance';
import positionsService from './positions';
import transactionsService from './transactions';
import toast from '../../ui/toast';
import { showProgressDialog } from '../../ui/components/progressDialog';
import { ensureMonarchAuthentication } from '../../ui/components/monarchLoginLink';
import { ensureAllAccountMappings as ensureQuestradeAccountMappings } from './accountMapping';

/**
 * Build the list of sync steps for a Questrade account
 * @returns {Array} Array of step definitions [{key, name}]
 */
function buildQuestradeSteps() {
  return [
    { key: 'balance', name: 'Balance history' },
    { key: 'positions', name: 'Positions sync' },
    { key: 'orders', name: 'Orders (trades)' },
    { key: 'activity', name: 'Activity (contributions, dividends etc.)' },
  ];
}

/**
 * Sync a single account to Monarch (balance + positions + transactions)
 * @param {string} accountId - Questrade account ID
 * @param {string} accountName - Account name for display
 * @param {string} fromDate - Start date for balance history
 * @param {string} toDate - End date for balance history
 * @param {Object} progressDialog - Optional progress dialog
 * @returns {Promise<boolean>} Success status
 */
async function syncAccountToMonarch(accountId, accountName, fromDate, toDate, progressDialog = null) {
  try {
    debugLog(`Starting sync for account ${accountName} (${accountId})`);

    // Set current account in state
    stateManager.setAccount(accountId, accountName);

    // Initialize steps if progress dialog is available
    if (progressDialog) {
      progressDialog.initSteps(accountId, buildQuestradeSteps());
    }

    // Step 1: Sync balance history
    if (progressDialog) {
      progressDialog.updateStepStatus(accountId, 'balance', 'processing', 'Fetching balance...');
    }

    // Fetch balance data for both upload and change extraction
    const balanceData = await fetchBalanceHistory(accountId, fromDate, toDate);
    if (!balanceData) {
      if (progressDialog) {
        progressDialog.updateStepStatus(accountId, 'balance', 'error', 'Fetch failed');
      }
      throw new Error('Failed to fetch balance history');
    }

    // Extract and display balance change BEFORE uploading (uses previous lastUploadDate)
    if (progressDialog) {
      const balanceChange = extractBalanceChange(accountId, balanceData);
      if (balanceChange) {
        // Add accountType for collapsed summary display
        progressDialog.updateBalanceChange(accountId, {
          ...balanceChange,
          accountType: 'investment',
        });
      }
    }

    if (progressDialog) {
      progressDialog.updateStepStatus(accountId, 'balance', 'processing', 'Uploading balance');
    }

    const balanceSuccess = await balanceService.processAndUploadBalance(
      accountId,
      accountName,
      fromDate,
      toDate,
    );

    if (!balanceSuccess) {
      if (progressDialog) {
        progressDialog.updateStepStatus(accountId, 'balance', 'error', 'Upload failed');
      }
      throw new Error('Balance sync failed');
    }

    // Calculate days for display
    const daysUploaded = calculateDaysBetween(fromDate, toDate);
    const balanceMessage = daysUploaded > 1 ? `${daysUploaded} days` : 'Uploaded';
    if (progressDialog) {
      progressDialog.updateStepStatus(accountId, 'balance', 'success', balanceMessage);
    }

    // Step 2: Sync positions (gracefully handle failures)
    if (progressDialog) {
      progressDialog.updateStepStatus(accountId, 'positions', 'processing', 'Syncing positions');
    }

    try {
      // Get Monarch account mapping from consolidated storage
      const monarchAccount = accountService.getMonarchAccountMapping(INTEGRATIONS.QUESTRADE, accountId);

      if (!monarchAccount || !monarchAccount.id) {
        debugLog(`No Monarch account mapping for ${accountId}, skipping positions sync`);
        if (progressDialog) {
          progressDialog.updateStepStatus(accountId, 'positions', 'skipped', 'No account mapping');
        }
      } else {
        // Process positions
        const positionsResult = await positionsService.processAccountPositions(
          accountId,
          accountName,
          monarchAccount.id as string,
          progressDialog,
        );

        if (positionsResult.success) {
          const positionsMessage = `${positionsResult.positionsProcessed} synced`;
          if (progressDialog) {
            progressDialog.updateStepStatus(accountId, 'positions', 'success', positionsMessage);
          }
          debugLog(`Positions sync completed: ${positionsResult.positionsProcessed} processed, ${positionsResult.positionsSkipped} skipped`);
        } else {
          if (progressDialog) {
            progressDialog.updateStepStatus(accountId, 'positions', 'error', (positionsResult.error as string) || 'Sync failed');
          }
          debugLog(`Positions sync had errors: ${positionsResult.error}`);
        }
      }
    } catch (positionsError) {
      debugLog('Error syncing positions (non-fatal):', positionsError);
      if (progressDialog) {
        progressDialog.updateStepStatus(accountId, 'positions', 'error', positionsError.message);
      }
    }

    // Get Monarch account mapping for transaction uploads
    const monarchAccountForTx = accountService.getMonarchAccountMapping(INTEGRATIONS.QUESTRADE, accountId);

    // Step 3: Sync orders (trades) - gracefully handle failures
    if (progressDialog) {
      progressDialog.updateStepStatus(accountId, 'orders', 'processing', 'Syncing orders...');
    }

    try {
      if (!monarchAccountForTx || !monarchAccountForTx.id) {
        debugLog(`No Monarch account mapping for ${accountId}, skipping orders sync`);
        if (progressDialog) {
          progressDialog.updateStepStatus(accountId, 'orders', 'skipped', 'No account mapping');
        }
      } else {
        const ordersResult = await transactionsService.processAndUploadOrders(
          accountId,
          accountName,
          fromDate,
          monarchAccountForTx.id,
          null, // Don't pass progressDialog to avoid double-updates
        );

        if (ordersResult.success) {
          const ordersCount = ordersResult.ordersProcessed || 0;
          let ordersMessage;
          if (ordersCount === 0) {
            ordersMessage = ordersResult.skippedDuplicates > 0
              ? `No new (${ordersResult.skippedDuplicates} skipped)`
              : 'No orders found';
          } else {
            ordersMessage = ordersResult.skippedDuplicates > 0
              ? `${ordersCount} uploaded (${ordersResult.skippedDuplicates} skipped)`
              : `${ordersCount} uploaded`;
          }

          if (progressDialog) {
            progressDialog.updateStepStatus(accountId, 'orders', 'success', ordersMessage);
          }
          debugLog(`Orders sync completed: ${ordersCount} processed, ${ordersResult.skippedDuplicates || 0} skipped`);
        } else {
          if (progressDialog) {
            progressDialog.updateStepStatus(accountId, 'orders', 'error', ordersResult.message || 'Sync failed');
          }
        }
      }
    } catch (ordersError) {
      debugLog('Error syncing orders (non-fatal):', ordersError);
      if (progressDialog) {
        progressDialog.updateStepStatus(accountId, 'orders', 'error', ordersError.message);
      }
    }

    // Step 4: Sync activity (contributions, dividends, fees, etc.) - gracefully handle failures
    if (progressDialog) {
      progressDialog.updateStepStatus(accountId, 'activity', 'processing', 'Syncing activity...');
    }

    try {
      if (!monarchAccountForTx || !monarchAccountForTx.id) {
        debugLog(`No Monarch account mapping for ${accountId}, skipping activity sync`);
        if (progressDialog) {
          progressDialog.updateStepStatus(accountId, 'activity', 'skipped', 'No account mapping');
        }
      } else {
        const activityResult = await transactionsService.processAndUploadActivityTransactions(
          accountId,
          accountName,
          fromDate,
          monarchAccountForTx.id,
          null, // Don't pass progressDialog to avoid double-updates
        );

        if (activityResult.success) {
          const activityCount = activityResult.transactionsProcessed || 0;
          let activityMessage;
          if (activityCount === 0) {
            activityMessage = activityResult.skippedDuplicates > 0
              ? `No new (${activityResult.skippedDuplicates} skipped)`
              : 'No activity found';
          } else {
            activityMessage = activityResult.skippedDuplicates > 0
              ? `${activityCount} uploaded (${activityResult.skippedDuplicates} skipped)`
              : `${activityCount} uploaded`;
          }

          if (progressDialog) {
            progressDialog.updateStepStatus(accountId, 'activity', 'success', activityMessage);
          }
          debugLog(`Activity sync completed: ${activityCount} processed, ${activityResult.skippedDuplicates || 0} skipped`);
        } else {
          if (progressDialog) {
            progressDialog.updateStepStatus(accountId, 'activity', 'error', activityResult.message || 'Sync failed');
          }
        }
      }
    } catch (activityError) {
      debugLog('Error syncing activity (non-fatal):', activityError);
      if (progressDialog) {
        progressDialog.updateStepStatus(accountId, 'activity', 'error', activityError.message);
      }
    }

    return true;
  } catch (error) {
    debugLog(`Error syncing account ${accountId}:`, error);
    throw error;
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
  const diffTime = Math.abs(to.getTime() - from.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
}

// Use the shared account mapping module
const ensureAllAccountMappings = ensureQuestradeAccountMappings;

/**
 * Sync all Questrade accounts to Monarch
 * Based on uploadAllAccountsToMonarch but extended for full sync
 * Includes closed accounts (pending_close) for final sync before marking them closed
 * @returns {Promise<void>}
 */
export async function syncAllAccountsToMonarch() {
  try {
    // Check Monarch authentication before proceeding
    const authenticated = await ensureMonarchAuthentication(null, 'sync all Questrade accounts');
    if (!authenticated) {
      return; // User cancelled authentication
    }

    // Get all Questrade accounts (merged API + storage for closed accounts)
    // Excludes accounts already marked as 'closed', includes 'pending_close' accounts
    const accounts = await getAccountsForSync({ includeClosed: false });

    if (!accounts || !accounts.length) {
      toast.show('No Questrade accounts found.', 'debug');
      return;
    }

    // Create progress dialog (pass accounts which may include status for closed account styling)
    const progressDialog = showProgressDialog(accounts, 'Syncing All Accounts to Monarch');

    // Initialize stats and cancellation state
    const stats: { success: number; failed: number; total: number; skipped: number } = { success: 0, failed: 0, total: accounts.length, skipped: 0 };
    let isCancelled = false;
    let isUploadComplete = false;

    // Set up cancel callback
    progressDialog.onCancel(() => {
      debugLog('Sync cancellation requested');
      isCancelled = true;
      toast.show('Sync cancelled by user', 'info');
    });

    // Ensure progress dialog shows close button when sync completes
    const completeUpload = () => {
      if (!isUploadComplete) {
        isUploadComplete = true;
        progressDialog.hideCancel();
        debugLog('Sync process completed, showing close button');
      }
    };

    try {
      // Ensure all account mappings before starting
      const mappingSuccess = await ensureAllAccountMappings(accounts, progressDialog);
      if (!mappingSuccess || isCancelled) {
        progressDialog.close();
        toast.show('Sync cancelled: Account mapping incomplete.', 'info');
        return;
      }

      // Get start dates for all accounts
      const startDates = await getStartDatesForAllAccounts(accounts);
      if (!startDates || isCancelled) {
        progressDialog.close();
        toast.show('Sync cancelled: Date selection cancelled.', 'info');
        return;
      }

      // Process each account
      const processedAccounts = [];
      for (const account of accounts) {
        // Check for cancellation before processing each account
        if (isCancelled) {
          debugLog('Sync cancelled, stopping account processing');
          break;
        }

        // Skip accounts we've already processed (prevent duplicates)
        if (processedAccounts.includes(account.key)) {
          continue;
        }
        processedAccounts.push(account.key);

        // Check if account was skipped during mapping (re-check from storage, not stale array)
        const accountData = accountService.getAccountData(INTEGRATIONS.QUESTRADE, account.key);
        if (accountData?.syncEnabled === false) {
          stats.skipped = (stats.skipped || 0) + 1;
          progressDialog.updateProgress(account.key, 'skipped', 'Sync disabled');
          debugLog(`Skipped account ${account.key} - sync disabled by user`);
          continue;
        }

        try {
          // Update progress
          progressDialog.updateProgress(account.key, 'processing', 'Starting sync...');

          const accountName = account.nickname || account.name || 'Account';
          const fromDate = startDates[account.key];
          const toDate = getTodayLocal();

          // Check cancellation before sync
          if (isCancelled) break;

          // Sync account (balance + positions + transactions)
          await syncAccountToMonarch(account.key, accountName, fromDate, toDate, progressDialog);

          // Update success stats
          stats.success += 1;

          // If this was a pending_close account (in storage but not in API, not yet marked closed),
          // mark it as closed after successful sync - this is the final sync for this account
          if (account.status === 'pending_close') {
            markAccountAsClosed(account.key);
            debugLog(`Marked pending_close account ${account.key} as closed after successful sync`);
          }
        } catch (error) {
          // Update failed stats and progress
          stats.failed += 1;
          progressDialog.updateProgress(account.key, 'error', error.message);

          // Show error and wait for acknowledgment
          await progressDialog.showError(account.key, error);

          // Stop processing remaining accounts
          break;
        }
      }

      // Show final summary
      progressDialog.showSummary(stats);

      // Complete the sync process
      completeUpload();

      // Show appropriate completion message
      if (isCancelled) {
        toast.show('Sync process was cancelled', 'info');
      } else if (stats.success === stats.total) {
        toast.show(`Successfully synced all ${stats.total} accounts!`, 'info');
      } else if (stats.success > 0) {
        toast.show(`Sync completed: ${stats.success} successful, ${stats.failed} failed`, 'warning');
      }
    } catch (error) {
      // Ensure we complete the sync process even on error
      completeUpload();
      throw error;
    }
  } catch (error) {
    toast.show(`Failed to start sync process: ${error.message}`, 'error');
  }
}

/**
 * Get start dates for all accounts
 * For accounts without lastUsedDate (first sync), automatically uses account's createdOn date
 * @param {Array} accounts - List of accounts
 * @returns {Promise<Object|null>} Object mapping account keys to start dates, or null if cancelled
 */
async function getStartDatesForAllAccounts(accounts) {
  const startDates = {};

  // Check each account for lastUsedDate - use calculateFromDateWithLookback which applies
  // the configured lookback period (e.g. 4 days) to the last sync date.
  // For accounts without lastUsedDate, use their createdOn date (first sync)
  for (const account of accounts) {
    const lastDate = calculateFromDateWithLookback('questrade', account.key);
    if (lastDate && /^\d{4}-\d{2}-\d{2}$/.test(lastDate)) {
      startDates[account.key] = lastDate;
    } else {
      // No last upload date - this is a first sync
      // Use account's creation date if available
      const createdOn = account.createdOn ? account.createdOn.split('T')[0] : null;
      if (createdOn && /^\d{4}-\d{2}-\d{2}$/.test(createdOn)) {
        debugLog(`Account ${account.key} first sync - using creation date: ${createdOn}`);
        startDates[account.key] = createdOn;
      } else {
        // Fallback to 2 weeks ago if no creation date available
        const twoWeeksAgo = formatDate(new Date(Date.now() - 12096e5));
        debugLog(`Account ${account.key} first sync - no creation date, using fallback: ${twoWeeksAgo}`);
        startDates[account.key] = twoWeeksAgo;
      }
    }
  }

  return startDates;
}

// Default export
export default {
  syncAccountToMonarch,
  syncAllAccountsToMonarch,
};
