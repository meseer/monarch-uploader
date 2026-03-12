/**
 * Rogers Bank UI Manager
 * Responsible for initializing and managing UI components on Rogers Bank website
 */

import { debugLog } from '../../core/utils';
import { STORAGE, COLORS } from '../../core/config';
import stateManager from '../../core/state';
import rogersbank, { type RogersBankAuthStatus } from '../../api/rogersbank';
import toast from '../toast';
import { createConnectionStatus, updateCredentialsDisplay } from './components/connectionStatus';
import { createRogersBankUploadButton } from './components/uploadButton';
import { showSettingsModal } from '../components/settingsModal';
import { createMonarchLoginLink } from '../components/monarchLoginLink';

declare function GM_getValue(key: string): unknown;

/**
 * Navigation manager for Rogers Bank SPA navigation
 */
class RogersBankNavigationManager {
  currentUrl: string;
  isInitialized: boolean;
  urlCheckInterval: ReturnType<typeof setInterval> | null;
  uiInitialized: boolean;

  constructor() {
    this.currentUrl = window.location.href;
    this.isInitialized = false;
    this.urlCheckInterval = null;
    this.uiInitialized = false;
  }

  startMonitoring(): void {
    if (this.isInitialized) return;

    debugLog('Starting Rogers Bank navigation monitoring...');

    window.addEventListener('popstate', () => {
      this.handleUrlChange();
    });

    this.urlCheckInterval = setInterval(() => {
      this.checkUrlChange();
    }, 500);

    this.isInitialized = true;
    debugLog('Rogers Bank navigation monitoring started');
  }

  stopMonitoring(): void {
    if (this.urlCheckInterval) {
      clearInterval(this.urlCheckInterval);
      this.urlCheckInterval = null;
    }
    this.isInitialized = false;
    debugLog('Rogers Bank navigation monitoring stopped');
  }

  checkUrlChange(): void {
    const newUrl = window.location.href;
    if (newUrl !== this.currentUrl) {
      this.currentUrl = newUrl;
      this.handleUrlChange();
    }
  }

  async handleUrlChange(): Promise<void> {
    try {
      debugLog('Rogers Bank URL changed to:', window.location.href);

      const shouldShowUI = this.shouldShowUI();
      const hasUI = this.hasUIContainer();

      if (shouldShowUI && !hasUI) {
        debugLog('Re-initializing Rogers Bank UI after navigation');
        await this.initializeUIDirectly();
      } else if (!shouldShowUI && hasUI) {
        debugLog('Cleaning up Rogers Bank UI after navigation away');
        this.cleanupUI();
      }
    } catch (error) {
      debugLog('Error handling Rogers Bank URL change:', error);
    }
  }

  async initializeUIDirectly(): Promise<void> {
    try {
      await this.waitForTargetElementAsync();

      const container = createUIContainer();
      if (container) {
        initializeUIComponents(container);
        this.markUIInitialized();
        debugLog('Rogers Bank UI re-initialized successfully after navigation');
      }
    } catch (error) {
      debugLog('Error in direct UI initialization:', error);
    }
  }

