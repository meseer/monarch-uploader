/**
 * Wealthsimple API Client
 * Handles API communication with Wealthsimple GraphQL API
 */

import { debugLog, formatDate } from '../core/utils';
import { STORAGE, API } from '../core/config';
import stateManager from '../core/state';

/**
 * Parse Wealthsimple OAuth cookie and extract token data
 * @returns {Object|null} Parsed token data or null
 */
function parseOAuthCookie() {
  try {
    const cookies = document.cookie.split(';');
    const oauthCookie = cookies.find((cookie) => cookie.trim().startsWith('_oauth2_access_v2='));

    if (!oauthCookie) {
      return null;
    }

    // Extract cookie value and decode
    const cookieValue = oauthCookie.split('=')[1];
    const decodedValue = decodeURIComponent(cookieValue);
    const tokenData = JSON.parse(decodedValue);

    return {
      accessToken: tokenData.access_token,
      identityId: tokenData.identity_canonical_id,
      expiresAt: tokenData.expires_at,
      investProfile: tokenData.profiles?.invest?.default || null,
      tradeProfile: tokenData.profiles?.trade?.default || null,
      email: tokenData.email || null,
    };
  } catch (error) {
    debugLog('Error parsing OAuth cookie:', error);
    return null;
  }
}

/**
 * Save Wealthsimple token data to storage
 * @param {Object} tokenData - Token data to save
 */
function saveTokenData(tokenData) {
  if (tokenData) {
    GM_setValue(STORAGE.WEALTHSIMPLE_ACCESS_TOKEN, tokenData.accessToken);
    GM_setValue(STORAGE.WEALTHSIMPLE_IDENTITY_ID, tokenData.identityId);
    GM_setValue(STORAGE.WEALTHSIMPLE_TOKEN_EXPIRES_AT, tokenData.expiresAt);

    if (tokenData.investProfile) {
      GM_setValue(STORAGE.WEALTHSIMPLE_INVEST_PROFILE, tokenData.investProfile);
    }
    if (tokenData.tradeProfile) {
      GM_setValue(STORAGE.WEALTHSIMPLE_TRADE_PROFILE, tokenData.tradeProfile);
    }

    debugLog('Wealthsimple token data saved:', {
      identityId: tokenData.identityId,
      expiresAt: tokenData.expiresAt,
      hasInvestProfile: Boolean(tokenData.investProfile),
      hasTradeProfile: Boolean(tokenData.tradeProfile),
    });

    // Update state manager
    stateManager.setWealthsimpleAuth({
      authenticated: true,
      identityId: tokenData.identityId,
      expiresAt: tokenData.expiresAt,
    });
  } else {
    clearTokenData();
  }
}

/**
 * Clear all Wealthsimple token data from storage
 */
function clearTokenData() {
  GM_deleteValue(STORAGE.WEALTHSIMPLE_ACCESS_TOKEN);
  GM_deleteValue(STORAGE.WEALTHSIMPLE_IDENTITY_ID);
  GM_deleteValue(STORAGE.WEALTHSIMPLE_TOKEN_EXPIRES_AT);
  GM_deleteValue(STORAGE.WEALTHSIMPLE_INVEST_PROFILE);
  GM_deleteValue(STORAGE.WEALTHSIMPLE_TRADE_PROFILE);

  debugLog('Wealthsimple token data cleared');

  // Update state manager
  stateManager.setWealthsimpleAuth(null);
}

/**
 * Get stored Wealthsimple token data
 * @returns {Object|null} Token data or null
 */
function getStoredTokenData() {
  const accessToken = GM_getValue(STORAGE.WEALTHSIMPLE_ACCESS_TOKEN);
  const identityId = GM_getValue(STORAGE.WEALTHSIMPLE_IDENTITY_ID);
  const expiresAt = GM_getValue(STORAGE.WEALTHSIMPLE_TOKEN_EXPIRES_AT);

  if (!accessToken || !identityId) {
    return null;
  }

  return {
    accessToken,
    identityId,
    expiresAt,
    investProfile: GM_getValue(STORAGE.WEALTHSIMPLE_INVEST_PROFILE),
    tradeProfile: GM_getValue(STORAGE.WEALTHSIMPLE_TRADE_PROFILE),
  };
}

