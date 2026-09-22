/**
 * Questrade API client
 * Handles all communication with Questrade's API endpoints
 */

import { API, STORAGE, TRANSACTION_RETENTION_DEFAULTS } from '../core/config';
import { debugLog } from '../core/utils';
import stateManager from '../core/state';
import authService from '../services/questrade/auth';

// ============================================================
// Interfaces
// ============================================================

interface QuestradeAuthStatus {
  authenticated: boolean;
  token: string | null;
  [key: string]: unknown;
}

interface QuestradeApiAccount {
  key: string;
  nickname?: string;
  name?: string;
  number?: string;
  type?: string;
  accountDetailType?: string;
  accountType?: string;
  productType?: string;
  accountStatus?: string;
  [key: string]: unknown;
}

interface QuestradeConsolidatedAccount {
  questradeAccount: {
    id: string;
    key: string;
    nickname: string;
    number?: string;
    type?: string;
    accountDetailType?: string;
    accountType?: string;
    productType?: string;
    accountStatus?: string;
    [key: string]: unknown;
  };
  monarchAccount: Record<string, unknown> | null;
  syncEnabled: boolean;
  lastSyncDate: string | null;
  uploadedTransactions: Array<{ id: string; date?: string }>;
  holdingsMappings: Record<string, unknown>;
  transactionRetentionDays: number;
  transactionRetentionCount: number;
  storeTransactionDetailsInNotes: boolean;
  successfulSyncCount: number;
  isOrphanedFromApi?: boolean;
}

interface QuestradeTransaction {
  transactionDate?: string;
  [key: string]: unknown;
}

interface FetchTransactionsPageOptions {
  limit?: number;
  nextLink?: string | null;
}

// ============================================================
// Functions
// ============================================================

/**
 * Upper bound on how much of a response body is quoted into an error message.
 * Enough to identify an error page, not enough to paste a whole one into a toast.
 */
const ERROR_BODY_MAX_LENGTH = 500;

/**
 * Parse a success-status response body, turning an unparseable body into a
 * diagnosable error instead of a raw `SyntaxError`.
 *
 * A 2xx whose body is not JSON is a real failure mode, not a theoretical one: a
 * WAF or CDN HTML error page, a captive-portal or proxy interstitial, a
 * rate-limit page, and a truncated body all arrive with a success status. The
 * body is the only evidence of which of those happened, so a bounded excerpt of
 * it travels with the error.
 *
 * @param endpoint - Endpoint path, to identify which call failed
 * @param responseText - Raw response body
 * @returns The parsed body
 * @throws When the body is not JSON
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseQuestradeResponseBody(endpoint: string, responseText: string | undefined): any {
  try {
    return JSON.parse(responseText as string);
  } catch (error) {
    const excerpt = (responseText || '').slice(0, ERROR_BODY_MAX_LENGTH);
    throw new Error(
      `Questrade API Error: ${endpoint} returned a success status with a body that is not JSON `
      + `(${(error as Error).message})${excerpt ? ` — ${excerpt}` : ''}`,
      { cause: error },
    );
  }
}

/**
 * Make an API call to the Questrade API
 * Automatically waits for the auth token with retry/backoff if not immediately available.
 * @param endpoint - API endpoint to call
 * @param requiredPermissions - List of required permissions for the token
 * @returns Response data
 */
