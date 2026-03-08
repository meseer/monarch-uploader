/**
 * Toast notification system
 * Provides user-facing toast notifications with different severity levels
 */

import { UI } from '../core/config';
import { debugLog } from '../core/utils';

export type ToastType = 'debug' | 'info' | 'warning' | 'error' | string;

const LOG_LEVELS: Record<string, number> = {
  debug: 0,
  info: 1,
  warning: 2,
  error: 3,
};

const TOAST_COLORS: Record<string, { bg: string; color: string }> = {
  debug: { bg: '#6c757d', color: 'white' },
  info: { bg: '#28a745', color: 'white' },
  warning: { bg: '#ffc107', color: 'black' },
  error: { bg: '#dc3545', color: 'white' },
};

let toastContainer: HTMLElement | null = null;

/**
 * Check whether a toast of the given type should be shown based on the current log level
 */
function shouldShowToast(type: string): boolean {
  const currentLevel = GM_getValue('debug_log_level', 'info') as string;
  const currentLevelNum = LOG_LEVELS[currentLevel] ?? LOG_LEVELS.info;
  const toastLevelNum = LOG_LEVELS[type] ?? LOG_LEVELS.info;
  return toastLevelNum >= currentLevelNum;
}

/**
 * Inject slideIn/slideOut animation styles into document head (once)
 */
function ensureAnimationStyles(): void {
  if (document.querySelector('#balance-uploader-animations')) return;

  const style = document.createElement('style');
  style.id = 'balance-uploader-animations';
  style.textContent = `
    @keyframes slideIn {
      from { opacity: 0; transform: translateX(100%); }
      to   { opacity: 1; transform: translateX(0); }
    }
    @keyframes slideOut {
      from { opacity: 1; transform: translateX(0); }
      to   { opacity: 0; transform: translateX(100%); }
    }
  `;
  document.head.appendChild(style);
}

/**
 * Ensure toast container exists in the DOM, creating it if necessary
 */
export function ensureToastContainer(): HTMLElement {
  if (toastContainer && document.body.contains(toastContainer)) {
    return toastContainer;
  }

  toastContainer = document.createElement('div');
  toastContainer.id = 'balance-uploader-toast-container';
  toastContainer.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 10001;
    display: flex;
    flex-direction: column;
    gap: 8px;
    pointer-events: none;
    max-width: 400px;
  `;

  document.body.appendChild(toastContainer);
  return toastContainer;
}

/**
 * Remove a toast element with slide-out animation
 */
export function removeToast(toastElement: HTMLElement): void {
  if (!toastElement || !toastElement.parentElement) return;

  toastElement.style.animation = 'slideOut 0.3s ease-in';

  setTimeout(() => {
    if (toastElement.parentNode) {
      toastElement.remove();
    }
  }, 300);
}

/**
 * Show a toast notification
 * @param message - Message to display
 * @param type - Toast type/severity
 * @param duration - Display duration in milliseconds (0 = no auto-dismiss)
 * @returns The toast element, or null if suppressed
 */
export function showToast(
  message: string,
  type: ToastType = 'info',
  duration: number = UI.TOAST_DURATION,
): HTMLElement | null {
  if (!shouldShowToast(type)) {
    debugLog(`Toast suppressed (log level): ${message} (${type})`);
    return null;
  }

  debugLog(`Showing toast: ${message} (${type})`);

  ensureAnimationStyles();
  const container = ensureToastContainer();

  const colorConfig = TOAST_COLORS[type] || TOAST_COLORS.info;

  const toast = document.createElement('div');
  toast.style.cssText = `
    padding: 12px 16px;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 500;
    line-height: 1.4;
    pointer-events: all;
    animation: slideIn 0.3s ease-out;
    word-wrap: break-word;
    cursor: pointer;
    max-width: 400px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    background-color: ${colorConfig.bg};
    color: ${colorConfig.color};
  `;

  toast.textContent = message;
  toast.title = 'Click to dismiss';

  toast.onclick = () => removeToast(toast);

  container.appendChild(toast);

  if (duration > 0) {
    setTimeout(() => removeToast(toast), duration);
  }

  return toast;
}

export { showToast as show };

export default {
  show: showToast,
  ensureContainer: ensureToastContainer,
  remove: removeToast,
};