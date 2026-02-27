/**
 * Canada Life → Monarch CSV Formatter
 *
 * Converts processed Canada Life transactions to Monarch-compatible CSV format.
 * Supports both settled and pending transactions with appropriate tagging
 * and notes formatting.
 *
 * Follows the MBNA pattern: formatting logic lives within the integration's
 * service folder and uses the shared convertToCSV utility from src/utils/csv.js.
 *
 * @module services/canadalife/csvFormatter
 */

import { debugLog } from '../../core/utils';
import { convertToCSV } from '../../utils/csv';

/**
 * Convert Canada Life transactions to Monarch CSV format
 *
 * Supports both settled and pending transactions:
 * - Settled transactions: standard CSV row with no tags
 * - Pending transactions: "Pending" tag and cl-tx:{hash} in notes (for reconciliation)
 *
 * Amount sign convention: positive = contribution/buy, negative = reversed/sell.
 * Signs are already set correctly during activity processing — no negation applied here.
 *
 * @param {Array} transactions - Array of processed Canada Life transaction objects (from processCanadaLifeActivity)
 * @param {string} accountName - Canada Life account name for the Account column
 * @returns {string} CSV string formatted for Monarch
 */
export function convertCanadaLifeTransactionsToMonarchCSV(transactions, accountName) {
  if (!transactions || transactions.length === 0) {
    return '';
  }

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
  const monarchRows = transactions.map((transaction) => {
    const isPending = transaction.isPending === true;

    // Build notes: start with the activity notes, then append pending ID for reconciliation
    const notesParts = [];

    if (transaction.notes) {
      notesParts.push(transaction.notes);
    }

    // For pending transactions, always append the cl-tx:{hash} ID for reconciliation
    if (isPending && transaction.pendingId) {
      notesParts.push(transaction.pendingId);
    }

    const notes = notesParts.join('\n');

    return {
      Date: transaction.date || '',
      Merchant: transaction.merchant || '',
      Category: transaction.category || 'Uncategorized',
      Account: accountName,
      'Original Statement': transaction.originalMerchant || '',
      Notes: notes,
      // Amount sign already correct from activity processing (positive = buy, negative = sell)
      Amount: transaction.amount || 0,
      Tags: isPending ? 'Pending' : '',
    };
  });

  debugLog('Transformed Canada Life transactions for CSV:', {
    originalCount: transactions.length,
    transformedCount: monarchRows.length,
    pendingCount: transactions.filter((t) => t.isPending).length,
    sample: monarchRows[0],
  });

  return convertToCSV(monarchRows, columns);
}

export default {
  convertCanadaLifeTransactionsToMonarchCSV,
};