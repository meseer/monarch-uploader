/**
 * Wealthsimple Transaction Rules - Investment Rules
 * Rules for investment account transactions (fees, dividends, buy/sell, etc.)
 */

import { formatAmount } from '../../core/utils';
import {
  toSentenceCase,
  formatPrettyDate,
  formatOriginalStatement,
  formatInvestmentOrderNotes,
  formatOptionsOrderNotes,
  getAccountNameById,
} from './transactionRulesHelpers';

export const INVESTMENT_FEE_TRANSACTION_RULES = [
  {
    id: 'fee',
    description: 'Fee transactions for investment accounts (service fees, management fees, etc.)',
    match: (tx) => tx.type === 'FEE',
    /**
     * Process FEE transactions
     * These are fees charged on investment accounts such as management fees, service fees, etc.
     *
     * Merchant logic:
     * - If subType is null/undefined/empty: "Fee ({accountName})"
     * - Otherwise: "sentenceCase(subType) ({accountName})" (e.g., "SERVICE_FEE" -> "Service fee (My TFSA)")
     *
     * @param {Object} tx - Raw transaction
     * @returns {Object} Processed transaction fields
     */
    process: (tx) => {
      const subType = tx.subType || '';
      const currency = tx.currency || 'CAD';
      const accountName = getAccountNameById(tx.accountId);

      // Merchant: "Fee ({accountName})" if no subType, otherwise "sentenceCase(subType) ({accountName})"
      const merchant = subType ? `${toSentenceCase(subType)} (${accountName})` : `Fee (${accountName})`;

      return {
        category: 'Financial Fees',
        merchant,
        originalStatement: formatOriginalStatement(tx.type, subType, currency),
        notes: '',
        technicalDetails: '',
      };
    },
  },
];

/**
 * Investment account refund transaction rules
 * These rules handle refund transactions in investment accounts
 *
 * Transaction types supported:
 * - REFUND: Refunds such as fee refunds, transfer fee refunds, etc.
 */
export const INVESTMENT_REFUND_TRANSACTION_RULES = [
  {
    id: 'refund',
    description: 'Refund transactions for investment accounts (fee refunds, transfer fee refunds, etc.)',
    match: (tx) => tx.type === 'REFUND',
    /**
     * Process REFUND transactions
     * These are refunds such as transfer fee refunds, account fee refunds, etc.
     *
     * Merchant logic:
     * - If subType is null/undefined: "Refund"
     * - Otherwise: sentenceCase(subType) (e.g., "TRANSFER_FEE_REFUND" -> "Transfer fee refund")
     *
     * @param {Object} tx - Raw transaction
     * @returns {Object} Processed transaction fields
     */
    process: (tx) => {
      const subType = tx.subType || '';
      const assetSymbol = tx.assetSymbol || '';

      // Merchant: "Refund" if no subType, otherwise sentenceCase(subType)
      const merchant = subType ? toSentenceCase(subType) : 'Refund';

      return {
        category: 'Financial Fees',
        merchant,
        originalStatement: formatOriginalStatement(tx.type, subType, assetSymbol),
        notes: '',
        technicalDetails: '',
      };
    },
  },
];

/**
 * Investment account institutional transfer transaction rules
 * These rules handle transfers to/from external financial institutions
 *
 * Transaction types supported:
 * - INSTITUTIONAL_TRANSFER_INTENT: Transfers to/from external institutions (e.g., moving registered accounts)
 */
export const INVESTMENT_INSTITUTIONAL_TRANSFER_RULES = [
  {
    id: 'institutional-transfer-intent',
    description: 'Institutional transfer transactions (transfers to/from external institutions)',
    match: (tx) => tx.type === 'INSTITUTIONAL_TRANSFER_INTENT',
    /**
     * Process INSTITUTIONAL_TRANSFER_INTENT transactions
     * These are transfers between Wealthsimple and external financial institutions
     * (e.g., transferring a TFSA from another bank to Wealthsimple)
     *
     * SubType handling:
     * - TRANSFER_IN: Transfer coming into Wealthsimple from external institution
     * - TRANSFER_OUT: Transfer going out from Wealthsimple to external institution
     * - Other subTypes: Fallback using sentence case formatting
     *
     * @param {Object} tx - Raw transaction
     * @returns {Object} Processed transaction fields
     */
    process: (tx) => {
      const institutionName = tx.institutionName || 'Unknown Institution';
      const subType = tx.subType || '';

      let merchant;
      if (subType === 'TRANSFER_IN') {
        merchant = `Transfer In from ${institutionName}`;
      } else if (subType === 'TRANSFER_OUT') {
        merchant = `Transfer Out to ${institutionName}`;
      } else {
        // Fallback for other subTypes: sentenceCase(subType) + institutionName
        const subTypeDisplay = subType ? toSentenceCase(subType) : '';
        merchant = subTypeDisplay ? `${subTypeDisplay} ${institutionName}` : institutionName;
      }

      return {
        category: 'Transfer',
        merchant,
        originalStatement: formatOriginalStatement(tx.type, subType, institutionName),
        notes: '',
        technicalDetails: '',
      };
    },
  },
];

/**
 * Investment account deposit transaction rules
 * These rules handle deposit transactions in investment accounts
 *
 * Transaction types supported:
 * - DEPOSIT: Deposits into investment accounts (one-time or recurring)
 */
export const INVESTMENT_DEPOSIT_TRANSACTION_RULES = [
  {
    id: 'deposit',
    description: 'Deposit transactions for investment accounts',
    match: (tx) => tx.type === 'DEPOSIT',
    /**
     * Process DEPOSIT transactions for investment accounts
     * These are deposits into investment accounts (can be one-time or recurring)
     *
     * @param {Object} tx - Raw transaction
     * @returns {Object} Processed transaction fields
     */
    process: (tx) => {
      const frequency = tx.frequency || '';
      const currency = tx.currency || 'CAD';
      const amount = formatAmount(tx.amount ?? 0);
      const subType = tx.subType || '';

      // Build frequency prefix for merchant and notes
      const frequencyPrefix = frequency ? `${toSentenceCase(frequency)} ` : '';

      // Merchant: "sentenceCase({frequency}) Deposit ($currency)" or "Deposit ($currency)" if no frequency
      const merchant = `${frequencyPrefix}Deposit (${currency})`;

      // Notes: "sentenceCase({frequency}) deposit of {currency}${amount}" or "Deposit of {currency}${amount}" if no frequency
      const notesPrefix = frequency ? `${toSentenceCase(frequency)} deposit` : 'Deposit';
      const notes = `${notesPrefix} of ${currency}$${amount}`;

      return {
        category: 'Investment',
        merchant,
        originalStatement: formatOriginalStatement(tx.type, subType, frequency),
        notes,
        technicalDetails: '',
      };
    },
  },
];

