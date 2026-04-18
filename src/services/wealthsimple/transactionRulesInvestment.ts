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
  type ExtendedOrder,
  type WealthsimpleTransaction,
} from './transactionRulesHelpers';

interface InvestmentRuleResult {
  category: string | null;
  merchant: string;
  originalStatement: string;
  notes: string;
  technicalDetails: string;
}

interface InvestmentTransactionRule {
  id: string;
  description: string;
  match: (tx: WealthsimpleTransaction) => boolean;
  process: (tx: WealthsimpleTransaction, enrichmentMap?: Map<string, unknown> | null) => InvestmentRuleResult;
}

export const INVESTMENT_FEE_TRANSACTION_RULES: InvestmentTransactionRule[] = [
  {
    id: 'fee',
    description: 'Fee transactions for investment accounts (service fees, management fees, etc.)',
    match: (tx) => tx.type === 'FEE',
    process: (tx) => {
      const subType = tx.subType || '';
      const currency = tx.currency || 'CAD';
      const accountName = getAccountNameById(tx.accountId);
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

export const INVESTMENT_REFUND_TRANSACTION_RULES: InvestmentTransactionRule[] = [
  {
    id: 'refund',
    description: 'Refund transactions for investment accounts (fee refunds, transfer fee refunds, etc.)',
    match: (tx) => tx.type === 'REFUND',
    process: (tx) => {
      const subType = tx.subType || '';
      const assetSymbol = tx.assetSymbol || '';
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

export const INVESTMENT_INSTITUTIONAL_TRANSFER_RULES: InvestmentTransactionRule[] = [
  {
    id: 'institutional-transfer-intent',
    description: 'Institutional transfer transactions (transfers to/from external institutions)',
    match: (tx) => tx.type === 'INSTITUTIONAL_TRANSFER_INTENT',
    process: (tx) => {
      const institutionName = tx.institutionName || 'Unknown Institution';
      const subType = tx.subType || '';
      let merchant: string;
      if (subType === 'TRANSFER_IN') {
        merchant = `Transfer In from ${institutionName}`;
      } else if (subType === 'TRANSFER_OUT') {
        merchant = `Transfer Out to ${institutionName}`;
      } else {
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

export const INVESTMENT_DEPOSIT_TRANSACTION_RULES: InvestmentTransactionRule[] = [
  {
    id: 'deposit',
    description: 'Deposit transactions for investment accounts',
    match: (tx) => tx.type === 'DEPOSIT',
    process: (tx) => {
      const frequency = tx.frequency || '';
      const currency = tx.currency || 'CAD';
      const amount = formatAmount(tx.amount ?? 0);
      const subType = tx.subType || '';
      const frequencyPrefix = frequency ? `${toSentenceCase(frequency)} ` : '';
      const merchant = `${frequencyPrefix}Deposit (${currency})`;
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
 * @param value - The value to format
 * @param maxDecimals - Maximum number of decimal places (default 4)
 * @returns Formatted number string
 */
export function formatNumberWithPrecision(value: number | string | null | undefined, maxDecimals = 4): string {
  if (value === null || value === undefined) return '';
  const num = parseFloat(String(value));
  if (isNaN(num)) return '';
  return num.toFixed(maxDecimals).replace(/\.?0+$/, '');
}

/**
 * Format dividend transaction notes with enhanced details
 * Includes holdings on record date, gross dividend rate, withholding tax, and key dates
 *
 * @param tx - Raw transaction from Wealthsimple API
 * @returns Formatted notes string
 */
export function formatDividendNotes(tx: WealthsimpleTransaction): string {
  if (!tx) return '';
  const symbol = tx.assetSymbol || 'Unknown';
  const currency = tx.currency || 'CAD';
  const amount = formatAmount(tx.amount ?? 0);
  const noteLines: string[] = [];

  if (tx.amount === null || tx.amount === undefined) {
    noteLines.push(`Upcoming dividend on ${symbol}`);
  } else if (tx.subType === 'MANUFACTURED_DIVIDEND') {
    noteLines.push(`Dividend on lended ${symbol} shares: ${currency}$${amount}`);
  } else {
    noteLines.push(`Dividend on ${symbol}: ${currency}$${amount}`);
  }

  if (tx.assetQuantity !== null && tx.assetQuantity !== undefined) {
    const formattedQuantity = formatNumberWithPrecision(tx.assetQuantity, 4);
    if (formattedQuantity) noteLines.push(`Holdings on record date: ${formattedQuantity} shares`);
  }

  if (tx.grossDividendRate !== null && tx.grossDividendRate !== undefined) {
    const formattedRate = formatNumberWithPrecision(tx.grossDividendRate, 4);
    if (formattedRate) noteLines.push(`Gross dividend rate: ${currency}$${formattedRate} per share`);
  }

  if (tx.withholdingTaxAmount !== null && tx.withholdingTaxAmount !== undefined) {
    const taxAmount = Math.abs(parseFloat(String(tx.withholdingTaxAmount)) || 0);
    if (taxAmount > 0) noteLines.push(`Withholding tax: ${currency}$${formatAmount(taxAmount)}`);
  }

  if (tx.announcementDate) {
    const d = formatPrettyDate(tx.announcementDate);
    if (d) noteLines.push(`Announcement date: ${d}`);
  }
  if (tx.recordDate) {
    const d = formatPrettyDate(tx.recordDate);
    if (d) noteLines.push(`Record date: ${d}`);
  }
  if (tx.payableDate) {
    const d = formatPrettyDate(tx.payableDate);
    if (d) noteLines.push(`Payable date: ${d}`);
  }

  return noteLines.join('\n');
}

export const INVESTMENT_DIVIDEND_TRANSACTION_RULES: InvestmentTransactionRule[] = [
  {
    id: 'dividend',
    description: 'Dividend transactions for investment accounts (managed and DIY)',
    match: (tx) => tx.type === 'DIVIDEND',
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

export const INVESTMENT_INTEREST_TRANSACTION_RULES: InvestmentTransactionRule[] = [
  {
    id: 'fpl-interest',
    description: 'Fully Paid Lending interest (stock lending earnings)',
    match: (tx) => tx.type === 'INTEREST' && tx.subType === 'FPL_INTEREST',
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

const ENTITLEMENT_TYPE_LABELS: Record<string, string> = {
  SUBMIT: 'Remove',
  RECEIVE: 'Receive',
};

interface CorporateActionChildActivity {
  entitlementType: string;
  quantity: number | string;
  assetSymbol: string;
  assetName: string;
}

/**
 * Format corporate action note based on child activities
 * @param subType - Corporate action subType (e.g., "CONSOLIDATION", "STOCK_SPLIT")
 * @param childActivities - Array of child activity objects from FetchCorporateActionChildActivities
 * @returns Formatted notes string
 */
export function formatCorporateActionNotes(
  subType: string | null | undefined,
  childActivities: CorporateActionChildActivity[],
): string {
  if (!childActivities || childActivities.length === 0) return '';

  const submitActivity = childActivities.find((a) => a.entitlementType === 'SUBMIT');
  const receiveActivity = childActivities.find((a) => a.entitlementType === 'RECEIVE');
  const noteLines: string[] = [];

  if (submitActivity && receiveActivity) {
    const submitQuantity = parseFloat(String(submitActivity.quantity)) || 0;
    const receiveQuantity = parseFloat(String(receiveActivity.quantity)) || 0;
    const actionType = subType ? subType.toLowerCase().replace(/_/g, ' ') : 'corporate action';

    if (receiveQuantity > submitQuantity && submitQuantity > 0) {
      const ratio = (receiveQuantity / submitQuantity).toFixed(6).replace(/\.?0+$/, '');
      noteLines.push(
        `${submitActivity.assetName} (${submitActivity.assetSymbol}) performed a ${actionType}. Every share of ${submitActivity.assetSymbol} you held was replaced by ${ratio} shares of ${receiveActivity.assetName} (${receiveActivity.assetSymbol}).`,
      );
    } else if (submitQuantity > receiveQuantity && receiveQuantity > 0) {
      const ratio = (submitQuantity / receiveQuantity).toFixed(6).replace(/\.?0+$/, '');
      noteLines.push(
        `${submitActivity.assetName} (${submitActivity.assetSymbol}) performed a ${actionType}. Every ${ratio} shares of ${submitActivity.assetSymbol} you held were replaced by 1 share of ${receiveActivity.assetName} (${receiveActivity.assetSymbol}).`,
      );
    }
  }

  for (const activity of childActivities) {
    const quantity = parseFloat(String(activity.quantity)) || 0;
    const entitlementLabel = ENTITLEMENT_TYPE_LABELS[activity.entitlementType] || activity.entitlementType;
    noteLines.push(` - ${entitlementLabel} ${quantity} ${activity.assetSymbol} (${activity.assetName})`);
  }

  return noteLines.join('\n');
}

export const INVESTMENT_CORPORATE_ACTION_TRANSACTION_RULES: InvestmentTransactionRule[] = [
  {
    id: 'corporate-action',
    description: 'Corporate action transactions (stock splits, consolidations, mergers)',
    match: (tx) => tx.type === 'CORPORATE_ACTION',
    process: (tx, enrichmentMap) => {
      const assetSymbol = tx.assetSymbol || 'Unknown';
      const subType = tx.subType || '';
      let merchant = `Corporate Action: ${assetSymbol}`;
      if (subType) merchant = `${merchant} ${toSentenceCase(subType)}`;
      const childActivities = (enrichmentMap?.get(tx.canonicalId) as CorporateActionChildActivity[]) || [];
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

const STATIC_SECURITY_NAMES: Record<string, string> = {
  'sec-s-cad': 'CAD',
  'sec-s-usd': 'USD',
};

interface ShortOptionDeliverable {
  quantity: number | string;
  securityId: string;
}

interface ShortOptionExpiryDetail {
  decision?: string;
  reason?: string;
  fxRate?: string;
  securityCurrency?: string;
  deliverables?: ShortOptionDeliverable[];
}

interface CachedSecurity {
  stock?: { symbol?: string };
}

/**
 * Format notes for short option position expiry transactions
 * Includes decision, reason, and released collateral details
 *
 * @param expiryDetail - Short option position expiry detail from FetchShortOptionPositionExpiryDetail API
 * @param securityCache - Cache of fetched security details (securityId -> security object)
 * @returns Formatted notes string
 */
/**
 * Format notes for options assignment transactions
 * Includes assignment details, share action, and total with CAD conversion
 *
 * @param tx - Raw transaction from Wealthsimple API
 * @param expiryDetail - Assignment detail from FetchShortOptionPositionExpiryDetail API
 * @param securityCache - Cache of fetched security details (securityId -> security object)
 * @returns Formatted notes string
 */
export function formatOptionsAssignNotes(
  tx: WealthsimpleTransaction,
  expiryDetail: ShortOptionExpiryDetail | null | undefined,
  securityCache: Map<string, CachedSecurity> = new Map(),
): string {
  const assetSymbol = tx.assetSymbol || 'Unknown';
  const assetQuantity = tx.assetQuantity ?? 1;
  const contractType = tx.contractType || 'unknown';
  const strikePrice = formatAmount(tx.strikePrice ?? 0);
  const currency = tx.currency || 'CAD';
  const expiryDate = tx.expiryDate || '';
  const amount = tx.amount ?? 0;
  const subType = tx.subType || '';
  const prettyExpiryDate = formatPrettyDate(expiryDate);

  // Determine prefix based on subType
  const isAutoAssign = subType === 'AUTO_ASSIGN';
  const prefix = isAutoAssign ? 'Auto assigned' : 'Assigned';

  // Determine decision/reason from enrichment
  const decision = expiryDetail?.decision || 'Unknown';
  const reason = expiryDetail?.reason || 'Unknown';

  // Line 1: Assignment details
  const line1 = `${prefix} ${assetQuantity} ${assetSymbol} ${contractType} contract(s) at ${currency}$${strikePrice} strike, expiry ${prettyExpiryDate} (decision: ${decision}, reason: ${reason}).`;

  // Determine share action based on contract type: calls → Sold, puts → Bought
  const isCall = contractType.toLowerCase() === 'call';
  const shareAction = isCall ? 'Sold' : 'Bought';

  // Calculate total shares from deliverables or default to 100 * contracts
  let totalShares = 0;
  let deliverableSymbol = assetSymbol;
  if (expiryDetail?.deliverables && expiryDetail.deliverables.length > 0) {
    for (const deliverable of expiryDetail.deliverables) {
      const quantity = parseFloat(String(deliverable.quantity)) || 0;
      totalShares += Math.abs(quantity);
      // Resolve security name for the deliverable
      const securityId = deliverable.securityId || '';
      let securityName = STATIC_SECURITY_NAMES[securityId];
      if (!securityName && securityCache.has(securityId)) {
        const security = securityCache.get(securityId);
        securityName = security?.stock?.symbol || assetSymbol;
      }
      if (securityName && securityName !== 'CAD' && securityName !== 'USD') {
        deliverableSymbol = securityName;
      }
    }
  }
  if (totalShares === 0) {
    totalShares = assetQuantity * 100;
  }

  // Line 2: Share action
  const line2 = `${shareAction} ${totalShares} ${deliverableSymbol} shares at $${strikePrice} ${currency} per share.`;

  // Line 3: Total with CAD conversion
  const formattedAmount = formatAmount(amount);
  let line3: string;
  const fxRate = parseFloat(expiryDetail?.fxRate || '0');
  if (fxRate > 0 && currency !== 'CAD') {
    const cadAmount = amount * fxRate;
    const formattedCadAmount = formatAmount(cadAmount);
    line3 = `Total $${formattedAmount} ${currency} ($${formattedCadAmount} CAD)`;
  } else {
    line3 = `Total $${formattedAmount} ${currency}`;
  }

  return `${line1}\n${line2}\n${line3}`;
}

export function formatShortOptionExpiryNotes(
  expiryDetail: ShortOptionExpiryDetail | null | undefined,
  securityCache: Map<string, CachedSecurity> = new Map(),
): string {
  if (!expiryDetail) return '';

  const decision = expiryDetail.decision || 'Unknown';
  const reason = expiryDetail.reason || 'Unknown';
  let notes = `Decision: ${decision}, reason: ${reason}. Released collateral:`;

  for (const deliverable of expiryDetail.deliverables || []) {
    const quantity = deliverable.quantity || 0;
    const securityId = deliverable.securityId || '';
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

export const INVESTMENT_RESP_GRANT_TRANSACTION_RULES: InvestmentTransactionRule[] = [
  {
    id: 'resp-grant',
    description: 'RESP grant transactions (government grants for RESP accounts)',
    match: (tx) => tx.type === 'RESP_GRANT',
    process: (tx) => {
      const subType = tx.subType || '';
      const assetSymbol = tx.assetSymbol || '';
      const currency = tx.currency || 'CAD';
      const merchant = !subType ? 'RESP Grant' : `RESP Grant: ${toSentenceCase(subType)}`;
      const originalStatement = `${tx.type || ''}:${subType}:${assetSymbol}:${currency}`;
      return { category: 'Grant', merchant, originalStatement, notes: '', technicalDetails: '' };
    },
  },
];

export const INVESTMENT_NON_RESIDENT_TAX_TRANSACTION_RULES: InvestmentTransactionRule[] = [
  {
    id: 'non-resident-tax',
    description: 'Non-resident withholding tax on foreign income',
    match: (tx) => tx.type === 'NON_RESIDENT_TAX',
    process: (tx) => {
      const assetSymbol = tx.assetSymbol || '';
      const subType = tx.subType || '';
      const currency = tx.currency || 'CAD';
      const merchant = !assetSymbol ? 'Non-Resident Tax' : `Non-Resident Tax for ${assetSymbol}`;
      const originalStatement = `${tx.type || ''}:${subType}:${assetSymbol}:${currency}`;
      return { category: 'Dividends & Capital Gains', merchant, originalStatement, notes: '', technicalDetails: '' };
    },
  },
];

export const INVESTMENT_REIMBURSEMENT_TRANSACTION_RULES: InvestmentTransactionRule[] = [
  {
    id: 'reimbursement',
    description: 'Reimbursement transactions for investment accounts',
    match: (tx) => tx.type === 'REIMBURSEMENT',
    process: (tx) => {
      const subType = tx.subType || '';
      const assetSymbol = tx.assetSymbol || '';
      const currency = tx.currency || 'CAD';
      const isCurrencyAsset = assetSymbol === 'CAD' || assetSymbol === 'USD';
      const hasAsset = assetSymbol && !isCurrencyAsset;
      let merchant: string;
      if (!subType && !hasAsset) {
        merchant = `Reimbursement (${currency})`;
      } else if (!subType && hasAsset) {
        merchant = `Reimbursement for ${assetSymbol} (${currency})`;
      } else if (subType && !hasAsset) {
        merchant = `${toSentenceCase(subType)} (${currency})`;
      } else {
        merchant = `${toSentenceCase(subType)} for ${assetSymbol} (${currency})`;
      }
      const originalStatement = `${tx.type || ''}:${subType}:${assetSymbol}:${currency}`;
      return { category: 'Reimbursement', merchant, originalStatement, notes: '', technicalDetails: '' };
    },
  },
];

/**
 * Format crypto order notes from activity and crypto order data
 * Handles market orders and limit orders for CRYPTO_BUY and CRYPTO_SELL transactions
 *
 * @param activity - Raw transaction from Wealthsimple API
 * @param cryptoOrder - Crypto order details from FetchCryptoOrder API
 * @returns Formatted notes string
 */
export function formatCryptoOrderNotes(
  activity: WealthsimpleTransaction,
  cryptoOrder: Record<string, unknown> | null,
): string {
  if (!activity) return '';

  const symbol = activity.assetSymbol || 'N/A';
  const amount = formatAmount(activity.amount ?? 0);
  const isBuy = activity.type === 'CRYPTO_BUY';
  const action = isBuy ? 'Buy' : 'Sell';

  if (!cryptoOrder) {
    return `${action} ${symbol}\nTotal ${activity.currency || 'CAD'}$${amount}`;
  }

  const currency = (cryptoOrder.currency as string) || activity.currency || 'CAD';
  const requestedQuantity = formatAmount((cryptoOrder.quantity as number) ?? 0);
  const executedQuantity = formatAmount((cryptoOrder.executedQuantity as number) ?? 0);
  const price = formatAmount((cryptoOrder.price as number) ?? 0);
  const fee = formatAmount((cryptoOrder.fee as number) ?? 0);
  const swapFee = formatAmount((cryptoOrder.swapFee as number) ?? 0);
  const totalCost = formatAmount((cryptoOrder.totalCost as number) ?? 0);
  const totalFees = formatAmount(
    parseFloat(String(cryptoOrder.fee ?? 0)) + parseFloat(String(cryptoOrder.swapFee ?? 0)),
  );
  const isLimitOrder = cryptoOrder.limitPrice !== null && cryptoOrder.limitPrice !== undefined;

  if (isLimitOrder) {
    const limitPrice = formatAmount(cryptoOrder.limitPrice as number);
    const timeInForce = (cryptoOrder.timeInForce as string) || '';
    return (
      `Limit order ${action} ${requestedQuantity} ${symbol} @ ${limitPrice} Limit ${timeInForce}\n` +
      `Filled ${executedQuantity} @ ${currency}$${price}, fees: ${currency}$${totalFees} (fee: ${currency}$${fee}, swap: ${currency}$${swapFee})\n` +
      `Total ${currency}$${totalCost}`
    );
  }

  return (
    `Market order ${action} ${requestedQuantity} ${symbol}\n` +
    `Filled ${executedQuantity} @ ${currency}$${price}, fees: ${currency}$${totalFees} (fee: ${currency}$${fee}, swap: ${currency}$${swapFee})\n` +
    `Total ${currency}$${totalCost}`
  );
}

/**
 * Format crypto swap order notes from activity and crypto order data
 * Handles CRYPTO_BUY transactions with subType SWAP_MARKET_ORDER
 *
 * @param activity - Raw transaction from Wealthsimple API
 * @param cryptoOrder - Crypto order details from FetchCryptoOrder API
 * @returns Formatted notes string
 */
export function formatCryptoSwapNotes(
  activity: WealthsimpleTransaction,
  cryptoOrder: Record<string, unknown> | null,
): string {
  if (!activity) return '';

  const sourceSymbol = activity.assetSymbol || 'Unknown';
  const destSymbol = activity.counterAssetSymbol || 'Unknown';

  if (!cryptoOrder) {
    return `Swapped ${sourceSymbol} for ${destSymbol}`;
  }

  const sourceQuantity = formatAmount((cryptoOrder.executedValue as number) ?? 0);
  const destQuantity = formatAmount(
    (activity.assetQuantity as number) ?? (cryptoOrder.quantity as number) ?? 0,
  );
  const currency = (cryptoOrder.currency as string) || activity.currency || 'CAD';
  const noteLines: string[] = [];

  noteLines.push(`Swapped ${sourceQuantity} ${sourceSymbol} for ${destQuantity} ${destSymbol}`);

  const feeValue = parseFloat(String(cryptoOrder.fee));
  if (!isNaN(feeValue) && feeValue > 0) {
    const feeFormatted = formatAmount(feeValue);
    const details: string[] = [];
    const commissionBps = parseFloat(String(cryptoOrder.commissionBps));
    if (!isNaN(commissionBps) && commissionBps > 0) {
      details.push(`${formatAmount(commissionBps / 100)}%`);
    }
    const swapFeeValue = parseFloat(String(cryptoOrder.swapFee));
    if (!isNaN(swapFeeValue) && swapFeeValue > 0) {
      details.push(`${cryptoOrder.swapFee} ${sourceSymbol}`);
    }
    const detailStr = details.length > 0 ? ` (${details.join(', ')})` : '';
    noteLines.push(`Fees: ${currency}$${feeFormatted}${detailStr}`);
  }

  return noteLines.join('\n');
}

export const INVESTMENT_BUY_SELL_TRANSACTION_RULES: InvestmentTransactionRule[] = [
  {
    id: 'managed-buy',
    description: 'Managed (robo-advisor) buy transactions',
    match: (tx) => tx.type === 'MANAGED_BUY',
    process: (tx, enrichmentMap) => {
      const symbol = tx.assetSymbol || 'Unknown';
      const extendedOrder = (enrichmentMap?.get(tx.externalCanonicalId) as ExtendedOrder) || null;
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
    process: (tx, enrichmentMap) => {
      const symbol = tx.assetSymbol || 'Unknown';
      const extendedOrder = (enrichmentMap?.get(tx.externalCanonicalId) as ExtendedOrder) || null;
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
    process: (tx, enrichmentMap) => {
      const symbol = tx.assetSymbol || 'Unknown';
      const extendedOrder = (enrichmentMap?.get(tx.externalCanonicalId) as ExtendedOrder) || null;
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
    process: (tx, enrichmentMap) => {
      const symbol = tx.assetSymbol || 'Unknown';
      const extendedOrder = (enrichmentMap?.get(tx.externalCanonicalId) as ExtendedOrder) || null;
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
    process: (tx, enrichmentMap) => {
      const sourceSymbol = tx.assetSymbol || 'Unknown';
      const destSymbol = tx.counterAssetSymbol || 'Unknown';
      const enrichmentData = (enrichmentMap?.get(tx.externalCanonicalId) as Record<string, unknown>) || null;
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
    process: (tx, enrichmentMap) => {
      const symbol = tx.assetSymbol || 'Unknown';
      const enrichmentData = (enrichmentMap?.get(tx.externalCanonicalId) as Record<string, unknown>) || null;
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
    process: (tx, enrichmentMap) => {
      const symbol = tx.assetSymbol || 'Unknown';
      const enrichmentData = (enrichmentMap?.get(tx.externalCanonicalId) as Record<string, unknown>) || null;
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
    process: (tx, enrichmentMap) => {
      const assetSymbol = tx.assetSymbol || 'Unknown';
      const expiryDate = tx.expiryDate || '';
      const strikePrice = formatAmount(tx.strikePrice ?? 0);
      const contractType = tx.contractType || '';
      const currency = tx.currency || 'CAD';
      const extendedOrder = (enrichmentMap?.get(tx.externalCanonicalId) as ExtendedOrder) || null;
      const prettyExpiryDate = formatPrettyDate(expiryDate);
      const contractTypeDisplay = toSentenceCase(contractType);
      const merchant = `${assetSymbol} ${prettyExpiryDate} ${currency}$${strikePrice} ${contractTypeDisplay}`;
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
    process: (tx, enrichmentMap) => {
      const assetSymbol = tx.assetSymbol || 'Unknown';
      const expiryDate = tx.expiryDate || '';
      const strikePrice = formatAmount(tx.strikePrice ?? 0);
      const contractType = tx.contractType || '';
      const currency = tx.currency || 'CAD';
      const extendedOrder = (enrichmentMap?.get(tx.externalCanonicalId) as ExtendedOrder) || null;
      const prettyExpiryDate = formatPrettyDate(expiryDate);
      const contractTypeDisplay = toSentenceCase(contractType);
      const merchant = `${assetSymbol} ${prettyExpiryDate} ${currency}$${strikePrice} ${contractTypeDisplay}`;
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
    id: 'options-assign',
    description: 'Options assignment transactions',
    match: (tx) => tx.type === 'OPTIONS_ASSIGN',
    process: (tx, enrichmentMap) => {
      const assetSymbol = tx.assetSymbol || 'Unknown';
      const expiryDate = tx.expiryDate || '';
      const strikePrice = formatAmount(tx.strikePrice ?? 0);
      const contractType = tx.contractType || '';
      const currency = tx.currency || 'CAD';
      const prettyExpiryDate = formatPrettyDate(expiryDate);
      const contractTypeDisplay = toSentenceCase(contractType);
      const merchant = `${assetSymbol} ${prettyExpiryDate} ${currency}$${strikePrice} ${contractTypeDisplay}`;
      const statementParts = `${assetSymbol}:${expiryDate}:${strikePrice}:${contractType}`;

      const assignEntry = enrichmentMap?.get(tx.externalCanonicalId) as
        | { expiryDetail?: ShortOptionExpiryDetail; securityCache?: Map<string, CachedSecurity> }
        | undefined;
      const expiryDetail = assignEntry?.expiryDetail || null;
      const securityCache = assignEntry?.securityCache || new Map<string, CachedSecurity>();

      const notes = formatOptionsAssignNotes(tx, expiryDetail, securityCache);

      return {
        category: 'Options Assigned',
        merchant,
        originalStatement: formatOriginalStatement(tx.type, tx.subType, statementParts),
        notes,
        technicalDetails: '',
      };
    },
  },
  {
    id: 'options-short-expiry',
    description: 'Short option position expiry transactions',
    match: (tx) => tx.type === 'OPTIONS_SHORT_EXPIRY',
    process: (tx, enrichmentMap) => {
      const assetSymbol = tx.assetSymbol || 'Unknown';
      const expiryDate = tx.expiryDate || '';
      const strikePrice = formatAmount(tx.strikePrice ?? 0);
      const contractType = tx.contractType || '';
      const currency = tx.currency || 'CAD';
      const prettyExpiryDate = formatPrettyDate(expiryDate);
      const contractTypeDisplay = toSentenceCase(contractType);
      const merchant = `${assetSymbol} ${prettyExpiryDate} ${currency}$${strikePrice} ${contractTypeDisplay}`;
      const statementParts = `${assetSymbol}:${expiryDate}:${strikePrice}:${contractType}`;
      const expiryEntry = enrichmentMap?.get(tx.externalCanonicalId) as
        | { expiryDetail?: ShortOptionExpiryDetail; securityCache?: Map<string, CachedSecurity> }
        | undefined;
      const expiryDetail = expiryEntry?.expiryDetail || null;
      const securityCache = expiryEntry?.securityCache || new Map<string, CachedSecurity>();
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