export async function makeQuestradeApiCall(endpoint: string, requiredPermissions: string[] = [
  'brokerage.balances.all',
  'brokerage.account-transactions.read',
  'brokerage.accounts.read',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
]): Promise<any> {
  // Get token from auth service
  let authStatus = authService.checkQuestradeAuth(requiredPermissions);
  if (!authStatus.authenticated) {
    // Token not immediately available — wait with retry/backoff
    // This handles the race condition after login where sessionStorage
    // hasn't been populated yet by the OIDC library
    debugLog('Auth token not immediately available, waiting with retry...');
    const token = await authService.waitForQuestradeToken(requiredPermissions);
    if (!token) {
      throw new Error('Questrade auth token not found. Please ensure you are logged in to Questrade.');
    }
    authStatus = authService.checkQuestradeAuth(requiredPermissions);
  }

  const fullUrl = `${API.QUESTRADE_BASE_URL}${endpoint}`;
  debugLog(`Making Questrade API call to: ${fullUrl}`);

  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: 'GET',
      url: fullUrl,
      headers: { Authorization: authStatus.token },
      // Everything this handler does sits inside one try/catch. The handler runs
      // asynchronously, outside the Promise executor's synchronous flow, so a
      // throw here escapes the Promise instead of rejecting it: neither `resolve`
      // nor `reject` ever runs, the promise never settles, and every awaiting
      // caller hangs forever with no error. No request timeout is configured, so
      // nothing ever breaks that hang. The catch is deliberately broad rather
      // than wrapped around the parse alone, because *any* throw has that effect
      // — a throwing auth helper just as much as `JSON.parse`.
      onload: (res: Tampermonkey.Response<unknown>) => {
        try {
          if (res.status === 401) {
            // Token is invalid or expired, clear auth state
            authService.saveQuestradeToken(null);
            stateManager.setQuestradeAuth(null);
            reject(new Error('Questrade Auth Error (401): Token was invalid or expired. Please refresh the page.'));
          } else if (res.status >= 200 && res.status < 300) {
            resolve(parseQuestradeResponseBody(endpoint, res.responseText));
          } else {
            reject(new Error(`Questrade API Error: Received status ${res.status} from ${endpoint}`));
          }
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      },
      onerror: () => {
        debugLog('GM_xmlhttpRequest error');
        reject(new Error('A network error occurred while contacting the Questrade API.'));
      },
    });
  });
}

/**
 * Fetch and cache Questrade accounts list with consolidated structure.
 * @returns Array of consolidated account objects
 */
