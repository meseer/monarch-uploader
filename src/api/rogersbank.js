/**
 * Rogers Bank API client
 * Handles authentication and credential management for Rogers Bank website
 */

import { STORAGE } from '../core/config';
import { debugLog } from '../core/utils';
import stateManager from '../core/state';
import toast from '../ui/toast';

/**
 * Storage structure for Rogers Bank credentials
 */
const credentials = {
  authToken: null,
  accountId: null,
  customerId: null,
  accountIdEncoded: null,
  customerIdEncoded: null,
  deviceId: null,
  lastUpdated: null,
};

/**
 * Get Rogers Bank credentials from GM storage
 * @returns {Object} Credentials object
 */
export function getRogersBankCredentials() {
  try {
    const stored = {
      authToken: GM_getValue(STORAGE.ROGERSBANK_AUTH_TOKEN, null),
      accountId: GM_getValue(STORAGE.ROGERSBANK_ACCOUNT_ID, null),
      customerId: GM_getValue(STORAGE.ROGERSBANK_CUSTOMER_ID, null),
      accountIdEncoded: GM_getValue(STORAGE.ROGERSBANK_ACCOUNT_ID_ENCODED, null),
      customerIdEncoded: GM_getValue(STORAGE.ROGERSBANK_CUSTOMER_ID_ENCODED, null),
      deviceId: GM_getValue(STORAGE.ROGERSBANK_DEVICE_ID, null),
      lastUpdated: GM_getValue(STORAGE.ROGERSBANK_LAST_UPDATED, null),
    };

    // Update local credentials cache
    Object.assign(credentials, stored);

    debugLog('Rogers Bank credentials retrieved:', {
      hasToken: !!stored.authToken,
      hasAccountId: !!stored.accountId,
      hasCustomerId: !!stored.customerId,
      hasDeviceId: !!stored.deviceId,
      lastUpdated: stored.lastUpdated,
    });

    return stored;
  } catch (error) {
    debugLog('Error reading Rogers Bank credentials:', error);
    return credentials;
  }
}

/**
 * Save Rogers Bank credentials to GM storage
 * @param {Object} newCredentials - Credentials to save
 */
function saveRogersBankCredentials(newCredentials) {
  try {
    const timestamp = new Date().toISOString();

    // Update local cache
    Object.assign(credentials, newCredentials, { lastUpdated: timestamp });

    // Save to GM storage
    if (newCredentials.authToken !== undefined) {
      GM_setValue(STORAGE.ROGERSBANK_AUTH_TOKEN, newCredentials.authToken);
    }
    if (newCredentials.accountId !== undefined) {
      GM_setValue(STORAGE.ROGERSBANK_ACCOUNT_ID, newCredentials.accountId);
    }
    if (newCredentials.customerId !== undefined) {
      GM_setValue(STORAGE.ROGERSBANK_CUSTOMER_ID, newCredentials.customerId);
    }
    if (newCredentials.accountIdEncoded !== undefined) {
      GM_setValue(STORAGE.ROGERSBANK_ACCOUNT_ID_ENCODED, newCredentials.accountIdEncoded);
    }
    if (newCredentials.customerIdEncoded !== undefined) {
      GM_setValue(STORAGE.ROGERSBANK_CUSTOMER_ID_ENCODED, newCredentials.customerIdEncoded);
    }
    if (newCredentials.deviceId !== undefined) {
      GM_setValue(STORAGE.ROGERSBANK_DEVICE_ID, newCredentials.deviceId);
    }
    GM_setValue(STORAGE.ROGERSBANK_LAST_UPDATED, timestamp);

    // Update state manager
    stateManager.setRogersBankAuth(credentials);

    debugLog('Rogers Bank credentials saved:', {
      ...newCredentials,
      timestamp,
    });
  } catch (error) {
    debugLog('Error saving Rogers Bank credentials:', error);
  }
}

// Track the last authentication status to avoid duplicate logging
let lastAuthStatus = null;

/**
 * Check Rogers Bank authentication status
 * @returns {Object} Authentication status object
 */
