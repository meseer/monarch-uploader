/**
 * UI Manager
 * Responsible for initializing and managing UI components
 */

import { debugLog, isQuestradeAllAccountsPage } from '../core/utils';
import { STORAGE } from '../core/config';
import stateManager from '../core/state';
import questradeApi from '../api/questrade';
import monarchApi from '../api/monarch';
import toast from './toast';
import accountSelector from './components/accountSelector';
import uploadButton from './components/uploadButton';

/**
 * Creates and appends status indicators to the provided container
 * @param {HTMLElement} container - Container to append indicators to
 * @returns {Object} Created status indicators
 */
function createStatusIndicators(container) {
  if (!container) return null;

  // Create wrapper
  const wrapper = document.createElement('div');
  wrapper.className = 'balance-uploader-status';
  wrapper.style.cssText = `
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin: 10px 0;
    padding: 10px;
    border-radius: 4px;
    background-color: #f5f5f5;
    font-size: 14px;
  `;

  // Create Questrade status indicator
  const questradeStatus = document.createElement('div');
  questradeStatus.className = 'questrade-status-indicator';
  questradeStatus.textContent = 'Questrade: Checking...';
  questradeStatus.style.cssText = 'display: flex; align-items: center; gap: 5px;';
  wrapper.appendChild(questradeStatus);

  // Create Questrade expiry indicator
  const questradeExpiry = document.createElement('div');
  questradeExpiry.className = 'questrade-expiry-indicator';
  questradeExpiry.style.cssText = 'display: flex; align-items: center; gap: 5px; font-size: 12px; color: #666;';
  wrapper.appendChild(questradeExpiry);

  // Create Monarch status indicator
  const monarchStatus = document.createElement('div');
  monarchStatus.className = 'monarch-status-indicator';
  monarchStatus.textContent = 'Monarch: Checking...';
  monarchStatus.style.cssText = 'display: flex; align-items: center; gap: 5px;';
  wrapper.appendChild(monarchStatus);

  // Create last downloaded note
  const lastDownloaded = document.createElement('div');
  lastDownloaded.className = 'last-downloaded-note';
  lastDownloaded.style.cssText = 'display: flex; align-items: center; gap: 5px; font-size: 12px; color: #666;';
  wrapper.appendChild(lastDownloaded);

  // Append wrapper to container
  container.appendChild(wrapper);

  return {
    questrade: questradeStatus,
    questradeExpiry,
    monarch: monarchStatus,
    lastDownloaded,
  };
}

/**
 * Update status indicators with current state
 * @param {Object} indicators - Status indicator elements
 */
export function updateStatusIndicators(indicators) {
  if (!indicators) return;

  // Get current state
  const state = stateManager.getState();

  // Update Questrade status
  if (indicators.questrade) {
    const questradeToken = questradeApi.getToken();
    if (questradeToken) {
      indicators.questrade.textContent = 'Questrade: Connected';
      indicators.questrade.style.color = '#28a745';
    } else {
      indicators.questrade.textContent = 'Questrade: Not connected';
      indicators.questrade.style.color = '#dc3545';
    }
  }

  // Update Questrade expiry
  if (indicators.questradeExpiry) {
    const questradeToken = questradeApi.getToken();
    if (questradeToken && questradeToken.expires_at) {
      const expiryTime = new Date(questradeToken.expires_at * 1000);
      const now = new Date();
      const minutesLeft = Math.floor((expiryTime - now) / 60000);

      if (minutesLeft > 0) {
        indicators.questradeExpiry.textContent = `Token expires in ${minutesLeft} minutes`;

        if (minutesLeft < 5) {
          indicators.questradeExpiry.style.color = '#dc3545';
        } else if (minutesLeft < 15) {
          indicators.questradeExpiry.style.color = '#fd7e14';
        } else {
          indicators.questradeExpiry.style.color = '#666';
        }
      } else {
        indicators.questradeExpiry.textContent = 'Token expired';
        indicators.questradeExpiry.style.color = '#dc3545';
      }
    } else {
      indicators.questradeExpiry.textContent = '';
    }
  }

  // Update Monarch status
  if (indicators.monarch) {
    const monarchToken = GM_getValue(STORAGE.MONARCH_TOKEN);
    if (monarchToken) {
      indicators.monarch.textContent = 'Monarch: Connected';
      indicators.monarch.style.color = '#28a745';
    } else {
      indicators.monarch.textContent = 'Monarch: Not connected';
      indicators.monarch.style.color = '#dc3545';
    }
  }

  // Update last downloaded note
  if (indicators.lastDownloaded && state.currentAccount.id) {
    const lastUsedDate = GM_getValue(`${STORAGE.LAST_DATE_PREFIX}${state.currentAccount.id}`);
    if (lastUsedDate) {
      indicators.lastDownloaded.textContent = `Last download: ${lastUsedDate}`;
    } else {
      indicators.lastDownloaded.textContent = 'No previous download found';
    }
  } else if (indicators.lastDownloaded) {
    indicators.lastDownloaded.textContent = '';
  }
}

/**
 * Creates button container and adds it to the DOM
 * @returns {HTMLElement} Button container element
 */
export function createButtonContainer() {
  // Create button container
  const container = document.createElement('div');
  container.id = 'balance-uploader-container';
  container.style.cssText = `
    position: relative;
    margin: 15px 0;
    padding: 15px;
    background-color: white;
    border-radius: 8px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  `;

  // Create header
  const header = document.createElement('div');
  header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;';

  const title = document.createElement('h3');
  title.textContent = 'Balance History Uploader';
  title.style.cssText = 'margin: 0; font-size: 18px; font-weight: bold;';
  header.appendChild(title);

  const subtitle = document.createElement('div');
  subtitle.textContent = 'Questrade → Monarch Money';
  subtitle.style.cssText = 'font-size: 14px; color: #666;';
  header.appendChild(subtitle);

  container.appendChild(header);

  return container;
}