/**
 * Format a number with up to specified decimal places, removing trailing zeroes
 * @param {number|string} value - The value to format
 * @param {number} maxDecimals - Maximum number of decimal places (default 4)
 * @returns {string} Formatted number string
 */
export function formatNumberWithPrecision(value, maxDecimals = 4) {
  if (value === null || value === undefined) return '';
  const num = parseFloat(value);
  if (isNaN(num)) return '';
  // Format with max decimals, then remove trailing zeroes
  return num.toFixed(maxDecimals).replace(/\.?0+$/, '');
}

/**
 * Format dividend transaction notes with enhanced details
 * Includes holdings on record date, gross dividend rate, withholding tax, and key dates
 *
 * @param {Object} tx - Raw transaction from Wealthsimple API
 * @returns {string} Formatted notes string
 */
export function formatDividendNotes(tx) {
  if (!tx) return '';

  const symbol = tx.assetSymbol || 'Unknown';
  const currency = tx.currency || 'CAD';
  const amount = formatAmount(tx.amount ?? 0);

  const noteLines = [];

  // Line 1: Main dividend info (different for manufactured dividends)
  if (tx.subType === 'MANUFACTURED_DIVIDEND') {
    noteLines.push(`Dividend on lended ${symbol} shares: ${currency}$${amount}`);
  } else {
    noteLines.push(`Dividend on ${symbol}: ${currency}$${amount}`);
  }

  // Line 2: Holdings on record date (if available)
  if (tx.assetQuantity !== null && tx.assetQuantity !== undefined) {
    const formattedQuantity = formatNumberWithPrecision(tx.assetQuantity, 4);
    if (formattedQuantity) {
      noteLines.push(`Holdings on record date: ${formattedQuantity} shares`);
    }
  }

  // Line 3: Gross dividend rate (if available)
  if (tx.grossDividendRate !== null && tx.grossDividendRate !== undefined) {
    const formattedRate = formatNumberWithPrecision(tx.grossDividendRate, 4);
    if (formattedRate) {
      noteLines.push(`Gross dividend rate: ${currency}$${formattedRate} per share`);
    }
  }

  // Line 4: Withholding tax (if available) - shown as positive
  if (tx.withholdingTaxAmount !== null && tx.withholdingTaxAmount !== undefined) {
    const taxAmount = Math.abs(parseFloat(tx.withholdingTaxAmount) || 0);
    if (taxAmount > 0) {
      const formattedTax = formatAmount(taxAmount);
      noteLines.push(`Withholding tax: ${currency}$${formattedTax}`);
    }
  }

  // Line 5: Announcement date (if available)
  if (tx.announcementDate) {
    const formattedDate = formatPrettyDate(tx.announcementDate);
    if (formattedDate) {
      noteLines.push(`Announcement date: ${formattedDate}`);
    }
  }

  // Line 6: Record date (if available)
  if (tx.recordDate) {
    const formattedDate = formatPrettyDate(tx.recordDate);
    if (formattedDate) {
      noteLines.push(`Record date: ${formattedDate}`);
    }
  }

  // Line 7: Payable date (if available)
  if (tx.payableDate) {
    const formattedDate = formatPrettyDate(tx.payableDate);
    if (formattedDate) {
      noteLines.push(`Payable date: ${formattedDate}`);
    }
  }

  return noteLines.join('\n');
}

/**
 * Investment account dividend transaction rules
 * These rules handle dividend transactions in investment accounts
 *
 * Transaction types supported:
 * - DIVIDEND: Dividend payments on held securities
 *   - subType null: For MANAGED_* accounts (robo-advisor)
 *   - subType DIY_DIVIDEND: For SELF_DIRECTED accounts (regular dividends)
 *   - subType MANUFACTURED_DIVIDEND: For SELF_DIRECTED accounts (dividends on lended shares)
 */
export const INVESTMENT_DIVIDEND_TRANSACTION_RULES = [
  {
    id: 'dividend',
    description: 'Dividend transactions for investment accounts (managed and DIY)',
    match: (tx) => tx.type === 'DIVIDEND',
    /**
     * Process DIVIDEND transactions
     * These are dividend payments received on held securities
     *
     * SubType variations:
     * - null: For MANAGED_* accounts (robo-advisor managed)
     * - DIY_DIVIDEND: For SELF_DIRECTED accounts (regular dividends)
     * - MANUFACTURED_DIVIDEND: For SELF_DIRECTED accounts (dividends on lended shares)
     *
     * Enhanced notes include:
     * - Holdings on record date (assetQuantity)
     * - Gross dividend rate (grossDividendRate)
     * - Withholding tax amount (withholdingTaxAmount)
     * - Announcement date (announcementDate)
     * - Record date (recordDate)
     * - Payable date (payableDate)
     *
     * @param {Object} tx - Raw transaction
     * @returns {Object} Processed transaction fields
     */
    process: (tx) => {
      const symbol = tx.assetSymbol || 'Unknown';

      return {
        category: 'Dividends & Capital Gains',
        merchant: symbol,
        originalStatement: formatOriginalStatement(tx.type, tx.subType, symbol),
        notes: formatDividendNotes(tx),
        technicalDetails: '',
      };
    },
  },
];

/**
 * Investment account interest transaction rules
 * These rules handle interest transactions in investment accounts
 *
 * Transaction types supported:
 * - INTEREST: Interest payments in investment accounts
 *   - subType FPL_INTEREST: Fully Paid Lending interest (stock lending earnings)
 *   - Other subTypes: Generic interest transactions
 */
