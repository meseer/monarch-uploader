/**
 * Wealthsimple API - Balance History & Position Queries
 * Large GraphQL queries for balance history and identity positions
 */

import { debugLog } from '../core/utils';
import { makeGraphQLQuery, checkAuth } from './wealthsimple';

//    Interfaces

interface BalanceHistoryRecord {
  date: string;
  amount: number;
  currency: string;
}

interface PositionNode {
  id?: string;
  quantity?: number;
  percentageOfAccount?: number;
  positionDirection?: string;
  bookValue?: { amount: string; currency: string };
  averagePrice?: { amount: string; currency: string };
  totalValue?: { amount: string; currency: string };
  unrealizedReturns?: { amount: string; currency: string };
  security?: {
    id: string;
    currency?: string;
    securityType?: string;
    stock?: { name?: string; symbol?: string; primaryExchange?: string };
    [key: string]: unknown;
  };
  strategyType?: string;
  legs?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

//    Functions

/**
 * Fetch balance history for an account
 * @param accountIds - Array of account IDs (typically single account)
 * @param currency - Currency code (e.g., 'CAD')
 * @param startDate - Start date in YYYY-MM-DD format
 * @param endDate - End date in YYYY-MM-DD format (optional, defaults to today)
 * @returns Array of balance history objects with {date, amount}
 */
export async function fetchBalanceHistory(
  accountIds: string[],
  currency: string,
  startDate: string,
  endDate: string | null = null,
): Promise<BalanceHistoryRecord[]> {
  try {
    if (!accountIds || accountIds.length === 0) {
      throw new Error('No account IDs provided');
    }

    if (!currency) {
      throw new Error('Currency is required');
    }

    if (!startDate) {
      throw new Error('Start date is required');
    }

    debugLog(`Fetching balance history for account(s): ${accountIds.join(', ')} from ${startDate} to ${endDate || 'today'}`);

    const query = `query FetchIdentityHistoricalFinancials($identityId: ID!, $currency: Currency!, $startDate: Date, $endDate: Date, $first: Int, $cursor: String, $accountIds: [ID!], $includeSimpleReturns: Boolean = false) {
  identity(id: $identityId) {
    id
    financials(filter: {accounts: $accountIds}) {
      historicalDaily(
        currency: $currency
        startDate: $startDate
        endDate: $endDate
        first: $first
        after: $cursor
      ) {
        edges {
          node {
            ...IdentityHistoricalFinancials
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
      __typename
    }
    __typename
  }
}

fragment IdentityHistoricalFinancials on IdentityHistoricalDailyFinancials {
  date
  netLiquidationValueV2 {
    amount
    currency
    __typename
  }
  netDepositsV2 {
    amount
    currency
    __typename
  }
  simpleReturns(referenceDate: $startDate) @include(if: $includeSimpleReturns) {
    ...SimpleReturns
    __typename
  }
  __typename
}

fragment SimpleReturns on SimpleReturns {
  amount {
    ...Money
    __typename
  }
  asOf
  rate
  referenceDate
  __typename
}

fragment Money on Money {
  amount
  cents
  currency
  __typename
}`;

    const variables: Record<string, unknown> = {
      includeSimpleReturns: false,
      accountIds,
      currency,
      startDate,
    };

    if (endDate) {
      variables.endDate = endDate;
    }

    const response = await makeGraphQLQuery('FetchIdentityHistoricalFinancials', query, variables);

    if (!response || !response.identity || !response.identity.financials) {
      debugLog('No financials data in response');
      return [];
    }

    const historicalData = response.identity.financials.historicalDaily;
    if (!historicalData || !historicalData.edges) {
      debugLog('No historical daily data in response');
      return [];
    }

    // Extract balance history
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const balanceHistory: BalanceHistoryRecord[] = historicalData.edges.map((edge: any) => {
      const node = edge.node;
      return {
        date: node.date,
        amount: parseFloat(node.netLiquidationValueV2?.amount || 0),
        currency: node.netLiquidationValueV2?.currency || currency,
      };
    });

    // Handle pagination if needed
    if (historicalData.pageInfo?.hasNextPage) {
      debugLog('Balance history has more pages, fetching next page...');
      const nextPageVariables = {
        ...variables,
        cursor: historicalData.pageInfo.endCursor,
      };

      const nextPageData = await makeGraphQLQuery('FetchIdentityHistoricalFinancials', query, nextPageVariables);
      if (nextPageData?.identity?.financials?.historicalDaily?.edges) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const nextPageHistory: BalanceHistoryRecord[] = nextPageData.identity.financials.historicalDaily.edges.map((edge: any) => {
          const node = edge.node;
          return {
            date: node.date,
            amount: parseFloat(node.netLiquidationValueV2?.amount || 0),
            currency: node.netLiquidationValueV2?.currency || currency,
          };
        });
        balanceHistory.push(...nextPageHistory);
      }
    }

    debugLog(`Fetched ${balanceHistory.length} balance history records`);
    return balanceHistory;
  } catch (error) {
    debugLog('Error fetching balance history:', error);
    throw error;
  }
}

