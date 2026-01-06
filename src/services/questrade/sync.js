/**
 * Sync Orchestrator Service
 * Coordinates synchronization of balances, positions, and (future) transactions
 * between Questrade and Monarch
 */

import { debugLog, getTodayLocal, formatDate } from '../../core/utils';
import { STORAGE } from '../../core/config';
import stateManager from '../../core/state';
import monarchApi from '../../api/monarch';
import questradeApi from '../../api/questrade';
import balanceService from './balance';
import positionsService from './positions';
import transactionsService from './transactions';
import toast from '../../ui/toast';
import { showProgressDialog } from '../../ui/components/progressDialog';
import { showDatePickerPromise } from '../../ui/components/datePicker';
import { showMonarchAccountSelector } from '../../ui/questrade/components/accountSelector';
import { ensureMonarchAuthentication } from '../../ui/components/monarchLoginLink';

/**
 * Build the list of sync steps for a Questrade account
 * @returns {Array} Array of step definitions [{key, name}]
 */
function buildQuestradeSteps() {
  return [
    { key: 'balance', name: 'Balance history' },
    { key: 'positions', name: 'Positions sync' },
    { key: 'transactions', name: 'Transactions sync' },
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
export async function syncAccountToMonarch(accountId, accountName, fromDate, toDate, progressDialog = null) {
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
      progressDialog.updateStepStatus(accountId, 'balance', 'processing', 'Uploading...');
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
      progressDialog.updateStepStatus(accountId, 'positions', 'processing', 'Syncing...');
    }

    try {
      // Get Monarch account mapping
      const monarchAccount = await monarchApi.resolveAccountMapping(
        accountId,
        STORAGE.QUESTRADE_ACCOUNT_MAPPING_PREFIX,
        'brokerage',
      );

      if (!monarchAccount) {
        debugLog(`No Monarch account mapping for ${accountId}, skipping positions sync`);
        if (progressDialog) {
          progressDialog.updateStepStatus(accountId, 'positions', 'skipped', 'No account mapping');
        }
      } else {
        // Process positions
        const positionsResult = await positionsService.processAccountPositions(
          accountId,
          accountName,
          monarchAccount.id,
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
            progressDialog.updateStepStatus(accountId, 'positions', 'error', positionsResult.error || 'Sync failed');
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

    // Step 3: Sync transactions (gracefully handle failures)
    if (progressDialog) {
      progressDialog.updateStepStatus(accountId, 'transactions', 'processing', 'Syncing...');
    }

    try {
      const transactionsResult = await transactionsService.processAndUploadTransactions(
        accountId,
        accountName,
        fromDate,
        progressDialog,
      );

      if (transactionsResult.success) {
        const ordersCount = transactionsResult.ordersProcessed || 0;
        const transactionsMessage = ordersCount > 0 ? `${ordersCount} orders` : 'No new orders';
        if (progressDialog) {
          progressDialog.updateStepStatus(accountId, 'transactions', 'success', transactionsMessage);
        }
        debugLog(`Transactions sync completed: ${ordersCount} processed`);
        if (transactionsResult.skippedDuplicates) {
          debugLog(`Skipped ${transactionsResult.skippedDuplicates} duplicate orders`);
        }
      } else {
        if (progressDialog) {
          progressDialog.updateStepStatus(accountId, 'transactions', 'error', 'Sync failed');
        }
      }
    } catch (transactionsError) {
      debugLog('Error syncing transactions (non-fatal):', transactionsError);
      if (progressDialog) {
        progressDialog.updateStepStatus(accountId, 'transactions', 'error', transactionsError.message);
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
  const diffTime = Math.abs(to - from);
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
}

/**
 * Sync all Questrade accounts to Monarch
 * Based on uploadAllAccountsToMonarch but extended for full sync
 * @returns {Promise<void>}
 */
export async function syncAllAccountsToMonarch() {
  try {
    // Check Monarch authentication before proceeding
    const authenticated = await ensureMonarchAuthentication(null, 'sync all Questrade accounts');
    if (!authenticated) {
      return; // User cancelled authentication
    }

    // Get all Questrade accounts
    const accounts = await questradeApi.fetchAccounts();

    if (!accounts || !accounts.length) {
      toast.show('No Questrade accounts found.', 'error');
      return;
    }

    // Create progress dialog
    const progressDialog = showProgressDialog(accounts, 'Syncing All Accounts to Monarch');

    // Initialize stats and cancellation state
    const stats = { success: 0, failed: 0, total: accounts.length };
    let isCancelled = false;
    let isUploadComplete = false;

    // Set up cancel callback
    progressDialog.onCancel(() => {
      debugLog('Sync cancellation requested');
      isCancelled = true;
      toast.show('Sync cancelled by user', 'warning');
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
        toast.show('Sync cancelled: Account mapping incomplete.', 'warning');
        return;
      }

      // Get start dates for all accounts
      const startDates = await getStartDatesForAllAccounts(accounts);
      if (!startDates || isCancelled) {
        progressDialog.close();
        toast.show('Sync cancelled: Date selection cancelled.', 'warning');
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

        try {
          // Update progress
          progressDialog.updateProgress(account.key, 'processing', 'Starting sync...');

          const accountName = account.nickname || account.name || 'Account';
          const fromDate = startDates[account.key];
          const toDate = getTodayLocal();

          // Check cancellation before sync
          if (isCancelled) break;

          // Sync account (balance + positions)
          await syncAccountToMonarch(account.key, accountName, fromDate, toDate, progressDialog);

          // Update success stats
          stats.success += 1;
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
        toast.show('Sync process was cancelled', 'warning');
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
 * Ensure all accounts have Monarch account mappings
 * @param {Array} accounts - List of Questrade accounts
 * @param {Object} progressDialog - Progress dialog instance
 * @returns {Promise<boolean>} True if all accounts are mapped, false if cancelled
 */
async function ensureAllAccountMappings(accounts, progressDialog) {
  const unmappedAccounts = [];

  // Check each account for mapping
  for (let i = 0; i < accounts.length; i += 1) {
    const account = accounts[i];
    const monarchAccount = JSON.parse(GM_getValue(`${STORAGE.QUESTRADE_ACCOUNT_MAPPING_PREFIX}${account.key}`, null));
    if (!monarchAccount) {
      unmappedAccounts.push(account);
    }
  }

  // Return early if all accounts are mapped
  if (unmappedAccounts.length === 0) {
    return true;
  }

  // Show message about missing mappings
  toast.show(`${unmappedAccounts.length} accounts need to be mapped to Monarch`, 'info');

  // Get Monarch accounts for mapping
  const investmentAccounts = await monarchApi.listAccounts();

  if (!investmentAccounts.length) {
    toast.show('No investment accounts found in Monarch.', 'error');
    return false;
  }

  // Map each unmapped account
  for (let i = 0; i < unmappedAccounts.length; i += 1) {
    const account = unmappedAccounts[i];
    // Update progress if dialog exists
    if (progressDialog) {
      progressDialog.updateProgress(account.key, 'processing', 'Mapping account...');
    }

    // Set current account context for the selector
    const accountName = account.nickname || account.name || 'Account';
    stateManager.setAccount(account.key, accountName);

    // Show account selector for this Questrade account
    const monarchAccount = await new Promise((resolve) => showMonarchAccountSelector(investmentAccounts, resolve));

    if (!monarchAccount) {
      // User cancelled
      return false;
    }

    // Save the mapping
    GM_setValue(`${STORAGE.QUESTRADE_ACCOUNT_MAPPING_PREFIX}${account.key}`, JSON.stringify(monarchAccount));

    // Update progress if dialog exists
    if (progressDialog) {
      progressDialog.updateProgress(account.key, 'success', 'Mapping complete');
    }
  }

  return true;
}

/**
 * Get start dates for all accounts
 * @param {Array} accounts - List of accounts
 * @returns {Promise<Object|null>} Object mapping account keys to start dates, or null if cancelled
 */
async function getStartDatesForAllAccounts(accounts) {
  const startDates = {};
  let needsDatePicker = false;
  let oldestDate = null;

  // Check each account for lastUsedDate
  for (const account of accounts) {
    const lastDate = GM_getValue(`${STORAGE.QUESTRADE_LAST_UPLOAD_DATE_PREFIX}${account.key}`, null);
    if (lastDate && /^\d{4}-\d{2}-\d{2}$/.test(lastDate)) {
      startDates[account.key] = lastDate;
      // Track oldest date among accounts that have one
      if (!oldestDate || lastDate < oldestDate) {
        oldestDate = lastDate;
      }
    } else {
      needsDatePicker = true;
    }
  }

  // If any account is missing lastUsedDate, show date picker once
  if (needsDatePicker) {
    const defaultDate = oldestDate || formatDate(new Date(Date.now() - 12096e5)); // 2 weeks ago
    const selectedDate = await showDatePickerPromise(
      defaultDate,
      'Select start date for accounts without history',
    );

    if (!selectedDate) return null; // User cancelled

    // Use selected date for accounts without lastUsedDate
    for (const account of accounts) {
      if (!startDates[account.key]) {
        startDates[account.key] = selectedDate;
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
