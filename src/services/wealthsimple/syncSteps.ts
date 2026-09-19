/**
 * Wealthsimple Sync Steps
 *
 * Step executors used by the Wealthsimple upload service. Extracted from
 * `wealthsimple-upload.ts` to keep the per-account sync orchestration function
 * within the project's function-length limits.
 *
 * Step ordering note: pending reconciliation MUST run BEFORE transaction upload
 * (matching Rogers Bank and the generic sync orchestrator). Reconciliation
 * records the settled transaction IDs in the dedup store, which prevents the
 * settled version of a previously-pending transaction from being uploaded to
 * Monarch as a brand-new duplicate.
 *
 * @module services/wealthsimple/syncSteps
 */

import { debugLog } from '../../core/utils';
import wealthsimpleApi from '../../api/wealthsimple';
import { uploadWealthsimpleTransactions, saveReconciledSettledIds } from './account';
import { reconcileWealthsimpleFetchedPending, type ReconciliationResult } from './transactionsReconciliation';
import type { FetchPendingResult } from '../common/pendingReconciliation';

/** Minimal progress dialog surface needed by the step executors */
interface StepProgressDialog {
  updateStepStatus: (accountId: string, step: string, status: string, message: string) => void;
}

/** Result of the transaction sync step */
export interface TransactionStepResult {
  /** Number of transactions uploaded to Monarch */
  synced: number;
}

/**
 * Outcome of the raw Wealthsimple transaction fetch.
 *
 * A failed fetch and a genuinely empty feed both produce an empty
 * `transactions` array, so `fetchFailed` is what tells them apart. Pending
 * reconciliation deletes Monarch rows it cannot find in this feed, so it MUST
 * NOT run on a feed that only looks empty because the request failed.
 */
export interface RawTransactionsResult {
  /** Raw transactions returned by Wealthsimple (empty when the fetch failed) */
  transactions: unknown[];
  /** True when the Wealthsimple request threw — the empty list is not trustworthy */
  fetchFailed: boolean;
  /** Fetch error message, or null on success */
  error: string | null;
}

/**
 * Fetch raw Wealthsimple transactions for an account.
 *
 * Fetch failures are non-fatal for the sync as a whole (balance/positions still
 * run), but they are reported via `fetchFailed` so reconciliation can refuse to
 * treat the empty result as "everything was cancelled".
 *
 * @param accountId - Wealthsimple account ID
 * @param fromDate - Start date (YYYY-MM-DD)
 * @param progressDialog - Progress dialog instance
 * @returns Fetch outcome with the transactions and a failure flag
 */
export async function fetchRawTransactions(
  accountId: string,
  fromDate: string,
  progressDialog: StepProgressDialog,
): Promise<RawTransactionsResult> {
  progressDialog.updateStepStatus(accountId, 'transactions', 'processing', 'Fetching from WS...');

  try {
    const rawTransactions = (await wealthsimpleApi.fetchTransactions(accountId, fromDate)) as unknown[];
    const fetchedCount = rawTransactions?.length || 0;
    debugLog(`Fetched ${fetchedCount} raw transactions for account ${accountId}`);
    progressDialog.updateStepStatus(accountId, 'transactions', 'processing', `Fetched ${fetchedCount}`);
    return { transactions: rawTransactions || [], fetchFailed: false, error: null };
  } catch (fetchError: unknown) {
    debugLog('Error fetching raw transactions:', fetchError);
    const message = (fetchError as Error)?.message || 'Failed to fetch Wealthsimple transactions';
    return { transactions: [], fetchFailed: true, error: message };
  }
}

/**
 * Format transaction count message for display in step status
 */
