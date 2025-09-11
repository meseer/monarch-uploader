/**
 * Toast notification system
 * Displays temporary popup messages for user feedback
 */

import { UI } from '../core/config';
import { debugLog } from '../core/utils';

let toastContainer = null;

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
 * @param {string} type - Type of toast (success, error, info, warning)
 * @param {number} duration - Duration to show toast in ms
 */
export function showToast(message, type = 'info', duration = UI.TOAST_DURATION) {
  debugLog(`Showing toast: ${message} (${type})`);
  const container = ensureToastContainer();
  const toast = document.createElement('div');

  // Set colors based on type
  const colors = {
    success: { bg: '#28a745', text: 'white' },
    error: { bg: '#dc3545', text: 'white' },
    info: { bg: '#17a2b8', text: 'white' },
    warning: { bg: '#ffc107', text: 'black' },
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
