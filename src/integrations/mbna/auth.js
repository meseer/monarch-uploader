/**
 * MBNA Auth Module
 *
 * Handles cookie-based session detection for MBNA.
 * The MBNA site sets session cookies upon login; this module monitors
 * for their presence and reports authentication status.
 *
 * Uses injected storage adapter — no direct GM_* calls.
 *
 * @module integrations/mbna/auth
 */

import manifest from './manifest';

/**
 * Create an auth handler for MBNA
 *
 * @param {import('../../core/storageAdapter').StorageAdapter} storage - Injected storage adapter
 * @returns {import('../types').IntegrationAuth} Auth handler instance
 */
export function createAuth(storage) {
  let monitoringIntervalId = null;

  /**
   * Parse MBNA session cookies to determine if user is authenticated.
   * Implementation will be completed in Milestone 3 when API specs are provided.
   *
   * @returns {Object|null} Parsed session data or null if not authenticated
   */
  function parseSessionCookies() {
    // TODO: Milestone 3 — implement actual cookie parsing
    // MBNA sets session cookies upon login that we need to detect
    try {
      const cookies = document.cookie.split(';');
      // Placeholder: check for presence of session-related cookies
      const hasSession = cookies.some((c) => c.trim().startsWith('JSESSIONID='));

      if (!hasSession) {
        return null;
      }

      return {
        sessionActive: true,
        lastChecked: new Date().toISOString(),
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Save auth state to storage
   * @param {Object|null} authData - Auth data to save, or null to clear
   */
  function saveAuthState(authData) {
    const configKey = manifest.storageKeys.config;
    const stored = JSON.parse(storage.get(configKey, '{}'));

    if (authData) {
      stored.auth = { ...(stored.auth || {}), ...authData };
    } else {
      delete stored.auth;
    }

    storage.set(configKey, JSON.stringify(stored));
  }

  /**
   * Get stored auth state
   * @returns {Object} Auth data (empty object if not found)
   */
  function getStoredAuth() {
    const configKey = manifest.storageKeys.config;
    try {
      const stored = JSON.parse(storage.get(configKey, '{}'));
      return stored.auth || {};
    } catch {
      return {};
    }
  }

  return {
    /**
     * Start monitoring for MBNA session cookies.
     * Uses polling since cookies change without triggering events.
     */
    setupMonitoring() {
      // Check immediately
      const sessionData = parseSessionCookies();
      if (sessionData) {
        saveAuthState(sessionData);
      }

      // Poll for cookie changes
      if (!monitoringIntervalId) {
        monitoringIntervalId = setInterval(() => {
          const data = parseSessionCookies();
          if (data) {
            saveAuthState(data);
          }
        }, 5000); // Check every 5 seconds
      }
    },

    /**
     * Check current authentication status.
     * @returns {Object} Auth status with authenticated flag
     */
    checkStatus() {
      const sessionData = parseSessionCookies();
      const storedAuth = getStoredAuth();

      if (sessionData) {
        return {
          authenticated: true,
          accountNumber: storedAuth.accountNumber || null,
          lastChecked: sessionData.lastChecked,
        };
      }

      return {
        authenticated: false,
        accountNumber: null,
        lastChecked: null,
      };
    },

    /**
     * Get current credentials for API calls.
     * For MBNA, cookies are sent automatically by the browser,
     * so this primarily returns stored account context.
     * @returns {Object|null} Credentials or null if not authenticated
     */
    getCredentials() {
      const status = this.checkStatus();
      if (!status.authenticated) {
        return null;
      }

      const storedAuth = getStoredAuth();
      return {
        accountNumber: storedAuth.accountNumber || null,
        sessionActive: true,
      };
    },

    /**
     * Clear stored credentials.
     */
    clearCredentials() {
      saveAuthState(null);

      if (monitoringIntervalId) {
        clearInterval(monitoringIntervalId);
        monitoringIntervalId = null;
      }
    },

    /**
     * Polling interval for auth checks (ms).
     * MBNA uses cookie-based auth that requires polling.
     */
    pollingInterval: 5000,
  };
}

export default { createAuth };