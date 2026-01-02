/**
 * Wealthsimple API Client
 * Handles API communication with Wealthsimple GraphQL API
 */

import { debugLog } from '../core/utils';
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
 * Fetch and cache Wealthsimple accounts list
 * Merges with existing cached list to preserve skip flags and other settings
 * @returns {Promise<Array>} Array of account objects with enhanced properties
 */
export async function fetchAndCacheWealthsimpleAccounts() {
  try {
    debugLog('Fetching and caching Wealthsimple accounts...');

    // Fetch fresh accounts from API
    const apiAccounts = await fetchAccounts();

    // Get existing cached accounts
    const cachedAccounts = JSON.parse(GM_getValue(STORAGE.WEALTHSIMPLE_ACCOUNTS_LIST, '[]'));

    // Create a map of cached accounts by ID
    const cachedMap = new Map();
    cachedAccounts.forEach((acc) => {
      cachedMap.set(acc.id, acc);
    });

    // Merge API data with cached settings
    const mergedAccounts = apiAccounts.map((apiAccount) => {
      const cached = cachedMap.get(apiAccount.id);
      return {
        ...apiAccount,
        // Preserve these settings from cache if they exist
        skipped: cached?.skipped || false,
        lastSyncDate: cached?.lastSyncDate || null,
      };
    });

    // Save merged list
    GM_setValue(STORAGE.WEALTHSIMPLE_ACCOUNTS_LIST, JSON.stringify(mergedAccounts));
    debugLog(`Cached ${mergedAccounts.length} Wealthsimple accounts with settings`);

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
 * Fetch account balance for a specific account
 * @param {string} accountId - Account ID
 * @returns {Promise<Object>} Account balance data
 */
export async function fetchAccountBalance(accountId) {
  try {
    debugLog(`Fetching balance for Wealthsimple account ${accountId}...`);

    // This would use a GraphQL query for account balance
    // For now, return placeholder
    const response = { balance: 0 };

    debugLog(`Fetched balance for account ${accountId}`);
    return response;
  } catch (error) {
    debugLog(`Error fetching balance for account ${accountId}:`, error);
    throw error;
  }
}

/**
 * Fetch account transactions
 * @param {string} accountId - Account ID
 * @param {Object} _options - Query options (startDate, endDate, limit)
 * @returns {Promise<Array>} Array of transactions
 */
export async function fetchTransactions(accountId, _options = {}) {
  try {
    debugLog(`Fetching transactions for Wealthsimple account ${accountId}...`);

    // This would use a GraphQL query for transactions
    // For now, return placeholder
    const response = { results: [] };

    debugLog(`Fetched ${response.results?.length || 0} transactions for account ${accountId}`);
    return response.results || [];
  } catch (error) {
    debugLog(`Error fetching transactions for account ${accountId}:`, error);
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
  fetchTransactions,
};
