/**
 * Transaction Storage Utilities
 * Handles storage and retrieval of uploaded transaction IDs with date tracking
 * and configurable retention limits
 *
 * NOTE: This utility uses per-key storage (e.g., questrade_uploaded_orders_<accountId>).
 * Wealthsimple uses a consolidated account structure instead, where uploadedTransactions
 * is stored within each account entry in wealthsimple_accounts_list.
 *
 * TODO: Migrate Questrade and Rogers Bank to use consolidated account structures
 * like Wealthsimple. When migrated, this file's storage-related functions will become
 * legacy, but the pure logic functions (migrateLegacyTransactions, applyRetentionLimits)
 * should be preserved and reused.
 */

import { STORAGE, TRANSACTION_RETENTION_DEFAULTS } from '../core/config';
import { debugLog, getTodayLocal, parseLocalDate } from '../core/utils';

/**
 * Get transaction retention settings for an institution
 * Uses per-key storage for Questrade and Rogers Bank.
 *
 * NOTE: Wealthsimple stores retention settings in the consolidated account structure,
 * not in global storage keys. Use getRetentionSettingsFromAccount() for Wealthsimple.
 *
 * @param {string} institutionType - 'questrade' or 'rogersbank'
 * @returns {Object} Object with days and count limits
 */
export function getTransactionRetentionSettings(institutionType) {
  let daysKey;
  let countKey;

  switch (institutionType) {
  case 'questrade':
    daysKey = STORAGE.QUESTRADE_TRANSACTION_RETENTION_DAYS;
    countKey = STORAGE.QUESTRADE_TRANSACTION_RETENTION_COUNT;
    break;
  case 'rogersbank':
    daysKey = STORAGE.ROGERSBANK_TRANSACTION_RETENTION_DAYS;
    countKey = STORAGE.ROGERSBANK_TRANSACTION_RETENTION_COUNT;
    break;
  default:
    throw new Error(`Unknown institution type: ${institutionType}. Wealthsimple uses consolidated account structure.`);
  }

  return {
    days: GM_getValue(daysKey, TRANSACTION_RETENTION_DEFAULTS.DAYS),
    count: GM_getValue(countKey, TRANSACTION_RETENTION_DEFAULTS.COUNT),
  };
}

/**
 * Get retention settings from a consolidated account object
 * Used for Wealthsimple and future consolidated account structures
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
 * Get stored transactions for an account (uses per-key storage)
 *
 * NOTE: Wealthsimple uses consolidated account structure. Use the account's
 * uploadedTransactions property directly instead of this function.
 *
 * @param {string} accountId - Account ID
 * @param {string} institutionType - 'questrade' or 'rogersbank'
 * @returns {Array} Array of transaction objects with id and date
 */
export function getStoredTransactions(accountId, institutionType) {
  let storageKey;

  switch (institutionType) {
  case 'questrade':
    storageKey = `${STORAGE.QUESTRADE_UPLOADED_ORDERS_PREFIX}${accountId}`;
    break;
  case 'rogersbank':
    storageKey = `${STORAGE.ROGERSBANK_UPLOADED_REFS_PREFIX}${accountId}`;
    break;
  default:
    throw new Error(`Unknown institution type: ${institutionType}. Wealthsimple uses consolidated account structure.`);
  }

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
 * Save transactions after successful upload (uses per-key storage)
 *
 * NOTE: Wealthsimple uses consolidated account structure. Use
 * mergeAndRetainTransactions() to prepare the data, then save it
 * directly to the account's uploadedTransactions property.
 *
 * @param {string} accountId - Account ID
 * @param {Array} newTransactions - Array of transaction objects to add
 * @param {string} institutionType - 'questrade' or 'rogersbank'
 * @param {string} transactionDate - Date of the transactions (YYYY-MM-DD format)
 */
export function saveUploadedTransactions(accountId, newTransactions, institutionType, transactionDate = null) {
  let storageKey;

  switch (institutionType) {
  case 'questrade':
    storageKey = `${STORAGE.QUESTRADE_UPLOADED_ORDERS_PREFIX}${accountId}`;
    break;
  case 'rogersbank':
    storageKey = `${STORAGE.ROGERSBANK_UPLOADED_REFS_PREFIX}${accountId}`;
    break;
  default:
    throw new Error(`Unknown institution type: ${institutionType}. Wealthsimple uses consolidated account structure.`);
  }

  try {
    // Get existing transactions
    const existingTransactions = getStoredTransactions(accountId, institutionType);

    // Prepare and merge transactions
    const settings = getTransactionRetentionSettings(institutionType);
    const retained = mergeAndRetainTransactions(existingTransactions, newTransactions, settings, transactionDate);

    // Save
    GM_setValue(storageKey, retained);

    const addedCount = retained.length - existingTransactions.length;
    debugLog(`Saved ${addedCount} new transactions for ${institutionType} account ${accountId}, total stored: ${retained.length}`);
  } catch (error) {
    debugLog('Error saving uploaded transactions:', error);
  }
}

/**
 * Merge new transactions with existing ones and apply retention limits
 * Pure logic function - can be used by any storage mechanism (per-key or consolidated)
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
 * Get uploaded transaction IDs as a Set (for backward compatibility)
 *
 * NOTE: Wealthsimple uses consolidated account structure. Use
 * getTransactionIdsFromArray() with the account's uploadedTransactions.
 *
 * @param {string} accountId - Account ID
 * @param {string} institutionType - 'questrade' or 'rogersbank'
 * @returns {Set<string>} Set of transaction IDs
 */
export function getUploadedTransactionIds(accountId, institutionType) {
  const transactions = getStoredTransactions(accountId, institutionType);
  return new Set(transactions.map((tx) => tx.id));
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

/**
 * Clear transaction history for an institution (uses per-key storage)
 *
 * NOTE: Wealthsimple uses consolidated account structure. To clear transactions,
 * update each account's uploadedTransactions property directly.
 *
 * @param {string} institutionType - 'questrade' or 'rogersbank'
 */
export async function clearTransactionHistory(institutionType) {
  let prefix;

  switch (institutionType) {
  case 'questrade':
    prefix = STORAGE.QUESTRADE_UPLOADED_ORDERS_PREFIX;
    break;
  case 'rogersbank':
    prefix = STORAGE.ROGERSBANK_UPLOADED_REFS_PREFIX;
    break;
  default:
    throw new Error(`Unknown institution type: ${institutionType}. Wealthsimple uses consolidated account structure.`);
  }

  const keys = await GM_listValues();
  const keysToDelete = keys.filter((key) => key.startsWith(prefix));

  await Promise.all(keysToDelete.map((key) => GM_deleteValue(key)));

  debugLog(`Cleared ${keysToDelete.length} transaction history keys for ${institutionType}`);
  return keysToDelete.length;
}

// Export all functions
export default {
  // Per-key storage functions (for Questrade, Rogers Bank)
  getTransactionRetentionSettings,
  getStoredTransactions,
  saveUploadedTransactions,
  getUploadedTransactionIds,
  clearTransactionHistory,
  // Consolidated account functions (for Wealthsimple and future migrations)
  getRetentionSettingsFromAccount,
  getTransactionIdsFromArray,
  // Pure logic functions (reusable by any storage mechanism)
  migrateLegacyTransactions,
  applyRetentionLimits,
  mergeAndRetainTransactions,
};
