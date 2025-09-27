/**
 * Toast notification system
 * Displays temporary popup messages for user feedback
 */

import { UI } from '../core/config';
import { debugLog } from '../core/utils';

let toastContainer = null;

/**
 * Determines if a toast should be shown based on current log level
 * @param {string} type - Type of toast (debug, info, warning, error)
 * @returns {boolean} Whether the toast should be shown
 */
function shouldShowToast(type) {
  const currentLogLevel = GM_getValue('debug_log_level', 'info');
  const logLevels = {
    debug: 0, info: 1, warning: 2, error: 3,
  };

  // Get current log level value
  const currentLevel = logLevels[currentLogLevel] ?? 1;

  // Toast types now directly align with log levels
  const toastLevels = {
    debug: 0, // Show at debug level (0)
    info: 1, // Show at info level (1) and below
    warning: 2, // Show at warning level (2) and below
    error: 3, // Show at error level (3) and below
  };

  const toastLevel = toastLevels[type] ?? 1;

  // Show toast if its level is >= current log level
  // E.g., at info level (1): show info (1), warning (2), and error (3) toasts
  // but not debug (0) toasts
  return toastLevel >= currentLevel;
}

/**
 * Ensures the toast container exists in the DOM
 * @returns {HTMLElement} Toast container element
 */
export function ensureToastContainer() {
  if (!toastContainer || !document.body.contains(toastContainer)) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'balance-uploader-toast-container';
    toastContainer.style.cssText = 'position: fixed; top: 20px; right: 20px; z-index: 10001; display: flex; flex-direction: column; gap: 10px;';
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

/**
 * Shows a toast notification
 * @param {string} message - Message to display
 * @param {string} type - Type of toast (debug, info, warning, error)
 * @param {number} duration - Duration to show toast in ms
 */
export function showToast(message, type = 'info', duration = UI.TOAST_DURATION) {
  // Check if toast should be shown based on log level
  if (!shouldShowToast(type)) {
    debugLog(`Toast suppressed (log level): ${message} (${type})`);
    return null;
  }

  debugLog(`Showing toast: ${message} (${type})`);
  const container = ensureToastContainer();
  const toast = document.createElement('div');

  // Set colors based on type
  const colors = {
    debug: { bg: '#6c757d', text: 'white' }, // Gray for debug messages
    info: { bg: '#28a745', text: 'white' }, // Green for info messages (previously success color)
    warning: { bg: '#ffc107', text: 'black' }, // Yellow for warnings
    error: { bg: '#dc3545', text: 'white' }, // Red for errors
  };

  const color = colors[type] || colors.info;

  toast.style.cssText = `
    background-color: ${color.bg};
    color: ${color.text};
    padding: 12px 20px;
    border-radius: 5px;
    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
    max-width: 400px;
    word-wrap: break-word;
    font-size: 14px;
    animation: slideIn 0.3s ease-out;
    cursor: pointer;
  `;

  toast.textContent = message;
  toast.title = 'Click to dismiss';

  // Add animation styles if not already present
  if (!document.getElementById('balance-uploader-animations')) {
    const style = document.createElement('style');
    style.id = 'balance-uploader-animations';
    style.textContent = `
      @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
      @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
      }
    `;
    document.head.appendChild(style);
  }

  // Click to dismiss
  toast.onclick = () => removeToast(toast);

  container.appendChild(toast);

  // Auto dismiss after duration
  if (duration > 0) {
    setTimeout(() => removeToast(toast), duration);
  }

  return toast;
}

/**
 * Removes a toast element with animation
 * @param {HTMLElement} toastElement - Toast element to remove
 */
function removeToast(toastElement) {
  if (toastElement && toastElement.parentNode) {
    toastElement.style.animation = 'slideOut 0.3s ease-in';
    setTimeout(() => {
      if (toastElement.parentNode) {
        toastElement.remove();
      }
    }, 300);
  }
}

// Default export with toast functions
export default {
  show: showToast,
  ensureContainer: ensureToastContainer,
  remove: removeToast,
};

// Export individual functions for backward compatibility
export { showToast as show };
