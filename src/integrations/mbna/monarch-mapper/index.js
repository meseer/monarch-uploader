/**
 * MBNA → Monarch Data Mapper
 *
 * Transforms raw MBNA transaction data into Monarch-compatible format.
 * Explicitly coupled to Monarch's data model — this is by design.
 *
 * @module integrations/mbna/monarch-mapper
 */

export { separateAndDeduplicateTransactions, generatePendingId, formatPendingIdForNotes } from './pendingTransactions';

/**
 * Apply a transaction mapping rule to transform an MBNA transaction
 * into Monarch-compatible format.
 *
 * @param {Object} transaction - Raw MBNA transaction
 * @param {Map} [enrichmentMap=null] - Optional enrichment data (not used for MBNA currently)
 * @returns {Object|null} Mapped transaction data or null if no rule matches
 */
export function applyTransactionRule(transaction, enrichmentMap = null) {
  // TODO: Milestone 5 — implement transaction mapping rules
  // MBNA transactions will be mapped to Monarch format:
  // { category, merchant, originalStatement, notes, amount, date, ... }

  if (!transaction) {
    return null;
  }

  return {
    date: transaction.date || null,
    amount: transaction.amount || 0,
    merchant: transaction.description || transaction.merchant?.name || 'Unknown',
    category: null, // Will be resolved via category mapping
    originalStatement: transaction.description || null,
    notes: '',
    isPending: transaction.isPending || false,
  };
}

/**
 * Quick check if a mapping rule exists for a given transaction type.
 *
 * @param {string} type - Transaction type
 * @param {string} subType - Transaction sub-type
 * @returns {boolean} True if a rule exists
 */
export function hasRuleForTransaction(_type, _subType) {
  // MBNA credit card transactions are simpler than investment platforms.
  // All standard transaction types are supported.
  return true;
}

export default {
  applyTransactionRule,
  hasRuleForTransaction,
};