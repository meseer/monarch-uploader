/**
 * Wealthsimple Account Service
 * Handles Wealthsimple account mapping and synchronization
 */

import { debugLog, formatDate } from '../../core/utils';
import { STORAGE } from '../../core/config';
import stateManager from '../../core/state';
import monarchApi from '../../api/monarch';
import wealthsimpleApi from '../../api/wealthsimple';
import toast from '../../ui/toast';
import { showMonarchAccountSelectorWithCreate } from '../../ui/components/accountSelectorWithCreate';
import { getMonarchAccountTypeMapping } from '../../mappers/wealthsimple-account-types';
import {
  getDefaultDateRange,
  processAndUploadBalance,
  accountNeedsBalanceReconstruction,
  reconstructBalanceFromTransactions,
  createCurrentBalanceOnly,
  processBalanceData,
  uploadBalanceToMonarch,
} from './balance';
import { fetchAndProcessTransactions } from './transactions';
import { convertWealthsimpleTransactionsToMonarchCSV } from '../../utils/csv';

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
 * Upload Wealthsimple account balance history to Monarch
 * Handles three scenarios:
 * 1. Investment accounts: Fetch balance history from API
 * 2. Credit/Cash accounts - first sync with reconstruction: Build balance from transactions
 * 3. Credit/Cash accounts - subsequent sync: Upload current balance for today only
 *
 * @param {string} wealthsimpleAccountId - Wealthsimple account ID
 * @param {string} monarchAccountId - Monarch account ID
 * @param {string} fromDate - Start date (YYYY-MM-DD)
 * @param {string} toDate - End date (YYYY-MM-DD)
 * @param {Object} currentBalance - Current balance object {amount, currency}
 * @param {boolean} reconstructBalance - Whether to reconstruct balance from transactions (first sync)
 * @returns {Promise<boolean>} Success status
 */
export async function uploadWealthsimpleBalance(wealthsimpleAccountId, monarchAccountId, fromDate, toDate, currentBalance = null, reconstructBalance = false) {
  try {
    debugLog('Starting Wealthsimple balance history upload', {
      wealthsimpleAccountId,
      monarchAccountId,
      fromDate,
      toDate,
      reconstructBalance,
    });

    // Get consolidated account data
    const accountData = getAccountData(wealthsimpleAccountId);
    if (!accountData) {
      throw new Error('Account data not found');
    }

    const account = accountData.wealthsimpleAccount;
    const accountType = account?.type || '';
    const wealthsimpleAccountName = account.nickname || wealthsimpleAccountId;
    const monarchAccountName = accountData.monarchAccount?.displayName || wealthsimpleAccountName;

    // If dates not provided, calculate them
    let actualFromDate = fromDate;
    let actualToDate = toDate;
    if (!fromDate || !toDate) {
      const dateRange = getDefaultDateRange(accountData);
      actualFromDate = dateRange.fromDate;
      actualToDate = dateRange.toDate;
    }

    // Check if this account type needs special handling (credit cards, cash accounts)
    const needsReconstruction = accountNeedsBalanceReconstruction(accountType);

    // Scenario 1: Investment accounts - use standard API-based balance fetch
    if (!needsReconstruction) {
      debugLog('Investment account - using standard balance history fetch');
      const success = await processAndUploadBalance(
        accountData,
        monarchAccountId,
        actualFromDate,
        actualToDate,
      );
      return success;
    }

    // Scenario 2: Credit/Cash accounts - first sync with reconstruction enabled
    if (reconstructBalance) {
      debugLog('First sync with reconstruction enabled - building balance from transactions');

      // Fetch and process transactions to use for balance reconstruction
      const processedTransactions = await fetchAndProcessTransactions(accountData, actualFromDate, actualToDate);

      if (!processedTransactions || processedTransactions.length === 0) {
        debugLog('No transactions available for balance reconstruction');
        toast.show(`No transactions available for balance reconstruction for ${wealthsimpleAccountName}`, 'warning');
        return false;
      }

      // Reconstruct balance history from transactions
      const balanceHistory = reconstructBalanceFromTransactions(
        processedTransactions,
        actualFromDate,
        actualToDate,
      );

      if (!balanceHistory || balanceHistory.length === 0) {
        debugLog('Failed to reconstruct balance history');
        toast.show(`Failed to reconstruct balance history for ${wealthsimpleAccountName}`, 'error');
        return false;
      }

      // Convert to CSV and upload
      const csvData = processBalanceData(balanceHistory, monarchAccountName);
      debugLog(`Generated reconstructed balance CSV for ${monarchAccountName} (${balanceHistory.length} days)`);

      const success = await uploadBalanceToMonarch(
        wealthsimpleAccountId,
        monarchAccountId,
        csvData,
        actualFromDate,
        actualToDate,
      );

      if (success) {
        toast.show(`Reconstructed and uploaded ${balanceHistory.length} days of balance history for ${wealthsimpleAccountName}`, 'info');
      }

      return success;
    }

    // Scenario 3: Credit/Cash accounts - subsequent sync (has lastSyncDate)
    // Only upload today's current balance
    debugLog('Subsequent sync for non-investment account - uploading current balance only');

    if (!currentBalance) {
      debugLog('No current balance available for subsequent sync');
      toast.show(`No current balance available for ${wealthsimpleAccountName}`, 'warning');
      return false;
    }

    // Create single-day balance entry for today
    const todayDate = formatDate(new Date());
    const balanceHistory = createCurrentBalanceOnly(currentBalance, todayDate);

    if (!balanceHistory || balanceHistory.length === 0) {
      debugLog('Failed to create current balance entry');
      return false;
    }

    // Convert to CSV and upload
    const csvData = processBalanceData(balanceHistory, monarchAccountName);
    debugLog(`Generated current balance CSV for ${monarchAccountName}: ${currentBalance.amount}`);

    const success = await uploadBalanceToMonarch(
      wealthsimpleAccountId,
      monarchAccountId,
      csvData,
      todayDate,
      todayDate,
    );

    if (success) {
      toast.show(`Updated today's balance for ${wealthsimpleAccountName}`, 'info');
    }

    return success;
  } catch (error) {
    debugLog('Error uploading Wealthsimple balance:', error);
    toast.show(`Balance upload failed: ${error.message}`, 'error');
    return false;
  }
}

