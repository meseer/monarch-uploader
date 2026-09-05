/**
 * CSV Conversion Utilities
 * Handles conversion of data to CSV format
 */

import { debugLog } from '../core/utils';
import {
  STORAGE,
  MARKER_TAGS,
  MONARCH_CSV_FIELD_KEYS,
  MONARCH_CSV_OWNER_FIELD_KEY,
} from '../core/config';
import { applyMerchantMapping } from '../mappers/merchant';
import { applyCategoryMapping } from '../mappers/category';
// The notes-id rule lives with the retention rule it mirrors so the two halves
// of the marker-tag invariant cannot drift apart.
import { resolveNotesTransactionId } from '../core/markerTags';

// ============================================================================
// Types
// ============================================================================

/** A generic row for CSV conversion */
type CSVRow = Record<string, string | number | null | undefined>;

/** Options for Rogers Bank CSV conversion */
interface RogersBankCSVOptions {
  storeTransactionDetailsInNotes?: boolean;
}

/** Inputs for building the Monarch `Tags` column value */
export interface MonarchTagInputs {
  /** Adds the "Pending" tag, required for pending reconciliation */
  isPending?: boolean;
  /** Cardholder label (see services/common/cardholders) */
  cardholderTag?: string | null;
  /**
   * Adds the "pendingOwnerUpdate" marker tag, which queues this row for the
   * post-upload owner sync pass (see services/common/ownerSync).
   */
  ownerSyncPending?: boolean;
  /** Any additional tags, e.g. a foreign currency code */
  extraTags?: Array<string | null | undefined>;
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
  /** Stable hash id present on settled rows too, for post-upload correlation */
  txHashId?: string | null;
  resolvedMonarchCategory?: string | null;
  /** Monarch household member name — informational only (see MONARCH_CSV_COLUMNS) */
  cardholderOwner?: string | null;
  /** Cardholder label for the Tags column (set by cardholder service) */
  cardholderTag?: string | null;
  /** Monarch user id to assign after upload; presence queues the owner marker */
  cardholderOwnerUserId?: string | null;
  foreign?: {
    originalAmount?: { value?: string; currency?: string };
    conversionMarkupRate?: number;
    conversionRate?: number | { source?: string; parsedValue?: number };
    exchangeFee?: { value?: string; currency?: string };
  };
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
  /** Stable hash id present on settled rows too, for post-upload correlation */
  txHashId?: string | null;
  resolvedMonarchCategory?: string | null;
  autoCategory?: string | null;
  /** Monarch household member name — informational only (see MONARCH_CSV_COLUMNS) */
  cardholderOwner?: string | null;
  /** Cardholder label for the Tags column */
  cardholderTag?: string | null;
  /** Monarch user id to assign after upload; presence queues the owner marker */
  cardholderOwnerUserId?: string | null;
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
  /** ISO currency code for a foreign transaction (imported as a Monarch tag) */
  foreignCurrency?: string | null;
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

/**
 * Monarch CSV column order.
 *
 * `Owner` is **never read by Monarch** — its importer has no owner column and
 * rejects any attempt to map one (see `MONARCH_CSV_OWNER_FIELD_KEY`). The
 * column is retained purely so a human inspecting the generated CSV can see the
 * intended owner; the value is actually applied after upload by
 * `services/common/ownerSync`.
 *
 * Exported so `syncOrchestrator` reuses this single definition rather than
 * duplicating the column list.
 */
export const MONARCH_CSV_COLUMNS = [
  'Date',
  'Merchant',
  'Category',
  'Account',
  'Original Statement',
  'Notes',
  'Amount',
  'Tags',
  'Owner',
];

/**
 * Build the `columnMapping` payload for Monarch's statement parser.
 *
 * Monarch reads ONLY the columns named in this mapping — an unmapped column is
 * silently ignored rather than rejected. The mapping is derived from
 * `MONARCH_CSV_COLUMNS` rather than hand-written so the two cannot drift apart;
 * a hand-maintained literal is how the `Owner` column originally ended up
 * unmapped and therefore invisible to the importer.
 *
 * The Owner key is read from GM storage so candidate keys can be tried without
 * a rebuild (Monarch's accepted key name is unconfirmed):
 *
 *   GM_setValue('monarch_csv_owner_key', 'owner')   // try a different key
 *   GM_setValue('monarch_csv_owner_key', '')        // omit Owner entirely
 *
 * @returns JSON string of {monarchFieldName: columnIndex}
 */
export function buildMonarchColumnMapping(): string {
  const mapping: Record<string, number> = {};

  MONARCH_CSV_COLUMNS.forEach((column, index) => {
    const fieldKey = MONARCH_CSV_FIELD_KEYS[column];
    if (fieldKey) {
      mapping[fieldKey] = index;
    }
  });

  // Owner is resolved separately so the key remains overridable at runtime.
  const ownerIndex = MONARCH_CSV_COLUMNS.indexOf('Owner');
  if (ownerIndex !== -1) {
    let ownerKey = MONARCH_CSV_OWNER_FIELD_KEY;
    try {
      const override = GM_getValue(STORAGE.MONARCH_CSV_OWNER_KEY, undefined) as string | undefined;
      if (override !== undefined) {
        ownerKey = override;
      }
    } catch (error) {
      debugLog('Could not read Owner column key override, using default:', error);
    }

    // An empty key intentionally omits Owner from the mapping.
    if (ownerKey) {
      mapping[ownerKey] = ownerIndex;
    } else {
      debugLog('Owner column key override is empty — omitting Owner from columnMapping');
    }
  }

  return JSON.stringify(mapping);
}

/**
 * Build the Monarch `Tags` column value.
 *
 * Monarch's CSV importer reads multiple tags as a comma-separated list within
 * the quoted Tags field; `escapeCSVField` adds the quoting. Empty/duplicate
 * values are dropped so callers can pass optional values unconditionally.
 *
 * Note on reconciliation: `computeSettledTagIds` removes only the "Pending"
 * tag when a transaction settles, so cardholder and currency tags survive the
 * pending → settled transition without any extra work.
 *
 * `ownerSyncPending` adds the `pendingOwnerUpdate` marker, which is how the
 * post-upload owner pass finds these rows again (the CSV upload returns no
 * per-transaction ids, and no statement-id filter exists on the transaction
 * query, so a tag is the only available correlation handle).
 *
 * @returns Comma-separated tag list (empty string when there are no tags)
 */
export function buildMonarchTags({
  isPending = false,
  cardholderTag = null,
  ownerSyncPending = false,
  extraTags = [],
}: MonarchTagInputs = {}): string {
  const tags: string[] = [];

  if (isPending) {
    tags.push(MARKER_TAGS.PENDING);
  }

  if (ownerSyncPending) {
    tags.push(MARKER_TAGS.PENDING_OWNER_UPDATE);
  }

  if (cardholderTag) {
    tags.push(cardholderTag);
  }

  extraTags.forEach((tag) => {
    if (tag) tags.push(tag);
  });

  // De-duplicate while preserving order
  return [...new Set(tags)].join(',');
}

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

