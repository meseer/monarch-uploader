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
 *
 * ## Ordering invariant
 *
 * `uploadedTransactions` is stored **oldest-first**: the head of the array is the
 * oldest transaction and the tail is the most recent. New transactions are
 * appended at the tail, so callers MUST pass new transactions oldest-first —
 * i.e. in the order the source institution lists them, reversed first if that
 * institution returns newest-first.
 *
 * This makes the array behave as a FIFO queue: retention pruning drops entries
 * from the head (oldest) and keeps the tail (newest).
 *
 * Ordering is maintained purely at insertion time — no function here re-sorts a
 * stored list. That way a bug in a caller's insertion order stays visible
 * instead of being silently repaired. For display, use
 * `getTransactionsNewestFirst`, which reverses the stored order.
 */

import { TRANSACTION_RETENTION_DEFAULTS } from '../core/config';
import { debugLog, getTodayLocal, parseLocalDate } from '../core/utils';

// ============================================================================
// Types
// ============================================================================

/** A stored transaction with ID, optional date and optional merchant name */
export interface StoredTransaction {
  id: string;
  date: string | null;
  merchant?: string | null;
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
// Helpers
// ============================================================================

/**
 * A retention limit of 0 (or any non-positive / invalid value) means "unlimited".
 * This matches the settings UI copy ("0 = unlimited") and
 * `validateLookbackVsRetention`, which already treats 0 as unlimited.
 */
function isUnlimited(limit: number): boolean {
  return !Number.isFinite(limit) || limit <= 0;
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
    merchant: null, // Legacy transactions have no merchant
  }));
}

/**
 * Return a copy of a stored transaction list in reverse-chronological order
 * (newest first) for display purposes.
 *
 * This is a plain reversal of the stored oldest-first order, NOT a re-sort:
 * ordering is owned by insertion time, so an out-of-order stored list stays
 * visibly out of order here rather than being silently corrected.
 *
 * @param transactions - Stored transactions (oldest-first)
 * @returns New array in newest-first order
 */
export function getTransactionsNewestFirst(transactions: StoredTransaction[] | null | undefined): StoredTransaction[] {
  if (!Array.isArray(transactions)) {
    return [];
  }
  return [...transactions].reverse();
}

/**
 * Apply retention limits to transaction list.
 *
 * Order-preserving: surviving entries keep their relative positions, so the
 * oldest-first storage invariant is maintained. The count limit keeps the tail
 * (newest) and drops from the head (oldest).
 *
 * A limit of 0 (or any non-positive value) means unlimited.
 */
export function applyRetentionLimits(transactions: StoredTransaction[], settings: RetentionSettings): StoredTransaction[] {
  if (!Array.isArray(transactions) || transactions.length === 0) {
    return [];
  }

  let retained = transactions;

  // ── Date-based retention ──────────────────────────────────
  if (!isUnlimited(settings.days)) {
    const today = parseLocalDate(getTodayLocal());
    const cutoffDate = new Date(today);
    cutoffDate.setDate(cutoffDate.getDate() - settings.days);

    // Undated (legacy) entries are dropped only once we have dated entries that
    // are themselves older than the cutoff — at that point the legacy entries
    // are provably older still.
    const hasOldDatedTransactions = transactions.some((tx) => tx.date !== null && parseLocalDate(tx.date) < cutoffDate);

    // Single order-preserving pass so entries keep their original positions.
    retained = transactions.filter((tx) => {
      if (tx.date === null) {
        return !hasOldDatedTransactions;
      }
      return parseLocalDate(tx.date) >= cutoffDate;
    });
  }

  // ── Count-based retention ─────────────────────────────────
  // Keep the newest entries, which live at the tail under oldest-first storage.
  if (!isUnlimited(settings.count) && retained.length > settings.count) {
    retained = retained.slice(-settings.count);
  }

  debugLog(`Transaction retention: ${transactions.length} -> ${retained.length} (days: ${settings.days}, count: ${settings.count})`);

  return retained;
}

/**
 * Merge new transactions with existing ones and apply retention limits.
 * Pure logic function - can be used by any storage mechanism.
 *
 * New transactions are appended at the tail to preserve the oldest-first
 * storage invariant, so `newTransactions` MUST be ordered oldest-first.
 *
 * @param existingTransactions - Currently stored transactions (oldest-first)
 * @param newTransactions - New transactions to append, oldest-first
 * @param retentionSettings - Retention limits to apply
 * @param defaultDate - Date to stamp on entries that carry no date of their own
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
        return { id: tx, date, merchant: null };
      }
      // Preserve the date and merchant from the transaction if available
      return {
        id: tx.id || String(tx),
        date: tx.date || date,
        merchant: tx.merchant ?? null,
      };
    });

  // Append at the tail — newest entries live at the end (oldest-first storage)
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