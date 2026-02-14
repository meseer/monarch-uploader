/**
 * Rogers Bank API client
 * Handles authentication and credential management for Rogers Bank website
 */

import { STORAGE } from '../core/config';
import { debugLog } from '../core/utils';
import stateManager from '../core/state';
import toast from '../ui/toast';
import { INTEGRATIONS } from '../core/integrationCapabilities';
import { getAuth, setAuth, clearAuth as clearConfigAuth } from '../services/common/configStore';

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
    // Read from configStore only  migration completed
    const configAuth = getAuth(INTEGRATIONS.ROGERSBANK);

    // Migrate-on-read: if configStore is empty, check legacy keys and migrate
    if (!configAuth.authToken && !configAuth.accountId) {
      const legacyToken = GM_getValue(STORAGE.ROGERSBANK_AUTH_TOKEN, null);
      if (legacyToken) {
        const legacyData = {
          authToken: legacyToken,
          accountId: GM_getValue(STORAGE.ROGERSBANK_ACCOUNT_ID, null),
          customerId: GM_getValue(STORAGE.ROGERSBANK_CUSTOMER_ID, null),
          accountIdEncoded: GM_getValue(STORAGE.ROGERSBANK_ACCOUNT_ID_ENCODED, null),
          customerIdEncoded: GM_getValue(STORAGE.ROGERSBANK_CUSTOMER_ID_ENCODED, null),
          deviceId: GM_getValue(STORAGE.ROGERSBANK_DEVICE_ID, null),
          lastUpdated: GM_getValue(STORAGE.ROGERSBANK_LAST_UPDATED, null),
        };
        debugLog('getRogersBankCredentials: Migrating legacy credentials to configStore');
        setAuth(INTEGRATIONS.ROGERSBANK, legacyData);
        Object.assign(credentials, legacyData);

        debugLog('Rogers Bank credentials retrieved (migrated from legacy):', {
          hasToken: Boolean(legacyData.authToken),
          hasAccountId: Boolean(legacyData.accountId),
          hasCustomerId: Boolean(legacyData.customerId),
          hasDeviceId: Boolean(legacyData.deviceId),
          lastUpdated: legacyData.lastUpdated,
        });

        return legacyData;
      }
    }

    const stored = {
      authToken: configAuth.authToken ?? null,
      accountId: configAuth.accountId ?? null,
      customerId: configAuth.customerId ?? null,
      accountIdEncoded: configAuth.accountIdEncoded ?? null,
      customerIdEncoded: configAuth.customerIdEncoded ?? null,
      deviceId: configAuth.deviceId ?? null,
      lastUpdated: configAuth.lastUpdated ?? null,
    };

    // Update local credentials cache
    Object.assign(credentials, stored);

    debugLog('Rogers Bank credentials retrieved:', {
      hasToken: Boolean(stored.authToken),
      hasAccountId: Boolean(stored.accountId),
      hasCustomerId: Boolean(stored.customerId),
      hasDeviceId: Boolean(stored.deviceId),
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

    // Build auth data for configStore
    const authUpdate = {};
    if (newCredentials.authToken !== undefined) authUpdate.authToken = newCredentials.authToken;
    if (newCredentials.accountId !== undefined) authUpdate.accountId = newCredentials.accountId;
    if (newCredentials.customerId !== undefined) authUpdate.customerId = newCredentials.customerId;
    if (newCredentials.accountIdEncoded !== undefined) authUpdate.accountIdEncoded = newCredentials.accountIdEncoded;
    if (newCredentials.customerIdEncoded !== undefined) authUpdate.customerIdEncoded = newCredentials.customerIdEncoded;
    if (newCredentials.deviceId !== undefined) authUpdate.deviceId = newCredentials.deviceId;
    authUpdate.lastUpdated = timestamp;

    // Write to configStore only  migration completed, no dual-write
    setAuth(INTEGRATIONS.ROGERSBANK, authUpdate);

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
  const hasAllCredentials = Boolean(creds.authToken
    && creds.accountId
    && creds.customerId
    && creds.deviceId);

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

          toast.show('Rogers Bank credentials captured', 'debug', 2000);
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

                toast.show('Rogers Bank token refreshed', 'debug', 2000);
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

        toast.show('Rogers Bank credentials captured (fetch)', 'debug', 2000);
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

            toast.show('Rogers Bank token refreshed (fetch)', 'debug', 2000);
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

  // Clear from configStore only  migration completed
  clearConfigAuth(INTEGRATIONS.ROGERSBANK);

  // Clear local cache
  Object.keys(credentials).forEach((key) => {
    credentials[key] = null;
  });

  // Update state manager
  stateManager.setRogersBankAuth(null);

  debugLog('Rogers Bank credentials cleared');
  toast.show('Rogers Bank credentials cleared', 'info');
}

/**
 * Fetch account details from Rogers Bank API
 * Returns balance, credit limit, and account opened date in a single API call
 * @returns {Promise<Object>} Account details object {balance, creditLimit, openedDate}
 */
export async function fetchRogersBankAccountDetails() {
  try {
    const creds = getRogersBankCredentials();

    // Check if we have all required credentials
    if (!creds.authToken || !creds.accountId || !creds.customerId
        || !creds.accountIdEncoded || !creds.customerIdEncoded || !creds.deviceId) {
      throw new Error('Missing Rogers Bank credentials. Please navigate to your account page first.');
    }

    const url = `https://selfserve.apis.rogersbank.com/corebank/v1/account/${creds.accountId}/customer/${creds.customerId}/detail`;

    debugLog('Fetching Rogers Bank account details from:', url);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'application/json, text/plain, */*',
        accountid: creds.accountIdEncoded,
        authorization: creds.authToken,
        channel: '101',
        customerid: creds.customerIdEncoded,
        deviceid: creds.deviceId,
        isrefresh: 'false',
      },
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // Check API response status
    if (data.statusCode !== '200') {
      throw new Error(`API returned error status: ${data.statusCode}`);
    }

    // Extract current balance
    const currentBalance = data.accountDetail?.currentBalance?.value;
    if (currentBalance === undefined || currentBalance === null) {
      throw new Error('Current balance not found in API response');
    }

    // Convert balance to number
    const balanceValue = parseFloat(currentBalance);
    if (Number.isNaN(balanceValue)) {
      throw new Error('Invalid balance value received from API');
    }

    // Extract credit limit
    const creditLimitValue = data.accountDetail?.creditLimit?.value;
    let creditLimit = null;
    if (creditLimitValue !== undefined && creditLimitValue !== null) {
      creditLimit = parseFloat(creditLimitValue);
      if (Number.isNaN(creditLimit)) {
        debugLog('Warning: Invalid credit limit value, setting to null');
        creditLimit = null;
      }
    }

    // Extract account opened date (YYYY-MM-DD format expected)
    const openedDate = data.accountDetail?.openedDate || null;

    debugLog('Rogers Bank account details:', {
      balance: balanceValue,
      creditLimit,
      openedDate,
    });

    return {
      balance: balanceValue,
      creditLimit,
      openedDate,
    };
  } catch (error) {
    debugLog('Error fetching Rogers Bank account details:', error);
    throw error;
  }
}

/**
 * Fetch current account balance from Rogers Bank API
 * @deprecated Use fetchRogersBankAccountDetails() instead for better efficiency
 * @returns {Promise<number>} Current balance (as negative value for credit card)
 */
export async function fetchRogersBankBalance() {
  const details = await fetchRogersBankAccountDetails();
  return details.balance;
}

// Export as default object
export default {
  getRogersBankCredentials,
  checkRogersBankAuth,
  checkCredentialStatus,
  setupCredentialInterception,
  clearRogersBankCredentials,
  fetchRogersBankAccountDetails,
  fetchRogersBankBalance,
};
