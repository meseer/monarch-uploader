/**
 * Pending Transaction Reconciliation Service
 *
 * Generic pending transaction reconciliation for any integration that
 * supports pending transactions. Handles ID generation (hashing),
 * ID extraction from Monarch notes, and the reconciliation algorithm
 * (settle / skip / cancel) against Monarch transactions.
 *
 * Institution-specific logic is injected via:
 * - `txIdPrefix` from the integration manifest (e.g., 'mbna-tx')
 * - `getPendingIdFields(tx)` hook that returns stable field values to hash
 *
 * @module services/common/pendingReconciliation
 */

import { debugLog, formatDate } from '../../core/utils';
import monarchApi from '../../api/monarch';

/** Result of the reconciliation process */
interface ReconciliationResult {
  success: boolean;
  settled: number;
  cancelled: number;
  failed: number;
  error: string | null;
  settledRefIds: string[];
  noPendingTag?: boolean;
  noPendingTransactions?: boolean;
}

/** Parameters for reconcilePendingTransactions */
interface ReconcileParams {
  txIdPrefix: string;
  monarchAccountId: string;
  rawPending: unknown[];
  rawSettled: unknown[];
  lookbackDays: number;
  getPendingIdFields: (tx: unknown) => string[];
  getSettledAmount: (tx: unknown) => number;
  getSettledRefId?: (tx: unknown) => string | null;
}

/** Parameters for separateAndDeduplicateTransactions */
interface SeparateParams {
  txIdPrefix: string;
  getPendingIdFields: (tx: unknown) => string[];
  pending: unknown[];
  settled: unknown[];
}

/** Result of separateAndDeduplicateTransactions */
interface SeparateResult {
  settled: unknown[];
  pending: Array<unknown & { generatedId: string; isPending: true }>;
  pendingIdMap: Map<string, unknown>;
  settledIdMap: Map<string, unknown>;
  duplicatesRemoved: number;
}

/**
 * Generate a deterministic pending transaction ID by hashing stable fields.
 *
 * Uses the Web Crypto API for SHA-256, returns the first 16 hex chars
 * prefixed with the integration's txIdPrefix.
 *
 * @param {string} txIdPrefix - Integration prefix (e.g., 'mbna-tx')
 * @param {Array<string>} fieldValues - Ordered stable field values from getPendingIdFields hook
 * @returns {Promise<string>} Generated ID in format {prefix}:{hash16}
 */
export async function generatePendingTransactionId(txIdPrefix: string, fieldValues: string[]): Promise<string> {
  const hashInput = fieldValues.join('|');

  const encoder = new TextEncoder();
  const data = encoder.encode(hashInput);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);

  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

  return `${txIdPrefix}:${hashHex.substring(0, 16)}`;
}

/**
 * Build a regex pattern for extracting a pending transaction ID from notes.
 *
 * @param {string} txIdPrefix - Integration prefix (e.g., 'mbna-tx')
 * @returns {RegExp} Pattern matching {prefix}:{16 hex chars}
 */
