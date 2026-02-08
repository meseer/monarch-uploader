/**
 * Transaction Storage Utilities
 * Pure logic functions for transaction ID management with date tracking and retention limits
 *
 * These functions are storage-agnostic and work with arrays of transactions.
 * They can be used by any storage mechanism (consolidated account structures).
 *
 * All integrations now use consolidated account storage:
 * - uploadedTransactions is stored within each account entry in <integration>_accounts_list
 * - Use accountService to read/write account data including uploadedTransactions
 */

import { TRANSACTION_RETENTION_DEFAULTS } from '../core/config';
import { debugLog, getTodayLocal, parseLocalDate } from '../core/utils';

/**
 * Get retention settings from a consolidated account object
 * @param {Object} accountData - Consolidated account object
 * @returns {Object} Object with days and count limits
 */
export function getRetentionSettingsFromAccount(accountData) {
  return {
    days: accountData?.transactionRetentionDays ?? TRANSACTION_RETENTION_DEFAULTS.DAYS,
    count: accountData?.transactionRetentionCount ?? TRANSACTION_RETENTION_DEFAULTS.COUNT,
  };
}

/**
 * Migrate legacy transaction IDs to new format with dates
 * @param {Array} legacyData - Array of transaction IDs (strings) or already-migrated objects
 * @returns {Array} Array of transaction objects with id and date
 */
export function migrateLegacyTransactions(legacyData) {
  if (!Array.isArray(legacyData)) {
    return [];
  }

  // Check if already migrated (first item has 'id' property)
  if (legacyData.length > 0 && typeof legacyData[0] === 'object' && 'id' in legacyData[0]) {
    return legacyData;
  }

  // Migrate: convert strings to objects with null dates
  return legacyData.map((id) => ({
    id: typeof id === 'string' ? id : String(id),
    date: null, // Legacy transactions have no date
  }));
}

/**
 * Apply retention limits to transaction list
 * @param {Array} transactions - Array of transaction objects with id and date
 * @param {Object} settings - Retention settings with days and count
 * @returns {Array} Filtered array of transactions
 */
export function applyRetentionLimits(transactions, settings) {
  if (!Array.isArray(transactions) || transactions.length === 0) {
    return [];
  }

  const today = parseLocalDate(getTodayLocal());
  const cutoffDate = new Date(today);
  cutoffDate.setDate(cutoffDate.getDate() - settings.days);

  // Separate dated and undated transactions
  const datedTransactions = transactions.filter((tx) => tx.date !== null);
  const undatedTransactions = transactions.filter((tx) => tx.date === null);

  // Sort dated transactions by date (newest first)
  datedTransactions.sort((a, b) => {
    const dateA = parseLocalDate(a.date);
    const dateB = parseLocalDate(b.date);
    return dateB - dateA;
  });

  // Apply date-based retention to dated transactions
  const recentDatedTransactions = datedTransactions.filter((tx) => {
    const txDate = parseLocalDate(tx.date);
    return txDate >= cutoffDate;
  });

  // Check if we have any dated transactions older than the cutoff
  const hasOldDatedTransactions = datedTransactions.some((tx) => {
    const txDate = parseLocalDate(tx.date);
    return txDate < cutoffDate;
  });

  // Combine recent dated transactions with undated ones
  let retained = [...recentDatedTransactions];

  // Only keep undated transactions if we don't have old dated transactions
  // (per requirement: remove undated only when we have dated ones older than limit)
  if (!hasOldDatedTransactions) {
    retained = [...retained, ...undatedTransactions];
  }

  // Apply count limit (keep most recent N transactions)
  if (retained.length > settings.count) {
    // Sort by date (newest first), with undated at the end
    retained.sort((a, b) => {
      if (a.date === null && b.date === null) return 0;
      if (a.date === null) return 1;
      if (b.date === null) return -1;
      const dateA = parseLocalDate(a.date);
      const dateB = parseLocalDate(b.date);
      return dateB - dateA;
    });

    retained = retained.slice(0, settings.count);
  }

  debugLog(`Transaction retention: ${transactions.length} -> ${retained.length} (days: ${settings.days}, count: ${settings.count})`);

  return retained;
}

/**
 * Merge new transactions with existing ones and apply retention limits
 * Pure logic function - can be used by any storage mechanism
 *
 * @param {Array} existingTransactions - Array of existing transaction objects with id and date
 * @param {Array} newTransactions - Array of new transactions to add (can be strings or objects with id/date)
 * @param {Object} retentionSettings - Object with days and count limits
 * @param {string} defaultDate - Default date for transactions without a date (YYYY-MM-DD format)
 * @returns {Array} Merged and filtered array of transactions
 */
export function mergeAndRetainTransactions(existingTransactions, newTransactions, retentionSettings, defaultDate = null) {
  // Migrate existing transactions if needed
  const migratedExisting = migrateLegacyTransactions(existingTransactions);

  // Create a Set of existing IDs for deduplication
  const existingIds = new Set(migratedExisting.map((tx) => tx.id));

  // Prepare new transactions with dates
  const date = defaultDate || getTodayLocal();
  const transactionsToAdd = newTransactions
    .filter((tx) => {
      const id = typeof tx === 'string' ? tx : tx.id || tx;
      return !existingIds.has(id);
    })
    .map((tx) => {
      if (typeof tx === 'string') {
        return { id: tx, date };
      }
      // Preserve the date from the transaction if available
      return {
        id: tx.id || tx,
        date: tx.date || date,
      };
    });

  // Combine with existing
  const combined = [...migratedExisting, ...transactionsToAdd];

  // Apply retention limits
  return applyRetentionLimits(combined, retentionSettings);
}

/**
 * Get transaction IDs as a Set from an array of transaction objects
 * Pure logic function - can be used by any storage mechanism
 *
 * @param {Array} transactions - Array of transaction objects with id and date
 * @returns {Set<string>} Set of transaction IDs
 */
export function getTransactionIdsFromArray(transactions) {
  const migrated = migrateLegacyTransactions(transactions || []);
  return new Set(migrated.map((tx) => tx.id));
}

// Export all functions
export default {
  // Pure logic functions for consolidated account storage
  getRetentionSettingsFromAccount,
  migrateLegacyTransactions,
  applyRetentionLimits,
  mergeAndRetainTransactions,
  getTransactionIdsFromArray,
};
