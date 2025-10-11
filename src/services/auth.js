/**
 * Authentication Service
 * Handles shared authentication functionality and Monarch Money authentication
 */

import { debugLog } from '../core/utils';
import { STORAGE } from '../core/config';
import stateManager from '../core/state';
import toast from '../ui/toast';
import { checkQuestradeAuth } from './questrade/auth';

/**
 * Custom authentication error class
 */
export class AuthError extends Error {
  constructor(message, provider) {
    super(message);
    this.name = 'AuthError';
    this.provider = provider;
  }
}

/**
 * Get Monarch authentication token
 * @returns {string|null} Token or null if not found
 */
export function getMonarchToken() {
  const token = GM_getValue(STORAGE.MONARCH_TOKEN);

  // Update state manager
  stateManager.setMonarchAuth(token);

  return token;
}

/**
 * Check Monarch authentication status
 * @returns {Object} Auth status information
 */
export function checkMonarchAuth() {
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
export function setupMonarchTokenCapture() {
  if (window.location.hostname.includes('monarchmoney.com')) {
    debugLog('Running on Monarch Money site. Setting up token capture.');

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
 * Check authentication status for both Questrade and Monarch
 * @returns {Object} Auth status for both providers
 */
export function checkAllAuth() {
  return {
    questrade: checkQuestradeAuth(),
    monarch: checkMonarchAuth(),
  };
}

/**
 * Verify that both Questrade and Monarch auth are valid
 * @returns {boolean} True if both authenticated
 */
export function isFullyAuthenticated() {
  const status = checkAllAuth();
  return status.questrade.authenticated && status.monarch.authenticated;
}

/**
 * Save a token for Monarch
 * @param {string} token - Token to save
 */
export function saveMonarchToken(token) {
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

/**
 * Save a token for a specific provider (legacy compatibility)
 * @param {string} provider - Provider name ('monarch' only supported)
 * @param {string|Object} token - Token to save
 */
export function saveToken(provider, token) {
  if (!token) return;

  try {
    if (provider.toLowerCase() === 'monarch') {
      saveMonarchToken(token);
    } else {
      throw new AuthError(`Provider ${provider} not supported in shared auth service`, provider);
    }
  } catch (error) {
    debugLog(`Error saving ${provider} token:`, error);
    throw new AuthError(`Failed to save ${provider} token`, provider);
  }
}

// Default export with all methods
export default {
  getMonarchToken,
  checkMonarchAuth,
  setupMonarchTokenCapture,
  checkAllAuth,
  isFullyAuthenticated,
  saveToken,
  saveMonarchToken,
  AuthError,
};
