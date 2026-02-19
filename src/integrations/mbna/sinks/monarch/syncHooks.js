/**
 * MBNA Sync Hooks
 *
 * Implementation of the SyncHooks interface for the MBNA integration.
 * These hooks provide the institution-specific logic that the generic
 * syncOrchestrator calls during the sync workflow.
 *
 * @type {import('../../../types').SyncHooks}
 * @module integrations/mbna/sinks/monarch/syncHooks
 */

import { debugLog } from '../../../../core/utils';
import { processMbnaTransactions, resolveMbnaCategories } from './transactions';
import { buildBalanceHistory } from '../../source/balanceReconstruction';
import { formatBalanceHistoryForMonarch } from './balanceFormatter';

/**
 * Fetch raw transactions from the MBNA API.
 *
 * Aggregates transactions from the current cycle and past statements,
 * returns them as separate settled and pending arrays along with
 * metadata needed for balance reconstruction.
 *
 * @type {import('../../../types').FetchTransactionsHook}
 */
async function fetchTransactions(api, accountId, fromDate, { onProgress }) {
  onProgress('Fetching current cycle...');

  const txResult = await api.getTransactions(accountId, fromDate, {
    onProgress: (current, total) => {
      onProgress(`Loading statement ${current}/${total}...`);
    },
  });

  const { allSettled, allPending, statements, currentCycle } = txResult;

  debugLog(`[MBNA hooks] Fetched ${allSettled.length} settled, ${allPending.length} pending transactions`);

  return {
    settled: allSettled,
    pending: allPending,
    metadata: { statements, currentCycle },
  };
}

/**
 * Process raw MBNA transactions into normalized shape.
 *
 * Delegates to the existing processMbnaTransactions function which handles:
 * - Merchant sanitization via applyMerchantMapping
 * - Amount sign inversion (MBNA positive charges → negative for Monarch)
 * - Auto-categorization (e.g., PAYMENT → Credit Card Payment)
 * - Pending ID attachment from generatedId
 *
 * @type {import('../../../types').ProcessTransactionsHook}
 */
function processTransactions(settled, pending, options) {
  const result = processMbnaTransactions(settled, pending, options);
  return {
    settled: result.settled,
    pending: result.pending,
  };
}

/**
 * Extract dedup reference ID from a settled MBNA transaction.
 *
 * @type {import('../../../types').GetSettledRefIdHook}
 */
function getSettledRefId(tx) {
  return tx.referenceNumber;
}

/**
 * Extract dedup reference ID from a pending MBNA transaction.
 *
 * @type {import('../../../types').GetPendingRefIdHook}
 */
function getPendingRefId(tx) {
  return tx.pendingId;
}

/**
 * Resolve Monarch categories for MBNA transactions.
 *
 * Delegates to the existing resolveMbnaCategories function which handles:
 * - Auto-categorized transactions keep their category
 * - Stored category mappings (merchant → Monarch category)
 * - High-confidence similarity auto-matching
 * - Manual prompt for unresolved merchants
 * - skipCategorization per-account setting
 *
 * @type {import('../../../types').ResolveCategoriesHook}
 */
async function resolveCategories(transactions, accountId) {
  return resolveMbnaCategories(transactions, accountId);
}

/**
 * Build notes string for an MBNA transaction CSV row.
 *
 * For settled transactions: includes referenceNumber if storeTransactionDetailsInNotes is enabled.
 * For pending transactions: always includes the generated pendingId for reconciliation.
 *
 * @type {import('../../../types').BuildTransactionNotesHook}
 */
function buildTransactionNotes(tx, { storeTransactionDetailsInNotes = false } = {}) {
  const notesParts = [];

  // Include reference number if setting is enabled (for settled transactions)
  if (storeTransactionDetailsInNotes && !tx.isPending && tx.referenceNumber) {
    notesParts.push(tx.referenceNumber);
  }

  // For pending transactions, always include the generated hash ID for reconciliation
  if (tx.isPending && tx.pendingId) {
    notesParts.push(tx.pendingId);
  }

  return notesParts.join('\n');
}

