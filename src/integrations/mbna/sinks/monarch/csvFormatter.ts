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
import { convertToCSV } from '../../../../utils/csv';
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
  [key: string]: string | number;
}

/**
 * Convert MBNA transactions to Monarch CSV format
 *
 * Supports both settled and pending transactions:
 * - Settled transactions: standard CSV row with no tags
 * - Pending transactions: "Pending" tag and generated hash ID in notes (for reconciliation)
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

  // Define Monarch CSV columns
  const columns = [
    'Date',
    'Merchant',
    'Category',
    'Account',
    'Original Statement',
    'Notes',
    'Amount',
    'Tags',
  ];

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
    };
  });

  debugLog('Transformed MBNA transactions for CSV:', {
    originalCount: transactions.length,
    transformedCount: monarchRows.length,
    pendingCount: transactions.filter((t) => t.isPending).length,
    autoCategorizedCount: transactions.filter((t) => t.autoCategory).length,
    sample: monarchRows[0],
  });

  return convertToCSV(monarchRows, columns);
}