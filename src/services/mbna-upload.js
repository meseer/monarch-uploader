/**
 * MBNA Upload Service
 *
 * Entry point for MBNA account syncing. Handles account mapping,
 * first-sync date selection, and logo setup, then delegates the
 * actual sync workflow to the generic syncOrchestrator with MBNA
 * sync hooks.
 *
 * @module services/mbna-upload
 */

import { debugLog, calculateFromDateWithLookback, getLastUpdateDate } from '../core/utils';
import { LOGO_CLOUDINARY_IDS } from '../core/config';
import { INTEGRATIONS } from '../core/integrationCapabilities';
import stateManager from '../core/state';
import monarchApi from '../api/monarch';
import accountService from './common/accountService';
import { syncAccount } from './common/syncOrchestrator';
import toast from '../ui/toast';
import { showProgressDialog } from '../ui/components/progressDialog';
import { showMonarchAccountSelectorWithCreate } from '../ui/components/accountSelectorWithCreate';
import { showDatePickerWithOptionsPromise } from '../ui/components/datePicker';
import { manifest as mbnaManifest, syncHooks as mbnaSyncHooks } from '../integrations/mbna';

const INTEGRATION_ID = INTEGRATIONS.MBNA;

/**
 * Check if this is the first sync for the account
 * @param {string} mbnaAccountId - MBNA account ID
 * @returns {boolean} True if first sync
 */
function isFirstSync(mbnaAccountId) {
  return !getLastUpdateDate(mbnaAccountId, 'mbna');
}

/**
 * Sync a single MBNA account to Monarch via the generic orchestrator.
 *
 * @param {Object} account - MBNA account from accounts summary
 * @param {Object} monarchAccount - Monarch account mapping
 * @param {Object} api - MBNA API client instance
 * @param {Object} options - Sync options
 * @param {string} options.fromDate - Start date for transaction fetch
 * @param {boolean} options.reconstructBalance - Whether to reconstruct balance history
 * @param {boolean} options.firstSync - Whether this is the first sync
 * @returns {Promise<{success: boolean, message: string}>} Sync result
 */
export async function syncMbnaAccount(account, monarchAccount, api, options = {}) {
  const { accountId } = account;
  const { fromDate, reconstructBalance = false, firstSync: isFirst = false } = options;
  const accountDisplayName = account.displayName || `MBNA Card (${account.endingIn})`;

  stateManager.setAccount(accountId, accountDisplayName);

  // Create progress dialog
  const progressDialog = showProgressDialog(
    [{ key: accountId, nickname: accountDisplayName, name: 'MBNA Upload' }],
    'Syncing MBNA Data to Monarch Money',
  );

  return syncAccount({
    integrationId: INTEGRATION_ID,
    manifest: mbnaManifest,
    hooks: mbnaSyncHooks,
    api,
    account,
    accountDisplayName,
    monarchAccount,
    fromDate,
    reconstructBalance,
    firstSync: isFirst,
    progressDialog,
  });
}

/**
 * Handle the full MBNA upload flow for a single account.
 * Resolves the Monarch account mapping (creating if needed),
 * determines date range, sets icon on newly created accounts, then runs the sync.
 *
 * @param {Object} account - MBNA account from accounts summary
 * @param {Object} api - MBNA API client instance
 * @returns {Promise<{success: boolean, message: string}>} Upload result
 */
