/**
 * Wealthsimple UI Manager
 * Responsible for initializing and managing UI components on Wealthsimple website
 */

declare function GM_getValue(key: string, defaultValue?: unknown): unknown;

import { debugLog } from '../../core/utils';
import { STORAGE, COLORS, WEALTHSIMPLE_UI } from '../../core/config';
import stateManager from '../../core/state';
import wealthsimpleApi from '../../api/wealthsimple';
import toast from '../toast';
import { createConnectionStatus } from './components/connectionStatus';
import { createWealthsimpleUploadButton } from './components/uploadButton';
import { showSettingsModal } from '../components/settingsModal';
import { createMonarchLoginLink } from '../components/monarchLoginLink';

interface InjectionPointConfig {
  selector: string;
  insertMethod: string;
}

interface InjectionPointResult {
  element: Element;
  insertMethod: string;
  selector: string;
}

interface TargetContainerResult {
  container: Element | ParentNode;
  referenceNode: Element | ChildNode | null;
}


type ConnectionStatusElement = HTMLDivElement & {
  statusInterval?: ReturnType<typeof setInterval>;
};

function resolveElement(selector: string): Element | null {
  if (selector.startsWith('last:')) {
    const cssSelector = selector.slice(5);
    const all = document.querySelectorAll(cssSelector);
    return all.length > 0 ? all[all.length - 1] : null;
  }
  return document.querySelector(selector);
}

function findInjectionPoint(): InjectionPointResult | null {
  for (const injectionPoint of (WEALTHSIMPLE_UI as unknown as { INJECTION_POINTS: InjectionPointConfig[] }).INJECTION_POINTS) {
    const element = resolveElement(injectionPoint.selector);
    if (element) {
      debugLog(`Found injection point: ${injectionPoint.selector} (method: ${injectionPoint.insertMethod})`);
      return { element, insertMethod: injectionPoint.insertMethod, selector: injectionPoint.selector };
    }
  }
  return null;
}

function getTargetContainer(element: Element, insertMethod: string): TargetContainerResult | null {
  if (insertMethod === 'prepend') {
    return { container: element, referenceNode: null };
  }
  if (insertMethod === 'prependToSecondChild') {
    const children = Array.from(element.children);
    if (children.length >= 2) {
      return { container: children[1], referenceNode: null };
    }
    debugLog(`prependToSecondChild: element has only ${children.length} children, need at least 2`);
    return null;
  }
  if (insertMethod === 'insertBefore') {
    if (!element.parentNode) {
      debugLog('insertBefore: element has no parent node');
      return null;
    }
    return { container: element.parentNode, referenceNode: element };
  }
  debugLog(`Unknown insert method: ${insertMethod}`);
  return null;
}

function stripSelectorPrefix(selector: string): string {
  return selector.startsWith('last:') ? selector.slice(5) : selector;
}

function getAllInjectionSelectors(): string {
  return (WEALTHSIMPLE_UI as unknown as { INJECTION_POINTS: InjectionPointConfig[] }).INJECTION_POINTS
    .map((ip) => stripSelectorPrefix(ip.selector)).join(', ');
}