function buildIdPattern(txIdPrefix: string): RegExp {
  // Escape any regex-special characters in the prefix
  const escaped = txIdPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${escaped}:([a-f0-9]{16})`);
}

/**
 * Extract a pending transaction ID from Monarch transaction notes.
 *
 * @param {string} txIdPrefix - Integration prefix (e.g., 'mbna-tx')
 * @param {string} notes - Transaction notes from Monarch
 * @returns {string|null} Full pending ID (e.g., 'mbna-tx:abc123...') or null
 */
export function extractPendingIdFromNotes(txIdPrefix: string, notes: string): string | null {
  if (!notes || typeof notes !== 'string') {
    return null;
  }

  const pattern = buildIdPattern(txIdPrefix);
  const match = notes.match(pattern);
  if (!match) {
    return null;
  }

  return `${txIdPrefix}:${match[1]}`;
}

/**
 * Remove pending transaction ID from notes, preserving user content.
 *
 * @param {string} txIdPrefix - Integration prefix (e.g., 'mbna-tx')
 * @param {string} notes - Transaction notes
 * @returns {string} Cleaned notes
 */
export function cleanPendingIdFromNotes(txIdPrefix: string, notes: string): string {
  if (!notes || typeof notes !== 'string') {
    return '';
  }

  // Escape prefix for regex
  const escaped = txIdPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`${escaped}:[a-f0-9]{16}`, 'g');

  let cleaned = notes.replace(pattern, '');

  // Clean up trailing/leading whitespace and newlines
  cleaned = cleaned.replace(/\n+$/g, '');
  cleaned = cleaned.replace(/^\n+/g, '');
  cleaned = cleaned.replace(/ +/g, ' ');

  return cleaned.trim();
}

/**
 * Build hash ID maps for a set of raw transactions using the getPendingIdFields hook.
 *
 * @param {string} txIdPrefix - Integration prefix
 * @param {Function} getPendingIdFields - Hook: (tx) => Array<string>
 * @param {Array} settled - Raw settled transactions
 * @param {Array} pending - Raw pending transactions
 * @returns {Promise<{settledIdMap: Map, pendingIdMap: Map, duplicatesRemoved: number}>}
 */
async function buildHashMaps(
  txIdPrefix: string,
  getPendingIdFields: (tx: unknown) => string[],
  settled: unknown[],
  pending: unknown[],
): Promise<{ settledIdMap: Map<string, unknown>; pendingIdMap: Map<string, unknown>; duplicatesRemoved: number }> {
  const settledIdMap = new Map();
  for (const tx of settled) {
    const fields = getPendingIdFields(tx);
    const hashId = await generatePendingTransactionId(txIdPrefix, fields);
    settledIdMap.set(hashId, tx);
  }

  const pendingIdMap = new Map();
  let duplicatesRemoved = 0;

  for (const tx of pending) {
    const fields = getPendingIdFields(tx);
    const hashId = await generatePendingTransactionId(txIdPrefix, fields);

    // Remove pending if settled version exists with same hash
    if (settledIdMap.has(hashId)) {
      debugLog(`[reconciliation] Removing duplicate pending (settled exists): ${hashId}`);
      duplicatesRemoved += 1;
      continue;
    }

    pendingIdMap.set(hashId, tx);
  }

  return { settledIdMap, pendingIdMap, duplicatesRemoved };
}

/**
 * Reconcile pending transactions for an account.
 *
 * Generic algorithm:
 * 1. Fetch Monarch transactions with "Pending" tag for the account
 * 2. For each, extract the pending ID from notes
 * 3. Compare against current source transactions:
 *    - Hash matches settled → update amount, remove Pending tag, clean notes
 *    - Hash matches still-pending → no action
 *    - Hash not found → cancelled → delete from Monarch
 *
 * @param {Object} params - Reconciliation parameters
 * @param {string} params.txIdPrefix - Integration prefix (e.g., 'mbna-tx')
 * @param {string} params.monarchAccountId - Monarch account ID
 * @param {Array} params.rawPending - Current pending transactions from source
 * @param {Array} params.rawSettled - Current settled transactions from source
 * @param {number} params.lookbackDays - Days to look back for pending transactions
 * @param {Function} params.getPendingIdFields - Hook: (tx) => Array<string>
 * @param {Function} params.getSettledAmount - Hook: (settledTx) => number (Monarch-normalized amount)
 * @param {Function} [params.getSettledRefId] - Hook: (settledTx) => string (settled reference ID for dedup)
 * @returns {Promise<Object>} Reconciliation result including settledRefIds array
 */
export async function reconcilePendingTransactions({
  txIdPrefix,
  monarchAccountId,
  rawPending,
  rawSettled,
  lookbackDays,
  getPendingIdFields,
  getSettledAmount,
  getSettledRefId,
}: ReconcileParams): Promise<ReconciliationResult> {
  const result: ReconciliationResult = { success: true, settled: 0, cancelled: 0, failed: 0, error: null, settledRefIds: [] };

  try {
    debugLog(`[reconciliation] Starting pending reconciliation for ${txIdPrefix}`, {
      monarchAccountId,
      pendingCount: rawPending?.length || 0,
      settledCount: rawSettled?.length || 0,
      lookbackDays,
    });

    // Step 1: Get the "Pending" tag from Monarch
    const pendingTag = await monarchApi.getTagByName('Pending');

    if (!pendingTag) {
      debugLog('[reconciliation] No "Pending" tag found in Monarch, skipping');
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

    debugLog(`[reconciliation] Searching from ${startDateStr} to ${endDateStr}`);

    // Step 3: Fetch Monarch transactions with Pending tag for this account
    const pendingTransactionsResult = await monarchApi.getTransactionsList({
      accountIds: [monarchAccountId],
      tags: [pendingTag.id],
      startDate: startDateStr,
      endDate: endDateStr,
    });

    const pendingMonarchTransactions = pendingTransactionsResult.results || [];

    if (pendingMonarchTransactions.length === 0) {
      debugLog('[reconciliation] No pending transactions found in Monarch');
      return { ...result, noPendingTransactions: true };
    }

    debugLog(`[reconciliation] Found ${pendingMonarchTransactions.length} pending transaction(s) to reconcile`);

    // Step 4: Build hash ID maps for current source transactions
    const { settledIdMap, pendingIdMap } = await buildHashMaps(
      txIdPrefix,
      getPendingIdFields,
      rawSettled || [],
      rawPending || [],
    );

    debugLog(`[reconciliation] Lookup: ${settledIdMap.size} settled hashes, ${pendingIdMap.size} pending hashes`);

    // Step 5: Process each pending Monarch transaction
    for (const monarchTx of pendingMonarchTransactions) {
      try {
        const monarchTxId = monarchTx.id;
        const notes = monarchTx.notes || '';

        const pendingId = extractPendingIdFromNotes(txIdPrefix, notes);

        if (!pendingId) {
          debugLog(`[reconciliation] Could not extract pending ID from notes: "${notes}", skipping`);
          continue;
        }

        debugLog(`[reconciliation] Reconciling ${monarchTxId} with ID: ${pendingId}`);

        // Check if transaction has settled
        if (settledIdMap.has(pendingId)) {
          const settledTx = settledIdMap.get(pendingId);
          debugLog(`[reconciliation] Transaction ${pendingId} has settled, updating`);

          const settledAmount = getSettledAmount(settledTx);
          const cleanedNotes = cleanPendingIdFromNotes(txIdPrefix, notes);
          const amountChanged = monarchTx.amount !== settledAmount;

          // Update notes (clean pending ID)
          await monarchApi.updateTransaction(monarchTxId, {
            notes: cleanedNotes,
            ownerUserId: monarchTx.ownedByUser?.id || null,
          });

          // Update amount only if it changed
          if (amountChanged) {
            await monarchApi.updateTransaction(monarchTxId, {
              amount: settledAmount,
              ownerUserId: monarchTx.ownedByUser?.id || null,
            });
          }

          // Remove Pending tag, preserving other tags
          const remainingTagIds = (monarchTx.tags || [])
            .filter((tag) => tag.id !== pendingTag.id)
            .map((tag) => tag.id);
          await monarchApi.setTransactionTags(monarchTxId, remainingTagIds);

          // Collect settled ref ID for dedup store
          if (getSettledRefId) {
            const settledRef = getSettledRefId(settledTx);
            if (settledRef) {
              result.settledRefIds.push(settledRef);
            }
          }

          result.settled += 1;
          continue;
        }

        // Check if transaction is still pending
        if (pendingIdMap.has(pendingId)) {
          debugLog(`[reconciliation] Transaction ${pendingId} is still pending, no action`);
          continue;
        }

        // Transaction not found — likely cancelled
        debugLog(`[reconciliation] Transaction ${pendingId} not found, deleting from Monarch`);
        await monarchApi.deleteTransaction(monarchTxId);
        result.cancelled += 1;
      } catch (txError) {
        debugLog(`[reconciliation] Error reconciling ${monarchTx.id}:`, txError);
        result.failed += 1;
      }
    }

    debugLog('[reconciliation] Completed', {
      settled: result.settled,
      cancelled: result.cancelled,
      failed: result.failed,
    });

    return result;
  } catch (error) {
    debugLog('[reconciliation] Error:', error);
    return { ...result, success: false, error: error.message };
  }
}

/**
 * Separate raw transactions into pending and settled, deduplicate using hash IDs.
 *
 * Generic version of the separation logic used by MBNA and Rogers Bank.
 * Generates hash IDs for both sets and removes pending transactions whose
 * hash matches a settled transaction (settled takes precedence).
 *
 * @param {Object} params - Parameters
 * @param {string} params.txIdPrefix - Integration prefix
 * @param {Function} params.getPendingIdFields - Hook: (tx) => Array<string>
 * @param {Array} params.pending - Raw pending transactions
 * @param {Array} params.settled - Raw settled transactions
 * @returns {Promise<{settled: Array, pending: Array, pendingIdMap: Map, settledIdMap: Map, duplicatesRemoved: number}>}
 *   pending array entries have `generatedId` and `isPending: true` attached
 */
export async function separateAndDeduplicateTransactions({ txIdPrefix, getPendingIdFields, pending, settled }: SeparateParams): Promise<SeparateResult> {
  debugLog(`[reconciliation] Separation: ${settled.length} settled, ${pending.length} pending`);

  const { settledIdMap, pendingIdMap, duplicatesRemoved } = await buildHashMaps(
    txIdPrefix,
    getPendingIdFields,
    settled,
    pending,
  );

  if (duplicatesRemoved > 0) {
    debugLog(`[reconciliation] Removed ${duplicatesRemoved} pending duplicate(s) that matched settled`);
  }

  // Convert pendingIdMap back to array with IDs attached
  const dedupedPending = Array.from(pendingIdMap.entries()).map(([hashId, tx]) => ({
    ...(tx as Record<string, unknown>),
    generatedId: hashId,
    isPending: true as const,
  }));

  return {
    settled,
    pending: dedupedPending,
    pendingIdMap,
    settledIdMap,
    duplicatesRemoved,
  };
}

/**
 * Format reconciliation result message for progress dialog.
 *
 * @param {Object} result - Reconciliation result
 * @returns {string} Formatted message
 */
export function formatReconciliationMessage(result: ReconciliationResult): string {
  if (result.noPendingTag || result.noPendingTransactions) {
    return 'No pending transactions';
  }

  const parts = [];

  if (result.settled > 0) {
    parts.push(`${result.settled} settled`);
  }

  if (result.cancelled > 0) {
    parts.push(`${result.cancelled} cancelled`);
  }

  if (result.failed > 0) {
    parts.push(`${result.failed} failed`);
  }

  if (parts.length === 0) {
    return 'Nothing settled or cancelled';
  }

  return parts.join(', ');
}

export default {
  generatePendingTransactionId,
  extractPendingIdFromNotes,
  cleanPendingIdFromNotes,
  reconcilePendingTransactions,
  separateAndDeduplicateTransactions,
  formatReconciliationMessage,
};