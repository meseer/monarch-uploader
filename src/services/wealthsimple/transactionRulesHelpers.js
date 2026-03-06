/**
 * Wealthsimple Transaction Rules - Shared Helpers
 * Common utility functions used across transaction rule modules
 */

import { debugLog, formatAmount } from '../../core/utils';
import { STORAGE } from '../../core/config';

/**
 * Format spend transaction notes from spend details
 * Adds foreign currency info and reward info if applicable
 *
 * @param {Object|null} spendDetails - Spend transaction details from FetchSpendTransactions API
 * @returns {string} Formatted notes string or empty string if no relevant details
 */
export function formatSpendNotes(spendDetails) {
  if (!spendDetails) {
    return '';
  }

  const notes = [];

  // Add foreign currency details if applicable
  if (spendDetails.isForeign === true) {
    const foreignAmount = spendDetails.foreignAmount ?? 'N/A';
    const foreignCurrency = spendDetails.foreignCurrency ?? 'N/A';
    const foreignExchangeRate = spendDetails.foreignExchangeRate ?? 'N/A';
    notes.push(`Amount: ${foreignAmount} ${foreignCurrency} (rate: ${foreignExchangeRate})`);
  }

  // Add reward details if applicable
  if (spendDetails.hasReward === true) {
    const rewardAmount = spendDetails.rewardAmount ?? 0;
    notes.push(`Rewards: ${rewardAmount}`);
  }

  return notes.join('\n');
}

/**
 * Format transfer notes with currency and amount
 * @param {Object} transaction - Raw transaction from Wealthsimple API
 * @param {string} existingNote - Any existing annotation/note to append
 * @returns {string} Formatted notes string
 */
export function formatTransferNotes(transaction, existingNote = '') {
  const currency = transaction.currency || 'CAD';
  const amount = formatAmount(transaction.amount ?? 0);

  let notes = `Transfer of ${currency}$${amount}`;

  if (existingNote) {
    notes = `${notes}\n${existingNote}`;
  }

  return notes;
}

/**
 * Format a date string from "2026-01-16" to "Jan 16, 2026"
 * @param {string} dateString - Date in YYYY-MM-DD format
 * @returns {string} Formatted date (e.g., "Jan 16, 2026") or empty string if invalid
 */
