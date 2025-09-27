/**
 * Authentication Service
 * Handles authentication-related functionality for Questrade and Monarch Money
 */

import { debugLog } from '../core/utils';
import { STORAGE } from '../core/config';
import stateManager from '../core/state';
import toast from '../ui/toast';

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

// Token cache to avoid repeated storage lookups
let questradeTokenCache = null;
let questradeTokenTimestamp = 0;
const TOKEN_CACHE_DURATION = 5000; // 5 seconds

/**
 * Get Questrade authentication token from sessionStorage
 * @returns {Object|null} Token info or null if not found
 */
export function getQuestradeToken() {
  // Check if we have a recent cached token
  if (questradeTokenCache && (Date.now() - questradeTokenTimestamp < TOKEN_CACHE_DURATION)) {
    return questradeTokenCache;
  }

  const requiredPermissions = [
    'brokerage.balances.all',
    'brokerage.account-transactions.read',
    'brokerage.accounts.read',
  ];

  let latestValidToken = null;

  for (let i = 0; i < sessionStorage.length; i += 1) {
    const key = sessionStorage.key(i);
    if (key && key.startsWith('oidc.user:https://login.questrade.com/')) {
      try {
        const value = sessionStorage.getItem(key);
        if (value) {
          const data = JSON.parse(value);
          const scope = data.scope || '';
          const hasAllPermissions = requiredPermissions.every((permission) => scope.includes(permission));

          if (hasAllPermissions && data.access_token && data.expires_at) {
            // Check if token is not expired
            if (data.expires_at * 1000 > Date.now()) {
              if (!latestValidToken || data.expires_at > latestValidToken.expires_at) {
                latestValidToken = data;
              }
            }
          }
        }
      } catch (error) {
        debugLog('Error parsing session storage data for key:', key, error);
      }
    }
  }

  if (latestValidToken) {
    // Format the token with Bearer prefix
    const formattedToken = latestValidToken.access_token.toLowerCase().startsWith('bearer ')
      ? latestValidToken.access_token
      : `Bearer ${latestValidToken.access_token}`;

    questradeTokenCache = {
      token: formattedToken,
      expires_at: latestValidToken.expires_at,
    };
    questradeTokenTimestamp = Date.now();

    // Update state manager with the token
    stateManager.setQuestradeAuth(questradeTokenCache);

    return questradeTokenCache;
  }

  questradeTokenCache = null;
  stateManager.setQuestradeAuth(null);
  return null;
}

/**
 * Check Questrade authentication status
 * @returns {Object} Auth status information
 */
export function checkQuestradeAuth() {
  const tokenInfo = getQuestradeToken();

  if (!tokenInfo) {
    return {
      authenticated: false,
      message: 'Not authenticated with Questrade',
      expiresIn: 0,
    };
  }

  const now = Date.now();
  const expiryTime = tokenInfo.expires_at * 1000;
  const expiresIn = Math.floor((expiryTime - now) / 1000); // Seconds until expiry

  return {
    authenticated: true,
    message: 'Authenticated with Questrade',
    expiresIn,
    expiryTime,
    token: tokenInfo.token,
  };
}

/**
 * Check if Questrade token needs refresh (less than 5 minutes remaining)
 * @returns {boolean} True if token needs refresh
 */
export function questradeTokenNeedsRefresh() {
  const authStatus = checkQuestradeAuth();
  return authStatus.authenticated && authStatus.expiresIn < 300; // Less than 5 minutes
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
 * Save a token for a specific provider
 * @param {string} provider - Provider name ('questrade' or 'monarch')
 * @param {string|Object} token - Token to save
 */
export function saveToken(provider, token) {
  if (!token) return;

  try {
    if (provider.toLowerCase() === 'monarch') {
      GM_setValue(STORAGE.MONARCH_TOKEN, token);
      stateManager.setMonarchAuth(token);
      debugLog('Saved Monarch token');
    } else if (provider.toLowerCase() === 'questrade') {
      // For Questrade, we don't directly save tokens as they're managed by the platform
      // This is just for testing or specific scenarios
      questradeTokenCache = token;
      questradeTokenTimestamp = Date.now();
      stateManager.setQuestradeAuth(token);
      debugLog('Updated Questrade token cache');
    }
  } catch (error) {
    debugLog(`Error saving ${provider} token:`, error);
    throw new AuthError(`Failed to save ${provider} token`, provider);
  }
}

// Default export with all methods
export default {
  getQuestradeToken,
  checkQuestradeAuth,
  questradeTokenNeedsRefresh,
  getMonarchToken,
  checkMonarchAuth,
  setupMonarchTokenCapture,
  checkAllAuth,
  isFullyAuthenticated,
  saveToken,
  AuthError,
};
