/**
 * Wealthsimple Transaction Rules Engine
 * Handles automatic categorization and field mapping for different transaction types
 *
 * This file contains rules for processing Wealthsimple CASH account transactions.
 * Each rule defines:
 * - match: A function that returns true if the rule applies to a transaction
 * - process: A function that extracts/generates the transaction fields
 *
 * Rules are evaluated in order - first matching rule wins.
 */

import { debugLog, formatAmount } from '../../core/utils';
import { STORAGE } from '../../core/config';
import { applyMerchantMapping } from '../../mappers/merchant';

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
function getAftCategoryKey(type, subType, aftTransactionType, aftOriginatorName) {
  const originator = aftOriginatorName || 'Unknown AFT';
  const aftType = aftTransactionType || '';

  return `${type}:${subType}:${aftType}:${originator}`;
}

/**
 * Get category for AFT transaction based on aftTransactionType
 * @param {string} aftTransactionType - The AFT transaction type from Wealthsimple
 * @returns {string|null} Monarch category name or null if needs mapping
 */
function getAftCategory(aftTransactionType) {
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
function getETransferDisplayName(transaction) {
  if (transaction.eTransferName) {
    return transaction.eTransferName;
  }
  if (transaction.eTransferEmail) {
    return transaction.eTransferEmail;
  }
  return 'Unknown';
}

/**
 * Extract Interac memo from funding intent data
 * For incoming transfers (e_transfer_receive): memo is in transferMetadata.memo
 * For outgoing transfers (e_transfer_send): memo is in transferMetadata.message or transferMetadata.memo
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

/**
 * Transaction rules for CASH accounts
 * Each rule has:
 * - id: Unique identifier for the rule
 * - match: Function (transaction) => boolean - returns true if rule applies
 * - process: Function (transaction, fundingIntentMap) => Object - returns processed fields
 *
 * Processed fields include:
 * - category: Monarch category name
 * - merchant: Merchant name for display
 * - originalStatement: Original statement text
 * - notes: Optional notes (memo only, e.g., Interac memo from funding intent)
 * - technicalDetails: Optional technical details (e.g., auto-deposit status, reference number)
 */
export const CASH_TRANSACTION_RULES = [
  {
    id: 'e-transfer',
    description: 'Interac e-Transfer transactions (incoming and outgoing)',
    match: (tx) => tx.subType === 'E_TRANSFER',
    process: (tx, fundingIntentMap) => {
      const displayName = getETransferDisplayName(tx);
      const email = tx.eTransferEmail || '';

      // Generate merchant and original statement based on transaction type
      let merchant;
      let statementText;

      if (tx.type === 'WITHDRAWAL') {
        merchant = `e-Transfer to ${displayName}`;
        statementText = email
          ? `Interac e-Transfer to ${displayName} (${email})`
          : `Interac e-Transfer to ${displayName}`;
      } else {
        // DEPOSIT or other types - treat as incoming
        merchant = `e-Transfer from ${displayName}`;
        statementText = email
          ? `Interac e-Transfer from ${displayName} (${email})`
          : `Interac e-Transfer from ${displayName}`;
      }

      // Extract Interac memo and additional details from funding intent data if available
      let notes = '';
      let technicalDetails = '';
      if (fundingIntentMap && tx.externalCanonicalId) {
        const fundingIntent = fundingIntentMap.get(tx.externalCanonicalId);
        if (fundingIntent) {
          // Extract memo for all e-transfers
          const memo = extractInteracMemo(fundingIntent);
          if (memo) {
            debugLog(`Found Interac memo for ${tx.externalCanonicalId}: "${memo}"`);
            notes = memo;
          }

          // For outgoing transfers, also extract auto-deposit and reference number
          if (tx.type === 'WITHDRAWAL') {
            const outgoingDetails = extractOutgoingETransferDetails(fundingIntent);
            const formattedDetails = formatOutgoingETransferDetails(outgoingDetails);

            if (formattedDetails) {
              debugLog(`Found outgoing e-transfer details for ${tx.externalCanonicalId}: "${formattedDetails}"`);
              technicalDetails = formattedDetails;
            }
          }
        }
      }

      return {
        category: 'Transfer',
        merchant,
        originalStatement: formatOriginalStatement(tx.type, tx.subType, statementText),
        notes,
        technicalDetails,
      };
    },
  },
  {
    id: 'spend-prepaid',
    description: 'Prepaid card spending transactions (debit-style purchases in CASH account)',
    match: (tx) => tx.type === 'SPEND' && tx.subType === 'PREPAID',
    /**
     * Process SPEND/PREPAID transactions
     * These are debit-style purchases that use the 'status' field (like credit cards)
     * instead of 'unifiedStatus' (like other CASH transactions).
     *
     * Status mapping:
     * - 'settled': Final transaction (sync as normal)
     * - 'authorized': Pending transaction (sync with Pending tag)
     * - Other statuses: Rejected (exclude from sync)
     *
     * @param {Object} tx - Raw transaction
     * @returns {Object} Processed transaction fields
     */
    process: (tx) => {
      const originalMerchant = tx.spendMerchant || 'Unknown Merchant';
      const cleanedMerchant = applyMerchantMapping(originalMerchant, { stripStoreNumbers: true });

      return {
        // Category will be resolved via user category mapping (like credit cards)
        category: null, // null indicates needs category mapping
        merchant: cleanedMerchant,
        originalStatement: formatOriginalStatement(tx.type, tx.subType, originalMerchant),
        notes: '',
        technicalDetails: '',
        // Flag to indicate this transaction needs category resolution
        needsCategoryMapping: true,
        // Store the category key for mapping (merchant name)
        categoryKey: cleanedMerchant,
      };
    },
  },
  {
    id: 'deposit-aft',
    description: 'AFT (Automated Funds Transfer) deposit transactions - payroll, insurance, etc.',
    match: (tx) => tx.type === 'DEPOSIT' && tx.subType === 'AFT',
    /**
     * Process DEPOSIT/AFT transactions
     * AFT transactions have additional metadata:
     * - aftTransactionCategory: General category (e.g., "payroll", "insurance")
     * - aftTransactionType: Specific type (e.g., "payroll_deposit", "insurance", "misc_payments")
     * - aftOriginatorName: Name of the organization that initiated the transfer
     *
     * Category mapping:
     * - payroll_deposit: Auto-categorized to "Paychecks"
     * - Other types (insurance, misc_payments, etc.): Manual categorization based on
     *   "aftTransactionType:aftOriginatorName" key - saved for future transactions
     *
     * @param {Object} tx - Raw transaction
     * @returns {Object} Processed transaction fields
     */
    process: (tx) => {
      const originatorName = tx.aftOriginatorName || 'Unknown AFT';
      const aftTransactionType = tx.aftTransactionType || '';
      const aftTransactionCategory = tx.aftTransactionCategory || '';

      // Try to get automatic category mapping (only payroll_deposit is auto-mapped)
      const autoCategory = getAftCategory(aftTransactionType);

      if (autoCategory) {
        // Known AFT type - auto-categorize
        debugLog(`AFT transaction auto-categorized: ${aftTransactionType} -> ${autoCategory}`);
        return {
          category: autoCategory,
          merchant: originatorName,
          originalStatement: formatAftOriginalStatement(tx.type, tx.subType, aftTransactionCategory, aftTransactionType, originatorName),
          notes: '',
          technicalDetails: '',
          needsCategoryMapping: false,
        };
      }

      // Unknown AFT type (including insurance, misc_payments) - needs category mapping
      // Use "type:subType:aftTransactionType:aftOriginatorName" as the category key for mapping/saving
      const categoryKey = getAftCategoryKey(tx.type, tx.subType, aftTransactionType, originatorName);
      debugLog(`AFT transaction needs mapping: ${categoryKey}`);
      return {
        category: null,
        merchant: originatorName,
        originalStatement: formatAftOriginalStatement(tx.type, tx.subType, aftTransactionCategory, aftTransactionType, originatorName),
        notes: '',
        technicalDetails: '',
        needsCategoryMapping: true,
        // Use "type:subType:aftTransactionType:aftOriginatorName" as category key for saving
        categoryKey,
        // Store AFT details for category selector display
        aftDetails: {
          aftTransactionCategory,
          aftTransactionType,
          aftOriginatorName: originatorName,
        },
      };
    },
  },
  {
    id: 'withdrawal-aft',
    description: 'AFT (Automated Funds Transfer) withdrawal transactions - payments, transfers out, etc.',
    match: (tx) => tx.type === 'WITHDRAWAL' && tx.subType === 'AFT',
    /**
     * Process WITHDRAWAL/AFT transactions
     * AFT withdrawal transactions have additional metadata:
     * - aftTransactionCategory: General category (e.g., "government", "misc")
     * - aftTransactionType: Specific type (e.g., "tax_payment", "misc_payments")
     * - aftOriginatorName: Name of the organization receiving the transfer
     *
     * All WITHDRAWAL/AFT transactions require user mapping. The category key uses
     * "aftTransactionType:aftOriginatorName" format (same as DEPOSIT/AFT) so that
     * mappings can be shared between deposits and withdrawals from the same originator.
     *
     * @param {Object} tx - Raw transaction
     * @returns {Object} Processed transaction fields
     */
    process: (tx) => {
      const originatorName = tx.aftOriginatorName || 'Unknown AFT';
      const aftTransactionType = tx.aftTransactionType || '';
      const aftTransactionCategory = tx.aftTransactionCategory || '';

      // All WITHDRAWAL/AFT transactions need category mapping
      // Use "type:subType:aftTransactionType:aftOriginatorName" as the category key for mapping/saving
      const categoryKey = getAftCategoryKey(tx.type, tx.subType, aftTransactionType, originatorName);
      debugLog(`WITHDRAWAL/AFT transaction needs mapping: ${categoryKey}`);

      return {
        category: null,
        merchant: originatorName,
        originalStatement: formatAftOriginalStatement(tx.type, tx.subType, aftTransactionCategory, aftTransactionType, originatorName),
        notes: '',
        technicalDetails: '',
        needsCategoryMapping: true,
        // Use "type:subType:aftTransactionType:aftOriginatorName" as category key for saving
        categoryKey,
        // Store AFT details for category selector display
        aftDetails: {
          aftTransactionCategory,
          aftTransactionType,
          aftOriginatorName: originatorName,
        },
      };
    },
  },
  {
    id: 'internal-transfer',
    description: 'Internal transfers between Wealthsimple accounts (SOURCE and DESTINATION)',
    match: (tx) => tx.type === 'INTERNAL_TRANSFER' && (tx.subType === 'SOURCE' || tx.subType === 'DESTINATION'),
    /**
     * Process INTERNAL_TRANSFER transactions
     * These are transfers between Wealthsimple accounts, showing both sides:
     * - DESTINATION: Money coming into the current account
     * - SOURCE: Money leaving the current account
     *
     * Uses opposingAccountId to look up the name of the other account involved.
     * Uses internalTransferMap to fetch annotation (user note) for the transfer.
     *
     * @param {Object} tx - Raw transaction
     * @param {Map<string, Object>} internalTransferMap - Optional map of internal transfer ID to details
     * @returns {Object} Processed transaction fields
     */
    process: (tx, internalTransferMap) => {
      // Look up the opposing account name from the cached accounts list
      const opposingName = getAccountNameById(tx.opposingAccountId);
      // Look up the current account name as well
      const accountName = getAccountNameById(tx.accountId);

      let merchant;
      let statementText;

      if (tx.subType === 'DESTINATION') {
        // Money coming INTO this account - format: "Transfer In: ${accountName} ← ${opposingName}"
        merchant = `Transfer In: ${accountName} ← ${opposingName}`;
        statementText = `Transfer In: ${accountName} ← ${opposingName}`;
      } else {
        // SOURCE - Money leaving this account - format: "Transfer Out: ${accountName} → ${opposingName}"
        merchant = `Transfer Out: ${accountName} → ${opposingName}`;
        statementText = `Transfer Out: ${accountName} → ${opposingName}`;
      }

      // Extract annotation from internal transfer data if available
      let annotation = '';
      if (internalTransferMap && tx.externalCanonicalId) {
        const internalTransfer = internalTransferMap.get(tx.externalCanonicalId);
        if (internalTransfer) {
          const extractedAnnotation = extractInternalTransferAnnotation(internalTransfer);
          if (extractedAnnotation) {
            debugLog(`Found internal transfer annotation for ${tx.externalCanonicalId}: "${extractedAnnotation}"`);
            annotation = extractedAnnotation;
          }
        }
      }

      // Format notes with currency/amount and optional annotation
      const notes = formatTransferNotes(tx, annotation);

      return {
        category: 'Transfer',
        merchant,
        originalStatement: formatOriginalStatement(tx.type, tx.subType, statementText),
        notes,
        technicalDetails: '',
      };
    },
  },
  {
    id: 'withdrawal-bill-pay',
    description: 'Bill payment transactions',
    match: (tx) => tx.type === 'WITHDRAWAL' && tx.subType === 'BILL_PAY',
    /**
     * Process WITHDRAWAL/BILL_PAY transactions
     * These are bill payments that have additional metadata:
     * - billPayCompanyName: The company receiving the payment (e.g., "BC Hydro")
     * - billPayPayeeNickname: User's nickname for the payee (e.g., "Home Electricity")
     * - redactedExternalAccountNumber: Partially redacted account number (e.g., "****1234")
     *
     * Category is determined by user via category mapper based on billPayPayeeNickname.
     * The category selector displays all three fields to help user identify the payment.
     *
     * @param {Object} tx - Raw transaction
     * @returns {Object} Processed transaction fields
     */
    process: (tx) => {
      const billPayCompanyName = tx.billPayCompanyName || 'Unknown Company';
      const billPayPayeeNickname = tx.billPayPayeeNickname || 'Unknown Payee';
      const redactedExternalAccountNumber = tx.redactedExternalAccountNumber || '';

      // Build categoryKey: "type:subType:merchantName"
      const categoryKey = `${tx.type}:${tx.subType}:${billPayPayeeNickname}`;

      const statementText = `${billPayCompanyName} (${redactedExternalAccountNumber})`;

      return {
        category: null, // User selects via category mapper
        merchant: billPayPayeeNickname,
        originalStatement: formatOriginalStatement(tx.type, tx.subType, statementText),
        notes: '',
        technicalDetails: '',
        needsCategoryMapping: true,
        categoryKey,
        // Store bill pay details for category selector display
        billPayDetails: {
          billPayCompanyName,
          billPayPayeeNickname,
          redactedExternalAccountNumber,
        },
      };
    },
  },
  {
    id: 'interest',
    description: 'Interest transactions (earned on cash accounts)',
    match: (tx) => tx.type === 'INTEREST',
    /**
     * Process INTEREST transactions
     * These are interest payments earned on CASH accounts.
     * The subType is ignored as all INTEREST transactions are treated the same.
     *
     * @param {Object} tx - Raw transaction
     * @returns {Object} Processed transaction fields
     */
    process: (tx) => {
      // Look up the account name from the cached accounts list
      const accountName = getAccountNameById(tx.accountId);
      const displayText = `Interest: ${accountName}`;

      return {
        category: 'Interest',
        merchant: displayText,
        originalStatement: formatOriginalStatement(tx.type, tx.subType, displayText),
        notes: '',
        technicalDetails: '',
      };
    },
  },
  {
    id: 'credit-card-payment',
    description: 'Credit card payment transactions',
    match: (tx) => tx.type === 'CREDIT_CARD_PAYMENT',
    /**
     * Process CREDIT_CARD_PAYMENT transactions
     * These are payments made to the Wealthsimple credit card.
     * The subType is ignored as all credit card payments are treated the same.
     *
     * Merchant and originalStatement are set to the credit card account name,
     * looked up by type 'CREDIT_CARD' in the accounts list.
     * Falls back to 'Wealthsimple Credit Card' if no credit card account is found.
     *
     * @param {Object} tx - Raw transaction
     * @returns {Object} Processed transaction fields
     */
    process: (tx) => {
      // Look up the credit card account name by type
      const creditCardName = getAccountNameByType('CREDIT_CARD') || 'Wealthsimple Credit Card';

      return {
        category: 'Credit Card Payment',
        merchant: creditCardName,
        originalStatement: formatOriginalStatement(tx.type, tx.subType, creditCardName),
        notes: '',
        technicalDetails: '',
      };
    },
  },
  {
    id: 'promotion-incentive-bonus',
    description: 'Promotional incentive bonus transactions (e.g., sign-up bonuses)',
    match: (tx) => tx.type === 'PROMOTION' && tx.subType === 'INCENTIVE_BONUS',
    /**
     * Process PROMOTION/INCENTIVE_BONUS transactions
     * These are promotional bonuses (e.g., sign-up bonuses, referral bonuses).
     * Category is determined by user via category mapper.
     *
     * @param {Object} tx - Raw transaction
     * @returns {Object} Processed transaction fields
     */
    process: (tx) => {
      const merchant = 'Wealthsimple Incentive Bonus';
      // Build categoryKey: "type:subType:merchantName"
      const categoryKey = `${tx.type}:${tx.subType}:${merchant}`;

      return {
        category: null, // User selects via category mapper
        merchant,
        originalStatement: formatOriginalStatement(tx.type, tx.subType, merchant),
        notes: '',
        technicalDetails: '',
        needsCategoryMapping: true,
        categoryKey,
        // Store promotion details for category selector display
        promotionDetails: {
          type: tx.type,
          subType: tx.subType,
        },
      };
    },
  },
  {
    id: 'reimbursement-cashback',
    description: 'Cashback reward reimbursement transactions',
    match: (tx) => tx.type === 'REIMBURSEMENT' && tx.subType === 'CASHBACK',
    /**
     * Process REIMBURSEMENT/CASHBACK transactions
     * These are cashback rewards deposited from credit card spending.
     * Category is auto-set to "Cash Back".
     *
     * @param {Object} tx - Raw transaction
     * @returns {Object} Processed transaction fields
     */
    process: (tx) => ({
      category: 'Cash Back',
      merchant: 'Wealthsimple Cashback',
      originalStatement: formatOriginalStatement(tx.type, tx.subType, tx.rewardProgram || 'Wealthsimple Cashback'),
      notes: '',
      technicalDetails: '',
    }),
  },
  {
    id: 'reimbursement-atm',
    description: 'ATM fee reimbursement transactions',
    match: (tx) => tx.type === 'REIMBURSEMENT' && tx.subType === 'ATM',
    /**
     * Process REIMBURSEMENT/ATM transactions
     * These are ATM fee reimbursements from Wealthsimple.
     * Note: status for these transactions is null, handled specially in filtering.
     * Category is auto-set to "Cash & ATM".
     *
     * @param {Object} _tx - Raw transaction (unused but required by interface)
     * @returns {Object} Processed transaction fields
     */
    process: (tx) => ({
      category: 'Cash & ATM',
      merchant: 'ATM Fee Reimbursement',
      originalStatement: formatOriginalStatement(tx.type, tx.subType, 'ATM Fee Reimbursement'),
      notes: '',
      technicalDetails: '',
    }),
  },
  {
    id: 'p2p-payment',
    description: 'P2P payments (person-to-person transfers via handle)',
    match: (tx) => tx.type === 'P2P_PAYMENT' && (tx.subType === 'SEND' || tx.subType === 'SEND_RECEIVED'),
    /**
     * Process P2P_PAYMENT transactions
     * These are person-to-person transfers using Wealthsimple handles.
     *
     * For SEND: Money going out to another user
     * For SEND_RECEIVED: Money coming in from another user
     *
     * Uses p2pHandle to identify the other party.
     * Uses p2pMessage for notes.
     *
     * Category is determined by user via category mapper based on categoryKey format:
     * "${type}:${subType}:${p2pHandle}" (e.g., "P2P_PAYMENT:SEND:@username")
     *
     * @param {Object} tx - Raw transaction
     * @returns {Object} Processed transaction fields
     */
    process: (tx) => {
      const p2pHandle = tx.p2pHandle || 'Unknown';
      const p2pMessage = tx.p2pMessage || '';

      // Generate merchant based on transaction direction
      let merchant;
      let statementText;

      if (tx.subType === 'SEND') {
        merchant = `Transfer to ${p2pHandle}`;
        statementText = `Transfer to ${p2pHandle}`;
      } else {
        // SEND_RECEIVED
        merchant = `Transfer from ${p2pHandle}`;
        statementText = `Transfer from ${p2pHandle}`;
      }

      // Build categoryKey: "type:subType:p2pHandle"
      const categoryKey = `${tx.type}:${tx.subType}:${p2pHandle}`;

      return {
        category: null, // User selects via category mapper
        merchant,
        originalStatement: formatOriginalStatement(tx.type, tx.subType, statementText),
        notes: p2pMessage,
        technicalDetails: '',
        needsCategoryMapping: true,
        categoryKey,
        // Store P2P details for category selector display
        p2pDetails: {
          type: tx.type,
          subType: tx.subType,
          p2pHandle,
        },
      };
    },
  },
  {
    id: 'eft-transfer',
    description: 'EFT transfers between Wealthsimple and external bank accounts (including recurring)',
    match: (tx) => tx.subType === 'EFT' || tx.subType === 'EFT_RECURRING',
    /**
     * Process EFT (Electronic Funds Transfer) transactions
     * These are transfers between Wealthsimple CASH accounts and external bank accounts.
     * Transaction details (bank account info) are fetched via FetchFundsTransfer API.
     *
     * For DEPOSIT: External bank is source, Wealthsimple account is destination
     * For WITHDRAWAL: Wealthsimple account is source, external bank is destination
     *
     * Pending status handling:
     * - status="processing" (unifiedStatus: "IN_PROGRESS") maps to Pending
     * - status="completed" (unifiedStatus: "COMPLETED") maps to completed
     * - Other statuses map to rejected/cancelled
     *
     * @param {Object} tx - Raw transaction
     * @param {Map<string, Object>} fundsTransferMap - Optional map of funds transfer ID to details
     * @returns {Object} Processed transaction fields
     */
    process: (tx, fundsTransferMap) => {
      // Look up the Wealthsimple account name
      const accountName = getAccountNameById(tx.accountId);

      // Get funds transfer details from enrichmentMap
      const fundsTransfer = fundsTransferMap?.get(tx.externalCanonicalId);

      // Determine external bank account (source for DEPOSIT, destination for WITHDRAWAL)
      let bankAccount;
      if (tx.type === 'DEPOSIT') {
        bankAccount = fundsTransfer?.source?.bankAccount;
      } else {
        // WITHDRAWAL
        bankAccount = fundsTransfer?.destination?.bankAccount;
      }

      // Build bank account display
      const institutionName = bankAccount?.institutionName || 'Unknown Bank';
      const accountDisplay = getExternalBankAccountDisplayName(bankAccount);
      const accountNumber = bankAccount?.accountNumber || '';

      // Original statement format: institutionName:accountDisplay (accountNumber)
      const statementText = accountNumber
        ? `${institutionName}:${accountDisplay} (${accountNumber})`
        : `${institutionName}:${accountDisplay}`;

      // Generate merchant based on transaction type
      // For EFT_RECURRING, add frequency prefix if available (e.g., "Monthly transfer in: ...")
      let merchant;
      let frequencyPrefix = '';
      if (tx.subType === 'EFT_RECURRING' && tx.frequency) {
        // Capitalize frequency (API returns all-caps like "MONTHLY")
        const capitalizedFrequency = tx.frequency.charAt(0).toUpperCase() + tx.frequency.slice(1).toLowerCase();
        frequencyPrefix = `${capitalizedFrequency} `;
      }

      if (tx.type === 'DEPOSIT') {
        // Money coming in from external bank
        merchant = `${frequencyPrefix}Transfer In: ${accountName} ← ${institutionName}/${accountDisplay}`;
      } else {
        // WITHDRAWAL - Money going out to external bank
        merchant = `${frequencyPrefix}Transfer Out: ${accountName} → ${institutionName}/${accountDisplay}`;
      }

      // Extract annotation (user note) from funds transfer data
      const notes = extractFundsTransferAnnotation(fundsTransfer);
      if (notes) {
        debugLog(`Found EFT annotation for ${tx.externalCanonicalId}: "${notes}"`);
      }

      return {
        category: 'Transfer',
        merchant,
        originalStatement: formatOriginalStatement(tx.type, tx.subType, statementText),
        notes,
        technicalDetails: '',
      };
    },
  },
  // TODO: Add more rules here as needed
  // Examples of future rules:
  // - FEE
  // - etc.
];

/**
 * Investment account fee transaction rules
 * These rules handle fee transactions in investment accounts
 *
 * Transaction types supported:
 * - FEE: Various fees charged on investment accounts (service fees, management fees, etc.)
 */
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
     * @param {Object} tx - Raw transaction
     * @returns {Object} Processed transaction fields
     */
    process: (tx) => {
      const symbol = tx.assetSymbol || 'Unknown';
      const currency = tx.currency || 'CAD';
      const amount = formatAmount(tx.amount ?? 0);

      // Determine notes based on subType
      let notes;
      if (tx.subType === 'MANUFACTURED_DIVIDEND') {
        notes = `Dividend on lended ${symbol} shares: ${currency}$${amount}`;
      } else {
        notes = `Dividend on ${symbol}: ${currency}$${amount}`;
      }

      return {
        category: 'Dividends & Capital Gains',
        merchant: symbol,
        originalStatement: formatOriginalStatement(tx.type, tx.subType, symbol),
        notes,
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
      const strikePrice = tx.strikePrice ?? 0;
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
      const strikePrice = tx.strikePrice ?? 0;
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
      const statementParts = `${assetSymbol}:${expiryDate}:${tx.strikePrice ?? 0}:${contractType}`;

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
export function applyTransactionRule(transaction, fundingIntentMap = null) {
  const transactionId = getTransactionId(transaction);

  for (const rule of CASH_TRANSACTION_RULES) {
    if (rule.match(transaction)) {
      debugLog(`Transaction ${transactionId} matched rule: ${rule.id}`);
      const result = rule.process(transaction, fundingIntentMap);
      return {
        ...result,
        ruleId: rule.id,
      };
    }
  }

  debugLog(`No rule matched for transaction ${transactionId}`, {
    type: transaction.type,
    subType: transaction.subType,
  });
  return null;
}

/**
 * Check if a transaction type/subType combination is supported by any rule
 * @param {string} type - Transaction type
 * @param {string} subType - Transaction subType
 * @returns {boolean} True if at least one rule might match
 */
export function hasRuleForTransaction(type, subType) {
  // Quick check without running full match logic
  const mockTx = { type, subType };
  return CASH_TRANSACTION_RULES.some((rule) => {
    try {
      return rule.match(mockTx);
    } catch {
      return false;
    }
  });
}

export default {
  CASH_TRANSACTION_RULES,
  INVESTMENT_FEE_TRANSACTION_RULES,
  INVESTMENT_DEPOSIT_TRANSACTION_RULES,
  INVESTMENT_DIVIDEND_TRANSACTION_RULES,
  INVESTMENT_INTEREST_TRANSACTION_RULES,
  INVESTMENT_RESP_GRANT_TRANSACTION_RULES,
  INVESTMENT_NON_RESIDENT_TAX_TRANSACTION_RULES,
  INVESTMENT_REIMBURSEMENT_TRANSACTION_RULES,
  applyTransactionRule,
  hasRuleForTransaction,
  getETransferDisplayName,
  getTransactionId,
};
