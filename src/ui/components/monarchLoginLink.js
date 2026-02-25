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
 * @param {string} text - The text to display for the link
 * @param {Function} onSuccess - Callback function to execute after successful login
 * @returns {HTMLElement} Clickable link element
 */
export function createMonarchLoginLink(text = 'Monarch: Connect', onSuccess = null) {
  const link = document.createElement('span');
  link.textContent = text;
  link.style.cssText = `
    color: #dc3545;
    cursor: pointer;
    text-decoration: underline;
    transition: color 0.2s;
  `;

  // Add hover effect
  link.addEventListener('mouseenter', () => {
    link.style.color = '#a71e2a';
  });

  link.addEventListener('mouseleave', () => {
    link.style.color = '#dc3545';
  });

  // Add click handler to open login popup
  link.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    openMonarchLoginPopup(onSuccess);
  });

  return link;
}

/**
 * Open Monarch login in a popup window and monitor for successful authentication
 * @param {Function} onSuccess - Callback function to execute after successful login
 */
function openMonarchLoginPopup(onSuccess = null) {
  try {
    debugLog('Opening Monarch login popup...');

    // Calculate popup dimensions and position
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

    // MIGRATION: Open popup window using dynamic domain
    const popup = window.open(
      `${API.MONARCH_APP_URL}/dashboard`,
      'monarchLogin',
      popupFeatures,
    );

    if (!popup) {
      toast.show('Popup blocked. Please allow popups for this site and try again.', 'error', 5000);
      return;
    }

    // Show loading toast
    toast.show('Opening Monarch Money login...', 'info', 2000);

    // Monitor popup for successful login
    monitorPopupForLogin(popup, onSuccess);
  } catch (error) {
    debugLog('Error opening Monarch login popup:', error);
    toast.show('Failed to open login popup', 'error');
  }
}

/**
 * Monitor popup window for successful authentication
 * @param {Window} popup - The popup window reference
 * @param {Function} onSuccess - Callback function to execute after successful login
 */
function monitorPopupForLogin(popup, onSuccess) {
  let checkInterval;
  let timeoutId;
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
      // Check if popup is closed
      if (popup.closed) {
        debugLog('Monarch login popup was closed');
        cleanup();

        // Check for token one final time in case it was set just before closing
        const token = GM_getValue(STORAGE.MONARCH_TOKEN);
        if (token) {
          handleSuccessfulLogin(onSuccess);
        }
        return;
      }

      // Check if token is now available
      const token = GM_getValue(STORAGE.MONARCH_TOKEN);
      if (token) {
        debugLog('Monarch token detected, login successful');
        cleanup();

        // Close popup
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

    // Try to close popup
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
 * @param {Function} onSuccess - Callback function to execute after successful login
 */
function handleSuccessfulLogin(onSuccess) {
  debugLog('Handling successful Monarch login');

  // Show success message
  toast.show('Successfully connected to Monarch Money!', 'info', 3000);

  // Trigger auth state change to update UI
  stateManager.notifyListeners('auth');

  // Call success callback if provided
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
 * @returns {boolean} True if connected, false otherwise
 */
export function isMonarchConnected() {
  const token = GM_getValue(STORAGE.MONARCH_TOKEN);
  return Boolean(token);
}

/**
 * Ensure user is authenticated with Monarch before proceeding with upload
 * @param {Function} onSuccess - Callback to execute after ensuring authentication
 * @param {string} context - Context message for the login (e.g., "upload balance history")
 * @returns {Promise<boolean>} True if authenticated (or becomes authenticated), false if cancelled
 */
export async function ensureMonarchAuthentication(onSuccess = null, context = 'upload data') {
  // Check if already connected
  if (isMonarchConnected()) {
    debugLog('User already authenticated with Monarch');
    if (onSuccess) {
      onSuccess();
    }
    return true;
  }

  // Not connected - show authentication required message and open login
  debugLog(`Monarch authentication required for ${context}`);
  toast.show(`Please log in to Monarch Money to ${context}`, 'info', 3000);

  return new Promise((resolve) => {
    // Open login popup with success callback
    openMonarchLoginPopup(() => {
      debugLog('Monarch authentication successful, proceeding with callback');
      if (onSuccess) {
        onSuccess();
      }
      resolve(true);
    });

    // Note: We don't have a way to detect if user cancelled the popup
    // The popup monitoring will handle timeout scenarios
    // For now, we assume if the popup closes without token, user cancelled
  });
}

export default {
  createMonarchLoginLink,
  isMonarchConnected,
  ensureMonarchAuthentication,
};
