/**
 * Questrade API client
 * Handles all communication with Questrade's API endpoints
 */

import { API, STORAGE } from '../core/config';
import { debugLog } from '../core/utils';
import stateManager from '../core/state';
import authService from '../services/questrade/auth';

/**
 * Make an API call to the Questrade API
 * @param {string} endpoint - API endpoint to call
 * @param {Array<string>} requiredPermissions - List of required permissions for the token
 * @returns {Promise<Object>} Response data
 */
export async function makeQuestradeApiCall(endpoint, requiredPermissions = [
  'brokerage.balances.all',
  'brokerage.account-transactions.read',
  'brokerage.accounts.read',
]) {
  // Get token from auth service
  const authStatus = authService.checkQuestradeAuth(requiredPermissions);
  if (!authStatus.authenticated) {
    throw new Error('Questrade auth token not found. Please ensure you are logged in to Questrade.');
  }

  const fullUrl = `${API.QUESTRADE_BASE_URL}${endpoint}`;
  debugLog(`Making Questrade API call to: ${fullUrl}`);

  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: 'GET',
      url: fullUrl,
      headers: { Authorization: authStatus.token },
      onload: (res) => {
        if (res.status === 401) {
          // Token is invalid or expired, clear auth state
          authService.saveQuestradeToken(null);
          stateManager.setQuestradeAuth(null);
          reject(new Error('Questrade Auth Error (401): Token was invalid or expired. Please refresh the page.'));
        } else if (res.status >= 200 && res.status < 300) {
          resolve(JSON.parse(res.responseText));
        } else {
          reject(new Error(`Questrade API Error: Received status ${res.status} from ${endpoint}`));
        }
      },
      onerror: (err) => {
        debugLog('GM_xmlhttpRequest error:', err);
        reject(new Error('A network error occurred while contacting the Questrade API.'));
      },
    });
  });
}

/**
 * Fetch and cache the list of Questrade accounts
 * @returns {Promise<Array>} List of accounts
 */
export async function fetchAndCacheQuestradeAccounts() {
  try {
    debugLog('Fetching Questrade accounts list from API...');
    const response = await makeQuestradeApiCall('/v2/brokerage-accounts');

    // Check if accounts is in the expected format (either direct array or in a property)
    let accounts = [];
    if (response && Array.isArray(response)) {
      accounts = response;
    } else if (response && response.accounts && Array.isArray(response.accounts)) {
      accounts = response.accounts;
    } else if (response && Array.isArray(response.data)) {
      accounts = response.data;
    }

    if (accounts && accounts.length > 0) {
      GM_setValue(STORAGE.QUESTRADE_ACCOUNTS_CACHE, JSON.stringify(accounts));
      debugLog(`Successfully fetched and cached ${accounts.length} accounts.`);
      return accounts;
    }

    debugLog('No accounts found in response:', response);
    return [];
  } catch (error) {
    debugLog('Failed to fetch or cache Questrade accounts:', error);
    throw error;
  }
}

/**
 * Get account by ID
 * @param {string} accountId - Account ID to find
 * @returns {Object|undefined} Account object or undefined if not found
 */
export function getQuestradeAccount(accountId) {
  const accounts = JSON.parse(GM_getValue(STORAGE.QUESTRADE_ACCOUNTS_CACHE, '[]'));
  return accounts.find((acc) => acc.key === accountId);
}

/**
 * Fetch positions for a specific account
 * @param {string} accountId - Account Id to fetch positions for
 * @param {string} [sortBy='%2BmarketValue'] - Sort order (URL-encoded, e.g., %2BmarketValue for ascending market value)
 * @returns {Promise<Object>} Response with data array and metadata
 */
export async function fetchAccountPositions(accountId, sortBy = '%2BmarketValue') {
  if (!accountId) {
    throw new Error('Account Id is required');
  }

  const endpoint = `/v1/positions?sort-by=${sortBy}&account-uuid=${accountId}`;
  debugLog(`Fetching positions for account: ${accountId}`);
  return makeQuestradeApiCall(endpoint, ['brokerage.positions.read']);
}

