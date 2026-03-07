/**
 * CSV Conversion Utilities
 * Handles conversion of data to CSV format
 */

import { debugLog } from '../core/utils';
import { applyMerchantMapping } from '../mappers/merchant';
import { applyCategoryMapping } from '../mappers/category';

// ============================================================================
// Types
// ============================================================================

/** A generic row for CSV conversion */
type CSVRow = Record<string, string | number | null | undefined>;

/** Options for Rogers Bank CSV conversion */
interface RogersBankCSVOptions {
  storeTransactionDetailsInNotes?: boolean;
}

/** Rogers Bank transaction shape (loose, from JS callers) */
interface RogersBankTransaction {
  date?: string;
  merchant?: { name?: string; categoryDescription?: string; category?: string };
  amount?: { value?: number };
  activityType?: string;
  referenceNumber?: string;
  isPending?: boolean;
  pendingId?: string;
  resolvedMonarchCategory?: string | null;
  [key: string]: unknown;
}

/** Options for MBNA CSV conversion */
interface MbnaCSVOptions {
  storeTransactionDetailsInNotes?: boolean;
}

/** MBNA transaction shape */
interface MbnaTransaction {
  date?: string;
  merchant?: string;
  originalStatement?: string;
  amount?: number;
  referenceNumber?: string;
  isPending?: boolean;
  pendingId?: string;
  resolvedMonarchCategory?: string | null;
  autoCategory?: string | null;
  [key: string]: unknown;
}

/** Options for Wealthsimple CSV conversion */
interface WealthsimpleCSVOptions {
  storeTransactionDetailsInNotes?: boolean;
}

/** Wealthsimple transaction shape */
interface WealthsimpleTransaction {
  id?: string;
  date?: string;
  merchant?: string;
  originalMerchant?: string;
  amount?: number;
  status?: string;
  isPending?: boolean;
  notes?: string;
  technicalDetails?: string;
  resolvedMonarchCategory?: string | null;
  [key: string]: unknown;
}

/** Questrade order shape */
interface QuestradeOrder {
  security?: { displayName?: string; currency?: string };
  updatedDateTime?: string;
  filledQuantity?: number;
  averageFilledPrice?: number;
  totalFees?: number;
  action?: string;
  orderStatement?: string;
  resolvedMonarchCategory?: string | null;
  [key: string]: unknown;
}

/** Questrade transaction item shape (from activity API) */
interface QuestradeTransactionItem {
  transaction: Record<string, unknown>;
  details: {
    net?: { amount?: number | string; currencyCode?: string };
    transactionDate?: string;
    [key: string]: unknown;
  };
  ruleResult: {
    merchant?: string;
    category?: string;
    originalStatement?: string;
    notes?: string;
    amountOverride?: number | string | null;
    currencyOverride?: string;
    [key: string]: unknown;
  };
}

// ============================================================================
// Core CSV Functions
// ============================================================================

/**
 * Escape a CSV field value
 */
