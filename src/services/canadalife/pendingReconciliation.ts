/**
 * Canada Life Pending Transaction Reconciliation
 *
 * Handles reconciliation of pending Canada Life transactions in Monarch.
 * When a pending activity disappears from the Canada Life API (either because
 * it settled or was cancelled), the corresponding Monarch transaction is deleted.
 *
 * Trade-off: Canada Life pending activities produce a different hash than their
 * settled counterpart because both activity.Activity and activity.Units change
 * on settlement. Therefore reconciliation cannot detect settlement — the pending
 * transaction is always deleted when it disappears. The settled transaction is
 * uploaded as a new independent entry. User tags and notes on the pending entry
 * are lost. This is an accepted trade-off since Canada Life provides no stable
 * ID linking pending to settled.
 *
 * Pending transaction ID format: cl-tx:{16 hex chars}
 * Stored in Monarch transaction notes for lookup during reconciliation.
 *
 * @module services/canadalife/pendingReconciliation
 */

import { debugLog } from '../../core/utils';
import monarchApi from '../../api/monarch';
import { generateActivityHash } from './transactions';
import { extractPendingIdFromNotes, fetchMonarchPendingTransactions } from '../common/pendingReconciliation';

/**
 * ID prefix for Canada Life pending transactions stored in Monarch notes
 * Format: cl-tx:{16 hex chars}
 */
const CL_TX_ID_PREFIX = 'cl-tx';

/**
 * Phase 2: Reconcile pre-fetched Monarch pending transactions against Canada Life activities.
 *
 * Accepts pre-fetched pendingTag and monarchPendingTransactions from the shared Phase 1.
 * Uses cl-tx:{hash} matching (activity hash-based, not externalCanonicalId).
 *
 * Algorithm:
 * 1. Build a set of current activity hashes from currentActivities
 * 2. For each pending Monarch transaction:
 *    - Extract cl-tx:{hash} from notes
 *    - If hash found in current activities → still pending, no action
 *    - If hash not found → activity gone (settled or cancelled) → delete from Monarch
 *
 * @param pendingTag - Monarch "Pending" tag object
 * @param monarchPendingTransactions - Pre-fetched Monarch transactions with Pending tag
 * @param currentActivities - Raw activities currently returned by Canada Life API
 * @returns Result: { success, cancelled, failed, error }
 */
export async function reconcileCanadaLifeFetchedPending(
  pendingTag: { id: string; name: string },
  monarchPendingTransactions: Array<Record<string, unknown>>,
  currentActivities: unknown[],
) {
  const result = {
    success: true, cancelled: 0, failed: 0, error: null,
  };

  try {
    debugLog('[cl-reconciliation:phase2] Starting reconciliation', {
      monarchPendingCount: monarchPendingTransactions.length,
      currentActivitiesCount: currentActivities?.length || 0,
    });

    // Build set of current activity hashes from Canada Life API
    const currentActivityIds = new Set();
    for (const activity of (currentActivities || [])) {
      const hash = await generateActivityHash(activity);
      currentActivityIds.add(hash);
    }

    debugLog(`[cl-reconciliation:phase2] Built ${currentActivityIds.size} current activity hashes`);

    // Process each pending Monarch transaction
    for (const monarchTx of monarchPendingTransactions) {
      try {
        const monarchTxId = monarchTx.id;
        const notes = (monarchTx.notes as string) || '';

        const pendingId = extractPendingIdFromNotes(CL_TX_ID_PREFIX, notes);

        if (!pendingId) {
          debugLog(`[cl-reconciliation:phase2] Could not extract pending ID from notes: "${notes}", skipping`);
          continue;
        }

        debugLog(`[cl-reconciliation:phase2] Reconciling ${monarchTxId} with ID: ${pendingId}`);

        // If the activity hash is still present → still pending, no action
        if (currentActivityIds.has(pendingId)) {
          debugLog(`[cl-reconciliation:phase2] Activity ${pendingId} still pending, no action`);
          continue;
        }

        // Activity not found — settled or cancelled → delete from Monarch
        // Note: We cannot distinguish settled from cancelled (see module trade-off comment).
        // The settled transaction will be uploaded as a new independent entry.
        debugLog(`[cl-reconciliation:phase2] Activity ${pendingId} no longer present, deleting from Monarch`);
        await monarchApi.deleteTransaction(monarchTxId as string);
        result.cancelled += 1;
      } catch (txError) {
        debugLog(`[cl-reconciliation:phase2] Error reconciling ${monarchTx.id}:`, txError);
        result.failed += 1;
      }
    }

    debugLog('[cl-reconciliation:phase2] Completed', {
      cancelled: result.cancelled,
      failed: result.failed,
    });

    return result;
  } catch (error) {
    debugLog('[cl-reconciliation:phase2] Error:', error);
    return { ...result, success: false, error: (error as Error).message };
  }
}

/**
 * Convenience wrapper: Reconcile pending Canada Life transactions for an account.
 *
 * Combines Phase 1 (shared fetchMonarchPendingTransactions) and Phase 2
 * (CL-specific reconcileCanadaLifeFetchedPending) in a single call.
 * Kept for backward compatibility with existing callers.
 *
 * @param {string} monarchAccountId - Monarch account ID
 * @param {Array} currentActivities - Raw activities currently returned by Canada Life API
 * @param {number} lookbackDays - Days to look back for pending transactions (default: 90)
 * @returns {Promise<Object>} Result: { success, cancelled, failed, error, noPendingTag?, noPendingTransactions? }
 */
export async function reconcileCanadaLifePendingTransactions(
  monarchAccountId,
  currentActivities,
  lookbackDays = 90,
) {
  const emptyResult = {
    success: true, cancelled: 0, failed: 0, error: null,
  };

  try {
    // Phase 1: Fetch pending transactions from Monarch (shared)
    const phase1 = await fetchMonarchPendingTransactions(monarchAccountId, lookbackDays);

    if (phase1.noPendingTag) {
      return { ...emptyResult, noPendingTag: true };
    }
    if (phase1.noPendingTransactions || phase1.monarchPendingTransactions.length === 0) {
      return { ...emptyResult, noPendingTransactions: true };
    }

    // Phase 2: CL-specific reconciliation
    return await reconcileCanadaLifeFetchedPending(
      phase1.pendingTag!,
      phase1.monarchPendingTransactions,
      currentActivities,
    );
  } catch (error) {
    debugLog('[cl-reconciliation] Error:', error);
    return { ...emptyResult, success: false, error: (error as Error).message };
  }
}

/**
 * Format reconciliation result message for the progress dialog.
 * @param {Object} result - Result from reconcileCanadaLifePendingTransactions
 * @returns {string} Formatted message
 */
export function formatReconciliationMessage(result) {
  if (result.noPendingTag || result.noPendingTransactions) {
    return 'No pending transactions';
  }

  const parts = [];

  if (result.cancelled > 0) {
    parts.push(`${result.cancelled} removed`);
  }

  if (result.failed > 0) {
    parts.push(`${result.failed} failed`);
  }

  if (parts.length === 0) {
    return 'Nothing to reconcile';
  }

  return parts.join(', ');
}

