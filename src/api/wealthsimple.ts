/**
 * Wealthsimple API Client
 * Handles API communication with Wealthsimple GraphQL API
 */

import { debugLog, formatDate } from '../core/utils';
import { STORAGE, API } from '../core/config';
import { INTEGRATIONS } from '../core/integrationCapabilities';
import { getAuth, setAuth, clearAuth as clearConfigAuth } from '../services/common/configStore';
import stateManager from '../core/state';
import { getAccountTypeDisplayName } from '../mappers/wealthsimple-account-types';
import {
  fetchBalanceHistory,
  fetchIdentityPositions,
} from './wealthsimplePositions';
import {
  fetchFundingIntents,
  fetchFundingIntentStatusSummary,
  fetchCreditCardAccountSummary,
  fetchInternalTransfer,
  fetchFundsTransfer,
  fetchActivityByOrdersServiceOrderId,
  fetchExtendedOrder,
  fetchCorporateActionChildActivities,
  fetchShortOptionPositionExpiryDetail,
  fetchSecurity,
  fetchManagedPortfolioPositions,
  fetchAccountsWithBalance,
  fetchSpendTransactions,
  fetchCryptoOrder,
} from './wealthsimpleQueries';

//    Interfaces

export interface WealthsimpleTokenData {
  accessToken: string;
  identityId: string;
  expiresAt: string;
  investProfile?: string | null;
  tradeProfile?: string | null;
  email?: string | null;
}

export interface WealthsimpleAuthStatus {
  authenticated: boolean;
  token?: string | null;
  identityId?: string | null;
  expiresAt?: string | null;
  expired?: boolean;
  investProfile?: string | null;
  tradeProfile?: string | null;
}

export interface WealthsimpleApiAccount {
  id: string;
  type: string;
  nickname: string;
  needsNicknameEnrichment: boolean;
  currency: string;
  branch?: string;
  rawType?: string;
  createdAt?: string;
}

export interface WealthsimpleConsolidatedAccount {
  wealthsimpleAccount: WealthsimpleApiAccount;
  monarchAccount: Record<string, unknown> | null;
  syncEnabled: boolean;
  lastSyncDate: string | null;
  uploadedTransactions: Array<{ id: string; date?: string }>;
  stripStoreNumbers: boolean;
  holdingsMappings: Record<string, unknown>;
  lastSyncedCreditLimit: number | null;
  balanceCheckpoint: Record<string, unknown> | null;
  storeTransactionDetailsInNotes: boolean;
  transactionRetentionDays: number | null;
  transactionRetentionCount: number | null;
}

export interface WealthsimpleBalanceResult {
  amount: number;
  currency: string;
}

export interface WealthsimpleBalancesResponse {
  success: boolean;
  balances: Map<string, WealthsimpleBalanceResult | null>;
  error?: string;
}

export interface WealthsimpleTransaction {
  accountId?: string;
  canonicalId?: string;
  amount?: string;
  currency?: string;
  type?: string;
  subType?: string;
  status?: string;
  occurredAt?: string;
  spendMerchant?: string;
  assetSymbol?: string;
  assetQuantity?: string;
  securityId?: string;
  [key: string]: unknown;
}

//    Functions

/**
 * Parse Wealthsimple OAuth cookie and extract token data
 * @returns Parsed token data or null
 */