    // Add FX information for foreign currency transactions
    if (transaction.foreign?.originalAmount?.value) {
      const foreignAmount = transaction.foreign.originalAmount.value;
      const foreignCurrency = transaction.foreign.originalAmount.currency || '';

      if (isPending) {
        // Pending: FX rate not yet available
        notesParts.push(`${foreignAmount} ${foreignCurrency} @ pending`);
      } else {
        // Settled: prefer conversionMarkupRate (includes markup fee) over base conversionRate
        const conversionRate = transaction.foreign.conversionMarkupRate
          || (typeof transaction.foreign.conversionRate === 'number'
            ? transaction.foreign.conversionRate
            : (transaction.foreign.conversionRate as { parsedValue?: number })?.parsedValue || 0);

        const rateStr = conversionRate > 0 ? conversionRate.toString() : 'N/A';
        notesParts.push(`${foreignAmount} ${foreignCurrency} @ ${rateStr}`);

        // Include exchange fee if available
        if (transaction.foreign.exchangeFee?.value) {
          const feeAmount = transaction.foreign.exchangeFee.value;
          const feeCurrency = transaction.foreign.exchangeFee.currency || 'CAD';
          notesParts.push(`Exchange fee: ${feeAmount} ${feeCurrency}`);
        }
      }
    }

    // Pending rows always carry their hash for reconciliation; settled rows
    // carry it only when they still need a post-upload owner update.
    const ownerSyncPending = Boolean(transaction.cardholderOwnerUserId);
    const notesTxId = resolveNotesTransactionId({
      isPending,
      pendingId: transaction.pendingId,
      txHashId: transaction.txHashId,
      ownerSyncPending,
    });
    if (notesTxId) {
      notesParts.push(notesTxId);
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
      Tags: buildMonarchTags({ isPending, cardholderTag: transaction.cardholderTag, ownerSyncPending }),
      Owner: transaction.cardholderOwner || '',
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

    // Pending rows always carry their hash for reconciliation; settled rows
    // carry it only when they still need a post-upload owner update.
    const ownerSyncPending = Boolean(transaction.cardholderOwnerUserId);
    const notesTxId = resolveNotesTransactionId({
      isPending,
      pendingId: transaction.pendingId,
      txHashId: transaction.txHashId,
      ownerSyncPending,
    });
    if (notesTxId) {
      notesParts.push(notesTxId);
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
      Tags: buildMonarchTags({ isPending, cardholderTag: transaction.cardholderTag, ownerSyncPending }),
      Owner: transaction.cardholderOwner || '',
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
 * Resolve the Tags column value for a Wealthsimple transaction.
 *
 * Two independent tags may apply and both are emitted when relevant:
 * - "Pending" — required by reconciliation to find the transaction again
 * - the ISO currency code — lets foreign transactions be filtered in Monarch
 *
 * Wealthsimple populates FX data inconsistently: some foreign card
 * authorizations already carry the currency before settling, so a pending
 * foreign transaction gets both tags (`Pending,EUR`).
 *
 * At settlement, reconciliation removes only "Pending" and keeps the currency
 * tag (see `computeSettledTagIds`), so the tag set stays correct either way.
 *
 * @param transaction - Processed Wealthsimple transaction
 * @param isPending - Whether the transaction is pending
 * @returns Tag value for the CSV Tags column (empty string when none)
 */
function resolveWealthsimpleTags(transaction: WealthsimpleTransaction, isPending: boolean): string {
  return buildMonarchTags({
    isPending,
    extraTags: [transaction.foreignCurrency],
  });
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
      Tags: resolveWealthsimpleTags(transaction, isPending),
      Owner: '',
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
      Owner: '',
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
      Owner: '',
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
  buildMonarchTags,
  buildMonarchColumnMapping,
  parseCSV,
  escapeCSVField,
};
