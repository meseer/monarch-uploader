/**
 * MBNA UI Manager
 *
 * Responsible for initializing and managing UI components on the MBNA website.
 * Uses the injection point configuration from the integration manifest.
 *
 * The MBNA site is an Angular SPA at service.mbna.ca with hash-based routing
 * (e.g., index.html#/accountsoverview). The UI is injected after the appropriate
 * target element based on the active page mode.
 *
 * @module ui/mbna/uiManager
 */

import { debugLog } from '../../core/utils';
import { STORAGE } from '../../core/config';
import manifest from '../../integrations/mbna/manifest';
import injectionPoint from '../../integrations/mbna/source/injectionPoint';
import { createAuth } from '../../integrations/mbna/source/auth';
import { createApi } from '../../integrations/mbna/source/api';
import { createGMHttpClient } from '../../core/httpClient';
import toast from '../toast';
import { showSettingsModal } from '../components/settingsModal';
import { createConnectionStatus, updateMbnaStatus, updateMonarchStatus } from './components/connectionStatus';
import { createMbnaUploadButton } from './components/uploadButton';
import { createMonarchLoginLink } from '../components/monarchLoginLink';
import { uploadMbnaAccount } from '../../services/mbna-upload';

const BRAND_COLOR = manifest.brandColor;
const CONTAINER_ID = injectionPoint.containerId;

// ──────────────────────────────────────────────────────────────
// Integration Instances (created once at module load)
// ──────────────────────────────────────────────────────────────

const auth = createAuth();
const httpClient = createGMHttpClient();
const api = createApi(httpClient, auth);

// ──────────────────────────────────────────────────────────────
// Module State — cached accounts from initialization probe
// ──────────────────────────────────────────────────────────────

/** @type {Object[]} Accounts fetched from getAccountsSummary() */
let cachedAccounts = [];

/** @type {boolean} Whether the initialization probe confirmed connectivity */
let mbnaConnected = false;

// ──────────────────────────────────────────────────────────────
// SPA Navigation Manager
// ──────────────────────────────────────────────────────────────

/**
 * Navigation manager for MBNA Angular SPA (hash-based routing)
 */
class MbnaNavigationManager {
  constructor() {
    this.currentHash = window.location.hash;
    this.currentPageModeId = null;
    this.isInitialized = false;
    this.hashCheckInterval = null;
    this.uiInitialized = false;
  }

  /** Start monitoring hash changes */
  startMonitoring() {
    if (this.isInitialized) return;

    debugLog('[MBNA] Starting navigation monitoring...');

    window.addEventListener('hashchange', () => {
      this.handleHashChange();
    });

    // Also poll for hash changes (some Angular SPAs update hash programmatically)
    this.hashCheckInterval = setInterval(() => {
      const newHash = window.location.hash;
      if (newHash !== this.currentHash) {
        this.currentHash = newHash;
        this.handleHashChange();
      }
    }, 500);

    this.isInitialized = true;
  }

  /** Stop monitoring */
  stopMonitoring() {
    if (this.hashCheckInterval) {
      clearInterval(this.hashCheckInterval);
      this.hashCheckInterval = null;
    }
    this.isInitialized = false;
    debugLog('[MBNA] Navigation monitoring stopped');
  }

  /** Handle a hash change event */
  async handleHashChange() {
    try {
      debugLog('[MBNA] Hash changed to:', window.location.hash);

      const shouldShow = this.shouldShowUI();
      const hasUI = this.hasUIContainer();
      const newPageModeId = getActivePageMode()?.id || null;
      const pageModeChanged = newPageModeId !== this.currentPageModeId;
      this.currentPageModeId = newPageModeId;

      if (shouldShow && pageModeChanged && hasUI) {
        // Page mode changed (e.g., dashboard → snapshot): cleanup and re-inject
        debugLog('[MBNA] Page mode changed, re-injecting UI at new target');
        this.cleanupUI();
        await this.reinitializeUI();
      } else if (shouldShow && !hasUI) {
        debugLog('[MBNA] Re-initializing UI after navigation');
        await this.reinitializeUI();
      } else if (!shouldShow && hasUI) {
        debugLog('[MBNA] Cleaning up UI after navigation away');
        this.cleanupUI();
      }
    } catch (error) {
      debugLog('[MBNA] Error handling hash change:', error);
    }
  }

  /** Reinitialize UI after SPA navigation */
  async reinitializeUI() {
    try {
      await waitForTargetElementAsync();
      const container = createUIContainer();
      if (container) {
        initializeUIComponents(container);
        this.uiInitialized = true;
        debugLog('[MBNA] UI re-initialized after navigation');
      }
    } catch (error) {
      debugLog('[MBNA] Error reinitializing UI:', error);
    }
  }

  /**
   * Determine if UI should be shown based on current URL hash
   * @returns {boolean}
   */
  shouldShowUI() {
    const hash = window.location.hash;
    // Check skip patterns first
    if (injectionPoint.skipPatterns.some((p) => p.test(hash))) {
      return false;
    }
    // Check if any page mode matches
    return injectionPoint.pageModes.some((mode) => mode.urlPattern.test(hash));
  }

