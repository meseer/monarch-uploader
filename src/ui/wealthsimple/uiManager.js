/**
 * Wealthsimple UI Manager
 * Responsible for initializing and managing UI components on Wealthsimple website
 */

import { debugLog } from '../../core/utils';
import { STORAGE, COLORS } from '../../core/config';
import stateManager from '../../core/state';
import wealthsimpleApi from '../../api/wealthsimple';
import toast from '../toast';
import { createConnectionStatus } from './components/connectionStatus';
import { createWealthsimpleUploadButton } from './components/uploadButton';
import { showSettingsModal } from '../components/settingsModal';
import { createMonarchLoginLink } from '../components/monarchLoginLink';

/**
 * Creates and appends the main UI container to Wealthsimple page
 * @returns {HTMLElement|null} Created container element
 */
async function createUIContainer() {
  // Find target container (don't wait, observer will retry)
  const targetContainer = document.querySelector('.bfsRGT');

  if (!targetContainer) {
    debugLog('Target container (.bfsRGT) not found yet, will retry via observer');
    return null;
  }

  // Check if container already exists
  let container = document.getElementById('wealthsimple-balance-uploader-container');
  if (container) {
    debugLog('UI container already exists');
    return container;
  }

  debugLog('Creating UI container...');

  // Create main container
  container = document.createElement('div');
  container.id = 'wealthsimple-balance-uploader-container';
  container.style.cssText = `
    position: relative;
    padding: 16px;
    background-color: #ffffff;
    border: 1px solid #e5e5e5;
    border-radius: 8px;
    font-family: "Wealthsimple Sans", sans-serif;
    font-size: 14px;
    color: ${COLORS.WEALTHSIMPLE_BRAND};
  `;

  // Create header
  const header = document.createElement('div');
  header.id = 'wealthsimple-uploader-header';
  header.style.cssText = `
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  `;

  const titleSection = document.createElement('div');
  titleSection.id = 'wealthsimple-uploader-title-section';
  titleSection.style.cssText = 'display: flex; flex-direction: column;';

  const titleRow = document.createElement('div');
  titleRow.id = 'wealthsimple-uploader-title-row';
  titleRow.style.cssText = 'display: flex; align-items: center; gap: 10px;';

  const title = document.createElement('div');
  title.id = 'wealthsimple-uploader-title';
  title.textContent = 'Balance Uploader';
  title.style.cssText = `
    font-weight: 600;
    color: ${COLORS.WEALTHSIMPLE_BRAND};
    font-size: 16px;
  `;
  titleRow.appendChild(title);

  const settingsButton = document.createElement('button');
  settingsButton.id = 'wealthsimple-settings-button';
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
  subtitle.id = 'wealthsimple-uploader-subtitle';
  subtitle.textContent = 'Wealthsimple → Monarch Money';
  subtitle.style.cssText = 'font-size: 12px; color: #666; font-weight: 500;';
  titleSection.appendChild(subtitle);

  header.appendChild(titleSection);

  container.appendChild(header);

  // Insert as FIRST child of target container
  targetContainer.insertBefore(container, targetContainer.firstChild);

  debugLog('Wealthsimple UI container created and inserted as first child of .bfsRGT');
  return container;
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
    const uploadButton = createWealthsimpleUploadButton();
    container.appendChild(uploadButton);

    // Set up status monitoring
    setupStatusMonitoring(connectionStatus);

    // Update status immediately
    updateConnectionStatus(connectionStatus);

    debugLog('Wealthsimple UI initialized successfully');

    // Show initialization toast
    toast.show('Wealthsimple Balance Uploader initialized', 'trace', 2000);
  } catch (error) {
    debugLog('Error initializing UI components:', error);
    toast.show('Failed to initialize Balance Uploader', 'error');
  }
}

/**
 * Global observers for persistent UI monitoring
 */
let bodyObserver = null;
let targetContainerObserver = null;
let isUIInitialized = false;
let reinjectionTimeout = null;

/**
 * Throttled UI reinjection to prevent observer storms
 */
function scheduleUIReinjection() {
  // Clear any pending reinjection
  if (reinjectionTimeout) {
    clearTimeout(reinjectionTimeout);
  }

  // Schedule reinjection with short delay to batch rapid changes
  reinjectionTimeout = setTimeout(() => {
    checkAndInitializeUI();
    reinjectionTimeout = null;
  }, 200);
}

