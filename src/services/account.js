/**
 * Account Service
 * Handles account-related business logic
 */

import { debugLog } from '../core/utils';
import { STORAGE } from '../core/config';
import stateManager from '../core/state';
import questradeApi from '../api/questrade';
import authService from './auth';
import balanceService from './balance';

/**
 * Custom account error class
 */
export class AccountError extends Error {
  constructor(message, accountId) {
    super(message);
    this.name = 'AccountError';
    this.accountId = accountId;
  }
}

/**
 * Load account information for the current URL
 * @returns {Promise<Object>} Account info or null if not found
 */
export async function loadCurrentAccountInfo() {
  try {
    // Extract account ID from URL
    const matches = window.location.pathname.match(/\/accounts\/([^\/]+)/);
    if (!matches || !matches[1]) return null;

    const accountId = matches[1];
    debugLog(`Detected account ID in URL: ${accountId}`);

    // Fetch accounts if not already cached
    let accounts = JSON.parse(GM_getValue(STORAGE.ACCOUNTS_LIST, '[]'));
    if (accounts.length === 0) {
      accounts = await questradeApi.fetchAccounts();
    }

    // Find the account in the list
    const account = accounts.find((acc) => acc.key === accountId);
    if (!account) {
      debugLog(`Account ${accountId} not found in accounts list`);
      return null;
    }

    // Update state with current account
    const accountNickname = account.nickname || account.name;
    stateManager.setAccount(accountId, accountNickname);
    debugLog(`Found account: ${accountNickname}`);

    return account;
  } catch (error) {
    debugLog('Error loading current account:', error);
    return null;
  }
}

/**
 * Get detailed information for an account by ID
 * @param {string} accountId - Account ID to fetch
 * @returns {Promise<Object>} Account details
 */
export async function getAccountDetails(accountId) {
  try {
    if (!accountId) {
      throw new AccountError('Account ID is required', null);
    }

    // Check if auth is valid
    const authStatus = authService.checkQuestradeAuth();
    if (!authStatus.authenticated) {
      throw new AccountError('Not authenticated with Questrade', accountId);
    }

    // Fetch account details
    const account = questradeApi.getAccount(accountId);
    if (!account) {
      // Try to fetch fresh accounts list
      await questradeApi.fetchAccounts();
      const refreshedAccount = questradeApi.getAccount(accountId);

      if (!refreshedAccount) {
        throw new AccountError(`Account ${accountId} not found`, accountId);
      }

      return refreshedAccount;
    }

    return account;
  } catch (error) {
    debugLog(`Error fetching account details for ${accountId}:`, error);
    if (error instanceof AccountError) {
      throw error;
    }
    throw new AccountError(`Failed to get account details: ${error.message}`, accountId);
  }
}

/**
 * Get all available accounts
 * @param {boolean} refresh - Force refresh from API
 * @returns {Promise<Array>} List of accounts
 */
export async function getAllAccounts(refresh = false) {
  try {
    // Check if auth is valid
    const authStatus = authService.checkQuestradeAuth();
    if (!authStatus.authenticated) {
      throw new AccountError('Not authenticated with Questrade');
    }

    if (refresh) {
      // Force fetch from API
      return await questradeApi.fetchAccounts();
    }

    // Try to get from cache first
    const accounts = JSON.parse(GM_getValue(STORAGE.ACCOUNTS_LIST, '[]'));
    if (accounts.length > 0) {
      return accounts;
    }

    // Fetch if cache is empty
    return await questradeApi.fetchAccounts();
  } catch (error) {
    debugLog('Error fetching all accounts:', error);
    if (error instanceof AccountError) {
      throw error;
    }
    throw new AccountError(`Failed to get accounts: ${error.message}`);
  }
}

/**
 * Fetches and uploads balance history for a single account
 * @param {string} accountId - Account ID to process
 * @param {string} accountName - Account name
 * @param {string} fromDate - Start date in YYYY-MM-DD format
 * @param {string} toDate - End date in YYYY-MM-DD format
 * @returns {Promise<boolean>} Success status
 */
export async function processAccountBalanceHistory(accountId, accountName, fromDate, toDate) {
  // Delegate to balance service
  return balanceService.processAndUploadBalance(accountId, accountName, fromDate, toDate);
}

/**
 * Bulk process multiple accounts
 * @param {Array<Object>} accounts - Array of account objects with id and name
 * @param {string} fromDate - Start date in YYYY-MM-DD format
 * @param {string} toDate - End date in YYYY-MM-DD format
 * @returns {Promise<Object>} Results with success and fail counts
 */
export async function bulkProcessAccounts(accounts, fromDate, toDate) {
  // Delegate to balance service comprehensive upload function
  return balanceService.uploadAllAccountsToMonarch();
}

/**
 * Gets a date range for balance history
 * @param {string} accountId - Account ID
 * @param {number} days - Number of days to look back (default: 90)
 * @returns {Object} Object with fromDate and toDate in YYYY-MM-DD format
 */
export function getDateRange(accountId, days = 90) {
  // Delegate to balance service
  return balanceService.getDefaultDateRange(accountId, days);
}

/**
 * Link a Questrade account to a Monarch account
 * @param {string} questradeAccountId - Questrade account ID
 * @param {string} questradeAccountName - Questrade account name
 * @param {Object} monarchAccount - Monarch account object
 * @returns {boolean} Success status
 */
export function linkAccounts(questradeAccountId, questradeAccountName, monarchAccount) {
  try {
    if (!questradeAccountId || !monarchAccount || !monarchAccount.id) {
      throw new AccountError('Invalid account information for mapping', questradeAccountId);
    }

    // Store mapping
    const mappingKey = `${STORAGE.ACCOUNT_MAPPING_PREFIX}${questradeAccountId}`;
    GM_setValue(mappingKey, JSON.stringify(monarchAccount));

    // Update state
    stateManager.setAccount(questradeAccountId, questradeAccountName);

    debugLog(`Account mapping saved: ${questradeAccountName} -> ${monarchAccount.displayName}`, {
      questradeId: questradeAccountId,
      monarchId: monarchAccount.id,
    });

    return true;
  } catch (error) {
    debugLog('Error linking accounts:', error);
    return false;
  }
}

/**
 * Get linked Monarch account for a Questrade account
 * @param {string} questradeAccountId - Questrade account ID
 * @returns {Object|null} Monarch account or null if not found
 */
export function getLinkedAccount(questradeAccountId) {
  try {
    if (!questradeAccountId) return null;

    const mappingKey = `${STORAGE.ACCOUNT_MAPPING_PREFIX}${questradeAccountId}`;
    const mapping = GM_getValue(mappingKey, null);

    return mapping ? JSON.parse(mapping) : null;
  } catch (error) {
    debugLog('Error getting linked account:', error);
    return null;
  }
}

export default {
  loadCurrentAccountInfo,
  getAccountDetails,
  getAllAccounts,
  getDateRange,
  processAccountBalanceHistory,
  bulkProcessAccounts,
  linkAccounts,
  getLinkedAccount,
  AccountError,
};
