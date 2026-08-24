/**
 * Wealthsimple Transaction ID Matching
 *
 * Wealthsimple's `externalCanonicalId` is NOT stable across settlement for
 * card activity: the settled record appends one extra dash-separated segment
 * to the pending record's ID.
 *
 *   pending: card-activity-00000000527000993851-VI-00-0306231535741989-QIRIAS
 *   settled: card-activity-00000000527000993851-VI-00-0306231535741989-QIRIAS-0tk4pfcsob83
 *
 * Exact-match lookups therefore fail when a pending transaction settles, which
 * causes the settled version to be treated as a brand-new transaction (triggering
 * re-categorization and a duplicate upload) and causes the original pending
 * Monarch transaction to be deleted as "cancelled" on a later sync.
 *
 * These helpers implement a deliberately conservative match:
 * a candidate is a settled variant of a pending ID when it equals
 * `{pendingId}-{suffix}` where `suffix` is a single, non-empty,
 * dash-free segment.
 *
 * @module services/wealthsimple/transactionIdMatching
 */

import { debugLog } from '../../core/utils';

/** Matches a single non-empty segment containing no dashes */
const SUFFIX_SEGMENT_PATTERN = /^[^-]+$/;

/**
 * Check whether `candidateId` is the settled variant of `pendingId`.
 *
 * Conservative rule: settled ID === pending ID + '-' + one dash-free segment.
 *
 * @param pendingId - ID recorded while the transaction was pending
 * @param candidateId - ID of a candidate (settled) transaction
 * @returns true when candidateId is a settled variant of pendingId
 */
export function isSettledVariantOfPendingId(
  pendingId: string | null | undefined,
  candidateId: string | null | undefined,
): boolean {
  if (!pendingId || !candidateId) {
    return false;
  }

  if (candidateId === pendingId) {
    return false;
  }

  const prefix = `${pendingId}-`;
  if (!candidateId.startsWith(prefix)) {
    return false;
  }

  const suffix = candidateId.slice(prefix.length);
  return SUFFIX_SEGMENT_PATTERN.test(suffix);
}

/**
 * Check whether two IDs refer to the same underlying transaction,
 * allowing for the pending → settled suffix in either direction.
 *
 * @param idA - First ID
 * @param idB - Second ID
 * @returns true when the IDs are equal or one is the settled variant of the other
 */
export function isSameTransactionId(
  idA: string | null | undefined,
  idB: string | null | undefined,
): boolean {
  if (!idA || !idB) {
    return false;
  }

  if (idA === idB) {
    return true;
  }

  return isSettledVariantOfPendingId(idA, idB) || isSettledVariantOfPendingId(idB, idA);
}

/**
 * Find a previously-uploaded transaction ID that corresponds to `transactionId`.
 *
 * Checks exact match first (cheap Set lookup), then falls back to a
 * pending ↔ settled variant scan. Handles both directions:
 * - stored pending ID, new settled ID (the common case)
 * - stored settled ID, pending ID reappearing in the feed
 *
 * @param uploadedIds - Set of already-uploaded transaction IDs
 * @param transactionId - Transaction ID to look up
 * @returns The matching stored ID, or null when there is no match
 */
export function findMatchingUploadedId(
  uploadedIds: Set<string> | null | undefined,
  transactionId: string | null | undefined,
): string | null {
  if (!uploadedIds || uploadedIds.size === 0 || !transactionId) {
    return null;
  }

  if (uploadedIds.has(transactionId)) {
    return transactionId;
  }

  for (const uploadedId of uploadedIds) {
    if (isSameTransactionId(uploadedId, transactionId)) {
      debugLog(`[ws-id-matching] Matched "${transactionId}" to stored ID "${uploadedId}" via pending/settled variant`);
      return uploadedId;
    }
  }

  return null;
}

/**
 * Check whether a transaction has already been uploaded, tolerating the
 * pending → settled ID suffix change.
 *
 * @param uploadedIds - Set of already-uploaded transaction IDs
 * @param transactionId - Transaction ID to check
 * @returns true when a matching stored ID exists
 */
export function isAlreadyUploaded(
  uploadedIds: Set<string> | null | undefined,
  transactionId: string | null | undefined,
): boolean {
  return findMatchingUploadedId(uploadedIds, transactionId) !== null;
}

/**
 * Resolve a Wealthsimple transaction from a lookup map using an ID extracted
 * from Monarch notes (which is the ID as of the time the transaction was pending).
 *
 * Resolution order:
 * 1. Exact match on the map key
 * 2. Unique settled-variant match ({pendingId}-{suffix})
 *
 * When multiple settled variants match the same pending ID the situation is
 * ambiguous; the first candidate is returned and the ambiguity is logged so it
 * can be diagnosed without silently failing reconciliation.
 *
 * @param wsTransactionMap - Map of WS transaction ID → transaction
 * @param pendingId - ID extracted from Monarch notes
 * @returns The matched transaction and its current ID, or null when not found
 */
export function resolveWsTransactionByPendingId<T>(
  wsTransactionMap: Map<string, T>,
  pendingId: string | null | undefined,
): { transactionId: string; transaction: T } | null {
  if (!wsTransactionMap || wsTransactionMap.size === 0 || !pendingId) {
    return null;
  }

  const exact = wsTransactionMap.get(pendingId);
  if (exact !== undefined) {
    return { transactionId: pendingId, transaction: exact };
  }

  const candidates: Array<{ transactionId: string; transaction: T }> = [];
  for (const [candidateId, transaction] of wsTransactionMap) {
    if (isSettledVariantOfPendingId(pendingId, candidateId)) {
      candidates.push({ transactionId: candidateId, transaction });
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  if (candidates.length > 1) {
    debugLog(
      `[ws-id-matching] Ambiguous settled variants for pending ID "${pendingId}": ${candidates.map((c) => c.transactionId).join(', ')} — using the first`,
    );
  } else {
    debugLog(`[ws-id-matching] Resolved pending ID "${pendingId}" to settled ID "${candidates[0].transactionId}"`);
  }

  return candidates[0];
}