  /** @returns {boolean} */
  hasUIContainer() {
    return document.getElementById(CONTAINER_ID) !== null;
  }

  /** Remove UI container */
  cleanupUI() {
    const container = document.getElementById(CONTAINER_ID);
    if (container) {
      container.remove();
      this.uiInitialized = false;
      debugLog('[MBNA] UI container cleaned up');
    }
  }
}

// Singleton
const navigationManager = new MbnaNavigationManager();

// ──────────────────────────────────────────────────────────────
// Initialization Probe
// ──────────────────────────────────────────────────────────────

/**
 * Probe MBNA API connectivity by fetching accounts summary.
 * Updates module state (cachedAccounts, mbnaConnected).
 *
 * Since MBNA uses HttpOnly cookies (not readable from JS), we can't
 * pre-check authentication. Instead, we make an actual API call and
 * let the response determine connectivity (200 = connected, 401/403 = not).
 *
 * @returns {Promise<boolean>} True if connection is valid
 */
async function probeConnection() {
  try {
    const accounts = await api.getAccountsSummary();
    cachedAccounts = accounts;
    mbnaConnected = true;
    debugLog('[MBNA] Probe: connected, found', accounts.length, 'account(s)');
    return true;
  } catch (error) {
    mbnaConnected = false;
    cachedAccounts = [];
    debugLog('[MBNA] Probe: API call failed:', error.message);
    return false;
  }
}

// ──────────────────────────────────────────────────────────────
// UI Container
// ──────────────────────────────────────────────────────────────

/**
 * Get the active page mode based on current URL hash
 * @returns {object|null} The matching page mode or null
 */