/**
 * Fetch orders for a specific account
 * @param {string} accountId - Account Id to fetch orders for
 * @param {string} fromDate - Start date in ISO format (e.g., '2025-09-12T02:29:57.993Z')
 * @param {string} [statusGroup='All'] - Status group filter (All, Open, Closed, etc.)
 * @param {number} [limit=1000] - Maximum number of orders to fetch
 * @param {string} [sortBy='-createdDateTime'] - Sort order (e.g., '-createdDateTime' for descending)
 * @returns {Promise<Object>} Response with data array and metadata
 */
export async function fetchAccountOrders(accountId, fromDate, statusGroup = 'All', limit = 1000, sortBy = '-createdDateTime') {
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
 * @returns {Object|null} Token info if valid
 */
export function checkTokenStatus() {
  return authService.checkQuestradeAuth();
}

/**
 * Get token from auth service
 * @returns {Object|null} Token info if valid
 */
export function getToken() {
  return authService.getQuestradeToken();
}

/**
 * Fetch a single page of account transactions (activity)
 * @param {string} accountId - Account ID (key/UUID)
 * @param {Object} options - Pagination options
 * @param {number} [options.limit=100] - Number of transactions per page (max 1000)
 * @param {string} [options.nextLink=null] - Next page link from previous response
 * @returns {Promise<Object>} Response with data array and metadata
 */
export async function fetchAccountTransactionsPage(accountId, options = {}) {
  if (!accountId) {
    throw new Error('Account ID is required');
  }

  const { limit = 100, nextLink = null } = options;

  let endpoint;
  if (nextLink) {
    // Use the nextLink directly (it's a relative path)
    endpoint = nextLink;
  } else {
    // Build the initial endpoint
    endpoint = `/v3/brokerage-accounts-transactions/${accountId}/transactions?fields=AccountDetailType&fields=Action&limit=${limit}&orderBy=%2BTradeDate`;
  }

  debugLog(`Fetching transactions page for account: ${accountId}`);
  return makeQuestradeApiCall(endpoint, ['brokerage.accounts.all']);
}

/**
 * Fetch full details for a single transaction
 * @param {string} transactionUrl - The transactionUrl from a transaction object
 * @returns {Promise<Object>} Full transaction details
 */
export async function fetchTransactionDetails(transactionUrl) {
  if (!transactionUrl) {
    throw new Error('Transaction URL is required');
  }

  debugLog(`Fetching transaction details: ${transactionUrl}`);
  return makeQuestradeApiCall(transactionUrl, ['brokerage.accounts.all']);
}

/**
 * Fetch all transactions for an account since a given date
 * Uses pagination and stops when reaching transactions older than sinceDate
 * @param {string} accountId - Account ID (key/UUID)
 * @param {string} sinceDate - Date string in YYYY-MM-DD format
 * @param {number} [pageSize=100] - Number of transactions per page
 * @returns {Promise<Array>} Array of transactions with transactionDate >= sinceDate
 */
export async function fetchAccountTransactionsSinceDate(accountId, sinceDate, pageSize = 100) {
  if (!accountId) {
    throw new Error('Account ID is required');
  }

  if (!sinceDate) {
    throw new Error('Since date is required');
  }

  debugLog(`Fetching transactions for account ${accountId} since ${sinceDate}`);

  const allTransactions = [];
  let nextLink = null;
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

    // Filter transactions that are >= sinceDate
    let foundOlderTransaction = false;
    for (const transaction of data) {
      const txDate = transaction.transactionDate;
      if (txDate && txDate >= sinceDate) {
        allTransactions.push(transaction);
      } else if (txDate && txDate < sinceDate) {
        // Found a transaction older than our cutoff
        foundOlderTransaction = true;
        break;
      }
    }

    // Stop if we found an older transaction or there's no next page
    if (foundOlderTransaction || !metadata?.nextLink) {
      hasMore = false;
    } else {
      nextLink = metadata.nextLink;
    }
  }

  debugLog(`Fetched ${allTransactions.length} transactions since ${sinceDate}`);
  return allTransactions;
}

/**
 * Fetch ALL transactions for an account (for initial/full sync)
 * @param {string} accountId - Account ID (key/UUID)
 * @param {number} [pageSize=1000] - Number of transactions per page (max 1000)
 * @returns {Promise<Array>} Complete array of all transactions
 */
export async function fetchAllAccountTransactions(accountId, pageSize = 1000) {
  if (!accountId) {
    throw new Error('Account ID is required');
  }

  debugLog(`Fetching all transactions for account ${accountId}`);

  const allTransactions = [];
  let nextLink = null;
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
