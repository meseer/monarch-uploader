/**
 * CSV Conversion Utilities
 * Handles conversion of data to CSV format
 */

import { debugLog } from '../core/utils';
import { applyMerchantMapping } from '../mappers/merchant';
import { applyCategoryMapping } from '../mappers/category';

/**
 * Escape a CSV field value
 * @param {string|number} value - Value to escape
 * @returns {string} Escaped value
 */
function escapeCSVField(value) {
  if (value === null || value === undefined) {
    return '';
  }

  const stringValue = String(value);

  // Check if escaping is needed
  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n') || stringValue.includes('\r')) {
    // Escape double quotes by doubling them
    const escaped = stringValue.replace(/"/g, '""');
    return `"${escaped}"`;
  }

  return stringValue;
}

/**
 * Convert an array of objects to CSV string
 * @param {Array<Object>} data - Array of objects to convert
 * @param {Array<string>} columns - Column names (optional, will use object keys if not provided)
 * @returns {string} CSV string
 */
export function convertToCSV(data, columns = null) {
  if (!data || !Array.isArray(data) || data.length === 0) {
    debugLog('No data to convert to CSV');
    return '';
  }

  // Determine columns from first object if not provided
  const columnNames = columns || Object.keys(data[0]);

  // Create header row
  const headerRow = columnNames.map(escapeCSVField).join(',');

  // Create data rows
  const dataRows = data.map((row) => columnNames.map((col) => {
    const value = row[col];
    return escapeCSVField(value);
  }).join(','));

  // Combine header and data rows
  const csvContent = [headerRow, ...dataRows].join('\n');

  debugLog('CSV generated:', {
    rows: data.length,
    columns: columnNames.length,
    sizeBytes: csvContent.length,
  });

  return csvContent;
}

/**
 * Convert Rogers Bank transactions to Monarch CSV format
 * @param {Array} transactions - Array of Rogers Bank transaction objects
 * @param {string} accountName - Rogers account name for the Account column
 * @returns {string} CSV string formatted for Monarch
 */
export function convertTransactionsToMonarchCSV(transactions, accountName) {
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
    // Apply merchant mapping
    const mappedMerchant = applyMerchantMapping(transaction.merchant?.name || '');

    // Use resolved Monarch category if available, otherwise fall back to old mapping
    let mappedCategory;
    if (transaction.resolvedMonarchCategory) {
      // Transaction already has a resolved Monarch category from the category resolution process
      mappedCategory = transaction.resolvedMonarchCategory;
    } else {
      // Fallback to old category mapping (for backward compatibility)
      const originalCategory = transaction.merchant?.categoryDescription
        || transaction.merchant?.category
        || '';
      mappedCategory = applyCategoryMapping(originalCategory);

      // Ensure we never use raw bank categories in CSV - if mapping returns an object, use 'Uncategorized'
      if (typeof mappedCategory === 'object') {
        mappedCategory = 'Uncategorized';
      }
    }

    // Create notes field
    const notes = `${transaction.activityType || ''} / ${transaction.referenceNumber || ''}`.trim();

    return {
      Date: transaction.date || '',
      Merchant: mappedMerchant,
      Category: mappedCategory,
      Account: accountName,
      'Original Statement': transaction.merchant?.name || '',
      Notes: notes,
      Amount: -(transaction.amount?.value || 0), // Negate amount for Rogers transactions
      Tags: '', // Empty for now, can be enhanced later
    };
  });

  debugLog('Transformed transactions for CSV:', {
    originalCount: transactions.length,
    transformedCount: monarchRows.length,
    sample: monarchRows[0], // Log first row as sample
    resolvedCategoryCount: transactions.filter((t) => t.resolvedMonarchCategory).length,
  });

  return convertToCSV(monarchRows, columns);
}

/**
 * Format a Wealthsimple transaction ID for storage in Monarch notes
 * Uses the ws-tx: prefix format for consistent detection during reconciliation
 *
 * @param {string} transactionId - Original Wealthsimple transaction ID
 * @returns {string} Formatted ID with prefix (e.g., "ws-tx:funding_intent-xxx")
 */