function parseOAuthCookie(): WealthsimpleTokenData | null {
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
 * Writes to configStore only
 * @param tokenData - Token data to save
 */
function saveTokenData(tokenData: WealthsimpleTokenData | null): void {
  if (tokenData) {
    const authData: Record<string, unknown> = {
      accessToken: tokenData.accessToken,
      identityId: tokenData.identityId,
      expiresAt: tokenData.expiresAt,
    };
    if (tokenData.investProfile) {
      authData.investProfile = tokenData.investProfile;
    }
    if (tokenData.tradeProfile) {
      authData.tradeProfile = tokenData.tradeProfile;
    }
    setAuth(INTEGRATIONS.WEALTHSIMPLE, authData);

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
function clearTokenData(): void {
  clearConfigAuth(INTEGRATIONS.WEALTHSIMPLE);

  debugLog('Wealthsimple token data cleared');

  // Update state manager
  stateManager.setWealthsimpleAuth(null);
}

/**
 * Get stored Wealthsimple token data
 * Reads from configStore only
 * @returns Token data or null
 */
function getStoredTokenData(): WealthsimpleTokenData | null {
  const configAuth = getAuth(INTEGRATIONS.WEALTHSIMPLE);
  if (configAuth.accessToken && configAuth.identityId) {
    return {
      accessToken: configAuth.accessToken as string,
      identityId: configAuth.identityId as string,
      expiresAt: configAuth.expiresAt as string,
      investProfile: (configAuth.investProfile as string) || null,
      tradeProfile: (configAuth.tradeProfile as string) || null,
    };
  }

  return null;
}

/**
 * Check if token is expired
 * @param expiresAt - ISO timestamp
 * @returns True if expired
 */
function isTokenExpired(expiresAt: string | undefined): boolean {
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
 * @returns Authentication status
 */
export function checkAuth(): WealthsimpleAuthStatus {
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
let tokenCheckIntervalId: ReturnType<typeof setInterval> | null = null;
let tokenFound = false;

/**
 * Setup token monitoring to capture Wealthsimple authentication from cookie
 * Uses fast polling (1 second) initially until token is found,
 * then switches to slower maintenance polling (30 seconds)
 */
export function setupTokenMonitoring(): void {
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
 * @param operationName - GraphQL operation name
 * @param query - GraphQL query string
 * @param variables - Query variables
 * @returns API response data
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function makeGraphQLQuery(operationName: string, query: string, variables: Record<string, any> = {}): Promise<any> {
  const authStatus = checkAuth();

  if (!authStatus.authenticated) {
    throw new Error('Wealthsimple auth token not found. Please refresh the page.');
  }

  // Inject identity ID into variables if not present
  // Note: FetchFundingIntent, FetchInternalTransfer, FetchFundsTransfer, FetchSoOrdersExtendedOrder, and FetchActivityByOrdersServiceOrderId don't accept identityId and return 403 if it's passed
  const skipIdentityInjection = ['FetchFundingIntent', 'FetchFundingIntentStatusSummary', 'FetchInternalTransfer', 'FetchFundsTransfer', 'FetchSoOrdersExtendedOrder', 'FetchActivityByOrdersServiceOrderId', 'FetchCryptoOrder'];
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
            reject(new Error(`Failed to parse response: ${(error as Error).message}`));
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
 * @returns Token info
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function validateToken(): Promise<any> {
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
            reject(new Error(`Failed to parse token info: ${(error as Error).message}`));
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
 * @param unifiedType - Unified account type (e.g., 'CREDIT_CARD', 'MANAGED_TFSA')
 * @param last4 - Last 4 digits/characters to display
 * @returns Generated account name
 */
function generateAccountName(unifiedType: string, last4: string): string {
  const displayName = getAccountTypeDisplayName(unifiedType);
  return `Wealthsimple ${displayName} (${last4})`;
}

/**
 * Fetch and cache Wealthsimple accounts list with consolidated structure
 * Merges with existing cached list to preserve monarch mappings, sync settings, and transaction history
 * For credit cards without user nicknames, enriches the name with actual card last 4 digits
 * @returns Array of consolidated account objects
 */
export async function fetchAndCacheWealthsimpleAccounts(): Promise<WealthsimpleConsolidatedAccount[]> {
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
 * @param accounts - Array of account objects from fetchAccounts
 * @returns Array of accounts with enriched nicknames
 */
async function enrichCreditCardNicknames(accounts: WealthsimpleApiAccount[]): Promise<WealthsimpleApiAccount[]> {
  const enrichedAccounts: WealthsimpleApiAccount[] = [];

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
 * @returns Array of account objects
 */
export async function fetchAccounts(): Promise<WealthsimpleApiAccount[]> {
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
 * @param accounts - Array of account objects with {id, type} properties
 * @returns Object with success status and balances map
 */
export async function fetchAccountBalances(accounts: Array<{ id: string; type?: string | null; currency?: string }>): Promise<WealthsimpleBalancesResponse> {
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
            const amount = typeof summary.balance.current === 'string' ? parseFloat(summary.balance.current) : summary.balance.current;

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
    return { success: false, balances: new Map(), error: (error as Error).message };
  }
}

/**
 * Fetch account balance for a specific account
 * @param accountId - Account ID
 * @param accountType - Account type (e.g., 'CREDIT_CARD', 'MANAGED_TFSA')
 * @param currency - Account currency (e.g., 'CAD')
 * @returns Account balance data
 */
export async function fetchAccountBalance(accountId: string, accountType: string | null = null, currency: string = 'CAD'): Promise<WealthsimpleBalanceResult> {
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
 * @param accountId - Account ID
 * @param startDate - Start date in YYYY-MM-DD format (local timezone)
 * @returns Array of transaction objects with all Activity fields
 */
export async function fetchTransactions(accountId: string, startDate: string): Promise<WealthsimpleTransaction[]> {
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

    const allTransactions: WealthsimpleTransaction[] = [];
    let cursor: string | null = null;
    let hasNextPage = true;
    let pageCount = 0;

    // Set endDate to current moment in ISO format
    const endDate = new Date().toISOString();

    while (hasNextPage) {
      pageCount += 1;
      debugLog(`Fetching page ${pageCount} of transactions...`);

      const variables: Record<string, unknown> = {
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

// Re-export types and functions from sub-modules for named import consumers
export {
  type BalanceHistoryRecord,
  type PositionNode,
  fetchBalanceHistory,
  fetchIdentityPositions,
} from './wealthsimplePositions';

export {
  type FundingIntentNode,
  type CreditCardAccountSummary,
  type InternalTransferDetails,
  type FundsTransferDetails,
  type ActivityByOrderData,
  type ExtendedOrderData,
  type CorporateActionChildActivity,
  type ShortOptionExpiryDetail,
  type SecurityDetails,
  type ManagedPortfolioPosition,
  type AccountCashBalances,
  type SpendTransactionDetails,
  type FundingIntentStatusSummaryData,
  type CryptoOrderDetails,
  fetchFundingIntents,
  fetchFundingIntentStatusSummary,
  fetchCreditCardAccountSummary,
  fetchInternalTransfer,
  fetchFundsTransfer,
  fetchActivityByOrdersServiceOrderId,
  fetchExtendedOrder,
  fetchCorporateActionChildActivities,
  fetchShortOptionPositionExpiryDetail,
  fetchSecurity,
  fetchManagedPortfolioPositions,
  fetchAccountsWithBalance,
  fetchSpendTransactions,
  fetchCryptoOrder,
} from './wealthsimpleQueries';

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
  fetchManagedPortfolioPositions,
  fetchCreditCardAccountSummary,
  fetchFundingIntents,
  fetchFundingIntentStatusSummary,
  fetchInternalTransfer,
  fetchFundsTransfer,
  fetchExtendedOrder,
  fetchActivityByOrdersServiceOrderId,
  fetchCorporateActionChildActivities,
  fetchShortOptionPositionExpiryDetail,
  fetchSecurity,
  fetchAccountsWithBalance,
  fetchSpendTransactions,
  fetchCryptoOrder,
};
