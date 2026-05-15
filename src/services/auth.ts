/**
 * Authentication Service
 * Handles Monarch Money session-based authentication via cookies.
 *
 * Monarch uses session cookies for authentication:
 * - `csrftoken` cookie (readable via document.cookie) — also sent as `x-csrftoken` header
 * - `session_id` cookie (HttpOnly, not readable via JS) — sent automatically by the browser/extension
 * - `session_expires_at` from localStorage `persist:root` → user object
 *
 * The csrftoken is captured on app.monarch.com and stored via GM_setValue for cross-domain use.
 * The session_id is automatically sent by GM_xmlhttpRequest (extension-level cookie jar).
 */

import { debugLog } from '../core/utils';
import { STORAGE } from '../core/config';
import stateManager from '../core/state';
import toast from '../ui/toast';

/**
 * Custom authentication error class
 */
export class AuthError extends Error {
  provider: string;

  constructor(message: string, provider: string) {
    super(message);
    this.name = 'AuthError';
    this.provider = provider;
  }
}

/** Shape of Monarch credentials stored and used for API calls */
export interface MonarchCredentials {
  csrfToken: string;
  sessionExpiresAt: string | null;
}

/**
 * Parse a specific cookie value from a cookie string
 * @param cookieString - The document.cookie string
 * @param name - Cookie name to extract
 * @returns Cookie value or null
 */
function parseCookie(cookieString: string, name: string): string | null {
  const match = cookieString.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? match[1] : null;
}

/**
 * Read session_expires_at from localStorage persist:root → user object
 * @returns ISO date string or null
 */
function readSessionExpiresAt(): string | null {
  try {
    const persistRoot = localStorage.getItem('persist:root');
    if (!persistRoot) return null;

    const parsed = JSON.parse(persistRoot);
    const userObj = JSON.parse(parsed.user || '{}');
    return userObj.session_expires_at || null;
  } catch {
    debugLog('Error reading session_expires_at from persist:root');
    return null;
  }
}

/**
 * Check if the stored session has expired
 * @param expiresAt - ISO date string of session expiry
 * @returns true if expired or missing
 */
export function isSessionExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return true;

  try {
    const expiryDate = new Date(expiresAt);
    if (isNaN(expiryDate.getTime())) return true;
    // Add 60-second buffer to avoid edge-case failures
    return Date.now() >= expiryDate.getTime() - 60000;
  } catch {
    return true;
  }
}

/**
 * Get stored Monarch credentials from GM storage
 * @returns Credentials object or null if not available
 */
export function getMonarchCredentials(): MonarchCredentials | null {
  const csrfToken = GM_getValue(STORAGE.MONARCH_CSRF_TOKEN) as string | undefined;
  const sessionExpiresAt = GM_getValue(STORAGE.MONARCH_SESSION_EXPIRES_AT) as string | undefined;

  if (!csrfToken) {
    return null;
  }

  return {
    csrfToken,
    sessionExpiresAt: sessionExpiresAt || null,
  };
}

/**
 * Check Monarch authentication status.
 * Reads stored credentials and checks expiry.
 * @returns Auth status information
 */
export function checkMonarchAuth(): {
  authenticated: boolean;
  message: string;
  credentials?: MonarchCredentials;
  } {
  const credentials = getMonarchCredentials();

  if (!credentials) {
    stateManager.setMonarchAuth(null);
    return {
      authenticated: false,
      message: 'Not authenticated with Monarch Money. Open Monarch in another tab to capture credentials.',
    };
  }

  if (isSessionExpired(credentials.sessionExpiresAt)) {
    stateManager.setMonarchAuth({
      csrfToken: credentials.csrfToken,
      sessionExpiresAt: credentials.sessionExpiresAt,
    });
    return {
      authenticated: false,
      message: 'Monarch session expired. Please open Monarch Money in another tab to refresh.',
    };
  }

  stateManager.setMonarchAuth({
    csrfToken: credentials.csrfToken,
    sessionExpiresAt: credentials.sessionExpiresAt,
  });

  return {
    authenticated: true,
    message: 'Authenticated with Monarch Money',
    credentials,
  };
}

