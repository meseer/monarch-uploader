/**
 * Wealthsimple UI Manager
 * Responsible for initializing and managing UI components on Wealthsimple website
 */

import { debugLog } from '../../core/utils';
import { STORAGE, COLORS, WEALTHSIMPLE_UI } from '../../core/config';
import stateManager from '../../core/state';
import wealthsimpleApi from '../../api/wealthsimple';
import toast from '../toast';
import { createConnectionStatus } from './components/connectionStatus';
import { createWealthsimpleUploadButton } from './components/uploadButton';
import { showSettingsModal } from '../components/settingsModal';
import { createMonarchLoginLink } from '../components/monarchLoginLink';

/**
 * Find the first available injection point from the prioritized list
 * @returns {{element: HTMLElement, insertMethod: string, selector: string}|null} Injection point info or null
 */
function findInjectionPoint() {
  for (const injectionPoint of WEALTHSIMPLE_UI.INJECTION_POINTS) {
    const element = document.querySelector(injectionPoint.selector);
    if (element) {
      debugLog(`Found injection point: ${injectionPoint.selector} (method: ${injectionPoint.insertMethod})`);
      return {
        element,
        insertMethod: injectionPoint.insertMethod,
        selector: injectionPoint.selector,
      };
    }
  }
  return null;
}

/**
 * Get the actual target container for UI insertion based on insert method
 * @param {HTMLElement} element - The element found by selector
 * @param {string} insertMethod - The insertion method ('prepend', 'prependToSecondChild', or 'insertBefore')
 * @returns {{container: HTMLElement, referenceNode: HTMLElement|null}|null} Target info or null
 */
function getTargetContainer(element, insertMethod) {
  if (insertMethod === 'prepend') {
    return { container: element, referenceNode: null };
  }
  if (insertMethod === 'prependToSecondChild') {
    // Get children (excluding text nodes)
    const children = Array.from(element.children);
    if (children.length >= 2) {
      return { container: children[1], referenceNode: null }; // Second child (0-indexed)
    }
    debugLog(`prependToSecondChild: element has only ${children.length} children, need at least 2`);
    return null;
  }
  if (insertMethod === 'insertBefore') {
    // Insert as previous sibling of the element
    if (!element.parentNode) {
      debugLog('insertBefore: element has no parent node');
      return null;
    }
    return { container: element.parentNode, referenceNode: element };
  }
  debugLog(`Unknown insert method: ${insertMethod}`);
  return null;
}

/**
 * Get all possible injection point selectors as a comma-separated string for querySelector
 * @returns {string} Combined selector string
 */
function getAllInjectionSelectors() {
  return WEALTHSIMPLE_UI.INJECTION_POINTS.map((ip) => ip.selector).join(', ');
}

/**
 * Creates and appends the main UI container to Wealthsimple page
 * @returns {HTMLElement|null} Created container element
 */