export async function fetchAndCacheQuestradeAccounts(): Promise<QuestradeConsolidatedAccount[]> {
  try {
    debugLog('Fetching Questrade accounts list from API...');
    const response = await makeQuestradeApiCall('/v2/brokerage-accounts');

    // Check if accounts is in the expected format
    let apiAccounts: QuestradeApiAccount[] = [];
    if (response && Array.isArray(response)) {
      apiAccounts = response;
    } else if (response && response.accounts && Array.isArray(response.accounts)) {
      apiAccounts = response.accounts;
    } else if (response && Array.isArray(response.data)) {
      apiAccounts = response.data;
    }

    if (!apiAccounts || apiAccounts.length === 0) {
      debugLog('No accounts found in API response:', response);
      return [];
    }

    debugLog(`Fetched ${apiAccounts.length} accounts from Questrade API`);

    // Get existing cached accounts (consolidated structure)
    const existingAccounts: QuestradeConsolidatedAccount[] = JSON.parse(GM_getValue(STORAGE.ACCOUNTS_LIST, '[]'));

    // Create a map of existing accounts by Questrade account ID (key)
    const existingMap = new Map<string, QuestradeConsolidatedAccount>();
    existingAccounts.forEach((acc) => {
      if (acc.questradeAccount?.id || acc.questradeAccount?.key) {
        const accountId = acc.questradeAccount.id || acc.questradeAccount.key;
        existingMap.set(accountId, acc);
      }
    });

    // Step 1: Merge API data with existing settings for accounts that exist in API
    const mergedAccounts: QuestradeConsolidatedAccount[] = apiAccounts.map((apiAccount) => {
      const accountId = apiAccount.key;
      const existing = existingMap.get(accountId);

      return {
        questradeAccount: {
          id: apiAccount.key,
          key: apiAccount.key,
          nickname: apiAccount.nickname || apiAccount.name || accountId,
          number: apiAccount.number,
          type: apiAccount.type,
          accountDetailType: apiAccount.accountDetailType,
          accountType: apiAccount.accountType,
          productType: apiAccount.productType,
          accountStatus: apiAccount.accountStatus,
          ...apiAccount,
        },
        monarchAccount: existing?.monarchAccount || null,
        syncEnabled: existing?.syncEnabled ?? true,
        lastSyncDate: existing?.lastSyncDate || null,
        uploadedTransactions: existing?.uploadedTransactions || [],
        holdingsMappings: existing?.holdingsMappings || {},
        transactionRetentionDays: existing?.transactionRetentionDays ?? TRANSACTION_RETENTION_DEFAULTS.DAYS,
        transactionRetentionCount: existing?.transactionRetentionCount ?? TRANSACTION_RETENTION_DEFAULTS.COUNT,
        storeTransactionDetailsInNotes: existing?.storeTransactionDetailsInNotes ?? false,
        successfulSyncCount: existing?.successfulSyncCount || 0,
      };
    });

    // Step 2: Find and preserve orphaned accounts
    const apiAccountIds = new Set(apiAccounts.map((a) => a.key));
    existingAccounts.forEach((existing) => {
      const existingId = existing.questradeAccount?.id || existing.questradeAccount?.key;
      if (existingId && !apiAccountIds.has(existingId)) {
        debugLog(`Preserving orphaned account: ${existingId} (${existing.questradeAccount?.nickname || 'Unknown'})`);
        mergedAccounts.push({
          ...existing,
          isOrphanedFromApi: true,
        });
      }
    });

    // Save merged list with consolidated structure
    GM_setValue(STORAGE.ACCOUNTS_LIST, JSON.stringify(mergedAccounts));
    debugLog(`Cached ${mergedAccounts.length} Questrade accounts with consolidated structure`);

    // Return ONLY actual API accounts (not orphans)
    const apiOnlyAccounts = mergedAccounts.filter((acc) => !acc.isOrphanedFromApi);
    debugLog(`Returning ${apiOnlyAccounts.length} active API accounts (${mergedAccounts.length - apiOnlyAccounts.length} orphans saved to storage only)`);
    return apiOnlyAccounts;
  } catch (error) {
    debugLog('Failed to fetch or cache Questrade accounts:', error);
    throw error;
  }
}

/**
 * Get account by ID from consolidated storage
 * @param accountId - Account ID (key) to find
 * @returns Full questradeAccount object or undefined if not found
 * @deprecated Use accountService.getAccountData(INTEGRATIONS.QUESTRADE, accountId).questradeAccount instead
 */
export function getQuestradeAccount(accountId: string): QuestradeApiAccount | undefined {
  const consolidatedAccounts: QuestradeConsolidatedAccount[] = JSON.parse(GM_getValue(STORAGE.ACCOUNTS_LIST, '[]'));
  const consolidated = consolidatedAccounts.find(
    (acc) => acc.questradeAccount?.id === accountId || acc.questradeAccount?.key === accountId,
  );
  return consolidated?.questradeAccount;
}

/**
 * Fetch positions for a specific account
 * @param accountId - Account Id to fetch positions for
 * @param sortBy - Sort order (URL-encoded)
 * @returns Response with data array and metadata
 */
export async function fetchAccountPositions(accountId: string, sortBy: string = '%2BmarketValue'): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!accountId) {
    throw new Error('Account Id is required');
  }

  const endpoint = `/v1/positions?sort-by=${sortBy}&account-uuid=${accountId}`;
  debugLog(`Fetching positions for account: ${accountId}`);
  return makeQuestradeApiCall(endpoint, ['brokerage.positions.read']);
}

/**
 * Fetch orders for a specific account
 * @param accountId - Account Id to fetch orders for
 * @param fromDate - Start date in ISO format
 * @param statusGroup - Status group filter
 * @param limit - Maximum number of orders to fetch
 * @param sortBy - Sort order
 * @returns Response with data array and metadata
 */