/**
 * Check if token is expired
 * @param {string} expiresAt - ISO timestamp
 * @returns {boolean} True if expired
 */
function isTokenExpired(expiresAt) {
  if (!expiresAt) return true;

  try {
    const expiryTime = new Date(expiresAt).getTime();
    const currentTime = Date.now();
    return currentTime >= expiryTime;
  } catch (error) {
    debugLog('Error checking token expiration:', error);
    return true;
  }
}

/**
 * Check if user is authenticated with Wealthsimple
 * @returns {Object} Authentication status
 */
export function checkAuth() {
  const tokenData = getStoredTokenData();

  if (!tokenData) {
    return {
      authenticated: false,
      token: null,
      identityId: null,
      expiresAt: null,
    };
  }

  // Check if token is expired
  if (isTokenExpired(tokenData.expiresAt)) {
    debugLog('Wealthsimple token expired, clearing data');
    clearTokenData();
    return {
      authenticated: false,
      token: null,
      identityId: null,
      expiresAt: tokenData.expiresAt,
      expired: true,
    };
  }

  return {
    authenticated: true,
    token: tokenData.accessToken,
    identityId: tokenData.identityId,
    expiresAt: tokenData.expiresAt,
    investProfile: tokenData.investProfile,
    tradeProfile: tokenData.tradeProfile,
  };
}

/**
 * Setup token monitoring to capture Wealthsimple authentication from cookie
 */
export function setupTokenMonitoring() {
  debugLog('Setting up Wealthsimple token monitoring...');

  // Function to check and capture token from cookie
  const captureTokenFromCookie = () => {
    const tokenData = parseOAuthCookie();
    if (tokenData) {
      debugLog('Captured Wealthsimple token from cookie');
      saveTokenData(tokenData);
      return true;
    }
    return false;
  };

  // Check immediately
  captureTokenFromCookie();

  // Monitor cookie changes (check periodically as cookie change events aren't reliable)
  setInterval(() => {
    captureTokenFromCookie();
  }, 30000); // Check every 30 seconds

  // Also check on page visibility change (when user returns to tab)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      captureTokenFromCookie();
    }
  });

  debugLog('Wealthsimple token monitoring initialized');
}

/**
 * Make a GraphQL query to Wealthsimple API
 * @param {string} operationName - GraphQL operation name
 * @param {string} query - GraphQL query string
 * @param {Object} variables - Query variables
 * @returns {Promise<Object>} API response data
 */
export async function makeGraphQLQuery(operationName, query, variables = {}) {
  const authStatus = checkAuth();

  if (!authStatus.authenticated) {
    throw new Error('Wealthsimple auth token not found. Please refresh the page.');
  }

  // Inject identity ID into variables if not present
  if (!variables.identityId && authStatus.identityId) {
    variables.identityId = authStatus.identityId;
  }

  const requestBody = {
    operationName,
    query,
    variables,
  };

  debugLog(`Making GraphQL query: ${operationName}`, { variables });

  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: 'POST',
      url: API.WEALTHSIMPLE_GRAPHQL_URL,
      headers: {
        authorization: `Bearer ${authStatus.token}`,
        'content-type': 'application/json',
        origin: 'https://my.wealthsimple.com',
        referer: 'https://my.wealthsimple.com/app/home',
      },
      data: JSON.stringify(requestBody),
      onload: (response) => {
        if (response.status === 401) {
          debugLog('Wealthsimple token expired (401)');
          clearTokenData();
          reject(new Error('Auth token expired. Please refresh the page.'));
        } else if (response.status === 404) {
          reject(new Error(`Resource not found: ${operationName}`));
        } else if (response.status >= 500) {
          reject(new Error('Server error. Please try again later.'));
        } else if (response.status >= 200 && response.status < 300) {
          try {
            const data = response.responseText ? JSON.parse(response.responseText) : {};

            // Check for GraphQL errors
            if (data.errors && data.errors.length > 0) {
              const errorMessage = data.errors.map((e) => e.message).join(', ');
              debugLog('GraphQL errors:', data.errors);
              reject(new Error(`GraphQL Error: ${errorMessage}`));
            } else {
              resolve(data.data);
            }
          } catch (error) {
            reject(new Error(`Failed to parse response: ${error.message}`));
          }
        } else {
          reject(new Error(`API Error: Received status ${response.status}`));
        }
      },
      onerror: (error) => {
        debugLog('Wealthsimple API network error:', error);
        reject(new Error('Network error. Please check your connection.'));
      },
    });
  });
}

