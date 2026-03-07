/**
 * MBNA → Monarch Data Mapper
 *
 * Barrel re-exports for all MBNA-to-Monarch transformation modules.
 * Explicitly coupled to Monarch's data model — this is by design.
 *
 * @module integrations/mbna/sinks/monarch
 */

// Transaction processing (merchant mapping, auto-categorization, amount inversion)
export { processMbnaTransactions, resolveMbnaCategories, filterDuplicateSettledTransactions } from './transactions';

// Pending transaction handling (deduplication, reconciliation, ID generation)
export {
  generatePendingTransactionId,
  separateAndDeduplicateTransactions,
  reconcileMbnaPendingTransactions,
  formatReconciliationMessage,
  isPendingTransaction,
  isSettledTransaction,
  formatPendingIdForNotes,
  extractPendingIdFromNotes,
} from './pendingTransactions';

// Balance formatting (sign inversion for Monarch)
export { formatBalanceHistoryForMonarch } from './balanceFormatter';

// CSV formatting (Monarch CSV export)
export { convertMbnaTransactionsToMonarchCSV } from './csvFormatter';

// Re-export types
export type { ProcessedMbnaTransaction, ProcessedTransactionsResult, DuplicateFilterResult } from './transactions';
export type { MbnaPendingWithId, DeduplicationResult, ReconciliationResult } from './pendingTransactions';
export type { MonarchBalanceEntry } from './balanceFormatter';
export type { MbnaCSVOptions } from './csvFormatter';