/**
 * Initialize UI for a single account page
 */
export async function initSingleAccountUI() {
  try {
    // Extract account ID from URL immediately (always available)
    const matches = window.location.pathname.match(/\/accounts\/([^/]+)/);
    const accountId = matches?.[1] || null;

    if (!accountId) {
      debugLog('No account ID found in URL, skipping single account UI');
      return;
    }

    // Get or create button container
    let container = document.getElementById('balance-uploader-container');
    let isNewContainer = false;

    if (!container) {
      container = createButtonContainer();
      isNewContainer = true;

      // Find the sidebar content (original working approach)
      const targetContainer = document.querySelector('.sidebar__content');
      if (!targetContainer) {
        debugLog('Could not find .sidebar__content insertion point');
        return;
      }

      debugLog('Adding button container to the .sidebar__content insertion point');
      targetContainer.appendChild(container);
    }

    // Clear existing dynamic content if reusing container
    if (!isNewContainer) {
      // Remove all child elements except the header
      const header = container.querySelector('div:first-child');
      container.innerHTML = '';
      if (header) {
        container.appendChild(header);
      }

      // Clean up any existing listeners
      if (container.accountListener) {
        container.accountListener();
        container.accountListener = null;
      }
    }

    // Create status indicators
    const indicators = createStatusIndicators(container);
    stateManager.setUiElement('questrade', indicators.questrade);
    stateManager.setUiElement('questradeExpiry', indicators.questradeExpiry);
    stateManager.setUiElement('monarch', indicators.monarch);
    stateManager.setUiElement('lastDownloadedNote', indicators.lastDownloaded);

    // Update status indicators
    updateStatusIndicators(indicators);

    // Get current account name from state, or use placeholder
    const currentState = stateManager.getState();
    const accountName = currentState.currentAccount.nickname && currentState.currentAccount.nickname !== 'unknown'
      ? currentState.currentAccount.nickname
      : 'Loading...';

    // Create upload button with URL-based account ID
    const uploadBtn = uploadButton.createSingleAccountUploadButton(accountId, accountName);
    uploadBtn.id = 'single-account-upload-btn'; // Add ID for easier updates
    container.appendChild(uploadBtn);

    // Remove any existing listeners for this account to prevent duplicates
    if (container.accountListener) {
      container.accountListener();
      container.accountListener = null;
    }

    // Set up listener to update UI when account info becomes available
    container.accountListener = stateManager.addListener('account', (newState) => {
      // Update UI for any account change, not just when nickname becomes available
      const existingBtn = document.getElementById('single-account-upload-btn');
      if (existingBtn && newState.currentAccount.id && newState.currentAccount.nickname !== 'unknown') {
        existingBtn.textContent = `Upload ${newState.currentAccount.nickname} to Monarch`;
        debugLog(`Updated upload button text to: ${newState.currentAccount.nickname}`);
      }

      // Update status indicators to show last downloaded info for current account
      updateStatusIndicators(indicators);
    });

    debugLog(`Single account UI initialized for account: ${accountId}`);
  } catch (error) {
    debugLog('Error initializing single account UI:', error);
  }
}

/**
 * Initialize UI for all accounts page
 */
export async function initAllAccountsUI() {
  try {
    if (!isQuestradeAllAccountsPage()) return;

    // Get accounts
    let accounts = [];
    try {
      accounts = await questradeApi.fetchAccounts();
    } catch (error) {
      debugLog('Error fetching accounts:', error);
    }

    if (!accounts || accounts.length === 0) {
      toast.show('No accounts found', 'warning');
      return;
    }

    // Get or create button container
    let container = document.getElementById('balance-uploader-container');
    let isNewContainer = false;

    if (!container) {
      container = createButtonContainer();
      isNewContainer = true;

      // Find the sidebar content (original working approach)
      const targetContainer = document.querySelector('.sidebar__content');
      if (!targetContainer) {
        debugLog('Could not find .sidebar__content insertion point');
        return;
      }

      debugLog('Adding button container to the .sidebar__content insertion point');
      targetContainer.appendChild(container);
    }

    // Clear existing dynamic content if reusing container
    if (!isNewContainer) {
      // Remove all child elements except the header
      const header = container.querySelector('div:first-child');
      container.innerHTML = '';
      if (header) {
        container.appendChild(header);
      }

      debugLog('Cleared existing content from container, preserved header');
    }

    // Create status indicators
    const indicators = createStatusIndicators(container);
    stateManager.setUiElement('questrade', indicators.questrade);
    stateManager.setUiElement('questradeExpiry', indicators.questradeExpiry);
    stateManager.setUiElement('monarch', indicators.monarch);

    // Update status indicators
    updateStatusIndicators(indicators);

    // Create bulk upload button
    const bulkBtn = uploadButton.createBulkUploadButton(accounts);
    container.appendChild(bulkBtn);

    debugLog('All accounts UI initialized');
  } catch (error) {
    debugLog('Error initializing all accounts UI:', error);
  }
}

/**
 * Initialize the appropriate UI based on current page
 */
export async function initUI() {
  try {
    const url = window.location.href;

    if (isQuestradeAllAccountsPage()) {
      await initAllAccountsUI();
    } else if (url.includes('/accounts/')) {
      await initSingleAccountUI();
    } else {
      debugLog('Not on a supported Questrade page');
    }
  } catch (error) {
    debugLog('Error initializing UI:', error);
  }
}

export default {
  initUI,
  createButtonContainer,
  updateStatusIndicators,
};