export async function fetchAccountOrders(
  accountId: string,
  fromDate: string,
  statusGroup: string = 'All',
  limit: number = 1000,
  sortBy: string = '-createdDateTime',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  if (!accountId) {
    throw new Error('Account Id is required');
  }

  if (!fromDate) {
    throw new Error('From date is required');
  }

  const endpoint = `/v1/orders?from-date=${fromDate}&status-group=${statusGroup}&limit=${limit}&sort-by=${sortBy}&account-uuid=${accountId}`;
  debugLog(`Fetching orders for account: ${accountId} from ${fromDate}`);
  return makeQuestradeApiCall(endpoint, ['brokerage.orders.all']);
}

/**
 * Check token status and update state
 * @returns Token info if valid
 */
export function checkTokenStatus(): QuestradeAuthStatus | null {
  return authService.checkQuestradeAuth();
}

/**
 * Get token from auth service
 * @returns Token info if valid
 */
export function getToken(): unknown {
  return authService.getQuestradeToken();
}

/**
 * Fetch a single page of account transactions (activity)
 * @param accountId - Account ID (key/UUID)
 * @param options - Pagination options
 * @returns Response with data array and metadata
 */
export async function fetchAccountTransactionsPage(accountId: string, options: FetchTransactionsPageOptions = {}): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!accountId) {
    throw new Error('Account ID is required');
  }

  const { limit = 100, nextLink = null } = options;

  let endpoint: string;
  if (nextLink) {
    endpoint = nextLink;
  } else {
    // No `orderBy`: the endpoint does not honour one. Verified against the live
    // API on 2026-09-22 — `orderBy=%2BTradeDate`, `orderBy=-TradeDate` and
    // omitting the parameter all return byte-identical newest-first pages, and
    // the `nextLink` cursor does not carry the parameter forward. `TradeDate` is
    // not even a field this endpoint returns (`transactionDate` is the only date
    // present), so the parameter was inert. It is dropped rather than left in
    // place implying an ordering guarantee the server does not actually give.
    endpoint = `/v3/brokerage-accounts-transactions/${accountId}/transactions?fields=AccountDetailType&fields=Action&fields=Symbol&fields=Quantity&fields=Price&limit=${limit}`;
  }

  debugLog(`Fetching transactions page for account: ${accountId}`);
  return makeQuestradeApiCall(endpoint, ['brokerage.account-transactions.read']);
}

/**
 * Fetch full details for a single transaction
 * @param transactionUrl - The transactionUrl from a transaction object
 * @returns Full transaction details
 */
export async function fetchTransactionDetails(transactionUrl: string): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!transactionUrl) {
    throw new Error('Transaction URL is required');
  }

  debugLog(`Fetching transaction details: ${transactionUrl}`);
  return makeQuestradeApiCall(transactionUrl, ['brokerage.account-transactions.read']);
}

/**
 * Fetch all transactions for an account since a given date
 *
 * Stopping before the end of the history is an optimisation that depends on the
 * endpoint returning newest-first. That ordering is a server-side default this
 * client cannot request (see `fetchAccountTransactionsPage`), so it is treated as
 * an assumption to check rather than a fact: the short-circuit is only applied to
 * a page whose dates are actually non-increasing. A page that arrives in any other
 * order paginates to the end instead, which is slower but cannot silently drop
 * transactions if Questrade ever changes the default.
 *
 * @param accountId - Account ID (key/UUID)
 * @param sinceDate - Date string in YYYY-MM-DD format
 * @param pageSize - Number of transactions per page
 * @returns Array of transactions with transactionDate >= sinceDate
 */
