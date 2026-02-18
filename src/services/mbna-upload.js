/**
 * MBNA Upload Service
 *
 * Orchestrates syncing MBNA credit card data to Monarch Money.
 * Currently implements credit limit sync only (Milestone 4).
 * Balance, transactions, and pending reconciliation will be added in later milestones.
 *
 * @module services/mbna-upload
 */

import { debugLog, getTodayLocal } from '../core/utils';
import { LOGO_CLOUDINARY_IDS } from '../core/config';
import { INTEGRATIONS } from '../core/integrationCapabilities';
import stateManager from '../core/state';
import monarchApi from '../api/monarch';
import accountService from './common/accountService';
import toast from '../ui/toast';
import { showProgressDialog } from '../ui/components/progressDialog';
import { showMonarchAccountSelectorWithCreate } from '../ui/components/accountSelectorWithCreate';

/**
 * Build sync steps for the progress dialog.
 * Credit limit is the only active step for now; others are shown as skipped.
 *
 * @returns {Array<{key: string, name: string}>} Step definitions
 */
function buildSyncSteps() {
  return [
    { key: 'creditLimit', name: 'Credit limit sync' },
    { key: 'balance', name: 'Balance upload' },
    { key: 'transactions', name: 'Transaction sync' },
    { key: 'pending', name: 'Pending reconciliation' },
  ];
}

/**
 * Sync credit limit from MBNA to Monarch.
 * Compares with last synced value to avoid unnecessary API calls.
 *
 * @param {string} mbnaAccountId - MBNA account ID
 * @param {string} monarchAccountId - Monarch account ID
 * @param {number|null} creditLimit - Credit limit value from MBNA API
 * @returns {Promise<{success: boolean, message: string}>} Sync result
 */
async function syncCreditLimit(mbnaAccountId, monarchAccountId, creditLimit) {
  if (creditLimit === null || creditLimit === undefined) {
    return { success: true, message: 'Not available', skipped: true };
  }

  // Check if credit limit has changed since last sync
  const accountData = accountService.getAccountData(INTEGRATIONS.MBNA, mbnaAccountId);
  const storedCreditLimit = accountData?.lastSyncedCreditLimit;

  if (storedCreditLimit !== null && storedCreditLimit !== undefined && storedCreditLimit === creditLimit) {
    debugLog(`[MBNA] Credit limit unchanged: $${creditLimit}`);
    return { success: true, message: `$${creditLimit.toLocaleString()} (unchanged)`, skipped: false };
  }

  try {
    const updatedAccount = await monarchApi.setCreditLimit(monarchAccountId, creditLimit);

    // Verify the credit limit was actually applied
    if (updatedAccount && updatedAccount.limit === creditLimit) {
      // Save to consolidated storage
      accountService.updateAccountInList(INTEGRATIONS.MBNA, mbnaAccountId, {
        lastSyncedCreditLimit: creditLimit,
      });
      debugLog(`[MBNA] Credit limit synced: $${creditLimit}`);
      return { success: true, message: `$${creditLimit.toLocaleString()}`, skipped: false };
    }

    // API call succeeded but limit wasn't applied correctly
    debugLog(`[MBNA] Credit limit update returned but value not applied. Expected: ${creditLimit}, Got: ${updatedAccount?.limit}`);
    return { success: false, message: 'Value not applied', skipped: false };
  } catch (error) {
    debugLog('[MBNA] Error syncing credit limit:', error);
    return { success: false, message: error.message, skipped: false };
  }
}

/**
 * Sync a single MBNA account to Monarch.
 * Shows progress dialog with all sync steps.
 *
 * @param {Object} account - MBNA account from accounts summary
 * @param {Object} account.accountId - MBNA account ID
 * @param {Object} account.displayName - Account display name
 * @param {Object} monarchAccount - Monarch account mapping
 * @param {Object} monarchAccount.id - Monarch account ID
 * @param {Object} monarchAccount.displayName - Monarch account display name
 * @param {Object} api - MBNA API client instance
 * @returns {Promise<{success: boolean, message: string}>} Sync result
 */
