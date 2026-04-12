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

// ============================================================================
// Types
// ============================================================================

/** A stored transaction with ID and optional date */
export interface StoredTransaction {
  id: string;
  date: string | null;
}

/** Retention settings for transaction storage */
interface RetentionSettings {
  days: number;
  count: number;
}

/** Account data shape with optional retention fields */
interface AccountDataWithRetention {
  transactionRetentionDays?: number;
  transactionRetentionCount?: number;
  [key: string]: unknown;
}

// ============================================================================
// Functions
// ============================================================================

/**
 * Get retention settings from a consolidated account object
 */
export function getRetentionSettingsFromAccount(accountData: AccountDataWithRetention | null | undefined): RetentionSettings {
  return {
    days: accountData?.transactionRetentionDays ?? TRANSACTION_RETENTION_DEFAULTS.DAYS,
    count: accountData?.transactionRetentionCount ?? TRANSACTION_RETENTION_DEFAULTS.COUNT,
  };
}

/**
 * Migrate legacy transaction IDs to new format with dates
 */
export function migrateLegacyTransactions(legacyData: unknown[]): StoredTransaction[] {
  if (!Array.isArray(legacyData)) {
    return [];
  }

  // Check if already migrated (first item has 'id' property)
  if (legacyData.length > 0 && typeof legacyData[0] === 'object' && legacyData[0] !== null && 'id' in legacyData[0]) {
    return legacyData as StoredTransaction[];
  }

  // Migrate: convert strings to objects with null dates
  return legacyData.map((id) => ({
    id: typeof id === 'string' ? id : String(id),
    date: null, // Legacy transactions have no date
  }));
}

/**
 * Apply retention limits to transaction list
 */
export function applyRetentionLimits(transactions: StoredTransaction[], settings: RetentionSettings): StoredTransaction[] {
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
    const dateA = parseLocalDate(a.date!);
    const dateB = parseLocalDate(b.date!);
    return dateB.getTime() - dateA.getTime();
  });

  // Apply date-based retention to dated transactions
  const recentDatedTransactions = datedTransactions.filter((tx) => {
    const txDate = parseLocalDate(tx.date!);
    return txDate >= cutoffDate;
  });

  // Check if we have any dated transactions older than the cutoff
  const hasOldDatedTransactions = datedTransactions.some((tx) => {
    const txDate = parseLocalDate(tx.date!);
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
      return dateB.getTime() - dateA.getTime();
    });

    retained = retained.slice(0, settings.count);
  }

  debugLog(`Transaction retention: ${transactions.length} -> ${retained.length} (days: ${settings.days}, count: ${settings.count})`);

  return retained;
}

/**
 * Merge new transactions with existing ones and apply retention limits
 * Pure logic function - can be used by any storage mechanism
 */
export function mergeAndRetainTransactions(
  existingTransactions: unknown[],
  newTransactions: (string | StoredTransaction)[],
  retentionSettings: RetentionSettings,
  defaultDate: string | null = null,
): StoredTransaction[] {
  // Migrate existing transactions if needed
  const migratedExisting = migrateLegacyTransactions(existingTransactions);

  // Create a Set of existing IDs for deduplication
  const existingIds = new Set(migratedExisting.map((tx) => tx.id));

  // Prepare new transactions with dates
  const date = defaultDate || getTodayLocal();
  const transactionsToAdd: StoredTransaction[] = newTransactions
    .filter((tx) => {
      const id = typeof tx === 'string' ? tx : tx.id || String(tx);
      return !existingIds.has(id);
    })
    .map((tx) => {
      if (typeof tx === 'string') {
        return { id: tx, date };
      }
      // Preserve the date from the transaction if available
      return {
        id: tx.id || String(tx),
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
 */
export function getTransactionIdsFromArray(transactions: unknown[] | null | undefined): Set<string> {
  const migrated = migrateLegacyTransactions(transactions || []);
  return new Set(migrated.map((tx) => tx.id));
}

// Export all functions
