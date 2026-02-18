/**
 * MBNA Auth Module
 *
 * Handles cookie-based session detection for MBNA.
 * Since our script runs on service.mbna.ca after the user has logged in,
 * the JSESSIONID cookie is guaranteed to be present for the session.
 * No monitoring or polling is needed — we check on demand.
 *
 * @module integrations/mbna/auth
 */

/**
 * Static cookie prefix required by MBNA API requests
 */
const COOKIE_PREFIX = 'TD-persist=SOC';

/**
 * Extract the JSESSIONID value from document.cookie
 * @returns {string|null} JSESSIONID value or null if not found
 */
function extractJsessionId() {
  try {
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const trimmed = cookie.trim();
      if (trimmed.startsWith('JSESSIONID=')) {
        const value = trimmed.substring('JSESSIONID='.length);
        return value || null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Create an auth handler for MBNA
 *
 * @returns {import('../types').IntegrationAuth} Auth handler instance
 */
export function createAuth() {
  return {
    /**
     * Check current authentication status.
     * Reads JSESSIONID from document.cookie on demand.
     * @returns {{ authenticated: boolean, jsessionId: string|null }}
     */
    checkStatus() {
      const jsessionId = extractJsessionId();
      return {
        authenticated: jsessionId !== null,
        jsessionId,
      };
    },

    /**
     * Get credentials for API calls.
     * Constructs the Cookie header value needed for MBNA API requests.
     * @returns {{ cookieHeader: string, jsessionId: string }|null} Credentials or null if not authenticated
     */
    getCredentials() {
      const jsessionId = extractJsessionId();
      if (!jsessionId) {
        return null;
      }

      return {
        jsessionId,
        cookieHeader: `${COOKIE_PREFIX}; JSESSIONID=${jsessionId}`,
      };
    },
  };
}

export default { createAuth };