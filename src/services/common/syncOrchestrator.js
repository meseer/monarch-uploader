/**
 * Sync Orchestrator
 *
 * Generic sync workflow engine that drives account synchronization
 * using integration-provided SyncHooks and common services.
 *
 * The orchestrator owns all generic logic:
 * - Progress dialog management
 * - CSV generation from normalized transactions
 * - Filename construction
 * - Deduplication via common dedup service
 * - Transaction upload via common upload service
 * - Balance upload via common balance service
 * - Credit limit sync via common credit limit service
 * - Pending reconciliation via common reconciliation service
 *
 * Institution-specific logic is injected via SyncHooks:
 * - fetchTransactions, processTransactions, resolveCategories
 * - getSettledRefId, getPendingRefId, buildTransactionNotes
 * - getPendingIdFields, buildBalanceHistory (optional)
 *
 * @module services/common/syncOrchestrator
 */

import { debugLog, getTodayLocal } from '../../core/utils';
import { ACCOUNT_SETTINGS } from '../../core/integrationCapabilities';
import accountService from './accountService';
import { syncCreditLimit } from './creditLimitSync';
import { executeBalanceUploadStep } from './balanceUpload';
import { uploadTransactionsAndSaveRefs, formatTransactionUploadMessage } from './transactionUpload';
import { filterDuplicateSettledTransactions, filterDuplicatePendingTransactions } from './deduplication';
import {
  reconcilePendingTransactions,
  separateAndDeduplicateTransactions,
  formatReconciliationMessage,
} from './pendingReconciliation';
import {
  mergeAndRetainTransactions,
  getRetentionSettingsFromAccount,
} from '../../utils/transactionStorage';
import { convertToCSV } from '../../utils/csv';

// ── Monarch CSV column definitions ──────────────────────────
const MONARCH_CSV_COLUMNS = [
  'Date',
  'Merchant',
  'Category',
  'Account',
  'Original Statement',
  'Notes',
  'Amount',
  'Tags',
];

/**
 * Build sync steps for the progress dialog based on capabilities and settings.
 *
 * @param {Object} options - Step configuration
 * @param {boolean} options.hasCreditLimit - Whether integration has credit limit capability
 * @param {boolean} options.includeTransactions - Whether to include transaction step
 * @param {boolean} options.includePending - Whether to include pending reconciliation step
 * @returns {Array<{key: string, name: string}>} Step definitions
 */
function buildSyncSteps({ hasCreditLimit = false, includeTransactions = true, includePending = true }) {
  const steps = [];

  if (hasCreditLimit) {
    steps.push({ key: 'creditLimit', name: 'Credit limit sync' });
  }

  if (includePending) {
    steps.push({ key: 'pending', name: 'Pending reconciliation' });
  }

  if (includeTransactions) {
    steps.push({ key: 'transactions', name: 'Transaction sync' });
  }

  steps.push({ key: 'balance', name: 'Balance upload' });
  return steps;
}

/**
 * Convert normalized transactions to Monarch CSV format.
 *
 * Maps each transaction through the buildTransactionNotes hook
 * for institution-specific notes, then uses the generic CSV converter.
 *
 * @param {Array} transactions - Normalized transactions (from processTransactions hook)
 * @param {string} accountName - Account display name for the CSV
 * @param {Function} buildTransactionNotes - Hook: (tx, options) => string
 * @param {Object} options - Options
 * @param {boolean} options.storeTransactionDetailsInNotes - User setting
 * @returns {string} CSV string
 */
function convertTransactionsToMonarchCSV(transactions, accountName, buildTransactionNotes, options = {}) {
  if (!transactions || transactions.length === 0) {
    return '';
  }

  const { storeTransactionDetailsInNotes = false } = options;

  const monarchRows = transactions.map((tx) => ({
    Date: tx.date || '',
    Merchant: tx.merchant || '',
    Category: tx.resolvedMonarchCategory ?? tx.autoCategory ?? 'Uncategorized',
    Account: accountName,
    'Original Statement': tx.originalStatement || '',
    Notes: buildTransactionNotes(tx, { storeTransactionDetailsInNotes }),
    Amount: tx.amount || 0,
    Tags: tx.isPending ? 'Pending' : '',
  }));

  debugLog('[orchestrator] Converted transactions for CSV:', {
    count: monarchRows.length,
    pendingCount: transactions.filter((t) => t.isPending).length,
    sample: monarchRows[0],
  });

  return convertToCSV(monarchRows, MONARCH_CSV_COLUMNS);
}

