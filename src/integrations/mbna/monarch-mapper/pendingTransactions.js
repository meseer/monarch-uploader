/**
 * MBNA Pending Transaction Utilities
 *
 * Handles pending transaction hash ID generation, separation of pending
 * vs settled transactions, and deduplication between the two.
 *
 * @module integrations/mbna/monarch-mapper/pendingTransactions
 */

/**
 * Generate a deterministic hash ID for a pending transaction.
 * Pending transactions don't have a stable reference number, so we
 * generate one from their key attributes (date, amount, description).
 *
 * @param {Object} transaction - Raw MBNA pending transaction
 * @returns {string} Generated hash ID prefixed with "mbna_pending_"
 */
export function generatePendingId(transaction) {
  // TODO: Milestone 6 — implement with actual MBNA transaction field names
  const date = transaction.date || '';
  const amount = String(transaction.amount || '0');
  const description = (transaction.description || '').trim().toLowerCase();

  // Simple hash: combine key fields into a deterministic string
  const raw = `${date}|${amount}|${description}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }

  // Convert to positive hex string
  const positiveHash = (hash >>> 0).toString(16).padStart(8, '0');
  return `mbna_pending_${positiveHash}`;
}

/**
 * Format a pending ID for inclusion in Monarch transaction notes.
 * This allows reconciliation to find and delete pending transactions
 * when their settled counterparts arrive.
 *
 * @param {string} pendingId - Generated pending transaction ID
 * @returns {string} Formatted string for notes field
 */
export function formatPendingIdForNotes(pendingId) {
  return `[Pending: ${pendingId}]`;
}

/**
 * Separate transactions into settled and pending, removing pending
 * duplicates when a settled version exists with the same hash.
 *
 * @param {Object[]} transactions - Array of all raw MBNA transactions
 * @returns {Object} { settled: [], pending: [], duplicatesRemoved: number }
 */
export function separateAndDeduplicateTransactions(transactions) {
  // TODO: Milestone 6 — implement with actual MBNA transaction status field
  const settled = [];
  const pending = [];
  let duplicatesRemoved = 0;

  if (!transactions || transactions.length === 0) {
    return { settled, pending, duplicatesRemoved };
  }

  // Separate by status
  for (const tx of transactions) {
    // Placeholder logic — actual field names TBD
    if (tx.status === 'PENDING' || tx.isPending) {
      // Generate hash ID for pending transactions
      const generatedId = generatePendingId(tx);
      pending.push({ ...tx, generatedId, isPending: true });
    } else {
      settled.push(tx);
    }
  }

  // Build a set of settled transaction hashes to detect duplicates
  const settledHashes = new Set();
  for (const tx of settled) {
    settledHashes.add(generatePendingId(tx));
  }

  // Filter pending: remove any that match a settled transaction's hash
  const uniquePending = pending.filter((tx) => {
    if (settledHashes.has(tx.generatedId)) {
      duplicatesRemoved++;
      return false;
    }
    return true;
  });

  return {
    settled,
    pending: uniquePending,
    duplicatesRemoved,
  };
}

export default {
  generatePendingId,
  formatPendingIdForNotes,
  separateAndDeduplicateTransactions,
};