/**
 * MBNA → Monarch Pending Transaction Mapper
 *
 * Handles pending transaction ID generation, deduplication, and reconciliation
 * against Monarch Money transactions.
 *
 * MBNA pending transactions have referenceNumber="TEMP" and lack a unique identifier,
 * so we generate deterministic IDs by hashing stable transaction fields.
 * The same hash is generated for both pending and settled versions of a transaction,
 * allowing us to detect when a pending transaction settles.
 *
 * Explicitly coupled to Monarch's data format — this is by design.
 *
 * ID format: mbna-tx:{first 16 chars of SHA-256 hex hash}
 *
 * @module integrations/mbna/sinks/monarch/pendingTransactions
 */

import { debugLog, formatDate } from '../../../../core/utils';
import monarchApi from '../../../../api/monarch';
import type { MbnaRawTransaction } from '../../source/balanceReconstruction';

// ── Interfaces ──────────────────────────────────────────────

/** A pending transaction with its generated hash ID attached */
export interface MbnaPendingWithId extends MbnaRawTransaction {
  generatedId: string;
  isPending: true;
}

/** Result of the separate-and-deduplicate operation */
export interface DeduplicationResult {
  settled: MbnaRawTransaction[];
  pending: MbnaPendingWithId[];
  pendingIdMap: Map<string, MbnaRawTransaction>;
  settledIdMap: Map<string, MbnaRawTransaction>;
  duplicatesRemoved: number;
}

/** Result of the pending transaction reconciliation */
export interface ReconciliationResult {
  success: boolean;
  settled: number;
  cancelled: number;
  failed: number;
  error: string | null;
  noPendingTag?: boolean;
  noPendingTransactions?: boolean;
}

/** Monarch transaction shape (subset of fields used during reconciliation) */
interface MonarchTransaction {
  id: string;
  notes?: string;
  amount?: number;
  ownedByUser?: { id: string } | null;
}

// ── Constants ───────────────────────────────────────────────

/**
 * Prefix for MBNA generated transaction IDs stored in Monarch notes
 * Format: mbna-tx:{hash}
 */
const MBNA_TX_ID_PREFIX = 'mbna-tx:';

/**
 * Regex pattern to extract MBNA transaction ID from Monarch notes
 * Matches: mbna-tx:{16 hex characters}
 */
const MBNA_TX_ID_PATTERN = /mbna-tx:([a-f0-9]{16})/;

// ── Public Functions ────────────────────────────────────────

/**
 * Generate a deterministic pending transaction ID by hashing stable transaction fields
 *
 * Fields used for hashing:
 * - transactionDate: Transaction date (YYYY-MM-DD)
 * - description: Transaction description (sanitized merchant name)
 * - amount: Transaction amount
 * - endingIn: Card last 4 digits
 *
 * @param tx - MBNA transaction object from API
 * @returns Generated ID in format mbna-tx:{hash16}
 */
export async function generatePendingTransactionId(tx: MbnaRawTransaction): Promise<string> {
  // Strip asterisk suffix from description for consistent hashing
  // "Amazon.ca*RA6HH70U3 TORONTO ON" → "Amazon.ca"
  let sanitizedDescription = (tx.description || '').trim();
  const asteriskIndex = sanitizedDescription.indexOf('*');
  if (asteriskIndex > 0) {
    sanitizedDescription = sanitizedDescription.substring(0, asteriskIndex).trim();
  }

  const hashInput = [
    tx.transactionDate || '',
    sanitizedDescription,
    tx.amount !== undefined && tx.amount !== null ? String(tx.amount) : '',
    tx.endingIn || '',
  ].join('|');

  // Use Web Crypto API for SHA-256 hash
  const encoder = new TextEncoder();
  const data = encoder.encode(hashInput);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);

  // Convert buffer to hex string
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

  // Return first 16 characters for a shorter but still unique ID
  return `${MBNA_TX_ID_PREFIX}${hashHex.substring(0, 16)}`;
}

/**
 * Check if a transaction is pending (referenceNumber is "TEMP")
 * @param tx - MBNA transaction from API
 * @returns True if pending
 */
export function isPendingTransaction(tx: MbnaRawTransaction): boolean {
  return tx.referenceNumber === 'TEMP';
}

/**
 * Check if a transaction is settled (has a real referenceNumber)
 * @param tx - MBNA transaction from API
 * @returns True if settled
 */
export function isSettledTransaction(tx: MbnaRawTransaction): boolean {
  return !!tx.referenceNumber && tx.referenceNumber !== 'TEMP';
}

/**
 * Format an MBNA pending transaction ID for storage in Monarch notes
 * @param pendingId - Generated pending transaction ID (mbna-tx:xxx format)
 * @returns The ID string (already in correct format)
 */
