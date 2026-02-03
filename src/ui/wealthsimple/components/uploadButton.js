/**
 * Wealthsimple Upload Button Component
 * Creates upload button styled for Wealthsimple branding with context-aware labels
 */

import { debugLog } from '../../../core/utils';
import { COLORS } from '../../../core/config';
import wealthsimpleApi from '../../../api/wealthsimple';
import toast from '../../toast';
import {
  uploadAllWealthsimpleAccountsToMonarch,
  uploadWealthsimpleAccountToMonarchWithSteps,
  buildSyncStepsForAccount,
} from '../../../services/wealthsimple-upload';
import { ensureMonarchAuthentication } from '../../components/monarchLoginLink';
import { syncAccountListWithAPI } from '../../../services/wealthsimple/account';
import { getDefaultDateRange } from '../../../services/wealthsimple/balance';
import { showProgressDialog } from '../../components/progressDialog';

/**
 * Determine button label based on current page
 * @returns {string} Button label
 */
function getButtonLabel() {
  const pathname = window.location.pathname;

  // Check if on account detail page
  if (pathname.includes('/app/account-details/')) {
    return 'Sync to Monarch'; // Single account
  }

  // Default for home page and other pages
  return 'Sync All to Monarch'; // All accounts
}

/**
 * Get current account ID from URL if on account detail page
 * @returns {string|null} Account ID or null
 */
function getCurrentAccountId() {
  const pathname = window.location.pathname;
  const match = pathname.match(/\/app\/account-details\/([^/]+)/);
  return match ? match[1] : null;
}

/**
 * Creates a styled button for Wealthsimple
 * @param {string} text - Button text
 * @param {Function} onClick - Click handler
 * @param {Object} options - Button options
 * @returns {HTMLButtonElement} The created button
 */
function createWealthsimpleButton(text, onClick, options = {}) {
  const button = document.createElement('button');
  button.textContent = text;
  button.style.cssText = `
    background-color: ${options.color || COLORS.WEALTHSIMPLE_BRAND};
    color: white;
    border: none;
    border-radius: 4px;
    padding: 10px 16px;
    margin: 5px 0;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
    font-family: "Wealthsimple Sans", sans-serif;
    ${options.disabled ? 'opacity: 0.6; cursor: not-allowed;' : ''}
  `;

  if (options.id) {
    button.id = options.id;
  }

  if (options.className) {
    button.className = options.className;
  }

  button.disabled = Boolean(options.disabled);

  // Add hover effect
  button.addEventListener('mouseover', () => {
    if (!button.disabled) {
      button.style.opacity = '0.85';
    }
  });

  button.addEventListener('mouseout', () => {
    if (!button.disabled) {
      button.style.opacity = '1';
    }
  });

  // Add click handler
  if (onClick && !options.disabled) {
    button.addEventListener('click', onClick);
  }

  return button;
}

/**
 * Upload a single Wealthsimple account with progress dialog
 * Shows the same detailed progress as the bulk upload from the home page
 * @param {string} accountId - The Wealthsimple account ID to sync
 * @returns {Promise<void>}
 */
