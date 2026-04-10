/**
 * UI Manager
 * Responsible for initializing and managing UI components
 */

declare function GM_getValue(key: string, defaultValue?: unknown): unknown;

import { debugLog, isQuestradeAllAccountsPage, getLastUpdateDate } from '../../core/utils';
import { STORAGE } from '../../core/config';
import stateManager from '../../core/state';
import questradeApi from '../../api/questrade';
import toast from '../toast';
import uploadButton, { createTestingSection } from './components/uploadButton';
import { showSettingsModal } from '../components/settingsModal';
import { createMonarchLoginLink } from '../components/monarchLoginLink';
import { getAccountsForSync } from '../../services/questrade/balance';

interface StatusIndicators {
  questrade: HTMLDivElement;
  questradeExpiry: HTMLDivElement;
  monarch: HTMLDivElement;
  lastDownloaded: HTMLDivElement;
}

interface QuestradeToken {
  expires_at?: number;
  [key: string]: unknown;
}

type ContainerWithListener = HTMLDivElement & {
  accountListener?: (() => void) | null;
};

function createStatusIndicators(container: HTMLElement): StatusIndicators | null {
  if (!container) return null;
  const wrapper = document.createElement('div');
  wrapper.className = 'balance-uploader-status';
  wrapper.style.cssText = 'display: flex; flex-wrap: wrap; gap: 10px; margin: 10px 0; padding: 10px; border-radius: 4px; background-color: var(--mu-bg-tertiary, #f5f5f5); font-size: 14px;';
  const questradeStatus = document.createElement('div');
  questradeStatus.className = 'questrade-status-indicator';
  questradeStatus.textContent = 'Questrade: Checking...';
  questradeStatus.style.cssText = 'display: flex; align-items: center; gap: 5px;';
  wrapper.appendChild(questradeStatus);
  const questradeExpiry = document.createElement('div');
  questradeExpiry.className = 'questrade-expiry-indicator';
  questradeExpiry.style.cssText = 'display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--mu-text-secondary, #666);';
  wrapper.appendChild(questradeExpiry);
  const monarchStatus = document.createElement('div');
  monarchStatus.className = 'monarch-status-indicator';
  monarchStatus.textContent = 'Monarch: Checking...';
  monarchStatus.style.cssText = 'display: flex; align-items: center; gap: 5px;';
  wrapper.appendChild(monarchStatus);
  const lastDownloaded = document.createElement('div');
  lastDownloaded.className = 'last-downloaded-note';
  lastDownloaded.style.cssText = 'display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--mu-text-secondary, #666);';
  wrapper.appendChild(lastDownloaded);
  container.appendChild(wrapper);
  return { questrade: questradeStatus, questradeExpiry, monarch: monarchStatus, lastDownloaded };
}

