/**
 * Wealthsimple Account Service
 * Handles Wealthsimple account mapping and synchronization
 */

import { debugLog } from '../../core/utils';
import { STORAGE } from '../../core/config';
import stateManager from '../../core/state';
import monarchApi from '../../api/monarch';
import wealthsimpleApi from '../../api/wealthsimple';
import toast from '../../ui/toast';
import { showMonarchAccountSelectorWithCreate } from '../../ui/components/accountSelectorWithCreate';
import { getMonarchAccountTypeMapping } from '../../mappers/wealthsimple-account-types';

/**
 * Resolve Monarch account mapping for a Wealthsimple account
 * Shows account selector with create option, with pre-filled values based on Wealthsimple account type
 * @param {Object} wealthsimpleAccount - Wealthsimple account object
 * @param {string} wealthsimpleAccount.id - Account ID
 * @param {string} wealthsimpleAccount.nickname - Account nickname
 * @param {string} wealthsimpleAccount.type - Account type (e.g., 'MANAGED_TFSA')
 * @returns {Promise<Object|null>} Monarch account object, or null if cancelled
 */
export async function resolveWealthsimpleAccountMapping(wealthsimpleAccount) {
  try {
    const { id: accountId, nickname, type } = wealthsimpleAccount;

    debugLog(`Resolving Monarch account mapping for Wealthsimple account ${accountId} (${nickname})`);

    // Set current account context
    stateManager.setAccount(accountId, nickname || accountId);

    // Check for existing mapping
    const existingMapping = GM_getValue(`${STORAGE.WEALTHSIMPLE_ACCOUNT_MAPPING_PREFIX}${accountId}`, null);
    if (existingMapping) {
      try {
        const monarchAccount = JSON.parse(existingMapping);
        debugLog(`Found existing mapping: ${nickname} -> ${monarchAccount.displayName}`);
        return monarchAccount;
      } catch (error) {
        debugLog('Error parsing existing account mapping, will prompt for new one:', error);
        // Fall through to create new mapping
      }
    }

    debugLog('No existing mapping found, showing account selector with create option');

    // Get Monarch account type mapping for this Wealthsimple account type
    const typeMapping = getMonarchAccountTypeMapping(type);
    debugLog('Account type mapping:', { wealthsimpleType: type, monarchMapping: typeMapping });

    // Prepare defaults for account creation
    const createDefaults = {
      defaultName: nickname || accountId,
      defaultType: typeMapping?.type || 'brokerage',
      defaultSubtype: typeMapping?.subtype || 'brokerage',
      defaultBalance: 0, // TODO: Set to actual balance once we implement balance fetching
      defaultIncludeInNetWorth: true,
    };

    // Determine account type for filtering Monarch accounts
    const accountType = typeMapping?.type || 'brokerage';

    // Fetch Monarch accounts of the appropriate type
    const monarchAccounts = await monarchApi.listAccounts(accountType);
    if (!monarchAccounts || monarchAccounts.length === 0) {
      debugLog(`No ${accountType} accounts found in Monarch, showing create dialog directly`);
      // No existing accounts, could show creation dialog directly
      // But let's still show the selector so user sees the "create" option
    }

    // Show enhanced account selector with create option
    const monarchAccount = await new Promise((resolve) => {
      showMonarchAccountSelectorWithCreate(
        monarchAccounts,
        resolve,
        null,
        accountType,
        createDefaults,
      );
    });

    if (!monarchAccount) {
      // User cancelled selection
      debugLog('User cancelled account mapping selection');
      return null;
    }

    // Save the mapping for future use
    GM_setValue(
      `${STORAGE.WEALTHSIMPLE_ACCOUNT_MAPPING_PREFIX}${accountId}`,
      JSON.stringify(monarchAccount),
    );

    debugLog(`Saved account mapping: ${nickname} (${accountId}) -> ${monarchAccount.displayName} (${monarchAccount.id})`);

    toast.show(`Mapped ${nickname} to ${monarchAccount.displayName} in Monarch`, 'info');

    return monarchAccount;
  } catch (error) {
    debugLog('Error resolving Wealthsimple account mapping:', error);
    toast.show(`Error mapping account: ${error.message}`, 'error');
    throw error;
  }
}

/**
 * Get existing Monarch account mapping for a Wealthsimple account
 * @param {string} wealthsimpleAccountId - Wealthsimple account ID
 * @returns {Object|null} Monarch account object if mapping exists, null otherwise
 */
export function getExistingAccountMapping(wealthsimpleAccountId) {
  try {
    const mapping = GM_getValue(`${STORAGE.WEALTHSIMPLE_ACCOUNT_MAPPING_PREFIX}${wealthsimpleAccountId}`, null);
    if (mapping) {
      return JSON.parse(mapping);
    }
    return null;
  } catch (error) {
    debugLog('Error getting existing account mapping:', error);
    return null;
  }
}

/**
 * Clear account mapping for a Wealthsimple account
 * @param {string} wealthsimpleAccountId - Wealthsimple account ID
 */
export function clearAccountMapping(wealthsimpleAccountId) {
  GM_deleteValue(`${STORAGE.WEALTHSIMPLE_ACCOUNT_MAPPING_PREFIX}${wealthsimpleAccountId}`);
  debugLog(`Cleared account mapping for Wealthsimple account ${wealthsimpleAccountId}`);
}

