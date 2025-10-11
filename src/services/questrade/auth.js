/**
 * Questrade Authentication Service
 * Handles Questrade-specific authentication functionality
 */

import { debugLog } from '../../core/utils';
import stateManager from '../../core/state';

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
 * Save a token for Questrade (for testing or specific scenarios)
 * @param {string|Object} token - Token to save
 */
export function saveQuestradeToken(token) {
  if (!token) return;

  try {
    // For Questrade, we don't directly save tokens as they're managed by the platform
    // This is just for testing or specific scenarios
    questradeTokenCache = token;
    questradeTokenTimestamp = Date.now();
    stateManager.setQuestradeAuth(token);
    debugLog('Updated Questrade token cache');
  } catch (error) {
    debugLog('Error saving Questrade token:', error);
    throw new AuthError('Failed to save Questrade token', 'questrade');
  }
}

// Default export with all methods
export default {
  getQuestradeToken,
  checkQuestradeAuth,
  questradeTokenNeedsRefresh,
  saveQuestradeToken,
  AuthError,
};
