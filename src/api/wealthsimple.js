/**
 * Wealthsimple API Client
 * Handles API communication with Wealthsimple GraphQL API
 */

import { debugLog, formatDate } from '../core/utils';
import { STORAGE, API } from '../core/config';
import stateManager from '../core/state';
import { getAccountTypeDisplayName } from '../mappers/wealthsimple-account-types';

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
 * Token monitoring state
 */
let tokenCheckIntervalId = null;
let tokenFound = false;

/**
 * Setup token monitoring to capture Wealthsimple authentication from cookie
 * Uses fast polling (1 second) initially until token is found,
 * then switches to slower maintenance polling (30 seconds)
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

  // Function to handle token check and manage polling intervals
  const checkToken = () => {
    const found = captureTokenFromCookie();
    if (found && !tokenFound) {
      tokenFound = true;
      debugLog('Token found, switching to slow polling interval (30s)');

      // Clear fast polling interval
      if (tokenCheckIntervalId) {
        clearInterval(tokenCheckIntervalId);
      }

      // Switch to slower maintenance interval
      tokenCheckIntervalId = setInterval(() => {
        captureTokenFromCookie();
      }, 30000); // 30 seconds for maintenance checks
    }
  };

  // Check immediately
  const initialFound = captureTokenFromCookie();

  if (initialFound) {
    // Token found immediately, use slow polling
    tokenFound = true;
    debugLog('Token found immediately, using slow polling interval (30s)');
    tokenCheckIntervalId = setInterval(() => {
      captureTokenFromCookie();
    }, 30000);
  } else {
    // Token not found, use fast polling until found
    debugLog('Token not found initially, using fast polling interval (1s)');
    tokenCheckIntervalId = setInterval(checkToken, 1000);
  }

  // Also check on page visibility change (when user returns to tab)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkToken();
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
  // Note: FetchFundingIntent, FetchInternalTransfer, FetchFundsTransfer, and FetchSoOrdersExtendedOrder don't accept identityId and return 403 if it's passed
  const skipIdentityInjection = ['FetchFundingIntent', 'FetchInternalTransfer', 'FetchFundsTransfer', 'FetchSoOrdersExtendedOrder'];
  if (!variables.identityId && authStatus.identityId && !skipIdentityInjection.includes(operationName)) {
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
 * Generate default account name from account type and last 4 characters/digits
 * Format: "Wealthsimple {Display Name} ({last4})"
 * Example: "Wealthsimple Credit Card (6903)"
 *
 * Note: For credit cards, the last4 should be from cardNumberLast4Digits (API).
 * For other accounts, it's the last 4 characters of the account ID.
 *
 * @param {string} unifiedType - Unified account type (e.g., 'CREDIT_CARD', 'MANAGED_TFSA')
 * @param {string} last4 - Last 4 digits/characters to display
 * @returns {string} Generated account name
 */
function generateAccountName(unifiedType, last4) {
  const displayName = getAccountTypeDisplayName(unifiedType);
  return `Wealthsimple ${displayName} (${last4})`;
}

/**
 * Fetch and cache Wealthsimple accounts list with consolidated structure
 * Merges with existing cached list to preserve monarch mappings, sync settings, and transaction history
 * For credit cards without user nicknames, enriches the name with actual card last 4 digits
 * @returns {Promise<Array>} Array of consolidated account objects
 */