async function createUIContainer(
  injectionPoint: InjectionPointResult | null = null,
  targetInfo: TargetContainerResult | null = null,
): Promise<HTMLDivElement | null> {
  if (!injectionPoint) {
    injectionPoint = findInjectionPoint();
    if (!injectionPoint) {
      const selectors = getAllInjectionSelectors();
      debugLog(`No injection point found yet (tried: ${selectors}), will retry via observer`);
      return null;
    }
  }
  if (!targetInfo) {
    targetInfo = getTargetContainer(injectionPoint.element, injectionPoint.insertMethod);
    if (!targetInfo) {
      debugLog(`Could not resolve target container for ${injectionPoint.selector}, will retry via observer`);
      return null;
    }
  }
  let container = document.getElementById('wealthsimple-balance-uploader-container') as HTMLDivElement | null;
  if (container) {
    debugLog('UI container already exists');
    return container;
  }
  debugLog('Creating UI container...');
  container = document.createElement('div');
  container.id = 'wealthsimple-balance-uploader-container';
  container.style.cssText = `position: relative; padding: 16px; background-color: var(--mu-bg-primary, #ffffff); border: 1px solid var(--mu-border, #e5e5e5); border-radius: 8px; font-family: "Wealthsimple Sans", sans-serif; font-size: 14px; color: var(--mu-text-primary, ${COLORS.WEALTHSIMPLE_BRAND});`;

  const header = document.createElement('div');
  header.id = 'wealthsimple-uploader-header';
  header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;';
  const titleSection = document.createElement('div');
  titleSection.id = 'wealthsimple-uploader-title-section';
  titleSection.style.cssText = 'display: flex; flex-direction: column;';
  const titleRow = document.createElement('div');
  titleRow.id = 'wealthsimple-uploader-title-row';
  titleRow.style.cssText = 'display: flex; align-items: center; gap: 10px;';
  const title = document.createElement('div');
  title.id = 'wealthsimple-uploader-title';
  title.textContent = 'Balance Uploader';
  title.style.cssText = `font-weight: 600; color: var(--mu-text-primary, ${COLORS.WEALTHSIMPLE_BRAND}); font-size: 16px;`;
  titleRow.appendChild(title);
  const settingsButton = document.createElement('button');
  settingsButton.id = 'wealthsimple-settings-button';
  settingsButton.innerHTML = '⚙️';
  settingsButton.title = 'Settings';
  settingsButton.style.cssText = 'background: none; border: none; font-size: 14px; cursor: pointer; padding: 4px 6px; border-radius: 4px; color: var(--mu-text-secondary, #666); transition: background-color 0.2s;';
  settingsButton.addEventListener('click', showSettingsModal);
  settingsButton.addEventListener('mouseover', () => { settingsButton.style.backgroundColor = 'var(--mu-hover-bg, #f0f0f0)'; });
  settingsButton.addEventListener('mouseout', () => { settingsButton.style.backgroundColor = 'transparent'; });
  titleRow.appendChild(settingsButton);
  titleSection.appendChild(titleRow);
  const subtitle = document.createElement('div');
  subtitle.id = 'wealthsimple-uploader-subtitle';
  subtitle.textContent = 'Wealthsimple → Monarch Money';
  subtitle.style.cssText = 'font-size: 12px; color: var(--mu-text-secondary, #666); font-weight: 500;';
  titleSection.appendChild(subtitle);
  header.appendChild(titleSection);
  container.appendChild(header);

  const referenceNode = targetInfo.referenceNode ?? (targetInfo.container as Element).firstChild;
  (targetInfo.container as Element).insertBefore(container, referenceNode);
  debugLog(`Wealthsimple UI container created using injection point: ${injectionPoint.selector} (method: ${injectionPoint.insertMethod})`);
  return container;
}

function initializeUIComponents(container: HTMLDivElement): void {
  try {
    const existingContent = Array.from(container.children).slice(1);
    existingContent.forEach((child) => child.remove());
    const connectionStatus = createConnectionStatus() as ConnectionStatusElement;
    container.appendChild(connectionStatus);
    const uploadButtonEl = createWealthsimpleUploadButton();
    container.appendChild(uploadButtonEl);
    setupStatusMonitoring(connectionStatus);
    updateConnectionStatus(connectionStatus);
    debugLog('Wealthsimple UI initialized successfully');
    toast.show('Wealthsimple Balance Uploader initialized', 'debug', 2000);
  } catch (error) {
    debugLog('Error initializing UI components:', error);
    toast.show('Failed to initialize Balance Uploader', 'error');
  }
}

let bodyObserver: MutationObserver | null = null;
let targetContainerObserver: MutationObserver | null = null;
let isUIInitialized = false;
let isInitializing = false;
let reinjectionTimeout: ReturnType<typeof setTimeout> | null = null;

