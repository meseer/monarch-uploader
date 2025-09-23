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
import { showSettingsModal } from '../components/settingsModal';
import { createMonarchLoginLink } from '../components/monarchLoginLink';

/**
 * Navigation manager for Rogers Bank SPA navigation
 */
class RogersBankNavigationManager {
  constructor() {
    this.currentUrl = window.location.href;
    this.isInitialized = false;
    this.urlCheckInterval = null;
    this.uiInitialized = false;
  }

  /**
   * Start monitoring URL changes for SPA navigation
   */
  startMonitoring() {
    if (this.isInitialized) return;

    debugLog('Starting Rogers Bank navigation monitoring...');

    // Listen for popstate events (back/forward navigation)
    window.addEventListener('popstate', () => {
      this.handleUrlChange();
    });

    // Poll for URL changes (for programmatic navigation)
    this.urlCheckInterval = setInterval(() => {
      this.checkUrlChange();
    }, 500); // Check every 500ms

    this.isInitialized = true;
    debugLog('Rogers Bank navigation monitoring started');
  }

  /**
   * Stop monitoring URL changes
   */
  stopMonitoring() {
    if (this.urlCheckInterval) {
      clearInterval(this.urlCheckInterval);
      this.urlCheckInterval = null;
    }
    this.isInitialized = false;
    debugLog('Rogers Bank navigation monitoring stopped');
  }

  /**
   * Check if URL has changed and handle it
   */
  checkUrlChange() {
    const newUrl = window.location.href;
    if (newUrl !== this.currentUrl) {
      this.currentUrl = newUrl;
      this.handleUrlChange();
    }
  }

  /**
   * Handle URL change event
   */
  async handleUrlChange() {
    try {
      debugLog('Rogers Bank URL changed to:', window.location.href);

      const shouldShowUI = this.shouldShowUI();
      const hasUI = this.hasUIContainer();

      if (shouldShowUI && !hasUI) {
        // UI should be shown but isn't present - initialize it directly
        debugLog('Re-initializing Rogers Bank UI after navigation');
        await this.initializeUIDirectly();
      } else if (!shouldShowUI && hasUI) {
        // UI shouldn't be shown but is present - clean it up
        debugLog('Cleaning up Rogers Bank UI after navigation away');
        this.cleanupUI();
      }
    } catch (error) {
      debugLog('Error handling Rogers Bank URL change:', error);
    }
  }

  /**
   * Initialize UI directly without recursion
   */
  async initializeUIDirectly() {
    try {
      // Wait for DOM to be ready with target element
      await this.waitForTargetElementAsync();

      // Try to create container
      const container = createUIContainer();
      if (container) {
        // Element exists, initialize UI immediately
        initializeUIComponents(container);
        this.markUIInitialized();
        debugLog('Rogers Bank UI re-initialized successfully after navigation');
      }
    } catch (error) {
      debugLog('Error in direct UI initialization:', error);
    }
  }

  /**
   * Wait for target element with async/await pattern
   */
  async waitForTargetElementAsync() {
    return new Promise((resolve, reject) => {
      // Check if element already exists
      const targetSection = document.querySelector('section[aria-labelledby="master-card-section"]');
      if (targetSection) {
        resolve(targetSection);
        return;
      }

      // Set up observer to wait for element
      let attempts = 0;
      const maxAttempts = 60; // 30 seconds with 500ms intervals

      const checkInterval = setInterval(() => {
        attempts++;
        const element = document.querySelector('section[aria-labelledby="master-card-section"]');

        if (element) {
          clearInterval(checkInterval);
          resolve(element);
        } else if (attempts >= maxAttempts) {
          clearInterval(checkInterval);
          reject(new Error('Target element not found after waiting'));
        }
      }, 500);
    });
  }

  /**
   * Determine if UI should be shown on current page
   * @returns {boolean} True if UI should be shown
   */
  shouldShowUI() {
    // Check if we're on the main account page where the master-card-section exists
    const path = window.location.pathname;

    // Show UI on main dashboard/home pages where the target element exists
    return path === '/'
           || path === '/home'
           || path === '/dashboard'
           || path.match(/^\/accounts?\/?$/)
           || path.includes('master-card');
  }

  /**
   * Check if UI container currently exists
   * @returns {boolean} True if UI container exists
   */
  hasUIContainer() {
    return document.getElementById('rogersbank-balance-uploader-container') !== null;
  }

  /**
   * Clean up UI when navigating away
   */
  cleanupUI() {
    const container = document.getElementById('rogersbank-balance-uploader-container');
    if (container) {
      container.remove();
      this.uiInitialized = false;
      debugLog('Rogers Bank UI container cleaned up');
    }
  }

  /**
   * Mark UI as initialized
   */
  markUIInitialized() {
    this.uiInitialized = true;
  }

  /**
   * Check if UI is initialized
   */
  isUIInitialized() {
    return this.uiInitialized;
  }
}

// Create singleton instance
const navigationManager = new RogersBankNavigationManager();

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
    max-width: 380px;
    width: 100%;
    box-sizing: border-box;
    overflow: hidden;
  `;

  // Add responsive behavior using media queries to match the card above
  const style = document.createElement('style');
  style.textContent = `
    @media (max-width: 1279px) {
      #rogersbank-balance-uploader-container {
        max-width: 100% !important;
      }
    }
    @media (min-width: 1280px) {
      #rogersbank-balance-uploader-container {
        max-width: 380px !important;
      }
    }
  `;

  if (!document.head.querySelector('style[data-rogers-ui-responsive]')) {
    style.setAttribute('data-rogers-ui-responsive', 'true');
    document.head.appendChild(style);
  }

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
    color: ${COLORS.ROGERSBANK_BRAND};
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
  subtitle.textContent = 'Rogers Bank → Monarch Money';
  subtitle.style.cssText = 'font-size: 12px; color: #666; font-weight: 500;';
  titleSection.appendChild(subtitle);

  header.appendChild(titleSection);

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

    // Start navigation monitoring if not already started
    if (!navigationManager.isInitialized) {
      navigationManager.startMonitoring();
    }

    // Try to create container immediately
    const container = createUIContainer();
    if (container) {
      // Element exists, initialize UI immediately
      initializeUIComponents(container);
      navigationManager.markUIInitialized();
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
 * Start navigation monitoring for Rogers Bank
 */
export function startNavigationMonitoring() {
  navigationManager.startMonitoring();
}

/**
 * Stop navigation monitoring for Rogers Bank
 */
export function stopNavigationMonitoring() {
  navigationManager.stopMonitoring();
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
        navigationManager.markUIInitialized();
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
  // Listen for state changes (reactive updates only)
  stateManager.addListener('auth', () => {
    updateConnectionStatus(connectionStatus);
  });

  // Listen for Rogers Bank credential changes (event-driven)
  stateManager.addListener('rogersbankAuth', () => {
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
  startNavigationMonitoring,
  stopNavigationMonitoring,
};