export const INVESTMENT_INTEREST_TRANSACTION_RULES = [
  {
    id: 'fpl-interest',
    description: 'Fully Paid Lending interest (stock lending earnings)',
    match: (tx) => tx.type === 'INTEREST' && tx.subType === 'FPL_INTEREST',
    /**
     * Process INTEREST/FPL_INTEREST transactions
     * These are earnings from Wealthsimple's Fully Paid Securities Lending program
     *
     * @param {Object} tx - Raw transaction
     * @returns {Object} Processed transaction fields
     */
    process: (tx) => {
      const currency = tx.currency || 'CAD';

      return {
        category: 'Stock Lending',
        merchant: `Stock Lending Earnings (${currency})`,
        originalStatement: formatOriginalStatement(tx.type, tx.subType, currency),
        notes: '',
        technicalDetails: '',
      };
    },
  },
  {
    id: 'interest',
    description: 'Interest transactions for investment accounts (generic)',
    match: (tx) => tx.type === 'INTEREST',
    /**
     * Process generic INTEREST transactions (fallback for non-FPL subTypes)
     * Handles various interest types like SAVINGS_INTEREST, PROMO_INTEREST, etc.
     *
     * @param {Object} tx - Raw transaction
     * @returns {Object} Processed transaction fields
     */
    process: (tx) => {
      const currency = tx.currency || 'CAD';
      const subType = tx.subType || '';
      const subTypeDisplay = subType ? toSentenceCase(subType) : 'Interest';

      return {
        category: 'Interest',
        merchant: `${subTypeDisplay} (${currency})`,
        originalStatement: formatOriginalStatement(tx.type, subType, currency),
        notes: '',
        technicalDetails: '',
      };
    },
  },
];

/**
 * Mapping of entitlement types to user-friendly labels
 */
const ENTITLEMENT_TYPE_LABELS = {
  SUBMIT: 'Remove',
  RECEIVE: 'Receive',
};

/**
 * Format corporate action note based on child activities
 * @param {string|null} subType - Corporate action subType (e.g., "CONSOLIDATION", "STOCK_SPLIT")
 * @param {Array} childActivities - Array of child activity objects from FetchCorporateActionChildActivities
 * @returns {string} Formatted notes string
 */
export function formatCorporateActionNotes(subType, childActivities) {
  if (!childActivities || childActivities.length === 0) {
    return '';
  }

  // Find SUBMIT (source) and RECEIVE (destination) activities
  const submitActivity = childActivities.find((a) => a.entitlementType === 'SUBMIT');
  const receiveActivity = childActivities.find((a) => a.entitlementType === 'RECEIVE');

  const noteLines = [];

  // Build the main description if we have both activities
  if (submitActivity && receiveActivity) {
    const submitQuantity = parseFloat(submitActivity.quantity) || 0;
    const receiveQuantity = parseFloat(receiveActivity.quantity) || 0;
    const actionType = subType ? subType.toLowerCase().replace(/_/g, ' ') : 'corporate action';

    if (receiveQuantity > submitQuantity && submitQuantity > 0) {
      // Stock split scenario: receiving more shares than submitted
      const ratio = (receiveQuantity / submitQuantity).toFixed(6).replace(/\.?0+$/, '');
      noteLines.push(
        `${submitActivity.assetName} (${submitActivity.assetSymbol}) performed a ${actionType}. Every share of ${submitActivity.assetSymbol} you held was replaced by ${ratio} shares of ${receiveActivity.assetName} (${receiveActivity.assetSymbol}).`,
      );
    } else if (submitQuantity > receiveQuantity && receiveQuantity > 0) {
      // Consolidation scenario: submitting more shares than receiving
      const ratio = (submitQuantity / receiveQuantity).toFixed(6).replace(/\.?0+$/, '');
      noteLines.push(
        `${submitActivity.assetName} (${submitActivity.assetSymbol}) performed a ${actionType}. Every ${ratio} shares of ${submitActivity.assetSymbol} you held were replaced by 1 share of ${receiveActivity.assetName} (${receiveActivity.assetSymbol}).`,
      );
    }
  }

  // Add detail lines for each child activity with user-friendly labels
  for (const activity of childActivities) {
    const quantity = parseFloat(activity.quantity) || 0;
    const entitlementLabel = ENTITLEMENT_TYPE_LABELS[activity.entitlementType] || activity.entitlementType;
    noteLines.push(` - ${entitlementLabel} ${quantity} ${activity.assetSymbol} (${activity.assetName})`);
  }

  return noteLines.join('\n');
}

/**
 * Investment account corporate action transaction rules
 * These rules handle corporate action transactions like stock splits, consolidations, mergers, etc.
 *
 * Transaction types supported:
 * - CORPORATE_ACTION: Stock splits, consolidations, mergers, and other corporate actions
 */
export const INVESTMENT_CORPORATE_ACTION_TRANSACTION_RULES = [
  {
    id: 'corporate-action',
    description: 'Corporate action transactions (stock splits, consolidations, mergers)',
    match: (tx) => tx.type === 'CORPORATE_ACTION',
    /**
     * Process CORPORATE_ACTION transactions
     * These are events like stock splits, consolidations, mergers, etc.
     *
     * Requires enrichment data from FetchCorporateActionChildActivities API
     * to get details about shares submitted and received.
     *
     * Merchant format:
     * - If subType is null: "Corporate Action: {assetSymbol}"
     * - Otherwise: "Corporate Action: {assetSymbol} {sentenceCase(subType)}"
     *
     * Original statement format: "{type}:{subType}:{assetSymbol}"
     *
     * @param {Object} tx - Raw transaction
     * @param {Map<string, Object>} enrichmentMap - Map containing corporate action child activities
     * @returns {Object} Processed transaction fields
     */
    process: (tx, enrichmentMap) => {
      const assetSymbol = tx.assetSymbol || 'Unknown';
      const subType = tx.subType || '';

      // Build merchant: "Corporate Action: {symbol}" or "Corporate Action: {symbol} {subType}"
      let merchant = `Corporate Action: ${assetSymbol}`;
      if (subType) {
        merchant = `${merchant} ${toSentenceCase(subType)}`;
      }

      // Get child activities from enrichment map (keyed by canonicalId for corporate actions)
      const childActivities = enrichmentMap?.get(tx.canonicalId) || [];

      // Build notes from child activities
      const notes = formatCorporateActionNotes(subType, childActivities);

      return {
        category: 'Investment',
        merchant,
        originalStatement: formatOriginalStatement(tx.type, subType, assetSymbol),
        notes,
        technicalDetails: '',
      };
    },
  },
];

