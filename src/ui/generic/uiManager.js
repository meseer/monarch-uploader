/**
 * Generic UI Manager for Modular Integrations
 *
 * Provides a fully parameterized UI manager that works for any integration
 * registered in the integration registry. All institution-specific data is
 * read from the registry entry (manifest, injectionPoint, api, syncHooks).
 *
 * Handles:
 * - SPA navigation monitoring (hash-based and path-based)
 * - DOM injection target detection and container creation
 * - Connection probing via the integration API
 * - Upload flow via the generic syncOrchestrator
 * - Connection status display
 *
 * @module ui/generic/uiManager
 */

import { debugLog } from '../../core/utils';
import { STORAGE } from '../../core/config';
import toast from '../toast';
import { showSettingsModal } from '../components/settingsModal';
import { createConnectionStatus, updateInstitutionStatus, updateMonarchStatus } from './components/connectionStatus';
import { createUploadButton } from './components/uploadButton';
import { createMonarchLoginLink } from '../components/monarchLoginLink';
import { prepareAndSyncAccount } from '../../services/common/syncOrchestrator';

// ──────────────────────────────────────────────────────────────
// Per-integration UI state
// ──────────────────────────────────────────────────────────────

/**
 * Holds per-integration runtime UI state.
 * Keyed by integrationId to support multiple simultaneous integrations
 * (unlikely in practice but architecturally clean).
 * @type {Map<string, Object>}
 */
const uiStateMap = new Map();

/**
 * Get or create UI state for an integration
 * @param {string} integrationId
 * @returns {Object} Mutable state object
 */
function getUIState(integrationId) {
  if (!uiStateMap.has(integrationId)) {
    uiStateMap.set(integrationId, {
      cachedAccounts: [],
      institutionConnected: false,
      navigationManager: null,
    });
  }
  return uiStateMap.get(integrationId);
}

// ──────────────────────────────────────────────────────────────
// SPA Navigation Manager
// ──────────────────────────────────────────────────────────────

/**
 * Generic SPA navigation manager.
 * Handles both hash-based routing (Angular) and path-based routing (React/Vue).
 */
class GenericNavigationManager {
  /**
   * @param {Object} registryEntry - The full registry entry for this integration
   */
  constructor(registryEntry) {
    this.registryEntry = registryEntry;
    this.injectionPoint = registryEntry.injectionPoint;
    this.containerId = this.injectionPoint.containerId;
    this.currentUrl = window.location.href;
    this.currentPageModeId = null;
    this.isInitialized = false;
    this.pollInterval = null;
    this.uiInitialized = false;
    this.logPrefix = `[${registryEntry.manifest.displayName}]`;
  }

  /** Start monitoring navigation changes */
  startMonitoring() {
    if (this.isInitialized) return;

    debugLog(`${this.logPrefix} Starting navigation monitoring...`);

    // Listen for hash changes (Angular SPAs)
    window.addEventListener('hashchange', () => this.handleNavigation());

    // Listen for popstate (React/Vue SPAs)
    window.addEventListener('popstate', () => this.handleNavigation());

    // Poll for URL changes (catches programmatic navigation)
    this.pollInterval = setInterval(() => {
      const newUrl = window.location.href;
      if (newUrl !== this.currentUrl) {
        this.currentUrl = newUrl;
        this.handleNavigation();
      }
    }, 500);

    this.isInitialized = true;
  }

