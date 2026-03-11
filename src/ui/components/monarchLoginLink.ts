/**
 * Monarch Login Link Component
 * Creates clickable links that open Monarch login in popup and detect successful authentication
 */

import { debugLog } from '../../core/utils';
import { STORAGE, API } from '../../core/config';
import stateManager from '../../core/state';
import toast from '../toast';

/**
 * Create a clickable "Not connected" link that opens Monarch login popup
 * @param text - The text to display for the link
 * @param onSuccess - Callback function to execute after successful login
 * @returns Clickable link element
 */
export function createMonarchLoginLink(
  text = 'Monarch: Connect',
  onSuccess: (() => void) | null = null,
): HTMLElement {
  const link = document.createElement('span');
  link.textContent = text;
  link.style.cssText = `
    color: #dc3545;
    cursor: pointer;
    text-decoration: underline;
    transition: color 0.2s;
  `;

  link.addEventListener('mouseenter', () => {
    link.style.color = '#a71e2a';
  });

  link.addEventListener('mouseleave', () => {
    link.style.color = '#dc3545';
  });

  link.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    openMonarchLoginPopup(onSuccess);
  });

  return link;
}

/**
 * Open Monarch login in a popup window and monitor for successful authentication
 * @param onSuccess - Callback function to execute after successful login
 */
function openMonarchLoginPopup(onSuccess: (() => void) | null = null): void {
  try {
    debugLog('Opening Monarch login popup...');

    const width = 500;
    const height = 600;
    const left = Math.round((window.screen.width - width) / 2);
    const top = Math.round((window.screen.height - height) / 2);

    const popupFeatures = [
      `width=${width}`,
      `height=${height}`,
      `left=${left}`,
      `top=${top}`,
      'scrollbars=yes',
      'resizable=yes',
      'toolbar=no',
      'menubar=no',
      'location=no',
      'directories=no',
      'status=no',
    ].join(',');

    const popup = window.open(`${API.MONARCH_APP_URL}/dashboard`, 'monarchLogin', popupFeatures);

    if (!popup) {
      toast.show('Popup blocked. Please allow popups for this site and try again.', 'error', 5000);
      return;
    }

    toast.show('Opening Monarch Money login...', 'info', 2000);
    monitorPopupForLogin(popup, onSuccess);
  } catch (error) {
    debugLog('Error opening Monarch login popup:', error);
    toast.show('Failed to open login popup', 'error');
  }
}

/**
 * Monitor popup window for successful authentication
 * @param popup - The popup window reference
 * @param onSuccess - Callback function to execute after successful login
 */
function monitorPopupForLogin(popup: Window, onSuccess: (() => void) | null): void {
  let checkInterval: ReturnType<typeof setInterval> | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let isMonitoring = true;

  const cleanup = () => {
    if (checkInterval) {
      clearInterval(checkInterval);
      checkInterval = null;
    }
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    isMonitoring = false;
  };

  // Check for token every 1 second
  checkInterval = setInterval(() => {
    if (!isMonitoring) return;

    try {
      if (popup.closed) {
        debugLog('Monarch login popup was closed');
        cleanup();

        const token = GM_getValue(STORAGE.MONARCH_TOKEN);
        if (token) {
          handleSuccessfulLogin(onSuccess);
        }
        return;
      }

      const token = GM_getValue(STORAGE.MONARCH_TOKEN);
      if (token) {
        debugLog('Monarch token detected, login successful');
        cleanup();

        try {
          popup.close();
        } catch (e) {
          debugLog('Could not close popup:', e);
        }

        handleSuccessfulLogin(onSuccess);
      }
    } catch (error) {
      debugLog('Error monitoring popup:', error);
    }
  }, 1000);

  // Set timeout to stop monitoring after 10 minutes
  timeoutId = setTimeout(() => {
    if (!isMonitoring) return;

    debugLog('Timeout waiting for Monarch login (10 minutes)');
    cleanup();

    try {
      if (!popup.closed) {
        popup.close();
      }
    } catch (e) {
      debugLog('Could not close popup on timeout:', e);
    }

    toast.show('Login timeout. Please try again if needed.', 'warning');
  }, 600000); // 10 minutes

  debugLog('Started monitoring popup for Monarch authentication');
}

/**
 * Handle successful login detection
 * @param onSuccess - Callback function to execute after successful login
 */
function handleSuccessfulLogin(onSuccess: (() => void) | null): void {
  debugLog('Handling successful Monarch login');

  toast.show('Successfully connected to Monarch Money!', 'info', 3000);
  stateManager.notifyListeners('auth');

  if (typeof onSuccess === 'function') {
    try {
      onSuccess();
    } catch (error) {
      debugLog('Error in login success callback:', error);
    }
  }
}

/**
 * Check if user is currently connected to Monarch
 * @returns True if connected, false otherwise
 */
export function isMonarchConnected(): boolean {
  const token = GM_getValue(STORAGE.MONARCH_TOKEN);
  return Boolean(token);
}

/**
 * Ensure user is authenticated with Monarch before proceeding with upload
 * @param onSuccess - Callback to execute after ensuring authentication
 * @param context - Context message for the login (e.g., "upload balance history")
 * @returns True if authenticated (or becomes authenticated), false if cancelled
 */
export async function ensureMonarchAuthentication(
  onSuccess: (() => void) | null = null,
  context = 'upload data',
): Promise<boolean> {
  if (isMonarchConnected()) {
    debugLog('User already authenticated with Monarch');
    if (onSuccess) {
      onSuccess();
    }
    return true;
  }

  debugLog(`Monarch authentication required for ${context}`);
  toast.show(`Please log in to Monarch Money to ${context}`, 'info', 3000);

  return new Promise((resolve) => {
    openMonarchLoginPopup(() => {
      debugLog('Monarch authentication successful, proceeding with callback');
      if (onSuccess) {
        onSuccess();
      }
      resolve(true);
    });
  });
}

export default {
  createMonarchLoginLink,
  isMonarchConnected,
  ensureMonarchAuthentication,
};