export async function uploadMbnaAccount(account, api) {
  const { accountId } = account;
  const accountDisplayName = account.displayName || `MBNA Card (${account.endingIn})`;

  stateManager.setAccount(accountId, accountDisplayName);

  // Check for existing Monarch account mapping
  let monarchAccount = accountService.getMonarchAccountMapping(INTEGRATION_ID, accountId);

  if (monarchAccount) {
    debugLog('[MBNA] Using existing mapping:', accountDisplayName, '→', monarchAccount.displayName);
  } else {
    // Check if account was previously skipped
    const accountData = accountService.getAccountData(INTEGRATION_ID, accountId);
    if (accountData && accountData.syncEnabled === false) {
      debugLog('[MBNA] Account was skipped:', accountDisplayName);
      return { success: true, message: 'Skipped', skipped: true };
    }

    // Show account selector for first-sync mapping
    debugLog('[MBNA] No mapping for', accountDisplayName, '— showing account selector');

    const createDefaults = {
      defaultName: accountDisplayName,
      defaultType: 'credit',
      defaultSubtype: 'credit_card',
      accountType: 'credit',
    };

    monarchAccount = await new Promise((resolve) => {
      showMonarchAccountSelectorWithCreate(
        [],
        (selectedAccount) => resolve(selectedAccount),
        null,
        'credit',
        createDefaults,
      );
    });

    if (!monarchAccount) {
      toast.show('Account mapping cancelled', 'info', 2000);
      return { success: false, message: 'Cancelled' };
    }

    if (monarchAccount.cancelled) {
      return { success: false, message: 'Cancelled' };
    }

    if (monarchAccount.skipped) {
      const skippedData = {
        mbnaAccount: {
          id: accountId,
          endingIn: account.endingIn,
          cardName: account.cardName,
          nickname: accountDisplayName,
        },
        monarchAccount: null,
        syncEnabled: false,
        lastSyncDate: null,
      };
      accountService.upsertAccount(INTEGRATION_ID, skippedData);
      toast.show(`${accountDisplayName}: skipped`, 'info', 2000);
      return { success: true, message: 'Skipped', skipped: true };
    }

    // Save the mapping
    const accountData2 = {
      mbnaAccount: {
        id: accountId,
        endingIn: account.endingIn,
        cardName: account.cardName,
        nickname: accountDisplayName,
      },
      monarchAccount: {
        id: monarchAccount.id,
        displayName: monarchAccount.displayName,
      },
      syncEnabled: true,
      lastSyncDate: null,
    };
    accountService.upsertAccount(INTEGRATION_ID, accountData2);

    debugLog('[MBNA] Account mapping saved:', accountDisplayName, '→', monarchAccount.displayName);
    toast.show(`Mapped: ${accountDisplayName} → ${monarchAccount.displayName}`, 'success', 3000);

    // Set icon on newly created accounts
    if (monarchAccount.newlyCreated && LOGO_CLOUDINARY_IDS.MBNA) {
      try {
        await monarchApi.setAccountLogo(monarchAccount.id, LOGO_CLOUDINARY_IDS.MBNA);
        debugLog('[MBNA] Account logo set for newly created account');
      } catch (error) {
        debugLog('[MBNA] Failed to set account logo:', error.message);
      }
    }
  }

  // Determine date range
  const firstSync = isFirstSync(accountId);
  let fromDate;
  let reconstructBalance = false;

  if (firstSync) {
    // Determine suggested start date: 30 days before oldest closing date, fallback to 90 days ago
    let defaultDate;
    try {
      const closingDates = await api.getClosingDates(accountId);
      if (closingDates.length > 0) {
        const oldestClosingDate = closingDates[closingDates.length - 1]; // sorted newest-first
        const d = new Date(`${oldestClosingDate}T00:00:00`);
        d.setDate(d.getDate() - 30);
        defaultDate = d.toISOString().split('T')[0];
        debugLog(`[MBNA] Suggested start date: ${defaultDate} (30 days before oldest closing date ${oldestClosingDate})`);
      }
    } catch (error) {
      debugLog('[MBNA] Could not fetch closing dates for start date suggestion:', error.message);
    }
    if (!defaultDate) {
      const d = new Date();
      d.setDate(d.getDate() - 90);
      defaultDate = d.toISOString().split('T')[0];
    }

    const datePickerResult = await showDatePickerWithOptionsPromise(
      defaultDate,
      `Select the start date for syncing "${accountDisplayName}". Default is 30 days before your oldest statement.`,
      { showReconstructCheckbox: true, reconstructCheckedByDefault: true },
    );

    if (!datePickerResult) {
      toast.show('Sync cancelled', 'info');
      return { success: false, message: 'Date selection cancelled' };
    }

    fromDate = datePickerResult.date;
    reconstructBalance = datePickerResult.reconstructBalance;
  } else {
    fromDate = calculateFromDateWithLookback('mbna', accountId) || (() => {
      const d = new Date();
      d.setDate(d.getDate() - 14);
      return d.toISOString().split('T')[0];
    })();
  }

  // Run the sync
  return syncMbnaAccount(account, monarchAccount, api, {
    fromDate,
    reconstructBalance,
    firstSync,
  });
}

export default {
  syncMbnaAccount,
  uploadMbnaAccount,
};