/**
 * MBNA → Monarch Data Mapper
 *
 * Barrel re-exports for all MBNA-to-Monarch transformation modules.
 * Explicitly coupled to Monarch's data model — this is by design.
 *
 * @module integrations/mbna/monarch-mapper
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
