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

import { debugLog, formatDate } from '../../core/utils';
import monarchApi from '../../api/monarch';
import { generateActivityHash } from './transactions';
import { extractPendingIdFromNotes } from '../common/pendingReconciliation';

/**
 * ID prefix for Canada Life pending transactions stored in Monarch notes
 * Format: cl-tx:{16 hex chars}
 */
const CL_TX_ID_PREFIX = 'cl-tx';

/**
 * Reconcile pending Canada Life transactions for an account.
 *
 * Algorithm:
 * 1. Fetch "Pending" tag from Monarch — if absent, return early
 * 2. Fetch Monarch transactions with "Pending" tag for the account (lookback window)
 * 3. Build a set of current activity hashes from currentActivities
 * 4. For each pending Monarch transaction:
 *    - Extract cl-tx:{hash} from notes
 *    - If hash found in current activities → still pending, no action
 *    - If hash not found → activity gone (settled or cancelled) → delete from Monarch
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
  const result = {
    success: true, cancelled: 0, failed: 0, error: null,
  };

  try {
    debugLog('[cl-reconciliation] Starting pending reconciliation', {
      monarchAccountId,
      currentActivitiesCount: currentActivities?.length || 0,
      lookbackDays,
    });

    // Step 1: Get the "Pending" tag from Monarch
    const pendingTag = await monarchApi.getTagByName('Pending');
    if (!pendingTag) {
      debugLog('[cl-reconciliation] No "Pending" tag found in Monarch, skipping');
      return { ...result, noPendingTag: true };
    }

    // Step 2: Calculate date range
    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - lookbackDays);
    const endDate = new Date(today);
    endDate.setFullYear(endDate.getFullYear() + 1);

    const startDateStr = formatDate(startDate);
    const endDateStr = formatDate(endDate);

    debugLog(`[cl-reconciliation] Searching from ${startDateStr} to ${endDateStr}`);

    // Step 3: Fetch Monarch transactions with "Pending" tag for this account
    const pendingTransactionsResult = await monarchApi.getTransactionsList({
      accountIds: [monarchAccountId],
      tags: [pendingTag.id],
      startDate: startDateStr,
      endDate: endDateStr,
    });

    const pendingMonarchTransactions = pendingTransactionsResult.results || [];

    if (pendingMonarchTransactions.length === 0) {
      debugLog('[cl-reconciliation] No pending transactions found in Monarch');
      return { ...result, noPendingTransactions: true };
    }

    debugLog(`[cl-reconciliation] Found ${pendingMonarchTransactions.length} pending transaction(s) to reconcile`);

    // Step 4: Build set of current activity hashes from Canada Life API
    const currentActivityIds = new Set();
    for (const activity of (currentActivities || [])) {
      const hash = await generateActivityHash(activity);
      currentActivityIds.add(hash);
    }

    debugLog(`[cl-reconciliation] Built ${currentActivityIds.size} current activity hashes`);

    // Step 5: Process each pending Monarch transaction
    for (const monarchTx of pendingMonarchTransactions) {
      try {
        const monarchTxId = monarchTx.id;
        const notes = monarchTx.notes || '';

        const pendingId = extractPendingIdFromNotes(CL_TX_ID_PREFIX, notes);

        if (!pendingId) {
          debugLog(`[cl-reconciliation] Could not extract pending ID from notes: "${notes}", skipping`);
          continue;
        }

        debugLog(`[cl-reconciliation] Reconciling ${monarchTxId} with ID: ${pendingId}`);

        // If the activity hash is still present → still pending, no action
        if (currentActivityIds.has(pendingId)) {
          debugLog(`[cl-reconciliation] Activity ${pendingId} still pending, no action`);
          continue;
        }

        // Activity not found — settled or cancelled → delete from Monarch
        // Note: We cannot distinguish settled from cancelled (see module trade-off comment).
        // The settled transaction will be uploaded as a new independent entry.
        debugLog(`[cl-reconciliation] Activity ${pendingId} no longer present, deleting from Monarch`);
        await monarchApi.deleteTransaction(monarchTxId);
        result.cancelled += 1;
      } catch (txError) {
        debugLog(`[cl-reconciliation] Error reconciling ${monarchTx.id}:`, txError);
        result.failed += 1;
      }
    }

    debugLog('[cl-reconciliation] Completed', {
      cancelled: result.cancelled,
      failed: result.failed,
    });

    return result;
  } catch (error) {
    debugLog('[cl-reconciliation] Error:', error);
    return { ...result, success: false, error: error.message };
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

export default {
  reconcileCanadaLifePendingTransactions,
  formatReconciliationMessage,
  CL_TX_ID_PREFIX,
};