/**
 * Set up Monarch credential capture by monitoring cookies on the Monarch site.
 * Reads csrftoken from document.cookie and session_expires_at from localStorage.
 * Should be called when running on app.monarch.com.
 */
function setupMonarchTokenCapture(): void {
  if (!window.location.hostname.includes('monarch.com')) return;

  debugLog('Running on Monarch site. Setting up session credential capture.');

  // Capture immediately on load
  captureMonarchCredentials();

  // Re-capture periodically (cookies/session may refresh)
  setInterval(() => {
    captureMonarchCredentials();
  }, 5000);
}

/**
 * Read current Monarch credentials from cookies/localStorage and persist them.
 * Called on the Monarch domain where cookies are accessible.
 */
function captureMonarchCredentials(): void {
  try {
    const csrfToken = parseCookie(document.cookie, 'csrftoken');
    const sessionExpiresAt = readSessionExpiresAt();

    if (!csrfToken) {
      debugLog('csrftoken cookie not found on Monarch domain');
      return;
    }

    const storedCsrf = GM_getValue(STORAGE.MONARCH_CSRF_TOKEN) as string | undefined;
    const storedExpiry = GM_getValue(STORAGE.MONARCH_SESSION_EXPIRES_AT) as string | undefined;

    const csrfChanged = csrfToken !== storedCsrf;
    const expiryChanged = sessionExpiresAt !== storedExpiry;

    if (csrfChanged || expiryChanged) {
      GM_setValue(STORAGE.MONARCH_CSRF_TOKEN, csrfToken);
      if (sessionExpiresAt) {
        GM_setValue(STORAGE.MONARCH_SESSION_EXPIRES_AT, sessionExpiresAt);
      }

      stateManager.setMonarchAuth({
        csrfToken,
        sessionExpiresAt: sessionExpiresAt || null,
      });

      debugLog('Monarch session credentials captured successfully.');
      if (csrfChanged) {
        toast.show('Monarch Money credentials updated', 'debug', 2000);
      }
    }
  } catch (error) {
    debugLog('Error during Monarch credential capture:', error);
  }
}

/**
 * Save Monarch credentials to persistent storage
 * @param csrfToken - CSRF token value
 * @param sessionExpiresAt - Session expiry ISO date string (optional)
 */
function saveMonarchCredentials(csrfToken: string, sessionExpiresAt?: string | null): void {
  if (!csrfToken) return;

  try {
    GM_setValue(STORAGE.MONARCH_CSRF_TOKEN, csrfToken);
    if (sessionExpiresAt) {
      GM_setValue(STORAGE.MONARCH_SESSION_EXPIRES_AT, sessionExpiresAt);
    }
    stateManager.setMonarchAuth({
      csrfToken,
      sessionExpiresAt: sessionExpiresAt || null,
    });
    debugLog('Saved Monarch credentials');
  } catch (error) {
    debugLog('Error saving Monarch credentials:', error);
    throw new AuthError('Failed to save Monarch credentials', 'monarch');
  }
}

/**
 * Clear stored Monarch credentials (e.g., on 401 response)
 */
export function clearMonarchCredentials(): void {
  GM_setValue(STORAGE.MONARCH_CSRF_TOKEN, '');
  GM_setValue(STORAGE.MONARCH_SESSION_EXPIRES_AT, '');
  stateManager.setMonarchAuth(null);
  debugLog('Monarch credentials cleared');
}

// Default export with all methods
export default {
  getMonarchCredentials,
  checkMonarchAuth,
  setupMonarchTokenCapture,
  saveMonarchCredentials,
  clearMonarchCredentials,
  isSessionExpired,
  AuthError,
};