function formatTransactionIdForNotes(transactionId) {
  if (!transactionId) return '';
  return `ws-tx:${transactionId}`;
}

/**
 * Build notes field for Wealthsimple transaction in new format:
 * 1. Memo (if present)
 * 2. Empty line separator (if both memo and technical details exist)
 * 3. Technical details (if present)
 * 4. New line
 * 5. Transaction ID line (at the bottom)
 *
 * Example output:
 * "Testing interac notes and status sync
 *
 * Auto Deposit: No; Reference Number: CAkJgEwf
 * E_TRANSFER / ws-tx:funding_intent-4x01q2I19RLZcT1DscfyciJbtn2"
 *
 * @param {Object} params - Parameters for building notes
 * @param {string} params.memo - Transaction memo (e.g., Interac memo)
 * @param {string} params.technicalDetails - Technical details (e.g., auto-deposit, reference number)
 * @param {string} params.subType - Transaction subType (e.g., E_TRANSFER)
 * @param {string} params.formattedTxId - Formatted transaction ID with ws-tx: prefix
 * @param {boolean} params.includeTransactionId - Whether to include the transaction ID line
 * @returns {string} Formatted notes string
 */
function buildWealthsimpleNotes({ memo, technicalDetails, subType, formattedTxId, includeTransactionId }) {
  const parts = [];

  // 1. Memo first (if present)
  if (memo) {
    parts.push(memo);
  }

  // 2-3. Technical details (if present), with empty line separator if memo exists
  if (technicalDetails) {
    if (memo) {
      // Add empty line separator between memo and technical details
      parts.push('');
    }
    parts.push(technicalDetails);
  }

  // 4-5. Transaction ID line at the bottom (if included)
  if (includeTransactionId && formattedTxId) {
    const txIdLine = `${subType || ''} / ${formattedTxId}`.trim();
    parts.push(txIdLine);
  }

  return parts.join('\n');
}

/**
 * Convert Wealthsimple transactions to Monarch CSV format
 * Handles both credit card transactions (using status field) and CASH transactions (using isPending flag)
 *
 * Notes format:
 * - Memo/message first (if present)
 * - Empty line separator
 * - Technical details (auto-deposit, reference number)
 * - Transaction ID line at the bottom
 *
 * @param {Array} transactions - Array of processed Wealthsimple transaction objects
 * @param {string} accountName - Wealthsimple account name for the Account column
 * @param {Object} options - Conversion options
 * @param {boolean} options.storeTransactionDetailsInNotes - Whether to include subType and transaction ID in notes (default: false)
 * @returns {string} CSV string formatted for Monarch
 */
export function convertWealthsimpleTransactionsToMonarchCSV(transactions, accountName, options = {}) {
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
  const monarchRows = transactions.map((transaction) => {
    // Check if transaction is pending
    // For credit cards: status === 'authorized'
    // For CASH accounts: isPending flag is set by the rules engine
    const isPending = transaction.isPending === true || transaction.status === 'authorized';

    // Format the transaction ID with ws-tx: prefix for reconciliation
    const formattedTxId = formatTransactionIdForNotes(transaction.id);

    // Get memo and technical details from transaction
    const memo = transaction.notes || '';
    const technicalDetails = transaction.technicalDetails || '';

    // Build notes field based on settings
    // For pending transactions, always include transaction ID for de-duplication/reconciliation
    let notes;

    if (isPending) {
      // Always include transaction ID for pending transactions (for de-duplication)
      notes = buildWealthsimpleNotes({
        memo,
        technicalDetails,
        subType: transaction.subType,
        formattedTxId,
        includeTransactionId: true,
      });
    } else if (storeTransactionDetailsInNotes) {
      // Include subType and transaction ID in notes for traceability (when setting enabled)
      notes = buildWealthsimpleNotes({
        memo,
        technicalDetails,
        subType: transaction.subType,
        formattedTxId,
        includeTransactionId: true,
      });
    } else {
      // Only include memo and technical details when storeTransactionDetailsInNotes is disabled
      notes = buildWealthsimpleNotes({
        memo,
        technicalDetails,
        subType: transaction.subType,
        formattedTxId,
        includeTransactionId: false,
      });
    }

    return {
      Date: transaction.date || '',
      Merchant: transaction.merchant || '',
      Category: transaction.resolvedMonarchCategory || 'Uncategorized',
      Account: accountName,
      'Original Statement': transaction.originalMerchant || '',
      Notes: notes,
      Amount: transaction.amount || 0,
      Tags: isPending ? 'Pending' : '',
    };
  });

  debugLog('Transformed Wealthsimple transactions for CSV:', {
    originalCount: transactions.length,
    transformedCount: monarchRows.length,
    storeTransactionDetailsInNotes,
    sample: monarchRows[0], // Log first row as sample
  });

  return convertToCSV(monarchRows, columns);
}

