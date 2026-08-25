/**
 * Wealthsimple API - Funding & Transfer Queries
 * GraphQL queries for funding intents, internal transfers, and EFT funds transfers
 *
 * Split out of wealthsimpleQueries.ts to keep both files within the project
 * file-size limit.
 */

import { debugLog } from '../core/utils';
import { makeGraphQLQuery } from './wealthsimple';

// -- Interfaces ---------------------------------------------------------------

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

export interface FundingIntentStatusSummaryData {
  id?: string;
  annotation?: string;
  activityFrequency?: string;
  isCancellable?: boolean;
  [key: string]: unknown;
}

// -- Functions ----------------------------------------------------------------

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
