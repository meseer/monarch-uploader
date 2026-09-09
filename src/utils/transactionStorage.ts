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
 * `uploadedTransactions` is stored **newest-first**: the head of the array is the
 * most recent transaction and the tail is the oldest. New transactions are
 * prepended at the head, so callers MUST pass new transactions newest-first —
 * i.e. in the order most institutions natively list them, reversed first for the
 * few that return oldest-first (currently only Canada Life).
 *
 * This makes the array behave as a FIFO queue: retention pruning keeps the head
 * (newest) and drops entries from the tail (oldest).
 *
 * Ordering is maintained purely at insertion time — no function here re-sorts a
 * stored list, and the settings UI renders the stored array directly. That way a
 * bug in a caller's insertion order stays visible instead of being silently
 * repaired.
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
 * Merge two newest-first transaction runs into a single newest-first run.
 *
 * Concatenating two separately-sorted runs does NOT produce a sorted result —
 * e.g. settled `[06-28, 04-10]` followed by pending `[06-30]` leaves 04-10 above
 * 06-30. Callers that build separate settled and pending ref lists must merge
 * them with this instead of spreading them together.
 *
 * A two-pointer merge rather than a re-sort: both inputs are already ordered, so
 * this is linear, and it is stable — each run's own relative order is preserved
 * for equal dates. That matters because stored dates carry no time component, so
 * same-day ties are common and each institution's intra-day sequencing is the
 * only ordering signal available for them.
 *
 * Undated (legacy) entries sort last, matching their position under the
 * newest-first invariant.
 *
 * @param a - First run, newest-first
 * @param b - Second run, newest-first
 * @returns Single newest-first array
 */
export function mergeNewestFirstRuns(
  a: StoredTransaction[],
  b: StoredTransaction[],
): StoredTransaction[] {
  const left = Array.isArray(a) ? a : [];
  const right = Array.isArray(b) ? b : [];

  const merged: StoredTransaction[] = [];
  let i = 0;
  let j = 0;

  while (i < left.length && j < right.length) {
    // Undated entries belong at the tail, so they lose every comparison.
    const leftDate = left[i].date;
    const rightDate = right[j].date;

    let takeLeft: boolean;
    if (leftDate === null || leftDate === undefined) {
      takeLeft = false;
    } else if (rightDate === null || rightDate === undefined) {
      takeLeft = true;
    } else {
      // >= keeps `a` first on ties, making the merge stable.
      takeLeft = leftDate >= rightDate;
    }

    if (takeLeft) {
      merged.push(left[i]);
      i += 1;
    } else {
      merged.push(right[j]);
      j += 1;
    }
  }

  // Drain whichever run still has entries.
  while (i < left.length) {
    merged.push(left[i]);
    i += 1;
  }
  while (j < right.length) {
    merged.push(right[j]);
    j += 1;
  }

  return merged;
}

/**
 * Apply retention limits to transaction list.
 *
 * Order-preserving: surviving entries keep their relative positions, so the
 * newest-first storage invariant is maintained. The count limit keeps the head
 * (newest) and drops from the tail (oldest).
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
  // Keep the newest entries, which live at the head under newest-first storage.
  if (!isUnlimited(settings.count) && retained.length > settings.count) {
    retained = retained.slice(0, settings.count);
  }

  debugLog(`Transaction retention: ${transactions.length} -> ${retained.length} (days: ${settings.days}, count: ${settings.count})`);

  return retained;
}

/**
 * Merge new transactions with existing ones and apply retention limits.
 * Pure logic function - can be used by any storage mechanism.
 *
 * New transactions are prepended at the head to preserve the newest-first
 * storage invariant, so `newTransactions` MUST be ordered newest-first.
 *
 * @param existingTransactions - Currently stored transactions (newest-first)
 * @param newTransactions - New transactions to prepend, newest-first
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

  // Prepend at the head — newest entries live at the start (newest-first storage)
  const combined = [...transactionsToAdd, ...migratedExisting];

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