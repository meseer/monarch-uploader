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
 * 2. Full details from transactionUrl (includes .net.amount, .fx fields, etc.)
 * 3. Combined data passed to rules for processing
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
 * @param {string|null} transactionType - Transaction type
 * @param {string|null} action - Action code
 * @param {string|null} symbol - Security symbol (optional)
 * @returns {string} Formatted original statement
 */
export function formatOriginalStatement(transactionType, action, symbol = null) {
  const type = cleanString(transactionType);
  const act = cleanString(action);
  const sym = cleanString(symbol);

  if (sym) {
    return `${type}:${act}:${sym}`;
  }
  return `${type}:${act}`;
}

/**
 * Format transaction notes with 3 lines (omit empty lines)
 * Line 1: description
 * Line 2: Transaction Date: {transactionDate}
 * Line 3: Settlement Date: {settlementDate}
 *
 * @param {Object} transaction - Transaction object
 * @param {Object} details - Transaction details from transactionUrl
 * @returns {string} Formatted notes string
 */
export function formatTransactionNotes(transaction, details) {
  const lines = [];

  // Line 1: Description (from details or transaction)
  const description = cleanString(details?.description || transaction?.description);
  if (description) {
    lines.push(description);
  }

  // Line 2: Transaction Date
  const transactionDate = cleanString(details?.transactionDate || transaction?.transactionDate);
  if (transactionDate) {
    lines.push(`Transaction Date: ${transactionDate}`);
  }

  // Line 3: Settlement Date
  const settlementDate = cleanString(details?.settlementDate || transaction?.settlementDate);
  if (settlementDate) {
    lines.push(`Settlement Date: ${settlementDate}`);
  }

  return lines.join('\n');
}

/**
 * Format FX conversion notes with exchange rate details
 * @param {Object} transaction - Transaction object
 * @param {Object} details - Transaction details with fx fields
 * @returns {string} Formatted FX notes
 */