export function formatPendingIdForNotes(pendingId: string | null): string {
  return pendingId || '';
}

/**
 * Extract MBNA pending transaction ID from Monarch transaction notes
 * @param notes - Transaction notes from Monarch
 * @returns Full pending ID (mbna-tx:xxx) or null if not found
 */
export function extractPendingIdFromNotes(notes: string | null | undefined): string | null {
  if (!notes || typeof notes !== 'string') {
    return null;
  }

  const match = notes.match(MBNA_TX_ID_PATTERN);
  if (!match) {
    return null;
  }

  return `${MBNA_TX_ID_PREFIX}${match[1]}`;
}

/**
 * Remove MBNA system notes (pending transaction ID) from notes
 * Preserves any user-added notes or other content
 * @param notes - Transaction notes
 * @returns Cleaned notes
 */
function cleanPendingIdFromNotes(notes: string | null | undefined): string {
  if (!notes || typeof notes !== 'string') {
    return '';
  }

  let cleaned = notes;

  // Remove mbna-tx:{hash} pattern
  cleaned = cleaned.replace(/mbna-tx:[a-f0-9]{16}/g, '');

  // Clean up trailing/leading whitespace and newlines
  cleaned = cleaned.replace(/\n+$/g, '');
  cleaned = cleaned.replace(/^\n+/g, '');
  cleaned = cleaned.replace(/ +/g, ' ');

  return cleaned.trim();
}

/**
 * Separate transactions into pending and settled, and deduplicate
 *
 * MBNA sometimes reports both pending (TEMP) and settled versions of the same
 * transaction simultaneously. This function:
 * 1. Separates transactions by referenceNumber (TEMP vs real)
 * 2. Generates hash IDs for pending transactions
 * 3. Generates hash IDs for settled transactions
 * 4. Removes pending transactions whose hash matches a settled transaction
 *    (the settled version takes precedence)
 *
 * @param pendingTransactions - Pending transactions (referenceNumber="TEMP")
 * @param settledTransactions - Settled transactions (real referenceNumber)
 * @returns Result with settled, pending arrays and metadata
 */
export async function separateAndDeduplicateTransactions(
  pendingTransactions: MbnaRawTransaction[],
  settledTransactions: MbnaRawTransaction[],
): Promise<DeduplicationResult> {
  debugLog(`MBNA transaction separation: ${settledTransactions.length} settled, ${pendingTransactions.length} pending`);

  // Step 1: Generate hash IDs for settled transactions
  const settledIdMap = new Map<string, MbnaRawTransaction>();
  for (const tx of settledTransactions) {
    const hashId = await generatePendingTransactionId(tx);
    settledIdMap.set(hashId, tx);
  }

  // Step 2: Generate hash IDs for pending transactions and filter out duplicates
  const pendingIdMap = new Map<string, MbnaRawTransaction>();
  let duplicatesRemoved = 0;

  for (const tx of pendingTransactions) {
    const hashId = await generatePendingTransactionId(tx);

    // Remove pending transaction if a settled version exists with the same hash
    if (settledIdMap.has(hashId)) {
      debugLog(`Removing duplicate MBNA pending transaction (settled version exists): ${hashId}`);
      duplicatesRemoved += 1;
      continue;
    }

    pendingIdMap.set(hashId, tx);
  }

  if (duplicatesRemoved > 0) {
    debugLog(`Removed ${duplicatesRemoved} MBNA pending transaction(s) that matched settled transactions`);
  }

  // Convert pendingIdMap back to array with IDs attached
  const dedupedPending: MbnaPendingWithId[] = Array.from(pendingIdMap.entries()).map(([hashId, tx]) => ({
    ...tx,
    generatedId: hashId,
    isPending: true as const,
  }));

  return {
    settled: settledTransactions,
    pending: dedupedPending,
    pendingIdMap,
    settledIdMap,
    duplicatesRemoved,
  };
}

/**
 * Reconcile pending transactions for an MBNA account
 *
 * This function:
 * 1. Finds all Monarch transactions with "Pending" tag for the account
 * 2. For each pending Monarch transaction, extracts the mbna-tx:{hash} from notes
 * 3. Checks the current MBNA transactions:
 *    - Hash matches a settled transaction → settled: update amount, remove Pending tag, clean notes
 *    - Hash matches a still-pending transaction → no action
 *    - Hash not found → cancelled: delete from Monarch
 *
 * @param monarchAccountId - Monarch account ID
 * @param allPending - Current pending transactions from MBNA API
 * @param allSettled - Current settled transactions from MBNA API
 * @param lookbackDays - Number of days to look back for pending transactions
 * @returns Reconciliation result
 */
