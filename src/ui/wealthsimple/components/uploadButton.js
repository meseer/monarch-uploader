/**
 * Wealthsimple Upload Button Component
 * Creates upload button styled for Wealthsimple branding with context-aware labels
 */

import { debugLog } from '../../../core/utils';
import { COLORS } from '../../../core/config';
import wealthsimpleApi from '../../../api/wealthsimple';
import toast from '../../toast';
import { uploadAllWealthsimpleAccountsToMonarch, uploadWealthsimpleAccountToMonarch } from '../../../services/wealthsimple-upload';
import { ensureMonarchAuthentication } from '../../components/monarchLoginLink';
import { syncAccountListWithAPI } from '../../../services/wealthsimple/account';

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
      // Disable button while uploading
      uploadButton.disabled = true;
      uploadButton.textContent = isAccountDetailPage ? 'Syncing...' : 'Syncing all...';

      debugLog(`Starting Wealthsimple sync... (Account detail page: ${isAccountDetailPage})`);

      if (isAccountDetailPage) {
        // Sync single account - get consolidated account list
        const consolidatedAccounts = await syncAccountListWithAPI();
        const consolidatedAccount = consolidatedAccounts.find(
          (acc) => acc.wealthsimpleAccount.id === accountId,
        );

        if (!consolidatedAccount) {
          throw new Error('Account not found');
        }

        // Fetch balance for this specific account
        const balanceResult = await wealthsimpleApi.fetchAccountBalances([accountId]);
        if (!balanceResult.success) {
          throw new Error('Failed to fetch account balance');
        }

        const currentBalance = balanceResult.balances.get(accountId);

        const toDate = new Date().toISOString().split('T')[0];
        const fromDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        await uploadWealthsimpleAccountToMonarch(consolidatedAccount, fromDate, toDate, currentBalance);
      } else {
        // Sync all accounts
        await uploadAllWealthsimpleAccountsToMonarch();
      }
    } catch (error) {
      debugLog('Error in Wealthsimple sync:', error);
      toast.show(`Sync failed: ${error.message}`, 'error');
    } finally {
      // Re-enable button
      uploadButton.disabled = false;
      uploadButton.textContent = buttonLabel;
    }
  }, { id: 'wealthsimple-upload-button' });

  container.appendChild(uploadButton);

  return container;
}

export default {
  createWealthsimpleButton,
  createWealthsimpleUploadButton,
};
