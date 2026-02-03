/**
 * CanadaLife UI Manager
 * Responsible for initializing and managing UI components on CanadaLife website
 */

import { debugLog } from '../../core/utils';
import { STORAGE, COLORS } from '../../core/config';
import stateManager from '../../core/state';
import canadalife from '../../api/canadalife';
import toast from '../toast';
import { createConnectionStatus } from './components/connectionStatus';
import { createCanadaLifeUploadButton } from './components/uploadButton';
import { showSettingsModal } from '../components/settingsModal';
import { createMonarchLoginLink } from '../components/monarchLoginLink';

/**
 * Creates and appends the main UI container to CanadaLife navigation
 * @returns {HTMLElement|null} Created container element
 */
function createUIContainer() {
  // Find the .ims-navigation insertion point
  const targetContainer = document.querySelector('.ims-navigation');
  if (!targetContainer) {
    debugLog('Could not find .ims-navigation insertion point');
    return null;
  }

  // Check if container already exists
  let container = document.getElementById('canadalife-balance-uploader-container');
  if (container) {
    return container;
  }

  // Create main container
  container = document.createElement('div');
  container.id = 'canadalife-balance-uploader-container';
  container.style.cssText = `
    position: relative;
    margin: 10px 0;
    padding: 12px;
    background-color: #f8f9fa;
    border: 1px solid #e0e0e0;
    border-radius: 6px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 14px;
  `;

  // Create header
  const header = document.createElement('div');
  header.style.cssText = `
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  `;

  const titleSection = document.createElement('div');
  titleSection.style.cssText = 'display: flex; flex-direction: column;';

  const titleRow = document.createElement('div');
  titleRow.style.cssText = 'display: flex; align-items: center; gap: 10px;';

  const title = document.createElement('div');
  title.textContent = 'Balance Uploader';
  title.style.cssText = `
    font-weight: 600;
    color: ${COLORS.CANADALIFE_BRAND};
    font-size: 16px;
  `;
  titleRow.appendChild(title);

  const settingsButton = document.createElement('button');
  settingsButton.innerHTML = '⚙️';
  settingsButton.title = 'Settings';
  settingsButton.style.cssText = `
    background: none;
    border: none;
    font-size: 14px;
    cursor: pointer;
    padding: 4px 6px;
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
  subtitle.textContent = 'CanadaLife → Monarch Money';
  subtitle.style.cssText = 'font-size: 12px; color: #666; font-weight: 500;';
  titleSection.appendChild(subtitle);

  header.appendChild(titleSection);

  container.appendChild(header);

  // Append to navigation
  targetContainer.appendChild(container);

  debugLog('CanadaLife UI container created and appended to .ims-navigation');
  return container;
}

/**
 * Wait for target element to appear using MutationObserver
 */
function waitForTargetElement() {
  let observer = null;
  let timeoutId = null;
  let isInitialized = false;

  // Create observer
  observer = new MutationObserver((mutations, obs) => {
    // Check if target element now exists
    const targetContainer = document.querySelector('.ims-navigation');

    if (targetContainer && !isInitialized) {
      debugLog('Target element found, initializing UI...');
      isInitialized = true;

      // Stop observing
      obs.disconnect();

      // Clear timeout
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      // Create container and initialize UI
      const container = createUIContainer();
      if (container) {
        initializeUIComponents(container);
      }
    }
  });

  // Start observing
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Set timeout to stop observing after 30 seconds
  timeoutId = setTimeout(() => {
    if (!isInitialized) {
      debugLog('Timeout waiting for CanadaLife UI element (30s)');
      if (observer) {
        observer.disconnect();
      }
      toast.show('CanadaLife UI element not found', 'warning');
    }
  }, 30000); // 30 seconds timeout

  debugLog('MutationObserver started, waiting for target element...');
}

/**
 * Initialize UI components once container is available
 * @param {HTMLElement} container - The UI container element
 */
function initializeUIComponents(container) {
  try {
    // Clear existing dynamic content (keep header)
    const existingContent = Array.from(container.children).slice(1);
    existingContent.forEach((child) => child.remove());

    // Create connection status component
    const connectionStatus = createConnectionStatus();
    container.appendChild(connectionStatus);

    // Create upload button
    const uploadButton = createCanadaLifeUploadButton();
    container.appendChild(uploadButton);

    // Set up status monitoring
    setupStatusMonitoring(connectionStatus);

    // Update status immediately
    updateConnectionStatus(connectionStatus);

    debugLog('CanadaLife UI initialized successfully');

    // Show initialization toast
    toast.show('CanadaLife Balance Uploader initialized', 'debug', 2000);
  } catch (error) {
    debugLog('Error initializing UI components:', error);
    toast.show('Failed to initialize Balance Uploader', 'error');
  }
}

/**
 * Initialize UI for CanadaLife website
 */
export async function initCanadaLifeUI() {
  try {
    debugLog('Initializing CanadaLife UI...');

    // Try to create container immediately
    const container = createUIContainer();
    if (container) {
      // Element exists, initialize UI immediately
      initializeUIComponents(container);
    } else {
      // Element doesn't exist yet, set up observer to wait for it
      debugLog('Target element not found, setting up MutationObserver...');
      waitForTargetElement();
    }
  } catch (error) {
    debugLog('Error initializing CanadaLife UI:', error);
    toast.show('Failed to initialize Balance Uploader', 'error');
  }
}

/**
 * Set up status monitoring for connection indicators
 * @param {HTMLElement} connectionStatus - Connection status container
 */
function setupStatusMonitoring(connectionStatus) {
  // Set up periodic status checks
  const statusInterval = setInterval(() => {
    updateConnectionStatus(connectionStatus);
  }, 10000); // Check every 10 seconds

  // Store interval ID for cleanup if needed
  connectionStatus.statusInterval = statusInterval;

  // Listen for state changes
  stateManager.addListener('auth', () => {
    updateConnectionStatus(connectionStatus);
  });
}

/**
 * Update connection status indicators
 * @param {HTMLElement} connectionStatus - Connection status container
 */
function updateConnectionStatus(connectionStatus) {
  if (!connectionStatus) return;

  try {
    // Get current auth status
    const canadalifeAuth = canadalife.checkAuth();
    const monarchToken = GM_getValue(STORAGE.MONARCH_TOKEN);

    // Update CanadaLife status
    const canadalifeIndicator = connectionStatus.querySelector('.canadalife-status');
    if (canadalifeIndicator) {
      if (canadalifeAuth.authenticated) {
        canadalifeIndicator.textContent = 'CanadaLife: Connected';
        canadalifeIndicator.style.color = '#28a745';
      } else {
        canadalifeIndicator.textContent = 'CanadaLife: Not connected';
        canadalifeIndicator.style.color = '#dc3545';
      }
    }

    // Update Monarch status
    const monarchIndicator = connectionStatus.querySelector('.monarch-status');
    if (monarchIndicator) {
      // Clear existing content
      monarchIndicator.innerHTML = '';

      if (monarchToken) {
        monarchIndicator.textContent = 'Monarch: Connected';
        monarchIndicator.style.color = '#28a745';
      } else {
        // Create clickable login link
        const loginLink = createMonarchLoginLink('Monarch: Not connected', () => {
          // Callback to update status after successful login
          updateConnectionStatus(connectionStatus);
        });
        monarchIndicator.appendChild(loginLink);
      }
    }

    debugLog('Connection status updated');
  } catch (error) {
    debugLog('Error updating connection status:', error);
  }
}

/**
 * Refreshes the Canada Life UI by re-initializing the upload button component
 * Call this when Development Mode is toggled to apply changes immediately
 */
export function refreshCanadaLifeUI() {
  try {
    const container = document.getElementById('canadalife-balance-uploader-container');
    if (!container) {
      debugLog('Canada Life container not found, cannot refresh');
      return false;
    }

    // Find and remove the existing upload button container
    const existingUploadButton = container.querySelector('.canadalife-upload-button-container');
    if (existingUploadButton) {
      existingUploadButton.remove();
    }

    // Re-create the upload button (which will now reflect the current Development Mode state)
    const uploadButton = createCanadaLifeUploadButton();
    container.appendChild(uploadButton);

    debugLog('Canada Life UI refreshed');
    return true;
  } catch (error) {
    debugLog('Error refreshing Canada Life UI:', error);
    return false;
  }
}

export default {
  initCanadaLifeUI,
  createUIContainer,
  updateConnectionStatus,
  refreshCanadaLifeUI,
};