/**
 * Execute the credit limit sync step.
 *
 * @param {Object} params - Parameters
 * @param {string} params.integrationId - Integration identifier
 * @param {string} params.accountId - Source account ID
 * @param {string} params.monarchAccountId - Monarch account ID
 * @param {Object} params.api - Integration API client
 * @param {Object} params.progressDialog - Progress dialog instance
 * @param {AbortController} params.abortController - Abort controller
 * @returns {Promise<void>}
 */
async function executeCreditLimitStep({ integrationId, accountId, monarchAccountId, api, progressDialog, abortController }) {
  progressDialog.updateStepStatus(accountId, 'creditLimit', 'processing', 'Fetching...');

  if (abortController.signal.aborted) throw new Error('Cancelled');

  let creditLimit = null;
  try {
    creditLimit = await api.getCreditLimit(accountId);
    debugLog(`[orchestrator] Credit limit fetched: $${creditLimit}`);
  } catch (error) {
    debugLog('[orchestrator] Error fetching credit limit:', error);
    progressDialog.updateStepStatus(accountId, 'creditLimit', 'error', error.message);
    return;
  }

  if (creditLimit !== null) {
    progressDialog.updateStepStatus(accountId, 'creditLimit', 'processing', 'Syncing...');
    const result = await syncCreditLimit(integrationId, accountId, monarchAccountId, creditLimit);

    progressDialog.updateStepStatus(
      accountId, 'creditLimit',
      result.success ? 'success' : 'error',
      result.message,
    );
  } else if (!abortController.signal.aborted) {
    progressDialog.updateStepStatus(accountId, 'creditLimit', 'skipped', 'Not available');
  }
}

/**
 * Fetch and separate raw transactions from the source.
 *
 * This is the first phase of the transaction pipeline: fetch from source API,
 * then separate into settled/pending and deduplicate (remove pending duplicates
 * that match settled transactions by hash).
 *
 * @param {Object} params - Parameters
 * @param {string} params.accountId - Source account ID
 * @param {Object} params.api - Integration API client
 * @param {string} params.fromDate - Start date
 * @param {string} params.txIdPrefix - Pending transaction ID prefix
 * @param {import('../../integrations/types').SyncHooks} params.hooks - Sync hooks
 * @param {AbortController} params.abortController - Abort controller
 * @returns {Promise<Object>} Fetched and separated data
 */
async function fetchAndSeparateTransactions({
  accountId, api, fromDate, txIdPrefix, hooks,
  abortController,
}) {
  if (abortController.signal.aborted) throw new Error('Cancelled');

  // Fetch silently — no progress updates on "transactions" step here,
  // because reconciliation runs between fetch and transaction upload.
  const fetchResult = await hooks.fetchTransactions(api, accountId, fromDate, {
    onProgress: () => {},
  });

  const { settled: rawSettled, pending: rawPending, metadata } = fetchResult;

  debugLog(`[orchestrator] Fetched ${rawSettled.length} settled, ${rawPending.length} pending transactions`);

  // Separate & deduplicate pending vs settled
  let dedupSettled = rawSettled;
  let dedupPending = rawPending;

  if (txIdPrefix && hooks.getPendingIdFields) {
    const dedupResult = await separateAndDeduplicateTransactions({
      txIdPrefix,
      getPendingIdFields: hooks.getPendingIdFields,
      pending: rawPending,
      settled: rawSettled,
    });

    dedupSettled = dedupResult.settled;
    dedupPending = dedupResult.pending;

    if (dedupResult.duplicatesRemoved > 0) {
      debugLog(`[orchestrator] Removed ${dedupResult.duplicatesRemoved} pending duplicates`);
    }
  }

  return { rawSettled, rawPending, dedupSettled, dedupPending, metadata };
}

/**
 * Execute the transaction sync step (process, dedup, categorize, upload).
 *
 * Expects pre-fetched and separated transaction data from fetchAndSeparateTransactions.
 *
 * @param {Object} params - Parameters
 * @param {string} params.integrationId - Integration identifier
 * @param {string} params.accountId - Source account ID
 * @param {string} params.accountDisplayName - Display name for CSV
 * @param {string} params.monarchAccountId - Monarch account ID
 * @param {string} params.fromDate - Start date
 * @param {boolean} params.includePendingTransactions - Whether to include pending
 * @param {boolean} params.storeTransactionDetailsInNotes - Notes setting
 * @param {Array} params.dedupSettled - Settled transactions (after pending/settled dedup)
 * @param {Array} params.dedupPending - Pending transactions (after pending/settled dedup)
 * @param {import('../../integrations/types').SyncHooks} params.hooks - Sync hooks
 * @param {Object} params.progressDialog - Progress dialog instance
 * @param {AbortController} params.abortController - Abort controller
 * @returns {Promise<Object>} Transaction step result
 */