/**
 * Static security ID to name mapping for cash securities
 * Used when resolving deliverable security names in short option expiry
 */
const STATIC_SECURITY_NAMES = {
  'sec-s-cad': 'CAD',
  'sec-s-usd': 'USD',
};

/**
 * Format notes for short option position expiry transactions
 * Includes decision, reason, and released collateral details
 *
 * @param {Object} expiryDetail - Short option position expiry detail from FetchShortOptionPositionExpiryDetail API
 * @param {Map<string, Object>} securityCache - Cache of fetched security details (securityId -> security object)
 * @returns {string} Formatted notes string
 */
export function formatShortOptionExpiryNotes(expiryDetail, securityCache = new Map()) {
  if (!expiryDetail) {
    return '';
  }

  const decision = expiryDetail.decision || 'Unknown';
  const reason = expiryDetail.reason || 'Unknown';

  let notes = `Decision: ${decision}, reason: ${reason}. Released collateral:`;

  // Add each deliverable on its own line
  const deliverables = expiryDetail.deliverables || [];
  for (const deliverable of deliverables) {
    const quantity = deliverable.quantity || 0;
    const securityId = deliverable.securityId || '';

    // Look up security name from static map or cache
    let securityName = STATIC_SECURITY_NAMES[securityId];
    if (!securityName && securityCache.has(securityId)) {
      const security = securityCache.get(securityId);
      securityName = security?.stock?.symbol || securityId;
    } else if (!securityName) {
      securityName = securityId;
    }

    notes += `\n${quantity} ${securityName}`;
  }

  return notes;
}

/**
 * Investment account RESP grant transaction rules
 * These rules handle government grant transactions for RESP accounts
 *
 * Transaction types supported:
 * - RESP_GRANT: Government grants deposited into RESP accounts (CESG, CLB, etc.)
 */
export const INVESTMENT_RESP_GRANT_TRANSACTION_RULES = [
  {
    id: 'resp-grant',
    description: 'RESP grant transactions (government grants for RESP accounts)',
    match: (tx) => tx.type === 'RESP_GRANT',
    /**
     * Process RESP_GRANT transactions
     * These are government grants deposited into RESP accounts
     * (e.g., Canada Education Savings Grant, Canada Learning Bond)
     *
     * Merchant logic:
     * - If subType is null/empty: "RESP Grant"
     * - Otherwise: "RESP Grant: sentenceCase({subType})"
     *
     * Original statement format: "{type}:{subType}:{assetSymbol}:{currency}"
     *
     * @param {Object} tx - Raw transaction
     * @returns {Object} Processed transaction fields
     */
    process: (tx) => {
      const subType = tx.subType || '';
      const assetSymbol = tx.assetSymbol || '';
      const currency = tx.currency || 'CAD';

      // Merchant: "RESP Grant" if no subType, otherwise "RESP Grant: sentenceCase({subType})"
      let merchant;
      if (!subType) {
        merchant = 'RESP Grant';
      } else {
        merchant = `RESP Grant: ${toSentenceCase(subType)}`;
      }

      // Original statement: "{type}:{subType}:{assetSymbol}:{currency}"
      const originalStatement = `${tx.type || ''}:${subType}:${assetSymbol}:${currency}`;

      return {
        category: 'Grant',
        merchant,
        originalStatement,
        notes: '',
        technicalDetails: '',
      };
    },
  },
];

/**
 * Investment account non-resident tax transaction rules
 * These rules handle non-resident withholding tax transactions in investment accounts
 *
 * Transaction types supported:
 * - NON_RESIDENT_TAX: Withholding tax on foreign income (dividends, etc.)
 */
export const INVESTMENT_NON_RESIDENT_TAX_TRANSACTION_RULES = [
  {
    id: 'non-resident-tax',
    description: 'Non-resident withholding tax on foreign income',
    match: (tx) => tx.type === 'NON_RESIDENT_TAX',
    /**
     * Process NON_RESIDENT_TAX transactions
     * These are withholding taxes on foreign income (e.g., US dividends)
     *
     * Merchant logic:
     * - If assetSymbol==null: "Non-Resident Tax"
     * - Otherwise: "Non-Resident Tax for {assetSymbol}"
     *
     * Original statement format: "{type}:{subType}:{assetSymbol}:{currency}"
     *
     * @param {Object} tx - Raw transaction
     * @returns {Object} Processed transaction fields
     */
    process: (tx) => {
      const assetSymbol = tx.assetSymbol || '';
      const subType = tx.subType || '';
      const currency = tx.currency || 'CAD';

      // Merchant: "Non-Resident Tax" if no assetSymbol, otherwise "Non-Resident Tax for {assetSymbol}"
      let merchant;
      if (!assetSymbol) {
        merchant = 'Non-Resident Tax';
      } else {
        merchant = `Non-Resident Tax for ${assetSymbol}`;
      }

      // Original statement: "{type}:{subType}:{assetSymbol}:{currency}"
      const originalStatement = `${tx.type || ''}:${subType}:${assetSymbol}:${currency}`;

      return {
        category: 'Dividends & Capital Gains',
        merchant,
        originalStatement,
        notes: '',
        technicalDetails: '',
      };
    },
  },
];

/**
 * Investment account reimbursement transaction rules
 * These rules handle reimbursement transactions in investment accounts
 *
 * Transaction types supported:
 * - REIMBURSEMENT: Various reimbursements (fee rebates, etc.)
 */