function escapeCSVField(value: string | number | null | undefined): string {
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
 */
export function convertToCSV(data: CSVRow[], columns: string[] | null = null): string {
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

// ============================================================================
// Institution-Specific CSV Converters
// ============================================================================

/** Monarch CSV column order */
const MONARCH_CSV_COLUMNS = [
  'Date',
  'Merchant',
  'Category',
  'Account',
  'Original Statement',
  'Notes',
  'Amount',
  'Tags',
];

/**
 * Convert Rogers Bank transactions to Monarch CSV format
 *
 * Supports both settled and pending transactions:
 * - Settled transactions: standard CSV row with no tags
 * - Pending transactions: "Pending" tag and generated hash ID in notes (for reconciliation)
 */
export function convertTransactionsToMonarchCSV(
  transactions: RogersBankTransaction[],
  accountName: string,
  options: RogersBankCSVOptions = {},
): string {
  if (!transactions || transactions.length === 0) {
    return '';
  }

  const { storeTransactionDetailsInNotes = false } = options;

  // Transform transactions to Monarch format
  const monarchRows: CSVRow[] = transactions.map((transaction) => {
    // Apply merchant mapping
    const mappedMerchant = applyMerchantMapping(transaction.merchant?.name || '');

    // Use resolved Monarch category if available, otherwise fall back to old mapping
    let mappedCategory: string;
    if (transaction.resolvedMonarchCategory !== undefined && transaction.resolvedMonarchCategory !== null) {
      // Transaction already has a resolved Monarch category from the category resolution process
      mappedCategory = transaction.resolvedMonarchCategory;
    } else {
      // Fallback to old category mapping (for backward compatibility)
      const originalCategory = transaction.merchant?.categoryDescription
        || transaction.merchant?.category
        || '';
      const mappingResult = applyCategoryMapping(originalCategory);

      // Ensure we never use raw bank categories in CSV - if mapping returns an object, use 'Uncategorized'
      if (typeof mappingResult === 'object') {
        mappedCategory = 'Uncategorized';
      } else {
        mappedCategory = mappingResult;
      }
    }

    // Check if this is a pending transaction
    const isPending = transaction.isPending === true;

    // Build notes field
    const notesParts: string[] = [];

    // Include transaction details if setting is enabled (for settled transactions)
    if (storeTransactionDetailsInNotes && !isPending) {
      const details = `${transaction.activityType || ''} / ${transaction.referenceNumber || ''}`.trim();
      if (details && details !== '/') {
        notesParts.push(details);
      }
    }

    // For pending transactions, always include the generated hash ID for reconciliation
    if (isPending && transaction.pendingId) {
      notesParts.push(transaction.pendingId);
    }

    const notes = notesParts.join('\n');

    return {
      Date: transaction.date || '',
      Merchant: mappedMerchant,
      Category: mappedCategory ?? '',
      Account: accountName,
      'Original Statement': transaction.merchant?.name || '',
      Notes: notes,
      Amount: -(transaction.amount?.value || 0), // Negate amount for Rogers transactions
      Tags: isPending ? 'Pending' : '',
    };
  });

  debugLog('Transformed transactions for CSV:', {
    originalCount: transactions.length,
    transformedCount: monarchRows.length,
    sample: monarchRows[0], // Log first row as sample
    resolvedCategoryCount: transactions.filter((t) => t.resolvedMonarchCategory).length,
    pendingCount: transactions.filter((t) => t.isPending).length,
  });

  return convertToCSV(monarchRows, MONARCH_CSV_COLUMNS);
}

/**
 * Convert MBNA transactions to Monarch CSV format
 *
 * Supports both settled and pending transactions:
 * - Settled transactions: standard CSV row with no tags
 * - Pending transactions: "Pending" tag and generated hash ID in notes (for reconciliation)
 */
export function convertMbnaTransactionsToMonarchCSV(
  transactions: MbnaTransaction[],
  accountName: string,
  options: MbnaCSVOptions = {},
): string {
  if (!transactions || transactions.length === 0) {
    return '';
  }

  const { storeTransactionDetailsInNotes = false } = options;

  // Transform transactions to Monarch format
  const monarchRows: CSVRow[] = transactions.map((transaction) => {
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

  return convertToCSV(monarchRows, MONARCH_CSV_COLUMNS);
}

/**
 * Format a Wealthsimple transaction ID for storage in Monarch notes
 * Uses the ws-tx: prefix format for consistent detection during reconciliation
 */
function formatTransactionIdForNotes(transactionId: string | undefined): string {
  if (!transactionId) return '';
  return `ws-tx:${transactionId}`;
}

/**
 * Build notes field for Wealthsimple transaction
 */
function buildWealthsimpleNotes({ memo, technicalDetails, formattedTxId, includeTransactionId }: {
  memo: string;
  technicalDetails: string;
  formattedTxId: string;
  includeTransactionId: boolean;
}): string {
  const parts: string[] = [];

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

  // 4. Transaction ID at the bottom (only for pending transactions)
  // Uses just the ws-tx: prefix format, without transaction type
  if (includeTransactionId && formattedTxId) {
    parts.push(formattedTxId);
  }

  return parts.join('\n');
}

/**
 * Convert Wealthsimple transactions to Monarch CSV format
 * Handles both credit card transactions (using status field) and CASH transactions (using isPending flag)
 */
export function convertWealthsimpleTransactionsToMonarchCSV(
  transactions: WealthsimpleTransaction[],
  accountName: string,
  options: WealthsimpleCSVOptions = {},
): string {
  if (!transactions || transactions.length === 0) {
    return '';
  }

  const { storeTransactionDetailsInNotes: _storeDetails = false } = options;

  // Transform transactions to Monarch format
  const monarchRows: CSVRow[] = transactions.map((transaction) => {
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
    let notes: string;

    if (isPending) {
      // Always include transaction ID for pending transactions (for de-duplication/reconciliation)
      notes = buildWealthsimpleNotes({
        memo,
        technicalDetails,
        formattedTxId,
        includeTransactionId: true,
      });
    } else {
      // Settled transactions: only include memo and technical details
      // Transaction ID is not stored in notes for settled transactions
      notes = buildWealthsimpleNotes({
        memo,
        technicalDetails,
        formattedTxId,
        includeTransactionId: false,
      });
    }

    return {
      Date: transaction.date || '',
      Merchant: transaction.merchant || '',
      Category: transaction.resolvedMonarchCategory ?? 'Uncategorized',
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
    storeTransactionDetailsInNotes: _storeDetails,
    sample: monarchRows[0], // Log first row as sample
  });

  return convertToCSV(monarchRows, MONARCH_CSV_COLUMNS);
}

/**
 * Convert Questrade orders to Monarch CSV format
 */
export function convertQuestradeOrdersToMonarchCSV(orders: QuestradeOrder[], accountName: string): string {
  if (!orders || orders.length === 0) {
    return '';
  }

  // Transform orders to Monarch format
  const monarchRows: CSVRow[] = orders.map((order) => {
    // Use security display name as merchant
    const merchant = order.security?.displayName || 'Unknown Security';

    // Use resolved Monarch category
    const category = order.resolvedMonarchCategory ?? 'Uncategorized';

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

  return convertToCSV(monarchRows, MONARCH_CSV_COLUMNS);
}

/**
 * Convert Questrade activity transactions to Monarch CSV format
 * Uses the transaction rules engine for categorization and formatting
 *
 * Supports rule-level overrides for special transaction types (like FX conversions):
 * - ruleResult.amountOverride: Use this amount instead of details.net.amount
 * - ruleResult.currencyOverride: Use this currency tag instead of details.net.currencyCode
 */
export function convertQuestradeTransactionsToMonarchCSV(
  transactions: QuestradeTransactionItem[],
  accountName: string,
): string {
  if (!transactions || transactions.length === 0) {
    return '';
  }

  // Transform transactions to Monarch format
  const monarchRows: CSVRow[] = transactions.map((item) => {
    const { transaction, details, ruleResult } = item;

    // Get amount - check for rule override first (for FX conversions, etc.)
    let amount = 0;
    if (ruleResult?.amountOverride !== undefined && ruleResult?.amountOverride !== null) {
      // Rule specified an override (e.g., FX conversion using .fx.baseCurrency.amount)
      amount = parseFloat(String(ruleResult.amountOverride)) || 0;
    } else if (details?.net?.amount !== undefined && details?.net?.amount !== null) {
      // Standard amount from .net.amount
      amount = parseFloat(String(details.net.amount)) || 0;
    }

    // Get date from transaction
    let date = '';
    const rawDate = (details?.transactionDate as string) || (transaction?.transactionDate as string);
    if (rawDate) {
      // If date includes time, extract just the date part
      if (rawDate.includes('T')) {
        date = rawDate.split('T')[0];
      } else {
        date = rawDate;
      }
    }

    // Get currency tag - check for rule override first (for FX conversions, etc.)
    let tags = '';
    if (ruleResult?.currencyOverride) {
      // Rule specified a currency override
      tags = ruleResult.currencyOverride;
    } else if (details?.net?.currencyCode && details.net.currencyCode !== 'CAD') {
      // Standard currency tag from .net.currencyCode (if not CAD)
      tags = details.net.currencyCode;
    }

    return {
      Date: date,
      Merchant: ruleResult?.merchant || 'Unknown',
      Category: ruleResult?.category ?? 'Uncategorized',
      Account: accountName,
      'Original Statement': ruleResult?.originalStatement || '',
      Notes: ruleResult?.notes || '',
      Amount: amount,
      Tags: tags,
    };
  });

  debugLog('Transformed Questrade transactions for CSV:', {
    originalCount: transactions.length,
    transformedCount: monarchRows.length,
    sample: monarchRows[0], // Log first row as sample
  });

  return convertToCSV(monarchRows, MONARCH_CSV_COLUMNS);
}

// ============================================================================
// CSV Parser
// ============================================================================

/**
 * Parse CSV string to array of objects
 */
export function parseCSV(csvString: string, hasHeader: boolean = true): Record<string, string>[] | string[][] {
  if (!csvString) {
    return [];
  }

  const lines = csvString.split('\n').filter((line) => line.trim());
  if (lines.length === 0) {
    return [];
  }

  // Simple CSV parser (doesn't handle all edge cases)
  const parseRow = (row: string): string[] => {
    const result: string[] = [];
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
    const obj: Record<string, string> = {};
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