function scheduleUIReinjection(): void {
  if (reinjectionTimeout) { clearTimeout(reinjectionTimeout); }
  reinjectionTimeout = setTimeout(() => {
    checkAndInitializeUI();
    reinjectionTimeout = null;
  }, 200);
}

async function checkAndInitializeUI(): Promise<void> {
  if (isInitializing) {
    debugLog('Initialization already in progress, skipping');
    return;
  }
  try {
    isInitializing = true;
    const existingContainer = document.getElementById('wealthsimple-balance-uploader-container');
    if (existingContainer && document.contains(existingContainer)) {
      debugLog('UI already present in DOM, skipping initialization');
      isUIInitialized = true;
      return;
    }
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
    debugLog('Creating/recreating Wealthsimple UI...');
    isUIInitialized = false;
    const container = await createUIContainer(injectionPoint, targetInfo);
    if (container) {
      initializeUIComponents(container);
      isUIInitialized = true;
      debugLog('Wealthsimple UI successfully initialized!');
      observeTargetContainer(container.parentNode!);
    } else {
      debugLog('Failed to create UI container, observer will retry');
    }
  } catch (error) {
    debugLog('Error in checkAndInitializeUI:', error);
    isUIInitialized = false;
  } finally {
    isInitializing = false;
  }
}

function observeTargetContainer(targetContainer: ParentNode): void {
  if (targetContainerObserver) { targetContainerObserver.disconnect(); }
  debugLog('Setting up observer on target container...');
  targetContainerObserver = new MutationObserver(() => {
    const ourUI = document.getElementById('wealthsimple-balance-uploader-container');
    if (!ourUI || !document.contains(ourUI)) {
      debugLog('Our UI was removed from DOM, scheduling reinjection...');
      isUIInitialized = false;
      scheduleUIReinjection();
    }
  });
  targetContainerObserver.observe(targetContainer as Node, { childList: true, subtree: false });
  debugLog('Target container observer set up');
}

function startPersistentMonitoring(): void {
  if (bodyObserver) {
    debugLog('Persistent monitoring already active');
    return;
  }
  const selectors = getAllInjectionSelectors();
  debugLog(`Starting persistent UI monitoring for injection points: ${selectors}...`);
  bodyObserver = new MutationObserver(() => {
    const ourUI = document.getElementById('wealthsimple-balance-uploader-container');
    if (ourUI && document.contains(ourUI)) { return; }
    const injectionPoint = findInjectionPoint();
    if (injectionPoint) {
      const targetInfo = getTargetContainer(injectionPoint.element, injectionPoint.insertMethod);
      if (targetInfo) {
        debugLog(`Observer detected ${injectionPoint.selector} without UI, scheduling injection...`);
        isUIInitialized = false;
        scheduleUIReinjection();
      }
    } else if (isUIInitialized) {
      debugLog('Observer detected all injection points removed, marking for re-initialization');
      isUIInitialized = false;
      if (targetContainerObserver) {
        targetContainerObserver.disconnect();
        targetContainerObserver = null;
      }
    }
  });
  bodyObserver.observe(document.body, { childList: true, subtree: true });
  debugLog('Persistent UI monitoring started - observer active!');
}

function setupUrlChangeMonitoring(): void {
  debugLog('Setting up URL change monitoring...');
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  history.pushState = function (...args: Parameters<typeof history.pushState>) {
    originalPushState.apply(this, args);
    debugLog('pushState detected - SPA navigation occurred');
    scheduleUIReinjection();
  };
  history.replaceState = function (...args: Parameters<typeof history.replaceState>) {
    originalReplaceState.apply(this, args);
    debugLog('replaceState detected - URL updated');
    scheduleUIReinjection();
  };
  window.addEventListener('popstate', () => {
    debugLog('popstate event - back/forward navigation detected');
    scheduleUIReinjection();
  });
  debugLog('URL change monitoring active');
}