  /** Stop monitoring */
  stopMonitoring() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.isInitialized = false;
    debugLog(`${this.logPrefix} Navigation monitoring stopped`);
  }

  /** Handle a navigation event */
  async handleNavigation() {
    try {
      const url = window.location.hash || window.location.pathname;
      debugLog(`${this.logPrefix} Navigation detected:`, url);

      const shouldShow = this.shouldShowUI();
      const hasUI = this.hasUIContainer();
      const newPageModeId = getActivePageMode(this.injectionPoint)?.id || null;
      const pageModeChanged = newPageModeId !== this.currentPageModeId;
      this.currentPageModeId = newPageModeId;

      if (shouldShow && pageModeChanged && hasUI) {
        debugLog(`${this.logPrefix} Page mode changed, re-injecting UI at new target`);
        this.cleanupUI();
        await this.reinitializeUI();
      } else if (shouldShow && !hasUI) {
        debugLog(`${this.logPrefix} Re-initializing UI after navigation`);
        await this.reinitializeUI();
      } else if (!shouldShow && hasUI) {
        debugLog(`${this.logPrefix} Cleaning up UI after navigation away`);
        this.cleanupUI();
      }
    } catch (error) {
      debugLog(`${this.logPrefix} Error handling navigation:`, error);
    }
  }

  /** Reinitialize UI after SPA navigation */
  async reinitializeUI() {
    try {
      await waitForTargetElementAsync(this.injectionPoint, this.logPrefix);
      const container = createUIContainer(this.registryEntry);
      if (container) {
        await initializeUIComponents(container, this.registryEntry);
        this.uiInitialized = true;
        debugLog(`${this.logPrefix} UI re-initialized after navigation`);
      }
    } catch (error) {
      debugLog(`${this.logPrefix} Error reinitializing UI:`, error);
    }
  }

  /**
   * Determine if UI should be shown based on current URL
   * @returns {boolean}
   */
  shouldShowUI() {
    const url = window.location.hash || window.location.pathname;
    // Check skip patterns first
    if (this.injectionPoint.skipPatterns?.some((p) => p.test(url))) {
      return false;
    }
    // Check if any page mode matches
    return this.injectionPoint.pageModes?.some((mode) => mode.urlPattern.test(url)) ?? false;
  }

  /** @returns {boolean} */
  hasUIContainer() {
    return document.getElementById(this.containerId) !== null;
  }

  /** Remove UI container */
  cleanupUI() {
    const container = document.getElementById(this.containerId);
    if (container) {
      container.remove();
      this.uiInitialized = false;
      debugLog(`${this.logPrefix} UI container cleaned up`);
    }
  }
}

// ──────────────────────────────────────────────────────────────
// Connection Probing
// ──────────────────────────────────────────────────────────────

/**
 * Probe institution API connectivity by fetching accounts summary.
 * Updates the integration's UI state (cachedAccounts, institutionConnected).
 *
 * @param {Object} registryEntry - Registry entry with api, manifest
 * @returns {Promise<boolean>} True if connection is valid
 */
async function probeConnection(registryEntry) {
  const { manifest, api } = registryEntry;
  const state = getUIState(manifest.id);
  const logPrefix = `[${manifest.displayName}]`;

  try {
    const accounts = await api.getAccountsSummary();
    state.cachedAccounts = accounts;
    state.institutionConnected = true;
    debugLog(`${logPrefix} Probe: connected, found`, accounts.length, 'account(s)');
    return true;
  } catch (error) {
    state.institutionConnected = false;
    state.cachedAccounts = [];
    debugLog(`${logPrefix} Probe: API call failed:`, error.message);
    return false;
  }
}

// ──────────────────────────────────────────────────────────────
// Injection Target Detection
// ──────────────────────────────────────────────────────────────

/**
 * Get the active page mode based on current URL
 * @param {Object} injectionPoint - Injection point config
 * @returns {Object|null} The matching page mode or null
 */
function getActivePageMode(injectionPoint) {
  const url = window.location.hash || window.location.pathname;
  return injectionPoint.pageModes?.find((mode) => mode.urlPattern.test(url)) || null;
}

/**
 * Check if an element is visible in the DOM
 * @param {HTMLElement} el
 * @returns {boolean}
 */
function isElementVisible(el) {
  return el.offsetParent !== null || el.offsetWidth > 0 || el.offsetHeight > 0;
}

/**
 * Find the injection target element using per-page-mode selectors.
 * Falls back to global selectors if no page mode matches.
 * @param {Object} injectionPoint - Injection point config
 * @returns {HTMLElement|null}
 */
