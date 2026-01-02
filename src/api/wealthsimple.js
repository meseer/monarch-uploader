/**
 * Wealthsimple API Client
 * Handles API communication with Wealthsimple
 */

import { debugLog } from '../core/utils';
import { STORAGE } from '../core/config';

/**
 * Check if user is authenticated with Wealthsimple
 * @returns {Object} Authentication status
 */
export function checkAuth() {
  const token = GM_getValue(STORAGE.WEALTHSIMPLE_AUTH_TOKEN);

  return {
    authenticated: Boolean(token),
    token: token || null,
  };
}

/**
 * Save authentication token
 * @param {string} token - Authentication token
 */
export function saveToken(token) {
  if (token) {
    GM_setValue(STORAGE.WEALTHSIMPLE_AUTH_TOKEN, token);
    debugLog('Wealthsimple auth token saved');
  } else {
    GM_deleteValue(STORAGE.WEALTHSIMPLE_AUTH_TOKEN);
    debugLog('Wealthsimple auth token cleared');
  }
}

/**
 * Setup token monitoring to capture Wealthsimple authentication
 * Monitors localStorage and network requests for auth tokens
 */
export function setupTokenMonitoring() {
  debugLog('Setting up Wealthsimple token monitoring...');

  // Check localStorage for existing token
  const checkLocalStorage = () => {
    try {
      // Wealthsimple typically stores tokens in localStorage
      // Common patterns: auth_token, accessToken, authorization, etc.
      const storageKeys = Object.keys(localStorage);

      for (const key of storageKeys) {
        if (key.toLowerCase().includes('auth') ||
            key.toLowerCase().includes('token') ||
            key.toLowerCase().includes('access')) {
          const value = localStorage.getItem(key);
          if (value && typeof value === 'string' && value.length > 20) {
            debugLog(`Found potential Wealthsimple token in localStorage: ${key}`);
            // Store the token for later use
            saveToken(value);
            return value;
          }
        }
      }
    } catch (error) {
      debugLog('Error checking localStorage for Wealthsimple token:', error);
    }
    return null;
  };

  // Check immediately
  checkLocalStorage();

  // Monitor localStorage changes
  window.addEventListener('storage', (event) => {
    if (event.key &&
        (event.key.toLowerCase().includes('auth') ||
         event.key.toLowerCase().includes('token'))) {
      debugLog('Wealthsimple auth token may have changed');
      checkLocalStorage();
    }
  });

  // Intercept XMLHttpRequest to capture auth headers
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function (...args) {
    this.requestUrl = args[1];
    return originalXHROpen.apply(this, args);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (header, value, ...rest) {
    if (this.requestUrl && this.requestUrl.includes('wealthsimple.com')) {
      if (header.toLowerCase() === 'authorization' && value) {
        debugLog('Captured Wealthsimple authorization header');
        saveToken(value);
      }
    }
    return originalXHRSetRequestHeader.apply(this, [header, value, ...rest]);
  };

  debugLog('Wealthsimple token monitoring initialized');
}

/**
 * Make an authenticated API call to Wealthsimple
 * @param {string} endpoint - API endpoint
 * @param {Object} options - Request options
 * @returns {Promise<Object>} API response
 */
export async function makeApiCall(endpoint, options = {}) {
  const authStatus = checkAuth();

  if (!authStatus.authenticated) {
    throw new Error('Wealthsimple auth token not found. Please log in to Wealthsimple.');
  }

  const url = endpoint.startsWith('http') ? endpoint : `https://api.wealthsimple.com${endpoint}`;

  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: options.method || 'GET',
      url,
      headers: {
        Authorization: authStatus.token,
        'Content-Type': 'application/json',
        ...options.headers,
      },
      data: options.data ? JSON.stringify(options.data) : undefined,
      onload: (response) => {
        if (response.status === 401) {
          saveToken(null);
          reject(new Error('Auth token expired. Please refresh the page and log in again.'));
        } else if (response.status === 404) {
          reject(new Error(`Resource not found: ${endpoint}`));
        } else if (response.status >= 500) {
          reject(new Error('Server error. Please try again later.'));
        } else if (response.status >= 200 && response.status < 300) {
          try {
            const data = response.responseText ? JSON.parse(response.responseText) : {};
            resolve(data);
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
 * Fetch all Wealthsimple accounts
 * @returns {Promise<Array>} Array of account objects
 */
export async function fetchAccounts() {
  try {
    debugLog('Fetching Wealthsimple accounts...');

    // This endpoint may vary - needs to be verified with actual Wealthsimple API
    const response = await makeApiCall('/v1/accounts');

    debugLog(`Fetched ${response.results?.length || 0} Wealthsimple accounts`);
    return response.results || [];
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

    const response = await makeApiCall(`/v1/accounts/${accountId}`);

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
 * @param {Object} options - Query options (startDate, endDate, limit)
 * @returns {Promise<Array>} Array of transactions
 */
export async function fetchTransactions(accountId, options = {}) {
  try {
    debugLog(`Fetching transactions for Wealthsimple account ${accountId}...`);

    const queryParams = new URLSearchParams();
    if (options.startDate) queryParams.append('start_date', options.startDate);
    if (options.endDate) queryParams.append('end_date', options.endDate);
    if (options.limit) queryParams.append('limit', options.limit);

    const endpoint = `/v1/accounts/${accountId}/transactions?${queryParams.toString()}`;
    const response = await makeApiCall(endpoint);

    debugLog(`Fetched ${response.results?.length || 0} transactions for account ${accountId}`);
    return response.results || [];
  } catch (error) {
    debugLog(`Error fetching transactions for account ${accountId}:`, error);
    throw error;
  }
}

export default {
  checkAuth,
  saveToken,
  setupTokenMonitoring,
  makeApiCall,
  fetchAccounts,
  fetchAccountBalance,
  fetchTransactions,
};
