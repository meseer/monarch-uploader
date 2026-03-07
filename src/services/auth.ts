/**
 * Authentication Service
 * Handles shared authentication functionality and Monarch Money authentication
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

/**
 * Get Monarch authentication token
 * @returns {string|null} Token or null if not found
 */
export function getMonarchToken(): string | null {
  const token = GM_getValue(STORAGE.MONARCH_TOKEN);

  // Update state manager
  stateManager.setMonarchAuth(token);

  return token;
}

/**
 * Check Monarch authentication status
 * @returns {Object} Auth status information
 */
export function checkMonarchAuth(): { authenticated: boolean; message: string; token?: string } {
  const token = getMonarchToken();

  if (!token) {
    return {
      authenticated: false,
      message: 'Not authenticated with Monarch Money',
    };
  }

  return {
    authenticated: true,
    message: 'Authenticated with Monarch Money',
    token,
  };
}

/**
 * Set up Monarch token capture by monitoring localStorage
 * Should be called when on Monarch's site
 */
export function setupMonarchTokenCapture(): void {
  if (window.location.hostname.includes('monarch.com')) {
    debugLog('Running on Monarch site. Setting up token capture.');

    setInterval(() => {
      try {
        const localStorageData = localStorage.getItem('persist:root');
        if (localStorageData) {
          const parsedStorage = JSON.parse(localStorageData);
          const userObj = JSON.parse(parsedStorage.user || '{}');
          const { token } = userObj;

          if (token && token !== GM_getValue(STORAGE.MONARCH_TOKEN)) {
            GM_setValue(STORAGE.MONARCH_TOKEN, token);
            stateManager.setMonarchAuth(token);
            debugLog('Successfully captured and stored new Monarch token.');
            toast.show('Monarch Money token updated', 'debug', 2000);
          }
        }
      } catch (error) {
        // Silently ignore errors
        debugLog('Error during token capture:', error);
      }
    }, 3000);
  }
}

/**
 * Save a token for Monarch
 * @param {string} token - Token to save
 */
export function saveMonarchToken(token: string): void {
  if (!token) return;

  try {
    GM_setValue(STORAGE.MONARCH_TOKEN, token);
    stateManager.setMonarchAuth(token);
    debugLog('Saved Monarch token');
  } catch (error) {
    debugLog('Error saving Monarch token:', error);
    throw new AuthError('Failed to save Monarch token', 'monarch');
  }
}

// Default export with all methods
export default {
  getMonarchToken,
  checkMonarchAuth,
  setupMonarchTokenCapture,
  saveMonarchToken,
  AuthError,
};
