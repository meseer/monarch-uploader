/**
 * UI Manager
 * Responsible for initializing and managing UI components
 */

import { debugLog, isQuestradeAllAccountsPage, getLastUpdateDate } from '../../core/utils';
import { STORAGE } from '../../core/config';
import stateManager from '../../core/state';
import questradeApi from '../../api/questrade';
import toast from '../toast';
import uploadButton, { createTestingSection } from './components/uploadButton';
import { showSettingsModal } from '../components/settingsModal';
import { createMonarchLoginLink } from '../components/monarchLoginLink';
import { getAccountsForSync } from '../../services/questrade/balance';

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
    background-color: var(--mu-bg-tertiary, #f5f5f5);
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
  questradeExpiry.style.cssText = 'display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--mu-text-secondary, #666);';
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
  lastDownloaded.style.cssText = 'display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--mu-text-secondary, #666);';
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

    // Clear existing content
    indicators.monarch.innerHTML = '';

    if (monarchToken) {
      indicators.monarch.textContent = 'Monarch: Connected';
      indicators.monarch.style.color = '#28a745';
    } else {
      // Create clickable login link
      const loginLink = createMonarchLoginLink('Monarch: Connect', () => {
        // Callback to update status after successful login
        updateStatusIndicators(indicators);
      });
      indicators.monarch.appendChild(loginLink);
    }
  }

  // Update last downloaded note
  if (indicators.lastDownloaded && state.currentAccount.id) {
    const lastUsedDate = getLastUpdateDate(state.currentAccount.id, 'questrade');
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
    background-color: var(--mu-bg-primary, white);
    color: var(--mu-text-primary, #333);
    border-radius: 8px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  `;

  // Create header
  const header = document.createElement('div');
  header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;';

  const titleSection = document.createElement('div');
  titleSection.style.cssText = 'display: flex; flex-direction: column;';

  const titleRow = document.createElement('div');
  titleRow.style.cssText = 'display: flex; align-items: center; gap: 10px;';

  const title = document.createElement('h3');
  title.textContent = 'Balance History Uploader';
  title.style.cssText = 'margin: 0; font-size: 18px; font-weight: bold;';
  titleRow.appendChild(title);

  const settingsButton = document.createElement('button');
  settingsButton.innerHTML = '⚙️';
  settingsButton.title = 'Settings';
  settingsButton.style.cssText = `
    background: none;
    border: none;
    font-size: 16px;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 4px;
    color: #666;
    transition: background-color 0.2s;
  `;
  settingsButton.addEventListener('click', showSettingsModal);
  settingsButton.addEventListener('mouseover', () => {
    settingsButton.style.backgroundColor = '#f0f0f0';
  });
  settingsButton.addEventListener('mouseout', () => {
    settingsButton.style.backgroundColor = 'transparent';
  });
  titleRow.appendChild(settingsButton);

  titleSection.appendChild(titleRow);

  const subtitle = document.createElement('div');
  subtitle.textContent = 'Questrade → Monarch Money';
  subtitle.style.cssText = 'font-size: 14px; color: #666;';
  titleSection.appendChild(subtitle);

  header.appendChild(titleSection);

  container.appendChild(header);

  return container;
}

/**
 * Wait for target element to appear using MutationObserver
 * @param {string} selector - CSS selector for target element
 * @param {number} timeout - Maximum time to wait in milliseconds
 * @returns {Promise<Element|null>} Promise that resolves with the element or null if timeout
 */
function waitForTargetElement(selector, timeout = 30000) {
  return new Promise((resolve) => {
    // Check if element already exists
    const element = document.querySelector(selector);
    if (element) {
      resolve(element);
      return;
    }

    let observer = null;
    let timeoutId = null;
    let resolved = false;

    // Create observer
    observer = new MutationObserver((mutations, obs) => {
      // Check if target element now exists
      const targetElement = document.querySelector(selector);

      if (targetElement && !resolved) {
        resolved = true;
        obs.disconnect();

        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        debugLog(`Target element found: ${selector}`);
        resolve(targetElement);
      }
    });

    // Start observing
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // Set timeout
    timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        debugLog(`Timeout waiting for element: ${selector} (${timeout}ms)`);
        if (observer) {
          observer.disconnect();
        }
        resolve(null);
      }
    }, timeout);

    debugLog(`MutationObserver started, waiting for: ${selector}`);
  });
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
      let targetContainer = document.querySelector('.sidebar__content');

      // If not found immediately, wait for it with MutationObserver
      if (!targetContainer) {
        debugLog('Sidebar content not found, setting up observer to wait for it...');
        targetContainer = await waitForTargetElement('.sidebar__content', 30000);

        if (!targetContainer) {
          debugLog('Could not find .sidebar__content insertion point after waiting');
          toast.show('UI element not found - please refresh the page', 'warning');
          return;
        }
      }

      debugLog('Adding button container to the .sidebar__content insertion point');
      targetContainer.appendChild(container);
    }

    // Clear existing dynamic content if reusing container
    if (!isNewContainer) {
      // Clear all content and recreate header to ensure gear button is present
      container.innerHTML = '';

      // Recreate header with gear button
      const header = document.createElement('div');
      header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;';

      const titleSection = document.createElement('div');
      titleSection.style.cssText = 'display: flex; flex-direction: column;';

      const titleRow = document.createElement('div');
      titleRow.style.cssText = 'display: flex; align-items: center; gap: 10px;';

      const title = document.createElement('h3');
      title.textContent = 'Balance History Uploader';
      title.style.cssText = 'margin: 0; font-size: 18px; font-weight: bold;';
      titleRow.appendChild(title);

      const settingsButton = document.createElement('button');
      settingsButton.innerHTML = '⚙️';
      settingsButton.title = 'Settings';
      settingsButton.style.cssText = `
        background: none;
        border: none;
        font-size: 16px;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: 4px;
        color: #666;
        transition: background-color 0.2s;
      `;
      settingsButton.addEventListener('click', showSettingsModal);
      settingsButton.addEventListener('mouseover', () => {
        settingsButton.style.backgroundColor = 'var(--mu-hover-bg, #f0f0f0)';
      });
      settingsButton.addEventListener('mouseout', () => {
        settingsButton.style.backgroundColor = 'transparent';
      });
      titleRow.appendChild(settingsButton);

      titleSection.appendChild(titleRow);

      const subtitle = document.createElement('div');
      subtitle.textContent = 'Questrade → Monarch Money';
      subtitle.style.cssText = 'font-size: 14px; color: var(--mu-text-secondary, #666);';
      titleSection.appendChild(subtitle);

      header.appendChild(titleSection);
      container.appendChild(header);

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

    // Add testing section (only visible in Development Mode)
    const testingSection = createTestingSection({ accountId, accountName });
    if (testingSection) {
      container.appendChild(testingSection);
    }

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

    // Get or create button container
    let container = document.getElementById('balance-uploader-container');
    let isNewContainer = false;

    if (!container) {
      container = createButtonContainer();
      isNewContainer = true;

      // Find the sidebar content (original working approach)
      let targetContainer = document.querySelector('.sidebar__content');

      // If not found immediately, wait for it with MutationObserver
      if (!targetContainer) {
        debugLog('Sidebar content not found, setting up observer to wait for it...');
        targetContainer = await waitForTargetElement('.sidebar__content', 30000);

        if (!targetContainer) {
          debugLog('Could not find .sidebar__content insertion point after waiting');
          toast.show('UI element not found - please refresh the page', 'warning');
          return;
        }
      }

      debugLog('Adding button container to the .sidebar__content insertion point');
      targetContainer.appendChild(container);
    }

    // Now that we know the SPA has loaded (sidebar exists), fetch accounts with retries
    // Use getAccountsForSync to merge API accounts with storage accounts (for closed accounts)
    let accounts = [];
    const maxRetries = 10;
    const retryDelay = 1000; // Check every 1 second for better responsiveness

    debugLog('Starting to fetch accounts with retries (using getAccountsForSync)...');

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Use getAccountsForSync to get merged list (API + storage accounts)
        // excludes accounts already marked as 'closed', includes 'pending_close' accounts
        accounts = await getAccountsForSync({ includeClosed: false });

        if (accounts && accounts.length > 0) {
          debugLog(`Successfully fetched ${accounts.length} accounts on attempt ${attempt} (merged API + storage)`);
          break;
        }

        // If no accounts and not the last attempt, wait and retry
        if (attempt < maxRetries) {
          debugLog(`No accounts found on attempt ${attempt}, retrying in ${retryDelay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
        }
      } catch (error) {
        debugLog(`Error fetching accounts on attempt ${attempt}:`, error);

        // If error and not the last attempt, wait and retry
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
        }
      }
    }

    if (!accounts || accounts.length === 0) {
      debugLog('No accounts found after all retry attempts');
      toast.show('No accounts found after waiting for data to load', 'debug');
      return;
    }

    // Clear existing dynamic content if reusing container
    if (!isNewContainer) {
      // Clear all content and recreate header to ensure gear button is present
      container.innerHTML = '';

      // Recreate header with gear button
      const header = document.createElement('div');
      header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;';

      const titleSection = document.createElement('div');
      titleSection.style.cssText = 'display: flex; flex-direction: column;';

      const titleRow = document.createElement('div');
      titleRow.style.cssText = 'display: flex; align-items: center; gap: 10px;';

      const title = document.createElement('h3');
      title.textContent = 'Balance History Uploader';
      title.style.cssText = 'margin: 0; font-size: 18px; font-weight: bold;';
      titleRow.appendChild(title);

      const settingsButton = document.createElement('button');
      settingsButton.innerHTML = '⚙️';
      settingsButton.title = 'Settings';
      settingsButton.style.cssText = `
        background: none;
        border: none;
        font-size: 16px;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: 4px;
        color: #666;
        transition: background-color 0.2s;
      `;
      settingsButton.addEventListener('click', showSettingsModal);
      settingsButton.addEventListener('mouseover', () => {
        settingsButton.style.backgroundColor = 'var(--mu-hover-bg, #f0f0f0)';
      });
      settingsButton.addEventListener('mouseout', () => {
        settingsButton.style.backgroundColor = 'transparent';
      });
      titleRow.appendChild(settingsButton);

      titleSection.appendChild(titleRow);

      const subtitle = document.createElement('div');
      subtitle.textContent = 'Questrade → Monarch Money';
      subtitle.style.cssText = 'font-size: 14px; color: var(--mu-text-secondary, #666);';
      titleSection.appendChild(subtitle);

      header.appendChild(titleSection);
      container.appendChild(header);

      debugLog('Cleared existing content from container, recreated header with gear button');
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

    // Add testing section (only visible in Development Mode)
    const testingSection = createTestingSection();
    if (testingSection) {
      container.appendChild(testingSection);
    }

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

/**
 * Refreshes the Questrade UI by re-initializing the testing section
 * Call this when Development Mode is toggled to apply changes immediately
 */
export function refreshQuestradeUI() {
  try {
    const container = document.getElementById('balance-uploader-container');
    if (!container) {
      debugLog('Questrade container not found, cannot refresh');
      return false;
    }

    // Find and remove the existing testing section
    const existingTestingSection = container.querySelector('#questrade-testing-section');
    if (existingTestingSection) {
      existingTestingSection.remove();
    }

    // Re-create the testing section (which will now reflect the current Development Mode state)
    const testingSection = createTestingSection();
    if (testingSection) {
      container.appendChild(testingSection);
    }

    debugLog('Questrade UI refreshed');
    return true;
  } catch (error) {
    debugLog('Error refreshing Questrade UI:', error);
    return false;
  }
}

export default {
  initUI,
  createButtonContainer,
  updateStatusIndicators,
  refreshQuestradeUI,
};
