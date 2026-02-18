/**
 * MBNA → Monarch Transaction Mapper
 *
 * Processes raw MBNA transactions into a format suitable for Monarch CSV upload.
 * Handles merchant sanitization, category resolution, and PAYMENT auto-categorization.
 *
 * Explicitly coupled to Monarch's data format — this is by design.
 *
 * @module integrations/mbna/monarch-mapper/transactions
 */

import { debugLog } from '../../../core/utils';
import { applyMerchantMapping } from '../../../mappers/merchant';
import { INTEGRATIONS, getCapabilities } from '../../../core/integrationCapabilities';
import { getCategoryMapping } from '../../../services/common/configStore';

/**
 * Auto-categorization rules for MBNA transactions
 * Maps description patterns to { category, merchant } overrides
 */
const AUTO_CATEGORIZE_RULES = [
  {
    pattern: /^PAYMENT$/i,
    category: 'Credit Card Payment',
    merchant: 'MBNA Credit Card Payment',
  },
];

/**
 * Apply auto-categorization rules to a transaction
 * @param {string} description - Raw MBNA transaction description
 * @returns {Object|null} { category, merchant } if matched, null otherwise
 */
function applyAutoCategorization(description) {
  if (!description) return null;

  for (const rule of AUTO_CATEGORIZE_RULES) {
    if (rule.pattern.test(description.trim())) {
      return { category: rule.category, merchant: rule.merchant };
    }
  }

  return null;
}

/**
 * Process a single MBNA transaction into Monarch-ready format
 *
 * @param {Object} tx - Raw MBNA transaction from API
 * @param {Object} options - Processing options
 * @param {boolean} options.isPending - Whether this is a pending transaction
 * @param {string} options.pendingId - Generated pending ID (for pending transactions only)
 * @returns {Object} Processed transaction ready for CSV conversion
 */
function processTransaction(tx, options = {}) {
  const { isPending = false, pendingId = null } = options;
  const description = tx.description || '';

  // Check auto-categorization rules first
  const autoCategory = applyAutoCategorization(description);

  // Apply merchant mapping (includes asterisk stripping)
  const mappedMerchant = autoCategory?.merchant || applyMerchantMapping(description);

  return {
    date: tx.transactionDate || tx.postingDate || '',
    merchant: mappedMerchant,
    originalStatement: description,
    // Amount signs inverted for Monarch: MBNA positive (charge) → negative, MBNA negative (payment) → positive
    amount: tx.amount !== null && tx.amount !== undefined ? -tx.amount : 0,
    referenceNumber: tx.referenceNumber || '',
    isPending,
    pendingId: pendingId || null,
    // Category will be resolved later via resolveCategoriesForTransactions
    autoCategory: autoCategory?.category || null,
  };
}

/**
 * Process all MBNA transactions (settled + pending) into Monarch-ready format
 *
 * @param {Array} settledTransactions - Settled transactions from API
 * @param {Array} pendingTransactions - Pending transactions (with generatedId from dedup)
 * @param {Object} options - Processing options
 * @param {boolean} options.includePending - Whether to include pending transactions
 * @returns {Object} { settled: [], pending: [], all: [] }
 */
export function processMbnaTransactions(settledTransactions, pendingTransactions, options = {}) {
  const { includePending = true } = options;

  const settled = settledTransactions.map((tx) => processTransaction(tx, { isPending: false }));

  const pending = includePending
    ? pendingTransactions.map((tx) => processTransaction(tx, {
      isPending: true,
      pendingId: tx.generatedId || null,
    }))
    : [];

  debugLog('Processed MBNA transactions:', {
    settledCount: settled.length,
    pendingCount: pending.length,
    autoCategorizedCount: [...settled, ...pending].filter((t) => t.autoCategory).length,
  });

  return {
    settled,
    pending,
    all: [...settled, ...pending],
  };
}

/**
 * Resolve categories for processed MBNA transactions
 *
 * Uses the common category resolution flow:
 * 1. Auto-categorized transactions (e.g., PAYMENT → Credit Card Payment) keep their category
 * 2. Other transactions go through user category mappings and skip-categorization logic
 *
 * @param {Array} transactions - Processed MBNA transactions from processMbnaTransactions
 * @param {string} mbnaAccountId - MBNA account ID (for per-account settings)
 * @returns {Promise<Array>} Transactions with resolvedMonarchCategory set
 */
export async function resolveMbnaCategories(transactions, _mbnaAccountId) {
  const config = getCapabilities(INTEGRATIONS.MBNA);

  // Separate auto-categorized from those needing resolution
  const autoCategorized = [];
  const needsResolution = [];

  for (const tx of transactions) {
    if (tx.autoCategory) {
      autoCategorized.push({ ...tx, resolvedMonarchCategory: tx.autoCategory });
    } else {
      needsResolution.push(tx);
    }
  }

  // Resolve categories for non-auto-categorized transactions using stored mappings
  let resolved = needsResolution;
  if (needsResolution.length > 0 && config?.categoryMappings) {
    resolved = needsResolution.map((tx) => {
      const mapping = getCategoryMapping(INTEGRATIONS.MBNA, tx.merchant);
      if (mapping) {
        return { ...tx, resolvedMonarchCategory: mapping };
      }
      return tx;
    });
  }

  // Merge back together preserving order
  const result = transactions.map((tx) => {
    if (tx.autoCategory) {
      return autoCategorized.find((a) => a === tx || (a.date === tx.date && a.amount === tx.amount && a.originalStatement === tx.originalStatement))
        || { ...tx, resolvedMonarchCategory: tx.autoCategory };
    }
    return resolved.find((r) => r === tx || (r.date === tx.date && r.amount === tx.amount && r.originalStatement === tx.originalStatement))
      || tx;
  });

  debugLog('MBNA category resolution complete:', {
    total: transactions.length,
    autoCategorized: autoCategorized.length,
    resolved: needsResolution.length,
  });

  return result;
}

/**
 * Filter already-uploaded transactions using deduplication store
 *
 * Uses referenceNumber for settled transactions to detect duplicates.
 * Pending transactions are always re-uploaded (reconciliation handles them).
 *
 * @param {Array} settledTransactions - Processed settled transactions
 * @param {Array} uploadedTransactions - Previously uploaded transaction records from account storage
 * @returns {Object} { newTransactions: [], duplicateCount: number }
 */
export function filterDuplicateSettledTransactions(settledTransactions, uploadedTransactions) {
  if (!uploadedTransactions || uploadedTransactions.length === 0) {
    return { newTransactions: settledTransactions, duplicateCount: 0 };
  }

  const uploadedRefSet = new Set(uploadedTransactions.map((t) => t.id));
  const newTransactions = [];
  let duplicateCount = 0;

  for (const tx of settledTransactions) {
    if (tx.referenceNumber && uploadedRefSet.has(tx.referenceNumber)) {
      duplicateCount += 1;
    } else {
      newTransactions.push(tx);
    }
  }

  if (duplicateCount > 0) {
    debugLog(`Filtered ${duplicateCount} duplicate MBNA settled transactions`);
  }

  return { newTransactions, duplicateCount };
}

export default {
  processMbnaTransactions,
  resolveMbnaCategories,
  filterDuplicateSettledTransactions,
};