/**
 * Wealthsimple Upload Service
 * Handles uploading Wealthsimple account data to Monarch
 */

import { debugLog } from '../core/utils';
import { STORAGE } from '../core/config';
import toast from '../ui/toast';
import {
  resolveWealthsimpleAccountMapping,
  uploadWealthsimpleBalance,
  uploadWealthsimpleTransactions,
  markAccountAsSkipped,
  syncAccountListWithAPI,
} from './wealthsimple/account';

/**
 * Upload a single Wealthsimple account to Monarch
 * @param {Object} account - Wealthsimple account object
 * @param {string} fromDate - Start date (YYYY-MM-DD)
 * @param {string} toDate - End date (YYYY-MM-DD)
 * @returns {Promise<Object>} Result object with success status and optional signals
 */
export async function uploadWealthsimpleAccountToMonarch(account, fromDate, toDate) {
  try {
    debugLog(`Uploading Wealthsimple account ${account.id} to Monarch...`);

    // Resolve account mapping (shows selector with create option)
    const result = await resolveWealthsimpleAccountMapping(account);

    // Handle skip signal
    if (result && result.skipped) {
      debugLog(`User skipped account ${account.id}`);
      markAccountAsSkipped(account.id, true);
      toast.show(`Skipped ${account.nickname || account.id}`, 'info');
      return { success: false, skipped: true };
    }

    // Handle cancel signal
    if (result && result.cancelled) {
      debugLog('User cancelled sync');
      return { success: false, cancelled: true };
    }

    // Handle null (user closed without action)
    if (!result) {
      debugLog('Account mapping cancelled by user');
      return { success: false, cancelled: true };
    }

    const monarchAccount = result;

    // Upload balance (placeholder for now)
    const balanceSuccess = await uploadWealthsimpleBalance(
      account.id,
      monarchAccount.id,
      fromDate,
      toDate,
    );

    // Upload transactions (placeholder for now)
    const transactionsSuccess = await uploadWealthsimpleTransactions(
      account.id,
      monarchAccount.id,
      fromDate,
      toDate,
    );

    const success = balanceSuccess || transactionsSuccess;

    if (success) {
      // Store last upload date
      GM_setValue(`${STORAGE.WEALTHSIMPLE_LAST_UPLOAD_DATE_PREFIX}${account.id}`, toDate);
      toast.show(`Processed ${account.nickname || account.id}`, 'info');
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
    debugLog('Starting fetch of all Wealthsimple accounts...');

    // Sync account list with API (merges with cached settings like skip flags)
    const accounts = await syncAccountListWithAPI();

    if (!accounts || accounts.length === 0) {
      toast.show('No Wealthsimple accounts found', 'warning');
      return;
    }

    // Filter out skipped accounts
    const accountsToSync = accounts.filter((acc) => !acc.skipped);
    const skippedCount = accounts.length - accountsToSync.length;

    if (skippedCount > 0) {
      debugLog(`Skipping ${skippedCount} account(s) marked as skipped`);
    }

    if (accountsToSync.length === 0) {
      toast.show('All accounts are marked as skipped', 'warning');
      return;
    }

    debugLog(`Processing ${accountsToSync.length} Wealthsimple account(s):`, accountsToSync);

    // Process all non-skipped accounts
    const toDate = new Date().toISOString().split('T')[0];
    const fromDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    let successCount = 0;
    let failureCount = 0;
    let skippedDuringSync = 0;

    for (const account of accountsToSync) {
      const result = await uploadWealthsimpleAccountToMonarch(account, fromDate, toDate);

      // Check if user cancelled the entire sync
      if (result && result.cancelled) {
        debugLog('Sync cancelled by user, stopping processing');
        toast.show('Sync cancelled', 'warning');
        break;
      }

      // Check if user skipped this account
      if (result && result.skipped) {
        skippedDuringSync += 1;
        continue;
      }

      // Check success
      if (result && result.success !== false) {
        successCount += 1;
      } else {
        failureCount += 1;
      }
    }

    // Show final summary
    const totalSkipped = skippedCount + skippedDuringSync;
    if (failureCount === 0 && totalSkipped === 0) {
      toast.show(`Successfully uploaded all ${successCount} Wealthsimple account(s)`, 'info');
    } else {
      const parts = [];
      if (successCount > 0) parts.push(`${successCount} uploaded`);
      if (failureCount > 0) parts.push(`${failureCount} failed`);
      if (totalSkipped > 0) parts.push(`${totalSkipped} skipped`);
      toast.show(parts.join(', '), failureCount > 0 ? 'warning' : 'info');
    }
  } catch (error) {
    debugLog('Error fetching Wealthsimple accounts:', error);
    toast.show(`Error fetching accounts: ${error.message}`, 'error');
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
