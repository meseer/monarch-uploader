/**
 * MBNA Upload Service
 *
 * Orchestrates syncing MBNA credit card data to Monarch Money.
 * Implements credit limit sync, balance upload/reconstruction,
 * transaction sync, and pending transaction reconciliation.
 *
 * @module services/mbna-upload
 */

import { debugLog, getTodayLocal, calculateFromDateWithLookback, saveLastUploadDate, getLastUpdateDate } from '../core/utils';
import { LOGO_CLOUDINARY_IDS } from '../core/config';
import { INTEGRATIONS, ACCOUNT_SETTINGS } from '../core/integrationCapabilities';
import stateManager from '../core/state';
import monarchApi from '../api/monarch';
import accountService from './common/accountService';
import toast from '../ui/toast';
import { showProgressDialog } from '../ui/components/progressDialog';
import { showMonarchAccountSelectorWithCreate } from '../ui/components/accountSelectorWithCreate';
import { convertMbnaTransactionsToMonarchCSV } from '../utils/csv';
import { showDatePickerWithOptionsPromise } from '../ui/components/datePicker';
import {
  separateAndDeduplicateTransactions,
  reconcileMbnaPendingTransactions,
  formatReconciliationMessage,
} from '../integrations/mbna/sinks/monarch/pendingTransactions';
import { processMbnaTransactions, resolveMbnaCategories, filterDuplicateSettledTransactions } from '../integrations/mbna/sinks/monarch/transactions';
import { buildBalanceHistory } from '../integrations/mbna/source/balanceReconstruction';
import { formatBalanceHistoryForMonarch } from '../integrations/mbna/sinks/monarch/balanceFormatter';
import {
  getTransactionIdsFromArray,
  mergeAndRetainTransactions,
  getRetentionSettingsFromAccount,
} from '../utils/transactionStorage';

/**
 * Build sync steps for the progress dialog.
 *
 * @param {Object} options - Step configuration
 * @param {boolean} options.includeTransactions - Whether to include transaction step
 * @param {boolean} options.includePending - Whether to include pending reconciliation step
 * @returns {Array<{key: string, name: string}>} Step definitions
 */
function buildSyncSteps({ includeTransactions = true, includePending = true } = {}) {
  const steps = [
    { key: 'creditLimit', name: 'Credit limit sync' },
  ];
  if (includeTransactions) {
    steps.push({ key: 'transactions', name: 'Transaction sync' });
  }
  if (includePending) {
    steps.push({ key: 'pending', name: 'Pending reconciliation' });
  }
  steps.push({ key: 'balance', name: 'Balance upload' });
  return steps;
}

/**
 * Check if this is the first sync for the account
 * @param {string} mbnaAccountId - MBNA account ID
 * @returns {boolean} True if first sync
 */
function isFirstSync(mbnaAccountId) {
  const lastUploadDate = getLastUpdateDate(mbnaAccountId, 'mbna');
  return !lastUploadDate;
}

/**
 * Sync credit limit from MBNA to Monarch.
 * Compares with last synced value to avoid unnecessary API calls.
 *
 * @param {string} mbnaAccountId - MBNA account ID
 * @param {string} monarchAccountId - Monarch account ID
 * @param {number|null} creditLimit - Credit limit value from MBNA API
 * @returns {Promise<{success: boolean, message: string}>} Sync result
 */
async function syncCreditLimit(mbnaAccountId, monarchAccountId, creditLimit) {
  if (creditLimit === null || creditLimit === undefined) {
    return { success: true, message: 'Not available', skipped: true };
  }

  // Check if credit limit has changed since last sync
  const accountData = accountService.getAccountData(INTEGRATIONS.MBNA, mbnaAccountId);
  const storedCreditLimit = accountData?.lastSyncedCreditLimit;

  if (storedCreditLimit !== null && storedCreditLimit !== undefined && storedCreditLimit === creditLimit) {
    debugLog(`[MBNA] Credit limit unchanged: $${creditLimit}`);
    return { success: true, message: `$${creditLimit.toLocaleString()} (unchanged)`, skipped: false };
  }

  try {
    const updatedAccount = await monarchApi.setCreditLimit(monarchAccountId, creditLimit);

    if (updatedAccount && updatedAccount.limit === creditLimit) {
      accountService.updateAccountInList(INTEGRATIONS.MBNA, mbnaAccountId, {
        lastSyncedCreditLimit: creditLimit,
      });
      debugLog(`[MBNA] Credit limit synced: $${creditLimit}`);
      return { success: true, message: `$${creditLimit.toLocaleString()}`, skipped: false };
    }

    debugLog(`[MBNA] Credit limit update returned but value not applied. Expected: ${creditLimit}, Got: ${updatedAccount?.limit}`);
    return { success: false, message: 'Value not applied', skipped: false };
  } catch (error) {
    debugLog('[MBNA] Error syncing credit limit:', error);
    return { success: false, message: error.message, skipped: false };
  }
}