export const INVESTMENT_REIMBURSEMENT_TRANSACTION_RULES = [
  {
    id: 'reimbursement',
    description: 'Reimbursement transactions for investment accounts',
    match: (tx) => tx.type === 'REIMBURSEMENT',
    /**
     * Process REIMBURSEMENT transactions
     * These are reimbursements in investment accounts (fee rebates, etc.)
     *
     * Merchant logic:
     * - Skip "for {assetSymbol}" if assetSymbol is CAD or USD (these are currency, not securities)
     * - If subType==null && (no assetSymbol OR assetSymbol is CAD/USD): "Reimbursement ({currency})"
     * - If subType==null && assetSymbol is not CAD/USD: "Reimbursement for {assetSymbol} ({currency})"
     * - If subType present && (no assetSymbol OR assetSymbol is CAD/USD): "sentenceCase({subType}) ({currency})"
     * - If subType present && assetSymbol is not CAD/USD: "sentenceCase({subType}) for {assetSymbol} ({currency})"
     *
     * Original statement format: "{type}:{subType}:{assetSymbol}:{currency}"
     *
     * @param {Object} tx - Raw transaction
     * @returns {Object} Processed transaction fields
     */
    process: (tx) => {
      const subType = tx.subType || '';
      const assetSymbol = tx.assetSymbol || '';
      const currency = tx.currency || 'CAD';

      // Check if assetSymbol is a currency (CAD or USD) - skip "for {asset}" in this case
      const isCurrencyAsset = assetSymbol === 'CAD' || assetSymbol === 'USD';
      const hasAsset = assetSymbol && !isCurrencyAsset;

      // Build merchant based on subType and assetSymbol presence
      let merchant;
      if (!subType && !hasAsset) {
        merchant = `Reimbursement (${currency})`;
      } else if (!subType && hasAsset) {
        merchant = `Reimbursement for ${assetSymbol} (${currency})`;
      } else if (subType && !hasAsset) {
        merchant = `${toSentenceCase(subType)} (${currency})`;
      } else {
        merchant = `${toSentenceCase(subType)} for ${assetSymbol} (${currency})`;
      }

      // Original statement: "{type}:{subType}:{assetSymbol}:{currency}"
      const originalStatement = `${tx.type || ''}:${subType}:${assetSymbol}:${currency}`;

      return {
        category: 'Reimbursement',
        merchant,
        originalStatement,
        notes: '',
        technicalDetails: '',
      };
    },
  },
];

/**
 * Format crypto order notes from activity and crypto order data
 * Handles market orders and limit orders for CRYPTO_BUY and CRYPTO_SELL transactions
 *
 * Market order format:
 * "Market order Buy 0.000109 BTC
 * Filled 0.00010891 @ CAD$91358.8685646, fees: CAD$0.0897908481 (fee: CAD$0.04, swap: CAD$0.0497908481)
 * Total CAD$10"
 *
 * Limit order format:
 * "Limit order Buy 0.001 BTC @ 90000 Limit day
 * Filled 0.001 @ CAD$89500, fees: CAD$0.09 (fee: CAD$0.04, swap: CAD$0.05)
 * Total CAD$89.59"
 *
 * @param {Object} activity - Raw transaction from Wealthsimple API
 * @param {Object|null} cryptoOrder - Crypto order details from FetchCryptoOrder API
 * @returns {string} Formatted notes string
 */
export function formatCryptoOrderNotes(activity, cryptoOrder) {
  if (!activity) return '';

  const symbol = activity.assetSymbol || 'N/A';
  const amount = formatAmount(activity.amount ?? 0);
  const isBuy = activity.type === 'CRYPTO_BUY';
  const action = isBuy ? 'Buy' : 'Sell';

  // If no crypto order data, return minimal notes
  if (!cryptoOrder) {
    return `${action} ${symbol}\nTotal ${activity.currency || 'CAD'}$${amount}`;
  }

  const currency = cryptoOrder.currency || activity.currency || 'CAD';
  const requestedQuantity = formatAmount(cryptoOrder.quantity ?? 0);
  const executedQuantity = formatAmount(cryptoOrder.executedQuantity ?? 0);
  const price = formatAmount(cryptoOrder.price ?? 0);
  const fee = formatAmount(cryptoOrder.fee ?? 0);
  const swapFee = formatAmount(cryptoOrder.swapFee ?? 0);
  const totalCost = formatAmount(cryptoOrder.totalCost ?? 0);

  // Calculate total fees (fee + swapFee)
  const totalFees = formatAmount(parseFloat(cryptoOrder.fee ?? 0) + parseFloat(cryptoOrder.swapFee ?? 0));

  // Determine if this is a limit order
  const isLimitOrder = cryptoOrder.limitPrice !== null && cryptoOrder.limitPrice !== undefined;

  if (isLimitOrder) {
    const limitPrice = formatAmount(cryptoOrder.limitPrice);
    const timeInForce = cryptoOrder.timeInForce || '';
    // Line 1: "Limit order Buy 0.001 BTC @ 90000 Limit day"
    // Line 2: "Filled 0.001 @ CAD$89500, fees: CAD$0.09 (fee: CAD$0.04, swap: CAD$0.05)"
    // Line 3: "Total CAD$89.59"
    return `Limit order ${action} ${requestedQuantity} ${symbol} @ ${limitPrice} Limit ${timeInForce}\nFilled ${executedQuantity} @ ${currency}$${price}, fees: ${currency}$${totalFees} (fee: ${currency}$${fee}, swap: ${currency}$${swapFee})\nTotal ${currency}$${totalCost}`;
  }

  // Market order format
  // Line 1: "Market order Buy 0.000109 BTC"
  // Line 2: "Filled 0.00010891 @ CAD$91358.8685646, fees: CAD$0.0897908481 (fee: CAD$0.04, swap: CAD$0.0497908481)"
  // Line 3: "Total CAD$10"
  return `Market order ${action} ${requestedQuantity} ${symbol}\nFilled ${executedQuantity} @ ${currency}$${price}, fees: ${currency}$${totalFees} (fee: ${currency}$${fee}, swap: ${currency}$${swapFee})\nTotal ${currency}$${totalCost}`;
}

