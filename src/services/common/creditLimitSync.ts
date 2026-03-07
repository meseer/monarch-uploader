/**
 * Credit Limit Sync Service
 *
 * Generic credit limit synchronization for any integration that supports
 * credit limit tracking (hasCreditLimit capability). Compares the current
 * credit limit with the last synced value to avoid unnecessary API calls.
 *
 * @module services/common/creditLimitSync
 */

import { debugLog } from '../../core/utils';
import monarchApi from '../../api/monarch';
import accountService from './accountService';

/**
 * Sync a credit limit value from a source institution to Monarch.
 *
 * Compares with the last synced value stored in the account data to
 * skip the API call when the limit hasn't changed.
 *
 * @param {string} integrationId - Integration identifier (e.g., 'mbna', 'rogersbank')
 * @param {string} sourceAccountId - Source institution account ID
 * @param {string} monarchAccountId - Monarch account ID
 * @param {number|null} creditLimit - Credit limit value from source institution
 * @returns {Promise<{success: boolean, message: string, skipped: boolean}>} Sync result
 */
export async function syncCreditLimit(
  integrationId: string,
  sourceAccountId: string,
  monarchAccountId: string,
  creditLimit: number | null | undefined,
): Promise<{ success: boolean; message: string; skipped: boolean }> {
  if (creditLimit === null || creditLimit === undefined) {
    return { success: true, message: 'Not available', skipped: true };
  }

  // Check if credit limit has changed since last sync
  const accountData = accountService.getAccountData(integrationId, sourceAccountId);
  const storedCreditLimit = accountData?.lastSyncedCreditLimit;

  if (storedCreditLimit !== null && storedCreditLimit !== undefined && storedCreditLimit === creditLimit) {
    debugLog(`[${integrationId}] Credit limit unchanged: $${creditLimit}`);
    return { success: true, message: `$${creditLimit.toLocaleString()} (unchanged)`, skipped: false };
  }

  try {
    const updatedAccount = await monarchApi.setCreditLimit(monarchAccountId, creditLimit);

    if (updatedAccount && updatedAccount.limit === creditLimit) {
      accountService.updateAccountInList(integrationId, sourceAccountId, {
        lastSyncedCreditLimit: creditLimit,
      });
      debugLog(`[${integrationId}] Credit limit synced: $${creditLimit}`);
      return { success: true, message: `$${creditLimit.toLocaleString()}`, skipped: false };
    }

    debugLog(`[${integrationId}] Credit limit update returned but value not applied. Expected: ${creditLimit}, Got: ${updatedAccount?.limit}`);
    return { success: false, message: 'Value not applied', skipped: false };
  } catch (error) {
    debugLog(`[${integrationId}] Error syncing credit limit:`, error);
    return { success: false, message: error.message, skipped: false };
  }
}

export default {
  syncCreditLimit,
};