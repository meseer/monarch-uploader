/**
 * Wealthsimple API - Detailed Fetch Queries
 * GraphQL queries for funding, transfers, orders, securities, and more
 */

import { debugLog } from '../core/utils';
import { makeGraphQLQuery } from './wealthsimple';

//    Interfaces

interface ActivityByOrderData {
  id?: string;
  quantity?: number;
  fxRate?: number;
  marketPrice?: { amount: number; currency: string };
  [key: string]: unknown;
}

interface ExtendedOrderData {
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

interface CorporateActionChildActivity {
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

interface ShortOptionExpiryDetail {
  id?: string;
  decision?: string;
  reason?: string;
  fxRate?: number;
  securityCurrency?: string;
  deliverables?: Array<{ quantity: number; securityId: string }>;
  [key: string]: unknown;
}

interface SecurityDetails {
  id?: string;
  currency?: string;
  securityType?: string;
  stock?: { name?: string; symbol?: string };
  [key: string]: unknown;
}

interface ManagedPortfolioPosition {
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

interface AccountCashBalances {
  cad: number | null;
  usd: number | null;
}

interface SpendTransactionDetails {
  id: string;
  hasReward?: boolean;
  rewardAmount?: number;
  foreignAmount?: number;
  foreignCurrency?: string;
  foreignExchangeRate?: number;
  isForeign?: boolean;
  [key: string]: unknown;
}

interface CryptoOrderDetails {
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
    // A 403 here means Wealthsimple revoked access to `spendTransactions` for this
    // account type — surface it explicitly so a silent loss of enrichment data is
    // diagnosable (this already happened for CREDIT_CARD accounts, which now use
    // fetchCreditCardActivity instead).
    if (String((error as Error)?.message || '').includes('Forbidden')) {
      debugLog(`spendTransactions is forbidden for account ${accountId} — enrichment data unavailable`);
    }
    debugLog('Error fetching spend transactions:', error);
    // Return empty map on error - don't fail the entire sync
    return new Map();
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

