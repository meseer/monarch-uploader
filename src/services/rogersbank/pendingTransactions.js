/**
 * Rogers Bank Pending Transactions
 * Handles pending transaction ID generation, deduplication, and reconciliation
 *
 * Rogers Bank pending transactions lack activityId and referenceNumber,
 * so we generate deterministic IDs by hashing stable transaction fields.
 * The same hash is generated for both PENDING and APPROVED versions of a transaction,
 * allowing us to detect when a pending transaction settles.
 *
 * ID format: rb-tx:{first 16 chars of SHA-256 hex hash}
 */

import { debugLog, formatDate } from '../../core/utils';
import monarchApi from '../../api/monarch';

/**
 * Prefix for Rogers Bank generated transaction IDs stored in Monarch notes
 * Format: rb-tx:{hash}
 */
const ROGERS_TX_ID_PREFIX = 'rb-tx:';

/**
 * Regex pattern to extract Rogers Bank transaction ID from Monarch notes
 * Matches: rb-tx:{16 hex characters}
 */
const ROGERS_TX_ID_PATTERN = /rb-tx:([a-f0-9]{16})/;

/**
 * Extract local date from a Rogers Bank pending transaction activityId
 *
 * Pending transactions have an activityId that is BASE64-encoded, decoding to
 * format: "DT|2026-02-19T15:49:53-05:00"
 *
 * The ISO timestamp includes the correct UTC offset (EST=-05:00, EDT=-04:00),
 * so daylight saving time is handled automatically. We parse the timestamp and
 * extract the date in the user's local timezone.
 *
 * This conversion is critical because:
 * - Pending transactions report .date in Eastern Time
 * - Settled transactions report .date in the user's local timezone
 * - Without conversion, cross-midnight transactions would have mismatched dates,
 *   causing hash mismatches and duplicate transactions after settlement
 *
 * @param {string} activityId - BASE64-encoded activity ID from pending transaction
 * @returns {string|null} Date "YYYY-MM-DD" in local timezone, or null if parsing fails
 */
export function getLocalDateFromActivityId(activityId) {
  if (!activityId) return null;

  try {
    const decoded = atob(activityId);
    const isoString = decoded.replace(/^DT\|/, '');
    const dateObj = new Date(isoString);

    if (Number.isNaN(dateObj.getTime())) return null;

    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
  } catch {
    return null;
  }
}

/**
 * Generate a deterministic pending transaction ID by hashing stable transaction fields
 *
 * Fields used for hashing:
 * - date: Transaction date (YYYY-MM-DD)
 * - amount.value: Only if currency is CAD (foreign currency amounts change on settlement)
 * - amount.currency: Always included
 * - merchant.name: Merchant name
 * - merchant.categoryCode: Merchant category code (MCC)
 * - cardNumber: Masked card number
 *
 * @param {Object} tx - Rogers Bank transaction object from API
 * @returns {Promise<string>} Generated ID in format rb-tx:{hash16}
 */
export async function generatePendingTransactionId(tx) {
  const isCad = tx.amount?.currency === 'CAD';

  const hashInput = [
    tx.date || '',
    // Only include amount value for CAD transactions (foreign currency amounts change on settlement)
    isCad ? (tx.amount?.value || '') : '',
    tx.amount?.currency || '',
    tx.merchant?.name || '',
    tx.merchant?.categoryCode || '',
    tx.cardNumber || '',
  ].join('|');

  // Use Web Crypto API for SHA-256 hash
  const encoder = new TextEncoder();
  const data = encoder.encode(hashInput);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);

  // Convert buffer to hex string
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

  // Return first 16 characters for a shorter but still unique ID
  return `${ROGERS_TX_ID_PREFIX}${hashHex.substring(0, 16)}`;
}

/**
 * Check if a transaction is pending
 * @param {Object} tx - Rogers Bank transaction from API
 * @returns {boolean} True if pending
 */
export function isPendingTransaction(tx) {
  return tx.activityStatus === 'PENDING';
}

/**
 * Check if a transaction is settled (approved)
 * @param {Object} tx - Rogers Bank transaction from API
 * @returns {boolean} True if settled/approved
 */
export function isSettledTransaction(tx) {
  return tx.activityStatus === 'APPROVED';
}

/**
 * Format a Rogers Bank pending transaction ID for storage in Monarch notes
 * @param {string} pendingId - Generated pending transaction ID (rb-tx:xxx format)
 * @returns {string} The ID string (already in correct format)
 */
export function formatPendingIdForNotes(pendingId) {
  return pendingId || '';
}

/**
 * Extract Rogers Bank pending transaction ID from Monarch transaction notes
 * @param {string} notes - Transaction notes from Monarch
 * @returns {string|null} Full pending ID (rb-tx:xxx) or null if not found
 */
export function extractPendingIdFromNotes(notes) {
  if (!notes || typeof notes !== 'string') {
    return null;
  }

  const match = notes.match(ROGERS_TX_ID_PATTERN);
  if (!match) {
    return null;
  }

  // Return the full ID including prefix
  return `${ROGERS_TX_ID_PREFIX}${match[1]}`;
}