/**
 * Format crypto swap order notes from activity and crypto order data
 * Handles CRYPTO_BUY transactions with subType SWAP_MARKET_ORDER
 * These swap one cryptocurrency for another (e.g., BTC -> ETH)
 *
 * With enrichment data:
 * "Swapped 0.00010745 BTC for 0.003605 ETH
 * Fees: CAD$0.04 (fee: CAD$0.04, swap: CAD$0.00)"
 *
 * Without enrichment data:
 * "Swapped BTC for ETH"
 *
 * Field mapping:
 * - Old asset quantity (assetSymbol, being swapped away): cryptoOrder.executedValue
 * - New asset quantity (counterAssetSymbol, being received): activity.assetQuantity (fallback: cryptoOrder.quantity)
 *
 * @param {Object} activity - Raw transaction from Wealthsimple API
 * @param {Object|null} cryptoOrder - Crypto order details from FetchCryptoOrder API
 * @returns {string} Formatted notes string
 */
export function formatCryptoSwapNotes(activity, cryptoOrder) {
  if (!activity) return '';

  const sourceSymbol = activity.assetSymbol || 'Unknown';
  const destSymbol = activity.counterAssetSymbol || 'Unknown';

  // If no crypto order data, return minimal notes
  if (!cryptoOrder) {
    return `Swapped ${sourceSymbol} for ${destSymbol}`;
  }

  const sourceQuantity = formatAmount(cryptoOrder.executedValue ?? 0);
  const destQuantity = formatAmount(activity.assetQuantity ?? cryptoOrder.quantity ?? 0);
  const currency = cryptoOrder.currency || activity.currency || 'CAD';
  const fee = formatAmount(cryptoOrder.fee ?? 0);
  const swapFee = formatAmount(cryptoOrder.swapFee ?? 0);
  const totalFees = formatAmount(parseFloat(cryptoOrder.fee ?? 0) + parseFloat(cryptoOrder.swapFee ?? 0));

  const noteLines = [];

  // Line 1: "Swapped 0.003605 BTC for 0.003605 ETH"
  noteLines.push(`Swapped ${sourceQuantity} ${sourceSymbol} for ${destQuantity} ${destSymbol}`);

  // Line 2: Fee breakdown
  noteLines.push(`Fees: ${currency}$${totalFees} (fee: ${currency}$${fee}, swap: ${currency}$${swapFee})`);

  return noteLines.join('\n');
}

/**
 * Investment account buy/sell transaction rules
 * These rules handle stock purchase and sale transactions in investment accounts
 *
 * Transaction types supported:
 * - MANAGED_BUY / MANAGED_SELL: Robo-advisor managed transactions
 * - DIY_BUY / DIY_SELL: Self-directed trading transactions
 *
 * Status field handling:
 * - These transactions use `unifiedStatus` field (not `status` which is null)
 * - COMPLETED: Sync as settled
 * - IN_PROGRESS, PENDING: Sync with Pending tag
 * - EXPIRED, REJECTED, CANCELLED: Exclude from sync
 */