/**
 * Generate CSV for single-day balance
 * @param {number} balance - Current balance
 * @param {string} accountName - Account name for CSV
 * @returns {string} CSV content
 */
function generateBalanceCSV(balance, accountName) {
  const todayFormatted = getTodayLocal();
  let csvContent = '"Date","Total Equity","Account Name"\n';
  csvContent += `"${todayFormatted}","${balance}","${accountName}"\n`;
  return csvContent;
}

/**
 * Generate CSV for balance history
 * @param {Array} balanceHistory - Array of { date, amount } entries
 * @param {string} accountName - Account name for CSV
 * @returns {string} CSV content
 */
function generateBalanceHistoryCSV(balanceHistory, accountName) {
  let csvContent = '"Date","Total Equity","Account Name"\n';
  balanceHistory.forEach((entry) => {
    csvContent += `"${entry.date}","${entry.amount}","${accountName}"\n`;
  });
  return csvContent;
}

/**
 * Sync a single MBNA account to Monarch.
 * Shows progress dialog with all sync steps.
 *
 * @param {Object} account - MBNA account from accounts summary
 * @param {Object} monarchAccount - Monarch account mapping
 * @param {Object} api - MBNA API client instance
 * @param {Object} options - Sync options
 * @param {string} options.fromDate - Start date for transaction fetch
 * @param {boolean} options.reconstructBalance - Whether to reconstruct balance history
 * @param {boolean} options.firstSync - Whether this is the first sync
 * @returns {Promise<{success: boolean, message: string}>} Sync result
 */