/**
 * Fetch investment positions for a specific account
 * Uses the FetchIdentityPositions GraphQL query
 * @param accountId - Wealthsimple account ID
 * @returns Array of position objects with full security details
 */
export async function fetchIdentityPositions(accountId: string): Promise<PositionNode[]> {
  try {
    if (!accountId) {
      throw new Error('Account ID is required');
    }

    debugLog(`Fetching investment positions for account ${accountId}...`);

    // IMPORTANT: This query must be used EXACTLY as provided by Wealthsimple API
    // Do NOT modify the query structure or fragments
    const query = `query FetchIdentityPositions($identityId: ID!, $currency: Currency!, $first: Int, $cursor: String, $accountIds: [ID!], $aggregated: Boolean, $currencyOverride: CurrencyOverride, $sort: PositionSort, $sortDirection: PositionSortDirection, $filter: PositionFilter, $since: PointInTime, $includeSecurity: Boolean = false, $includeAccountData: Boolean = false, $includeOneDayReturnsBaseline: Boolean = false) {
  identity(id: $identityId) {
    id
    financials(filter: {accounts: $accountIds}) {
      current(currency: $currency) {
        id
        positions(
          first: $first
          after: $cursor
          aggregated: $aggregated
          filter: $filter
          sort: $sort
          sortDirection: $sortDirection
        ) {
          edges {
            node {
              ...PositionV2
              __typename
            }
            __typename
          }
          pageInfo {
            hasNextPage
            endCursor
            __typename
          }
          totalCount
          status
          hasOptionsPosition
          hasCryptoPositionsOnly
          securityTypes
          securityCurrencies
          __typename
        }
        __typename
      }
      __typename
    }
    __typename
  }
}

fragment SecuritySummary on Security {
  ...SecuritySummaryDetails
  stock {
    ...StockSummary
    __typename
  }
  quoteV2(currency: null) {
    ...SecurityQuoteV2
    __typename
  }
  optionDetails {
    ...OptionSummary
    __typename
  }
  __typename
}

fragment SecuritySummaryDetails on Security {
  id
  buyable
  currency
  inactiveDate
  status
  wsTradeEligible
  equityTradingSessionType
  securityType
  active
  securityGroups {
    id
    name
    __typename
  }
  features
  logoUrl
  __typename
}

fragment StockSummary on Stock {
  name
  symbol
  primaryMic
  primaryExchange
  __typename
}

fragment StreamedSecurityQuoteV2 on UnifiedQuote {
  __typename
  securityId
  ask
  bid
  currency
  price
  sessionPrice
  quotedAsOf
  ... on EquityQuote {
    marketStatus
    askSize
    bidSize
    close
    high
    last
    lastSize
    low
    open
    mid
    volume: vol
    referenceClose
    __typename
  }
  ... on OptionQuote {
    marketStatus
    askSize
    bidSize
    close
    high
    last
    lastSize
    low
    open
    mid
    volume: vol
    breakEven
    inTheMoney
    liquidityStatus
    openInterest
    underlyingSpot
    __typename
  }
}

fragment SecurityQuoteV2 on UnifiedQuote {
  ...StreamedSecurityQuoteV2
  previousBaseline
  __typename
}

fragment OptionSummary on Option {
  underlyingSecurity {
    ...UnderlyingSecuritySummary
    __typename
  }
  maturity
  osiSymbol
  expiryDate
  multiplier
  optionType
  strikePrice
  __typename
}

fragment UnderlyingSecuritySummary on Security {
  id
  stock {
    name
    primaryExchange
    primaryMic
    symbol
    __typename
  }
  __typename
}

fragment PositionLeg on PositionLeg {
  security {
    id
    ...SecuritySummary @include(if: $includeSecurity)
    __typename
  }
  quantity
  positionDirection
  bookValue {
    amount
    currency
    __typename
  }
  totalValue(currencyOverride: $currencyOverride) {
    amount
    currency
    __typename
  }
  averagePrice {
    amount
    currency
    __typename
  }
  percentageOfAccount
  unrealizedReturns(since: $since) {
    amount
    currency
    __typename
  }
  marketAveragePrice: averagePrice(currencyOverride: $currencyOverride) {
    amount
    currency
    __typename
  }
  marketBookValue: bookValue(currencyOverride: $currencyOverride) {
    amount
    currency
    __typename
  }
  marketUnrealizedReturns: unrealizedReturns(currencyOverride: $currencyOverride) {
    amount
    currency
    __typename
  }
  oneDayReturnsBaselineV2(currencyOverride: $currencyOverride) @include(if: $includeOneDayReturnsBaseline) {
    baseline {
      currency
      amount
      __typename
    }
    useDailyPriceChange
    __typename
  }
  __typename
}

fragment PositionV2 on PositionV2 {
  id
  quantity
  accounts @include(if: $includeAccountData) {
    id
    __typename
  }
  percentageOfAccount
  positionDirection
  bookValue {
    amount
    currency
    __typename
  }
  averagePrice {
    amount
    currency
    __typename
  }
  marketAveragePrice: averagePrice(currencyOverride: $currencyOverride) {
    amount
    currency
    __typename
  }
  marketBookValue: bookValue(currencyOverride: $currencyOverride) {
    amount
    currency
    __typename
  }
  totalValue(currencyOverride: $currencyOverride) {
    amount
    currency
    __typename
  }
  unrealizedReturns(since: $since) {
    amount
    currency
    __typename
  }
  marketUnrealizedReturns: unrealizedReturns(currencyOverride: $currencyOverride) {
    amount
    currency
    __typename
  }
  security {
    id
    ...SecuritySummary @include(if: $includeSecurity)
    __typename
  }
  oneDayReturnsBaselineV2(currencyOverride: $currencyOverride) @include(if: $includeOneDayReturnsBaseline) {
    baseline {
      currency
      amount
      __typename
    }
    useDailyPriceChange
    __typename
  }
  strategyType
  legs {
    ...PositionLeg
    __typename
  }
  __typename
}`;

    const authStatus = checkAuth();
    if (!authStatus.authenticated) {
      throw new Error('Not authenticated with Wealthsimple');
    }

    const variables: Record<string, unknown> = {
      includeSecurity: true,
      includeAccountData: true,
      includeOneDayReturnsBaseline: false,
      accountIds: [accountId],
      identityId: authStatus.identityId,
      currency: 'CAD',
      currencyOverride: 'MARKET',
      aggregated: true,
      first: 50,
    };

    const allPositions: PositionNode[] = [];
    let cursor: string | null = null;
    let hasNextPage = true;
    let pageCount = 0;

    while (hasNextPage) {
      pageCount += 1;
      debugLog(`Fetching positions page ${pageCount}...`);

      if (cursor) {
        variables.cursor = cursor;
      }

      const response = await makeGraphQLQuery('FetchIdentityPositions', query, variables);

      if (!response || !response.identity || !response.identity.financials) {
        debugLog('No financials data in response');
        break;
      }

      const currentFinancials = response.identity.financials.current;
      if (!currentFinancials || !currentFinancials.positions) {
        debugLog('No positions data in response');
        break;
      }

      const { edges, pageInfo, totalCount, hasOptionsPosition, securityTypes } = currentFinancials.positions;

      debugLog(`Page ${pageCount}: ${edges?.length || 0} positions, total: ${totalCount}, hasOptions: ${hasOptionsPosition}, types: ${securityTypes?.join(', ')}`);

      if (!edges || edges.length === 0) {
        debugLog('No more positions found');
        break;
      }

      // Extract positions from edges
      for (const edge of edges) {
        if (edge.node) {
          allPositions.push(edge.node);
        }
      }

      // Update pagination state
      hasNextPage = pageInfo?.hasNextPage || false;
      cursor = pageInfo?.endCursor || null;

      if (!hasNextPage) {
        debugLog('No more pages available');
      }
    }

    debugLog(`Fetched ${allPositions.length} positions across ${pageCount} page(s) for account ${accountId}`);
    return allPositions;
  } catch (error) {
    debugLog(`Error fetching positions for account ${accountId}:`, error);
    throw error;
  }
}