function getActivePageMode() {
  const hash = window.location.hash;
  return injectionPoint.pageModes.find((mode) => mode.urlPattern.test(hash)) || null;
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
 * Filters out hidden elements when multiple matches exist.
 * @returns {HTMLElement|null}
 */
function findInjectionTarget() {
  const pageMode = getActivePageMode();
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

/**
 * Creates and appends the main UI container after the injection target
 * @returns {HTMLElement|null} Created container or null
 */
function createUIContainer() {
  const target = findInjectionTarget();
  if (!target) {
    debugLog('[MBNA] Could not find injection target element');
    return null;
  }

  // Don't create twice
  let container = document.getElementById(CONTAINER_ID);
  if (container) return container;

  container = document.createElement('div');
  container.id = CONTAINER_ID;
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
  header.id = 'mbna-ui-header';
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
    color: ${BRAND_COLOR};
    font-size: 16px;
  `;
  titleRow.appendChild(title);

  const settingsButton = document.createElement('button');
  settingsButton.id = 'mbna-settings-button';
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
  subtitle.textContent = 'MBNA → Monarch Money';
  subtitle.style.cssText = 'font-size: 12px; color: #666; font-weight: 500;';
  titleSection.appendChild(subtitle);

  header.appendChild(titleSection);
  container.appendChild(header);

  // Insert after the target element
  target.parentNode.insertBefore(container, target.nextSibling);

  const pageMode = getActivePageMode();
  debugLog('[MBNA] UI container created and inserted after target on page mode:', pageMode?.id || 'unknown');
  return container;
}

// ──────────────────────────────────────────────────────────────
// Upload Flow
// ──────────────────────────────────────────────────────────────

/**
 * Handle the upload button click.
 * Iterates through all MBNA accounts, delegates to upload service
 * for account mapping resolution and sync.
 *
 * @param {HTMLButtonElement} button - The upload button (for disabling during operation)
 */
async function handleUploadClick(button) {
  try {
    button.disabled = true;

    // If we don't have cached accounts, re-probe
    if (cachedAccounts.length === 0) {
      button.textContent = 'Fetching accounts...';
      const connected = await probeConnection();
      if (!connected || cachedAccounts.length === 0) {
        throw new Error('Could not retrieve MBNA accounts. Please refresh the page.');
      }
    }

    debugLog('[MBNA] Processing', cachedAccounts.length, 'account(s)');

    // Process each account through the upload service
    for (const account of cachedAccounts) {
      if (!account.accountId) {
        debugLog('[MBNA] Skipping account with no accountId:', account);
        continue;
      }

      button.textContent = `Processing ${account.displayName || account.endingIn || 'account'}...`;

      // Delegate to upload service — handles mapping, icon upload, and sync
      const result = await uploadMbnaAccount(account, api);
      debugLog('[MBNA] Upload result for', account.displayName, ':', result);

      if (!result.success && result.message === 'Cancelled') {
        debugLog('[MBNA] Upload cancelled for', account.displayName);
        break;
      }
    }
  } catch (error) {
    debugLog('[MBNA] Upload error:', error);
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
 * Runs the connection probe, then renders connection status and upload button.
 *
 * @param {HTMLElement} container
 */
async function initializeUIComponents(container) {
  try {
    // Clear existing dynamic content (keep header)
    const children = Array.from(container.children).slice(1);
    children.forEach((child) => child.remove());

    // Connection status (show "Checking..." initially)
    const connectionStatus = createConnectionStatus();
    container.appendChild(connectionStatus);

    // Run connection probe (cookie check + API call)
    await probeConnection();

    // Upload button — pass probe result and upload handler
    const uploadButton = createMbnaUploadButton(mbnaConnected, handleUploadClick);
    container.appendChild(uploadButton);

    // Update connection status indicators with probe results
    updateConnectionStatus(connectionStatus);

    debugLog('[MBNA] UI components initialized, connected:', mbnaConnected,
      'accounts:', cachedAccounts.length);
    toast.show('MBNA Balance Uploader initialized', 'debug', 2000);
  } catch (error) {
    debugLog('[MBNA] Error initializing UI components:', error);
    toast.show('Failed to initialize MBNA Balance Uploader', 'error');
  }
}

// ──────────────────────────────────────────────────────────────
// Status Updates
// ──────────────────────────────────────────────────────────────

/**
 * Refresh all connection status indicators
 * @param {HTMLElement} connectionStatus
 */
function updateConnectionStatus(connectionStatus) {
  if (!connectionStatus) return;

  try {
    // Check Monarch token
    const monarchToken = GM_getValue(STORAGE.MONARCH_TOKEN);

    // Update MBNA indicator using probe result
    updateMbnaStatus(connectionStatus, mbnaConnected);

    // Update Monarch indicator with login link
    updateMonarchStatus(connectionStatus, Boolean(monarchToken), () => {
      const loginLink = createMonarchLoginLink('Login to Monarch', () => {
        updateConnectionStatus(connectionStatus);
      });
      // Open in new tab
      if (loginLink && loginLink.href) {
        window.open(loginLink.href, '_blank');
      }
    });

    // Refresh upload button with current connection state
    const existingUpload = document.getElementById('mbna-upload-button-container');
    if (existingUpload) {
      const newUploadButton = createMbnaUploadButton(mbnaConnected, handleUploadClick);
      existingUpload.parentNode.replaceChild(newUploadButton, existingUpload);
    }

    debugLog('[MBNA] Connection status updated');
  } catch (error) {
    debugLog('[MBNA] Error updating connection status:', error);
  }
}

// ──────────────────────────────────────────────────────────────
// Async Element Waiting
// ──────────────────────────────────────────────────────────────

/**
 * Wait for injection target element using polling
 * @returns {Promise<HTMLElement>}
 */
function waitForTargetElementAsync() {
  return new Promise((resolve, reject) => {
    const existing = findInjectionTarget();
    if (existing) {
      resolve(existing);
      return;
    }

    let attempts = 0;
    const maxAttempts = 60; // 30 seconds at 500ms

    const checkInterval = setInterval(() => {
      attempts++;
      const element = findInjectionTarget();

      if (element) {
        clearInterval(checkInterval);
        resolve(element);
      } else if (attempts >= maxAttempts) {
        clearInterval(checkInterval);
        reject(new Error('[MBNA] Injection target not found after 30s'));
      }
    }, 500);
  });
}

/**
 * Wait for target element using MutationObserver (for initial load)
 */
function waitForTargetElement() {
  let observer = null;
  let timeoutId = null;
  let initialized = false;

  observer = new MutationObserver((_mutations, obs) => {
    const target = findInjectionTarget();
    if (target && !initialized) {
      initialized = true;
      obs.disconnect();
      if (timeoutId) clearTimeout(timeoutId);

      const container = createUIContainer();
      if (container) {
        initializeUIComponents(container);
        navigationManager.uiInitialized = true;
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  timeoutId = setTimeout(() => {
    if (!initialized) {
      debugLog('[MBNA] Timeout waiting for injection target (30s)');
      if (observer) observer.disconnect();
      toast.show('MBNA UI element not found', 'warning');
    }
  }, 30000);

  debugLog('[MBNA] MutationObserver started, waiting for injection target...');
}

// ──────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────

/**
 * Initialize UI for MBNA website
 */
export async function initMbnaUI() {
  try {
    debugLog('[MBNA] Initializing UI...');

    // Start SPA navigation monitoring
    if (!navigationManager.isInitialized) {
      navigationManager.startMonitoring();
    }

    // Try to create container immediately
    const container = createUIContainer();
    if (container) {
      await initializeUIComponents(container);
      navigationManager.uiInitialized = true;
    } else {
      debugLog('[MBNA] Injection target not found yet, setting up MutationObserver...');
      waitForTargetElement();
    }
  } catch (error) {
    debugLog('[MBNA] Error initializing UI:', error);
    toast.show('Failed to initialize MBNA Balance Uploader', 'error');
  }
}

/**
 * Refresh the UI when auth state changes
 */
export async function refreshMbnaUI() {
  // Re-probe to refresh connection state
  await probeConnection();

  const connectionStatus = document.querySelector(`#${CONTAINER_ID} .connection-status-container`);
  if (connectionStatus) {
    updateConnectionStatus(connectionStatus);
  }
}

export default {
  initMbnaUI,
  refreshMbnaUI,
};