async function uploadSingleAccountWithProgress(accountId) {
  let progressDialog = null;
  let isCancelled = false;

  try {
    // Sync account list with API to get consolidated account data
    const consolidatedAccounts = await syncAccountListWithAPI();
    const consolidatedAccount = consolidatedAccounts.find(
      (acc) => acc.wealthsimpleAccount.id === accountId,
    );

    if (!consolidatedAccount) {
      throw new Error('Account not found');
    }

    const account = consolidatedAccount.wealthsimpleAccount;

    // Prepare account for progress dialog
    const accountsForDialog = [{
      key: account.id,
      nickname: account.nickname,
      name: account.nickname || account.id,
    }];

    // Create progress dialog for single account
    progressDialog = showProgressDialog(accountsForDialog, `Syncing ${account.nickname || 'Account'} to Monarch`);

    // Set up cancel callback
    progressDialog.onCancel(() => {
      debugLog('Upload cancellation requested');
      isCancelled = true;
      toast.show('Upload cancelled by user', 'info');
    });

    // Fetch balance for this specific account
    const balanceResult = await wealthsimpleApi.fetchAccountBalances([account]);
    if (!balanceResult.success) {
      throw new Error('Failed to fetch account balance');
    }

    const currentBalance = balanceResult.balances.get(accountId);

    // Check if balance is unavailable
    if (currentBalance === null || currentBalance === undefined) {
      debugLog(`Account ${accountId} (${account.nickname}) - balance unavailable`);
      progressDialog.updateProgress(accountId, 'error', 'Balance unavailable');
      progressDialog.hideCancel();
      return;
    }

    // Initialize steps for this account
    const steps = buildSyncStepsForAccount(consolidatedAccount);
    progressDialog.initSteps(accountId, steps);

    // Check for cancellation before upload
    if (isCancelled) {
      progressDialog.hideCancel();
      return;
    }

    // Use the same date range logic as the home page upload
    const { fromDate, toDate } = getDefaultDateRange(consolidatedAccount);
    debugLog(`Account page upload using date range: ${fromDate} to ${toDate}`);

    // Process the account with step-by-step progress tracking
    const result = await uploadWealthsimpleAccountToMonarchWithSteps(
      consolidatedAccount,
      fromDate,
      toDate,
      currentBalance,
      progressDialog,
    );

    // Show summary
    if (result && result.cancelled) {
      progressDialog.showSummary({ success: 0, failed: 0, skipped: 1 });
    } else if (result && result.skipped) {
      progressDialog.showSummary({ success: 0, failed: 0, skipped: 1 });
    } else if (result && result.success) {
      progressDialog.showSummary({ success: 1, failed: 0, skipped: 0 });
      toast.show(`Successfully synced ${account.nickname || 'account'}`, 'info');
    } else {
      progressDialog.showSummary({ success: 0, failed: 1, skipped: 0 });
    }

    progressDialog.hideCancel();
  } catch (error) {
    debugLog('Error in single account sync:', error);
    toast.show(`Sync failed: ${error.message}`, 'error');

    // Clean up progress dialog on error
    if (progressDialog) {
      progressDialog.hideCancel();
    }
  }
}

/**
 * Creates the main upload button for Wealthsimple
 * @returns {HTMLElement} Upload button container
 */
/**
 * Fixed height for upload button container to prevent UI jumps
 * when switching between auth message and button
 */
const UPLOAD_BUTTON_CONTAINER_HEIGHT = '42px';

export function createWealthsimpleUploadButton() {
  const container = document.createElement('div');
  container.id = 'wealthsimple-upload-button-container';
  container.className = 'wealthsimple-upload-button-container';
  container.style.cssText = `margin: 8px 0; min-height: ${UPLOAD_BUTTON_CONTAINER_HEIGHT};`;

  // Check authentication status
  const authStatus = wealthsimpleApi.checkAuth();

  if (!authStatus.authenticated) {
    // Show message if not authenticated
    const message = document.createElement('div');
    message.id = 'wealthsimple-auth-message';
    message.textContent = 'Please log in to Wealthsimple to enable sync functionality';
    message.style.cssText = `
      padding: 10px 12px;
      background-color: #fff3cd;
      color: #856404;
      border: 1px solid #ffeaa7;
      border-radius: 4px;
      font-size: 13px;
      margin: 5px 0;
      font-family: "Wealthsimple Sans", sans-serif;
      min-height: 20px;
      box-sizing: border-box;
    `;
    container.appendChild(message);
    return container;
  }

  // Get context-aware button label
  const buttonLabel = getButtonLabel();
  const accountId = getCurrentAccountId();
  const isAccountDetailPage = Boolean(accountId);

  // Create upload button
  const uploadButton = createWealthsimpleButton(buttonLabel, async () => {
    // Check Monarch authentication before proceeding
    const authenticated = await ensureMonarchAuthentication(null, 'sync Wealthsimple accounts');
    if (!authenticated) {
      return; // User cancelled authentication
    }

    try {
      debugLog(`Starting Wealthsimple sync... (Account detail page: ${isAccountDetailPage})`);

      if (isAccountDetailPage) {
        // Sync single account with progress dialog
        // Don't change button state - the progress dialog provides visual feedback
        await uploadSingleAccountWithProgress(accountId);
      } else {
        // Sync all accounts - show button state change since dialog takes a moment to appear
        uploadButton.disabled = true;
        uploadButton.textContent = 'Syncing all...';
        try {
          await uploadAllWealthsimpleAccountsToMonarch();
        } finally {
          // Re-enable button after bulk sync
          uploadButton.disabled = false;
          uploadButton.textContent = buttonLabel;
        }
      }
    } catch (error) {
      debugLog('Error in Wealthsimple sync:', error);
      toast.show(`Sync failed: ${error.message}`, 'error');
    }
  }, { id: 'wealthsimple-upload-button' });

  container.appendChild(uploadButton);

  return container;
}

export default {
  createWealthsimpleButton,
  createWealthsimpleUploadButton,
};