function findInjectionTarget(injectionPoint) {
  const pageMode = getActivePageMode(injectionPoint);
  const selectors = pageMode?.selectors?.length ? pageMode.selectors : injectionPoint.selectors;

  for (const { selector } of selectors) {
    const elements = document.querySelectorAll(selector);
    if (elements.length === 0) continue;

    // Prefer the first visible element
    for (const el of elements) {
      if (isElementVisible(el)) return el;
    }

    // Fallback: return first match even if visibility check fails
    return elements[0];
  }
  return null;
}

// ──────────────────────────────────────────────────────────────
// UI Container
// ──────────────────────────────────────────────────────────────

/**
 * Creates and appends the main UI container after the injection target
 * @param {Object} registryEntry - Registry entry with manifest, injectionPoint
 * @returns {HTMLElement|null} Created container or null
 */
function createUIContainer(registryEntry) {
  const { manifest, injectionPoint } = registryEntry;
  const containerId = injectionPoint.containerId;
  const logPrefix = `[${manifest.displayName}]`;

  const target = findInjectionTarget(injectionPoint);
  if (!target) {
    debugLog(`${logPrefix} Could not find injection target element`);
    return null;
  }

  // Don't create twice
  let container = document.getElementById(containerId);
  if (container) return container;

  container = document.createElement('div');
  container.id = containerId;
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
    max-width: 480px;
    width: 100%;
    box-sizing: border-box;
    overflow: hidden;
  `;

  // ── Header ──
  const header = document.createElement('div');
  header.id = `${manifest.id}-ui-header`;
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
    color: ${manifest.brandColor};
    font-size: 16px;
  `;
  titleRow.appendChild(title);

  const settingsButton = document.createElement('button');
  settingsButton.id = `${manifest.id}-settings-button`;
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
  subtitle.textContent = `${manifest.displayName} → Monarch Money`;
  subtitle.style.cssText = 'font-size: 12px; color: #666; font-weight: 500;';
  titleSection.appendChild(subtitle);

  header.appendChild(titleSection);
  container.appendChild(header);

  // Insert after the target element
  target.parentNode.insertBefore(container, target.nextSibling);

  const pageMode = getActivePageMode(injectionPoint);
  debugLog(`${logPrefix} UI container created and inserted after target on page mode:`, pageMode?.id || 'unknown');
  return container;
}

// ──────────────────────────────────────────────────────────────
// Upload Flow
// ──────────────────────────────────────────────────────────────

/**
 * Handle the upload button click.
 * Iterates through all accounts, delegates to syncOrchestrator.
 *
 * @param {HTMLButtonElement} button - The upload button (for disabling during operation)
 * @param {Object} registryEntry - Registry entry
 */
async function handleUploadClick(button, registryEntry) {
  const { manifest, api, syncHooks } = registryEntry;
  const state = getUIState(manifest.id);
  const logPrefix = `[${manifest.displayName}]`;

  try {
    button.disabled = true;

    // If we don't have cached accounts, re-probe
    if (state.cachedAccounts.length === 0) {
      button.textContent = 'Fetching accounts...';
      const connected = await probeConnection(registryEntry);
      if (!connected || state.cachedAccounts.length === 0) {
        throw new Error(`Could not retrieve ${manifest.displayName} accounts. Please refresh the page.`);
      }
    }

    debugLog(`${logPrefix} Processing`, state.cachedAccounts.length, 'account(s)');

    for (const account of state.cachedAccounts) {
      if (!account.accountId) {
        debugLog(`${logPrefix} Skipping account with no accountId:`, account);
        continue;
      }

      button.textContent = `Processing ${account.displayName || account.endingIn || 'account'}...`;

      const accountDisplayName = account.displayName || `${manifest.displayName} Card (${account.endingIn})`;
      const result = await prepareAndSyncAccount({
        integrationId: manifest.id,
        manifest,
        hooks: syncHooks,
        api,
        account,
        accountDisplayName,
      });
      debugLog(`${logPrefix} Upload result for`, account.displayName, ':', result);

      if (!result.success && result.message === 'Cancelled') {
        debugLog(`${logPrefix} Upload cancelled for`, account.displayName);
        break;
      }
    }
  } catch (error) {
    debugLog(`${logPrefix} Upload error:`, error);
    toast.show(error.message || 'Failed to start upload', 'error');
  } finally {
    button.textContent = 'Upload to Monarch';
    button.disabled = false;
  }
}