export function formatFxNotes(transaction, details) {
  const lines = [];

  // Description
  const description = cleanString(details?.description || transaction?.description);
  if (description) {
    lines.push(description);
  }

  // FX details from the details object
  if (details?.fx) {
    const fxRate = formatNumber(details.fx.rate);
    const fxFromAmount = formatNumber(details.fx.fromAmount);
    const fxToAmount = formatNumber(details.fx.toAmount);
    const fxFromCurrency = cleanString(details.fx.fromCurrency);
    const fxToCurrency = cleanString(details.fx.toCurrency);

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

  // Transaction and settlement dates
  const transactionDate = cleanString(details?.transactionDate || transaction?.transactionDate);
  if (transactionDate) {
    lines.push(`Transaction Date: ${transactionDate}`);
  }

  const settlementDate = cleanString(details?.settlementDate || transaction?.settlementDate);
  if (settlementDate) {
    lines.push(`Settlement Date: ${settlementDate}`);
  }

  return lines.join('\n');
}

/**
 * Determine category for interest transaction based on amount
 * Positive = Interest income, Negative = Margin interest (Financial Fees)
 * @param {Object} details - Transaction details with net.amount
 * @returns {string} Category name
 */
function getInterestCategory(details) {
  const amount = parseFloat(details?.net?.amount) || 0;
  return amount < 0 ? 'Financial Fees' : 'Interest';
}

/**
 * Determine merchant for interest transaction based on amount
 * Positive = Interest, Negative = Margin Interest
 * @param {Object} details - Transaction details with net.amount
 * @returns {string} Merchant name
 */
function getInterestMerchant(details) {
  const amount = parseFloat(details?.net?.amount) || 0;
  return amount < 0 ? 'Margin Interest' : 'Interest';
}

/**
 * Determine category for fee/rebate based on amount
 * Both fees and rebates fall under Financial Fees category
 * @param {Object} _details - Transaction details (unused, category is always Financial Fees)
 * @returns {string} Category name
 */
function getFeeCategory(_details) {
  // Even rebates (positive) still fall under Financial Fees as a category
  return 'Financial Fees';
}

/**
 * Determine merchant for fee/rebate transaction
 * Positive amount = Rebate, Negative = Fee
 * @param {Object} details - Transaction details with net.amount
 * @returns {string} Merchant name
 */
function getFeeMerchant(details) {
  const amount = parseFloat(details?.net?.amount) || 0;
  return amount > 0 ? 'Fee Rebate' : 'Fee';
}

/**
 * Questrade Transaction Rules
 * Each rule has:
 * - id: Unique identifier for the rule
 * - description: Human-readable description
 * - match: Function (transaction) => boolean - returns true if rule applies
 * - process: Function (transaction, details) => Object - returns processed fields
 *
 * Processed fields include:
 * - category: Monarch category name
 * - merchant: Merchant name for display
 * - originalStatement: Original statement text (TransactionType:Action:Symbol)
 * - notes: Transaction notes
 */
export const QUESTRADE_TRANSACTION_RULES = [
  // ============================================
  // CORPORATE ACTIONS
  // ============================================
  {
    id: 'corporate-actions-cil',
    description: 'Corporate Actions - Cash in Lieu',
    match: (tx) => tx.transactionType === 'Corporate actions' && tx.action === 'CIL',
    process: (tx, details) => ({
      category: 'Sell',
      merchant: cleanString(tx.symbol) || 'Cash in Lieu',
      originalStatement: formatOriginalStatement(tx.transactionType, tx.action, tx.symbol),
      notes: formatTransactionNotes(tx, details),
    }),
  },
  {
    id: 'corporate-actions-nac',
    description: 'Corporate Actions - Name Change',
    match: (tx) => tx.transactionType === 'Corporate actions' && tx.action === 'NAC',
    process: (tx, details) => ({
      category: 'Investment',
      merchant: cleanString(tx.symbol) || 'Name Change',
      originalStatement: formatOriginalStatement(tx.transactionType, tx.action, tx.symbol),
      notes: formatTransactionNotes(tx, details),
    }),
  },
  {
    id: 'corporate-actions-rev',
    description: 'Corporate Actions - Reverse Split',
    match: (tx) => tx.transactionType === 'Corporate actions' && tx.action === 'REV',
    process: (tx, details) => ({
      category: 'Investment',
      merchant: cleanString(tx.symbol) || 'Reverse Split',
      originalStatement: formatOriginalStatement(tx.transactionType, tx.action, tx.symbol),
      notes: formatTransactionNotes(tx, details),
    }),
  },

  // ============================================
  // DEPOSITS
  // ============================================
  {
    id: 'deposits-con',
    description: 'Deposits - Contribution (internal transfer to registered account)',
    match: (tx) => tx.transactionType === 'Deposits' && tx.action === 'CON',
    process: (tx, details) => ({
      category: 'Transfer',
      merchant: 'Transfer In',
      originalStatement: formatOriginalStatement(tx.transactionType, tx.action, tx.symbol),
      notes: formatTransactionNotes(tx, details),
    }),
  },
  {
    id: 'deposits-dep',
    description: 'Deposits - Deposit (WIRE/PAD/Interac etc.)',
    match: (tx) => tx.transactionType === 'Deposits' && tx.action === 'DEP',
    process: (tx, details) => ({
      category: 'Transfer',
      merchant: 'Deposit',
      originalStatement: formatOriginalStatement(tx.transactionType, tx.action, tx.symbol),
      notes: formatTransactionNotes(tx, details),
    }),
  },

  // ============================================
  // DIVIDEND REINVESTMENT
  // ============================================
  {
    id: 'dividend-reinvestment-rei',
    description: 'Dividend Reinvestment - Purchase via dividend reinvestment',
    match: (tx) => tx.transactionType === 'Dividend reinvestment' && tx.action === 'REI',
    process: (tx, details) => ({
      category: 'Buy',
      merchant: cleanString(tx.symbol) || 'DRIP',
      originalStatement: formatOriginalStatement(tx.transactionType, tx.action, tx.symbol),
      notes: formatTransactionNotes(tx, details),
    }),
  },

  // ============================================
  // DIVIDENDS
  // ============================================
  {
    id: 'dividends-blank',
    description: 'Dividends - Distribution (blank action)',
    match: (tx) => tx.transactionType === 'Dividends' && (!tx.action || tx.action === ''),
    process: (tx, details) => ({
      category: 'Dividends & Capital Gains',
      merchant: cleanString(tx.symbol) || 'Distribution',
      originalStatement: formatOriginalStatement(tx.transactionType, tx.action, tx.symbol),
      notes: formatTransactionNotes(tx, details),
    }),
  },
  {
    id: 'dividends-dis',
    description: 'Dividends - Stock Split (actually DIS action)',
    match: (tx) => tx.transactionType === 'Dividends' && tx.action === 'DIS',
    process: (tx, details) => ({
      category: 'Investment',
      merchant: cleanString(tx.symbol) || 'Stock Split',
      originalStatement: formatOriginalStatement(tx.transactionType, tx.action, tx.symbol),
      notes: formatTransactionNotes(tx, details),
    }),
  },
  {
    id: 'dividends-div',
    description: 'Dividends - Regular Dividends',
    match: (tx) => tx.transactionType === 'Dividends' && tx.action === 'DIV',
    process: (tx, details) => ({
      category: 'Dividends & Capital Gains',
      merchant: cleanString(tx.symbol) || 'Dividend',
      originalStatement: formatOriginalStatement(tx.transactionType, tx.action, tx.symbol),
      notes: formatTransactionNotes(tx, details),
    }),
  },

  // ============================================
  // FX CONVERSION
  // ============================================
  {
    id: 'fx-conversion-fxt',
    description: 'FX Conversion - Currency Exchange',
    match: (tx) => tx.transactionType === 'FX conversion' && tx.action === 'FXT',
    process: (tx, details) => ({
      category: 'Transfer',
      merchant: 'Currency Exchange',
      originalStatement: formatOriginalStatement(tx.transactionType, tx.action, tx.symbol),
      notes: formatFxNotes(tx, details),
    }),
  },

  // ============================================
  // FEES AND REBATES
  // ============================================
  {
    id: 'fees-rebates-fch',
    description: 'Fees and Rebates - Fee/Charge',
    match: (tx) => tx.transactionType === 'Fees and rebates' && tx.action === 'FCH',
    process: (tx, details) => ({
      category: getFeeCategory(details),
      merchant: getFeeMerchant(details),
      originalStatement: formatOriginalStatement(tx.transactionType, tx.action, tx.symbol),
      notes: formatTransactionNotes(tx, details),
    }),
  },
  {
    id: 'fees-rebates-lfj',
    description: 'Fees and Rebates - Stock Lending Income',
    match: (tx) => tx.transactionType === 'Fees and rebates' && tx.action === 'LFJ',
    process: (tx, details) => ({
      category: 'Stock Lending',
      merchant: 'Stock Lending Income',
      originalStatement: formatOriginalStatement(tx.transactionType, tx.action, tx.symbol),
      notes: formatTransactionNotes(tx, details),
    }),
  },

  // ============================================
  // INTEREST
  // ============================================
  {
    id: 'interest-blank',
    description: 'Interest - Interest income or Margin interest (based on amount)',
    match: (tx) => tx.transactionType === 'Interest' && (!tx.action || tx.action === ''),
    process: (tx, details) => ({
      category: getInterestCategory(details),
      merchant: getInterestMerchant(details),
      originalStatement: formatOriginalStatement(tx.transactionType, tx.action, tx.symbol),
      notes: formatTransactionNotes(tx, details),
    }),
  },

  // ============================================
  // OTHER
  // ============================================
  {
    id: 'other-brw',
    description: 'Other - Journalling (transfer between accounts)',
    match: (tx) => tx.transactionType === 'Other' && tx.action === 'BRW',
    process: (tx, details) => ({
      category: 'Investment',
      merchant: cleanString(tx.symbol) || 'Journal Entry',
      originalStatement: formatOriginalStatement(tx.transactionType, tx.action, tx.symbol),
      notes: formatTransactionNotes(tx, details),
    }),
  },
  {
    id: 'other-gst',
    description: 'Other - GST on fees',
    match: (tx) => tx.transactionType === 'Other' && tx.action === 'GST',
    process: (tx, details) => ({
      category: 'Financial Fees',
      merchant: 'GST',
      originalStatement: formatOriginalStatement(tx.transactionType, tx.action, tx.symbol),
      notes: formatTransactionNotes(tx, details),
    }),
  },
  {
    id: 'other-lfj',
    description: 'Other - Stock Lending Income',
    match: (tx) => tx.transactionType === 'Other' && tx.action === 'LFJ',
    process: (tx, details) => ({
      category: 'Stock Lending',
      merchant: 'Stock Lending Income',
      originalStatement: formatOriginalStatement(tx.transactionType, tx.action, tx.symbol),
      notes: formatTransactionNotes(tx, details),
    }),
  },

  // ============================================
  // TRANSFERS
  // ============================================
  {
    id: 'transfers-tf6',
    description: 'Transfers - Transfer In (TF6)',
    match: (tx) => tx.transactionType === 'Transfers' && tx.action === 'TF6',
    process: (tx, details) => ({
      category: 'Transfer',
      merchant: cleanString(tx.symbol) || 'Transfer In',
      originalStatement: formatOriginalStatement(tx.transactionType, tx.action, tx.symbol),
      notes: formatTransactionNotes(tx, details),
    }),
  },
  {
    id: 'transfers-tfi',
    description: 'Transfers - Transfer In (TFI)',
    match: (tx) => tx.transactionType === 'Transfers' && tx.action === 'TFI',
    process: (tx, details) => ({
      category: 'Transfer',
      merchant: cleanString(tx.symbol) || 'Transfer In',
      originalStatement: formatOriginalStatement(tx.transactionType, tx.action, tx.symbol),
      notes: formatTransactionNotes(tx, details),
    }),
  },
  {
    id: 'transfers-tfo',
    description: 'Transfers - Transfer Out',
    match: (tx) => tx.transactionType === 'Transfers' && tx.action === 'TFO',
    process: (tx, details) => ({
      category: 'Transfer',
      merchant: cleanString(tx.symbol) || 'Transfer Out',
      originalStatement: formatOriginalStatement(tx.transactionType, tx.action, tx.symbol),
      notes: formatTransactionNotes(tx, details),
    }),
  },
  {
    id: 'transfers-tsf',
    description: 'Transfers - Internal Transfer (between accounts)',
    match: (tx) => tx.transactionType === 'Transfers' && tx.action === 'TSF',
    process: (tx, details) => ({
      category: 'Transfer',
      merchant: 'Internal Transfer',
      originalStatement: formatOriginalStatement(tx.transactionType, tx.action, tx.symbol),
      notes: formatTransactionNotes(tx, details),
    }),
  },

  // ============================================
  // WITHDRAWALS
  // ============================================
  {
    id: 'withdrawals-con',
    description: 'Withdrawals - Contribution withdrawal from registered account',
    match: (tx) => tx.transactionType === 'Withdrawals' && tx.action === 'CON',
    process: (tx, details) => ({
      category: 'Transfer',
      merchant: 'Transfer Out',
      originalStatement: formatOriginalStatement(tx.transactionType, tx.action, tx.symbol),
      notes: formatTransactionNotes(tx, details),
    }),
  },
  {
    id: 'withdrawals-eft',
    description: 'Withdrawals - EFT Withdrawal',
    match: (tx) => tx.transactionType === 'Withdrawals' && tx.action === 'EFT',
    process: (tx, details) => ({
      category: 'Transfer',
      merchant: 'Withdrawal',
      originalStatement: formatOriginalStatement(tx.transactionType, tx.action, tx.symbol),
      notes: formatTransactionNotes(tx, details),
    }),
  },

  // ============================================
  // FALLBACK - Unknown Type/Action
  // ============================================
  {
    id: 'unknown-fallback',
    description: 'Fallback for unknown transaction type/action combinations',
    match: () => true, // Always matches as last resort
    process: (tx, details) => {
      const type = cleanString(tx.transactionType) || 'Unknown';
      const action = cleanString(tx.action) || 'Unknown';

      return {
        category: 'Uncategorized',
        merchant: `${type} - ${action}`,
        originalStatement: formatOriginalStatement(tx.transactionType, tx.action, tx.symbol),
        notes: formatTransactionNotes(tx, details),
      };
    },
  },
];

/**
 * Find and apply the matching rule for a transaction
 * @param {Object} transaction - Transaction object from activity API
 * @param {Object} details - Full transaction details from transactionUrl (optional)
 * @returns {Object} Processed rule result
 */
export function applyTransactionRule(transaction, details = null) {
  const transactionId = getTransactionId(transaction);

  for (const rule of QUESTRADE_TRANSACTION_RULES) {
    if (rule.match(transaction)) {
      debugLog(`Transaction ${transactionId} matched rule: ${rule.id}`);
      const result = rule.process(transaction, details);
      return {
        ...result,
        ruleId: rule.id,
      };
    }
  }

  // This should never happen since we have a fallback rule
  debugLog(`No rule matched for transaction ${transactionId}`, {
    transactionType: transaction.transactionType,
    action: transaction.action,
  });

  return {
    category: 'Uncategorized',
    merchant: 'Unknown Transaction',
    originalStatement: formatOriginalStatement(transaction.transactionType, transaction.action, transaction.symbol),
    notes: formatTransactionNotes(transaction, details),
    ruleId: 'error-no-match',
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
};