/**
 * Remove Rogers Bank system notes (pending transaction ID) from notes
 * Preserves any user-added notes or other content
 * @param {string} notes - Transaction notes
 * @returns {string} Cleaned notes
 */
function cleanPendingIdFromNotes(notes) {
  if (!notes || typeof notes !== 'string') {
    return '';
  }

  let cleaned = notes;

  // Remove rb-tx:{hash} pattern
  cleaned = cleaned.replace(/rb-tx:[a-f0-9]{16}/g, '');

  // Clean up trailing/leading whitespace and newlines
  cleaned = cleaned.replace(/\n+$/g, '');
  cleaned = cleaned.replace(/^\n+/g, '');
  cleaned = cleaned.replace(/ +/g, ' ');

  return cleaned.trim();
}

/**
 * Separate transactions into pending and settled, and deduplicate
 *
 * Rogers Bank sometimes reports both PENDING and APPROVED versions of the same
 * transaction simultaneously. This function:
 * 1. Separates transactions by status
 * 2. Generates hash IDs for pending transactions
 * 3. Generates hash IDs for settled transactions
 * 4. Removes pending transactions whose hash matches a settled transaction
 *    (the settled version takes precedence)
 *
 * @param {Array} transactions - All Rogers Bank transactions from API
 * @returns {Promise<Object>} Result with settled, pending arrays and metadata
 *   {
 *     settled: Array - Settled (APPROVED) transactions (unchanged)
 *     pending: Array - Pending transactions with generated IDs (duplicates removed)
 *     pendingIdMap: Map<string, Object> - Map of pending hash ID to transaction
 *     settledIdMap: Map<string, Object> - Map of settled hash ID to transaction
 *     duplicatesRemoved: number - Count of pending duplicates that matched settled
 *   }
 */