// ──────────────────────────────────────────────────────────────
// UI Components Initialization
// ──────────────────────────────────────────────────────────────

/**
 * Initialize UI components inside the container.
 * @param {HTMLElement} container
 * @param {Object} registryEntry - Registry entry
 */
async function initializeUIComponents(container, registryEntry) {
  const { manifest } = registryEntry;
  const state = getUIState(manifest.id);
  const logPrefix = `[${manifest.displayName}]`;

  try {
    // Clear existing dynamic content (keep header)
    const children = Array.from(container.children).slice(1);
    children.forEach((child) => child.remove());

    // Connection status (show "Checking..." initially)
    const connectionStatus = createConnectionStatus(manifest.displayName);
    container.appendChild(connectionStatus);

    // Run connection probe
    await probeConnection(registryEntry);

    // Upload button
    const uploadButton = createUploadButton({
      isAuthenticated: state.institutionConnected,
      institutionName: manifest.displayName,
      onUploadClick: (btn) => handleUploadClick(btn, registryEntry),
    });
    container.appendChild(uploadButton);

    // Update connection status indicators with probe results
    updateConnectionStatusDisplay(connectionStatus, registryEntry);

    debugLog(`${logPrefix} UI components initialized, connected:`, state.institutionConnected,
      'accounts:', state.cachedAccounts.length);
    toast.show(`${manifest.displayName} Balance Uploader initialized`, 'debug', 2000);
  } catch (error) {
    debugLog(`${logPrefix} Error initializing UI components:`, error);
    toast.show(`Failed to initialize ${manifest.displayName} Balance Uploader`, 'error');
  }
}

// ──────────────────────────────────────────────────────────────
// Status Updates
// ──────────────────────────────────────────────────────────────

/**
 * Refresh all connection status indicators
 * @param {HTMLElement} connectionStatus
 * @param {Object} registryEntry - Registry entry
 */
function updateConnectionStatusDisplay(connectionStatus, registryEntry) {
  if (!connectionStatus) return;

  const { manifest } = registryEntry;
  const state = getUIState(manifest.id);

  try {
    const monarchToken = GM_getValue(STORAGE.MONARCH_TOKEN);

    // Update institution indicator
    updateInstitutionStatus(connectionStatus, manifest.displayName, state.institutionConnected);

    // Update Monarch indicator with login link
    updateMonarchStatus(connectionStatus, Boolean(monarchToken), () => {
      const loginLink = createMonarchLoginLink('Login to Monarch', () => {
        updateConnectionStatusDisplay(connectionStatus, registryEntry);
      });
      if (loginLink && loginLink.href) {
        window.open(loginLink.href, '_blank');
      }
    });

    // Refresh upload button with current connection state
    const existingUpload = document.getElementById('generic-upload-button-container');
    if (existingUpload) {
      const newUploadButton = createUploadButton({
        isAuthenticated: state.institutionConnected,
        institutionName: manifest.displayName,
        onUploadClick: (btn) => handleUploadClick(btn, registryEntry),
      });
      existingUpload.parentNode.replaceChild(newUploadButton, existingUpload);
    }

    debugLog(`[${manifest.displayName}] Connection status updated`);
  } catch (error) {
    debugLog(`[${manifest.displayName}] Error updating connection status:`, error);
  }
}

// ──────────────────────────────────────────────────────────────
// Async Element Waiting
// ──────────────────────────────────────────────────────────────