/**
 * Convert Questrade orders to Monarch CSV format
 * @param {Array} orders - Array of Questrade order objects
 * @param {string} accountName - Questrade account name for the Account column
 * @returns {string} CSV string formatted for Monarch
 */
export function convertQuestradeOrdersToMonarchCSV(orders, accountName) {
  if (!orders || orders.length === 0) {
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

  // Transform orders to Monarch format
  const monarchRows = orders.map((order) => {
    // Use security display name as merchant
    const merchant = order.security?.displayName || 'Unknown Security';

    // Use resolved Monarch category
    const category = order.resolvedMonarchCategory || 'Uncategorized';

    // Format date from updatedDateTime
    let date = '';
    if (order.updatedDateTime) {
      const dateObj = new Date(order.updatedDateTime);
      date = dateObj.toISOString().split('T')[0]; // YYYY-MM-DD format
    }

    // Build comprehensive notes field
    const orderStatement = order.orderStatement || '';
    const filledQuantity = order.filledQuantity || 0;
    const averageFilledPrice = order.averageFilledPrice || 0;
    const totalFees = order.totalFees || 0;
    const currency = order.security?.currency || '';
    const amount = filledQuantity * averageFilledPrice;

    const notes = `${orderStatement} \nFilled ${filledQuantity} @ ${averageFilledPrice}, fees: ${totalFees} ${currency}\nTotal: ${amount} ${currency}`.trim();

    return {
      Date: date,
      Merchant: merchant,
      Category: category,
      Account: accountName,
      'Original Statement': merchant,
      Notes: notes,
      Amount: order.action === 'Sell' ? -Math.abs(amount) : Math.abs(amount),
      Tags: '', // Empty for now
    };
  });

  debugLog('Transformed Questrade orders for CSV:', {
    originalCount: orders.length,
    transformedCount: monarchRows.length,
    sample: monarchRows[0], // Log first row as sample
  });

  return convertToCSV(monarchRows, columns);
}

/**
 * Parse CSV string to array of objects
 * @param {string} csvString - CSV string to parse
 * @param {boolean} hasHeader - Whether the first row is a header
 * @returns {Array<Object>} Array of parsed objects
 */
export function parseCSV(csvString, hasHeader = true) {
  if (!csvString) {
    return [];
  }

  const lines = csvString.split('\n').filter((line) => line.trim());
  if (lines.length === 0) {
    return [];
  }

  // Simple CSV parser (doesn't handle all edge cases)
  const parseRow = (row) => {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < row.length; i += 1) {
      const char = row[i];

      if (char === '"') {
        if (inQuotes && row[i + 1] === '"') {
          current += '"';
          i += 1; // Skip next quote
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }

    result.push(current);
    return result;
  };

  const rows = lines.map(parseRow);

  if (!hasHeader) {
    return rows;
  }

  // Convert to objects using header
  const header = rows[0];
  const dataRows = rows.slice(1);

  return dataRows.map((row) => {
    const obj = {};
    header.forEach((col, index) => {
      obj[col] = row[index] || '';
    });
    return obj;
  });
}

export default {
  convertToCSV,
  convertTransactionsToMonarchCSV,
  parseCSV,
  escapeCSVField,
};
