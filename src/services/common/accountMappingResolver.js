/**
 * Account Mapping Resolver
 *
 * Generic service that resolves the Monarch account mapping for any
 * integration. Handles the full flow: check existing mapping, check
 * skip state, show account selector, save mapping, and set logo.
 *
 * This replaces the per-integration account mapping logic that was
 * previously duplicated in each upload service.
 *
 * @module services/common/accountMappingResolver
 */

import { debugLog } from '../../core/utils';
import monarchApi from '../../api/monarch';
import accountService from './accountService';
import toast from '../../ui/toast';
import { showMonarchAccountSelectorWithCreate } from '../../ui/components/accountSelectorWithCreate';

/**
 * Resolve the Monarch account mapping for a source account.
 *
 * Flow:
 * 1. Check for existing mapping → return immediately if found
 * 2. Check if account was previously skipped → return skipped
 * 3. Show account selector dialog with manifest-driven defaults
 * 4. Handle cancel/skip/selection
 * 5. Save mapping to consolidated storage
 * 6. Set logo on newly created Monarch accounts
 *
 * @param {Object} params - Parameters
 * @param {string} params.integrationId - Integration identifier (e.g., 'mbna')
 * @param {import('../../integrations/types').IntegrationManifest} params.manifest - Integration manifest
 * @param {Object} params.account - Raw source account with accountId
 * @param {string} params.accountDisplayName - Display name for the account
 * @param {Function} params.buildAccountEntry - Hook: (account) => source account storage shape
 * @returns {Promise<{monarchAccount?: Object, skipped?: boolean, cancelled?: boolean}>}
 */
export async function resolveAccountMapping({
  integrationId, manifest, account, accountDisplayName, buildAccountEntry,
}) {
  const accountId = account.accountId;

  // 1. Check existing mapping
  const existing = accountService.getMonarchAccountMapping(integrationId, accountId);
  if (existing) {
    debugLog(`[${integrationId}] Using existing mapping:`, accountDisplayName, '→', existing.displayName);
    return { monarchAccount: existing };
  }

  // 2. Check if previously skipped
  const accountData = accountService.getAccountData(integrationId, accountId);
  if (accountData && accountData.syncEnabled === false) {
    debugLog(`[${integrationId}] Account was skipped:`, accountDisplayName);
    return { skipped: true };
  }

  // 3. Show account selector with manifest-driven defaults
  debugLog(`[${integrationId}] No mapping for`, accountDisplayName, '— showing account selector');

  const createDefaults = {
    defaultName: accountDisplayName,
    ...(manifest.accountCreateDefaults || {}),
  };

  const monarchAccount = await new Promise((resolve) => {
    showMonarchAccountSelectorWithCreate(
      [],
      (selectedAccount) => resolve(selectedAccount),
      null,
      manifest.accountCreateDefaults?.accountType || 'credit',
      createDefaults,
    );
  });

  // 4. Handle cancel
  if (!monarchAccount) {
    toast.show('Account mapping cancelled', 'info', 2000);
    return { cancelled: true };
  }

  if (monarchAccount.cancelled) {
    return { cancelled: true };
  }

  // 5. Handle skip
  if (monarchAccount.skipped) {
    const skippedData = {
      [manifest.accountKeyName]: buildAccountEntry(account),
      monarchAccount: null,
      syncEnabled: false,
      lastSyncDate: null,
    };
    accountService.upsertAccount(integrationId, skippedData);
    toast.show(`${accountDisplayName}: skipped`, 'info', 2000);
    return { skipped: true };
  }

  // 6. Save mapping
  const mappingData = {
    [manifest.accountKeyName]: buildAccountEntry(account),
    monarchAccount: {
      id: monarchAccount.id,
      displayName: monarchAccount.displayName,
    },
    syncEnabled: true,
    lastSyncDate: null,
  };
  accountService.upsertAccount(integrationId, mappingData);

  debugLog(`[${integrationId}] Account mapping saved:`, accountDisplayName, '→', monarchAccount.displayName);
  toast.show(`Mapped: ${accountDisplayName} → ${monarchAccount.displayName}`, 'success', 3000);

  // 7. Set logo on newly created accounts
  if (monarchAccount.newlyCreated && manifest.logoCloudinaryId) {
    try {
      await monarchApi.setAccountLogo(monarchAccount.id, manifest.logoCloudinaryId);
      debugLog(`[${integrationId}] Account logo set for newly created account`);
    } catch (error) {
      debugLog(`[${integrationId}] Failed to set account logo:`, error.message);
    }
  }

  return { monarchAccount };
}

export default {
  resolveAccountMapping,
};