export async function fetchAccountTransactionsSinceDate(
  accountId: string,
  sinceDate: string,
  pageSize: number = 100,
): Promise<QuestradeTransaction[]> {
  if (!accountId) {
    throw new Error('Account ID is required');
  }

  if (!sinceDate) {
    throw new Error('Since date is required');
  }

  debugLog(`Fetching transactions for account ${accountId} since ${sinceDate}`);

  const allTransactions: QuestradeTransaction[] = [];
  let nextLink: string | null = null;
  let hasMore = true;

  while (hasMore) {
    const response = await fetchAccountTransactionsPage(accountId, {
      limit: pageSize,
      nextLink,
    });

    if (!response || !response.data) {
      debugLog('Invalid API response:', response);
      break;
    }

    const { data, metadata } = response;

    // Scan the whole page. An older row ends the *pagination*, not the scan of the
    // page it appeared on: bailing out mid-page would discard every later row,
    // including rows that qualify, the moment one row sorts unexpectedly.
    const pageDates: string[] = [];
    let sawOlderTransaction = false;

    for (const transaction of data) {
      const txDate = transaction.transactionDate;

      if (!txDate) {
        // Undatable against the watermark, so it cannot be included — but it is
        // logged rather than dropped in silence, since `transactionDate` is the
        // only date this endpoint returns and its absence would be anomalous.
        debugLog('Transaction has no transactionDate, excluding it:', transaction.transactionUuid ?? transaction);
        continue;
      }

      pageDates.push(txDate);

      if (txDate >= sinceDate) {
        allTransactions.push(transaction);
      } else {
        sawOlderTransaction = true;
      }
    }

    const pageIsNewestFirst = pageDates.every((date, index) => index === 0 || date <= pageDates[index - 1]);

    if (!metadata?.nextLink) {
      hasMore = false;
    } else if (sawOlderTransaction && pageIsNewestFirst) {
      // Newest-first confirmed for this page, so every later page is older still.
      hasMore = false;
    } else {
      if (!pageIsNewestFirst) {
        debugLog('Transaction page was not newest-first; paginating to the end rather than stopping early');
      }
      nextLink = metadata.nextLink;
    }
  }

  debugLog(`Fetched ${allTransactions.length} transactions since ${sinceDate}`);
  return allTransactions;
}

/**
 * Fetch ALL transactions for an account (for initial/full sync)
 * @param accountId - Account ID (key/UUID)
 * @param pageSize - Number of transactions per page (max 1000)
 * @returns Complete array of all transactions
 */
export async function fetchAllAccountTransactions(
  accountId: string,
  pageSize: number = 1000,
): Promise<QuestradeTransaction[]> {
  if (!accountId) {
    throw new Error('Account ID is required');
  }

  debugLog(`Fetching all transactions for account ${accountId}`);

  const allTransactions: QuestradeTransaction[] = [];
  let nextLink: string | null = null;
  let hasMore = true;
  let pageCount = 0;

  while (hasMore) {
    pageCount += 1;
    const response = await fetchAccountTransactionsPage(accountId, {
      limit: pageSize,
      nextLink,
    });

    if (!response || !response.data) {
      debugLog('Invalid API response:', response);
      break;
    }

    const { data, metadata } = response;
    allTransactions.push(...data);

    debugLog(`Fetched page ${pageCount}: ${data.length} transactions (total: ${allTransactions.length})`);

    if (metadata?.nextLink) {
      nextLink = metadata.nextLink;
    } else {
      hasMore = false;
    }
  }

  debugLog(`Fetched ${allTransactions.length} total transactions across ${pageCount} pages`);
  return allTransactions;
}

// Export as default object
export default {
  makeApiCall: makeQuestradeApiCall,
  fetchAccounts: fetchAndCacheQuestradeAccounts,
  getAccount: getQuestradeAccount,
  fetchPositions: fetchAccountPositions,
  fetchOrders: fetchAccountOrders,
  fetchTransactionsPage: fetchAccountTransactionsPage,
  fetchTransactionDetails,
  fetchTransactionsSinceDate: fetchAccountTransactionsSinceDate,
  fetchAllTransactions: fetchAllAccountTransactions,
  checkTokenStatus,
  getToken,
};