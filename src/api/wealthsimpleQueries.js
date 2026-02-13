/**
 * Wealthsimple API - Detailed Fetch Queries
 * GraphQL queries for funding, transfers, orders, securities, and more
 */

import { debugLog } from '../core/utils';
import { makeGraphQLQuery } from './wealthsimple';

/**
 * Fetch funding intent details for multiple transactions
 * Used to get additional transaction metadata like Interac transfer memos
 *
 * @param {Array<string>} ids - Array of funding intent IDs (e.g., ["funding_intent-xxx", "funding_intent-yyy"])
 * @returns {Promise<Map<string, Object>>} Map of funding intent ID to details
 */
export async function fetchFundingIntents(ids) {
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
    const fundingIntentMap = new Map();

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
 * @param {string} accountId - Credit card account ID (e.g., 'ca-credit-card-FYPcSZJeLA')
 * @returns {Promise<Object>} Credit card account summary
 * @property {string} id - Account ID
 * @property {Object} balance - Balance information
 * @property {number} balance.current - Current balance amount
 * @property {string} creditRegistrationStatus - Credit registration status
 * @property {number} creditLimit - Credit limit amount
 * @property {Array} currentCards - Array of current cards
 */
export async function fetchCreditCardAccountSummary(accountId) {
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
 * @param {string} id - Internal transfer ID (e.g., "funding_intent-RHgNxU9iOg99IbPmQwSErvXLL0n")
 * @returns {Promise<Object|null>} Internal transfer details or null if not found
 */
export async function fetchInternalTransfer(id) {
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
 * @param {string} id - Funds transfer ID (e.g., "funding_intent-OJbdrSdcFlCIPm3hagqmOM0sNhV")
 * @returns {Promise<Object|null>} Funds transfer details or null if not found
 */
export async function fetchFundsTransfer(id) {
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

    const fundsTransfer = response.fundsTransfer;
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
 * Returns limited data compared to FetchSoOrdersExtendedOrder:
 * - quantity: Filled quantity
 * - fxRate: Exchange rate
 * - marketPrice: { amount, currency } - Fill price
 *
 * @param {string} accountId - Wealthsimple account ID (e.g., "resp-gjp2y-3a")
 * @param {string} ordersServiceOrderId - Order ID (e.g., "order-00YDx9aoiwh1")
 * @returns {Promise<Object|null>} Activity data or null if not found
 */
export async function fetchActivityByOrdersServiceOrderId(accountId, ordersServiceOrderId) {
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
 * @param {string} externalId - Order ID (e.g., "order-3f73016b-5af3-4f03-ba22-9ef5e45fbb3d")
 * @returns {Promise<Object|null>} Extended order details or null if not found
 */
export async function fetchExtendedOrder(externalId) {
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

    const extendedOrder = response.soOrdersExtendedOrder;
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
 * @param {string} activityCanonicalId - Corporate action activity canonical ID (e.g., "US7311052010:2025-12-09:H10739748CAD")
 * @returns {Promise<Array>} Array of child activity nodes with entitlementType, quantity, assetSymbol, assetName, etc.
 */
export async function fetchCorporateActionChildActivities(activityCanonicalId) {
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

    const childActivities = response.corporateActionChildActivities.nodes || [];
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
 * Used to get details about expired/expiring short option positions, including:
 * - decision: The decision made (e.g., "EXPIRE", "ASSIGN")
 * - reason: The reason for the decision
 * - fxRate: Foreign exchange rate applied
 * - deliverables: Array of securities and quantities involved
 * - securityCurrency: Currency of the security
 *
 * @param {string} id - Short option position expiry detail ID (e.g., "oe-c8861ccc2c9905f176b8946b5bedfaae4b0b2cde")
 * @returns {Promise<Object|null>} Short option expiry details or null if not found
 */
export async function fetchShortOptionPositionExpiryDetail(id) {
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

    const expiryDetail = response.shortOptionPositionExpiryDetail;
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
 * @param {string} securityId - Security ID (e.g., "sec-o-977d51d56c9a40e58ead71785a412b3d")
 * @returns {Promise<Object|null>} Security details or null if not found
 */
export async function fetchSecurity(securityId) {
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

    const security = response.security;
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
 * @param {string} accountId - Wealthsimple account ID
 * @returns {Promise<Array>} Array of position objects with full details from the API
 */
export async function fetchManagedPortfolioPositions(accountId) {
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

    const positions = response.account.positions;
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
 * @param {Array<string>} accountIds - Array of Wealthsimple account IDs
 * @returns {Promise<Object>} Object mapping accountId to cash balances { cad, usd }
 *
 * @example
 * const balances = await fetchAccountsWithBalance(['rrsp-qthtmh-s']);
 * // Returns: { 'rrsp-qthtmh-s': { cad: 0.01, usd: 0.46 } }
 */
export async function fetchAccountsWithBalance(accountIds) {
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
    const result = {};

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
 * @param {string} accountId - Wealthsimple account ID (e.g., "ca-cash-msb-iusfagkx" or "ca-credit-card-xxx")
 * @param {Array<string>} transactionIds - Array of transaction IDs to fetch details for
 * @returns {Promise<Map<string, Object>>} Map of transaction ID to spend details
 */
export async function fetchSpendTransactions(accountId, transactionIds) {
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
    const spendTransactionMap = new Map();

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
 * Fetch crypto order details for a single crypto buy/sell order
 * Used to get detailed fill information, fees, and pricing for crypto orders
 *
 * Returns:
 * - quantity: Requested quantity
 * - executedQuantity: Actually filled quantity
 * - price: Price per unit at fill time
 * - executedValue: Total value of filled portion (excl. fees)
 * - fee: Trading commission fee
 * - swapFee: Crypto-specific swap fee
 * - totalCost: Total cost including all fees
 * - limitPrice: Limit price (null for market orders)
 * - timeInForce: Order time in force (e.g., "day")
 * - currency: Order currency
 * - filledAt: Fill timestamp
 *
 * @param {string} id - Crypto order ID (e.g., "order-sqXS6HQQ0uJra3R7W9Zof2GgGRJ")
 * @returns {Promise<Object|null>} Crypto order details or null if not found
 */
export async function fetchCryptoOrder(id) {
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

    const cryptoOrder = response.cryptoOrder;
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