export async function syncMbnaAccount(account, monarchAccount, api, options = {}) {
  const { accountId } = account;
  const { fromDate, reconstructBalance = false, firstSync: isFirst = false } = options;
  const accountDisplayName = account.displayName || `MBNA Card (${account.endingIn})`;

  stateManager.setAccount(accountId, accountDisplayName);

  // Read account settings
  const accountData = accountService.getAccountData(INTEGRATIONS.MBNA, accountId);
  const includePendingTransactions = accountData?.[ACCOUNT_SETTINGS.INCLUDE_PENDING_TRANSACTIONS] !== false;
  const storeTransactionDetailsInNotes = accountData?.storeTransactionDetailsInNotes ?? false;

  // Create progress dialog
  const progressDialog = showProgressDialog(
    [{ key: accountId, nickname: accountDisplayName, name: 'MBNA Upload' }],
    'Syncing MBNA Data to Monarch Money',
  );
  progressDialog.initSteps(accountId, buildSyncSteps({
    includeTransactions: true,
    includePending: includePendingTransactions,
  }));

  const abortController = new AbortController();
  progressDialog.onCancel(() => abortController.abort());

  try {
    // ── STEP 1: Credit Limit Sync ──────────────────────────
    progressDialog.updateStepStatus(accountId, 'creditLimit', 'processing', 'Fetching...');

    if (abortController.signal.aborted) throw new Error('Cancelled');

    let creditLimit = null;
    try {
      creditLimit = await api.getCreditLimit(accountId);
      debugLog(`[MBNA] Credit limit fetched: $${creditLimit}`);
    } catch (error) {
      debugLog('[MBNA] Error fetching credit limit:', error);
      progressDialog.updateStepStatus(accountId, 'creditLimit', 'error', error.message);
    }

    if (creditLimit !== null) {
      progressDialog.updateStepStatus(accountId, 'creditLimit', 'processing', 'Syncing...');
      const creditLimitResult = await syncCreditLimit(accountId, monarchAccount.id, creditLimit);

      if (creditLimitResult.success) {
        progressDialog.updateStepStatus(accountId, 'creditLimit', 'success', creditLimitResult.message);
      } else {
        progressDialog.updateStepStatus(accountId, 'creditLimit', 'error', creditLimitResult.message);
      }
    } else if (!abortController.signal.aborted) {
      progressDialog.updateStepStatus(accountId, 'creditLimit', 'skipped', 'Not available');
    }

    // ── STEP 2: Fetch & Upload Transactions ────────────────
    if (abortController.signal.aborted) throw new Error('Cancelled');

    progressDialog.updateStepStatus(accountId, 'transactions', 'processing', 'Fetching current cycle...');

    const txResult = await api.getTransactions(accountId, fromDate, {
      onProgress: (current, total) => {
        progressDialog.updateStepStatus(
          accountId, 'transactions', 'processing',
          `Loading statement ${current}/${total}...`,
        );
      },
    });
    const { allSettled: rawSettled, allPending: rawPending, statements, currentCycle } = txResult;

    debugLog(`[MBNA] Fetched ${rawSettled.length} settled, ${rawPending.length} pending transactions`);

    // Separate and deduplicate pending vs settled
    progressDialog.updateStepStatus(accountId, 'transactions', 'processing', 'Deduplicating...');
    const dedupResult = await separateAndDeduplicateTransactions(rawPending, rawSettled);

    if (dedupResult.duplicatesRemoved > 0) {
      debugLog(`[MBNA] Removed ${dedupResult.duplicatesRemoved} pending duplicates that matched settled`);
    }

    // Process transactions (merchant mapping, auto-categorization)
    progressDialog.updateStepStatus(accountId, 'transactions', 'processing', 'Processing...');
    const processed = processMbnaTransactions(
      dedupResult.settled,
      dedupResult.pending,
      { includePending: includePendingTransactions },
    );

    // Filter already-uploaded settled transactions
    const uploadedTxRecords = accountData?.uploadedTransactions || [];
    const { newTransactions: newSettled, duplicateCount } = filterDuplicateSettledTransactions(
      processed.settled,
      uploadedTxRecords,
    );

    // Filter already-uploaded pending transactions
    const uploadedRefSet = new Set(getTransactionIdsFromArray(uploadedTxRecords));
    const newPending = processed.pending.filter((tx) => !tx.pendingId || !uploadedRefSet.has(tx.pendingId));
    const pendingDuplicates = processed.pending.length - newPending.length;

    const totalDuplicates = duplicateCount + pendingDuplicates;
    const allNewTransactions = [...newSettled, ...newPending];

    if (totalDuplicates > 0) {
      debugLog(`[MBNA] Filtered ${totalDuplicates} duplicate transactions (${duplicateCount} settled, ${pendingDuplicates} pending)`);
    }

    let transactionUploadSuccess = false;

    if (allNewTransactions.length === 0) {
      const msg = totalDuplicates > 0 ? `${totalDuplicates} already uploaded` : 'No new';
      progressDialog.updateStepStatus(accountId, 'transactions', 'success', msg);
    } else {
      // Resolve categories
      progressDialog.updateStepStatus(accountId, 'transactions', 'processing', 'Resolving categories...');
      const resolvedTx = await resolveMbnaCategories(allNewTransactions, accountId);

      // Convert to CSV
      progressDialog.updateStepStatus(accountId, 'transactions', 'processing', 'Converting...');
      const csvData = convertMbnaTransactionsToMonarchCSV(resolvedTx, accountDisplayName, {
        storeTransactionDetailsInNotes,
      });

      if (!csvData) {
        throw new Error('Failed to convert MBNA transactions to CSV');
      }

      // Upload
      progressDialog.updateStepStatus(accountId, 'transactions', 'processing', 'Uploading...');
      const today = getTodayLocal();
      const filename = `mbna_transactions_${fromDate || 'all'}_to_${today}.csv`;
      const uploadSuccess = await monarchApi.uploadTransactions(monarchAccount.id, csvData, filename, false, false);

      if (uploadSuccess) {
        transactionUploadSuccess = true;

        // Save transaction IDs to dedup store
        const settledRefs = newSettled.map((tx) => tx.referenceNumber).filter(Boolean);
        const pendingRefs = newPending.map((tx) => tx.pendingId).filter(Boolean);
        const allRefs = [...settledRefs, ...pendingRefs];

        if (allRefs.length > 0) {
          let txDate = today;
          const withDates = allNewTransactions.filter((tx) => tx.date);
          if (withDates.length > 0) {
            withDates.sort((a, b) => b.date.localeCompare(a.date));
            txDate = withDates[0].date;
          }
          const existingTransactions = accountData?.uploadedTransactions || [];
          const retentionSettings = getRetentionSettingsFromAccount(accountData);
          const updatedTransactions = mergeAndRetainTransactions(existingTransactions, allRefs, retentionSettings, txDate);
          accountService.updateAccountInList(INTEGRATIONS.MBNA, accountId, {
            uploadedTransactions: updatedTransactions,
          });
        }

        saveLastUploadDate(accountId, today, 'mbna');

        // Build success message
        const parts = [];
        if (newSettled.length > 0) parts.push(`${newSettled.length} settled`);
        if (newPending.length > 0) parts.push(`${newPending.length} pending`);
        const uploadedMsg = parts.join(', ');
        const msg = totalDuplicates > 0
          ? `${uploadedMsg} uploaded (${totalDuplicates} skipped)`
          : `${uploadedMsg} uploaded`;

        progressDialog.updateStepStatus(accountId, 'transactions', 'success', msg);
      } else {
        throw new Error('Upload to Monarch failed');
      }
    }

    // ── STEP 3: Pending Reconciliation ─────────────────────
    if (includePendingTransactions) {
      if (abortController.signal.aborted) throw new Error('Cancelled');

      progressDialog.updateStepStatus(accountId, 'pending', 'processing', 'Reconciling...');
      try {
        const lookbackDays = 90;
        const reconciliationResult = await reconcileMbnaPendingTransactions(
          monarchAccount.id,
          rawPending,
          rawSettled,
          lookbackDays,
        );
        const reconciliationMsg = formatReconciliationMessage(reconciliationResult);
        const reconciliationStatus = reconciliationResult.success !== false ? 'success' : 'error';
        progressDialog.updateStepStatus(accountId, 'pending', reconciliationStatus, reconciliationMsg);
        debugLog('[MBNA] Pending reconciliation result:', reconciliationResult);
      } catch (reconciliationError) {
        debugLog('[MBNA] Error during pending reconciliation:', reconciliationError);
        progressDialog.updateStepStatus(accountId, 'pending', 'error', reconciliationError.message);
      }
    }

    // ── STEP 4: Balance Upload ─────────────────────────────
    if (abortController.signal.aborted) throw new Error('Cancelled');

    progressDialog.updateStepStatus(accountId, 'balance', 'processing', 'Preparing...');
    const todayFormatted = getTodayLocal();

    // Read invertBalance setting from account data
    // Default MBNA behaviour: negate balance (positive=owed → Monarch negative=liability)
    // invertBalance=true: apply additional inversion (for manual accounts reporting negative balances)
    const balanceAccountData = accountService.getAccountData(INTEGRATIONS.MBNA, accountId);
    const invertBalance = balanceAccountData?.invertBalance === true;

    if (invertBalance) {
      debugLog('[MBNA] Inverting balance (invertBalance setting enabled)');
    }

    // Get current balance
    let currentBalance = null;
    try {
      const balanceData = await api.getBalance(accountId);
      currentBalance = balanceData.currentBalance;
    } catch (error) {
      debugLog('[MBNA] Error fetching balance:', error);
    }

    // Compute the Monarch balance: default negation, then additional inversion if setting is on
    // Default: -currentBalance (MBNA positive=owed → Monarch negative)
    // invertBalance=true: currentBalance (additional negate cancels default negate)
    const monarchBalance = currentBalance !== null
      ? (invertBalance ? currentBalance : -currentBalance)
      : null;

    if (currentBalance === null) {
      progressDialog.updateStepStatus(accountId, 'balance', 'skipped', 'Not available');
    } else if (isFirst && reconstructBalance && statements.length > 0) {
      // Reconstruct balance history from statements
      progressDialog.updateStepStatus(accountId, 'balance', 'processing', 'Reconstructing...');

      const balanceHistory = buildBalanceHistory({
        currentBalance,
        statements,
        currentCycleSettled: currentCycle.settled,
        startDate: fromDate,
      });

      if (balanceHistory.length > 0) {
        // formatBalanceHistoryForMonarch negates by default; if invertBalance is on, skip that negation
        const monarchEntries = invertBalance
          ? balanceHistory // Already in raw form, no negation needed
          : formatBalanceHistoryForMonarch(balanceHistory);
        const balanceCSV = generateBalanceHistoryCSV(monarchEntries, accountDisplayName);

        progressDialog.updateStepStatus(accountId, 'balance', 'processing', 'Uploading...');
        const balanceSuccess = await monarchApi.uploadBalance(
          monarchAccount.id,
          balanceCSV,
          fromDate || balanceHistory[0].date,
          todayFormatted,
        );

        if (balanceSuccess) {
          saveLastUploadDate(accountId, todayFormatted, 'mbna');
          progressDialog.updateStepStatus(accountId, 'balance', 'success', `${balanceHistory.length} days`);
          progressDialog.updateBalanceChange(accountId, { newBalance: monarchBalance });
        } else {
          progressDialog.updateStepStatus(accountId, 'balance', 'error', 'Upload failed');
        }
      } else {
        progressDialog.updateStepStatus(accountId, 'balance', 'skipped', 'No history data');
      }
    } else {
      // Upload single-day balance
      const balanceCSV = generateBalanceCSV(monarchBalance, accountDisplayName);
      const balanceSuccess = await monarchApi.uploadBalance(monarchAccount.id, balanceCSV, todayFormatted, todayFormatted);

      if (balanceSuccess) {
        const formatted = `$${Math.abs(currentBalance).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
        progressDialog.updateStepStatus(accountId, 'balance', 'success', formatted);
        progressDialog.updateBalanceChange(accountId, { newBalance: monarchBalance });
        saveLastUploadDate(accountId, todayFormatted, 'mbna');
      } else {
        progressDialog.updateStepStatus(accountId, 'balance', 'error', 'Upload failed');
      }
    }

    // ── Update sync metadata ───────────────────────────────
    accountService.updateAccountInList(INTEGRATIONS.MBNA, accountId, {
      lastSyncDate: getTodayLocal(),
    });

    // Increment sync count and cleanup legacy storage if ready
    const newSyncCount = accountService.incrementSyncCount(INTEGRATIONS.MBNA, accountId);
    debugLog(`[MBNA] Sync count for ${accountId}: ${newSyncCount}`);
    if (accountService.isReadyForLegacyCleanup(INTEGRATIONS.MBNA, accountId)) {
      const cleanupResult = accountService.cleanupLegacyStorage(INTEGRATIONS.MBNA, accountId);
      if (cleanupResult.cleaned && cleanupResult.keysDeleted > 0) {
        debugLog(`[MBNA] Cleaned up ${cleanupResult.keysDeleted} legacy storage keys`);
      }
    }

    // Show summary
    progressDialog.hideCancel();
    progressDialog.showSummary({ success: 1, failed: 0, total: 1 });

    const summaryParts = [];
    if (transactionUploadSuccess) summaryParts.push('Transactions synced');
    summaryParts.push('Balance uploaded');

    return { success: true, message: summaryParts.join(', ') };
  } catch (error) {
    debugLog('[MBNA] Sync error:', error);

    if (error.message === 'Cancelled') {
      progressDialog.updateProgress(accountId, 'error', 'Cancelled');
    } else {
      progressDialog.updateProgress(accountId, 'error', `Failed: ${error.message}`);
    }

    progressDialog.hideCancel();
    progressDialog.showSummary({ success: 0, failed: 1, total: 1 });

    return { success: false, message: error.message };
  }
}

/**
 * Handle the full MBNA upload flow for a single account.
 * Resolves the Monarch account mapping (creating if needed),
 * determines date range, sets icon on newly created accounts, then runs the sync.
 *
 * @param {Object} account - MBNA account from accounts summary
 * @param {Object} api - MBNA API client instance
 * @returns {Promise<{success: boolean, message: string}>} Upload result
 */
export async function uploadMbnaAccount(account, api) {
  const { accountId } = account;
  const accountDisplayName = account.displayName || `MBNA Card (${account.endingIn})`;

  stateManager.setAccount(accountId, accountDisplayName);

  // Check for existing Monarch account mapping
  let monarchAccount = accountService.getMonarchAccountMapping(
    INTEGRATIONS.MBNA,
    accountId,
  );

  if (monarchAccount) {
    debugLog('[MBNA] Using existing mapping:', accountDisplayName, '→', monarchAccount.displayName);
  } else {
    // Check if account was previously skipped
    const accountData = accountService.getAccountData(INTEGRATIONS.MBNA, accountId);
    if (accountData && accountData.syncEnabled === false) {
      debugLog('[MBNA] Account was skipped:', accountDisplayName);
      return { success: true, message: 'Skipped', skipped: true };
    }

    // Show account selector for first-sync mapping
    debugLog('[MBNA] No mapping for', accountDisplayName, '— showing account selector');

    const createDefaults = {
      defaultName: accountDisplayName,
      defaultType: 'credit',
      defaultSubtype: 'credit_card',
      accountType: 'credit',
    };

    monarchAccount = await new Promise((resolve) => {
      showMonarchAccountSelectorWithCreate(
        [],
        (selectedAccount) => resolve(selectedAccount),
        null,
        'credit',
        createDefaults,
      );
    });

    if (!monarchAccount) {
      toast.show('Account mapping cancelled', 'info', 2000);
      return { success: false, message: 'Cancelled' };
    }

    if (monarchAccount.cancelled) {
      return { success: false, message: 'Cancelled' };
    }

    if (monarchAccount.skipped) {
      const skippedData = {
        mbnaAccount: {
          id: accountId,
          endingIn: account.endingIn,
          cardName: account.cardName,
          nickname: accountDisplayName,
        },
        monarchAccount: null,
        syncEnabled: false,
        lastSyncDate: null,
      };
      accountService.upsertAccount(INTEGRATIONS.MBNA, skippedData);
      toast.show(`${accountDisplayName}: skipped`, 'info', 2000);
      return { success: true, message: 'Skipped', skipped: true };
    }

    // Save the mapping
    const accountData2 = {
      mbnaAccount: {
        id: accountId,
        endingIn: account.endingIn,
        cardName: account.cardName,
        nickname: accountDisplayName,
      },
      monarchAccount: {
        id: monarchAccount.id,
        displayName: monarchAccount.displayName,
      },
      syncEnabled: true,
      lastSyncDate: null,
    };
    accountService.upsertAccount(INTEGRATIONS.MBNA, accountData2);

    debugLog('[MBNA] Account mapping saved:', accountDisplayName, '→', monarchAccount.displayName);
    toast.show(`Mapped: ${accountDisplayName} → ${monarchAccount.displayName}`, 'success', 3000);

    // Set icon on newly created accounts
    if (monarchAccount.newlyCreated && LOGO_CLOUDINARY_IDS.MBNA) {
      try {
        await monarchApi.setAccountLogo(monarchAccount.id, LOGO_CLOUDINARY_IDS.MBNA);
        debugLog('[MBNA] Account logo set for newly created account');
      } catch (error) {
        debugLog('[MBNA] Failed to set account logo:', error.message);
      }
    }
  }

  // Determine date range
  const firstSync = isFirstSync(accountId);
  let fromDate;
  let reconstructBalance = false;

  if (firstSync) {
    // Determine suggested start date: 30 days before oldest closing date, fallback to 90 days ago
    let defaultDate;
    try {
      const closingDates = await api.getClosingDates(accountId);
      if (closingDates.length > 0) {
        const oldestClosingDate = closingDates[closingDates.length - 1]; // sorted newest-first
        const d = new Date(`${oldestClosingDate}T00:00:00`);
        d.setDate(d.getDate() - 30);
        defaultDate = d.toISOString().split('T')[0];
        debugLog(`[MBNA] Suggested start date: ${defaultDate} (30 days before oldest closing date ${oldestClosingDate})`);
      }
    } catch (error) {
      debugLog('[MBNA] Could not fetch closing dates for start date suggestion:', error.message);
    }
    if (!defaultDate) {
      const d = new Date();
      d.setDate(d.getDate() - 90);
      defaultDate = d.toISOString().split('T')[0];
    }

    const datePickerResult = await showDatePickerWithOptionsPromise(
      defaultDate,
      `Select the start date for syncing "${accountDisplayName}". Default is 30 days before your oldest statement.`,
      { showReconstructCheckbox: true, reconstructCheckedByDefault: true },
    );

    if (!datePickerResult) {
      toast.show('Sync cancelled', 'info');
      return { success: false, message: 'Date selection cancelled' };
    }

    fromDate = datePickerResult.date;
    reconstructBalance = datePickerResult.reconstructBalance;
  } else {
    fromDate = calculateFromDateWithLookback('mbna', accountId) || (() => {
      const d = new Date();
      d.setDate(d.getDate() - 14);
      return d.toISOString().split('T')[0];
    })();
  }

  // Run the sync
  return syncMbnaAccount(account, monarchAccount, api, {
    fromDate,
    reconstructBalance,
    firstSync,
  });
}

export default {
  syncMbnaAccount,
  uploadMbnaAccount,
};