async function executeTransactionStep({
  integrationId, accountId, accountDisplayName, monarchAccountId, fromDate,
  includePendingTransactions, storeTransactionDetailsInNotes, dedupSettled, dedupPending, hooks,
  progressDialog, abortController,
}) {
  if (abortController.signal.aborted) throw new Error('Cancelled');

  // ── Process (normalize) ──────────────────────────────────
  progressDialog.updateStepStatus(accountId, 'transactions', 'processing', 'Processing...');

  const processed = hooks.processTransactions(dedupSettled, dedupPending, {
    includePending: includePendingTransactions,
  });

  // ── Dedup against already-uploaded ───────────────────────
  const { newTransactions: newSettled, duplicateCount: settledDups } = filterDuplicateSettledTransactions(
    integrationId, accountId, processed.settled, hooks.getSettledRefId,
  );

  const { newTransactions: newPending, duplicateCount: pendingDups } = filterDuplicatePendingTransactions(
    integrationId, accountId, processed.pending, hooks.getPendingRefId,
  );

  const totalDuplicates = settledDups + pendingDups;
  const allNewTransactions = [...newSettled, ...newPending];

  if (totalDuplicates > 0) {
    debugLog(`[orchestrator] Filtered ${totalDuplicates} duplicates (${settledDups} settled, ${pendingDups} pending)`);
  }

  let transactionUploadSuccess = false;

  if (allNewTransactions.length === 0) {
    const msg = formatTransactionUploadMessage(0, 0, totalDuplicates);
    progressDialog.updateStepStatus(accountId, 'transactions', 'success', msg);
  } else {
    // ── Resolve categories ─────────────────────────────────
    progressDialog.updateStepStatus(accountId, 'transactions', 'processing', 'Resolving categories...');
    const resolvedTx = await hooks.resolveCategories(allNewTransactions, accountId);

    // ── Convert to CSV ─────────────────────────────────────
    progressDialog.updateStepStatus(accountId, 'transactions', 'processing', 'Converting...');
    const csvData = convertTransactionsToMonarchCSV(
      resolvedTx,
      accountDisplayName,
      hooks.buildTransactionNotes,
      { storeTransactionDetailsInNotes },
    );

    if (!csvData) {
      throw new Error('Failed to convert transactions to CSV');
    }

    // ── Upload ─────────────────────────────────────────────
    progressDialog.updateStepStatus(accountId, 'transactions', 'processing', 'Uploading...');
    const today = getTodayLocal();
    const filename = `${integrationId}_transactions_${fromDate || 'all'}_to_${today}.csv`;

    const settledRefs = newSettled.map((tx) => hooks.getSettledRefId(tx)).filter(Boolean);
    const pendingRefs = newPending.map((tx) => hooks.getPendingRefId(tx)).filter(Boolean);

    const uploadSuccess = await uploadTransactionsAndSaveRefs({
      integrationId,
      sourceAccountId: accountId,
      monarchAccountId,
      csvData,
      filename,
      transactionRefs: [...settledRefs, ...pendingRefs],
      transactions: allNewTransactions,
    });

    if (uploadSuccess) {
      transactionUploadSuccess = true;
      const msg = formatTransactionUploadMessage(newSettled.length, newPending.length, totalDuplicates);
      progressDialog.updateStepStatus(accountId, 'transactions', 'success', msg);
    } else {
      throw new Error('Upload to Monarch failed');
    }
  }

  return {
    success: transactionUploadSuccess,
  };
}

/**
 * Execute the pending reconciliation step.
 *
 * @param {Object} params - Parameters
 * @param {string} params.integrationId - Integration identifier
 * @param {string} params.accountId - Source account ID
 * @param {string} params.monarchAccountId - Monarch account ID
 * @param {Array} params.rawPending - Raw pending transactions
 * @param {Array} params.rawSettled - Raw settled transactions
 * @param {string} params.txIdPrefix - Pending transaction ID prefix
 * @param {import('../../integrations/types').SyncHooks} params.hooks - Sync hooks
 * @param {Object} params.progressDialog - Progress dialog instance
 * @param {AbortController} params.abortController - Abort controller
 * @returns {Promise<Object>} Reconciliation result (includes settledRefIds)
 */