function formatTransactionCountMessage(synced: number, skipped: number): string {
  const parts: string[] = [];

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
 * Execute the pending reconciliation step (Phase 2).
 *
 * Reconciles pre-fetched Monarch pending transactions against the current
 * Wealthsimple feed, then persists the settled transaction IDs so the
 * transaction upload step skips them.
 *
 * A null/failed `phase1Result` is reported as an ERROR (not "no pending
 * transactions") so silent Phase 1 failures are visible in the sync report.
 *
 * A failed Wealthsimple fetch (`sourceFetchFailed`) is likewise reported as an
 * error and skips Phase 2 entirely: reconciliation deletes Monarch pending rows
 * that are absent from the feed, and an unavailable feed would delete every one
 * of them together with the user's categories, notes and splits.
 *
 * @param params - Step parameters
 * @returns Reconciliation result
 */
export async function executePendingReconciliationStep({
  accountId,
  accountType,
  phase1Result,
  phase1Error,
  rawTransactions,
  sourceFetchFailed = false,
  stripStoreNumbers,
  progressDialog,
}: {
  accountId: string;
  accountType: string;
  phase1Result: FetchPendingResult | null;
  phase1Error: string | null;
  rawTransactions: unknown[];
  /** True when the Wealthsimple transaction fetch failed (see `fetchRawTransactions`) */
  sourceFetchFailed?: boolean;
  stripStoreNumbers: boolean;
  progressDialog: StepProgressDialog;
}): Promise<ReconciliationResult> {
  progressDialog.updateStepStatus(accountId, 'pendingReconciliation', 'processing', 'Reconciling pending');

  // Phase 1 failed — surface the error instead of masking it as "no pending"
  if (!phase1Result) {
    const message = phase1Error || 'Could not fetch pending transactions';
    debugLog(`[ws-sync] Pending reconciliation unavailable for ${accountId}: ${message}`);
    progressDialog.updateStepStatus(accountId, 'pendingReconciliation', 'error', message);
    return { success: false, settled: 0, cancelled: 0, failed: 0, error: message, settledRefIds: [] };
  }

  // Source feed unavailable — skip rather than read "absent" as "cancelled"
  if (sourceFetchFailed) {
    const message = 'Wealthsimple transactions unavailable — skipped';
    debugLog(`[ws-sync] Skipping pending reconciliation for ${accountId}: source fetch failed`);
    progressDialog.updateStepStatus(accountId, 'pendingReconciliation', 'error', message);
    return {
      success: false, settled: 0, cancelled: 0, failed: 0, error: message, settledRefIds: [], sourceUnavailable: true,
    };
  }

  if (phase1Result.noPendingTag) {
    progressDialog.updateStepStatus(accountId, 'pendingReconciliation', 'success', 'No pending transactions');
    return { success: true, settled: 0, cancelled: 0, failed: 0, error: null, settledRefIds: [], noPendingTag: true };
  }

  if (phase1Result.noPendingTransactions || phase1Result.monarchPendingTransactions.length === 0) {
    progressDialog.updateStepStatus(accountId, 'pendingReconciliation', 'success', 'No pending transactions');
    return { success: true, settled: 0, cancelled: 0, failed: 0, error: null, settledRefIds: [], noPendingTransactions: true };
  }

  const result = await reconcileWealthsimpleFetchedPending(
    phase1Result.pendingTag!,
    phase1Result.monarchPendingTransactions,
    rawTransactions as Record<string, unknown>[],
    accountType,
    { stripStoreNumbers },
  );

  // Persist settled IDs BEFORE the upload step so the settled version of a
  // reconciled transaction is treated as already uploaded.
  saveReconciledSettledIds(accountId, result.settledRefIds);

  debugLog(`[ws-sync] Pending reconciliation completed for ${accountId}:`, result);
  return result;
}

/**
 * Execute the transaction sync step.
 *
 * Processes and uploads the pre-fetched raw transactions to Monarch.
 *
 * @param params - Step parameters
 * @returns Step result with the number of synced transactions
 */
export async function executeTransactionSyncStep({
  accountId,
  monarchAccountId,
  fromDate,
  toDate,
  rawTransactions,
  progressDialog,
}: {
  accountId: string;
  monarchAccountId: string;
  fromDate: string;
  toDate: string;
  rawTransactions: unknown[];
  progressDialog: StepProgressDialog;
}): Promise<TransactionStepResult> {
  const onProgress = (stage: string) => {
    progressDialog.updateStepStatus(accountId, 'transactions', 'processing', stage);
  };

  const transactionsResult = await uploadWealthsimpleTransactions(
    accountId,
    monarchAccountId,
    fromDate,
    toDate,
    { rawTransactions, onProgress },
  );

  if (transactionsResult && transactionsResult.success) {
    const message = formatTransactionCountMessage(transactionsResult.synced, transactionsResult.skipped);
    progressDialog.updateStepStatus(accountId, 'transactions', 'success', message);
    return { synced: transactionsResult.synced || 0 };
  }

  if (transactionsResult && transactionsResult.unsupported) {
    progressDialog.updateStepStatus(accountId, 'transactions', 'skipped', 'Not supported');
    return { synced: 0 };
  }

  const errorMsg = transactionsResult?.error || 'Sync failed';
  progressDialog.updateStepStatus(accountId, 'transactions', 'error', errorMsg);
  return { synced: 0 };
}