export function updateStatusIndicators(indicators: StatusIndicators | null): void {
  if (!indicators) return;
  const state = stateManager.getState();
  if (indicators.questrade) {
    const questradeToken = questradeApi.getToken() as QuestradeToken | null;
    if (questradeToken) {
      indicators.questrade.textContent = 'Questrade: Connected';
      indicators.questrade.style.color = '#28a745';
    } else {
      indicators.questrade.textContent = 'Questrade: Not connected';
      indicators.questrade.style.color = '#dc3545';
    }
  }
  if (indicators.questradeExpiry) {
    const questradeToken = questradeApi.getToken() as QuestradeToken | null;
    if (questradeToken && questradeToken.expires_at) {
      const expiryTime = new Date(questradeToken.expires_at * 1000);
      const now = new Date();
      const minutesLeft = Math.floor((expiryTime.getTime() - now.getTime()) / 60000);
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
  if (indicators.monarch) {
    const monarchToken = GM_getValue(STORAGE.MONARCH_TOKEN);
    indicators.monarch.innerHTML = '';
    if (monarchToken) {
      indicators.monarch.textContent = 'Monarch: Connected';
      indicators.monarch.style.color = '#28a745';
    } else {
      const loginLink = createMonarchLoginLink('Monarch: Connect', () => {
        updateStatusIndicators(indicators);
      });
      indicators.monarch.appendChild(loginLink);
    }
  }
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

function createButtonContainer(): HTMLDivElement {
  const container = document.createElement('div');
  container.id = 'balance-uploader-container';
  container.style.cssText = 'position: relative; margin: 15px 0; padding: 15px; background-color: var(--mu-bg-primary, white); color: var(--mu-text-primary, #333); border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);';
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
  settingsButton.style.cssText = 'background: none; border: none; font-size: 16px; cursor: pointer; padding: 4px 8px; border-radius: 4px; color: #666; transition: background-color 0.2s;';
  settingsButton.addEventListener('click', showSettingsModal);
  settingsButton.addEventListener('mouseover', () => { settingsButton.style.backgroundColor = '#f0f0f0'; });
  settingsButton.addEventListener('mouseout', () => { settingsButton.style.backgroundColor = 'transparent'; });
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

function waitForTargetElement(selector: string, timeout = 30000): Promise<Element | null> {
  return new Promise((resolve) => {
    const element = document.querySelector(selector);
    if (element) {
      resolve(element);
      return;
    }
    let observer: MutationObserver | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let resolved = false;
    observer = new MutationObserver((mutations, obs) => {
      const targetElement = document.querySelector(selector);
      if (targetElement && !resolved) {
        resolved = true;
        obs.disconnect();
        if (timeoutId) { clearTimeout(timeoutId); }
        debugLog(`Target element found: ${selector}`);
        resolve(targetElement);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        debugLog(`Timeout waiting for element: ${selector} (${timeout}ms)`);
        if (observer) { observer.disconnect(); }
        resolve(null);
      }
    }, timeout);
    debugLog(`MutationObserver started, waiting for: ${selector}`);
  });
}

function createHeaderWithGearButton(container: HTMLDivElement): void {
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
  settingsButton.style.cssText = 'background: none; border: none; font-size: 16px; cursor: pointer; padding: 4px 8px; border-radius: 4px; color: #666; transition: background-color 0.2s;';
  settingsButton.addEventListener('click', showSettingsModal);
  settingsButton.addEventListener('mouseover', () => { settingsButton.style.backgroundColor = 'var(--mu-hover-bg, #f0f0f0)'; });
  settingsButton.addEventListener('mouseout', () => { settingsButton.style.backgroundColor = 'transparent'; });
  titleRow.appendChild(settingsButton);
  titleSection.appendChild(titleRow);
  const subtitle = document.createElement('div');
  subtitle.textContent = 'Questrade → Monarch Money';
  subtitle.style.cssText = 'font-size: 14px; color: var(--mu-text-secondary, #666);';
  titleSection.appendChild(subtitle);
  header.appendChild(titleSection);
  container.appendChild(header);
}

export async function initSingleAccountUI(): Promise<void> {
  try {
    const matches = window.location.pathname.match(/\/accounts\/([^/]+)/);
    const accountId = matches?.[1] || null;
    if (!accountId) {
      debugLog('No account ID found in URL, skipping single account UI');
      return;
    }
    let container = document.getElementById('balance-uploader-container') as ContainerWithListener | null;
    let isNewContainer = false;
    if (!container) {
      container = createButtonContainer() as ContainerWithListener;
      isNewContainer = true;
      let targetContainer = document.querySelector('.sidebar__content');
      if (!targetContainer) {
        debugLog('.sidebar__content not found, setting up observer to wait for it...');
        targetContainer = await waitForTargetElement('.sidebar__content', 30000);
        if (!targetContainer) {
          debugLog('Could not find .sidebar__content insertion point after waiting');
          toast.show('UI element not found - please refresh the page', 'warning');
          return;
        }
      }
      debugLog('Adding button container to .sidebar__content');
      targetContainer.appendChild(container);
    }
    if (!isNewContainer) {
      container.innerHTML = '';
      createHeaderWithGearButton(container);
      if (container.accountListener) {
        container.accountListener();
        container.accountListener = null;
      }
    }
    const indicators = createStatusIndicators(container);
    stateManager.setUiElement('questrade', indicators!.questrade);
    stateManager.setUiElement('questradeExpiry', indicators!.questradeExpiry);
    stateManager.setUiElement('monarch', indicators!.monarch);
    stateManager.setUiElement('lastDownloadedNote', indicators!.lastDownloaded);
    updateStatusIndicators(indicators);
    const currentState = stateManager.getState();
    const accountName = currentState.currentAccount.nickname && currentState.currentAccount.nickname !== 'unknown'
      ? currentState.currentAccount.nickname : 'Loading...';
    const uploadBtn = uploadButton.createSingleAccountUploadButton(accountId, accountName);
    uploadBtn.id = 'single-account-upload-btn';
    container.appendChild(uploadBtn);
    if (container.accountListener) {
      container.accountListener();
      container.accountListener = null;
    }
    container.accountListener = stateManager.addListener('account', (newState: ReturnType<typeof stateManager.getState>) => {
      const existingBtn = document.getElementById('single-account-upload-btn');
      if (existingBtn && newState.currentAccount.id && newState.currentAccount.nickname !== 'unknown') {
        existingBtn.textContent = `Upload ${newState.currentAccount.nickname} to Monarch`;
        debugLog(`Updated upload button text to: ${newState.currentAccount.nickname}`);
      }
      updateStatusIndicators(indicators);
    });
    const testingSection = createTestingSection({ accountId, accountName });
    if (testingSection) {
      container.appendChild(testingSection);
    }
    debugLog(`Single account UI initialized for account: ${accountId}`);
  } catch (error) {
    debugLog('Error initializing single account UI:', error);
  }
}

export async function initAllAccountsUI(): Promise<void> {
  try {
    if (!isQuestradeAllAccountsPage()) return;
    let container = document.getElementById('balance-uploader-container') as ContainerWithListener | null;
    let isNewContainer = false;
    if (!container) {
      container = createButtonContainer() as ContainerWithListener;
      isNewContainer = true;
      let targetContainer = document.querySelector('.sidebar__content');
      if (!targetContainer) {
        debugLog('.sidebar__content not found, setting up observer to wait for it...');
        targetContainer = await waitForTargetElement('.sidebar__content', 30000);
        if (!targetContainer) {
          debugLog('Could not find .sidebar__content insertion point after waiting');
          toast.show('UI element not found - please refresh the page', 'warning');
          return;
        }
      }
      debugLog('Adding button container to .sidebar__content');
      targetContainer.appendChild(container);
    }
    let accounts: unknown[] = [];
    const maxRetries = 10;
    const retryDelay = 1000;
    debugLog('Starting to fetch accounts with retries (using getAccountsForSync)...');
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        accounts = await getAccountsForSync({ includeClosed: false }) as unknown[];
        if (accounts && accounts.length > 0) {
          debugLog(`Successfully fetched ${accounts.length} accounts on attempt ${attempt} (merged API + storage)`);
          break;
        }
        if (attempt < maxRetries) {
          debugLog(`No accounts found on attempt ${attempt}, retrying in ${retryDelay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
        }
      } catch (error) {
        debugLog(`Error fetching accounts on attempt ${attempt}:`, error);
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
    if (!isNewContainer) {
      container.innerHTML = '';
      createHeaderWithGearButton(container);
      debugLog('Cleared existing content from container, recreated header with gear button');
    }
    const indicators = createStatusIndicators(container);
    stateManager.setUiElement('questrade', indicators!.questrade);
    stateManager.setUiElement('questradeExpiry', indicators!.questradeExpiry);
    stateManager.setUiElement('monarch', indicators!.monarch);
    updateStatusIndicators(indicators);
    const bulkBtn = uploadButton.createBulkUploadButton(accounts);
    container.appendChild(bulkBtn);
    const testingSection = createTestingSection();
    if (testingSection) {
      container.appendChild(testingSection);
    }
    debugLog('All accounts UI initialized');
  } catch (error) {
    debugLog('Error initializing all accounts UI:', error);
  }
}

export async function initUI(): Promise<void> {
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

function refreshQuestradeUI(): boolean {
  try {
    const container = document.getElementById('balance-uploader-container');
    if (!container) {
      debugLog('Questrade container not found, cannot refresh');
      return false;
    }
    const existingTestingSection = container.querySelector('#questrade-testing-section');
    if (existingTestingSection) {
      existingTestingSection.remove();
    }
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