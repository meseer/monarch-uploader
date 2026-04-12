/**
 * Questrade Account Mapping Module
 *
 * Consolidates account mapping logic used across sync and balance services.
 * Handles the full flow: check existing mapping, show selector, handle skip,
 * save mapping, and set logo for newly created accounts.
 *
 * @module services/questrade/accountMapping
 */

import { debugLog } from '../../core/utils';
import { LOGO_CLOUDINARY_IDS } from '../../core/config';
import { INTEGRATIONS } from '../../core/integrationCapabilities';
import stateManager from '../../core/state';
import monarchApi from '../../api/monarch';
import accountService from '../common/accountService';
import toast from '../../ui/toast';
import { showMonarchAccountSelectorWithCreate } from '../../ui/components/accountSelectorWithCreate';

/**
 * Ensure a Questrade account has a Monarch account mapping.
 *
 * Flow:
 * 1. Check for existing mapping → return immediately if found
 * 2. Check if account was previously skipped → return skipped
 * 3. Show account selector dialog
 * 4. Handle cancel/skip/selection
 * 5. Save mapping to consolidated storage
 * 6. Set logo on newly created Monarch accounts
 * 7. Update progress dialog if provided
 *
 * @param {string} accountId - Questrade account ID
 * @param {string} accountName - Account display name
 * @param {Object} [progressDialog] - Optional progress dialog for status updates
 * @param {Array} [cachedMonarchAccounts] - Optional pre-fetched Monarch accounts (performance optimization)
 * @returns {Promise<Object|null>}
 *   - { monarchAccount: {...} } if mapped successfully
 *   - { skipped: true } if user skipped
 *   - null if user cancelled
 */