/**
 * Upload Wealthsimple account transactions to Monarch
 * For first sync, prompts user for start date with account creation date as default
 * @param {string} wealthsimpleAccountId - Wealthsimple account ID
 * @param {string} monarchAccountId - Monarch account ID
 * @param {string} fromDate - Start date (YYYY-MM-DD)
 * @param {string} toDate - End date (YYYY-MM-DD)
 * @returns {Promise<boolean>} Success status
 */
export async function uploadWealthsimpleTransactions(wealthsimpleAccountId, monarchAccountId, fromDate, toDate) {
  try {
    debugLog('Starting Wealthsimple transaction upload', {
      wealthsimpleAccountId,
      monarchAccountId,
      fromDate,
      toDate,
    });

    // Get consolidated account data
    const accountData = getAccountData(wealthsimpleAccountId);
    if (!accountData) {
      throw new Error('Account data not found');
    }

    const accountName = accountData.wealthsimpleAccount.nickname;
    const accountType = accountData.wealthsimpleAccount.type;

    // Check if this account type supports transactions
    // Currently only credit cards are supported
    if (!accountType.includes('CREDIT')) {
      debugLog(`Transaction upload not supported for account type: ${accountType}`);
      return false; // Silently skip unsupported account types
    }

    // Note: First sync date picker is handled in wealthsimple-upload.js
    // The fromDate passed here is already the correct date (either user-selected or default)

    // Fetch and process transactions
    const processedTransactions = await fetchAndProcessTransactions(accountData, fromDate, toDate);

    if (!processedTransactions || processedTransactions.length === 0) {
      debugLog('No transactions to upload');
      return true; // Success, just no transactions
    }

    debugLog(`Found ${processedTransactions.length} processed transactions`);

    // Filter out duplicate transactions using account's uploadedTransactions array
    const uploadedIds = new Set(accountData.uploadedTransactions || []);
    const originalCount = processedTransactions.length;

    const newTransactions = processedTransactions.filter(
      (transaction) => !uploadedIds.has(transaction.id),
    );

    const duplicateCount = originalCount - newTransactions.length;

    if (duplicateCount > 0) {
      debugLog(`Filtered out ${duplicateCount} duplicate transactions`);
      toast.show(`Skipping ${duplicateCount} already uploaded transactions`, 'debug');
    }

    if (newTransactions.length === 0) {
      const message = duplicateCount > 0
        ? `All ${duplicateCount} transactions have already been uploaded`
        : 'No new transactions to upload';
      debugLog(message);
      toast.show(message, 'info');
      return true; // Success, just no new transactions
    }

    debugLog(`Uploading ${newTransactions.length} new transactions`);

    // Convert to Monarch CSV format
    const csvData = convertWealthsimpleTransactionsToMonarchCSV(newTransactions, accountName);

    if (!csvData) {
      throw new Error('Failed to convert transactions to CSV');
    }

    // Upload to Monarch
    const filename = `wealthsimple_transactions_${wealthsimpleAccountId}_${fromDate}_to_${toDate}.csv`;
    const uploadSuccess = await monarchApi.uploadTransactions(
      monarchAccountId,
      csvData,
      filename,
      false, // shouldUpdateBalance = false (balance is uploaded separately)
      false, // skipCheckForDuplicates = false
    );

    if (uploadSuccess) {
      // Add new transaction IDs to account's uploadedTransactions array
      const transactionIds = newTransactions
        .map((transaction) => transaction.id)
        .filter((id) => id);

      if (transactionIds.length > 0) {
        const currentUploadedTransactions = accountData.uploadedTransactions || [];
        const updatedUploadedTransactions = [...currentUploadedTransactions, ...transactionIds];

        // Update account with new uploaded transactions
        // Note: lastSyncDate is NOT updated here - it's only updated when BOTH balance and transactions succeed
        updateAccountInList(wealthsimpleAccountId, {
          uploadedTransactions: updatedUploadedTransactions,
        });
      }

      const successMessage = duplicateCount > 0
        ? `Successfully uploaded ${newTransactions.length} new transactions (${duplicateCount} duplicates skipped)`
        : `Successfully uploaded ${newTransactions.length} transactions`;

      debugLog(successMessage);
      toast.show(successMessage, 'info');

      return true;
    }

    throw new Error('Transaction upload failed');
  } catch (error) {
    debugLog('Error uploading Wealthsimple transactions:', error);
    toast.show(`Transaction upload failed: ${error.message}`, 'error');
    return false;
  }
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
