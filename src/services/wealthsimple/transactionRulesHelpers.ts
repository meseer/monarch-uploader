/**
 * Wealthsimple Transaction Rules - Shared Helpers
 * Common utility functions used across transaction rule modules
 */

import { debugLog, formatAmount } from '../../core/utils';
import { STORAGE } from '../../core/config';

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface WealthsimpleTransaction {
  externalCanonicalId?: string | null;
  canonicalId?: string | null;
  accountId?: string | null;
  opposingAccountId?: string | null;
  occurredAt?: string | null;
  type?: string | null;
  subType?: string | null;
  amount?: number | null;
  currency?: string | null;
  eTransferName?: string | null;
  eTransferEmail?: string | null;
  assetSymbol?: string | null;
  assetName?: string | null;
  assetQuantity?: number | null;
  strikePrice?: number | null;
  contractType?: string | null;
  expiryDate?: string | null;
  // AFT fields
  aftOriginatorName?: string | null;
  aftTransactionType?: string | null;
  aftTransactionCategory?: string | null;
  // Bill pay fields
  billPayCompanyName?: string | null;
  billPayPayeeNickname?: string | null;
  redactedExternalAccountNumber?: string | null;
  // P2P fields
  p2pHandle?: string | null;
  p2pMessage?: string | null;
  // EFT fields
  frequency?: string | null;
  // Crypto fields
  counterAssetSymbol?: string | null;
  // Investment fields
  grossDividendRate?: number | null;
  withholdingTaxAmount?: number | null;
  announcementDate?: string | null;
  recordDate?: string | null;
  payableDate?: string | null;
  institutionName?: string | null;
  rewardProgram?: string | null;
  [key: string]: unknown;
}

export interface SpendDetails {
  isForeign?: boolean | null;
  foreignAmount?: number | string | null;
  foreignCurrency?: string | null;
  foreignExchangeRate?: number | string | null;
  hasReward?: boolean | null;
  rewardAmount?: number | null;
  [key: string]: unknown;
}

export interface ExtendedOrder {
  isManagedOrderData?: boolean;
  isCryptoOrderData?: boolean;
  orderType?: string | null;
  submittedQuantity?: number | null;
  filledQuantity?: number | null;
  averageFilledPrice?: number | null;
  filledTotalFee?: number | null;
  limitPrice?: number | null;
  timeInForce?: string | null;
  optionMultiplier?: number | null;
  quantity?: number | null;
  executedQuantity?: number | null;
  price?: number | null;
  fee?: number | null;
  swapFee?: number | null;
  totalCost?: number | null;
  executedValue?: number | null;
  commissionBps?: number | null;
  currency?: string | null;
  marketPrice?: { amount?: number | null; currency?: string | null } | null;
  [key: string]: unknown;
}