export async function ensureAccountMapping(accountId, accountName, progressDialog = null, cachedMonarchAccounts = null) {
  try {
    // 1. Check for existing mapping in consolidated storage
    const existingMapping = accountService.getMonarchAccountMapping(INTEGRATIONS.QUESTRADE, accountId);
    if (existingMapping) {
      debugLog(`Using existing Questrade mapping: ${accountName} → ${existingMapping.displayName}`);
      return { monarchAccount: existingMapping };
    }

    // 2. Check if account was previously skipped (BEFORE fetching accounts)
    const accountData = accountService.getAccountData(INTEGRATIONS.QUESTRADE, accountId);
    if (accountData && accountData.syncEnabled === false) {
      debugLog(`Questrade account ${accountName} was previously skipped`);
      return { skipped: true };
    }

    // 3. Get Monarch accounts (use cache if available, otherwise fetch)
    debugLog(`No mapping found for Questrade account ${accountName}, showing selector`);

    if (progressDialog) {
      progressDialog.updateProgress(accountId, 'processing', 'Waiting for account selection...');
    }

    let investmentAccounts = cachedMonarchAccounts;
    if (!investmentAccounts) {
      debugLog(`Fetching Monarch accounts for ${accountName}`);
      investmentAccounts = await monarchApi.listAccounts();
    }

    if (!investmentAccounts.length) {
      toast.show('No investment accounts found in Monarch', 'error');
      return null;
    }

    // Set current account context for the selector
    stateManager.setAccount(accountId, accountName);

    // Prepare defaults for account creation
    const createDefaults = {
      defaultName: accountName,
      defaultType: 'brokerage',
      defaultSubtype: 'brokerage',
      currentBalance: null,
      accountType: 'Investment',
    };

    // Show enhanced account selector with create option
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const selectedAccount = await new Promise<any>((resolve) => {
      showMonarchAccountSelectorWithCreate(
        investmentAccounts,
        resolve,
        null,
        'brokerage',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        createDefaults as any,
      );
    });

    // 4. Handle cancel
    if (!selectedAccount) {
      debugLog(`Account mapping cancelled for ${accountName}`);
      if (progressDialog) {
        progressDialog.updateProgress(accountId, 'skipped', 'Mapping cancelled');
      }
      return null;
    }

    // 5. Handle skip - save skip state to consolidated storage
    if (selectedAccount.skipped) {
      const skipData = {
        questradeAccount: {
          id: accountId,
          nickname: accountName,
        },
        monarchAccount: null,
        syncEnabled: false,
      };

      const upsertSuccess = accountService.upsertAccount(INTEGRATIONS.QUESTRADE, skipData);
      debugLog(`Questrade account ${accountName} skipped by user, saved: ${upsertSuccess}`);

      if (progressDialog) {
        progressDialog.updateProgress(accountId, 'skipped', 'Account skipped');
      }

      toast.show(`${accountName}: skipped`, 'info', 2000);
      return { skipped: true };
    }

    // 6. Set logo on newly created accounts
    if (selectedAccount.newlyCreated) {
      try {
        debugLog(`Setting Questrade logo for newly created account ${selectedAccount.id}`);
        await monarchApi.setAccountLogo(selectedAccount.id as string, LOGO_CLOUDINARY_IDS.QUESTRADE);
        debugLog(`Successfully set Questrade logo for ${selectedAccount.displayName}`);
        toast.show(`Set Questrade logo for ${selectedAccount.displayName}`, 'debug');
      } catch (logoError) {
        // Logo setting failed, but account creation succeeded - continue with warning
        debugLog('Failed to set Questrade logo:', logoError);
        toast.show(`Warning: Failed to set logo for ${selectedAccount.displayName}`, 'warning');
      }
    }

    // 7. Save mapping to consolidated storage
    const mappingData = {
      questradeAccount: {
        id: accountId,
        nickname: accountName,
      },
      monarchAccount: {
        id: selectedAccount.id,
        displayName: selectedAccount.displayName,
      },
      syncEnabled: true,
    };

    const upsertSuccess = accountService.upsertAccount(INTEGRATIONS.QUESTRADE, mappingData);
    debugLog(`Saved Questrade account mapping: ${accountName} → ${selectedAccount.displayName}, success: ${upsertSuccess}`);

    if (progressDialog) {
      progressDialog.updateProgress(accountId, 'success', 'Mapping complete');
    }

    toast.show(`Mapped: ${accountName} → ${selectedAccount.displayName}`, 'success', 3000);

    return { monarchAccount: selectedAccount };
  } catch (error) {
    debugLog(`Error ensuring Questrade account mapping for ${accountId}:`, error);
    if (progressDialog) {
      progressDialog.updateProgress(accountId, 'error', `Mapping error: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Ensure all accounts in a list have Monarch mappings.
 * Processes accounts sequentially and returns true if all are mapped or skipped.
 * Fetches Monarch accounts once and caches for all account mapping operations.
 *
 * @param {Array} accounts - List of Questrade accounts to map
 * @param {Object} [progressDialog] - Optional progress dialog for status updates
 * @returns {Promise<boolean>} True if all accounts processed, false if cancelled
 */
export async function ensureAllAccountMappings(accounts, progressDialog = null) {
  const unmappedAccounts = [];

  // Check each account for existing mapping OR skip state
  for (const account of accounts) {
    const accountData = accountService.getAccountData(INTEGRATIONS.QUESTRADE, account.key);
    if (accountData?.monarchAccount || accountData?.syncEnabled === false) {
      continue; // Already mapped or previously skipped
    }
    unmappedAccounts.push(account);
  }

  // Return early if all accounts are mapped or skipped
  if (unmappedAccounts.length === 0) {
    debugLog('All Questrade accounts already have mappings or are skipped');
    return true;
  }

  // Show message about missing mappings
  toast.show(`${unmappedAccounts.length} Questrade accounts need to be mapped`, 'info');

  // Fetch Monarch accounts ONCE for all unmapped accounts (performance optimization)
  debugLog('Fetching Monarch accounts once for all unmapped accounts');
  const monarchAccounts = await monarchApi.listAccounts();

  if (!monarchAccounts.length) {
    toast.show('No investment accounts found in Monarch', 'error');
    return false;
  }

  // Process each unmapped account with cached Monarch accounts
  for (const account of unmappedAccounts) {
    const accountName = account.nickname || account.name || 'Account';

    const result = await ensureAccountMapping(account.key, accountName, progressDialog, monarchAccounts);

    if (!result) {
      // User cancelled
      debugLog('Account mapping cancelled by user');
      return false;
    }

    if (result.skipped) {
      debugLog(`Account ${accountName} skipped, continuing to next account`);
      continue;
    }

    debugLog(`Account ${accountName} mapped successfully`);
  }

  return true;
}

