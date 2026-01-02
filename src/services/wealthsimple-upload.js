/**
 * Wealthsimple Upload Service
 * Handles uploading Wealthsimple account data to Monarch
 */

import { debugLog } from '../core/utils';
import { STORAGE } from '../core/config';
import wealthsimpleApi from '../api/wealthsimple';
import monarchApi from '../api/monarch';
import toast from '../ui/toast';

/**
 * Upload a single Wealthsimple account to Monarch
 * @param {Object} account - Wealthsimple account object
 * @param {string} fromDate - Start date (YYYY-MM-DD)
 * @param {string} toDate - End date (YYYY-MM-DD)
 * @returns {Promise<boolean>} Success status
 */
export async function uploadWealthsimpleAccountToMonarch(account, fromDate, toDate) {
  try {
    debugLog(`Uploading Wealthsimple account ${account.id} to Monarch...`);

    // Fetch account balance data
    const balanceData = await wealthsimpleApi.fetchAccountBalance(account.id);

    // Convert to CSV format expected by Monarch
    const csvData = convertBalanceDataToCsv(balanceData, account);

    if (!csvData) {
      toast.show(`No balance data available for ${account.name || account.id}`, 'warning');
      return false;
    }

    // Resolve account mapping
    const monarchAccount = await monarchApi.resolveAccountMapping(
      account.id,
      STORAGE.WEALTHSIMPLE_ACCOUNT_MAPPING_PREFIX,
      'brokerage',
    );

    if (!monarchAccount) {
      debugLog('Account mapping cancelled by user');
      return false;
    }

    // Upload to Monarch
    const success = await monarchApi.uploadBalance(
      monarchAccount.id,
      csvData,
      fromDate,
      toDate,
    );

    if (success) {
      // Store last upload date
      GM_setValue(`${STORAGE.WEALTHSIMPLE_LAST_UPLOAD_DATE_PREFIX}${account.id}`, toDate);
      toast.show(`Successfully uploaded ${account.name || account.id} to Monarch`, 'info');
    } else {
      toast.show(`Failed to upload ${account.name || account.id}`, 'error');
    }

    return success;
  } catch (error) {
    debugLog(`Error uploading Wealthsimple account ${account.id}:`, error);
    toast.show(`Error uploading account: ${error.message}`, 'error');
    return false;
  }
}

/**
 * Upload all Wealthsimple accounts to Monarch
 * @returns {Promise<void>}
 */
export async function uploadAllWealthsimpleAccountsToMonarch() {
  try {
    debugLog('Starting upload of all Wealthsimple accounts...');

    // Fetch all accounts
    const accounts = await wealthsimpleApi.fetchAccounts();

    if (!accounts || accounts.length === 0) {
      toast.show('No Wealthsimple accounts found', 'warning');
      return;
    }

    debugLog(`Found ${accounts.length} Wealthsimple accounts`);

    // Get date range
    const toDate = new Date().toISOString().split('T')[0];
    const fromDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    let successCount = 0;
    let failureCount = 0;

    // Upload each account
    for (const account of accounts) {
      const success = await uploadWealthsimpleAccountToMonarch(account, fromDate, toDate);
      if (success) {
        successCount += 1;
      } else {
        failureCount += 1;
      }
    }

    // Show summary
    if (failureCount === 0) {
      toast.show(`Successfully uploaded all ${successCount} Wealthsimple accounts`, 'info');
    } else {
      toast.show(`Uploaded ${successCount} accounts, ${failureCount} failed`, 'warning');
    }
  } catch (error) {
    debugLog('Error uploading all Wealthsimple accounts:', error);
    toast.show(`Error uploading accounts: ${error.message}`, 'error');
  }
}

/**
 * Convert Wealthsimple balance data to CSV format
 * @param {Object} balanceData - Balance data from Wealthsimple API
 * @param {Object} account - Account information
 * @returns {string} CSV formatted data
 */
function convertBalanceDataToCsv(balanceData, account) {
  try {
    // CSV header
    let csvContent = '"Date","Total Equity","Account Name"\n';

    // Extract balance information
    const balance = balanceData.current_combined_balance || balanceData.balance || 0;
    const date = new Date().toISOString().split('T')[0];
    const accountName = account.name || account.nickname || account.id;

    // Add data row
    csvContent += `"${date}","${balance}","${accountName}"\n`;

    return csvContent;
  } catch (error) {
    debugLog('Error converting balance data to CSV:', error);
    return null;
  }
}

/**
 * Get the last upload date for an account
 * @param {string} accountId - Account ID
 * @returns {string|null} Last upload date or null
 */
export function getLastUploadDate(accountId) {
  return GM_getValue(`${STORAGE.WEALTHSIMPLE_LAST_UPLOAD_DATE_PREFIX}${accountId}`);
}

/**
 * Clear last upload date for an account
 * @param {string} accountId - Account ID
 */
export function clearLastUploadDate(accountId) {
  GM_deleteValue(`${STORAGE.WEALTHSIMPLE_LAST_UPLOAD_DATE_PREFIX}${accountId}`);
}

export default {
  uploadWealthsimpleAccountToMonarch,
  uploadAllWealthsimpleAccountsToMonarch,
  getLastUploadDate,
  clearLastUploadDate,
};
