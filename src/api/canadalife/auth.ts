/**
 * Canada Life authentication.
 *
 * The member portal is a Salesforce Experience Cloud (Aura) site. Its session
 * token lives in localStorage under
 * `$AuraClientService.token$siteforce:communityApp` and is sent as the
 * `aura.token` form field on every request.
 *
 * @module api/canadalife/auth
 */

import { STORAGE } from '../../core/config';
import { debugLog } from '../../core/utils';
import stateManager from '../../core/state';
import type { CanadaLifeAuthStatus } from './types';

/**
 * Get the Canada Life Aura token from localStorage.
 * @returns Token string, or null if absent/blank/unreadable
 */
export function getCanadaLifeToken(): string | null {
  try {
    const token = localStorage.getItem(STORAGE.CANADALIFE_TOKEN_KEY);
    if (token && token.trim() !== '') {
      debugLog('CanadaLife token found in localStorage');
      return token;
    }
    debugLog('No CanadaLife token found in localStorage');
    return null;
  } catch (error) {
    debugLog('Error reading CanadaLife token from localStorage:', error);
    return null;
  }
}

/**
 * Check Canada Life authentication status.
 * @returns Authentication status object
 */
export function checkCanadaLifeAuth(): CanadaLifeAuthStatus {
  const token = getCanadaLifeToken();

  if (token) {
    debugLog('CanadaLife authentication: Connected');
    return {
      authenticated: true,
      token,
      source: 'localStorage',
    };
  }

  debugLog('CanadaLife authentication: Not connected');
  return {
    authenticated: false,
    token: null,
    source: null,
  };
}

/**
 * Check token status and push it into the shared state manager.
 * @returns Token info if valid, otherwise null
 */
export function checkTokenStatus(): CanadaLifeAuthStatus | null {
  const authStatus = checkCanadaLifeAuth();

  stateManager.setCanadaLifeAuth(authStatus.authenticated ? authStatus.token : null);

  return authStatus.authenticated ? authStatus : null;
}

/**
 * Monitor localStorage for Canada Life token changes (login/logout).
 *
 * Polls every 5 seconds because `storage` events do not fire for same-tab
 * writes, and Salesforce rotates the token in-page without a reload.
 */
export function setupTokenMonitoring(): void {
  checkTokenStatus();

  setInterval(() => {
    checkTokenStatus();
  }, 5000);

  window.addEventListener('storage', (event: StorageEvent) => {
    if (event.key === STORAGE.CANADALIFE_TOKEN_KEY) {
      debugLog('CanadaLife token changed via storage event');
      checkTokenStatus();
    }
  });

  debugLog('CanadaLife token monitoring setup complete');
}

/**
 * Extract all cookies for the current document, for use as a request header.
 * @returns Cookie string, or empty string if inaccessible
 */
export function extractCookies(): string {
  try {
    return document.cookie;
  } catch (error) {
    debugLog('Error extracting cookies:', error);
    return '';
  }
}

/**
 * Re-read the token from localStorage and update state if it changed.
 * @param currentToken - Token used by the request that just failed
 * @returns The new token if different from `currentToken`, otherwise null
 */
export function attemptTokenRefresh(currentToken: string): string | null {
  try {
    const freshToken = getCanadaLifeToken();

    if (!freshToken || freshToken === currentToken) {
      debugLog('Token refresh: No new token available or same as current');
      return null;
    }

    debugLog('Token refresh: Found updated token, updating state');
    stateManager.setCanadaLifeAuth(freshToken);

    return freshToken;
  } catch (error) {
    debugLog('Error during token refresh attempt:', error);
    return null;
  }
}