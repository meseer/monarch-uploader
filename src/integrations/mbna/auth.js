/**
 * MBNA Auth Module
 *
 * Handles session detection for MBNA.
 *
 * MBNA uses HttpOnly JSESSIONID cookies that are NOT accessible via
 * document.cookie. However, GM_xmlhttpRequest (Tampermonkey) automatically
 * includes browser cookies for same-origin requests, so we don't need
 * to read or forward cookies manually.
 *
 * Auth status is determined by making an actual API probe call —
 * if it returns 200, we're authenticated; if 401/403, we're not.
 *
 * @module integrations/mbna/auth
 */

/**
 * Create an auth handler for MBNA
 *
 * Since MBNA uses HttpOnly cookies that can't be read from JS,
 * this module doesn't attempt to read cookies. Instead:
 * - checkStatus() always returns "assumed authenticated" (let API probe decide)
 * - getCredentials() returns a marker object (no cookie header needed)
 *
 * The actual auth validation happens when the API probe call
 * succeeds or fails with 401/403.
 *
 * @returns {import('../types').IntegrationAuth} Auth handler instance
 */
export function createAuth() {
  return {
    /**
     * Check current authentication status.
     *
     * Since JSESSIONID is HttpOnly, we can't read it from JS.
     * We assume the user is authenticated (they're on the MBNA site)
     * and let the API probe confirm or deny.
     *
     * @returns {{ authenticated: boolean }}
     */
    checkStatus() {
      // Can't read HttpOnly cookies — assume authenticated,
      // actual validation happens via API probe
      return {
        authenticated: true,
      };
    },

    /**
     * Get credentials for API calls.
     *
     * GM_xmlhttpRequest automatically sends browser cookies (including
     * HttpOnly ones) for same-origin requests. No manual Cookie header needed.
     *
     * @returns {{ autoManaged: boolean }} Always returns a truthy object
     */
    getCredentials() {
      // GM_xmlhttpRequest handles cookie forwarding automatically
      return {
        autoManaged: true,
      };
    },
  };
}

export default { createAuth };