/**
 * Wait for injection target element using polling
 * @param {Object} injectionPoint - Injection point config
 * @param {string} logPrefix - Log prefix for debug messages
 * @returns {Promise<HTMLElement>}
 */
function waitForTargetElementAsync(injectionPoint, logPrefix) {
  return new Promise((resolve, reject) => {
    const existing = findInjectionTarget(injectionPoint);
    if (existing) {
      resolve(existing);
      return;
    }

    let attempts = 0;
    const maxAttempts = 60; // 30 seconds at 500ms

    const checkInterval = setInterval(() => {
      attempts++;
      const element = findInjectionTarget(injectionPoint);

      if (element) {
        clearInterval(checkInterval);
        resolve(element);
      } else if (attempts >= maxAttempts) {
        clearInterval(checkInterval);
        reject(new Error(`${logPrefix} Injection target not found after 30s`));
      }
    }, 500);
  });
}

/**
 * Wait for target element using MutationObserver (for initial load)
 * @param {Object} registryEntry - Registry entry
 */
function waitForTargetElement(registryEntry) {
  const { manifest, injectionPoint } = registryEntry;
  const state = getUIState(manifest.id);
  const logPrefix = `[${manifest.displayName}]`;

  let observer = null;
  let timeoutId = null;
  let initialized = false;

  observer = new MutationObserver((_mutations, obs) => {
    const target = findInjectionTarget(injectionPoint);
    if (target && !initialized) {
      initialized = true;
      obs.disconnect();
      if (timeoutId) clearTimeout(timeoutId);

      const container = createUIContainer(registryEntry);
      if (container) {
        initializeUIComponents(container, registryEntry);
        if (state.navigationManager) {
          state.navigationManager.uiInitialized = true;
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  timeoutId = setTimeout(() => {
    if (!initialized) {
      debugLog(`${logPrefix} Timeout waiting for injection target (30s)`);
      if (observer) observer.disconnect();
      toast.show(`${manifest.displayName} UI element not found`, 'warning');
    }
  }, 30000);

  debugLog(`${logPrefix} MutationObserver started, waiting for injection target...`);
}

// ──────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────

/**
 * Initialize the generic UI for a modular integration.
 *
 * This is the single entry point called by initializeModularIntegrationApp()
 * in src/index.js. It reads everything it needs from the registry entry.
 *
 * @param {Object} registryEntry - Full registry entry (manifest, api, auth, injectionPoint, syncHooks, etc.)
 */
export async function initGenericUI(registryEntry) {
  const { manifest } = registryEntry;
  const state = getUIState(manifest.id);
  const logPrefix = `[${manifest.displayName}]`;

  try {
    debugLog(`${logPrefix} Initializing generic UI...`);

    // Create and start navigation manager if not already running
    if (!state.navigationManager) {
      state.navigationManager = new GenericNavigationManager(registryEntry);
    }
    if (!state.navigationManager.isInitialized) {
      state.navigationManager.startMonitoring();
    }

    // Try to create container immediately
    const container = createUIContainer(registryEntry);
    if (container) {
      await initializeUIComponents(container, registryEntry);
      state.navigationManager.uiInitialized = true;
    } else {
      debugLog(`${logPrefix} Injection target not found yet, setting up MutationObserver...`);
      waitForTargetElement(registryEntry);
    }
  } catch (error) {
    debugLog(`${logPrefix} Error initializing UI:`, error);
    toast.show(`Failed to initialize ${manifest.displayName} Balance Uploader`, 'error');
  }
}

/**
 * Refresh the UI when auth state changes.
 *
 * @param {Object} registryEntry - Full registry entry
 */
export async function refreshGenericUI(registryEntry) {
  const { injectionPoint } = registryEntry;

  await probeConnection(registryEntry);

  const connectionStatus = document.querySelector(`#${injectionPoint.containerId} .connection-status-container`);
  if (connectionStatus) {
    updateConnectionStatusDisplay(connectionStatus, registryEntry);
  }
}

export default {
  initGenericUI,
  refreshGenericUI,
};