export async function initWealthsimpleUI(): Promise<void> {
  try {
    debugLog('Initializing Wealthsimple UI...');
    wealthsimpleApi.setupTokenMonitoring();
    setupUrlChangeMonitoring();
    startPersistentMonitoring();
    checkAndInitializeUI().catch((err) => {
      debugLog('Initial UI creation deferred:', err);
    });
    setTimeout(() => checkAndInitializeUI(), 1000);
    setTimeout(() => checkAndInitializeUI(), 2000);
    setTimeout(() => checkAndInitializeUI(), 5000);
  } catch (error) {
    debugLog('Error initializing Wealthsimple UI:', error);
    toast.show('Failed to initialize Balance Uploader', 'error');
  }
}

function updateUploadButton(container: HTMLDivElement): void {
  if (!container) return;
  try {
    const existingButtonContainer = container.querySelector('#wealthsimple-upload-button-container');
    if (existingButtonContainer) { existingButtonContainer.remove(); }
    const newUploadButton = createWealthsimpleUploadButton();
    container.appendChild(newUploadButton);
    debugLog('Upload button updated based on auth status change');
  } catch (error) {
    debugLog('Error updating upload button:', error);
  }
}

function setupStatusMonitoring(connectionStatus: ConnectionStatusElement): void {
  const statusInterval = setInterval(() => {
    updateConnectionStatus(connectionStatus);
  }, 10000);
  connectionStatus.statusInterval = statusInterval;
  stateManager.addListener('auth', () => {
    updateConnectionStatus(connectionStatus);
    const container = document.getElementById('wealthsimple-balance-uploader-container') as HTMLDivElement | null;
    if (container) { updateUploadButton(container); }
  });
}

function formatTimeRemaining(expiresAt: string): string {
  if (!expiresAt) return '';
  try {
    const expiryTime = new Date(expiresAt).getTime();
    const currentTime = Date.now();
    const remainingMs = expiryTime - currentTime;
    if (remainingMs <= 0) return 'expired';
    const remainingMinutes = Math.floor(remainingMs / 60000);
    const remainingHours = Math.floor(remainingMinutes / 60);
    const remainingDays = Math.floor(remainingHours / 24);
    if (remainingDays > 0) return `expires in ${remainingDays}d ${remainingHours % 24}h`;
    if (remainingHours > 0) return `expires in ${remainingHours}h ${remainingMinutes % 60}m`;
    return `expires in ${remainingMinutes}m`;
  } catch {
    return '';
  }
}

function getExpirationColor(expiresAt: string): string {
  if (!expiresAt) return '#dc3545';
  try {
    const expiryTime = new Date(expiresAt).getTime();
    const currentTime = Date.now();
    const remainingMs = expiryTime - currentTime;
    const remainingMinutes = Math.floor(remainingMs / 60000);
    if (remainingMinutes <= 0) return '#dc3545';
    if (remainingMinutes < 10) return '#ffc107';
    return '#28a745';
  } catch {
    return '#dc3545';
  }
}

function updateConnectionStatus(connectionStatus: HTMLElement): void {
  if (!connectionStatus) return;
  try {
    const wealthsimpleAuth = wealthsimpleApi.checkAuth();
    const monarchToken = GM_getValue(STORAGE.MONARCH_TOKEN);
    const wealthsimpleIndicator = connectionStatus.querySelector('.wealthsimple-status') as HTMLElement | null;
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
    const monarchIndicator = connectionStatus.querySelector('.monarch-status') as HTMLElement | null;
    if (monarchIndicator) {
      if (monarchToken) {
        monarchIndicator.textContent = 'Monarch: Connected';
        monarchIndicator.style.color = '#28a745';
      } else {
        monarchIndicator.textContent = '';
        const loginLink = createMonarchLoginLink('Monarch: Connect', () => {
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