/**
 * Check and initialize UI if target container exists and UI is not already present
 */
async function checkAndInitializeUI() {
  try {
    // Check if target container exists
    const targetContainer = document.querySelector('.bfsRGT');
    if (!targetContainer) {
      debugLog('Target container (.bfsRGT) not found yet, waiting for observer');
      isUIInitialized = false;
      return;
    }

    debugLog('Target container (.bfsRGT) found!');

    // Check if our UI already exists and is properly positioned
    const existingContainer = document.getElementById('wealthsimple-balance-uploader-container');
    if (existingContainer && existingContainer.parentNode === targetContainer) {
      // UI already exists and is properly attached, no need to re-initialize
      debugLog('UI already present and attached, skipping initialization');
      isUIInitialized = true;
      return;
    }

    // UI doesn't exist or was removed, create it
    debugLog('Creating/recreating Wealthsimple UI...');
    isUIInitialized = false;

    const container = await createUIContainer();
    if (container) {
      initializeUIComponents(container);
      isUIInitialized = true;
      debugLog('Wealthsimple UI successfully initialized!');

      // Set up observer on target container to watch for our UI removal
      observeTargetContainer(targetContainer);
    } else {
      debugLog('Failed to create UI container, observer will retry');
    }
  } catch (error) {
    debugLog('Error in checkAndInitializeUI:', error);
    isUIInitialized = false;
  }
}

/**
 * Observe the target container for removal of our UI
 */
function observeTargetContainer(targetContainer) {
  // Disconnect existing observer if any
  if (targetContainerObserver) {
    targetContainerObserver.disconnect();
  }

  debugLog('Setting up observer on target container...');

  targetContainerObserver = new MutationObserver(() => {
    // Check if our UI was removed
    const ourUI = document.getElementById('wealthsimple-balance-uploader-container');

    if (!ourUI || ourUI.parentNode !== targetContainer) {
      debugLog('Our UI was removed from target container, scheduling reinjection...');
      isUIInitialized = false;
      scheduleUIReinjection();
    }
  });

  // Observe the target container for child modifications
  targetContainerObserver.observe(targetContainer, {
    childList: true,
    subtree: false, // Only watch direct children
  });

  debugLog('Target container observer set up');
}

/**
 * Start persistent monitoring for UI injection
 */
function startPersistentMonitoring() {
  if (bodyObserver) {
    debugLog('Persistent monitoring already active');
    return;
  }

  debugLog('Starting persistent UI monitoring for .bfsRGT...');

  // Create observer that watches for target container and our UI
  bodyObserver = new MutationObserver(() => {
    const targetContainer = document.querySelector('.bfsRGT');
    const ourUI = document.getElementById('wealthsimple-balance-uploader-container');

    // If target exists but our UI doesn't, or our UI is detached
    if (targetContainer && (!ourUI || ourUI.parentNode !== targetContainer)) {
      if (!isUIInitialized) {
        debugLog('Observer detected .bfsRGT without UI, scheduling injection...');
        scheduleUIReinjection();
      }
    } else if (!targetContainer && isUIInitialized) {
      // Target container disappeared (navigation), reset flag
      debugLog('Observer detected .bfsRGT removed, marking for re-initialization');
      isUIInitialized = false;

      // Disconnect observer
      if (targetContainerObserver) {
        targetContainerObserver.disconnect();
        targetContainerObserver = null;
      }
    }
  });

  // Start observing the entire body for changes
  bodyObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });

  debugLog('Persistent UI monitoring started - observer active!');
}

/**
 * Set up URL change monitoring for SPA navigation
 */
function setupUrlChangeMonitoring() {
  debugLog('Setting up URL change monitoring...');

  // Store original history methods
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  // Intercept pushState (used by SPAs for navigation)
  history.pushState = function (...args) {
    originalPushState.apply(this, args);
    debugLog('pushState detected - SPA navigation occurred');
    scheduleUIReinjection();
  };

  // Intercept replaceState (used by SPAs for URL updates)
  history.replaceState = function (...args) {
    originalReplaceState.apply(this, args);
    debugLog('replaceState detected - URL updated');
    scheduleUIReinjection();
  };

  // Listen for back/forward button navigation
  window.addEventListener('popstate', () => {
    debugLog('popstate event - back/forward navigation detected');
    scheduleUIReinjection();
  });

  debugLog('URL change monitoring active');
}

/**
 * Initialize UI for Wealthsimple website
 */