export function formatPrettyDate(dateString) {
  if (!dateString) return '';

  try {
    // Parse as local date (avoid timezone issues by appending time)
    const date = new Date(`${dateString}T00:00:00`);

    if (isNaN(date.getTime())) {
      debugLog(`Invalid date string for formatPrettyDate: ${dateString}`);
      return '';
    }

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch (error) {
    debugLog(`Error formatting date in formatPrettyDate: ${dateString}`, error);
    return '';
  }
}

/**
 * Convert a string to sentence case (capitalize first letter, lowercase rest)
 * Handles UPPER_CASE_STRINGS by replacing underscores with spaces
 * @param {string} str - Input string (e.g., "MARKET_ORDER", "DIY_BUY")
 * @returns {string} Sentence case string (e.g., "Market order", "Diy buy")
 */
export function toSentenceCase(str) {
  if (!str) return '';
  // Replace underscores with spaces and convert to lowercase
  const normalized = str.replace(/_/g, ' ').toLowerCase();
  // Capitalize first letter
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

/**
 * Format investment order notes from activity and extended order data
 * Handles two data sources:
 * 1. FetchSoOrdersExtendedOrder (DIY orders) - Full data including orderType, fees, limitPrice, etc.
 * 2. FetchActivityByOrdersServiceOrderId (Managed orders) - Limited data: quantity, fxRate, marketPrice
 *
 * @param {Object} activity - Raw transaction from Wealthsimple API
 * @param {Object|null} extendedOrder - Extended order details (from either API)
 * @returns {string} Formatted notes string
 */
export function formatInvestmentOrderNotes(activity, extendedOrder) {
  if (!activity) return '';

  const currency = activity.currency || 'CAD';
  const symbol = activity.assetSymbol || 'N/A';
  const amount = formatAmount(activity.amount ?? 0);
  const subType = activity.subType || '';

  // If no extended order data, return minimal notes
  if (!extendedOrder) {
    return `${toSentenceCase(subType)} ${symbol}\nTotal ${currency}$${amount}`;
  }

  // Check if this is managed order data (from FetchActivityByOrdersServiceOrderId)
  // Managed order data has isManagedOrderData marker and marketPrice field
  if (extendedOrder.isManagedOrderData) {
    return formatManagedOrderNotes(activity, extendedOrder);
  }

  // Full extended order data from FetchSoOrdersExtendedOrder (DIY orders)
  const orderType = extendedOrder.orderType ? toSentenceCase(extendedOrder.orderType) : 'Order';
  const submittedQuantity = formatAmount(extendedOrder.submittedQuantity ?? 0);
  const filledQuantity = formatAmount(extendedOrder.filledQuantity ?? 0);
  const averageFilledPrice = formatAmount(extendedOrder.averageFilledPrice ?? 0);
  const filledTotalFee = formatAmount(extendedOrder.filledTotalFee ?? 0);

  // Determine if this is a limit order
  const isLimitOrder = subType === 'LIMIT_ORDER';

  if (isLimitOrder) {
    const limitPrice = formatAmount(extendedOrder.limitPrice ?? 0);
    const timeInForce = extendedOrder.timeInForce || '';
    // Format: "Limit Order Buy 100 VFV @ 44.50 Limit GTC\nFilled 100 @ CAD$44.25, fees: CAD$0.00\nTotal CAD$4425.00"
    return `${toSentenceCase(subType)} ${orderType} ${submittedQuantity} ${symbol} @ ${limitPrice} Limit ${timeInForce}\nFilled ${filledQuantity} @ ${currency}$${averageFilledPrice}, fees: ${currency}$${filledTotalFee}\nTotal ${currency}$${amount}`;
  }

  // Format for MARKET_ORDER, RECURRING_ORDER, FRACTIONAL_ORDER:
  // "Market Order Buy 10 VFV\nFilled 10 @ CAD$45.23, fees: CAD$0.00\nTotal CAD$452.30"
  return `${toSentenceCase(subType)} ${orderType} ${submittedQuantity} ${symbol}\nFilled ${filledQuantity} @ ${currency}$${averageFilledPrice}, fees: ${currency}$${filledTotalFee}\nTotal ${currency}$${amount}`;
}

/**
 * Format notes for managed orders (from FetchActivityByOrdersServiceOrderId)
 * These orders have limited data: quantity, fxRate, marketPrice
 *
 * Format:
 * "Managed buy 0.8257 VEQT
 * Filled at CAD$11.165
 * FX rate: 1.35" (only if fxRate !== "1.0")
 * "Total CAD$9.22"
 *
 * @param {Object} activity - Raw transaction from Wealthsimple API
 * @param {Object} managedOrderData - Data from FetchActivityByOrdersServiceOrderId
 * @returns {string} Formatted notes string
 */
export function formatManagedOrderNotes(activity, managedOrderData, isSell = false) {
  if (!activity) return '';

  const symbol = activity.assetSymbol || 'N/A';
  const totalAmount = formatAmount(activity.amount ?? 0);
  const activityCurrency = activity.currency || 'CAD';

  // If no managed order data, return minimal notes
  if (!managedOrderData) {
    const action = isSell ? 'Sell' : 'Buy';
    return `${action} order ${symbol}\nTotal ${activityCurrency}$${totalAmount}`;
  }

  // Extract data from managed order response
  const quantity = formatAmount(managedOrderData.quantity ?? 0);
  const marketPrice = managedOrderData.marketPrice;

  // If marketPrice is missing, fall back to minimal notes
  if (!marketPrice) {
    const action = isSell ? 'Sell' : 'Buy';
    return `${action} order ${symbol}\nTotal ${activityCurrency}$${totalAmount}`;
  }

  // Get fill price and currency from marketPrice
  const fillPrice = formatAmount(marketPrice?.amount ?? 0);
  const fillCurrency = marketPrice?.currency || activityCurrency;

  // Determine action type - use isSell parameter
  const action = isSell ? 'Sold' : 'Bought';

  // Build a descriptive name string
  const assetName = activity.assetName;
  const assetDescription = assetName ? `${assetName} (${symbol})` : symbol;

  // Line 1: "Bought 0.8257 shares of iShares Edge MSCI Min Vol Emerging Mkt ETF (EEMV) at CAD$11.165 per share"
  const line1 = `${action} ${quantity} shares of ${assetDescription} at ${fillCurrency}$${fillPrice} per share`;

  // Build notes
  const noteLines = [line1];

  // Add Total line
  noteLines.push(`Total ${activityCurrency}$${totalAmount}`);

  return noteLines.join('\n');
}

/**
 * Format options order notes from activity and extended order data
 * Handles both OPTIONS_BUY and OPTIONS_SELL transactions with LIMIT_ORDER and other subtypes
 *
 * @param {Object} activity - Raw transaction from Wealthsimple API
 * @param {Object|null} extendedOrder - Extended order details from FetchSoOrdersExtendedOrder
 * @param {boolean} isSell - True for OPTIONS_SELL, false for OPTIONS_BUY
 * @returns {string} Formatted notes string
 */
export function formatOptionsOrderNotes(activity, extendedOrder, isSell) {
  if (!activity) return '';

  const currency = activity.currency || 'CAD';
  const assetSymbol = activity.assetSymbol || 'N/A';
  const assetQuantity = formatAmount(activity.assetQuantity ?? 0);
  const strikePrice = formatAmount(activity.strikePrice ?? 0);
  const contractType = activity.contractType || '';
  const expiryDate = activity.expiryDate || '';
  const amount = formatAmount(activity.amount ?? 0);
  const subType = activity.subType || '';

  // Extended order data for fill details
  const optionMultiplier = formatAmount(extendedOrder?.optionMultiplier ?? 100);
  const filledQuantity = formatAmount(extendedOrder?.filledQuantity ?? 0);
  const averageFilledPrice = formatAmount(extendedOrder?.averageFilledPrice ?? 0);
  const filledTotalFee = formatAmount(extendedOrder?.filledTotalFee ?? 0);
  const timeInForce = extendedOrder?.timeInForce || '';
  const limitPrice = formatAmount(extendedOrder?.limitPrice ?? 0);

  const action = isSell ? 'Sell' : 'Buy';
  const timeInForceDisplay = timeInForce ? `${toSentenceCase(timeInForce)} order` : 'order';

  // If no extended order data, return minimal notes
  if (!extendedOrder) {
    return `${toSentenceCase(subType)} ${assetSymbol}\nTotal ${currency}$${amount}`;
  }

  // Determine if this is a limit order
  const isLimitOrder = subType === 'LIMIT_ORDER';

  if (isLimitOrder) {
    // LIMIT_ORDER format:
    // "Limit Sell 5 AAPL 200.00 CALL contracts (100 share lots at CAD$2.50 per share) with expiry date 2026-01-16 (Good til cancelled order)
    // Filled 5 contracts at CAD$2.45, fees: CAD$4.95
    // Total CAD$1220.05"
    return `Limit ${action} ${assetQuantity} ${assetSymbol} ${strikePrice} ${contractType} contracts (${optionMultiplier} share lots at ${currency}$${limitPrice} per share) with expiry date ${expiryDate} (${timeInForceDisplay})\nFilled ${filledQuantity} contracts at ${currency}$${averageFilledPrice}, fees: ${currency}$${filledTotalFee}\nTotal ${currency}$${amount}`;
  }

  // Non-LIMIT_ORDER format (e.g., MARKET_ORDER):
  // "Market order: Sell 5 AAPL 200.00 CALL contracts (100 share lots) with expiry date 2026-01-16 (Good til cancelled order)
  // Filled 5 contracts at CAD$2.45, fees: CAD$4.95
  // Total CAD$1220.05"
  return `${toSentenceCase(subType)}: ${action} ${assetQuantity} ${assetSymbol} ${strikePrice} ${contractType} contracts (${optionMultiplier} share lots) with expiry date ${expiryDate} (${timeInForceDisplay})\nFilled ${filledQuantity} contracts at ${currency}$${averageFilledPrice}, fees: ${currency}$${filledTotalFee}\nTotal ${currency}$${amount}`;
}

/**
 * Get a unique transaction ID for a Wealthsimple transaction
 * Uses the following priority:
 * 1. externalCanonicalId (most transactions have this)
 * 2. canonicalId (e.g., interest transactions)
 * 3. Generated deterministic ID based on transaction properties
 *
 * @param {Object} transaction - Raw transaction from Wealthsimple API
 * @returns {string} Unique transaction identifier
 */
export function getTransactionId(transaction) {
  // Prefer externalCanonicalId (most transactions)
  if (transaction.externalCanonicalId) {
    return transaction.externalCanonicalId;
  }

  // Fall back to canonicalId (e.g., interest transactions)
  if (transaction.canonicalId) {
    return transaction.canonicalId;
  }

  // Generate deterministic ID if both are null
  // Format: "{accountId}:{datetime}:{type}:{subType}:{amount}:{currency}"
  const accountId = transaction.accountId || '';
  const datetime = transaction.occurredAt || '';
  const type = transaction.type || '';
  const subType = transaction.subType || '';
  const amount = transaction.amount !== null && transaction.amount !== undefined ? String(transaction.amount) : '';
  const currency = transaction.currency || '';

  return `generated:${accountId}:${datetime}:${type}:${subType}:${amount}:${currency}`;
}

/**
 * Format original statement with type:subType: prefix
 * Converts null values to empty strings
 * @param {string|null} type - Transaction type
 * @param {string|null} subType - Transaction subType
 * @param {string} statement - Original statement text
 * @returns {string} Formatted statement with "type:subType:" prefix
 */
export function formatOriginalStatement(type, subType, statement) {
  const typeStr = type || '';
  const subTypeStr = subType || '';
  return `${typeStr}:${subTypeStr}:${statement}`;
}

/**
 * Format original statement for AFT transactions with enhanced metadata
 * Format: type:subType:aftTransactionCategory:aftTransactionType:statementText
 * Converts null values to empty strings
 * @param {string|null} type - Transaction type (e.g., DEPOSIT, WITHDRAWAL)
 * @param {string|null} subType - Transaction subType (e.g., AFT)
 * @param {string|null} aftTransactionCategory - AFT transaction category (e.g., payroll, insurance)
 * @param {string|null} aftTransactionType - AFT transaction type (e.g., payroll_deposit, insurance)
 * @param {string} statement - Original statement text (typically the originator name)
 * @returns {string} Formatted statement with all AFT metadata
 */
export function formatAftOriginalStatement(type, subType, aftTransactionCategory, aftTransactionType, statement) {
  const typeStr = type || '';
  const subTypeStr = subType || '';
  const aftCategoryStr = aftTransactionCategory || '';
  const aftTypeStr = aftTransactionType || '';
  return `${typeStr}:${subTypeStr}:${aftCategoryStr}:${aftTypeStr}:${statement}`;
}

/**
 * Get account name from the cached Wealthsimple accounts list by account ID
 * Used for looking up opposing account names in internal transfers
 * @param {string} accountId - Wealthsimple account ID
 * @returns {string} Account nickname or 'Unknown Account' if not found
 */
export function getAccountNameById(accountId) {
  if (!accountId) {
    return 'Unknown Account';
  }

  try {
    const accountsJson = GM_getValue(STORAGE.WEALTHSIMPLE_ACCOUNTS_LIST, '[]');
    const accounts = JSON.parse(accountsJson);

    const account = accounts.find((acc) => acc.wealthsimpleAccount?.id === accountId);
    if (account && account.wealthsimpleAccount?.nickname) {
      return account.wealthsimpleAccount.nickname;
    }

    return 'Unknown Account';
  } catch (error) {
    debugLog('Error looking up account by ID:', error);
    return 'Unknown Account';
  }
}

/**
 * Get account name from the cached Wealthsimple accounts list by account type
 * Used for looking up account names when only the type is known (e.g., credit card payments)
 * @param {string} accountType - Wealthsimple account type (e.g., 'CREDIT_CARD')
 * @returns {string|null} Account nickname or null if not found
 */
export function getAccountNameByType(accountType) {
  if (!accountType) {
    return null;
  }

  try {
    const accountsJson = GM_getValue(STORAGE.WEALTHSIMPLE_ACCOUNTS_LIST, '[]');
    const accounts = JSON.parse(accountsJson);

    const account = accounts.find((acc) => acc.wealthsimpleAccount?.type === accountType);
    if (account && account.wealthsimpleAccount?.nickname) {
      return account.wealthsimpleAccount.nickname;
    }

    return null;
  } catch (error) {
    debugLog('Error looking up account by type:', error);
    return null;
  }
}

/**
 * AFT transaction type to Monarch category mapping
 * Only payroll_deposit is statically mapped - other types require manual categorization
 * based on the specific originator
 */
const AFT_TYPE_CATEGORY_MAP = {
  payroll_deposit: 'Paychecks',
};

/**
 * Generate the category key for AFT transactions
 * Format: "type:subType:aftTransactionType:aftOriginatorName"
 * This allows different originators with the same AFT type to have different categories
 * When aftTransactionType is missing, uses empty string in that position
 * @param {string} type - Transaction type (e.g., DEPOSIT, WITHDRAWAL)
 * @param {string} subType - Transaction subType (e.g., AFT)
 * @param {string} aftTransactionType - The AFT transaction type (e.g., payroll_deposit, insurance)
 * @param {string} aftOriginatorName - The AFT originator name
 * @returns {string} Category key for mapping
 */
export function getAftCategoryKey(type, subType, aftTransactionType, aftOriginatorName) {
  const originator = aftOriginatorName || 'Unknown AFT';
  const aftType = aftTransactionType || '';

  return `${type}:${subType}:${aftType}:${originator}`;
}

/**
 * Get category for AFT transaction based on aftTransactionType
 * @param {string} aftTransactionType - The AFT transaction type from Wealthsimple
 * @returns {string|null} Monarch category name or null if needs mapping
 */
export function getAftCategory(aftTransactionType) {
  if (!aftTransactionType) {
    return null;
  }
  return AFT_TYPE_CATEGORY_MAP[aftTransactionType] || null;
}

/**
 * Get display name for e-transfer participant
 * Falls back to email, then "Unknown" if both are missing
 * @param {Object} transaction - Raw transaction object
 * @returns {string} Display name
 */
export function getETransferDisplayName(transaction) {
  if (transaction.eTransferName) {
    return transaction.eTransferName;
  }
  if (transaction.eTransferEmail) {
    return transaction.eTransferEmail;
  }
  return 'Unknown';
}

/**
 * Extract annotation from FundingIntentStatusSummary response
 * This is the primary source for e-transfer messages as of 2026-03-06.
 *
 * The FetchFundingIntentStatusSummary API returns an `annotation` field that contains
 * the user-entered message for the transfer (e.g., "For mom's medical screening").
 *
 * @param {Object|null} statusSummary - Status summary data from FetchFundingIntentStatusSummary API
 * @returns {string} Annotation text or empty string if not found
 */
export function extractStatusSummaryAnnotation(statusSummary) {
  if (!statusSummary) {
    return '';
  }

  return statusSummary.annotation || '';
}

/**
 * Extract Interac memo from funding intent data
 * For incoming transfers (e_transfer_receive): memo is in transferMetadata.memo
 * For outgoing transfers (e_transfer_send): memo is in transferMetadata.message or transferMetadata.memo
 *
 * @deprecated As of 2026-03-06, the memo field in FetchFundingIntent.transferMetadata is no longer
 * populated by the Wealthsimple API. Use extractStatusSummaryAnnotation() with data from
 * FetchFundingIntentStatusSummary instead. This function is kept as a fallback for backward
 * compatibility and is marked for removal in a future version.
 *
 * @param {Object|null} fundingIntent - Funding intent data from FetchFundingIntent API
 * @returns {string} Memo text or empty string if not found
 */
export function extractInteracMemo(fundingIntent) {
  if (!fundingIntent || !fundingIntent.transferMetadata) {
    return '';
  }

  const metadata = fundingIntent.transferMetadata;

  // Incoming e-transfers use 'memo' field
  if (metadata.memo) {
    return metadata.memo;
  }

  // Outgoing e-transfers use 'message' field
  if (metadata.message) {
    return metadata.message;
  }

  return '';
}

/**
 * Extract outgoing e-transfer details from funding intent data
 * For outgoing transfers: extracts autoDeposit status and network payment reference ID
 *
 * @param {Object|null} fundingIntent - Funding intent data from FetchFundingIntent API
 * @returns {Object} Object with { autoDeposit: string|null, networkPaymentRefId: string|null }
 */
export function extractOutgoingETransferDetails(fundingIntent) {
  const result = {
    autoDeposit: null,
    networkPaymentRefId: null,
  };

  if (!fundingIntent || !fundingIntent.transferMetadata) {
    return result;
  }

  const metadata = fundingIntent.transferMetadata;

  // Extract auto-deposit status (convert boolean to Yes/No)
  if (typeof metadata.autoDeposit === 'boolean') {
    result.autoDeposit = metadata.autoDeposit ? 'Yes' : 'No';
  }

  // Extract network payment reference ID
  if (metadata.networkPaymentRefId) {
    result.networkPaymentRefId = metadata.networkPaymentRefId;
  }

  return result;
}

/**
 * Format outgoing e-transfer details as a string for notes
 * Format: "Auto Deposit: Yes; Reference Number: CAkJgEwf"
 *
 * @param {Object} details - Object from extractOutgoingETransferDetails
 * @returns {string} Formatted string or empty if no details available
 */
export function formatOutgoingETransferDetails(details) {
  if (!details) {
    return '';
  }

  const parts = [];

  if (details.autoDeposit !== null) {
    parts.push(`Auto Deposit: ${details.autoDeposit}`);
  }

  if (details.networkPaymentRefId !== null) {
    parts.push(`Reference Number: ${details.networkPaymentRefId}`);
  }

  return parts.join('; ');
}

/**
 * Extract annotation (user note) from internal transfer data
 *
 * @param {Object|null} internalTransfer - Internal transfer data from FetchInternalTransfer API
 * @returns {string} Annotation text or empty string if not found
 */
export function extractInternalTransferAnnotation(internalTransfer) {
  if (!internalTransfer) {
    return '';
  }

  return internalTransfer.annotation || '';
}

/**
 * Extract annotation (user note) from funds transfer data
 *
 * @param {Object|null} fundsTransfer - Funds transfer data from FetchFundsTransfer API
 * @returns {string} Annotation text or empty string if not found
 */
export function extractFundsTransferAnnotation(fundsTransfer) {
  if (!fundsTransfer) {
    return '';
  }

  return fundsTransfer.annotation || '';
}

/**
 * Get display name for external bank account
 * Falls back to accountNumber, then "Unknown Account" if both nickname and accountNumber are missing
 *
 * @param {Object|null} bankAccount - Bank account object from FetchFundsTransfer API
 * @returns {string} Display name (nickname, accountNumber, or "Unknown Account")
 */
export function getExternalBankAccountDisplayName(bankAccount) {
  if (!bankAccount) {
    return 'Unknown Account';
  }

  // First try nickname
  if (bankAccount.nickname) {
    return bankAccount.nickname;
  }

  // Fall back to account number
  if (bankAccount.accountNumber) {
    return bankAccount.accountNumber;
  }

  return 'Unknown Account';
}