export async function syncMbnaAccount(account, monarchAccount, api) {
  const { accountId } = account;
  const accountDisplayName = account.displayName || `MBNA Card (${account.endingIn})`;

  // Set current account in state manager
  stateManager.setAccount(accountId, accountDisplayName);

  // Create progress dialog
  const progressDialog = showProgressDialog(
    [{ key: accountId, nickname: accountDisplayName, name: 'MBNA Upload' }],
    'Syncing MBNA Data to Monarch Money',
  );
  progressDialog.initSteps(accountId, buildSyncSteps());

  const abortController = new AbortController();
  progressDialog.onCancel(() => abortController.abort());

  try {
    // ── STEP 1: Credit Limit Sync ──────────────────────────
    progressDialog.updateStepStatus(accountId, 'creditLimit', 'processing', 'Fetching...');

    if (abortController.signal.aborted) {
      throw new Error('Cancelled');
    }

    let creditLimit = null;
    try {
      creditLimit = await api.getCreditLimit(accountId);
      debugLog(`[MBNA] Credit limit fetched: $${creditLimit}`);
    } catch (error) {
      debugLog('[MBNA] Error fetching credit limit:', error);
      progressDialog.updateStepStatus(accountId, 'creditLimit', 'error', error.message);
    }

    if (creditLimit !== null) {
      progressDialog.updateStepStatus(accountId, 'creditLimit', 'processing', 'Syncing...');
      const creditLimitResult = await syncCreditLimit(accountId, monarchAccount.id, creditLimit);

      if (creditLimitResult.success) {
        progressDialog.updateStepStatus(accountId, 'creditLimit', 'success', creditLimitResult.message);
      } else {
        progressDialog.updateStepStatus(accountId, 'creditLimit', 'error', creditLimitResult.message);
      }
    } else if (!abortController.signal.aborted) {
      progressDialog.updateStepStatus(accountId, 'creditLimit', 'skipped', 'Not available');
    }

    // ── STEP 2: Balance Upload (skipped — Milestone 5+) ────
    progressDialog.updateStepStatus(accountId, 'balance', 'skipped', 'Coming soon');

    // ── STEP 3: Transaction Sync (skipped — Milestone 5) ───
    progressDialog.updateStepStatus(accountId, 'transactions', 'skipped', 'Coming soon');

    // ── STEP 4: Pending Reconciliation (skipped — Milestone 6)
    progressDialog.updateStepStatus(accountId, 'pending', 'skipped', 'Coming soon');

    // ── Update sync metadata ───────────────────────────────
    accountService.updateAccountInList(INTEGRATIONS.MBNA, accountId, {
      lastSyncDate: getTodayLocal(),
    });

    // Show summary
    progressDialog.hideCancel();
    progressDialog.showSummary({ success: 1, failed: 0, total: 1 });

    return { success: true, message: 'Credit limit synced' };
  } catch (error) {
    debugLog('[MBNA] Sync error:', error);

    if (error.message === 'Cancelled') {
      progressDialog.updateProgress(accountId, 'error', 'Cancelled');
    } else {
      progressDialog.updateProgress(accountId, 'error', `Failed: ${error.message}`);
    }

    progressDialog.hideCancel();
    progressDialog.showSummary({ success: 0, failed: 1, total: 1 });

    return { success: false, message: error.message };
  }
}

/**
 * Handle the full MBNA upload flow for a single account.
 * Resolves the Monarch account mapping (creating if needed),
 * sets icon on newly created accounts, then runs the sync.
 *
 * @param {Object} account - MBNA account from accounts summary
 * @param {Object} api - MBNA API client instance
 * @returns {Promise<{success: boolean, message: string}>} Upload result
 */
export async function uploadMbnaAccount(account, api) {
  const { accountId } = account;
  const accountDisplayName = account.displayName || `MBNA Card (${account.endingIn})`;

  // Set current account in state manager BEFORE showing account selector
  // (the selector reads stateManager for the account banner display)
  stateManager.setAccount(accountId, accountDisplayName);

  // Check for existing Monarch account mapping
  let monarchAccount = accountService.getMonarchAccountMapping(
    INTEGRATIONS.MBNA,
    accountId,
  );

  if (monarchAccount) {
    debugLog('[MBNA] Using existing mapping:', accountDisplayName, '→', monarchAccount.displayName);
  } else {
    // Check if account was previously skipped
    const accountData = accountService.getAccountData(INTEGRATIONS.MBNA, accountId);
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
      // Save as skipped
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
      accountService.upsertAccount(INTEGRATIONS.MBNA, skippedData);
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
    accountService.upsertAccount(INTEGRATIONS.MBNA, accountData2);

    debugLog('[MBNA] Account mapping saved:', accountDisplayName, '→', monarchAccount.displayName);
    toast.show(`Mapped: ${accountDisplayName} → ${monarchAccount.displayName}`, 'success', 3000);

    // Set icon on newly created accounts
    if (monarchAccount.newlyCreated && LOGO_CLOUDINARY_IDS.MBNA) {
      try {
        await monarchApi.setAccountLogo(monarchAccount.id, LOGO_CLOUDINARY_IDS.MBNA);
        debugLog('[MBNA] Account logo set for newly created account');
      } catch (error) {
        debugLog('[MBNA] Failed to set account logo:', error.message);
        // Non-fatal — continue with sync
      }
    }
  }

  // Run the sync
  return syncMbnaAccount(account, monarchAccount, api);
}

export default {
  syncMbnaAccount,
  uploadMbnaAccount,
};