export async function initWealthsimpleUI() {
  try {
    debugLog('Initializing Wealthsimple UI...');

    // Set up token monitoring first
    wealthsimpleApi.setupTokenMonitoring();

    // Set up URL change monitoring for SPA navigation
    setupUrlChangeMonitoring();

    // Start persistent monitoring first - this will handle everything
    startPersistentMonitoring();

    // Try initial UI creation (non-blocking)
    checkAndInitializeUI().catch((err) => {
      debugLog('Initial UI creation deferred:', err);
      // Observer will handle it when ready
    });

    // Also try with delays to catch early page loads
    setTimeout(() => checkAndInitializeUI(), 1000);
    setTimeout(() => checkAndInitializeUI(), 2000);
    setTimeout(() => checkAndInitializeUI(), 5000);
  } catch (error) {
    debugLog('Error initializing Wealthsimple UI:', error);
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
 * Format time remaining until expiration
 * @param {string} expiresAt - ISO timestamp
 * @returns {string} Formatted time remaining
 */
function formatTimeRemaining(expiresAt) {
  if (!expiresAt) return '';

  try {
    const expiryTime = new Date(expiresAt).getTime();
    const currentTime = Date.now();
    const remainingMs = expiryTime - currentTime;

    if (remainingMs <= 0) {
      return 'expired';
    }

    const remainingMinutes = Math.floor(remainingMs / 60000);
    const remainingHours = Math.floor(remainingMinutes / 60);
    const remainingDays = Math.floor(remainingHours / 24);

    if (remainingDays > 0) {
      return `expires in ${remainingDays}d ${remainingHours % 24}h`;
    }
    if (remainingHours > 0) {
      return `expires in ${remainingHours}h ${remainingMinutes % 60}m`;
    }
    return `expires in ${remainingMinutes}m`;
  } catch (error) {
    return '';
  }
}

/**
 * Get color for expiration status
 * @param {string} expiresAt - ISO timestamp
 * @returns {string} Color code
 */
function getExpirationColor(expiresAt) {
  if (!expiresAt) return '#dc3545';

  try {
    const expiryTime = new Date(expiresAt).getTime();
    const currentTime = Date.now();
    const remainingMs = expiryTime - currentTime;
    const remainingMinutes = Math.floor(remainingMs / 60000);

    if (remainingMinutes <= 0) {
      return '#dc3545'; // Red for expired
    }
    if (remainingMinutes < 10) {
      return '#ffc107'; // Yellow for <10 minutes
    }
    return '#28a745'; // Green for >10 minutes
  } catch (error) {
    return '#dc3545';
  }
}

/**
 * Update connection status indicators
 * @param {HTMLElement} connectionStatus - Connection status container
 */
function updateConnectionStatus(connectionStatus) {
  if (!connectionStatus) return;

  try {
    // Get current auth status
    const wealthsimpleAuth = wealthsimpleApi.checkAuth();
    const monarchToken = GM_getValue(STORAGE.MONARCH_TOKEN);

    // Update Wealthsimple status
    const wealthsimpleIndicator = connectionStatus.querySelector('.wealthsimple-status');
    if (wealthsimpleIndicator) {
      if (wealthsimpleAuth.authenticated && wealthsimpleAuth.expiresAt) {
        const timeRemaining = formatTimeRemaining(wealthsimpleAuth.expiresAt);
        const color = getExpirationColor(wealthsimpleAuth.expiresAt);

        wealthsimpleIndicator.textContent = `Wealthsimple: Connected (${timeRemaining})`;
        wealthsimpleIndicator.style.color = color;
      } else if (wealthsimpleAuth.expired) {
        wealthsimpleIndicator.textContent = 'Wealthsimple: Token expired';
        wealthsimpleIndicator.style.color = '#dc3545';
      } else {
        wealthsimpleIndicator.textContent = 'Wealthsimple: Not connected';
        wealthsimpleIndicator.style.color = '#dc3545';
      }
    }

    // Update Monarch status
    const monarchIndicator = connectionStatus.querySelector('.monarch-status');
    if (monarchIndicator) {
      if (monarchToken) {
        monarchIndicator.textContent = 'Monarch: Connected';
        monarchIndicator.style.color = '#28a745';
      } else {
        // Clear and add login link
        monarchIndicator.textContent = '';
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

export default {
  initWealthsimpleUI,
  createUIContainer,
  updateConnectionStatus,
};