export async function fetchAndCacheWealthsimpleAccounts() {
  try {
    debugLog('Fetching and caching Wealthsimple accounts...');

    // Fetch fresh accounts from API
    const apiAccounts = await fetchAccounts();

    // Enrich credit card accounts with actual card last 4 digits
    const enrichedAccounts = await enrichCreditCardNicknames(apiAccounts);

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
    const mergedAccounts = enrichedAccounts.map((apiAccount) => {
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

        // Holdings mappings for investment accounts (preserve from cache)
        holdingsMappings: existing?.holdingsMappings || {},

        // Credit limit sync state for credit card accounts (preserve from cache)
        lastSyncedCreditLimit: existing?.lastSyncedCreditLimit ?? null,

        // Balance checkpoint for balance reconstruction (preserve from cache)
        balanceCheckpoint: existing?.balanceCheckpoint || null,

        // Transaction notes setting (preserve from cache, default to false for new accounts)
        storeTransactionDetailsInNotes: existing?.storeTransactionDetailsInNotes ?? false,

        // Transaction retention settings (preserve from cache)
        transactionRetentionDays: existing?.transactionRetentionDays ?? null,
        transactionRetentionCount: existing?.transactionRetentionCount ?? null,
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
 * Enrich credit card account nicknames with actual card last 4 digits
 * For credit cards that need nickname enrichment (no user-set nickname),
 * fetches the credit card summary to get the actual card's last 4 digits
 * @param {Array} accounts - Array of account objects from fetchAccounts
 * @returns {Promise<Array>} Array of accounts with enriched nicknames
 */
async function enrichCreditCardNicknames(accounts) {
  const enrichedAccounts = [];

  for (const account of accounts) {
    if (account.needsNicknameEnrichment) {
      try {
        debugLog(`Enriching credit card nickname for account ${account.id}...`);
        const creditCardSummary = await fetchCreditCardAccountSummary(account.id);

        // Get the first card's last 4 digits
        const cardLast4 = creditCardSummary.currentCards?.[0]?.cardNumberLast4Digits;

        if (cardLast4) {
          // Update nickname with actual card last 4 digits
          const enrichedNickname = generateAccountName(account.type, cardLast4);
          debugLog(`Enriched credit card nickname: ${enrichedNickname}`);

          enrichedAccounts.push({
            ...account,
            nickname: enrichedNickname,
            needsNicknameEnrichment: false, // Mark as enriched
          });
        } else {
          debugLog(`No card last 4 digits found for account ${account.id}, using default nickname`);
          enrichedAccounts.push(account);
        }
      } catch (error) {
        debugLog(`Failed to enrich credit card nickname for ${account.id}:`, error);
        // Keep original account data if enrichment fails
        enrichedAccounts.push(account);
      }
    } else {
      // Non-credit card accounts or accounts with user nicknames - no enrichment needed
      enrichedAccounts.push(account);
    }
  }

  return enrichedAccounts;
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
        const unifiedType = account.unifiedAccountType || account.type;

        // For accounts with user-set nicknames, use them
        // For accounts without nicknames, generate default name using last 4 of account ID
        // Note: For credit cards, fetchAndCacheWealthsimpleAccounts will update
        // the nickname with the actual card's last 4 digits
        const nickname = account.nickname || generateAccountName(unifiedType, account.id.slice(-4));

        return {
          id: account.id,
          type: unifiedType,
          nickname,
          // Flag to indicate if this account needs nickname enrichment (credit card without user nickname)
          needsNicknameEnrichment: !account.nickname && unifiedType === 'CREDIT_CARD',
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
 * Handles credit cards separately using FetchCreditCardAccountSummary API
 * since FetchAccountCombinedFinancialsPreload doesn't work for credit cards
 *
 * @param {Array<Object>} accounts - Array of account objects with {id, type} properties
 * @returns {Promise<Object>} Object with success status and balances map
 */
export async function fetchAccountBalances(accounts) {
  try {
    if (!accounts || accounts.length === 0) {
      debugLog('No accounts provided for balance fetch');
      return { success: false, balances: new Map(), error: 'No accounts provided' };
    }

    debugLog(`Fetching balances for ${accounts.length} Wealthsimple account(s)...`);

    // Separate credit cards from other accounts
    const creditCardAccounts = accounts.filter((acc) => acc.type === 'CREDIT_CARD');
    const otherAccounts = accounts.filter((acc) => acc.type !== 'CREDIT_CARD');

    debugLog(`Account split: ${creditCardAccounts.length} credit card(s), ${otherAccounts.length} other account(s)`);

    const balances = new Map();

    // Fetch credit card balances using FetchCreditCardAccountSummary
    if (creditCardAccounts.length > 0) {
      debugLog(`Fetching balances for ${creditCardAccounts.length} credit card(s)...`);

      for (const creditCard of creditCardAccounts) {
        try {
          const summary = await fetchCreditCardAccountSummary(creditCard.id);

          if (summary?.balance?.current !== undefined) {
            const amount = parseFloat(summary.balance.current);

            if (!isNaN(amount)) {
              // Negate credit card balance: Wealthsimple returns positive (amount owed),
              // but Monarch expects negative (liability)
              const negatedAmount = -amount;
              balances.set(creditCard.id, {
                amount: negatedAmount,
                currency: creditCard.currency || 'CAD', // Default to CAD for credit cards
              });
              debugLog(`Fetched credit card balance for ${creditCard.id}: ${negatedAmount} (raw: ${amount})`);
            } else {
              debugLog(`Invalid credit card balance data for ${creditCard.id}`);
              balances.set(creditCard.id, null);
            }
          } else {
            debugLog(`No balance data in credit card summary for ${creditCard.id}`);
            balances.set(creditCard.id, null);
          }
        } catch (error) {
          debugLog(`Error fetching credit card balance for ${creditCard.id}:`, error);
          balances.set(creditCard.id, null);
        }
      }
    }

    // Fetch other account balances using FetchAccountCombinedFinancialsPreload
    if (otherAccounts.length > 0) {
      debugLog(`Fetching balances for ${otherAccounts.length} non-credit-card account(s)...`);

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
        ids: otherAccounts.map((acc) => acc.id),
      };

      const response = await makeGraphQLQuery('FetchAccountCombinedFinancialsPreload', query, variables);

      if (response && response.accounts) {
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
      } else {
        debugLog('No accounts data in balance response for non-credit-card accounts');
        // Set null for all non-credit-card accounts that failed
        otherAccounts.forEach((acc) => {
          if (!balances.has(acc.id)) {
            balances.set(acc.id, null);
          }
        });
      }
    }

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
 * @param {string} accountType - Account type (e.g., 'CREDIT_CARD', 'MANAGED_TFSA')
 * @param {string} currency - Account currency (e.g., 'CAD')
 * @returns {Promise<Object>} Account balance data
 */
export async function fetchAccountBalance(accountId, accountType = null, currency = 'CAD') {
  try {
    debugLog(`Fetching balance for Wealthsimple account ${accountId}...`);

    // Use the batch API for single account - pass account object with type info
    const result = await fetchAccountBalances([{
      id: accountId,
      type: accountType,
      currency,
    }]);

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
 * Fetch investment positions for a specific account
 * Uses the FetchIdentityPositions GraphQL query
 * @param {string} accountId - Wealthsimple account ID
 * @returns {Promise<Array>} Array of position objects with full security details
 */
export async function fetchIdentityPositions(accountId) {
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

    const variables = {
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

    const allPositions = [];
    let cursor = null;
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
 * Fetch extended order details for a stock/options order
 * Used to get detailed fill information, fees, exchange rates, and timestamps for orders
 *
 * @param {string} branchId - Branch identifier (e.g., "TR" for Trade)
 * @param {string} externalId - Order ID (e.g., "order-3f73016b-5af3-4f03-ba22-9ef5e45fbb3d")
 * @returns {Promise<Object|null>} Extended order details or null if not found
 */
export async function fetchExtendedOrder(branchId, externalId) {
  try {
    if (!branchId) {
      debugLog('No branch ID provided for extended order fetch');
      return null;
    }

    if (!externalId) {
      debugLog('No external ID provided for extended order fetch');
      return null;
    }

    debugLog(`Fetching extended order details for ${externalId} (branch: ${branchId})...`);

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
  fetchIdentityPositions,
  fetchCreditCardAccountSummary,
  fetchFundingIntents,
  fetchInternalTransfer,
  fetchFundsTransfer,
  fetchExtendedOrder,
  fetchShortOptionPositionExpiryDetail,
  fetchAccountsWithBalance,
};
