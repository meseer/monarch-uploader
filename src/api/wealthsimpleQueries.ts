/**
 * Wealthsimple API - Detailed Fetch Queries
 * GraphQL queries for funding, transfers, orders, securities, and more
 */

import { debugLog } from '../core/utils';
import { makeGraphQLQuery } from './wealthsimple';

//    Interfaces

export interface FundingIntentNode {
  id: string;
  state?: string;
  createdAt?: string;
  updatedAt?: string;
  transactionType?: string;
  fundableType?: string;
  transferMetadata?: {
    memo?: string;
    [key: string]: unknown;
  };
  transactionMetadata?: {
    memo?: string;
    recipientName?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface CreditCardAccountSummary {
  id: string;
  balance?: {
    current: number;
    [key: string]: unknown;
  };
  creditRegistrationStatus?: string;
  creditLimit?: number;
  currentCards?: Array<{
    id: string;
    cardNumberLast4Digits?: string;
    cardVariant?: string;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

export interface InternalTransferDetails {
  id?: string;
  amount?: number;
  currency?: string;
  status?: string;
  transferType?: string;
  annotation?: string;
  reason?: string;
  source_account?: { id: string; unifiedAccountType?: string };
  [key: string]: unknown;
}

export interface FundsTransferDetails {
  id?: string;
  status?: string;
  annotation?: string;
  source?: { bankAccount?: Record<string, unknown> };
  destination?: { bankAccount?: Record<string, unknown> };
  [key: string]: unknown;
}

export interface ActivityByOrderData {
  id?: string;
  quantity?: number;
  fxRate?: number;
  marketPrice?: { amount: number; currency: string };
  [key: string]: unknown;
}

export interface ExtendedOrderData {
  status?: string;
  orderType?: string;
  filledQuantity?: number;
  averageFilledPrice?: number;
  filledExchangeRate?: number;
  filledCommissionFee?: number;
  filledTotalFee?: number;
  optionMultiplier?: number;
  securityCurrency?: string;
  [key: string]: unknown;
}

export interface CorporateActionChildActivity {
  canonicalId?: string;
  activityCanonicalId?: string;
  assetName?: string;
  assetSymbol?: string;
  assetType?: string;
  entitlementType?: string;
  quantity?: number;
  currency?: string;
  price?: number;
  recordDate?: string;
  [key: string]: unknown;
}

export interface ShortOptionExpiryDetail {
  id?: string;
  decision?: string;
  reason?: string;
  fxRate?: number;
  securityCurrency?: string;
  deliverables?: Array<{ quantity: number; securityId: string }>;
  [key: string]: unknown;
}

export interface SecurityDetails {
  id?: string;
  currency?: string;
  securityType?: string;
  stock?: { name?: string; symbol?: string };
  [key: string]: unknown;
}

export interface ManagedPortfolioPosition {
  id?: string;
  allocation?: number;
  className?: string;
  currency?: string;
  description?: string;
  fee?: number;
  name?: string;
  performance?: number;
  symbol?: string;
  type?: string;
  value?: number;
  category?: string;
  quantity?: number;
  [key: string]: unknown;
}

export interface AccountCashBalances {
  cad: number | null;
  usd: number | null;
}

export interface SpendTransactionDetails {
  id: string;
  hasReward?: boolean;
  rewardAmount?: number;
  foreignAmount?: number;
  foreignCurrency?: string;
  foreignExchangeRate?: number;
  isForeign?: boolean;
  [key: string]: unknown;
}

export interface FundingIntentStatusSummaryData {
  id?: string;
  annotation?: string;
  activityFrequency?: string;
  isCancellable?: boolean;
  [key: string]: unknown;
}

export interface CryptoOrderDetails {
  id?: string;
  quantity?: number;
  executedQuantity?: number;
  price?: number;
  executedValue?: number;
  fee?: number;
  swapFee?: number;
  totalCost?: number;
  limitPrice?: number | null;
  currency?: string;
  filledAt?: string;
  timeInForce?: string;
  [key: string]: unknown;
}

//    Functions

/**
 * Fetch funding intent details for multiple transactions
 * Used to get additional transaction metadata like Interac transfer memos
 *
 * @param ids - Array of funding intent IDs (e.g., ["funding_intent-xxx", "funding_intent-yyy"])
 * @returns Map of funding intent ID to details
 */
export async function fetchFundingIntents(ids: string[]): Promise<Map<string, FundingIntentNode>> {
  try {
    if (!ids || ids.length === 0) {
      debugLog('No funding intent IDs provided');
      return new Map();
    }

    // Filter to only include funding_intent- prefixed IDs
    const validIds = ids.filter((id) => id && id.startsWith('funding_intent-'));

    if (validIds.length === 0) {
      debugLog('No valid funding_intent- IDs found');
      return new Map();
    }

    debugLog(`Fetching funding intents for ${validIds.length} ID(s)...`);

    const query = `query FetchFundingIntent($ids: [ID!], $identityId: ID, $state: [FundingIntentStateEnum!], $fundableType: [FundableTypeEnum!], $fundingMethodType: [FundingMethodTypeEnum!], $destination: [FundingPointInput!], $source: [FundingPointInput!], $first: Int, $cursor: String, $sortBy: FundingIntentSortByEnum, $sortOrder: SortOrder, $transactionType: [FundingIntentTransactionTypeEnum!], $createdInTheLast: ISO8601Duration) {
  searchFundingIntents: search_funding_intents(
    canonical_ids: $ids
    identity_id: $identityId
    state: $state
    destination: $destination
    source: $source
    fundable_type: $fundableType
    funding_method_type: $fundingMethodType
    sort_by: $sortBy
    sort_order: $sortOrder
    first: $first
    after: $cursor
    transaction_type: $transactionType
    created_in_the_last: $createdInTheLast
  ) {
    edges {
      node {
        ...FundingIntent
        __typename
      }
      __typename
    }
    pageInfo {
      hasNextPage
      endCursor
      __typename
    }
    __typename
  }
}

fragment FundingIntent on FundingIntent {
  id
  state
  idempotencyKey: idempotency_key
  createdAt: created_at
  updatedAt: updated_at
  externalReferenceId: external_reference_id
  fundableType: fundable_type
  transactionType: transaction_type
  fundableDetails: fundable_details {
    ...FundingIntentFundableWithdrawal
    ...FundingIntentFundableDeposit
    __typename
  }
  source {
    ...FundingPoint
    __typename
  }
  destination {
    ...FundingPoint
    __typename
  }
  postDated: post_dated
  transactionMetadata: transaction_metadata {
    ...FundingIntentETransferP2PTransactionMetadata
    ...FundingIntentBankDraftSendTransactionMetadata
    ...FundingIntentWireSendTransactionMetadata
    __typename
  }
  transferMetadata: transfer_metadata {
    ...FundingIntentETransferTransactionMetadata
    ...FundingIntentETransferReceiveMetadata
    ...FundingIntentETransferRequestTransactionMetadata
    ...WSBankAccountTransferMetadata
    __typename
  }
  transferMetadataV2 {
    ...BankDraftSendTransactionMetadata
    ...ChequeDepositTransactionMetadata
    ...WireSendTransactionMetadata
    __typename
  }
  userReferenceId: user_reference_id
  recurrence {
    ...FundingIntentRecurrence
    __typename
  }
  __typename
}

fragment BankDraftSendTransactionMetadata on BankDraftSendTransactionMetadata {
  amountExcludingFee
  fee
  totalAmount
  mailingAddress
  __typename
}

fragment FundingIntentFundableDeposit on FundingIntentDeposit {
  createdAt: created_at
  amount
  currency
  completedAt: completed_at
  provisionalCredit: provisional_credit {
    quantity
    __typename
  }
  __typename
}

fragment WSBankAccountTransferMetadata on WsBankAccountTransferMetadata {
  originatorName: originator_name
  transactionCode: transaction_code
  transactionType: transaction_type
  transactionCategory: transaction_category
  settlementDate: settlement_date
  __typename
}

fragment WireSendTransactionMetadata on WireSendTransactionMetadata {
  fee
  __typename
}

fragment FundingIntentETransferP2PTransactionMetadata on FundingIntentETransferP2PTransactionMetadata {
  recipientName: recipient_name
  recipientIdentifier: recipient_identifier
  autodeposit: autodeposit
  securityQuestion: security_question
  securityAnswer: security_answer
  memo: memo
  __typename
}

fragment FundingIntentETransferReceiveMetadata on FundingIntentETransferReceiveMetadata {
  memo
  paymentType
  recipient_email
  __typename
}

fragment FundingIntentETransferTransactionMetadata on FundingIntentETransferTransactionMetadata {
  autoDeposit: auto_deposit
  securityQuestion: security_question
  securityAnswer: security_answer
  recipientIdentifier: recipient_identifier
  networkPaymentRefId
  memo
  __typename
}

fragment FundingIntentETransferRequestTransactionMetadata on FundingIntentETransferRequestTransactionMetadata {
  sourceEmail: source_email
  sourceFinancialInstitution: source_financial_institution
  sourceName: source_name
  sourceProvider: source_provider
  sourceProviderStatus: source_provider_status
  sourceProviderStatusUpdatedAt: source_provider_status_updated_at
  lastErrorStatus: last_error_status
  lastErrorStatusUpdatedAt: last_error_status_updated_at
  __typename
}

fragment FundingIntentBankDraftSendTransactionMetadata on FundingIntentBankDraftSendTransactionMetadata {
  bankDraftReason
  bankDraftRecipient
  bankDraftDeliveryInstructions
  bankDraftDueDate
  shippingType
  bankDraftMailingAddress {
    apartment_number
    city
    country_code
    postal_code
    province_state
    street_address
    __typename
  }
  __typename
}

fragment FundingIntentWireSendTransactionMetadata on FundingIntentWireSendTransactionMetadata {
  beneficiary_account_number
  beneficiary_address {
    apartment_number
    city
    country_code
    postal_code
    province_state
    street_address
    __typename
  }
  beneficiary_bank {
    bic
    name
    routing_number
    __typename
  }
  beneficiary_name
  beneficiary_type
  wire_type
  memo
  reason
  fee
  amount_excluding_fee
  __typename
}

fragment ChequeDepositTransactionMetadata on ChequeDepositTransactionMetadata {
  rejectionReason
  estimatedCompletionAt
  state
  __typename
}

fragment FundingIntentFundableWithdrawal on FundingIntentWithdrawal {
  requestedAmountValue: requested_amount_value
  requestedAmountUnit: requested_amount_unit
  finalAmount: final_amount {
    ...Money
    __typename
  }
  notifiedCustodianAt: notified_custodian_at
  completedAt: completed_at
  taxWithholding: tax_withholding {
    ...TaxWithholding
    __typename
  }
  __typename
}

fragment Money on Money {
  amount
  cents
  currency
  __typename
}

fragment TaxWithholding on TaxWithholding {
  id
  netAmount: net_amount
  __typename
}

fragment FundingIntentRecurrence on FundingIntentRecurrence {
  id
  every
  interval
  next
  latestFundingIntentId
  __typename
}

fragment FundingPoint on FundingPoint {
  id
  type
  __typename
}`;

    const variables = {
      ids: validIds,
      first: 100, // Should be enough for most batches
    };

    const response = await makeGraphQLQuery('FetchFundingIntent', query, variables);

    if (!response || !response.searchFundingIntents) {
      debugLog('No searchFundingIntents in response');
      return new Map();
    }

    const { edges, pageInfo } = response.searchFundingIntents;

    // Build map of ID to funding intent details
    const fundingIntentMap = new Map<string, FundingIntentNode>();

    if (edges && Array.isArray(edges)) {
      edges.forEach((edge) => {
        if (edge.node && edge.node.id) {
          fundingIntentMap.set(edge.node.id, edge.node);
        }
      });
    }

    debugLog(`Fetched ${fundingIntentMap.size} funding intent(s)`);

    // Handle pagination if needed (unlikely for typical batch sizes)
    if (pageInfo?.hasNextPage) {
      debugLog('Warning: More funding intents available but pagination not implemented');
    }

    return fundingIntentMap;
  } catch (error) {
    debugLog('Error fetching funding intents:', error);
    // Return empty map on error - don't fail the entire sync
    return new Map();
  }
}

/**
 * Fetch credit card account summary from Wealthsimple
 * Returns credit limit, current balance, and card details
 * @param accountId - Credit card account ID (e.g., 'ca-credit-card-FYPcSZJeLA')
 * @returns Credit card account summary
 */
export async function fetchCreditCardAccountSummary(accountId: string): Promise<CreditCardAccountSummary> {
  try {
    if (!accountId) {
      throw new Error('Account ID is required');
    }

    debugLog(`Fetching credit card account summary for ${accountId}...`);

    const query = `query FetchCreditCardAccountSummary($id: ID!) {
  creditCardAccount(id: $id) {
    ...CreditCardAccountSummary
    __typename
  }
}

fragment CreditCardAccountSummary on CreditCardAccount {
  id
  balance {
    current
    __typename
  }
  creditRegistrationStatus
  creditLimit
  currentCards {
    id
    cardNumberLast4Digits
    cardVariant
    __typename
  }
  __typename
}`;

    const response = await makeGraphQLQuery('FetchCreditCardAccountSummary', query, { id: accountId });

    if (!response || !response.creditCardAccount) {
      throw new Error('No credit card account data in response');
    }

    const accountSummary = response.creditCardAccount;
    debugLog(`Fetched credit card summary for ${accountId}:`, {
      creditLimit: accountSummary.creditLimit,
      currentBalance: accountSummary.balance?.current,
      registrationStatus: accountSummary.creditRegistrationStatus,
    });

    return accountSummary;
  } catch (error) {
    debugLog(`Error fetching credit card account summary for ${accountId}:`, error);
    throw error;
  }
}

/**
 * Fetch internal transfer details for a single transfer
 * Used to get the annotation (user note) for internal transfers between Wealthsimple accounts
 *
 * @param id - Internal transfer ID (e.g., "funding_intent-RHgNxU9iOg99IbPmQwSErvXLL0n")
 * @returns Internal transfer details or null if not found
 */
export async function fetchInternalTransfer(id: string): Promise<InternalTransferDetails | null> {
  try {
    if (!id) {
      debugLog('No internal transfer ID provided');
      return null;
    }

    debugLog(`Fetching internal transfer details for ${id}...`);

    const query = `query FetchInternalTransfer($id: ID!) {
  internalTransfer: internal_transfer(id: $id) {
    id
    ...InternalTransfer
    __typename
  }
}

fragment InternalTransfer on InternalTransfer {
  amount
  currency
  fxRate: fx_rate
  fxAdjustedAmount: fx_adjusted_amount
  reportedFxAdjustedAmount: reported_fx_adjusted_amount {
    amount
    currency
    __typename
  }
  fxFeeRate: conversion_fee_rate
  isCancellable: is_cancellable
  status
  transferType: transfer_type
  instantEligibility: instant_eligibility {
    status
    amount
    __typename
  }
  source_account {
    id
    unifiedAccountType
    __typename
  }
  tax_detail {
    id
    federal_tax_amount
    provincial_tax_amount
    gross_amount
    net_amount
    document_url
    __typename
  }
  annotation
  reason
  __typename
}`;

    const response = await makeGraphQLQuery('FetchInternalTransfer', query, { id });

    if (!response || !response.internalTransfer) {
      debugLog(`No internal transfer data found for ${id}`);
      return null;
    }

    debugLog(`Fetched internal transfer ${id}:`, {
      status: response.internalTransfer.status,
      transferType: response.internalTransfer.transferType,
      hasAnnotation: Boolean(response.internalTransfer.annotation),
    });

    return response.internalTransfer;
  } catch (error) {
    debugLog(`Error fetching internal transfer ${id}:`, error);
    // Return null on error - don't fail the entire sync
    return null;
  }
}

/**
 * Fetch funds transfer details for a single transfer
 * Used to get transaction details for EFT transactions, including:
 * - annotation: User note on the transfer
 * - source/destination bank account details (institutionName, nickname, accountNumber, currency)
 *
 * @param id - Funds transfer ID (e.g., "funding_intent-OJbdrSdcFlCIPm3hagqmOM0sNhV")
 * @returns Funds transfer details or null if not found
 */
export async function fetchFundsTransfer(id: string): Promise<FundsTransferDetails | null> {
  try {
    if (!id) {
      debugLog('No funds transfer ID provided');
      return null;
    }

    debugLog(`Fetching funds transfer details for ${id}...`);

    const query = `query FetchFundsTransfer($id: ID!) {
  fundsTransfer: funds_transfer(id: $id, include_cancelled: true) {
    ...FundsTransfer
    __typename
  }
}

fragment FundsTransfer on FundsTransfer {
  id
  status
  cancellable
  annotation
  rejectReason: reject_reason
  schedule {
    id
    is_skippable
    recurrence {
      events(first: 3)
      __typename
    }
    __typename
  }
  source {
    ...BankAccountOwner
    ...Account
    __typename
  }
  destination {
    ...BankAccountOwner
    __typename
  }
  ... on Withdrawal {
    reason
    tax_detail {
      id
      federal_tax_amount
      provincial_tax_amount
      gross_amount
      net_amount
      document_url
      __typename
    }
    __typename
  }
  __typename
}

fragment BankAccountOwner on BankAccountOwner {
  bankAccount: bank_account {
    ...BankAccount
    __typename
  }
  __typename
}

fragment BankAccount on BankAccount {
  id
  accountName: account_name
  corporate
  createdAt: created_at
  currency
  institutionName: institution_name
  jurisdiction
  nickname
  type
  updatedAt: updated_at
  verificationDocuments: verification_documents {
    ...BankVerificationDocument
    __typename
  }
  verifications {
    ...BankAccountVerification
    __typename
  }
  ...CaBankAccount
  ...UsBankAccount
  __typename
}

fragment CaBankAccount on CaBankAccount {
  accountName: account_name
  accountNumber: account_number
  __typename
}

fragment UsBankAccount on UsBankAccount {
  accountName: account_name
  accountNumber: account_number
  __typename
}

fragment BankVerificationDocument on VerificationDocument {
  id
  acceptable
  updatedAt: updated_at
  createdAt: created_at
  documentId: document_id
  documentType: document_type
  rejectReason: reject_reason
  reviewedAt: reviewed_at
  reviewedBy: reviewed_by
  __typename
}

fragment BankAccountVerification on BankAccountVerification {
  custodianProcessedAt: custodian_processed_at
  custodianStatus: custodian_status
  document {
    ...BankVerificationDocument
    __typename
  }
  __typename
}

fragment Account on Account {
  ...AccountCore
  custodianAccounts {
    ...CustodianAccount
    __typename
  }
  __typename
}

fragment AccountCore on Account {
  id
  archivedAt
  branch
  closedAt
  createdAt
  cacheExpiredAt
  currency
  requiredIdentityVerification
  unifiedAccountType
  supportedCurrencies
  compatibleCurrencies
  nickname
  status
  applicationFamilyId
  accountOwnerConfiguration
  accountFeatures {
    ...AccountFeature
    __typename
  }
  accountOwners {
    ...AccountOwner
    __typename
  }
  accountEntityRelationships {
    ...AccountEntityRelationship
    __typename
  }
  accountUpgradeProcesses {
    ...AccountUpgradeProcess
    __typename
  }
  type
  __typename
}

fragment AccountFeature on AccountFeature {
  name
  enabled
  functional
  firstEnabledOn
  __typename
}

fragment AccountOwner on AccountOwner {
  accountId
  identityId
  accountNickname
  clientCanonicalId
  accountOpeningAgreementsSigned
  name
  email
  ownershipType
  activeInvitation {
    ...AccountOwnerInvitation
    __typename
  }
  sentInvitations {
    ...AccountOwnerInvitation
    __typename
  }
  __typename
}

fragment AccountOwnerInvitation on AccountOwnerInvitation {
  id
  createdAt
  inviteeName
  inviteeEmail
  inviterName
  inviterEmail
  updatedAt
  sentAt
  status
  __typename
}

fragment AccountEntityRelationship on AccountEntityRelationship {
  accountCanonicalId
  entityCanonicalId
  entityOwnershipType
  entityType
  __typename
}

fragment AccountUpgradeProcess on AccountUpgradeProcess {
  canonicalId
  status
  targetAccountType
  __typename
}

fragment CustodianAccount on CustodianAccount {
  id
  branch
  custodian
  status
  updatedAt
  __typename
}`;

    const response = await makeGraphQLQuery('FetchFundsTransfer', query, { id });

    // Log full response at debug level for troubleshooting
    debugLog(`Full FetchFundsTransfer response for ${id}:`, response);

    if (!response || !response.fundsTransfer) {
      debugLog(`No funds transfer data found for ${id}`);
      return null;
    }

    const fundsTransfer: FundsTransferDetails = response.fundsTransfer;
    debugLog(`Fetched funds transfer ${id}:`, {
      status: fundsTransfer.status,
      hasAnnotation: Boolean(fundsTransfer.annotation),
      hasSourceBankAccount: Boolean(fundsTransfer.source?.bankAccount),
      hasDestinationBankAccount: Boolean(fundsTransfer.destination?.bankAccount),
    });

    return fundsTransfer;
  } catch (error) {
    debugLog(`Error fetching funds transfer ${id}:`, error);
    // Return null on error - don't fail the entire sync
    return null;
  }
}

/**
 * Fetch activity by Orders Service order ID
 * Used for MANAGED_BUY and MANAGED_SELL transactions with order IDs prefixed with "order-"
 * These orders cannot be fetched via FetchSoOrdersExtendedOrder
 *
 * @param accountId - Wealthsimple account ID (e.g., "resp-gjp2y-3a")
 * @param ordersServiceOrderId - Order ID (e.g., "order-00YDx9aoiwh1")
 * @returns Activity data or null if not found
 */
export async function fetchActivityByOrdersServiceOrderId(accountId: string, ordersServiceOrderId: string): Promise<ActivityByOrderData | null> {
  try {
    if (!accountId) {
      debugLog('No account ID provided for fetchActivityByOrdersServiceOrderId');
      return null;
    }

    if (!ordersServiceOrderId) {
      debugLog('No order ID provided for fetchActivityByOrdersServiceOrderId');
      return null;
    }

    debugLog(`Fetching activity by orders service order ID: ${ordersServiceOrderId} for account ${accountId}...`);

    const query = `query FetchActivityByOrdersServiceOrderId($id: ID!, $ordersServiceOrderId: ID!) {
  account(id: $id) {
    id
    activityByOrdersServiceOrderId(id: $ordersServiceOrderId) {
      ...ActivityByOrdersServiceOrderId
      __typename
    }
    __typename
  }
}

fragment ActivityByOrdersServiceOrderId on PaginatedActivity {
  id
  quantity
  fxRate: fx_rate
  marketPrice: market_price {
    amount
    currency
    __typename
  }
  __typename
}`;

    const response = await makeGraphQLQuery('FetchActivityByOrdersServiceOrderId', query, {
      id: accountId,
      ordersServiceOrderId,
    });

    if (!response || !response.account || !response.account.activityByOrdersServiceOrderId) {
      debugLog(`No activity data found for order ${ordersServiceOrderId}`);
      return null;
    }

    const activityData = response.account.activityByOrdersServiceOrderId;
    debugLog(`Fetched activity for order ${ordersServiceOrderId}:`, {
      quantity: activityData.quantity,
      fxRate: activityData.fxRate,
      marketPrice: activityData.marketPrice,
    });

    return activityData;
  } catch (error) {
    debugLog(`Error fetching activity by orders service order ID ${ordersServiceOrderId}:`, error);
    // Return null on error - don't fail the entire sync
    return null;
  }
}

/**
 * Fetch extended order details for a stock/options order
 * Used to get detailed fill information, fees, exchange rates, and timestamps for orders
 *
 * @param externalId - Order ID (e.g., "order-3f73016b-5af3-4f03-ba22-9ef5e45fbb3d")
 * @returns Extended order details or null if not found
 */
export async function fetchExtendedOrder(externalId: string): Promise<ExtendedOrderData | null> {
  try {
    if (!externalId) {
      debugLog('No external ID provided for extended order fetch');
      return null;
    }

    // Branch ID is always "TR" for trade orders
    const branchId = 'TR';

    debugLog(`Fetching extended order details for ${externalId}...`);

    const query = `query FetchSoOrdersExtendedOrder($branchId: String!, $externalId: String!) {
  soOrdersExtendedOrder(branchId: $branchId, externalId: $externalId) {
    ...SoOrdersExtendedOrder
    __typename
  }
}

fragment SoOrdersExtendedOrder on SoOrders_ExtendedOrderResponse {
  averageFilledPrice
  filledExchangeRate
  filledQuantity
  filledCommissionFee
  filledTotalFee
  firstFilledAtUtc
  lastFilledAtUtc
  limitPrice
  openClose
  orderType
  optionMultiplier
  rejectionCause
  rejectionCode
  securityCurrency
  status
  stopPrice
  submittedAtUtc
  submittedExchangeRate
  submittedNetValue
  submittedQuantity
  submittedTotalFee
  timeInForce
  accountId
  canonicalAccountId
  cancellationCutoff
  tradingSession
  expiredAtUtc
  __typename
}`;

    const response = await makeGraphQLQuery('FetchSoOrdersExtendedOrder', query, {
      branchId,
      externalId,
    });

    if (!response || !response.soOrdersExtendedOrder) {
      debugLog(`No extended order data found for ${externalId}`);
      return null;
    }

    const extendedOrder: ExtendedOrderData = response.soOrdersExtendedOrder;
    debugLog(`Fetched extended order ${externalId}:`, {
      status: extendedOrder.status,
      orderType: extendedOrder.orderType,
      filledQuantity: extendedOrder.filledQuantity,
      averageFilledPrice: extendedOrder.averageFilledPrice,
      hasOptionMultiplier: Boolean(extendedOrder.optionMultiplier),
    });

    return extendedOrder;
  } catch (error) {
    debugLog(`Error fetching extended order ${externalId}:`, error);
    // Return null on error - don't fail the entire sync
    return null;
  }
}

/**
 * Fetch corporate action child activities for a corporate action transaction
 * Used to get details about stock splits, consolidations, mergers, and other corporate actions
 *
 * @param activityCanonicalId - Corporate action activity canonical ID
 * @returns Array of child activity nodes
 */
export async function fetchCorporateActionChildActivities(activityCanonicalId: string): Promise<CorporateActionChildActivity[]> {
  try {
    if (!activityCanonicalId) {
      debugLog('No activity canonical ID provided for corporate action fetch');
      return [];
    }

    debugLog(`Fetching corporate action child activities for ${activityCanonicalId}...`);

    const query = `query FetchCorporateActionChildActivities($activityCanonicalId: String!) {
  corporateActionChildActivities(
    condition: {activityCanonicalId: $activityCanonicalId}
  ) {
    nodes {
      ...CorporateActionChildActivity
      __typename
    }
    __typename
  }
}

fragment CorporateActionChildActivity on CorporateActionChildActivity {
  canonicalId
  activityCanonicalId
  assetName
  assetSymbol
  assetType
  entitlementType
  quantity
  currency
  price
  recordDate
  __typename
}`;

    const response = await makeGraphQLQuery('FetchCorporateActionChildActivities', query, {
      activityCanonicalId,
    });

    if (!response || !response.corporateActionChildActivities) {
      debugLog(`No corporate action child activities data found for ${activityCanonicalId}`);
      return [];
    }

    const childActivities: CorporateActionChildActivity[] = response.corporateActionChildActivities.nodes || [];
    debugLog(`Fetched ${childActivities.length} corporate action child activities for ${activityCanonicalId}:`, {
      activities: childActivities.map((a) => ({
        entitlementType: a.entitlementType,
        quantity: a.quantity,
        assetSymbol: a.assetSymbol,
      })),
    });

    return childActivities;
  } catch (error) {
    debugLog(`Error fetching corporate action child activities for ${activityCanonicalId}:`, error);
    // Return empty array on error - don't fail the entire sync
    return [];
  }
}

/**
 * Fetch short option position expiry details
 * Used to get details about expired/expiring short option positions
 *
 * @param id - Short option position expiry detail ID
 * @returns Short option expiry details or null if not found
 */
export async function fetchShortOptionPositionExpiryDetail(id: string): Promise<ShortOptionExpiryDetail | null> {
  try {
    if (!id) {
      debugLog('No short option position expiry detail ID provided');
      return null;
    }

    debugLog(`Fetching short option position expiry detail for ${id}...`);

    const query = `query FetchShortOptionPositionExpiryDetail($id: ID!) {
  shortOptionPositionExpiryDetail(id: $id) {
    id
    ...ShortOptionPositionExpiryDetail
    __typename
  }
}

fragment ShortOptionPositionExpiryDetail on ShortPositionExpiryDetail {
  id
  decision
  reason
  fxRate
  custodianAccountId
  deliverables {
    quantity
    securityId
    __typename
  }
  securityCurrency
  __typename
}`;

    const response = await makeGraphQLQuery('FetchShortOptionPositionExpiryDetail', query, { id });

    if (!response || !response.shortOptionPositionExpiryDetail) {
      debugLog(`No short option position expiry detail data found for ${id}`);
      return null;
    }

    const expiryDetail: ShortOptionExpiryDetail = response.shortOptionPositionExpiryDetail;
    debugLog(`Fetched short option position expiry detail ${id}:`, {
      decision: expiryDetail.decision,
      reason: expiryDetail.reason,
      fxRate: expiryDetail.fxRate,
      securityCurrency: expiryDetail.securityCurrency,
      deliverablesCount: expiryDetail.deliverables?.length || 0,
    });

    return expiryDetail;
  } catch (error) {
    debugLog(`Error fetching short option position expiry detail ${id}:`, error);
    // Return null on error - don't fail the entire sync
    return null;
  }
}

/**
 * Fetch security details by security ID
 * Used to look up security names for deliverables in short option expiry details
 *
 * @param securityId - Security ID (e.g., "sec-o-977d51d56c9a40e58ead71785a412b3d")
 * @returns Security details or null if not found
 */
export async function fetchSecurity(securityId: string): Promise<SecurityDetails | null> {
  try {
    if (!securityId) {
      debugLog('No security ID provided');
      return null;
    }

    debugLog(`Fetching security details for ${securityId}...`);

    const query = `query FetchSecurity($securityId: ID!) {
  security(id: $securityId) {
    id
    currency
    securityType
    stock {
      name
      symbol
      __typename
    }
    __typename
  }
}`;

    const response = await makeGraphQLQuery('FetchSecurity', query, { securityId });

    if (!response || !response.security) {
      debugLog(`No security data found for ${securityId}`);
      return null;
    }

    const security: SecurityDetails = response.security;
    debugLog(`Fetched security ${securityId}:`, {
      symbol: security.stock?.symbol,
      name: security.stock?.name,
      currency: security.currency,
      securityType: security.securityType,
    });

    return security;
  } catch (error) {
    debugLog(`Error fetching security ${securityId}:`, error);
    // Return null on error - don't fail the entire sync
    return null;
  }
}

/**
 * Fetch positions for a managed portfolio account using FetchAccountManagedPortfolioPositions
 * This API is used for MANAGED_* account types which have a different data structure
 * @param accountId - Wealthsimple account ID
 * @returns Array of position objects with full details from the API
 */
export async function fetchManagedPortfolioPositions(accountId: string): Promise<ManagedPortfolioPosition[]> {
  try {
    if (!accountId) {
      throw new Error('Account ID is required');
    }

    debugLog(`Fetching managed portfolio positions for account ${accountId}...`);

    // Use exact query as provided by Wealthsimple API
    const query = `query FetchAccountManagedPortfolioPositions($accountId: ID!) {
  account(id: $accountId) {
    id
    positions {
      ...ManagedPortfolioPosition
      __typename
    }
    __typename
  }
}

fragment ManagedPortfolioPosition on Position {
  id
  allocation
  className: class_name
  currency
  description
  fee
  name
  performance
  symbol
  type
  value
  category
  quantity
  __typename
}`;

    const variables = {
      accountId,
    };

    const response = await makeGraphQLQuery('FetchAccountManagedPortfolioPositions', query, variables);

    if (!response || !response.account || !response.account.positions) {
      debugLog('No positions data in managed portfolio response');
      return [];
    }

    const positions: ManagedPortfolioPosition[] = response.account.positions;
    debugLog(`Fetched ${positions.length} managed portfolio positions for account ${accountId}`);

    return positions;
  } catch (error) {
    debugLog(`Error fetching managed portfolio positions for account ${accountId}:`, error);
    throw error;
  }
}

/**
 * Fetch cash balances for investment accounts using FetchAccountsWithBalance
 * Returns CAD and USD cash balances from the account's custodian financials
 *
 * @param accountIds - Array of Wealthsimple account IDs
 * @returns Object mapping accountId to cash balances { cad, usd }
 */
export async function fetchAccountsWithBalance(accountIds: string[]): Promise<Record<string, AccountCashBalances>> {
  try {
    if (!accountIds || accountIds.length === 0) {
      debugLog('No account IDs provided for cash balance fetch');
      return {};
    }

    debugLog(`Fetching cash balances for ${accountIds.length} account(s)...`);

    // Security IDs for cash positions
    const CASH_SECURITY_IDS = {
      CAD: 'sec-c-cad',
      USD: 'sec-c-usd',
    };

    // Use the exact query provided by Wealthsimple API
    const query = `query FetchAccountsWithBalance($ids: [String!]!, $type: BalanceType!) {
  accounts(ids: $ids) {
    ...AccountWithBalance
    __typename
  }
}

fragment AccountWithBalance on Account {
  id
  custodianAccounts {
    id
    financials {
      ... on CustodianAccountFinancialsSo {
        balance(type: $type) {
          ...Balance
          __typename
        }
        __typename
      }
      __typename
    }
    __typename
  }
  __typename
}

fragment Balance on Balance {
  quantity
  securityId
  __typename
}`;

    const variables = {
      ids: accountIds,
      type: 'TRADING',
    };

    const response = await makeGraphQLQuery('FetchAccountsWithBalance', query, variables);

    if (!response || !response.accounts) {
      debugLog('No accounts data in FetchAccountsWithBalance response');
      return {};
    }

    // Process response to extract CAD and USD cash balances
    const result: Record<string, AccountCashBalances> = {};

    for (const account of response.accounts) {
      const accountId = account.id;
      let cadBalance = null;
      let usdBalance = null;

      // Process all custodian accounts (usually just one)
      if (account.custodianAccounts && Array.isArray(account.custodianAccounts)) {
        for (const custodianAccount of account.custodianAccounts) {
          const balances = custodianAccount.financials?.balance;

          if (balances && Array.isArray(balances)) {
            for (const balance of balances) {
              if (balance.securityId === CASH_SECURITY_IDS.CAD) {
                cadBalance = parseFloat(balance.quantity) || 0;
              } else if (balance.securityId === CASH_SECURITY_IDS.USD) {
                usdBalance = parseFloat(balance.quantity) || 0;
              }
            }
          }
        }
      }

      result[accountId] = {
        cad: cadBalance,
        usd: usdBalance,
      };

      debugLog(`Cash balances for ${accountId}: CAD=${cadBalance}, USD=${usdBalance}`);
    }

    return result;
  } catch (error) {
    debugLog('Error fetching accounts with balance:', error);
    throw error;
  }
}

/**
 * Fetch spend transaction details for multiple transactions
 * Used to get foreign currency exchange details and reward information for CASH and CREDIT_CARD transactions
 *
 * @param accountId - Wealthsimple account ID
 * @param transactionIds - Array of transaction IDs to fetch details for
 * @returns Map of transaction ID to spend details
 */
export async function fetchSpendTransactions(accountId: string, transactionIds: string[]): Promise<Map<string, SpendTransactionDetails>> {
  try {
    if (!accountId) {
      debugLog('No account ID provided for fetchSpendTransactions');
      return new Map();
    }

    if (!transactionIds || transactionIds.length === 0) {
      debugLog('No transaction IDs provided for fetchSpendTransactions');
      return new Map();
    }

    debugLog(`Fetching spend transaction details for ${transactionIds.length} transaction(s) in account ${accountId}...`);

    const query = `query FetchSpendTransactions($transactionIds: [String!], $accountId: String!, $cursor: String) {
  spendTransactions(
    transactionIds: $transactionIds
    accountId: $accountId
    after: $cursor
  ) {
    edges {
      node {
        ...SpendTransaction
        __typename
      }
      __typename
    }
    pageInfo {
      hasNextPage
      endCursor
      __typename
    }
    __typename
  }
}

fragment SpendTransaction on SpendTransaction {
  id
  hasReward
  rewardAmount
  rewardPayoutType
  rewardPayoutSecurityId
  rewardPayoutCustodianAccountId
  foreignAmount
  foreignCurrency
  foreignExchangeRate
  isForeign
  roundupAmount
  roundupTotal
  __typename
}`;

    const variables = {
      accountId,
      transactionIds,
    };

    const response = await makeGraphQLQuery('FetchSpendTransactions', query, variables);

    if (!response || !response.spendTransactions) {
      debugLog('No spendTransactions in response');
      return new Map();
    }

    const { edges, pageInfo } = response.spendTransactions;

    // Build map of ID to spend transaction details
    const spendTransactionMap = new Map<string, SpendTransactionDetails>();

    if (edges && Array.isArray(edges)) {
      edges.forEach((edge) => {
        if (edge.node && edge.node.id) {
          spendTransactionMap.set(edge.node.id, edge.node);
          debugLog(`Fetched spend details for transaction ${edge.node.id}:`, {
            isForeign: edge.node.isForeign,
            foreignCurrency: edge.node.foreignCurrency,
            hasReward: edge.node.hasReward,
            rewardAmount: edge.node.rewardAmount,
          });
        }
      });
    }

    debugLog(`Fetched ${spendTransactionMap.size} spend transaction detail(s)`);

    // Handle pagination if needed (unlikely for typical batch sizes)
    if (pageInfo?.hasNextPage) {
      debugLog('Warning: More spend transactions available but pagination not implemented');
    }

    return spendTransactionMap;
  } catch (error) {
    debugLog('Error fetching spend transactions:', error);
    // Return empty map on error - don't fail the entire sync
    return new Map();
  }
}

/**
 * Fetch funding intent status summary for a single funding intent
 * Used to get the annotation (user note/message) for funding intent transactions.
 *
 * @param fundingIntentId - Funding intent ID (e.g., "funding_intent-XlVAMs38eHXAMyBguEFOdMArAKZ")
 * @returns Status summary object or null if not found
 */
export async function fetchFundingIntentStatusSummary(fundingIntentId: string): Promise<FundingIntentStatusSummaryData | null> {
  try {
    if (!fundingIntentId) {
      debugLog('No funding intent ID provided for fetchFundingIntentStatusSummary');
      return null;
    }

    debugLog(`Fetching funding intent status summary for ${fundingIntentId}...`);

    const query = `query FetchFundingIntentStatusSummary($fundingIntentId: ID!, $returnScheduledStatus: Boolean, $timelineVersion: Int) {
  fundingIntentStatusSummary: funding_intent_status_summary(
    funding_intent_id: $fundingIntentId
    return_scheduled_status: $returnScheduledStatus
    timeline_version: $timelineVersion
  ) {
    ...FundingIntentStatusSummary
    __typename
  }
}

fragment FundingIntentStatusSummary on FundingIntentStatusSummary {
  id
  postDated
  estimatedCompletionDate
  actorIdentityId
  activityFrequency
  sourceFundingPoint {
    fundingPointId
    fundingPointType
    fundingPointSubType
    __typename
  }
  destinationFundingPoint {
    fundingPointId
    fundingPointType
    fundingPointSubType
    __typename
  }
  details {
    ...FundingIntentStatusSummaryDepositDetails
    ...FundingIntentStatusSummaryInternalTransferDetails
    __typename
  }
  isCancellable: is_cancellable
  unsuccessfulRequirementFailureCodes
  annotation
  contributionDate
  transactionTypeActivityDetails {
    ...FundingIntentStatusSummaryEftDepositActivityDetails
    ...FundingIntentStatusSummaryEftWithdrawalActivityDetails
    ...FundingIntentStatusSummaryChequeDepositActivityDetails
    __typename
  }
  timeline {
    ... on TimelineEventActionRequired {
      occurredAt
      actionRequiredReason: reason
      __typename
    }
    ... on TimelineEventAssetsSold {
      occurredAt
      __typename
    }
    ... on TimelineEventCancelled {
      occurredAt
      nextRecurringDate
      __typename
    }
    ... on TimelineEventCompleted {
      occurredAt
      estimatedOccurrenceDate
      __typename
    }
    ... on TimelineEventDeclined {
      occurredAt
      __typename
    }
    ... on TimelineEventExpired {
      occurredAt
      __typename
    }
    ... on TimelineEventFailed {
      occurredAt
      __typename
    }
    ... on TimelineEventInstantAmountApplied {
      occurredAt
      __typename
    }
    ... on TimelineEventMoneyMoved {
      occurredAt
      __typename
    }
    ... on TimelineEventProcessed {
      occurredAt
      __typename
    }
    ... on TimelineEventReceivedFunds {
      occurredAt
      __typename
    }
    ... on TimelineEventRejected {
      occurredAt
      rejectedReason: reason
      __typename
    }
    ... on TimelineEventRequestAccepted {
      occurredAt
      __typename
    }
    ... on TimelineEventReversed {
      occurredAt
      reversedReason: reason
      __typename
    }
    ... on TimelineEventReviewed {
      occurredAt
      __typename
    }
    ... on TimelineEventScheduled {
      occurredAt
      __typename
    }
    ... on TimelineEventSubmitted {
      occurredAt
      estimatedOccurrenceDate
      __typename
    }
    __typename
  }
  __typename
}

fragment Money on Money {
  amount
  cents
  currency
  __typename
}

fragment FundingIntentStatusSummaryDepositDetails on FundingIntentStatusSummaryDepositDetails {
  provisionalCreditAmount {
    ...Money
    __typename
  }
  totalAmount {
    ...Money
    __typename
  }
  __typename
}

fragment FundingIntentStatusSummaryInternalTransferDetails on FundingIntentStatusSummaryInternalTransferDetails {
  destinationAccountFundsAvailable: destination_account_funds_available {
    ...Money
    __typename
  }
  __typename
}

fragment FundingIntentStatusSummaryEftDepositActivityDetails on EftDepositActivityDetails {
  institutionShortName
  lastBankAccountNumberDigits
  unsuccessfulFundingIntentCallToAction
  __typename
}

fragment FundingIntentStatusSummaryEftWithdrawalActivityDetails on EftWithdrawalActivityDetails {
  institutionShortName
  lastBankAccountNumberDigits
  __typename
}

fragment FundingIntentStatusSummaryChequeDepositActivityDetails on ChequeDepositActivityDetails {
  rejectionReason
  failureDetails {
    failureCode
    title
    description
    ctaLabel
    closeFlowCtaLabel
    suggestions
    __typename
  }
  __typename
}`;

    const variables = {
      fundingIntentId,
      timelineVersion: 2,
    };

    const response = await makeGraphQLQuery('FetchFundingIntentStatusSummary', query, variables);

    if (!response || !response.fundingIntentStatusSummary) {
      debugLog(`No funding intent status summary data found for ${fundingIntentId}`);
      return null;
    }

    const statusSummary: FundingIntentStatusSummaryData = response.fundingIntentStatusSummary;
    debugLog(`Fetched funding intent status summary ${fundingIntentId}:`, {
      hasAnnotation: Boolean(statusSummary.annotation),
      activityFrequency: statusSummary.activityFrequency,
      isCancellable: statusSummary.isCancellable,
    });

    return statusSummary;
  } catch (error) {
    debugLog(`Error fetching funding intent status summary ${fundingIntentId}:`, error);
    // Return null on error - don't fail the entire sync
    return null;
  }
}

/**
 * Fetch crypto order details for a single crypto buy/sell order
 * Used to get detailed fill information, fees, and pricing for crypto orders
 *
 * @param id - Crypto order ID (e.g., "order-sqXS6HQQ0uJra3R7W9Zof2GgGRJ")
 * @returns Crypto order details or null if not found
 */
export async function fetchCryptoOrder(id: string): Promise<CryptoOrderDetails | null> {
  try {
    if (!id) {
      debugLog('No crypto order ID provided');
      return null;
    }

    debugLog(`Fetching crypto order details for ${id}...`);

    const query = `query FetchCryptoOrder($id: ID!) {
  cryptoOrder(id: $id) {
    ...CryptoOrder
    __typename
  }
}

fragment CryptoOrder on Crypto_Order {
  id
  createdAt
  quantity
  price
  currency
  limitPrice
  filledAt
  timeInForce
  fee
  totalCost
  executedQuantity
  executedValue
  swapFee
  isModifiable
  commissionBps
  category
  __typename
}`;

    const response = await makeGraphQLQuery('FetchCryptoOrder', query, { id });

    if (!response || !response.cryptoOrder) {
      debugLog(`No crypto order data found for ${id}`);
      return null;
    }

    const cryptoOrder: CryptoOrderDetails = response.cryptoOrder;
    debugLog(`Fetched crypto order ${id}:`, {
      quantity: cryptoOrder.quantity,
      executedQuantity: cryptoOrder.executedQuantity,
      price: cryptoOrder.price,
      fee: cryptoOrder.fee,
      swapFee: cryptoOrder.swapFee,
      totalCost: cryptoOrder.totalCost,
      limitPrice: cryptoOrder.limitPrice,
      currency: cryptoOrder.currency,
    });

    return cryptoOrder;
  } catch (error) {
    debugLog(`Error fetching crypto order ${id}:`, error);
    // Return null on error - don't fail the entire sync
    return null;
  }
}

