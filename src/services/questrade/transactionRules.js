/**
 * Questrade Transaction Rules Engine
 * Handles automatic categorization and field mapping for different transaction types
 *
 * This file contains rules for processing Questrade account activity/transactions.
 * Each rule defines:
 * - match: A function that returns true if the rule applies to a transaction
 * - process: A function that extracts/generates the transaction fields
 *
 * Rules are evaluated in order - first matching rule wins.
 *
 * Transaction data flow:
 * 1. Basic transaction from activity API (includes transactionType, action, symbol, etc.)
 * 2. Full details from transactionUrl (includes .net.amount, .fx fields, symbol, price, quantity, etc.)
 * 3. Data is normalized (cleaned/trimmed) before rule matching
 * 4. Rules process normalized data and generate formatted output
 */

import { debugLog } from '../../core/utils';

/**
 * Clean a string value - trim whitespace and replace null/undefined with empty string
 * @param {*} value - Value to clean
 * @returns {string} Cleaned string
 */
export function cleanString(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

/**
 * Normalize transaction data for rule matching
 * Prefers details data over activity API data, and cleans all string values.
 * This ensures that whitespace-only values (like action: "   ") are normalized to empty strings.
 *
 * @param {Object} transaction - Basic transaction from activity API
 * @param {Object} details - Full details from transactionUrl (optional)
 * @returns {Object} Normalized transaction data for rule matching
 */
export function normalizeTransactionData(transaction, details) {
  // Prefer details over transaction for all fields
  const source = details || transaction || {};
  const txFallback = transaction || {};

  return {
    // Core fields - cleaned for matching
    transactionType: cleanString(source.transactionType || txFallback.transactionType),
    action: cleanString(source.action || txFallback.action),
    symbol: cleanString(source.symbol || txFallback.symbol),

    // Date fields
    transactionDate: cleanString(source.transactionDate || txFallback.transactionDate),
    settlementDate: cleanString(source.settlementDate || txFallback.settlementDate),

    // Description
    description: cleanString(source.description || txFallback.description),

    // Numeric/Object fields - preserve as-is from details
    price: details?.price || null,
    quantity: details?.quantity ?? txFallback.quantity ?? null,
    net: details?.net || null,
    fx: details?.fx || null,

    // Pass through original objects for any edge cases
    _transaction: transaction,
    _details: details,
  };
}

/**
 * Format a number by removing insignificant trailing zeroes
 * @param {number|string|null} value - Number to format
 * @returns {string} Formatted number string or empty string if null/undefined
 */
export function formatNumber(value) {
  if (value === null || value === undefined || value === '') {
    return '';
  }

  const num = parseFloat(value);
  if (isNaN(num)) {
    return '';
  }

  // Convert to string and remove trailing zeroes after decimal point
  // toFixed with enough precision, then strip trailing zeros
  const formatted = num.toFixed(10);
  return formatted.replace(/\.?0+$/, '');
}

/**
 * Format amount for display - removes trailing zeroes, handles negatives
 * @param {number|string|null} value - Amount to format
 * @returns {string} Formatted amount string
 */
export function formatAmount(value) {
  const formatted = formatNumber(value);
  return formatted || '0';
}

/**
 * Get the unique transaction ID for deduplication
 * Uses transactionUuid from the activity API
 * @param {Object} transaction - Transaction object from API
 * @returns {string} Transaction UUID for deduplication
 */
export function getTransactionId(transaction) {
  if (transaction.transactionUuid) {
    return transaction.transactionUuid;
  }

  // Fallback: generate deterministic ID if transactionUuid is missing
  const type = cleanString(transaction.transactionType);
  const action = cleanString(transaction.action);
  const date = cleanString(transaction.transactionDate);
  const symbol = cleanString(transaction.symbol);
  const amount = formatNumber(transaction.net?.amount);

  return `generated:${type}:${action}:${date}:${symbol}:${amount}`;
}

/**
 * Format original statement as TransactionType:Action:Symbol
 * Always includes all 3 segments, even if symbol is empty
 * @param {string|null} transactionType - Transaction type
 * @param {string|null} action - Action code
 * @param {string|null} symbol - Security symbol (optional)
 * @returns {string} Formatted original statement (e.g., "Dividends::AAPL" or "Dividends:DIV:")
 */
export function formatOriginalStatement(transactionType, action, symbol = null) {
  const type = cleanString(transactionType);
  const act = cleanString(action);
  const sym = cleanString(symbol);

  // Always include 3 segments: TransactionType:Action:Symbol
  return `${type}:${act}:${sym}`;
}

/**
 * Format transaction notes with description and settlement date
 * Settlement date is only included if it differs from transaction date
 *
 * @param {Object} normalized - Normalized transaction data
 * @returns {string} Formatted notes string
 */
export function formatTransactionNotes(normalized) {
  const lines = [];

  // Line 1: Description
  if (normalized.description) {
    lines.push(normalized.description);
  }

  // Line 2: Settlement Date - only if different from transaction date
  if (normalized.settlementDate && normalized.settlementDate !== normalized.transactionDate) {
    lines.push(`Settlement Date: ${normalized.settlementDate}`);
  }

  return lines.join('\n');
}

/**
 * Format notes for dividend transactions
 * Includes description, dividend per share, and settlement date (only if different from transaction date)
 *
 * @param {Object} normalized - Normalized transaction data
 * @returns {string} Formatted notes string
 */
export function formatDividendNotes(normalized) {
  const lines = [];

  // Line 1: Description
  if (normalized.description) {
    lines.push(normalized.description);
  }

  // Line 2: Dividend per share (from price object)
  if (normalized.price && normalized.price.amount !== undefined && normalized.price.amount !== null) {
    const amount = formatNumber(normalized.price.amount);
    const currency = cleanString(normalized.price.currency) || 'CAD';
    if (amount) {
      lines.push(`Dividend per share: ${amount} ${currency}`);
    }
  }

  // Line 3: Settlement Date - only if different from transaction date
  if (normalized.settlementDate && normalized.settlementDate !== normalized.transactionDate) {
    lines.push(`Settlement Date: ${normalized.settlementDate}`);
  }

  return lines.join('\n');
}

/**
 * Format notes for dividend reinvestment (DRIP) transactions
 * Includes description, quantity, price per share, and settlement date (only if different from transaction date)
 *
 * @param {Object} normalized - Normalized transaction data
 * @returns {string} Formatted notes string
 */
export function formatDividendReinvestmentNotes(normalized) {
  const lines = [];

  // Line 1: Description
  if (normalized.description) {
    lines.push(normalized.description);
  }

  // Line 2: Quantity (number of shares purchased)
  if (normalized.quantity !== undefined && normalized.quantity !== null) {
    const qty = formatNumber(normalized.quantity);
    if (qty) {
      lines.push(`Quantity: ${qty} shares`);
    }
  }

  // Line 3: Price per share
  if (normalized.price && normalized.price.amount !== undefined && normalized.price.amount !== null) {
    const amount = formatNumber(normalized.price.amount);
    const currency = cleanString(normalized.price.currency) || 'CAD';
    if (amount) {
      lines.push(`Price: ${amount} ${currency} per share`);
    }
  }

  // Line 4: Settlement Date - only if different from transaction date
  if (normalized.settlementDate && normalized.settlementDate !== normalized.transactionDate) {
    lines.push(`Settlement Date: ${normalized.settlementDate}`);
  }

  return lines.join('\n');
}

/**
 * Format notes for transactions with quantity (transfers, splits, journalling)
 * Includes description, quantity, price, and settlement date (only if different from transaction date)
 *
 * @param {Object} normalized - Normalized transaction data
 * @returns {string} Formatted notes string
 */
export function formatQuantityNotes(normalized) {
  const lines = [];

  // Line 1: Description
  if (normalized.description) {
    lines.push(normalized.description);
  }

  // Line 2: Quantity (number of shares/units)
  if (normalized.quantity !== undefined && normalized.quantity !== null) {
    const qty = formatNumber(normalized.quantity);
    if (qty) {
      lines.push(`Quantity: ${qty}`);
    }
  }

  // Line 3: Price per share (if available)
  if (normalized.price && normalized.price.amount !== undefined && normalized.price.amount !== null) {
    const amount = formatNumber(normalized.price.amount);
    const currency = cleanString(normalized.price.currency) || 'CAD';
    if (amount) {
      lines.push(`Price: ${amount} ${currency}`);
    }
  }

  // Line 4: Settlement Date - only if different from transaction date
  if (normalized.settlementDate && normalized.settlementDate !== normalized.transactionDate) {
    lines.push(`Settlement Date: ${normalized.settlementDate}`);
  }

  return lines.join('\n');
}

/**
 * Format FX conversion notes with exchange rate details
 * Settlement date is only included if it differs from transaction date
 *
 * @param {Object} normalized - Normalized transaction data
 * @returns {string} Formatted FX notes
 */
export function formatFxNotes(normalized) {
  const lines = [];

  // Description
  if (normalized.description) {
    lines.push(normalized.description);
  }

  // FX details from the normalized object
  if (normalized.fx) {
    const fxRate = formatNumber(normalized.fx.rate);
    const fxFromAmount = formatNumber(normalized.fx.fromAmount);
    const fxToAmount = formatNumber(normalized.fx.toAmount);
    const fxFromCurrency = cleanString(normalized.fx.fromCurrency);
    const fxToCurrency = cleanString(normalized.fx.toCurrency);

    if (fxRate) {
      lines.push(`Exchange Rate: ${fxRate}`);
    }
    if (fxFromAmount && fxFromCurrency) {
      lines.push(`From: ${fxFromAmount} ${fxFromCurrency}`);
    }
    if (fxToAmount && fxToCurrency) {
      lines.push(`To: ${fxToAmount} ${fxToCurrency}`);
    }
  }

  // Settlement date - only if different from transaction date
  if (normalized.settlementDate && normalized.settlementDate !== normalized.transactionDate) {
    lines.push(`Settlement Date: ${normalized.settlementDate}`);
  }

  return lines.join('\n');
}

/**
 * Determine category for interest transaction based on amount (using normalized data)
 * Positive = Interest income, Negative = Margin interest (Financial Fees)
 * @param {Object} normalized - Normalized transaction data with net.amount
 * @returns {string} Category name
 */
function getInterestCategoryFromNormalized(normalized) {
  const amount = parseFloat(normalized?.net?.amount) || 0;
  return amount < 0 ? 'Financial Fees' : 'Interest';
}

/**
 * Determine merchant for interest transaction based on amount (using normalized data)
 * Positive = Interest, Negative = Margin Interest
 * @param {Object} normalized - Normalized transaction data with net.amount
 * @returns {string} Merchant name
 */
function getInterestMerchantFromNormalized(normalized) {
  const amount = parseFloat(normalized?.net?.amount) || 0;
  return amount < 0 ? 'Margin Interest' : 'Interest';
}

/**
 * Determine merchant for fee/rebate transaction (using normalized data)
 * Positive amount = Rebate, Negative = Fee
 * @param {Object} normalized - Normalized transaction data with net.amount
 * @returns {string} Merchant name
 */
function getFeeMerchantFromNormalized(normalized) {
  const amount = parseFloat(normalized?.net?.amount) || 0;
  return amount > 0 ? 'Fee Rebate' : 'Fee';
}

/**
 * Questrade Transaction Rules
 * Each rule has:
 * - id: Unique identifier for the rule
 * - description: Human-readable description
 * - match: Function (normalized) => boolean - returns true if rule applies (normalized data)
 * - process: Function (normalized) => Object - returns processed fields (normalized data)
 *
 * Processed fields include:
 * - category: Monarch category name
 * - merchant: Merchant name for display (symbol when available)
 * - originalStatement: Original statement text (TransactionType:Action:Symbol)
 * - notes: Transaction notes with relevant details
 *
 * NOTE: All rules receive NORMALIZED data where:
 * - String fields are trimmed (whitespace-only values like "   " become "")
 * - Data is merged from details and transaction (details preferred)
 * - All string comparisons use cleaned values
 */
export const QUESTRADE_TRANSACTION_RULES = [
  // ============================================
  // CORPORATE ACTIONS
  // ============================================
  {
    id: 'corporate-actions-cil',
    description: 'Corporate Actions - Cash in Lieu',
    match: (n) => n.transactionType === 'Corporate actions' && n.action === 'CIL',
    process: (n) => ({
      category: 'Sell',
      merchant: n.symbol || 'Cash in Lieu',
      originalStatement: formatOriginalStatement(n.transactionType, n.action, n.symbol),
      notes: formatQuantityNotes(n),
    }),
  },
  {
    id: 'corporate-actions-nac',
    description: 'Corporate Actions - Name Change',
    match: (n) => n.transactionType === 'Corporate actions' && n.action === 'NAC',
    process: (n) => ({
      category: 'Investment',
      merchant: n.symbol || 'Name Change',
      originalStatement: formatOriginalStatement(n.transactionType, n.action, n.symbol),
      notes: formatQuantityNotes(n),
    }),
  },
  {
    id: 'corporate-actions-rev',
    description: 'Corporate Actions - Reverse Split',
    match: (n) => n.transactionType === 'Corporate actions' && n.action === 'REV',
    process: (n) => ({
      category: 'Investment',
      merchant: n.symbol || 'Reverse Split',
      originalStatement: formatOriginalStatement(n.transactionType, n.action, n.symbol),
      notes: formatQuantityNotes(n),
    }),
  },

  // ============================================
  // DEPOSITS
  // ============================================
  {
    id: 'deposits-con',
    description: 'Deposits - Contribution (internal transfer to registered account)',
    match: (n) => n.transactionType === 'Deposits' && n.action === 'CON',
    process: (n) => ({
      category: 'Transfer',
      merchant: 'Transfer In',
      originalStatement: formatOriginalStatement(n.transactionType, n.action, n.symbol),
      notes: formatTransactionNotes(n),
    }),
  },
  {
    id: 'deposits-dep',
    description: 'Deposits - Deposit (WIRE/PAD/Interac etc.)',
    match: (n) => n.transactionType === 'Deposits' && n.action === 'DEP',
    process: (n) => ({
      category: 'Transfer',
      merchant: 'Deposit',
      originalStatement: formatOriginalStatement(n.transactionType, n.action, n.symbol),
      notes: formatTransactionNotes(n),
    }),
  },

  // ============================================
  // DIVIDEND REINVESTMENT
  // ============================================
  {
    id: 'dividend-reinvestment-rei',
    description: 'Dividend Reinvestment - Purchase via dividend reinvestment',
    match: (n) => n.transactionType === 'Dividend reinvestment' && n.action === 'REI',
    process: (n) => ({
      category: 'Buy',
      merchant: n.symbol || 'DRIP',
      originalStatement: formatOriginalStatement(n.transactionType, n.action, n.symbol),
      notes: formatDividendReinvestmentNotes(n),
    }),
  },

  // ============================================
  // DIVIDENDS
  // ============================================
  {
    id: 'dividends-blank',
    description: 'Dividends - Distribution (blank action)',
    match: (n) => n.transactionType === 'Dividends' && n.action === '',
    process: (n) => ({
      category: 'Dividends & Capital Gains',
      merchant: n.symbol || 'Distribution',
      originalStatement: formatOriginalStatement(n.transactionType, n.action, n.symbol),
      notes: formatDividendNotes(n),
    }),
  },
  {
    id: 'dividends-dis',
    description: 'Dividends - Stock Split (actually DIS action)',
    match: (n) => n.transactionType === 'Dividends' && n.action === 'DIS',
    process: (n) => ({
      category: 'Investment',
      merchant: n.symbol || 'Stock Split',
      originalStatement: formatOriginalStatement(n.transactionType, n.action, n.symbol),
      notes: formatQuantityNotes(n),
    }),
  },
  {
    id: 'dividends-div',
    description: 'Dividends - Regular Dividends',
    match: (n) => n.transactionType === 'Dividends' && n.action === 'DIV',
    process: (n) => ({
      category: 'Dividends & Capital Gains',
      merchant: n.symbol || 'Dividend',
      originalStatement: formatOriginalStatement(n.transactionType, n.action, n.symbol),
      notes: formatDividendNotes(n),
    }),
  },

  // ============================================
  // FX CONVERSION
  // ============================================
  {
    id: 'fx-conversion-fxt',
    description: 'FX Conversion - Currency Exchange',
    match: (n) => n.transactionType === 'FX conversion' && n.action === 'FXT',
    process: (n) => ({
      category: 'Transfer',
      merchant: 'Currency Exchange',
      originalStatement: formatOriginalStatement(n.transactionType, n.action, n.symbol),
      notes: formatFxNotes(n),
    }),
  },

  // ============================================
  // FEES AND REBATES
  // ============================================
  {
    id: 'fees-rebates-fch',
    description: 'Fees and Rebates - Fee/Charge',
    match: (n) => n.transactionType === 'Fees and rebates' && n.action === 'FCH',
    process: (n) => ({
      category: 'Financial Fees',
      merchant: getFeeMerchantFromNormalized(n),
      originalStatement: formatOriginalStatement(n.transactionType, n.action, n.symbol),
      notes: formatTransactionNotes(n),
    }),
  },
  {
    id: 'fees-rebates-lfj',
    description: 'Fees and Rebates - Stock Lending Income',
    match: (n) => n.transactionType === 'Fees and rebates' && n.action === 'LFJ',
    process: (n) => ({
      category: 'Stock Lending',
      merchant: n.symbol || 'Stock Lending Income',
      originalStatement: formatOriginalStatement(n.transactionType, n.action, n.symbol),
      notes: formatTransactionNotes(n),
    }),
  },

  // ============================================
  // INTEREST
  // ============================================
  {
    id: 'interest-blank',
    description: 'Interest - Interest income or Margin interest (based on amount)',
    match: (n) => n.transactionType === 'Interest' && n.action === '',
    process: (n) => ({
      category: getInterestCategoryFromNormalized(n),
      merchant: getInterestMerchantFromNormalized(n),
      originalStatement: formatOriginalStatement(n.transactionType, n.action, n.symbol),
      notes: formatTransactionNotes(n),
    }),
  },

  // ============================================
  // OTHER
  // ============================================
  {
    id: 'other-brw',
    description: 'Other - Journalling (transfer between accounts)',
    match: (n) => n.transactionType === 'Other' && n.action === 'BRW',
    process: (n) => ({
      category: 'Investment',
      merchant: n.symbol || 'Journal Entry',
      originalStatement: formatOriginalStatement(n.transactionType, n.action, n.symbol),
      notes: formatQuantityNotes(n),
    }),
  },
  {
    id: 'other-gst',
    description: 'Other - GST on fees',
    match: (n) => n.transactionType === 'Other' && n.action === 'GST',
    process: (n) => ({
      category: 'Financial Fees',
      merchant: 'GST',
      originalStatement: formatOriginalStatement(n.transactionType, n.action, n.symbol),
      notes: formatTransactionNotes(n),
    }),
  },
  {
    id: 'other-lfj',
    description: 'Other - Stock Lending Income',
    match: (n) => n.transactionType === 'Other' && n.action === 'LFJ',
    process: (n) => ({
      category: 'Stock Lending',
      merchant: n.symbol || 'Stock Lending Income',
      originalStatement: formatOriginalStatement(n.transactionType, n.action, n.symbol),
      notes: formatTransactionNotes(n),
    }),
  },

  // ============================================
  // TRANSFERS
  // ============================================
  {
    id: 'transfers-tf6',
    description: 'Transfers - Transfer In (TF6)',
    match: (n) => n.transactionType === 'Transfers' && n.action === 'TF6',
    process: (n) => ({
      category: 'Transfer',
      merchant: n.symbol || 'Transfer In',
      originalStatement: formatOriginalStatement(n.transactionType, n.action, n.symbol),
      notes: formatQuantityNotes(n),
    }),
  },
  {
    id: 'transfers-tfi',
    description: 'Transfers - Transfer In (TFI)',
    match: (n) => n.transactionType === 'Transfers' && n.action === 'TFI',
    process: (n) => ({
      category: 'Transfer',
      merchant: n.symbol || 'Transfer In',
      originalStatement: formatOriginalStatement(n.transactionType, n.action, n.symbol),
      notes: formatQuantityNotes(n),
    }),
  },
  {
    id: 'transfers-tfo',
    description: 'Transfers - Transfer Out',
    match: (n) => n.transactionType === 'Transfers' && n.action === 'TFO',
    process: (n) => ({
      category: 'Transfer',
      merchant: n.symbol || 'Transfer Out',
      originalStatement: formatOriginalStatement(n.transactionType, n.action, n.symbol),
      notes: formatQuantityNotes(n),
    }),
  },
  {
    id: 'transfers-tsf',
    description: 'Transfers - Internal Transfer (between accounts)',
    match: (n) => n.transactionType === 'Transfers' && n.action === 'TSF',
    process: (n) => ({
      category: 'Transfer',
      merchant: n.symbol || 'Internal Transfer',
      originalStatement: formatOriginalStatement(n.transactionType, n.action, n.symbol),
      notes: formatQuantityNotes(n),
    }),
  },

  // ============================================
  // WITHDRAWALS
  // ============================================
  {
    id: 'withdrawals-con',
    description: 'Withdrawals - Contribution withdrawal from registered account',
    match: (n) => n.transactionType === 'Withdrawals' && n.action === 'CON',
    process: (n) => ({
      category: 'Transfer',
      merchant: 'Transfer Out',
      originalStatement: formatOriginalStatement(n.transactionType, n.action, n.symbol),
      notes: formatTransactionNotes(n),
    }),
  },
  {
    id: 'withdrawals-eft',
    description: 'Withdrawals - EFT Withdrawal',
    match: (n) => n.transactionType === 'Withdrawals' && n.action === 'EFT',
    process: (n) => ({
      category: 'Transfer',
      merchant: 'Withdrawal',
      originalStatement: formatOriginalStatement(n.transactionType, n.action, n.symbol),
      notes: formatTransactionNotes(n),
    }),
  },

  // ============================================
  // FALLBACK - Unknown Type/Action
  // ============================================
  {
    id: 'unknown-fallback',
    description: 'Fallback for unknown transaction type/action combinations',
    match: () => true, // Always matches as last resort
    process: (n) => ({
      category: 'Uncategorized',
      merchant: n.symbol || `${n.transactionType || 'Unknown'} - ${n.action || 'Unknown'}`,
      originalStatement: formatOriginalStatement(n.transactionType, n.action, n.symbol),
      notes: formatQuantityNotes(n),
    }),
  },
];

/**
 * Find and apply the matching rule for a transaction
 * Normalizes data before matching to ensure consistent string comparisons
 *
 * @param {Object} transaction - Transaction object from activity API
 * @param {Object} details - Full transaction details from transactionUrl (optional)
 * @returns {Object} Processed rule result
 */
export function applyTransactionRule(transaction, details = null) {
  const transactionId = getTransactionId(transaction);

  // Normalize the transaction data - cleans whitespace and merges details
  const normalized = normalizeTransactionData(transaction, details);

  for (const rule of QUESTRADE_TRANSACTION_RULES) {
    if (rule.match(normalized)) {
      debugLog(`Transaction ${transactionId} matched rule: ${rule.id}`);
      const result = rule.process(normalized);
      return {
        ...result,
        ruleId: rule.id,
      };
    }
  }

  // This should never happen since fallback rule always matches
  debugLog(`Transaction ${transactionId} - no matching rule found (unexpected)`);
  return {
    category: 'Uncategorized',
    merchant: 'Unknown',
    originalStatement: formatOriginalStatement(
      normalized.transactionType,
      normalized.action,
      normalized.symbol,
    ),
    notes: formatQuantityNotes(normalized),
    ruleId: 'no-match',
  };
}

/**
 * Check if a transaction should be filtered out
 * Trades are handled by the orders API, not the activity API
 * @param {Object} transaction - Transaction object
 * @returns {boolean} True if transaction should be excluded
 */
export function shouldFilterTransaction(transaction) {
  // Filter out Trades - they're handled by the orders API
  if (transaction.transactionType === 'Trades') {
    return true;
  }

  return false;
}

/**
 * Get the amount from transaction details
 * Uses .net.amount from the details object
 * @param {Object} details - Transaction details from transactionUrl
 * @returns {number} Amount value (can be negative)
 */
export function getTransactionAmount(details) {
  if (!details || !details.net || details.net.amount === undefined || details.net.amount === null) {
    return 0;
  }

  return parseFloat(details.net.amount) || 0;
}

/**
 * Get the currency tag for transaction (if not CAD)
 * @param {Object} details - Transaction details from transactionUrl
 * @returns {string} Currency code as tag if not CAD, empty string otherwise
 */
export function getCurrencyTag(details) {
  if (!details || !details.net || !details.net.currency) {
    return '';
  }

  const currency = cleanString(details.net.currency);
  return currency && currency !== 'CAD' ? currency : '';
}

/**
 * Get the transaction date
 * @param {Object} transaction - Transaction object
 * @param {Object} details - Transaction details (optional)
 * @returns {string} Date in YYYY-MM-DD format
 */
export function getTransactionDate(transaction, details = null) {
  // Prefer details date, fall back to transaction date
  const date = cleanString(details?.transactionDate || transaction?.transactionDate);

  // If date includes time, extract just the date part
  if (date && date.includes('T')) {
    return date.split('T')[0];
  }

  return date || '';
}

export default {
  QUESTRADE_TRANSACTION_RULES,
  applyTransactionRule,
  shouldFilterTransaction,
  getTransactionId,
  getTransactionAmount,
  getCurrencyTag,
  getTransactionDate,
  formatOriginalStatement,
  formatTransactionNotes,
  formatFxNotes,
  formatNumber,
  formatAmount,
  cleanString,
  normalizeTransactionData,
  formatDividendNotes,
  formatDividendReinvestmentNotes,
  formatQuantityNotes,
};