  async waitForTargetElementAsync(): Promise<HTMLElement> {
    return new Promise((resolve, reject) => {
      const targetSection = document.querySelector('section[aria-labelledby="master-card-section"]') as HTMLElement | null;
      if (targetSection) {
        resolve(targetSection);
        return;
      }

      let attempts = 0;
      const maxAttempts = 60;

      const checkInterval = setInterval(() => {
        attempts++;
        const element = document.querySelector('section[aria-labelledby="master-card-section"]') as HTMLElement | null;

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

  shouldShowUI(): boolean {
    const path = window.location.pathname;
    return path === '/'
           || path === '/home'
           || path === '/dashboard'
           || /^\/accounts?\/?$/.test(path)
           || path.includes('master-card');
  }

  hasUIContainer(): boolean {
    return document.getElementById('rogersbank-balance-uploader-container') !== null;
  }

  cleanupUI(): void {
    const container = document.getElementById('rogersbank-balance-uploader-container');
    if (container) {
      container.remove();
      this.uiInitialized = false;
      debugLog('Rogers Bank UI container cleaned up');
    }
  }

  markUIInitialized(): void {
    this.uiInitialized = true;
  }

  isUIInitializedCheck(): boolean {
    return this.uiInitialized;
  }
}

// Create singleton instance
const navigationManager = new RogersBankNavigationManager();

/**
 * Creates and appends the main UI container to Rogers Bank page
 */
function createUIContainer(): HTMLElement | null {
  const targetSection = document.querySelector('section[aria-labelledby="master-card-section"]');
  if (!targetSection) {
    debugLog('Could not find section[aria-labelledby="master-card-section"] insertion point');
    return null;
  }

  let container = document.getElementById('rogersbank-balance-uploader-container');
  if (container) {
    return container;
  }

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

  // Add responsive behavior
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

  targetSection.appendChild(container);

  debugLog('Rogers Bank UI container created and appended to master-card-section');
  return container;
}

/**
 * Initialize UI for Rogers Bank website
 */
export async function initRogersBankUI(): Promise<void> {
  try {
    debugLog('Initializing Rogers Bank UI...');

    if (!navigationManager.isInitialized) {
      navigationManager.startMonitoring();
    }

    const container = createUIContainer();
    if (container) {
      initializeUIComponents(container);
      navigationManager.markUIInitialized();
    } else {
      debugLog('Target element not found, setting up MutationObserver...');
      waitForTargetElement();
    }
  } catch (error) {
    debugLog('Error initializing Rogers Bank UI:', error);
    toast.show('Failed to initialize Balance Uploader', 'error');
  }
}

export function startNavigationMonitoring(): void {
  navigationManager.startMonitoring();
}

export function stopNavigationMonitoring(): void {
  navigationManager.stopMonitoring();
}

/**
 * Initialize UI components once container is available
 */
function initializeUIComponents(container: HTMLElement): void {
  try {
    const existingContent = Array.from(container.children).slice(1);
    existingContent.forEach((child) => child.remove());

    const connectionStatus = createConnectionStatus();
    container.appendChild(connectionStatus);

    const uploadButton = createRogersBankUploadButton();
    container.appendChild(uploadButton);

    setupStatusMonitoring(connectionStatus);
    updateConnectionStatus(connectionStatus);

    debugLog('Rogers Bank UI initialized successfully');
    toast.show('Rogers Bank Balance Uploader initialized', 'debug', 2000);
  } catch (error) {
    debugLog('Error initializing UI components:', error);
    toast.show('Failed to initialize Balance Uploader', 'error');
  }
}

/**
 * Wait for target element to appear using MutationObserver
 */
function waitForTargetElement(): void {
  let observer: MutationObserver | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let isInitialized = false;

  observer = new MutationObserver((_mutations, obs) => {
    const targetSection = document.querySelector('section[aria-labelledby="master-card-section"]');

    if (targetSection && !isInitialized) {
      debugLog('Target element found, initializing UI...');
      isInitialized = true;
      obs.disconnect();

      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      const container = createUIContainer();
      if (container) {
        initializeUIComponents(container);
        navigationManager.markUIInitialized();
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  timeoutId = setTimeout(() => {
    if (!isInitialized) {
      debugLog('Timeout waiting for Rogers Bank UI element (30s)');
      if (observer) {
        observer.disconnect();
      }
      toast.show('Rogers Bank UI element not found', 'warning');
    }
  }, 30000);

  debugLog('MutationObserver started, waiting for target element...');
}

function setupStatusMonitoring(connectionStatus: HTMLElement): void {
  stateManager.addListener('auth', () => {
    updateConnectionStatus(connectionStatus);
  });

  stateManager.addListener('rogersbankAuth', () => {
    updateConnectionStatus(connectionStatus);
  });
}

function updateConnectionStatus(connectionStatus: HTMLElement): void {
  if (!connectionStatus) return;

  try {
    const rogersbankAuth: RogersBankAuthStatus = rogersbank.checkRogersBankAuth();
    const monarchToken = GM_getValue(STORAGE.MONARCH_TOKEN);

    const rogersbankIndicator = connectionStatus.querySelector('.rogersbank-status') as HTMLElement | null;
    if (rogersbankIndicator) {
      if (rogersbankAuth.authenticated) {
        rogersbankIndicator.textContent = 'Rogers Bank: Connected';
        rogersbankIndicator.style.color = '#28a745';
      } else {
        const missingCreds: string[] = [];
        const creds = rogersbankAuth.credentials;
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

    const monarchIndicator = connectionStatus.querySelector('.monarch-status') as HTMLElement | null;
    if (monarchIndicator) {
      monarchIndicator.innerHTML = '';

      if (monarchToken) {
        monarchIndicator.textContent = 'Monarch: Connected';
        monarchIndicator.style.color = '#28a745';
      } else {
        const loginLink = createMonarchLoginLink('Monarch: Connect', () => {
          updateConnectionStatus(connectionStatus);
        });
        monarchIndicator.appendChild(loginLink);
      }
    }

    if (rogersbankAuth.credentials) {
      updateCredentialsDisplay(connectionStatus, rogersbankAuth.credentials as Record<string, string>);
    }

    const uploadContainer = document.querySelector('.rogersbank-upload-button-container');
    if (uploadContainer) {
      const newUploadButton = createRogersBankUploadButton();
      uploadContainer.parentNode!.replaceChild(newUploadButton, uploadContainer);
    }

    debugLog('Connection status updated');
  } catch (error) {
    debugLog('Error updating connection status:', error);
  }
}

export function refreshRogersBankUI(): void {
  const connectionStatus = document.querySelector('#rogersbank-balance-uploader-container .connection-status-container') as HTMLElement | null;
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