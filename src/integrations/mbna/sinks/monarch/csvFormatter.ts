/**
 * MBNA → Monarch CSV Formatter
 *
 * Converts processed MBNA transactions to Monarch-compatible CSV format.
 * Supports both settled and pending transactions with appropriate tagging
 * and notes formatting.
 *
 * Moved from src/utils/csv.js to keep MBNA-specific formatting logic
 * within the integration module.
 *
 * @module integrations/mbna/sinks/monarch/csvFormatter
 */

import { debugLog } from '../../../../core/utils';
import { convertToCSV, MONARCH_CSV_COLUMNS } from '../../../../utils/csv';
import { resolveMonarchTransactionId } from '../../../../core/transactionIds';
import type { ProcessedMbnaTransaction } from './transactions';

/** Options for MBNA CSV conversion */
export interface MbnaCSVOptions {
  /** Whether to include referenceNumber in notes (default: false) */
  storeTransactionDetailsInNotes?: boolean;
}

/** Monarch CSV row shape */
interface MonarchCSVRow {
  Date: string;
  Merchant: string;
  Category: string;
  Account: string;
  'Original Statement': string;
  Notes: string;
  Amount: number;
  Tags: string;
  Owner: string;
  Id: string;
  [key: string]: string | number;
}

/**
 * Convert MBNA transactions to Monarch CSV format
 *
 * Supports both settled and pending transactions:
 * - Settled transactions: standard CSV row with no tags
 * - Pending transactions: "Pending" tag and generated hash ID in notes (for reconciliation)
 *
 * NOTE: MBNA's live sync path is `services/common/syncOrchestrator`, not this
 * file — nothing in production calls it today. It is kept in sync with the
 * canonical column set anyway so that whoever does wire it up does not
 * silently ship a CSV missing `Owner`/`Id`.
 *
 * @param transactions - Array of processed MBNA transaction objects (from processMbnaTransactions)
 * @param accountName - MBNA account name for the Account column
 * @param options - Conversion options
 * @returns CSV string formatted for Monarch
 */
export function convertMbnaTransactionsToMonarchCSV(
  transactions: ProcessedMbnaTransaction[],
  accountName: string,
  options: MbnaCSVOptions = {},
): string {
  if (!transactions || transactions.length === 0) {
    return '';
  }

  const { storeTransactionDetailsInNotes = false } = options;

  // Transform transactions to Monarch format
  const monarchRows: MonarchCSVRow[] = transactions.map((transaction) => {
    const isPending = transaction.isPending === true;

    // Build notes field
    const notesParts: string[] = [];

    // Include reference number if setting is enabled (for settled transactions)
    if (storeTransactionDetailsInNotes && !isPending && transaction.referenceNumber) {
      notesParts.push(transaction.referenceNumber);
    }

    // For pending transactions, always include the generated hash ID for reconciliation
    if (isPending && transaction.pendingId) {
      notesParts.push(transaction.pendingId);
    }

    const notes = notesParts.join('\n');

    // Use resolved category, auto-category, or default to Uncategorized
    const category = transaction.resolvedMonarchCategory
      ?? transaction.autoCategory
      ?? 'Uncategorized';

    return {
      Date: transaction.date || '',
      Merchant: transaction.merchant || '',
      Category: category,
      Account: accountName,
      'Original Statement': transaction.originalStatement || '',
      Notes: notes,
      // Amount signs already inverted in transaction processing (MBNA charge → negative, payment → positive)
      Amount: transaction.amount || 0,
      Tags: isPending ? 'Pending' : '',
      Owner: transaction.cardholderOwner || '',
      // The `mbna-tx:{hash16}` hash, NOT `referenceNumber`: MBNA reports
      // `referenceNumber: "TEMP"` until a transaction settles (it is how pending
      // rows are detected), so it is identical across all pending rows and then
      // changes at settlement — the two properties an id used for matching must
      // not have. The hash is derived from fields that survive settlement.
      Id: resolveMonarchTransactionId({
        txHashId: transaction.txHashId,
        pendingId: transaction.pendingId,
      }),
    };
  });

  debugLog('Transformed MBNA transactions for CSV:', {
    originalCount: transactions.length,
    transformedCount: monarchRows.length,
    pendingCount: transactions.filter((t) => t.isPending).length,
    autoCategorizedCount: transactions.filter((t) => t.autoCategory).length,
    sample: monarchRows[0],
  });

  return convertToCSV(monarchRows, MONARCH_CSV_COLUMNS);
}
