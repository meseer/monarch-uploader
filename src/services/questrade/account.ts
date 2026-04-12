/**
 * Account Service
 * Handles account-related business logic
 */

import { debugLog } from '../../core/utils';
import { INTEGRATIONS } from '../../core/integrationCapabilities';
import stateManager from '../../core/state';
import questradeApi from '../../api/questrade';
import accountService from '../common/accountService';
import authService from './auth';
import balanceService from './balance';
import syncService from './sync';

/**
 * Custom account error class
 */
export class AccountError extends Error {
  accountId: string | null;

  constructor(message: string, accountId: string | null = null) {
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
    const matches = window.location.pathname.match(/\/accounts\/([^/]+)/);
    if (!matches || !matches[1]) return null;

    const accountId = matches[1];
    debugLog(`Detected account ID in URL: ${accountId}`);

    // Fetch accounts from consolidated storage or API
    let consolidatedAccounts: Record<string, unknown>[] = accountService.getAccounts(INTEGRATIONS.QUESTRADE);
    if (consolidatedAccounts.length === 0) {
      consolidatedAccounts = (await questradeApi.fetchAccounts()) as unknown as Record<string, unknown>[];
    }

    // Find the account in the consolidated list
    const consolidatedAccount = consolidatedAccounts.find((acc) => {
      const qa = acc.questradeAccount as Record<string, unknown> | undefined;
      return qa?.id === accountId || qa?.key === accountId;
    });

    if (!consolidatedAccount?.questradeAccount) {
      debugLog(`Account ${accountId} not found in accounts list`);
      return null;
    }

    const account = consolidatedAccount.questradeAccount as Record<string, unknown>;

    // Update state with current account
    const accountNickname = (account.nickname || account.name) as string;
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
 * @returns {Promise<Object>} Account details (questradeAccount object)
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

    // Fetch account details from consolidated storage
    const accountData = accountService.getAccountData(INTEGRATIONS.QUESTRADE, accountId);
    if (accountData?.questradeAccount) {
      return accountData.questradeAccount;
    }

    // Try to fetch fresh accounts list from API
    await questradeApi.fetchAccounts();
    const refreshedAccountData = accountService.getAccountData(INTEGRATIONS.QUESTRADE, accountId);

    if (!refreshedAccountData?.questradeAccount) {
      throw new AccountError(`Account ${accountId} not found`, accountId);
    }

    return refreshedAccountData.questradeAccount;
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
 * @returns {Promise<Array>} List of consolidated account objects
 */
export async function getAllAccounts(refresh = false) {
  try {
    // Check if auth is valid
    const authStatus = authService.checkQuestradeAuth();
    if (!authStatus.authenticated) {
      throw new AccountError('Not authenticated with Questrade', null);
    }

    if (refresh) {
      // Force fetch from API (returns consolidated structure)
      return await questradeApi.fetchAccounts();
    }

    // Try to get from consolidated storage first
    const accounts = accountService.getAccounts(INTEGRATIONS.QUESTRADE);
    if (accounts.length > 0) {
      return accounts;
    }

    // Fetch if storage is empty (returns consolidated structure)
    return await questradeApi.fetchAccounts();
  } catch (error) {
    debugLog('Error fetching all accounts:', error);
    if (error instanceof AccountError) {
      throw error;
    }
    throw new AccountError(`Failed to get accounts: ${(error as Error).message}`, null);
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
  // Use sync orchestrator to sync both balance and positions
  return syncService.syncAccountToMonarch(accountId, accountName, fromDate, toDate);
}

/**
 * Bulk process multiple accounts
 * @returns {Promise<Object>} Results with success and fail counts
 */
async function bulkProcessAccounts() {
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
 * Saves to consolidated storage only (legacy migration completed)
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

    // Save to consolidated storage via accountService
    const success = accountService.upsertAccount(INTEGRATIONS.QUESTRADE, {
      questradeAccount: {
        id: questradeAccountId,
        nickname: questradeAccountName,
      },
      monarchAccount,
    });

    // Update state
    stateManager.setAccount(questradeAccountId, questradeAccountName);

    debugLog(`Account mapping saved: ${questradeAccountName} -> ${monarchAccount.displayName}`, {
      questradeId: questradeAccountId,
      monarchId: monarchAccount.id,
      savedToConsolidated: success,
    });

    return true;
  } catch (error) {
    debugLog('Error linking accounts:', error);
    return false;
  }
}

/**
 * Get linked Monarch account for a Questrade account
 * Reads from consolidated storage only (legacy migration completed)
 * @param {string} questradeAccountId - Questrade account ID
 * @returns {Object|null} Monarch account or null if not found
 */
export function getLinkedAccount(questradeAccountId) {
  try {
    if (!questradeAccountId) return null;

    // Check consolidated storage
    const accountData = accountService.getAccountData(INTEGRATIONS.QUESTRADE, questradeAccountId);
    if (accountData?.monarchAccount) {
      debugLog(`Found Monarch mapping for ${questradeAccountId} in consolidated storage`);
      return accountData.monarchAccount;
    }

    return null;
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
