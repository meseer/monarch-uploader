/**
 * Transaction Storage Utilities
 * Handles storage and retrieval of uploaded transaction IDs with date tracking
 * and configurable retention limits
 */

import { STORAGE, TRANSACTION_RETENTION_DEFAULTS } from '../core/config';
import { debugLog, getTodayLocal, parseLocalDate } from '../core/utils';

/**
 * Get transaction retention settings for an institution
 * @param {string} institutionType - 'questrade' or 'rogersbank'
 * @returns {Object} Object with days and count limits
 */
export function getTransactionRetentionSettings(institutionType) {
  const daysKey = institutionType === 'questrade'
    ? STORAGE.QUESTRADE_TRANSACTION_RETENTION_DAYS
    : STORAGE.ROGERSBANK_TRANSACTION_RETENTION_DAYS;

  const countKey = institutionType === 'questrade'
    ? STORAGE.QUESTRADE_TRANSACTION_RETENTION_COUNT
    : STORAGE.ROGERSBANK_TRANSACTION_RETENTION_COUNT;

  return {
    days: GM_getValue(daysKey, TRANSACTION_RETENTION_DEFAULTS.DAYS),
    count: GM_getValue(countKey, TRANSACTION_RETENTION_DEFAULTS.COUNT),
  };
}

/**
 * Migrate legacy transaction IDs to new format with dates
 * @param {Array} legacyData - Array of transaction IDs (strings)
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
 * Get stored transactions for an account
 * @param {string} accountId - Account ID
 * @param {string} institutionType - 'questrade' or 'rogersbank'
 * @returns {Array} Array of transaction objects with id and date
 */
export function getStoredTransactions(accountId, institutionType) {
  const storageKey = institutionType === 'questrade'
    ? `${STORAGE.QUESTRADE_UPLOADED_ORDERS_PREFIX}${accountId}`
    : `${STORAGE.ROGERSBANK_UPLOADED_REFS_PREFIX}${accountId}`;

  try {
    const storedData = GM_getValue(storageKey, []);
    const migrated = migrateLegacyTransactions(storedData);
    const settings = getTransactionRetentionSettings(institutionType);
    return applyRetentionLimits(migrated, settings);
  } catch (error) {
    debugLog('Error getting stored transactions:', error);
    return [];
  }
}

/**
 * Save transactions after successful upload
 * @param {string} accountId - Account ID
 * @param {Array} newTransactions - Array of transaction objects to add
 * @param {string} institutionType - 'questrade' or 'rogersbank'
 * @param {string} transactionDate - Date of the transactions (YYYY-MM-DD format)
 */
export function saveUploadedTransactions(accountId, newTransactions, institutionType, transactionDate = null) {
  const storageKey = institutionType === 'questrade'
    ? `${STORAGE.QUESTRADE_UPLOADED_ORDERS_PREFIX}${accountId}`
    : `${STORAGE.ROGERSBANK_UPLOADED_REFS_PREFIX}${accountId}`;

  try {
    // Get existing transactions
    const existingTransactions = getStoredTransactions(accountId, institutionType);

    // Create a Set of existing IDs for deduplication
    const existingIds = new Set(existingTransactions.map((tx) => tx.id));

    // Prepare new transactions with dates
    const date = transactionDate || getTodayLocal();
    const transactionsToAdd = newTransactions
      .filter((tx) => {
        const id = typeof tx === 'string' ? tx : tx.id || tx;
        return !existingIds.has(id);
      })
      .map((tx) => ({
        id: typeof tx === 'string' ? tx : tx.id || tx,
        date,
      }));

    // Combine with existing
    const combined = [...existingTransactions, ...transactionsToAdd];

    // Apply retention limits
    const settings = getTransactionRetentionSettings(institutionType);
    const retained = applyRetentionLimits(combined, settings);

    // Save
    GM_setValue(storageKey, retained);

    debugLog(`Saved ${transactionsToAdd.length} new transactions for ${institutionType} account ${accountId}, total stored: ${retained.length}`);
  } catch (error) {
    debugLog('Error saving uploaded transactions:', error);
  }
}

/**
 * Get uploaded transaction IDs as a Set (for backward compatibility)
 * @param {string} accountId - Account ID
 * @param {string} institutionType - 'questrade' or 'rogersbank'
 * @returns {Set<string>} Set of transaction IDs
 */
export function getUploadedTransactionIds(accountId, institutionType) {
  const transactions = getStoredTransactions(accountId, institutionType);
  return new Set(transactions.map((tx) => tx.id));
}

/**
 * Clear transaction history for an institution
 * @param {string} institutionType - 'questrade' or 'rogersbank'
 */
export async function clearTransactionHistory(institutionType) {
  const prefix = institutionType === 'questrade'
    ? STORAGE.QUESTRADE_UPLOADED_ORDERS_PREFIX
    : STORAGE.ROGERSBANK_UPLOADED_REFS_PREFIX;

  const keys = await GM_listValues();
  const keysToDelete = keys.filter((key) => key.startsWith(prefix));

  await Promise.all(keysToDelete.map((key) => GM_deleteValue(key)));

  debugLog(`Cleared ${keysToDelete.length} transaction history keys for ${institutionType}`);
  return keysToDelete.length;
}

// Export all functions
export default {
  getTransactionRetentionSettings,
  migrateLegacyTransactions,
  applyRetentionLimits,
  getStoredTransactions,
  saveUploadedTransactions,
  getUploadedTransactionIds,
  clearTransactionHistory,
};
