/**
 * Rogers Bank API client
 * Captures Rogers Bank credentials from the bank page's own API requests and
 * calls the Rogers Bank API with them.
 *
 * Credentials (auth token, device ID, account/customer IDs and their encoded
 * header forms) are held in memory for the current page only. They are never
 * written to userscript (GM) storage: after a page reload they are captured
 * again from Rogers Bank's next API request.
 */

import { debugLog } from '../core/utils';
import stateManager from '../core/state';
import toast from '../ui/toast';

// ============================================================
// Interfaces
// ============================================================

export interface RogersBankCredentials {
  authToken: string | null;
  accountId: string | null;
  customerId: string | null;
  accountIdEncoded: string | null;
  customerIdEncoded: string | null;
  deviceId: string | null;
  lastUpdated: string | null;
  [key: string]: unknown;
}

export interface RogersBankAuthStatus {
  authenticated: boolean;
  credentials: RogersBankCredentials;
  source: string | null;
}

interface RogersBankAccountDetails {
  balance: number;
  creditLimit: number | null;
  openedDate: string | null;
}

// ============================================================
// State
// ============================================================

/**
 * Credentials captured on this page. In memory only — lost on page reload.
 */
const credentials: RogersBankCredentials = {
  authToken: null,
  accountId: null,
  customerId: null,
  accountIdEncoded: null,
  customerIdEncoded: null,
  deviceId: null,
  lastUpdated: null,
};

// ============================================================
// Functions
// ============================================================

/**
 * Get the Rogers Bank credentials captured on this page.
 * Reads the in-memory copy only; nothing is read from GM storage.
 * @returns A copy of the captured credentials (fields are null until captured)
 */
export function getRogersBankCredentials(): RogersBankCredentials {
  return { ...credentials };
}

/**
 * Merge newly captured credentials into the in-memory copy and notify
 * listeners so the UI can leave its "waiting for credentials" state.
 * Never persists anything.
 * @param newCredentials - Captured credential fields
 */
function updateCapturedCredentials(newCredentials: Partial<RogersBankCredentials>): void {
  Object.assign(credentials, newCredentials, { lastUpdated: new Date().toISOString() });

  debugLog('Rogers Bank credentials captured (held in memory only):', {
    fields: Object.keys(newCredentials).filter((key) => Boolean(newCredentials[key])),
  });

  // Runs inside the bank page's own XHR/fetch call: a failing listener must
  // not break that request.
  try {
    stateManager.setRogersBankAuth({ ...credentials });
  } catch (error) {
    debugLog('Error notifying listeners of captured Rogers Bank credentials:', error);
  }
}

// Track the last authentication status to avoid duplicate logging
let lastAuthStatus: string | null = null;

/**
 * Check Rogers Bank authentication status
 * @returns Authentication status object
 */