/**
 * Upload Wealthsimple account balance to Monarch
 * @param {string} wealthsimpleAccountId - Wealthsimple account ID
 * @param {string} monarchAccountId - Monarch account ID
 * @param {string} fromDate - Start date (YYYY-MM-DD)
 * @param {string} toDate - End date (YYYY-MM-DD)
 * @returns {Promise<boolean>} Success status
 */
export async function uploadWealthsimpleBalance(wealthsimpleAccountId, monarchAccountId, fromDate, toDate) {
  // TODO: Implement once Wealthsimple balance API is available
  // Will need to:
  // 1. Fetch balance history from Wealthsimple API
  // 2. Convert to Monarch CSV format (Date, Total Equity, Account Name)
  // 3. Upload via monarchApi.uploadBalance()
  debugLog('Balance upload placeholder - not yet implemented', {
    wealthsimpleAccountId,
    monarchAccountId,
    fromDate,
    toDate,
  });

  toast.show('Balance upload not yet implemented for Wealthsimple', 'warning');
  return false;
}

/**
 * Upload Wealthsimple account transactions to Monarch
 * @param {string} wealthsimpleAccountId - Wealthsimple account ID
 * @param {string} monarchAccountId - Monarch account ID
 * @param {string} fromDate - Start date (YYYY-MM-DD)
 * @param {string} toDate - End date (YYYY-MM-DD)
 * @returns {Promise<boolean>} Success status
 */
export async function uploadWealthsimpleTransactions(wealthsimpleAccountId, monarchAccountId, fromDate, toDate) {
  // TODO: Implement once Wealthsimple transactions API is available
  // Will need to:
  // 1. Fetch transactions from Wealthsimple API
  // 2. Convert to Monarch CSV format (Date, Merchant, Category, Amount, Notes)
  // 3. Upload via monarchApi.uploadTransactions()
  debugLog('Transaction upload placeholder - not yet implemented', {
    wealthsimpleAccountId,
    monarchAccountId,
    fromDate,
    toDate,
  });

  toast.show('Transaction upload not yet implemented for Wealthsimple', 'warning');
  return false;
}

/**
 * Get cached Wealthsimple accounts list
 * @returns {Array} Array of account objects with enhanced properties
 */
export function getWealthsimpleAccounts() {
  try {
    const accounts = JSON.parse(GM_getValue(STORAGE.WEALTHSIMPLE_ACCOUNTS_LIST, '[]'));
    return accounts;
  } catch (error) {
    debugLog('Error getting Wealthsimple accounts list:', error);
    return [];
  }
}

/**
 * Update specific account properties in the list
 * @param {string} accountId - Account ID to update
 * @param {Object} updates - Properties to update
 * @returns {boolean} Success status
 */
export function updateAccountInList(accountId, updates) {
  try {
    const accounts = getWealthsimpleAccounts();
    const accountIndex = accounts.findIndex((acc) => acc.id === accountId);

    if (accountIndex === -1) {
      debugLog(`Account ${accountId} not found in list`);
      return false;
    }

    // Update the account
    accounts[accountIndex] = {
      ...accounts[accountIndex],
      ...updates,
    };

    // Save updated list
    GM_setValue(STORAGE.WEALTHSIMPLE_ACCOUNTS_LIST, JSON.stringify(accounts));
    debugLog(`Updated account ${accountId} in list`, updates);
    return true;
  } catch (error) {
    debugLog('Error updating account in list:', error);
    return false;
  }
}

/**
 * Mark account as skipped or unskip it
 * @param {string} accountId - Account ID
 * @param {boolean} skipped - Whether to skip this account
 * @returns {boolean} Success status
 */
export function markAccountAsSkipped(accountId, skipped = true) {
  const success = updateAccountInList(accountId, { skipped });
  if (success) {
    const action = skipped ? 'skipped' : 'unskipped';
    debugLog(`Account ${accountId} marked as ${action}`);
  }
  return success;
}

/**
 * Check if an account is marked as skipped
 * @param {string} accountId - Account ID
 * @returns {boolean} True if account is skipped
 */
export function isAccountSkipped(accountId) {
  const accounts = getWealthsimpleAccounts();
  const account = accounts.find((acc) => acc.id === accountId);
  return account?.skipped || false;
}

/**
 * Sync account list with API data
 * Fetches fresh accounts from API and merges with cached settings
 * @returns {Promise<Array>} Updated accounts list with settings
 */
export async function syncAccountListWithAPI() {
  try {
    return await wealthsimpleApi.fetchAndCacheAccounts();
  } catch (error) {
    debugLog('Error syncing account list with API:', error);
    // Return cached list if API fails
    return getWealthsimpleAccounts();
  }
}

export default {
  resolveWealthsimpleAccountMapping,
  getExistingAccountMapping,
  clearAccountMapping,
  uploadWealthsimpleBalance,
  uploadWealthsimpleTransactions,
  getWealthsimpleAccounts,
  updateAccountInList,
  markAccountAsSkipped,
  isAccountSkipped,
  syncAccountListWithAPI,
};