/**
 * Validate token with Wealthsimple token info endpoint
 * @returns {Promise<Object>} Token info
 */
export async function validateToken() {
  const authStatus = checkAuth();

  if (!authStatus.authenticated) {
    throw new Error('No token to validate');
  }

  debugLog('Validating Wealthsimple token...');

  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: 'GET',
      url: API.WEALTHSIMPLE_TOKEN_INFO_URL,
      headers: {
        authorization: `Bearer ${authStatus.token}`,
      },
      onload: (response) => {
        if (response.status === 200) {
          try {
            const data = JSON.parse(response.responseText);
            debugLog('Token validation successful:', data);
            resolve(data);
          } catch (error) {
            reject(new Error(`Failed to parse token info: ${error.message}`));
          }
        } else if (response.status === 401) {
          debugLog('Token validation failed (401)');
          clearTokenData();
          reject(new Error('Token is invalid or expired'));
        } else {
          reject(new Error(`Token validation failed: ${response.status}`));
        }
      },
      onerror: (error) => {
        debugLog('Token validation network error:', error);
        reject(new Error('Network error during token validation'));
      },
    });
  });
}

/**
 * Convert account type to camelCase
 * @param {string} type - Account type (e.g., 'ca_credit_card')
 * @returns {string} CamelCase type (e.g., 'caCreditCard')
 */