export function checkRogersBankAuth() {
  const creds = getRogersBankCredentials();

  // Check if we have all required credentials
  const hasAllCredentials = !!(
    creds.authToken
    && creds.accountId
    && creds.customerId
    && creds.deviceId
  );

  const currentStatus = hasAllCredentials ? 'connected' : 'not_connected';

  // Only log if status changed
  if (lastAuthStatus !== currentStatus) {
    if (hasAllCredentials) {
      debugLog('Rogers Bank authentication: Connected');
    } else {
      debugLog('Rogers Bank authentication: Not connected (missing credentials)');
    }
    lastAuthStatus = currentStatus;
  }

  return {
    authenticated: hasAllCredentials,
    credentials: creds,
    source: hasAllCredentials ? 'intercepted' : null,
  };
}

/**
 * Check credential status and update state
 * @returns {Object|null} Credential info if valid
 */
export function checkCredentialStatus() {
  const authStatus = checkRogersBankAuth();

  // Update state manager
  stateManager.setRogersBankAuth(authStatus.authenticated ? authStatus.credentials : null);

  return authStatus.authenticated ? authStatus : null;
}

/**
 * Setup request interception to capture Rogers Bank credentials
 */
export function setupCredentialInterception() {
  debugLog('Setting up Rogers Bank credential interception...');

  // Store original XMLHttpRequest methods
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;
  const originalXHRSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

  // WeakMap to store request data for each XHR instance
  const requestDataMap = new WeakMap();

  // Override setRequestHeader to capture headers
  XMLHttpRequest.prototype.setRequestHeader = function setRequestHeaderWrapper(header, value) {
    // Get or create request data for this XHR instance
    let requestData = requestDataMap.get(this);
    if (!requestData) {
      requestData = { headers: {}, url: null };
      requestDataMap.set(this, requestData);
    }

    // Store the header
    requestData.headers[header.toLowerCase()] = value;

    // Call original method
    return originalXHRSetRequestHeader.call(this, header, value);
  };

  // Override open to capture URL
  XMLHttpRequest.prototype.open = function openWrapper(method, url, ...args) {
    // Get or create request data for this XHR instance
    let requestData = requestDataMap.get(this);
    if (!requestData) {
      requestData = { headers: {}, url: null };
      requestDataMap.set(this, requestData);
    }

    // Store the URL
    requestData.url = url;
    requestData.method = method;

    // Call original method
    return originalXHROpen.call(this, method, url, ...args);
  };

  // Override send to process the complete request
  XMLHttpRequest.prototype.send = function sendWrapper(body) {
    const requestData = requestDataMap.get(this);

    if (requestData && requestData.url) {
      const { url } = requestData;
      const { headers } = requestData;

      // Check if this is a Rogers Bank API call
      if (url.includes('selfserve.apis.rogersbank.com')) {
        debugLog('Rogers Bank API call intercepted:', { url, headers });

        // Parse transaction API URL for account and customer IDs
        const transactionMatch = url.match(/\/account\/([^/]+)\/customer\/([^/]+)\/transactions/);
        if (transactionMatch) {
          const [, accountId, customerId] = transactionMatch;

          debugLog('Captured transaction API credentials:', {
            accountId,
            customerId,
          });

          // Get encoded versions from headers
          const accountIdEncoded = headers.accountid || null;
          const customerIdEncoded = headers.customerid || null;
          const deviceId = headers.deviceid || null;
          const authToken = headers.authorization || null;

          // Save all captured credentials
          saveRogersBankCredentials({
            accountId,
            customerId,
            accountIdEncoded,
            customerIdEncoded,
            deviceId,
            authToken,
          });

          toast.show('Rogers Bank credentials captured', 'success', 2000);
        }

        // Handle token regeneration responses
        if (url.includes('/v1/authenticate/regeneratetoken/')) {
          // Listen for the response to capture new token
          this.addEventListener('load', function handleTokenRegeneration() {
            try {
              // Get the Accesstoken from response headers
              const newToken = this.getResponseHeader('Accesstoken');
              if (newToken) {
                debugLog('Captured new Rogers Bank token from regeneratetoken API');

                // Update only the auth token, keep other credentials
                const currentCreds = getRogersBankCredentials();
                saveRogersBankCredentials({
                  ...currentCreds,
                  authToken: newToken,
                });

                toast.show('Rogers Bank token refreshed', 'info', 2000);
              }
            } catch (error) {
              debugLog('Error capturing regenerated token:', error);
            }
          });
        }

        // Capture authorization header from any Rogers Bank API call if we don't have it yet
        if (headers.authorization && !credentials.authToken) {
          debugLog('Captured Rogers Bank authorization token from request header');
          saveRogersBankCredentials({ authToken: headers.authorization });
        }
      }
    }

    // Call original send method
    return originalXHRSend.call(this, body);
  };

  // Also intercept fetch API
  const originalFetch = window.fetch;
  window.fetch = async function fetchWrapper(url, options = {}) {
    // Check if this is a Rogers Bank API call
    if (typeof url === 'string' && url.includes('selfserve.apis.rogersbank.com')) {
      debugLog('Rogers Bank fetch API call intercepted:', { url, headers: options.headers });

      // Parse transaction API URL
      const transactionMatch = url.match(/\/account\/([^/]+)\/customer\/([^/]+)\/transactions/);
      if (transactionMatch) {
        const [, accountId, customerId] = transactionMatch;

        debugLog('Captured transaction API credentials from fetch:', {
          accountId,
          customerId,
        });

        // Get headers if they exist
        const headers = options.headers || {};
        const headersObj = {};

        // Convert Headers object to plain object if necessary
        if (headers instanceof Headers) {
          headers.forEach((value, key) => {
            headersObj[key.toLowerCase()] = value;
          });
        } else {
          Object.keys(headers).forEach((key) => {
            headersObj[key.toLowerCase()] = headers[key];
          });
        }

        // Save captured credentials
        saveRogersBankCredentials({
          accountId,
          customerId,
          accountIdEncoded: headersObj.accountid || null,
          customerIdEncoded: headersObj.customerid || null,
          deviceId: headersObj.deviceid || null,
          authToken: headersObj.authorization || null,
        });

        toast.show('Rogers Bank credentials captured (fetch)', 'success', 2000);
      }

      // Handle token regeneration
      if (url.includes('/v1/authenticate/regeneratetoken/')) {
        try {
          const response = await originalFetch.call(this, url, options);

          // Clone response to read headers without consuming the body
          const clonedResponse = response.clone();
          const newToken = clonedResponse.headers.get('Accesstoken');

          if (newToken) {
            debugLog('Captured new Rogers Bank token from regeneratetoken fetch API');

            const currentCreds = getRogersBankCredentials();
            saveRogersBankCredentials({
              ...currentCreds,
              authToken: newToken,
            });

            toast.show('Rogers Bank token refreshed (fetch)', 'info', 2000);
          }

          return response;
        } catch (error) {
          debugLog('Error in fetch interception:', error);
          throw error;
        }
      }
    }

    // Call original fetch
    return originalFetch.call(this, url, options);
  };

  debugLog('Rogers Bank credential interception setup complete');

  // Check initial status once during setup
  checkCredentialStatus();
}