export const INVESTMENT_BUY_SELL_TRANSACTION_RULES = [
  {
    id: 'managed-buy',
    description: 'Managed (robo-advisor) buy transactions',
    match: (tx) => tx.type === 'MANAGED_BUY',
    /**
     * Process MANAGED_BUY transactions
     * These are automatic purchases made by the robo-advisor
     *
     * @param {Object} tx - Raw transaction
     * @param {Map<string, Object>} enrichmentMap - Map containing extended order data
     * @returns {Object} Processed transaction fields
     */
    process: (tx, enrichmentMap) => {
      const symbol = tx.assetSymbol || 'Unknown';
      const extendedOrder = enrichmentMap?.get(tx.externalCanonicalId) || null;

      return {
        category: 'Buy',
        merchant: symbol,
        originalStatement: formatOriginalStatement(tx.type, tx.subType, symbol),
        notes: formatInvestmentOrderNotes(tx, extendedOrder),
        technicalDetails: '',
      };
    },
  },
  {
    id: 'diy-buy',
    description: 'DIY (self-directed) buy transactions',
    match: (tx) => tx.type === 'DIY_BUY',
    /**
     * Process DIY_BUY transactions
     * These are manual stock purchases made by the user
     *
     * @param {Object} tx - Raw transaction
     * @param {Map<string, Object>} enrichmentMap - Map containing extended order data
     * @returns {Object} Processed transaction fields
     */
    process: (tx, enrichmentMap) => {
      const symbol = tx.assetSymbol || 'Unknown';
      const extendedOrder = enrichmentMap?.get(tx.externalCanonicalId) || null;

      return {
        category: 'Buy',
        merchant: symbol,
        originalStatement: formatOriginalStatement(tx.type, tx.subType, symbol),
        notes: formatInvestmentOrderNotes(tx, extendedOrder),
        technicalDetails: '',
      };
    },
  },
  {
    id: 'managed-sell',
    description: 'Managed (robo-advisor) sell transactions',
    match: (tx) => tx.type === 'MANAGED_SELL',
    /**
     * Process MANAGED_SELL transactions
     * These are automatic sales made by the robo-advisor
     *
     * @param {Object} tx - Raw transaction
     * @param {Map<string, Object>} enrichmentMap - Map containing extended order data
     * @returns {Object} Processed transaction fields
     */
    process: (tx, enrichmentMap) => {
      const symbol = tx.assetSymbol || 'Unknown';
      const extendedOrder = enrichmentMap?.get(tx.externalCanonicalId) || null;

      return {
        category: 'Sell',
        merchant: symbol,
        originalStatement: formatOriginalStatement(tx.type, tx.subType, symbol),
        notes: formatInvestmentOrderNotes(tx, extendedOrder),
        technicalDetails: '',
      };
    },
  },
  {
    id: 'diy-sell',
    description: 'DIY (self-directed) sell transactions',
    match: (tx) => tx.type === 'DIY_SELL',
    /**
     * Process DIY_SELL transactions
     * These are manual stock sales made by the user
     *
     * @param {Object} tx - Raw transaction
     * @param {Map<string, Object>} enrichmentMap - Map containing extended order data
     * @returns {Object} Processed transaction fields
     */
    process: (tx, enrichmentMap) => {
      const symbol = tx.assetSymbol || 'Unknown';
      const extendedOrder = enrichmentMap?.get(tx.externalCanonicalId) || null;

      return {
        category: 'Sell',
        merchant: symbol,
        originalStatement: formatOriginalStatement(tx.type, tx.subType, symbol),
        notes: formatInvestmentOrderNotes(tx, extendedOrder),
        technicalDetails: '',
      };
    },
  },
  {
    id: 'crypto-swap',
    description: 'Crypto swap transactions (swapping one cryptocurrency for another)',
    match: (tx) => tx.type === 'CRYPTO_BUY' && tx.subType === 'SWAP_MARKET_ORDER',
    /**
     * Process CRYPTO_BUY/SWAP_MARKET_ORDER transactions
     * These are cryptocurrency swaps in SELF_DIRECTED_CRYPTO accounts
     * where one crypto is exchanged for another (e.g., BTC -> ETH)
     *
     * Activity fields:
     * - assetSymbol: Source cryptocurrency being swapped away
     * - counterAssetSymbol: Destination cryptocurrency being received
     * - assetQuantity: Quantity of source crypto removed
     *
     * Enrichment data from FetchCryptoOrder provides:
     * - quantity: Quantity of destination crypto received
     * - fee/swapFee: Fee breakdown
     *
     * @param {Object} tx - Raw transaction
     * @param {Map<string, Object>} enrichmentMap - Map containing crypto order data
     * @returns {Object} Processed transaction fields
     */
    process: (tx, enrichmentMap) => {
      const sourceSymbol = tx.assetSymbol || 'Unknown';
      const destSymbol = tx.counterAssetSymbol || 'Unknown';
      const enrichmentData = enrichmentMap?.get(tx.externalCanonicalId) || null;

      // Use crypto swap formatter if we have crypto order data, fall back to generic
      const notes = enrichmentData?.isCryptoOrderData
        ? formatCryptoSwapNotes(tx, enrichmentData)
        : formatCryptoSwapNotes(tx, null);

      return {
        category: 'Swap',
        merchant: `${sourceSymbol} -> ${destSymbol}`,
        originalStatement: formatOriginalStatement(tx.type, tx.subType, `${sourceSymbol}:${destSymbol}`),
        notes,
        technicalDetails: '',
      };
    },
  },
  {
    id: 'crypto-buy',
    description: 'Crypto buy transactions (self-directed crypto accounts)',
    match: (tx) => tx.type === 'CRYPTO_BUY',
    /**
     * Process CRYPTO_BUY transactions
     * These are cryptocurrency purchases in SELF_DIRECTED_CRYPTO accounts
     * Enrichment data comes from FetchCryptoOrder API (marked with isCryptoOrderData)
     *
     * @param {Object} tx - Raw transaction
     * @param {Map<string, Object>} enrichmentMap - Map containing crypto order data
     * @returns {Object} Processed transaction fields
     */
    process: (tx, enrichmentMap) => {
      const symbol = tx.assetSymbol || 'Unknown';
      const enrichmentData = enrichmentMap?.get(tx.externalCanonicalId) || null;

      // Use crypto-specific formatter if we have crypto order data, fall back to generic
      const notes = enrichmentData?.isCryptoOrderData
        ? formatCryptoOrderNotes(tx, enrichmentData)
        : formatCryptoOrderNotes(tx, null);

      return {
        category: 'Buy',
        merchant: symbol,
        originalStatement: formatOriginalStatement(tx.type, tx.subType, symbol),
        notes,
        technicalDetails: '',
      };
    },
  },
  {
    id: 'crypto-sell',
    description: 'Crypto sell transactions (self-directed crypto accounts)',
    match: (tx) => tx.type === 'CRYPTO_SELL',
    /**
     * Process CRYPTO_SELL transactions
     * These are cryptocurrency sales in SELF_DIRECTED_CRYPTO accounts
     * Enrichment data comes from FetchCryptoOrder API (marked with isCryptoOrderData)
     *
     * @param {Object} tx - Raw transaction
     * @param {Map<string, Object>} enrichmentMap - Map containing crypto order data
     * @returns {Object} Processed transaction fields
     */
    process: (tx, enrichmentMap) => {
      const symbol = tx.assetSymbol || 'Unknown';
      const enrichmentData = enrichmentMap?.get(tx.externalCanonicalId) || null;

      // Use crypto-specific formatter if we have crypto order data, fall back to generic
      const notes = enrichmentData?.isCryptoOrderData
        ? formatCryptoOrderNotes(tx, enrichmentData)
        : formatCryptoOrderNotes(tx, null);

      return {
        category: 'Sell',
        merchant: symbol,
        originalStatement: formatOriginalStatement(tx.type, tx.subType, symbol),
        notes,
        technicalDetails: '',
      };
    },
  },
  {
    id: 'options-buy',
    description: 'Options buy transactions',
    match: (tx) => tx.type === 'OPTIONS_BUY',
    /**
     * Process OPTIONS_BUY transactions
     * These are options contract purchases
     *
     * Uses unifiedStatus for pending/completed status (same as DIY_BUY)
     *
     * Merchant format: "{assetSymbol} {prettyDate(expiryDate)} {currency}${strikePrice} {sentenceCase(contractType)}"
     * Example: "AAPL Jan 16, 2026 CAD$200.00 Call"
     *
     * Original statement format: "{type}:{subType}:{assetSymbol}:{expiryDate}:{strikePrice}:{contractType}"
     * Example: "OPTIONS_BUY:LIMIT_ORDER:AAPL:2026-01-16:200.00:CALL"
     *
     * @param {Object} tx - Raw transaction
     * @param {Map<string, Object>} enrichmentMap - Map containing extended order data
     * @returns {Object} Processed transaction fields
     */
    process: (tx, enrichmentMap) => {
      const assetSymbol = tx.assetSymbol || 'Unknown';
      const expiryDate = tx.expiryDate || '';
      const strikePrice = formatAmount(tx.strikePrice ?? 0);
      const contractType = tx.contractType || '';
      const currency = tx.currency || 'CAD';
      const extendedOrder = enrichmentMap?.get(tx.externalCanonicalId) || null;

      // Format merchant: "{assetSymbol} {prettyDate} {currency}${strikePrice} {sentenceCase(contractType)}"
      const prettyExpiryDate = formatPrettyDate(expiryDate);
      const contractTypeDisplay = toSentenceCase(contractType);
      const merchant = `${assetSymbol} ${prettyExpiryDate} ${currency}$${strikePrice} ${contractTypeDisplay}`;

      // Format original statement: "{type}:{subType}:{assetSymbol}:{expiryDate}:{strikePrice}:{contractType}"
      const statementParts = `${assetSymbol}:${expiryDate}:${strikePrice}:${contractType}`;

      return {
        category: 'Buy',
        merchant,
        originalStatement: formatOriginalStatement(tx.type, tx.subType, statementParts),
        notes: formatOptionsOrderNotes(tx, extendedOrder, false),
        technicalDetails: '',
      };
    },
  },
  {
    id: 'options-sell',
    description: 'Options sell transactions',
    match: (tx) => tx.type === 'OPTIONS_SELL',
    /**
     * Process OPTIONS_SELL transactions
     * These are options contract sales
     *
     * Uses unifiedStatus for pending/completed status (same as DIY_SELL)
     *
     * Merchant format: "{assetSymbol} {prettyDate(expiryDate)} {currency}${strikePrice} {sentenceCase(contractType)}"
     * Example: "AAPL Jan 16, 2026 CAD$200.00 Call"
     *
     * Original statement format: "{type}:{subType}:{assetSymbol}:{expiryDate}:{strikePrice}:{contractType}"
     * Example: "OPTIONS_SELL:LIMIT_ORDER:AAPL:2026-01-16:200.00:CALL"
     *
     * @param {Object} tx - Raw transaction
     * @param {Map<string, Object>} enrichmentMap - Map containing extended order data
     * @returns {Object} Processed transaction fields
     */
    process: (tx, enrichmentMap) => {
      const assetSymbol = tx.assetSymbol || 'Unknown';
      const expiryDate = tx.expiryDate || '';
      const strikePrice = formatAmount(tx.strikePrice ?? 0);
      const contractType = tx.contractType || '';
      const currency = tx.currency || 'CAD';
      const extendedOrder = enrichmentMap?.get(tx.externalCanonicalId) || null;

      // Format merchant: "{assetSymbol} {prettyDate} {currency}${strikePrice} {sentenceCase(contractType)}"
      const prettyExpiryDate = formatPrettyDate(expiryDate);
      const contractTypeDisplay = toSentenceCase(contractType);
      const merchant = `${assetSymbol} ${prettyExpiryDate} ${currency}$${strikePrice} ${contractTypeDisplay}`;

      // Format original statement: "{type}:{subType}:{assetSymbol}:{expiryDate}:{strikePrice}:{contractType}"
      const statementParts = `${assetSymbol}:${expiryDate}:${strikePrice}:${contractType}`;

      return {
        category: 'Sell',
        merchant,
        originalStatement: formatOriginalStatement(tx.type, tx.subType, statementParts),
        notes: formatOptionsOrderNotes(tx, extendedOrder, true),
        technicalDetails: '',
      };
    },
  },
  {
    id: 'options-short-expiry',
    description: 'Short option position expiry transactions',
    match: (tx) => tx.type === 'OPTIONS_SHORT_EXPIRY',
    /**
     * Process OPTIONS_SHORT_EXPIRY transactions
     * These are short option position expirations (when sold options expire)
     *
     * Amount handling:
     * - Amount is typically null when option expires worthless (use 0)
     * - Amount has value when option is assigned
     *
     * Merchant format: "{assetSymbol} {prettyDate(expiryDate)} {currency}${strikePrice} {sentenceCase(contractType)}"
     * Example: "PSNY Jan 16, 2026 USD$1 Call"
     *
     * Original statement format: "{type}:{subType}:{assetSymbol}:{expiryDate}:{strikePrice}:{contractType}"
     * Example: "OPTIONS_SHORT_EXPIRY::PSNY:2026-01-16:1:CALL"
     *
     * Notes: Fetched via FetchShortOptionPositionExpiryDetail API, includes decision, reason,
     * and released collateral with security names looked up via FetchSecurity API
     *
     * @param {Object} tx - Raw transaction
     * @param {Map<string, Object>} enrichmentMap - Map containing short option expiry details and security cache
     * @returns {Object} Processed transaction fields
     */
    process: (tx, enrichmentMap) => {
      const assetSymbol = tx.assetSymbol || 'Unknown';
      const expiryDate = tx.expiryDate || '';
      const strikePrice = formatAmount(tx.strikePrice ?? 0);
      const contractType = tx.contractType || '';
      const currency = tx.currency || 'CAD';

      // Format merchant: "{assetSymbol} {prettyDate} {currency}${strikePrice} {sentenceCase(contractType)}"
      const prettyExpiryDate = formatPrettyDate(expiryDate);
      const contractTypeDisplay = toSentenceCase(contractType);
      const merchant = `${assetSymbol} ${prettyExpiryDate} ${currency}$${strikePrice} ${contractTypeDisplay}`;

      // Format original statement: "{type}:{subType}:{assetSymbol}:{expiryDate}:{strikePrice}:{contractType}"
      const statementParts = `${assetSymbol}:${expiryDate}:${strikePrice}:${contractType}`;

      // Get expiry detail and security cache from enrichmentMap (keyed by externalCanonicalId)
      const expiryDetail = enrichmentMap?.get(tx.externalCanonicalId)?.expiryDetail || null;
      const securityCache = enrichmentMap?.get(tx.externalCanonicalId)?.securityCache || new Map();

      // Build notes from expiry detail
      const notes = formatShortOptionExpiryNotes(expiryDetail, securityCache);

      return {
        category: 'Options Expired',
        merchant,
        originalStatement: formatOriginalStatement(tx.type, tx.subType, statementParts),
        notes,
        technicalDetails: '',
      };
    },
  },
];

/**
 * Find and apply the matching rule for a transaction
 * @param {Object} transaction - Raw transaction from Wealthsimple API
 * @param {Map<string, Object>} fundingIntentMap - Optional map of funding intent ID to details
 * @returns {Object|null} Processed rule result or null if no rule matches
 */