function toCamelCase(type) {
  return type
    .split('_')
    .map((word, index) => {
      if (index === 0) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join('');
}

/**
 * Generate nickname from account type and ID
 * @param {string} type - Account type
 * @param {string} id - Account ID
 * @returns {string} Generated nickname
 */
function generateNickname(type, id) {
  const camelType = toCamelCase(type);
  const lastFour = id.slice(-4);
  return `${camelType} ${lastFour}`;
}

/**
 * Fetch and cache Wealthsimple accounts list with consolidated structure
 * Merges with existing cached list to preserve monarch mappings, sync settings, and transaction history
 * @returns {Promise<Array>} Array of consolidated account objects
 */
export async function fetchAndCacheWealthsimpleAccounts() {
  try {
    debugLog('Fetching and caching Wealthsimple accounts...');

    // Fetch fresh accounts from API
    const apiAccounts = await fetchAccounts();

    // Get existing cached accounts (consolidated structure)
    const existingAccounts = JSON.parse(GM_getValue(STORAGE.WEALTHSIMPLE_ACCOUNTS_LIST, '[]'));

    // Create a map of existing accounts by Wealthsimple account ID
    const existingMap = new Map();
    existingAccounts.forEach((acc) => {
      if (acc.wealthsimpleAccount?.id) {
        existingMap.set(acc.wealthsimpleAccount.id, acc);
      }
    });

    // Merge API data with existing settings
    const mergedAccounts = apiAccounts.map((apiAccount) => {
      const existing = existingMap.get(apiAccount.id);

      return {
        // Wealthsimple account definition (always fresh from API)
        wealthsimpleAccount: apiAccount,

        // Monarch account mapping (preserve from cache)
        monarchAccount: existing?.monarchAccount || null,

        // Sync enabled status (preserve from cache, default to true for new accounts)
        syncEnabled: existing?.syncEnabled ?? true,

        // Last sync date (preserve from cache)
        lastSyncDate: existing?.lastSyncDate || null,

        // Uploaded transactions (preserve from cache)
        uploadedTransactions: existing?.uploadedTransactions || [],

        // Store number stripping setting (preserve from cache, default to true for new accounts)
        stripStoreNumbers: existing?.stripStoreNumbers ?? true,
      };
    });

    // Save merged list with consolidated structure
    GM_setValue(STORAGE.WEALTHSIMPLE_ACCOUNTS_LIST, JSON.stringify(mergedAccounts));
    debugLog(`Cached ${mergedAccounts.length} Wealthsimple accounts with consolidated structure`);

    return mergedAccounts;
  } catch (error) {
    debugLog('Error fetching and caching Wealthsimple accounts:', error);
    throw error;
  }
}

/**
 * Fetch all Wealthsimple accounts using GraphQL
 * @returns {Promise<Array>} Array of account objects
 */
export async function fetchAccounts() {
  try {
    debugLog('Fetching Wealthsimple accounts via GraphQL...');

    const query = `query FetchAllAccounts($identityId: ID!, $filter: AccountsFilter = {}, $pageSize: Int = 25, $cursor: String) {
  identity(id: $identityId) {
    id
    accounts(filter: $filter, first: $pageSize, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
        __typename
      }
      edges {
        cursor
        node {
          id
          archivedAt
          status
          unifiedAccountType
          type
          nickname
          currency
          branch
          createdAt
          __typename
        }
        __typename
      }
      __typename
    }
    __typename
  }
}`;

    const variables = {
      filter: {},
      pageSize: 50,
      cursor: '',
    };

    const response = await makeGraphQLQuery('FetchAllAccounts', query, variables);

    if (!response || !response.identity || !response.identity.accounts) {
      debugLog('No accounts data in response');
      return [];
    }

    // Filter and map accounts
    const accounts = response.identity.accounts.edges
      .filter((edge) => {
        const account = edge.node;
        return account.status === 'open' && account.archivedAt === null;
      })
      .map((edge) => {
        const account = edge.node;
        return {
          id: account.id,
          type: account.unifiedAccountType || account.type,
          nickname: account.nickname || generateNickname(account.type, account.id),
          currency: account.currency,
          branch: account.branch,
          rawType: account.type,
          createdAt: account.createdAt,
        };
      });

    debugLog(`Fetched ${accounts.length} active Wealthsimple accounts`, accounts);
    return accounts;
  } catch (error) {
    debugLog('Error fetching Wealthsimple accounts:', error);
    throw error;
  }
}

/**
 * Fetch current balances for multiple accounts
 * @param {Array<string>} accountIds - Array of account IDs
 * @returns {Promise<Object>} Object with success status and balances map
 */
export async function fetchAccountBalances(accountIds) {
  try {
    if (!accountIds || accountIds.length === 0) {
      debugLog('No account IDs provided for balance fetch');
      return { success: false, balances: new Map(), error: 'No account IDs provided' };
    }

    debugLog(`Fetching balances for ${accountIds.length} Wealthsimple account(s)...`);

    const query = `query FetchAccountCombinedFinancialsPreload($ids: [String!]!, $currency: Currency, $startDate: Date) {
  accounts(ids: $ids) {
    id
    financials {
      currentCombined(currency: $currency) {
        id
        netDepositsV2 {
          ...Money
          __typename
        }
        netLiquidationValueV2 {
          ...Money
          __typename
        }
        simpleReturns(referenceDate: $startDate) {
          ...Returns
          __typename
        }
        __typename
      }
      __typename
    }
    __typename
  }
}

fragment Money on Money {
  amount
  cents
  currency
  __typename
}

fragment Returns on SimpleReturns {
  amount {
    ...Money
    __typename
  }
  asOf
  rate
  referenceDate
  __typename
}`;

    const variables = {
      ids: accountIds,
    };

    const response = await makeGraphQLQuery('FetchAccountCombinedFinancialsPreload', query, variables);

    if (!response || !response.accounts) {
      debugLog('No accounts data in balance response');
      return { success: false, balances: new Map(), error: 'No accounts data in response' };
    }

    // Parse balances into a map
    const balances = new Map();
    response.accounts.forEach((account) => {
      if (account.financials?.currentCombined?.netLiquidationValueV2) {
        const balanceData = account.financials.currentCombined.netLiquidationValueV2;
        const amount = parseFloat(balanceData.amount);

        if (!isNaN(amount) && balanceData.currency) {
          balances.set(account.id, {
            amount,
            currency: balanceData.currency,
          });
          debugLog(`Fetched balance for ${account.id}: ${balanceData.currency} ${amount}`);
        } else {
          debugLog(`Invalid balance data for ${account.id}`);
          balances.set(account.id, null);
        }
      } else {
        debugLog(`No balance data available for ${account.id}`);
        balances.set(account.id, null);
      }
    });

    debugLog(`Successfully fetched balances for ${balances.size} account(s)`);
    return { success: true, balances };
  } catch (error) {
    debugLog('Error fetching account balances:', error);
    return { success: false, balances: new Map(), error: error.message };
  }
}

/**
 * Fetch account balance for a specific account
 * @param {string} accountId - Account ID
 * @returns {Promise<Object>} Account balance data
 */
export async function fetchAccountBalance(accountId) {
  try {
    debugLog(`Fetching balance for Wealthsimple account ${accountId}...`);

    // Use the batch API for single account
    const result = await fetchAccountBalances([accountId]);

    if (!result.success) {
      throw new Error(result.error || 'Failed to fetch balance');
    }

    const balance = result.balances.get(accountId);
    if (!balance) {
      throw new Error('Balance not available for account');
    }

    debugLog(`Fetched balance for account ${accountId}: ${balance.currency} ${balance.amount}`);
    return balance;
  } catch (error) {
    debugLog(`Error fetching balance for account ${accountId}:`, error);
    throw error;
  }
}

/**
 * Fetch account transactions using paginated GraphQL operation
 * Loads all pages until reaching transactions older than startDate
 * @param {string} accountId - Account ID
 * @param {string} startDate - Start date in YYYY-MM-DD format (local timezone)
 * @returns {Promise<Array>} Array of transaction objects with all Activity fields
 */
export async function fetchTransactions(accountId, startDate) {
  try {
    if (!accountId) {
      throw new Error('Account ID is required');
    }

    if (!startDate) {
      throw new Error('Start date is required');
    }

    // Validate startDate format (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      throw new Error('Start date must be in YYYY-MM-DD format');
    }

    debugLog(`Fetching transactions for Wealthsimple account ${accountId} from ${startDate}...`);

    const query = `query FetchActivityFeedItems($first: Int, $cursor: Cursor, $condition: ActivityCondition, $orderBy: [ActivitiesOrderBy!] = OCCURRED_AT_DESC) {
  activityFeedItems(
    first: $first
    after: $cursor
    condition: $condition
    orderBy: $orderBy
  ) {
    edges {
      node {
        ...Activity
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

fragment Activity on ActivityFeedItem {
  accountId
  aftOriginatorName
  aftTransactionCategory
  aftTransactionType
  amount
  amountSign
  assetQuantity
  assetSymbol
  canonicalId
  currency
  eTransferEmail
  eTransferName
  externalCanonicalId
  groupId
  identityId
  institutionName
  occurredAt
  p2pHandle
  p2pMessage
  spendMerchant
  securityId
  billPayCompanyName
  billPayPayeeNickname
  redactedExternalAccountNumber
  opposingAccountId
  status
  subType
  type
  strikePrice
  contractType
  expiryDate
  chequeNumber
  provisionalCreditAmount
  primaryBlocker
  interestRate
  frequency
  counterAssetSymbol
  rewardProgram
  counterPartyCurrency
  counterPartyCurrencyAmount
  counterPartyName
  fxRate
  fees
  reference
  transferType
  optionStrategy
  rejectionReason
  resolvable
  withholdingTaxAmount
  announcementDate
  recordDate
  payableDate
  grossDividendRate
  unifiedStatus
  estimatedCompletionDate
  __typename
}`;

    const allTransactions = [];
    let cursor = null;
    let hasNextPage = true;
    let pageCount = 0;

    // Set endDate to current moment in ISO format
    const endDate = new Date().toISOString();

    while (hasNextPage) {
      pageCount += 1;
      debugLog(`Fetching page ${pageCount} of transactions...`);

      const variables = {
        first: 50, // Maximum page size
        orderBy: 'OCCURRED_AT_DESC',
        condition: {
          accountIds: [accountId],
          endDate,
        },
      };

      // Add cursor for pagination after first page
      if (cursor) {
        variables.cursor = cursor;
      }

      const response = await makeGraphQLQuery('FetchActivityFeedItems', query, variables);

      if (!response || !response.activityFeedItems) {
        debugLog('No activityFeedItems in response');
        break;
      }

      const { edges, pageInfo } = response.activityFeedItems;

      if (!edges || edges.length === 0) {
        debugLog('No more transactions found');
        break;
      }

      // Process transactions and check dates
      let shouldStopPagination = false;

      for (const edge of edges) {
        const transaction = edge.node;

        // Convert transaction date to local date for comparison
        const transactionDate = formatDate(new Date(transaction.occurredAt));

        // Check if this transaction is older than startDate
        if (transactionDate < startDate) {
          debugLog(`Reached transaction older than startDate: ${transactionDate} < ${startDate}. Stopping pagination.`);
          shouldStopPagination = true;
          break;
        }

        // Add transaction to results
        allTransactions.push(transaction);
      }

      debugLog(`Processed ${edges.length} transactions from page ${pageCount}`);

      // Check if we should continue pagination
      if (shouldStopPagination) {
        break;
      }

      // Update pagination state
      hasNextPage = pageInfo?.hasNextPage || false;
      cursor = pageInfo?.endCursor || null;

      if (!hasNextPage) {
        debugLog('No more pages available');
      }
    }

    debugLog(`Fetched ${allTransactions.length} transactions across ${pageCount} page(s) for account ${accountId}`);
    return allTransactions;
  } catch (error) {
    debugLog(`Error fetching transactions for account ${accountId}:`, error);
    throw error;
  }
}

/**
 * Fetch balance history for an account
 * @param {Array<string>} accountIds - Array of account IDs (typically single account)
 * @param {string} currency - Currency code (e.g., 'CAD')
 * @param {string} startDate - Start date in YYYY-MM-DD format
 * @param {string} endDate - End date in YYYY-MM-DD format (optional, defaults to today)
 * @returns {Promise<Array>} Array of balance history objects with {date, amount}
 */
export async function fetchBalanceHistory(accountIds, currency, startDate, endDate = null) {
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

    const variables = {
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
    const balanceHistory = historicalData.edges.map((edge) => {
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
        const nextPageHistory = nextPageData.identity.financials.historicalDaily.edges.map((edge) => {
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

export default {
  checkAuth,
  setupTokenMonitoring,
  makeGraphQLQuery,
  validateToken,
  fetchAccounts,
  fetchAndCacheAccounts: fetchAndCacheWealthsimpleAccounts,
  fetchAccountBalance,
  fetchAccountBalances,
  fetchTransactions,
  fetchBalanceHistory,
  fetchCreditCardAccountSummary,
};