export async function separateAndDeduplicateTransactions(transactions) {
  const settled = [];
  const pending = [];

  // Step 1: Separate by status
  for (const tx of transactions) {
    if (isSettledTransaction(tx)) {
      settled.push(tx);
    } else if (isPendingTransaction(tx)) {
      pending.push(tx);
    }
    // Other statuses are ignored
  }

  debugLog(`Transaction separation: ${settled.length} settled, ${pending.length} pending`);

  // Step 2: Generate hash IDs for settled transactions
  const settledIdMap = new Map();
  for (const tx of settled) {
    const hashId = await generatePendingTransactionId(tx);
    settledIdMap.set(hashId, tx);
  }

  // Step 3: Convert pending transaction dates and generate hash IDs, then filter out duplicates
  const pendingIdMap = new Map();
  let duplicatesRemoved = 0;

  for (const tx of pending) {
    // Convert pending transaction date from Eastern Time to local timezone
    // using the timestamp encoded in activityId (handles EST/EDT automatically)
    const localDate = getLocalDateFromActivityId(tx.activityId);
    if (localDate) {
      debugLog(`Pending transaction date converted: ${tx.date} → ${localDate} (from activityId)`);
      tx.date = localDate;
    }

    const hashId = await generatePendingTransactionId(tx);

    // Remove pending transaction if a settled version exists with the same hash
    if (settledIdMap.has(hashId)) {
      debugLog(`Removing duplicate pending transaction (settled version exists): ${hashId}`);
      duplicatesRemoved += 1;
      continue;
    }

    pendingIdMap.set(hashId, tx);
  }

  if (duplicatesRemoved > 0) {
    debugLog(`Removed ${duplicatesRemoved} pending transaction(s) that matched settled transactions`);
  }

  // Convert pendingIdMap back to array with IDs attached
  const dedupedPending = Array.from(pendingIdMap.entries()).map(([hashId, tx]) => ({
    ...tx,
    generatedId: hashId,
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
 * Reconcile pending transactions for a Rogers Bank account
 *
 * This function:
 * 1. Finds all Monarch transactions with "Pending" tag for the account
 * 2. For each pending Monarch transaction, extracts the rb-tx:{hash} from notes
 * 3. Checks the current Rogers Bank transactions:
 *    - Hash matches a settled transaction → settled: update amount, remove Pending tag, clean notes
 *    - Hash matches a still-pending transaction → no action
 *    - Hash not found → cancelled: delete from Monarch
 *
 * @param {string} monarchAccountId - Monarch account ID
 * @param {Array} allTransactions - All current Rogers Bank transactions from API
 * @param {number} lookbackDays - Number of days to look back for pending transactions
 * @returns {Promise<Object>} Reconciliation result { success, settled, cancelled, failed, error, settledRefIds }
 */
export async function reconcileRogersPendingTransactions(monarchAccountId, allTransactions, lookbackDays) {
  const result = { success: true, settled: 0, cancelled: 0, failed: 0, error: null, settledRefIds: [] };

  try {
    debugLog('Starting Rogers Bank pending transaction reconciliation', {
      monarchAccountId,
      transactionsLoaded: allTransactions?.length || 0,
      lookbackDays,
    });

    // Step 1: Get the "Pending" tag from Monarch
    const pendingTag = await monarchApi.getTagByName('Pending');

    if (!pendingTag) {
      debugLog('No "Pending" tag found in Monarch, skipping reconciliation');
      return { ...result, noPendingTag: true };
    }

    // Step 2: Calculate date range
    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - lookbackDays);

    // End date: 1 year in the future (handles user-modified dates)
    const endDate = new Date(today);
    endDate.setFullYear(endDate.getFullYear() + 1);

    const startDateStr = formatDate(startDate);
    const endDateStr = formatDate(endDate);

    debugLog(`Searching for pending transactions from ${startDateStr} to ${endDateStr}`);

    // Step 3: Fetch all Monarch transactions with Pending tag for this account
    const pendingTransactionsResult = await monarchApi.getTransactionsList({
      accountIds: [monarchAccountId],
      tags: [pendingTag.id],
      startDate: startDateStr,
      endDate: endDateStr,
    });

    const pendingMonarchTransactions = pendingTransactionsResult.results || [];

    if (pendingMonarchTransactions.length === 0) {
      debugLog('No pending transactions found in Monarch for this account');
      return { ...result, noPendingTransactions: true };
    }

    debugLog(`Found ${pendingMonarchTransactions.length} pending transaction(s) in Monarch to reconcile`);

    // Step 4: Build hash ID maps for all current Rogers transactions
    const { settledIdMap, pendingIdMap } = await separateAndDeduplicateTransactions(allTransactions || []);

    debugLog(`Reconciliation lookup: ${settledIdMap.size} settled hashes, ${pendingIdMap.size} pending hashes`);

    // Step 5: Process each pending Monarch transaction
    for (const monarchTx of pendingMonarchTransactions) {
      try {
        const monarchTxId = monarchTx.id;
        const notes = monarchTx.notes || '';

        // Extract Rogers Bank pending transaction ID from notes
        const pendingId = extractPendingIdFromNotes(notes);

        if (!pendingId) {
          debugLog(`Could not extract Rogers pending ID from notes: "${notes}", skipping`);
          continue;
        }

        debugLog(`Reconciling pending transaction ${monarchTxId} with ID: ${pendingId}`);

        // Check if transaction has settled
        if (settledIdMap.has(pendingId)) {
          const settledTx = settledIdMap.get(pendingId);
          debugLog(`Transaction ${pendingId} has settled, updating Monarch transaction`);

          // Calculate the settled amount (Rogers amounts are positive, negate for credit card)
          const settledAmount = -(parseFloat(settledTx.amount?.value) || 0);

          // Clean the notes - remove pending ID but keep user notes
          const cleanedNotes = cleanPendingIdFromNotes(notes);

          // Check if amount has changed
          const amountChanged = monarchTx.amount !== settledAmount;

          debugLog(`Updating transaction ${monarchTxId}:`, {
            oldAmount: monarchTx.amount,
            newAmount: settledAmount,
            amountChanged,
          });

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

          // Remove Pending tag
          await monarchApi.setTransactionTags(monarchTxId, []);

          // Collect settled reference number for dedup store
          if (settledTx.referenceNumber) {
            result.settledRefIds.push(settledTx.referenceNumber);
          }

          result.settled += 1;
          continue;
        }

        // Check if transaction is still pending
        if (pendingIdMap.has(pendingId)) {
          debugLog(`Transaction ${pendingId} is still pending, no action needed`);
          continue;
        }

        // Transaction not found - likely cancelled
        debugLog(`Transaction ${pendingId} not found in Rogers data, deleting from Monarch`);
        await monarchApi.deleteTransaction(monarchTxId);
        result.cancelled += 1;
      } catch (txError) {
        debugLog(`Error reconciling transaction ${monarchTx.id}:`, txError);
        result.failed += 1;
      }
    }

    debugLog('Rogers Bank pending transaction reconciliation completed', {
      settled: result.settled,
      cancelled: result.cancelled,
      failed: result.failed,
    });

    return result;
  } catch (error) {
    debugLog('Error during Rogers Bank pending transaction reconciliation:', error);
    return { ...result, success: false, error: error.message };
  }
}

/**
 * Format reconciliation result message for progress dialog
 * @param {Object} result - Reconciliation result from reconcileRogersPendingTransactions
 * @returns {string} Formatted message
 */
export function formatReconciliationMessage(result) {
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
    return 'No pending transactions';
  }

  return parts.join(', ');
}

export default {
  getLocalDateFromActivityId,
  generatePendingTransactionId,
  isPendingTransaction,
  isSettledTransaction,
  separateAndDeduplicateTransactions,
  reconcileRogersPendingTransactions,
  formatReconciliationMessage,
  formatPendingIdForNotes,
  extractPendingIdFromNotes,
};