export function checkRogersBankAuth(): RogersBankAuthStatus {
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
 * @returns Credential info if valid
 */
export function checkCredentialStatus(): RogersBankAuthStatus | null {
  const authStatus = checkRogersBankAuth();

  // Update state manager
  stateManager.setRogersBankAuth(authStatus.authenticated ? authStatus.credentials : null);

  return authStatus.authenticated ? authStatus : null;
}

/**
 * Setup request interception to capture Rogers Bank credentials
 */
export function setupCredentialInterception(): void {
  debugLog('Setting up Rogers Bank credential interception...');

  // Store original XMLHttpRequest methods
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;
  const originalXHRSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

  // WeakMap to store request data for each XHR instance
  const requestDataMap = new WeakMap<XMLHttpRequest, { headers: Record<string, string>; url: string | null; method?: string }>();

  // Override setRequestHeader to capture headers
  XMLHttpRequest.prototype.setRequestHeader = function setRequestHeaderWrapper(header: string, value: string) {
    let requestData = requestDataMap.get(this);
    if (!requestData) {
      requestData = { headers: {}, url: null };
      requestDataMap.set(this, requestData);
    }

    requestData.headers[header.toLowerCase()] = value;

    return originalXHRSetRequestHeader.call(this, header, value);
  };

  // Override open to capture URL
  XMLHttpRequest.prototype.open = function openWrapper(method: string, url: string | URL, ...args: unknown[]) {
    let requestData = requestDataMap.get(this);
    if (!requestData) {
      requestData = { headers: {}, url: null };
      requestDataMap.set(this, requestData);
    }

    requestData.url = url as string;
    requestData.method = method;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (originalXHROpen as any).call(this, method, url, ...args);
  };

  // Override send to process the complete request
  XMLHttpRequest.prototype.send = function sendWrapper(body?: Document | XMLHttpRequestBodyInit | null) {
    const requestData = requestDataMap.get(this);

    if (requestData && requestData.url) {
      const { url } = requestData;
      const { headers } = requestData;

      // Check if this is a Rogers Bank API call
      if (url.includes('selfserve.apis.rogersbank.com')) {
        debugLog('Rogers Bank API call intercepted:', { url, headerNames: Object.keys(headers) });

        // Parse transaction API URL for account and customer IDs
        const transactionMatch = url.match(/\/account\/([^/]+)\/customer\/([^/]+)\/transactions/);
        if (transactionMatch) {
          const [, accountId, customerId] = transactionMatch;

          debugLog('Captured transaction API credentials:', {
            accountId,
            customerId,
          });

          const accountIdEncoded = headers.accountid || null;
          const customerIdEncoded = headers.customerid || null;
          const deviceId = headers.deviceid || null;
          const authToken = headers.authorization || null;

          updateCapturedCredentials({
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
          this.addEventListener('load', function handleTokenRegeneration() {
            try {
              const newToken = this.getResponseHeader('Accesstoken');
              if (newToken) {
                debugLog('Captured new Rogers Bank token from regeneratetoken API');

                updateCapturedCredentials({ authToken: newToken });

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
          updateCapturedCredentials({ authToken: headers.authorization });
        }
      }
    }

    return originalXHRSend.call(this, body);
  };

  // Also intercept fetch API
  const originalFetch = window.fetch;
  window.fetch = async function fetchWrapper(url: RequestInfo | URL, options: RequestInit = {}) {
    // Check if this is a Rogers Bank API call
    if (typeof url === 'string' && url.includes('selfserve.apis.rogersbank.com')) {
      debugLog('Rogers Bank fetch API call intercepted:', { url });

      const transactionMatch = url.match(/\/account\/([^/]+)\/customer\/([^/]+)\/transactions/);
      if (transactionMatch) {
        const [, accountId, customerId] = transactionMatch;

        debugLog('Captured transaction API credentials from fetch:', {
          accountId,
          customerId,
        });

        const headers = options.headers || {};
        const headersObj: Record<string, string> = {};

        if (headers instanceof Headers) {
          headers.forEach((value, key) => {
            headersObj[key.toLowerCase()] = value;
          });
        } else if (typeof headers === 'object' && !Array.isArray(headers)) {
          Object.keys(headers as Record<string, string>).forEach((key) => {
            headersObj[key.toLowerCase()] = (headers as Record<string, string>)[key];
          });
        }

        updateCapturedCredentials({
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

          const clonedResponse = response.clone();
          const newToken = clonedResponse.headers.get('Accesstoken');

          if (newToken) {
            debugLog('Captured new Rogers Bank token from regeneratetoken fetch API');

            updateCapturedCredentials({ authToken: newToken });

            toast.show('Rogers Bank token refreshed (fetch)', 'debug', 2000);
          }

          return response;
        } catch (error) {
          debugLog('Error in fetch interception:', error);
          throw error;
        }
      }
    }

    return originalFetch.call(this, url, options);
  };

  debugLog('Rogers Bank credential interception setup complete');

  // Check initial status once during setup
  checkCredentialStatus();
}

/**
 * Clear the Rogers Bank credentials captured on this page.
 * Only the in-memory copy exists, so there is nothing to delete from storage.
 */
export function clearRogersBankCredentials(): void {
  debugLog('Clearing Rogers Bank credentials...');

  (Object.keys(credentials) as Array<keyof RogersBankCredentials>).forEach((key) => {
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
 * @returns Account details object
 */
export async function fetchRogersBankAccountDetails(): Promise<RogersBankAccountDetails> {
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

    const balanceValue = parseFloat(currentBalance);
    if (Number.isNaN(balanceValue)) {
      throw new Error('Invalid balance value received from API');
    }

    // Extract credit limit
    const creditLimitValue = data.accountDetail?.creditLimit?.value;
    let creditLimit: number | null = null;
    if (creditLimitValue !== undefined && creditLimitValue !== null) {
      creditLimit = parseFloat(creditLimitValue);
      if (Number.isNaN(creditLimit)) {
        debugLog('Warning: Invalid credit limit value, setting to null');
        creditLimit = null;
      }
    }

    // Extract account opened date (YYYY-MM-DD format expected)
    const openedDate: string | null = data.accountDetail?.openedDate || null;

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
 * @returns Current balance (as negative value for credit card)
 */
export async function fetchRogersBankBalance(): Promise<number> {
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
