/**
 * Wealthsimple API - Credit Card Queries
 * GraphQL queries specific to Wealthsimple credit card accounts and card activity
 *
 * Split out of wealthsimpleQueries.ts to keep both files within the project
 * file-size limit.
 */

import { debugLog } from '../core/utils';
import { makeGraphQLQuery } from './wealthsimple';

// ── Interfaces ───────────────────────────────────────────────────────────────

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

/**
 * Normalized credit card activity details.
 *
 * Field names intentionally mirror the `SpendTransaction` shape used by
 * `fetchSpendTransactions` so both enrichment sources can be consumed by the
 * same note formatter. `originalAmount` / `originalCurrency` are only available
 * from this API and carry the precise (unrounded) foreign amount, while
 * `foreignAmount` from the activity feed is truncated.
 */
export interface CreditCardActivityDetails {
  id: string;
  status?: string | null;
  isForeign?: boolean | null;
  /** Precise foreign amount as a string (e.g. "-29.29") — settled transactions only */
  originalAmount?: string | null;
  originalCurrency?: string | null;
  /** Truncated foreign amount from the activity record (e.g. -29) */
  foreignAmount?: number | null;
  foreignCurrency?: string | null;
  /** Applied FX rate as a string (e.g. "1.610106") */
  foreignExchangeRate?: string | null;
  hasReward?: boolean;
  rewardAmount?: string | null;
  rewardRate?: string | null;
  [key: string]: unknown;
}

// ── Functions ────────────────────────────────────────────────────────────────

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
 * Fetch details for a single credit card activity (purchase, payment, etc.)
 *
 * This replaces `FetchSpendTransactions` for credit card accounts, which began
 * returning `403 Forbidden` for `ca-credit-card-*` accounts. It is also the only
 * source of the precise (unrounded) foreign amount via `originalAmount`.
 *
 * FX rate and reward values are only populated once the activity has settled.
 *
 * @param activityId - Card activity ID (the transaction's externalCanonicalId)
 * @returns Normalized activity details, or null when unavailable
 */
export async function fetchCreditCardActivity(activityId: string): Promise<CreditCardActivityDetails | null> {
  if (!activityId) {
    debugLog('No activity ID provided for fetchCreditCardActivity');
    return null;
  }

  try {
    debugLog(`Fetching credit card activity details for ${activityId}...`);

    const query = `query FetchCreditCardActivity($id: ID!) {
  creditCardActivity(id: $id) {
    ...CreditCardActivity
    __typename
  }
}

fragment CreditCardActivity on CreditCardActivity {
  id
  type
  amount
  originalAmount
  isForeign
  foreignAmount
  foreignCurrency
  foreignExchangeRate
  originalCurrency
  currency
  settledAt
  descriptor
  status
  cardNumber
  cardVariant
  cardholderFirstName
  fees {
    amount
    currency
    descriptor
    label
    __typename
  }
  creditReward {
    rewardAmount
    rewardRate
    __typename
  }
  surchargeAmount
  surchargeCurrency
  disputable
  __typename
}`;

    const response = await makeGraphQLQuery('FetchCreditCardActivity', query, { id: activityId });

    const activity = response?.creditCardActivity;
    if (!activity) {
      debugLog(`No credit card activity data found for ${activityId}`);
      return null;
    }

    const details = normalizeCreditCardActivity(activity);

    debugLog(`Fetched credit card activity ${activityId}:`, {
      status: details.status,
      isForeign: details.isForeign,
      originalCurrency: details.originalCurrency,
      hasReward: details.hasReward,
    });

    return details;
  } catch (error) {
    // Per-transaction enrichment failures must not fail the whole sync
    debugLog(`Error fetching credit card activity ${activityId}:`, error);
    return null;
  }
}

/**
 * Normalize a raw `creditCardActivity` record into `CreditCardActivityDetails`.
 *
 * Keeps the field names aligned with the spend-transaction shape so the note
 * formatter can consume either source.
 *
 * @param activity - Raw activity record from the GraphQL response
 * @returns Normalized activity details
 */
function normalizeCreditCardActivity(activity: Record<string, unknown>): CreditCardActivityDetails {
  const reward = activity.creditReward as { rewardAmount?: string; rewardRate?: string } | null | undefined;
  const rewardAmount = reward?.rewardAmount ?? null;

  return {
    id: activity.id as string,
    status: (activity.status as string | null | undefined) ?? null,
    isForeign: (activity.isForeign as boolean | null | undefined) ?? null,
    originalAmount: (activity.originalAmount as string | null | undefined) ?? null,
    originalCurrency: (activity.originalCurrency as string | null | undefined) ?? null,
    foreignAmount: (activity.foreignAmount as number | null | undefined) ?? null,
    foreignCurrency: (activity.foreignCurrency as string | null | undefined) ?? null,
    foreignExchangeRate: (activity.foreignExchangeRate as string | null | undefined) ?? null,
    hasReward: rewardAmount !== null && rewardAmount !== undefined,
    rewardAmount,
    rewardRate: reward?.rewardRate ?? null,
  };
}