export interface FundingIntent {
  transferMetadata?: {
    memo?: string | null;
    message?: string | null;
    autoDeposit?: boolean | null;
    networkPaymentRefId?: string | null;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

export interface StatusSummary {
  annotation?: string | null;
  [key: string]: unknown;
}

export interface InternalTransfer {
  annotation?: string | null;
  [key: string]: unknown;
}

export interface FundsTransfer {
  annotation?: string | null;
  [key: string]: unknown;
}

export interface BankAccount {
  nickname?: string | null;
  accountNumber?: string | null;
  [key: string]: unknown;
}

export interface OutgoingETransferDetails {
  autoDeposit: string | null;
  networkPaymentRefId: string | null;
}

export interface WealthsimpleAccountEntry {
  wealthsimpleAccount?: {
    id?: string;
    nickname?: string;
    type?: string;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

// ── Functions ─────────────────────────────────────────────────────────────────

/**
 * Format spend transaction notes from spend details
 * Adds foreign currency info and reward info if applicable
 *
 * @param spendDetails - Spend transaction details from FetchSpendTransactions API
 * @returns Formatted notes string or empty string if no relevant details
 */
export function formatSpendNotes(spendDetails: SpendDetails | null | undefined): string {
  if (!spendDetails) {
    return '';
  }

  const notes: string[] = [];

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
 * @param transaction - Raw transaction from Wealthsimple API
 * @param existingNote - Any existing annotation/note to append
 * @returns Formatted notes string
 */
export function formatTransferNotes(transaction: WealthsimpleTransaction, existingNote: string = ''): string {
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
 * @param dateString - Date in YYYY-MM-DD format
 * @returns Formatted date (e.g., "Jan 16, 2026") or empty string if invalid
 */
export function formatPrettyDate(dateString: string | null | undefined): string {
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
 * @param str - Input string (e.g., "MARKET_ORDER", "DIY_BUY")
 * @returns Sentence case string (e.g., "Market order", "Diy buy")
 */
export function toSentenceCase(str: string | null | undefined): string {
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
 * @param activity - Raw transaction from Wealthsimple API
 * @param extendedOrder - Extended order details (from either API)
 * @returns Formatted notes string
 */
export function formatInvestmentOrderNotes(
  activity: WealthsimpleTransaction,
  extendedOrder: ExtendedOrder | null | undefined,
): string {
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
 * @param activity - Raw transaction from Wealthsimple API
 * @param managedOrderData - Data from FetchActivityByOrdersServiceOrderId
 * @param isSell - True for sell orders
 * @returns Formatted notes string
 */
export function formatManagedOrderNotes(
  activity: WealthsimpleTransaction,
  managedOrderData: ExtendedOrder | null | undefined,
  isSell: boolean = false,
): string {
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
  const assetName = activity.assetName as string | undefined;
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
 * @param activity - Raw transaction from Wealthsimple API
 * @param extendedOrder - Extended order details from FetchSoOrdersExtendedOrder
 * @param isSell - True for OPTIONS_SELL, false for OPTIONS_BUY
 * @returns Formatted notes string
 */
export function formatOptionsOrderNotes(
  activity: WealthsimpleTransaction,
  extendedOrder: ExtendedOrder | null | undefined,
  isSell: boolean,
): string {
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
    return `Limit ${action} ${assetQuantity} ${assetSymbol} ${strikePrice} ${contractType} contracts (${optionMultiplier} share lots at ${currency}$${limitPrice} per share) with expiry date ${expiryDate} (${timeInForceDisplay})\nFilled ${filledQuantity} contracts at ${currency}$${averageFilledPrice}, fees: ${currency}$${filledTotalFee}\nTotal ${currency}$${amount}`;
  }

  return `${toSentenceCase(subType)}: ${action} ${assetQuantity} ${assetSymbol} ${strikePrice} ${contractType} contracts (${optionMultiplier} share lots) with expiry date ${expiryDate} (${timeInForceDisplay})\nFilled ${filledQuantity} contracts at ${currency}$${averageFilledPrice}, fees: ${currency}$${filledTotalFee}\nTotal ${currency}$${amount}`;
}

/**
 * Get a unique transaction ID for a Wealthsimple transaction
 * Uses the following priority:
 * 1. externalCanonicalId (most transactions have this)
 * 2. canonicalId (e.g., interest transactions)
 * 3. Generated deterministic ID based on transaction properties
 *
 * @param transaction - Raw transaction from Wealthsimple API
 * @returns Unique transaction identifier
 */
export function getTransactionId(transaction: WealthsimpleTransaction): string {
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
 * @param type - Transaction type
 * @param subType - Transaction subType
 * @param statement - Original statement text
 * @returns Formatted statement with "type:subType:" prefix
 */
export function formatOriginalStatement(
  type: string | null | undefined,
  subType: string | null | undefined,
  statement: string,
): string {
  const typeStr = type || '';
  const subTypeStr = subType || '';
  return `${typeStr}:${subTypeStr}:${statement}`;
}

/**
 * Format original statement for AFT transactions with enhanced metadata
 * Format: type:subType:aftTransactionCategory:aftTransactionType:statementText
 * @param type - Transaction type (e.g., DEPOSIT, WITHDRAWAL)
 * @param subType - Transaction subType (e.g., AFT)
 * @param aftTransactionCategory - AFT transaction category (e.g., payroll, insurance)
 * @param aftTransactionType - AFT transaction type (e.g., payroll_deposit, insurance)
 * @param statement - Original statement text (typically the originator name)
 * @returns Formatted statement with all AFT metadata
 */
export function formatAftOriginalStatement(
  type: string | null | undefined,
  subType: string | null | undefined,
  aftTransactionCategory: string | null | undefined,
  aftTransactionType: string | null | undefined,
  statement: string,
): string {
  const typeStr = type || '';
  const subTypeStr = subType || '';
  const aftCategoryStr = aftTransactionCategory || '';
  const aftTypeStr = aftTransactionType || '';
  return `${typeStr}:${subTypeStr}:${aftCategoryStr}:${aftTypeStr}:${statement}`;
}

/**
 * Get account name from the cached Wealthsimple accounts list by account ID
 * Used for looking up opposing account names in internal transfers
 * @param accountId - Wealthsimple account ID
 * @returns Account nickname or 'Unknown Account' if not found
 */
export function getAccountNameById(accountId: string | null | undefined): string {
  if (!accountId) {
    return 'Unknown Account';
  }

  try {
    const accountsJson = GM_getValue(STORAGE.WEALTHSIMPLE_ACCOUNTS_LIST, '[]') as string;
    const accounts: WealthsimpleAccountEntry[] = JSON.parse(accountsJson);

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
 * @param accountType - Wealthsimple account type (e.g., 'CREDIT_CARD')
 * @returns Account nickname or null if not found
 */
export function getAccountNameByType(accountType: string | null | undefined): string | null {
  if (!accountType) {
    return null;
  }

  try {
    const accountsJson = GM_getValue(STORAGE.WEALTHSIMPLE_ACCOUNTS_LIST, '[]') as string;
    const accounts: WealthsimpleAccountEntry[] = JSON.parse(accountsJson);

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
const AFT_TYPE_CATEGORY_MAP: Record<string, string> = {
  payroll_deposit: 'Paychecks',
};

/**
 * Generate the category key for AFT transactions
 * Format: "type:subType:aftTransactionType:aftOriginatorName"
 * @param type - Transaction type (e.g., DEPOSIT, WITHDRAWAL)
 * @param subType - Transaction subType (e.g., AFT)
 * @param aftTransactionType - The AFT transaction type (e.g., payroll_deposit, insurance)
 * @param aftOriginatorName - The AFT originator name
 * @returns Category key for mapping
 */
export function getAftCategoryKey(
  type: string,
  subType: string,
  aftTransactionType: string | null | undefined,
  aftOriginatorName: string | null | undefined,
): string {
  const originator = aftOriginatorName || 'Unknown AFT';
  const aftType = aftTransactionType || '';

  return `${type}:${subType}:${aftType}:${originator}`;
}

/**
 * Get category for AFT transaction based on aftTransactionType
 * @param aftTransactionType - The AFT transaction type from Wealthsimple
 * @returns Monarch category name or null if needs mapping
 */
export function getAftCategory(aftTransactionType: string | null | undefined): string | null {
  if (!aftTransactionType) {
    return null;
  }
  return AFT_TYPE_CATEGORY_MAP[aftTransactionType] || null;
}

/**
 * Get display name for e-transfer participant
 * Falls back to email, then "Unknown" if both are missing
 * @param transaction - Raw transaction object
 * @returns Display name
 */
export function getETransferDisplayName(transaction: WealthsimpleTransaction): string {
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
 * @param statusSummary - Status summary data from FetchFundingIntentStatusSummary API
 * @returns Annotation text or empty string if not found
 */
export function extractStatusSummaryAnnotation(statusSummary: StatusSummary | null | undefined): string {
  if (!statusSummary) {
    return '';
  }

  return statusSummary.annotation || '';
}

/**
 * Extract Interac memo from funding intent data
 *
 * @deprecated As of 2026-03-06, the memo field in FetchFundingIntent.transferMetadata is no longer
 * populated by the Wealthsimple API. Use extractStatusSummaryAnnotation() instead.
 *
 * @param fundingIntent - Funding intent data from FetchFundingIntent API
 * @returns Memo text or empty string if not found
 */
export function extractInteracMemo(fundingIntent: FundingIntent | null | undefined): string {
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
 * @param fundingIntent - Funding intent data from FetchFundingIntent API
 * @returns Object with { autoDeposit, networkPaymentRefId }
 */
export function extractOutgoingETransferDetails(fundingIntent: FundingIntent | null | undefined): OutgoingETransferDetails {
  const result: OutgoingETransferDetails = {
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
 * @param details - Object from extractOutgoingETransferDetails
 * @returns Formatted string or empty if no details available
 */
export function formatOutgoingETransferDetails(details: OutgoingETransferDetails | null | undefined): string {
  if (!details) {
    return '';
  }

  const parts: string[] = [];

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
 * @param internalTransfer - Internal transfer data from FetchInternalTransfer API
 * @returns Annotation text or empty string if not found
 */
export function extractInternalTransferAnnotation(internalTransfer: InternalTransfer | null | undefined): string {
  if (!internalTransfer) {
    return '';
  }

  return internalTransfer.annotation || '';
}

/**
 * Extract annotation (user note) from funds transfer data
 * @param fundsTransfer - Funds transfer data from FetchFundsTransfer API
 * @returns Annotation text or empty string if not found
 */
export function extractFundsTransferAnnotation(fundsTransfer: FundsTransfer | null | undefined): string {
  if (!fundsTransfer) {
    return '';
  }

  return fundsTransfer.annotation || '';
}

/**
 * Get display name for external bank account
 * @param bankAccount - Bank account object from FetchFundsTransfer API
 * @returns Display name (nickname, accountNumber, or "Unknown Account")
 */
export function getExternalBankAccountDisplayName(bankAccount: BankAccount | null | undefined): string {
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