/**
 * Clear all Rogers Bank credentials
 */
export function clearRogersBankCredentials() {
  debugLog('Clearing Rogers Bank credentials...');

  // Clear from GM storage
  GM_deleteValue(STORAGE.ROGERSBANK_AUTH_TOKEN);
  GM_deleteValue(STORAGE.ROGERSBANK_ACCOUNT_ID);
  GM_deleteValue(STORAGE.ROGERSBANK_CUSTOMER_ID);
  GM_deleteValue(STORAGE.ROGERSBANK_ACCOUNT_ID_ENCODED);
  GM_deleteValue(STORAGE.ROGERSBANK_CUSTOMER_ID_ENCODED);
  GM_deleteValue(STORAGE.ROGERSBANK_DEVICE_ID);
  GM_deleteValue(STORAGE.ROGERSBANK_LAST_UPDATED);

  // Clear local cache
  Object.keys(credentials).forEach((key) => {
    credentials[key] = null;
  });

  // Update state manager
  stateManager.setRogersBankAuth(null);

  debugLog('Rogers Bank credentials cleared');
  toast.show('Rogers Bank credentials cleared', 'info');
}

// Export as default object
export default {
  getRogersBankCredentials,
  checkRogersBankAuth,
  checkCredentialStatus,
  setupCredentialInterception,
  clearRogersBankCredentials,
};
