/**
 * Rogers Bank UI Manager
 * Responsible for initializing and managing UI components on Rogers Bank website
 */

import { debugLog } from '../../core/utils';
import { STORAGE, COLORS } from '../../core/config';
import stateManager from '../../core/state';
import rogersbank from '../../api/rogersbank';
import toast from '../toast';
import { createConnectionStatus, updateCredentialsDisplay } from './components/connectionStatus';
import { createRogersBankUploadButton } from './components/uploadButton';

/**
 * Creates and appends the main UI container to Rogers Bank page
 * @returns {HTMLElement|null} Created container element
 */
function createUIContainer() {
  // Find the master card section as specified
  const targetSection = document.querySelector('section[aria-labelledby="master-card-section"]');
  if (!targetSection) {
    debugLog('Could not find section[aria-labelledby="master-card-section"] insertion point');
    return null;
  }

  // Check if container already exists
  let container = document.getElementById('rogersbank-balance-uploader-container');
  if (container) {
    return container;
  }

  // Create main container
  container = document.createElement('div');
  container.id = 'rogersbank-balance-uploader-container';
  container.style.cssText = `
    position: relative;
    margin: 20px 0;
    padding: 12px;
    background-color: #f8f9fa;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 14px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  `;

  // Create header
  const header = document.createElement('div');
  header.style.cssText = `
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  `;

  const title = document.createElement('div');
  title.textContent = 'Balance Uploader';
  title.style.cssText = `
    font-weight: 600;
    color: ${COLORS.ROGERSBANK_BRAND};
    font-size: 16px;
  `;
  header.appendChild(title);

  const subtitle = document.createElement('div');
  subtitle.textContent = 'Rogers Bank → Monarch Money';
  subtitle.style.cssText = 'font-size: 12px; color: #666; font-weight: 500;';
  header.appendChild(subtitle);

  container.appendChild(header);

  // Append to the target section as the last element
  targetSection.appendChild(container);

  debugLog('Rogers Bank UI container created and appended to master-card-section');
  return container;
}

/**
 * Initialize UI for Rogers Bank website
 */
export async function initRogersBankUI() {
  try {
    debugLog('Initializing Rogers Bank UI...');

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
    debugLog('Error initializing Rogers Bank UI:', error);
    toast.show('Failed to initialize Balance Uploader', 'error');
  }
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
    const uploadButton = createRogersBankUploadButton();
    container.appendChild(uploadButton);

    // Set up status monitoring
    setupStatusMonitoring(connectionStatus);

    // Update status immediately
    updateConnectionStatus(connectionStatus);

    debugLog('Rogers Bank UI initialized successfully');

    // Show initialization toast
    toast.show('Rogers Bank Balance Uploader initialized', 'info', 2000);
  } catch (error) {
    debugLog('Error initializing UI components:', error);
    toast.show('Failed to initialize Balance Uploader', 'error');
  }
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
    const targetSection = document.querySelector('section[aria-labelledby="master-card-section"]');

    if (targetSection && !isInitialized) {
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
      debugLog('Timeout waiting for Rogers Bank UI element (30s)');
      if (observer) {
        observer.disconnect();
      }
      toast.show('Rogers Bank UI element not found', 'warning');
    }
  }, 30000); // 30 seconds timeout

  debugLog('MutationObserver started, waiting for target element...');
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
    const rogersbankAuth = rogersbank.checkRogersBankAuth();
    const monarchToken = GM_getValue(STORAGE.MONARCH_TOKEN);

    // Update Rogers Bank status
    const rogersbankIndicator = connectionStatus.querySelector('.rogersbank-status');
    if (rogersbankIndicator) {
      if (rogersbankAuth.authenticated) {
        rogersbankIndicator.textContent = 'Rogers Bank: Connected';
        rogersbankIndicator.style.color = '#28a745';
      } else {
        const missingCreds = [];
        const creds = rogersbankAuth.credentials || {};
        if (!creds.authToken) missingCreds.push('token');
        if (!creds.accountId) missingCreds.push('account');
        if (!creds.customerId) missingCreds.push('customer');
        if (!creds.deviceId) missingCreds.push('device');

        rogersbankIndicator.textContent = missingCreds.length > 0
          ? `Rogers Bank: Missing (${missingCreds.join(', ')})`
          : 'Rogers Bank: Not connected';
        rogersbankIndicator.style.color = '#dc3545';
      }
    }

    // Update Monarch status
    const monarchIndicator = connectionStatus.querySelector('.monarch-status');
    if (monarchIndicator) {
      if (monarchToken) {
        monarchIndicator.textContent = 'Monarch: Connected';
        monarchIndicator.style.color = '#28a745';
      } else {
        monarchIndicator.textContent = 'Monarch: Not connected';
        monarchIndicator.style.color = '#dc3545';
      }
    }

    // Update credentials display
    if (rogersbankAuth.credentials) {
      updateCredentialsDisplay(connectionStatus, rogersbankAuth.credentials);
    }

    // Refresh upload button container based on new status
    const uploadContainer = document.querySelector('.rogersbank-upload-button-container');
    if (uploadContainer) {
      const newUploadButton = createRogersBankUploadButton();
      uploadContainer.parentNode.replaceChild(newUploadButton, uploadContainer);
    }

    debugLog('Connection status updated');
  } catch (error) {
    debugLog('Error updating connection status:', error);
  }
}

/**
 * Refresh the UI when credentials are captured
 */
export function refreshRogersBankUI() {
  const connectionStatus = document.querySelector('#rogersbank-balance-uploader-container .connection-status-container');
  if (connectionStatus) {
    updateConnectionStatus(connectionStatus);
  }
}

export default {
  initRogersBankUI,
  createUIContainer,
  updateConnectionStatus,
  refreshRogersBankUI,
};
