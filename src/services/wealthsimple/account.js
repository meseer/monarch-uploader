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
 * @param {Object} consolidatedAccount - Consolidated account object with wealthsimpleAccount property
 * @param {Object} consolidatedAccount.wealthsimpleAccount - Wealthsimple account object
 * @param {string} consolidatedAccount.wealthsimpleAccount.id - Account ID
 * @param {string} consolidatedAccount.wealthsimpleAccount.nickname - Account nickname
 * @param {string} consolidatedAccount.wealthsimpleAccount.type - Account type (e.g., 'MANAGED_TFSA')
 * @param {Object} currentBalance - Current balance object {amount, currency} or null
 * @returns {Promise<Object|null>} Monarch account object, or null if cancelled
 */
export async function resolveWealthsimpleAccountMapping(consolidatedAccount, currentBalance = null) {
  try {
    const { id: accountId, nickname, type } = consolidatedAccount.wealthsimpleAccount;

    debugLog(`Resolving Monarch account mapping for Wealthsimple account ${accountId} (${nickname})`);

    // Set current account context
    stateManager.setAccount(accountId, nickname || accountId);

    // Check for existing mapping in consolidated structure
    const accountData = getAccountData(accountId);
    if (accountData?.monarchAccount) {
      debugLog(`Found existing mapping: ${nickname} -> ${accountData.monarchAccount.displayName}`);
      return accountData.monarchAccount;
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
      defaultBalance: currentBalance ? currentBalance.amount : 0,
      defaultIncludeInNetWorth: true,
      currentBalance, // Pass balance for display in UI
      accountType: type, // Pass raw account type for display
    };

    // Determine account type for filtering Monarch accounts
    const accountType = typeMapping?.type || 'brokerage';

    // Fetch Monarch accounts of the appropriate type
    const monarchAccounts = await monarchApi.listAccounts(accountType);
    if (!monarchAccounts || monarchAccounts.length === 0) {
      debugLog(`No ${accountType} accounts found in Monarch, showing create dialog directly`);
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

    // Handle skip - update consolidated structure
    if (monarchAccount.skipped) {
      debugLog('Account skipped by user');
      updateAccountInList(accountId, {
        monarchAccount: null,
        syncEnabled: false,
      });
      return monarchAccount;
    }

    // Save the mapping in consolidated structure
    updateAccountInList(accountId, {
      monarchAccount,
      syncEnabled: true,
    });

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
 * @param {string} fromDate - Start date (YYYY-MM-DD) - not used, kept for API compatibility
 * @param {string} toDate - End date (YYYY-MM-DD) - used as the date for current balance
 * @param {Object} currentBalance - Current balance object {amount, currency}
 * @returns {Promise<boolean>} Success status
 */
export async function uploadWealthsimpleBalance(wealthsimpleAccountId, monarchAccountId, fromDate, toDate, currentBalance = null) {
  try {
    debugLog('Starting Wealthsimple balance upload', {
      wealthsimpleAccountId,
      monarchAccountId,
      toDate,
      currentBalance,
    });

    // Get current balance from Wealthsimple API if not provided
    let balance = currentBalance;
    if (!balance) {
      debugLog('Current balance not provided, fetching from API');
      const balanceData = await wealthsimpleApi.fetchAccountBalance(wealthsimpleAccountId);
      balance = balanceData;
    }

    // Validate balance data
    if (!balance || balance.amount === null || balance.amount === undefined) {
      debugLog('No balance data available for account', wealthsimpleAccountId);
      toast.show('Balance data not available for this account', 'warning');
      return false;
    }

    // Get account name from state
    const accountName = stateManager.getState().currentAccount.nickname || 'Unknown Account';

    // Format current balance as single-day CSV
    // CSV format: "Date","Total Equity","Account Name"
    const csvData = `"Date","Total Equity","Account Name"\n"${toDate}","${balance.amount}","${accountName}"`;

    debugLog('Uploading balance CSV to Monarch', { monarchAccountId, toDate, amount: balance.amount });

    // Upload to Monarch
    const success = await monarchApi.uploadBalance(monarchAccountId, csvData, toDate, toDate);

    if (success) {
      debugLog(`Successfully uploaded balance for ${accountName} (${wealthsimpleAccountId})`);
      return true;
    }

    debugLog(`Failed to upload balance for ${accountName} (${wealthsimpleAccountId})`);
    return false;
  } catch (error) {
    debugLog('Error uploading Wealthsimple balance:', error);
    toast.show(`Balance upload failed: ${error.message}`, 'error');
    return false;
  }
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
 * Get cached Wealthsimple accounts list (consolidated structure)
 * @returns {Array} Array of consolidated account objects
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
 * Save Wealthsimple accounts list
 * @param {Array} accounts - Array of consolidated account objects
 */
function saveWealthsimpleAccounts(accounts) {
  GM_setValue(STORAGE.WEALTHSIMPLE_ACCOUNTS_LIST, JSON.stringify(accounts));
}

/**
 * Get single account data from consolidated list
 * @param {string} accountId - Wealthsimple account ID
 * @returns {Object|null} Consolidated account object or null
 */
export function getAccountData(accountId) {
  const accounts = getWealthsimpleAccounts();
  return accounts.find((acc) => acc.wealthsimpleAccount?.id === accountId) || null;
}

/**
 * Update specific account properties in the consolidated list
 * @param {string} accountId - Wealthsimple account ID
 * @param {Object} updates - Properties to update
 * @returns {boolean} Success status
 */
export function updateAccountInList(accountId, updates) {
  try {
    const accounts = getWealthsimpleAccounts();
    const accountIndex = accounts.findIndex((acc) => acc.wealthsimpleAccount?.id === accountId);

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
    saveWealthsimpleAccounts(accounts);
    debugLog(`Updated account ${accountId} in list`, updates);
    return true;
  } catch (error) {
    debugLog('Error updating account in list:', error);
    return false;
  }
}

/**
 * Mark account as skipped or unskip it (updates syncEnabled flag)
 * @param {string} accountId - Wealthsimple account ID
 * @param {boolean} skipped - Whether to skip this account (inverts to syncEnabled)
 * @returns {boolean} Success status
 */
export function markAccountAsSkipped(accountId, skipped = true) {
  const success = updateAccountInList(accountId, { syncEnabled: !skipped });
  if (success) {
    const action = skipped ? 'disabled' : 'enabled';
    debugLog(`Account ${accountId} sync ${action}`);
  }
  return success;
}

/**
 * Check if an account is marked as skipped (checks syncEnabled flag)
 * @param {string} accountId - Wealthsimple account ID
 * @returns {boolean} True if account sync is disabled
 */
export function isAccountSkipped(accountId) {
  const accountData = getAccountData(accountId);
  return accountData ? !accountData.syncEnabled : false;
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