export async function reconcileMbnaPendingTransactions(
  monarchAccountId: string,
  allPending: MbnaRawTransaction[],
  allSettled: MbnaRawTransaction[],
  lookbackDays: number,
): Promise<ReconciliationResult> {
  const result: ReconciliationResult = { success: true, settled: 0, cancelled: 0, failed: 0, error: null };

  try {
    debugLog('Starting MBNA pending transaction reconciliation', {
      monarchAccountId,
      pendingCount: allPending?.length || 0,
      settledCount: allSettled?.length || 0,
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

    const endDate = new Date(today);
    endDate.setFullYear(endDate.getFullYear() + 1);

    const startDateStr = formatDate(startDate);
    const endDateStr = formatDate(endDate);

    debugLog(`Searching for MBNA pending transactions from ${startDateStr} to ${endDateStr}`);

    // Step 3: Fetch all Monarch transactions with Pending tag for this account
    const pendingTransactionsResult = await monarchApi.getTransactionsList({
      accountIds: [monarchAccountId],
      tags: [pendingTag.id],
      startDate: startDateStr,
      endDate: endDateStr,
    });

    const pendingMonarchTransactions = (pendingTransactionsResult.results || []) as MonarchTransaction[];

    if (pendingMonarchTransactions.length === 0) {
      debugLog('No pending transactions found in Monarch for this MBNA account');
      return { ...result, noPendingTransactions: true };
    }

    debugLog(`Found ${pendingMonarchTransactions.length} pending MBNA transaction(s) in Monarch to reconcile`);

    // Step 4: Build hash ID maps for current MBNA transactions
    const settledIdMap = new Map<string, MbnaRawTransaction>();
    for (const tx of (allSettled || [])) {
      const hashId = await generatePendingTransactionId(tx);
      settledIdMap.set(hashId, tx);
    }

    const pendingIdMap = new Map<string, MbnaRawTransaction>();
    for (const tx of (allPending || [])) {
      const hashId = await generatePendingTransactionId(tx);
      pendingIdMap.set(hashId, tx);
    }

    debugLog(`Reconciliation lookup: ${settledIdMap.size} settled hashes, ${pendingIdMap.size} pending hashes`);

    // Step 5: Process each pending Monarch transaction
    for (const monarchTx of pendingMonarchTransactions) {
      try {
        const monarchTxId = monarchTx.id;
        const notes = monarchTx.notes || '';

        // Extract MBNA pending transaction ID from notes
        const pendingId = extractPendingIdFromNotes(notes);

        if (!pendingId) {
          debugLog(`Could not extract MBNA pending ID from notes: "${notes}", skipping`);
          continue;
        }

        debugLog(`Reconciling MBNA pending transaction ${monarchTxId} with ID: ${pendingId}`);

        // Check if transaction has settled
        if (settledIdMap.has(pendingId)) {
          const settledTx = settledIdMap.get(pendingId)!;
          debugLog(`MBNA transaction ${pendingId} has settled, updating Monarch transaction`);

          // Amount signs kept as-is from MBNA (positive = charge, negative = payment)
          const settledAmount = parseFloat(String(settledTx.amount)) || 0;

          // Clean the notes - remove pending ID but keep user notes
          const cleanedNotes = cleanPendingIdFromNotes(notes);

          // Check if amount has changed
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

          // Remove Pending tag
          await monarchApi.setTransactionTags(monarchTxId, []);

          result.settled += 1;
          continue;
        }

        // Check if transaction is still pending
        if (pendingIdMap.has(pendingId)) {
          debugLog(`MBNA transaction ${pendingId} is still pending, no action needed`);
          continue;
        }

        // Transaction not found - likely cancelled
        debugLog(`MBNA transaction ${pendingId} not found in MBNA data, deleting from Monarch`);
        await monarchApi.deleteTransaction(monarchTxId);
        result.cancelled += 1;
      } catch (txError) {
        debugLog(`Error reconciling MBNA transaction ${monarchTx.id}:`, txError);
        result.failed += 1;
      }
    }

    debugLog('MBNA pending transaction reconciliation completed', {
      settled: result.settled,
      cancelled: result.cancelled,
      failed: result.failed,
    });

    return result;
  } catch (error) {
    debugLog('Error during MBNA pending transaction reconciliation:', error);
    return { ...result, success: false, error: (error as Error).message };
  }
}

/**
 * Format reconciliation result message for progress dialog
 * @param result - Reconciliation result from reconcileMbnaPendingTransactions
 * @returns Formatted message
 */
export function formatReconciliationMessage(result: ReconciliationResult): string {
  if (result.noPendingTag || result.noPendingTransactions) {
    return 'No pending transactions';
  }

  const parts: string[] = [];

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
  isPendingTransaction,
  isSettledTransaction,
  separateAndDeduplicateTransactions,
  reconcileMbnaPendingTransactions,
  formatReconciliationMessage,
  formatPendingIdForNotes,
  extractPendingIdFromNotes,
};