async function createUIContainer() {
  // Find target container using prioritized injection points
  const injectionPoint = findInjectionPoint();

  if (!injectionPoint) {
    const selectors = getAllInjectionSelectors();
    debugLog(`No injection point found yet (tried: ${selectors}), will retry via observer`);
    return null;
  }

  const targetInfo = getTargetContainer(injectionPoint.element, injectionPoint.insertMethod);
  if (!targetInfo) {
    debugLog(`Could not resolve target container for ${injectionPoint.selector}, will retry via observer`);
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

  // Insert into the DOM based on method
  // For prepend/prependToSecondChild: insert as first child
  // For insertBefore: insert before the reference node
  const referenceNode = targetInfo.referenceNode ?? targetInfo.container.firstChild;
  targetInfo.container.insertBefore(container, referenceNode);

  debugLog(
    `Wealthsimple UI container created using injection point: ${injectionPoint.selector} (method: ${injectionPoint.insertMethod})`,
  );
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
    // Check if our UI already exists in the DOM - if so, skip initialization
    // We use document.contains() instead of checking specific parent references
    // because multiple injection point elements may exist and querySelector order may vary
    const existingContainer = document.getElementById('wealthsimple-balance-uploader-container');
    if (existingContainer && document.contains(existingContainer)) {
      // UI already exists in DOM, no need to re-initialize
      debugLog('UI already present in DOM, skipping initialization');
      isUIInitialized = true;
      return;
    }

    // Check if any injection point exists
    const injectionPoint = findInjectionPoint();
    if (!injectionPoint) {
      const selectors = getAllInjectionSelectors();
      debugLog(`No injection point found yet (tried: ${selectors}), waiting for observer`);
      isUIInitialized = false;
      return;
    }

    const targetInfo = getTargetContainer(injectionPoint.element, injectionPoint.insertMethod);
    if (!targetInfo) {
      debugLog(`Could not resolve target container for ${injectionPoint.selector}, waiting for observer`);
      isUIInitialized = false;
      return;
    }

    debugLog(`Injection point found: ${injectionPoint.selector}!`);

    // UI doesn't exist or was removed, create it
    debugLog('Creating/recreating Wealthsimple UI...');
    isUIInitialized = false;

    const container = await createUIContainer();
    if (container) {
      initializeUIComponents(container);
      isUIInitialized = true;
      debugLog('Wealthsimple UI successfully initialized!');

      // Set up observer on target container to watch for our UI removal
      observeTargetContainer(container.parentNode);
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
    // Check if our UI was removed from the DOM entirely
    // We use document.contains() instead of checking specific parent references
    // because multiple injection point elements may exist
    const ourUI = document.getElementById('wealthsimple-balance-uploader-container');

    if (!ourUI || !document.contains(ourUI)) {
      debugLog('Our UI was removed from DOM, scheduling reinjection...');
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

  const selectors = getAllInjectionSelectors();
  debugLog(`Starting persistent UI monitoring for injection points: ${selectors}...`);

  // Create observer that watches for target container and our UI
  bodyObserver = new MutationObserver(() => {
    const ourUI = document.getElementById('wealthsimple-balance-uploader-container');

    // If our UI exists in the DOM, no need to do anything
    // We use document.contains() instead of checking specific parent references
    // because multiple injection point elements may exist and querySelector order may vary
    if (ourUI && document.contains(ourUI)) {
      return;
    }

    // UI doesn't exist or was removed - check if we can reinject
    const injectionPoint = findInjectionPoint();
    if (injectionPoint) {
      const targetInfo = getTargetContainer(injectionPoint.element, injectionPoint.insertMethod);

      if (targetInfo) {
        debugLog(`Observer detected ${injectionPoint.selector} without UI, scheduling injection...`);
        isUIInitialized = false;
        scheduleUIReinjection();
      }
    } else if (isUIInitialized) {
      // No injection points found (navigation), reset flag
      debugLog('Observer detected all injection points removed, marking for re-initialization');
      isUIInitialized = false;

      // Disconnect target container observer
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
 * Update the upload button based on current auth status
 * Re-creates the button to reflect the new auth state
 * @param {HTMLElement} container - The main UI container
 */
function updateUploadButton(container) {
  if (!container) return;

  try {
    // Find and remove existing upload button container
    const existingButtonContainer = container.querySelector('#wealthsimple-upload-button-container');
    if (existingButtonContainer) {
      existingButtonContainer.remove();
    }

    // Create new upload button with current auth status
    const newUploadButton = createWealthsimpleUploadButton();
    container.appendChild(newUploadButton);

    debugLog('Upload button updated based on auth status change');
  } catch (error) {
    debugLog('Error updating upload button:', error);
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

  // Listen for state changes - update both connection status and upload button
  stateManager.addListener('auth', () => {
    updateConnectionStatus(connectionStatus);

    // Also update upload button when Wealthsimple auth changes
    const container = document.getElementById('wealthsimple-balance-uploader-container');
    if (container) {
      updateUploadButton(container);
    }
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
