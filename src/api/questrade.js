/**
 * Questrade API client
 * Handles all communication with Questrade's API endpoints
 */

import { API, STORAGE } from '../core/config';
import { debugLog } from '../core/utils';
import stateManager from '../core/state';
import authService from '../services/auth';

/**
 * Make an API call to the Questrade API
 * @param {string} endpoint - API endpoint to call
 * @returns {Promise<Object>} Response data
 */
export async function makeQuestradeApiCall(endpoint) {
  // Get token from auth service
  const authStatus = authService.checkQuestradeAuth();
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
          authService.saveToken('questrade', null);
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
      GM_setValue(STORAGE.ACCOUNTS_LIST, JSON.stringify(accounts));
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
  const accounts = JSON.parse(GM_getValue(STORAGE.ACCOUNTS_LIST, '[]'));
  return accounts.find((acc) => acc.key === accountId);
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

// Export as default object
export default {
  makeApiCall: makeQuestradeApiCall,
  fetchAccounts: fetchAndCacheQuestradeAccounts,
  getAccount: getQuestradeAccount,
  checkTokenStatus,
  getToken,
};