/**
 * Get stable field values for pending transaction ID hashing.
 *
 * Fields used:
 * - transactionDate: Transaction date (YYYY-MM-DD)
 * - description: Sanitized merchant name (asterisk suffix stripped)
 * - amount: Transaction amount
 * - endingIn: Card last 4 digits
 *
 * @type {import('../../../types').GetPendingIdFieldsHook}
 */
function getPendingIdFields(tx) {
  // Strip asterisk suffix from description for consistent hashing
  // "Amazon.ca*RA6HH70U3 TORONTO ON" → "Amazon.ca"
  let sanitizedDescription = (tx.description || '').trim();
  const asteriskIndex = sanitizedDescription.indexOf('*');
  if (asteriskIndex > 0) {
    sanitizedDescription = sanitizedDescription.substring(0, asteriskIndex).trim();
  }

  return [
    tx.transactionDate || '',
    sanitizedDescription,
    tx.amount !== undefined && tx.amount !== null ? String(tx.amount) : '',
    tx.endingIn || '',
  ];
}

/**
 * Get the Monarch-normalized settled amount for a raw MBNA transaction.
 *
 * MBNA amounts: positive = charge, negative = payment
 * Monarch expects: negative = charge, positive = payment
 * So we negate.
 *
 * @param {Object} settledTx - Raw settled MBNA transaction
 * @returns {number} Monarch-normalized amount
 */
function getSettledAmount(settledTx) {
  const rawAmount = parseFloat(settledTx.amount) || 0;
  return -rawAmount;
}

/**
 * Build balance history for first-sync reconstruction.
 *
 * Uses the MBNA balance reconstruction module to compute daily balances
 * from statement data, then formats for Monarch (negates by default
 * for credit card liability convention; skips negation if invertBalance is on).
 *
 * @type {import('../../../types').BuildBalanceHistoryHook}
 */
function buildBalanceHistoryHook({ currentBalance, metadata, fromDate, invertBalance }) {
  const rawHistory = buildBalanceHistory({
    currentBalance,
    statements: metadata.statements,
    currentCycleSettled: metadata.currentCycle?.settled || [],
    startDate: fromDate,
  });

  if (!rawHistory || rawHistory.length === 0) return null;

  // formatBalanceHistoryForMonarch negates by default; if invertBalance is on, skip that negation
  return invertBalance ? rawHistory : formatBalanceHistoryForMonarch(rawHistory);
}

/**
 * Suggest a start date for first sync based on MBNA statement closing dates.
 *
 * Fetches available closing dates and returns 30 days before the oldest one,
 * giving users a reasonable default that covers their full statement history.
 *
 * @type {import('../../../types').SuggestStartDateHook}
 */
async function suggestStartDate(api, accountId) {
  try {
    const closingDates = await api.getClosingDates(accountId);
    if (closingDates.length > 0) {
      const oldest = closingDates[closingDates.length - 1]; // sorted newest-first
      const d = new Date(`${oldest}T00:00:00`);
      d.setDate(d.getDate() - 30);
      debugLog(`[MBNA hooks] Suggested start date: ${d.toISOString().split('T')[0]} (30 days before oldest closing date ${oldest})`);
      return { date: d.toISOString().split('T')[0], description: '30 days before oldest statement' };
    }
  } catch (error) {
    debugLog('[MBNA hooks] Could not fetch closing dates for start date suggestion:', error.message);
  }
  return null;
}

/**
 * Build the institution-specific portion of the account storage entry.
 *
 * Returns the fields stored under the manifest's `accountKeyName` ('mbnaAccount')
 * in the consolidated accounts list.
 *
 * @type {import('../../../types').BuildAccountEntryHook}
 */
function buildAccountEntry(account) {
  return {
    id: account.accountId,
    endingIn: account.endingIn,
    cardName: account.cardName,
    nickname: account.displayName || `MBNA Card (${account.endingIn})`,
  };
}

/** @type {import('../../../types').SyncHooks} */
const mbnaSyncHooks = {
  // Required hooks
  fetchTransactions,
  processTransactions,
  getSettledRefId,
  getPendingRefId,
  resolveCategories,
  buildTransactionNotes,

  // Optional hooks
  getPendingIdFields,
  getSettledAmount,
  buildBalanceHistory: buildBalanceHistoryHook,
  suggestStartDate,
  buildAccountEntry,
};

export default mbnaSyncHooks;