async function executePendingReconciliationStep({
  integrationId, accountId, monarchAccountId, rawPending, rawSettled,
  txIdPrefix, hooks, progressDialog, abortController,
}) {
  if (abortController.signal.aborted) throw new Error('Cancelled');

  progressDialog.updateStepStatus(accountId, 'pending', 'processing', 'Reconciling...');

  try {
    const lookbackDays = 90;
    const result = await reconcilePendingTransactions({
      txIdPrefix,
      monarchAccountId,
      rawPending,
      rawSettled,
      lookbackDays,
      getPendingIdFields: hooks.getPendingIdFields,
      getSettledAmount: hooks.getSettledAmount,
      getSettledRefId: hooks.getSettledRefId,
    });

    // Save settled ref IDs to dedup store so transaction upload skips them
    const settledRefIds = result.settledRefIds || [];
    if (settledRefIds.length > 0) {
      debugLog(`[orchestrator] Saving ${settledRefIds.length} reconciled settled ref IDs to dedup store`);
      const acctData = accountService.getAccountData(integrationId, accountId);
      const existingTransactions = acctData?.uploadedTransactions || [];
      const retentionSettings = getRetentionSettingsFromAccount(acctData);
      const updatedTransactions = mergeAndRetainTransactions(
        existingTransactions, settledRefIds, retentionSettings, getTodayLocal(),
      );
      accountService.updateAccountInList(integrationId, accountId, {
        uploadedTransactions: updatedTransactions,
      });
    }

    const msg = formatReconciliationMessage(result);
    const status = result.success !== false ? 'success' : 'error';
    progressDialog.updateStepStatus(accountId, 'pending', status, msg);
    debugLog(`[orchestrator] Pending reconciliation for ${integrationId}:`, result);
    return result;
  } catch (error) {
    debugLog('[orchestrator] Error during pending reconciliation:', error);
    progressDialog.updateStepStatus(accountId, 'pending', 'error', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Sync a single account to Monarch using the generic orchestrator.
 *
 * Drives the full sync workflow:
 * 1. Credit limit sync (if capable)
 * 2. Transaction fetch & separation
 * 3. Pending reconciliation (if enabled) — saves settled ref IDs to dedup store
 * 4. Transaction process → dedup → categorize → CSV → upload
 * 5. Balance upload (single-day or reconstructed history)
 *
 * @param {Object} params - Sync parameters
 * @param {string} params.integrationId - Integration identifier
 * @param {Object} params.manifest - Integration manifest
 * @param {import('../../integrations/types').SyncHooks} params.hooks - Sync hooks
 * @param {Object} params.api - Integration API client
 * @param {Object} params.account - Source account object
 * @param {string} params.account.accountId - Source account ID
 * @param {string} params.accountDisplayName - Display name
 * @param {Object} params.monarchAccount - Monarch account mapping
 * @param {string} params.monarchAccount.id - Monarch account ID
 * @param {string} params.fromDate - Start date
 * @param {boolean} [params.reconstructBalance=false] - Whether to reconstruct balance history
 * @param {boolean} [params.firstSync=false] - Whether this is the first sync
 * @param {Object} params.progressDialog - Progress dialog instance
 * @returns {Promise<{success: boolean, message: string}>} Sync result
 */
export async function syncAccount({
  integrationId,
  manifest,
  hooks,
  api,
  account,
  accountDisplayName,
  monarchAccount,
  fromDate,
  reconstructBalance = false,
  firstSync = false,
  progressDialog,
}) {
  const { accountId } = account;
  const monarchAccountId = monarchAccount.id;
  const capabilities = manifest.capabilities || {};
  const txIdPrefix = manifest.txIdPrefix || null;

  // Read account settings
  const accountData = accountService.getAccountData(integrationId, accountId);
  const includePendingTransactions = accountData?.[ACCOUNT_SETTINGS.INCLUDE_PENDING_TRANSACTIONS] !== false;
  const storeTransactionDetailsInNotes = accountData?.storeTransactionDetailsInNotes ?? false;

  // Initialize progress dialog steps
  progressDialog.initSteps(accountId, buildSyncSteps({
    hasCreditLimit: capabilities.hasCreditLimit,
    includeTransactions: capabilities.hasTransactions,
    includePending: includePendingTransactions,
  }));

  const abortController = new AbortController();
  progressDialog.onCancel(() => abortController.abort());

  try {
    // ── STEP 1: Credit Limit Sync ──────────────────────────
    if (capabilities.hasCreditLimit) {
      await executeCreditLimitStep({
        integrationId, accountId, monarchAccountId, api, progressDialog, abortController,
      });
    }

    // ── STEP 2: Fetch & Separate Transactions ──────────────
    let fetchData = null;
    let txStepResult = null;

    if (capabilities.hasTransactions) {
      fetchData = await fetchAndSeparateTransactions({
        accountId, api, fromDate, txIdPrefix, hooks,
        abortController,
      });
    }

    // ── STEP 3: Pending Reconciliation ─────────────────────
    // Runs BEFORE transaction upload so settled ref IDs are saved to dedup store,
    // preventing the settled version from being uploaded as a duplicate.
    if (includePendingTransactions && fetchData && txIdPrefix && hooks.getPendingIdFields) {
      await executePendingReconciliationStep({
        integrationId, accountId, monarchAccountId,
        rawPending: fetchData.rawPending,
        rawSettled: fetchData.rawSettled,
        txIdPrefix, hooks, progressDialog, abortController,
      });
    }

    // ── STEP 4: Process, Dedup & Upload Transactions ───────
    if (fetchData) {
      txStepResult = await executeTransactionStep({
        integrationId, accountId, accountDisplayName, monarchAccountId, fromDate,
        includePendingTransactions, storeTransactionDetailsInNotes,
        dedupSettled: fetchData.dedupSettled,
        dedupPending: fetchData.dedupPending,
        hooks, progressDialog, abortController,
      });
    }

    // ── STEP 5: Balance Upload ─────────────────────────────
    if (abortController.signal.aborted) throw new Error('Cancelled');

    progressDialog.updateStepStatus(accountId, 'balance', 'processing', 'Preparing...');

    // Read invertBalance setting
    const balanceAccountData = accountService.getAccountData(integrationId, accountId);
    const invertBalance = balanceAccountData?.invertBalance === true;

    // Get current balance
    let currentBalance = null;
    try {
      const balanceData = await api.getBalance(accountId);
      currentBalance = balanceData.currentBalance;
    } catch (error) {
      debugLog('[orchestrator] Error fetching balance:', error);
    }

    // Build balance history if reconstruction is possible.
    // On first sync: only if user opted in (reconstructBalance flag from date picker).
    // On subsequent syncs: always reconstruct when the hook and metadata are available,
    // so Monarch gets multi-day balance coverage instead of just today's snapshot.
    let balanceHistory = null;
    const shouldReconstruct = !!(hooks.buildBalanceHistory && fetchData?.metadata
      && (firstSync ? reconstructBalance : true));

    if (shouldReconstruct) {
      progressDialog.updateStepStatus(accountId, 'balance', 'processing', 'Reconstructing...');
      balanceHistory = hooks.buildBalanceHistory({
        currentBalance,
        metadata: fetchData.metadata,
        fromDate,
        invertBalance,
      });
    }

    // Use common balance upload service
    await executeBalanceUploadStep({
      integrationId,
      sourceAccountId: accountId,
      monarchAccountId,
      accountName: accountDisplayName,
      currentBalance,
      invertBalance,
      reconstructBalance: shouldReconstruct,
      balanceHistory,
      fromDate,
      progressDialog,
    });

    // ── Update sync metadata ───────────────────────────────
    accountService.updateAccountInList(integrationId, accountId, {
      lastSyncDate: getTodayLocal(),
    });

    // Increment sync count and cleanup legacy storage if ready
    const newSyncCount = accountService.incrementSyncCount(integrationId, accountId);
    debugLog(`[orchestrator] Sync count for ${accountId}: ${newSyncCount}`);
    if (accountService.isReadyForLegacyCleanup(integrationId, accountId)) {
      const cleanupResult = accountService.cleanupLegacyStorage(integrationId, accountId);
      if (cleanupResult.cleaned && cleanupResult.keysDeleted > 0) {
        debugLog(`[orchestrator] Cleaned up ${cleanupResult.keysDeleted} legacy storage keys`);
      }
    }

    // Show summary
    progressDialog.hideCancel();
    progressDialog.showSummary({ success: 1, failed: 0, total: 1 });

    const summaryParts = [];
    if (txStepResult?.success) summaryParts.push('Transactions synced');
    summaryParts.push('Balance uploaded');

    return { success: true, message: summaryParts.join(', ') };
  } catch (error) {
    debugLog(`[orchestrator] Sync error for ${integrationId}:`, error);

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

export default {
  syncAccount,
};