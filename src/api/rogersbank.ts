/**
 * Rogers Bank API client
 * Captures Rogers Bank credentials from the bank page's own API requests and
 * calls the Rogers Bank API with them.
 *
 * Credentials (auth token, device ID, account/customer IDs and their encoded
 * header forms) are held in memory for the current page only. They are never
 * written to userscript (GM) storage: after a page reload they are captured
 * again from Rogers Bank's next API request.
 *
 * Any request to the Rogers Bank API that carries the credential headers is
 * enough, not only the transactions request, so the landing page (/home)
 * connects on its own. `installRogersBankNetworkHooks()` runs at document-start
 * (see src/index.ts) so the hooks exist before the bank page's first request.
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

type CredentialField = 'authToken' | 'accountId' | 'customerId' | 'accountIdEncoded' | 'customerIdEncoded' | 'deviceId';

/** A Rogers Bank API request seen by the network hooks */
interface ObservedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  via: 'xhr' | 'fetch';
}

// ============================================================
// Constants
// ============================================================

const ROGERS_API_HOST = 'selfserve.apis.rogersbank.com';
const REGENERATE_TOKEN_PATH = '/v1/authenticate/regeneratetoken/';

/**
 * Credential headers on Rogers Bank API requests, and the field each fills.
 * Our own requests (`fetchRogersBankAccountDetails` here and
 * `fetchRogersBankTransactions` in rogersbank-upload.ts) send the same set,
 * mirroring the bank page's requests.
 */
const CREDENTIAL_HEADERS: Record<string, CredentialField> = {
  authorization: 'authToken',
  accountid: 'accountIdEncoded',
  customerid: 'customerIdEncoded',
  deviceid: 'deviceId',
};

/** Plain IDs in account-scoped API paths, e.g. /corebank/v1/account/{id}/customer/{id}/detail */
const ACCOUNT_CUSTOMER_PATH = /\/account\/([^/]+)\/customer\/([^/]+)(?=\/|$)/;

const CAPTURE_FIELDS: CredentialField[] = [
  'authToken', 'accountId', 'customerId', 'accountIdEncoded', 'customerIdEncoded', 'deviceId',
];

/** Marks the fetch wrapper so the hooks are installed only once per page */
const FETCH_HOOK_MARK = '__monarchUploaderRogersHook';

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

/** XMLHttpRequest prototypes already wrapped on this page */
const hookedXhrPrototypes = new WeakSet<object>();

// ============================================================
// Credential state
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
 * Merge captured values into the in-memory copy. Never persists anything.
 *
 * A request that carries every credential header is authoritative: its values
 * replace earlier ones, so a token the page has rotated is picked up. Any other
 * request only fills fields that are still empty.
 * @param values - Captured credential fields
 * @param authoritative - Whether these values may replace captured ones
 * @returns Names of the fields that changed
 */
function mergeCapturedCredentials(values: Partial<Record<CredentialField, string>>, authoritative: boolean): CredentialField[] {
  const changed: CredentialField[] = [];
  (Object.keys(values) as CredentialField[]).forEach((field) => {
    const value = values[field];
    if (!value || credentials[field] === value) return;
    if (credentials[field] && !authoritative) return;
    credentials[field] = value;
    changed.push(field);
  });

  if (changed.length > 0) {
    credentials.lastUpdated = new Date().toISOString();
    notifyCredentialListeners();
  }
  return changed;
}

/**
 * Publish the captured credentials so the UI can leave its "waiting for
 * credentials" state. Runs inside the bank page's own XHR/fetch call, so a
 * failing listener must not break that request.
 */
function notifyCredentialListeners(): void {
  try {
    stateManager.setRogersBankAuth({ ...credentials });
  } catch (error) {
    debugLog('Error notifying listeners of captured Rogers Bank credentials:', error);
  }
}

/**
 * @returns Names of the credential fields not captured yet
 */
function getMissingFields(): CredentialField[] {
  return CAPTURE_FIELDS.filter((field) => !credentials[field]);
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

// ============================================================
// Request inspection
// ============================================================

/**
 * Parse a request URL against the current page
 * @returns The parsed URL, or null if it cannot be parsed
 */
function parseUrl(url: string): URL | null {
  try {
    return new URL(url, window.location.href);
  } catch {
    return null;
  }
}

function isRogersBankApiUrl(url: string): boolean {
  return parseUrl(url)?.hostname === ROGERS_API_HOST;
}

function isRegenerateTokenUrl(url: string): boolean {
  return Boolean(parseUrl(url)?.pathname.includes(REGENERATE_TOKEN_PATH));
}

/**
 * Describe an API endpoint for the debug log without any identifying value:
 * the query string is dropped and account/customer IDs (and any other
 * ID-like path segment) are replaced with placeholders.
 * @returns e.g. `/corebank/v1/account/{id}/customer/{id}/detail`
 */
function describeEndpoint(url: string): string {
  const pathname = parseUrl(url)?.pathname ?? '(unparseable URL)';
  return pathname
    .replace(/\/(account|customer)\/[^/]+/g, '/$1/{id}')
    .split('/')
    .map((segment) => (/\d{4,}/.test(segment) || segment.length >= 20 ? '{value}' : segment))
    .join('/');
}

/**
 * Pull credential values out of a Rogers Bank API request: header values,
 * plus the plain account/customer IDs when the URL path contains them.
 */
function extractCredentials(request: ObservedRequest): {
  values: Partial<Record<CredentialField, string>>;
  hasAllHeaders: boolean;
} {
  const values: Partial<Record<CredentialField, string>> = {};
  Object.entries(CREDENTIAL_HEADERS).forEach(([header, field]) => {
    if (request.headers[header]) values[field] = request.headers[header];
  });

  const pathMatch = parseUrl(request.url)?.pathname.match(ACCOUNT_CUSTOMER_PATH);
  if (pathMatch) {
    [, values.accountId, values.customerId] = pathMatch;
  }

  const hasAllHeaders = Object.keys(CREDENTIAL_HEADERS).every((header) => Boolean(request.headers[header]));
  return { values, hasAllHeaders };
}

/**
 * Capture credentials from one Rogers Bank API request and log what was seen.
 * Logs the endpoint path, header names and field names only, never values.
 */
function observeRogersBankRequest(request: ObservedRequest): void {
  const endpoint = describeEndpoint(request.url);
  const wasConnected = checkRogersBankAuth().authenticated;

  const { values, hasAllHeaders } = extractCredentials(request);
  const captured = mergeCapturedCredentials(values, hasAllHeaders);
  const connected = checkRogersBankAuth().authenticated;

  debugLog('[rogersbank] API request observed:', {
    via: request.via,
    method: request.method,
    endpoint,
    headerNames: Object.keys(request.headers),
    captured,
    missing: getMissingFields(),
    connected,
  });

  if (connected && !wasConnected) {
    debugLog(`[rogersbank] Credentials captured from ${endpoint}; connected (held in memory only)`);
    showDebugToast('Rogers Bank credentials captured');
  }
}

/**
 * Take the new token from a regeneratetoken response
 * @param newToken - The `Accesstoken` response header, if any
 */
function captureRegeneratedToken(newToken: string | null | undefined, via: ObservedRequest['via']): void {
  if (!newToken) {
    debugLog(`[rogersbank] regeneratetoken response (${via}) had no Accesstoken header; keeping the current token`);
    return;
  }
  mergeCapturedCredentials({ authToken: newToken }, true);
  debugLog(`[rogersbank] Token refreshed from regeneratetoken response (${via})`);
  showDebugToast('Rogers Bank token refreshed');
}

/**
 * Show a debug toast once the page has a body. Capture can run at
 * document-start, before there is anywhere to show it.
 */
function showDebugToast(message: string): void {
  if (!document.body) return;
  toast.show(message, 'debug', 2000);
}

/**
 * Run capture code from inside a page request without ever letting it throw
 * into the bank page's own XHR/fetch call.
 */
function runSafely(label: string, callback: () => void): void {
  try {
    callback();
  } catch (error) {
    debugLog(`[rogersbank] Error in ${label}:`, error);
  }
}

// ============================================================
// Network hooks
// ============================================================

/**
 * Wrap XMLHttpRequest so the bank page's API requests are observed.
 * @returns True if the hooks were installed now, false if already present
 */
function hookXhr(): boolean {
  const proto = XMLHttpRequest.prototype;
  if (hookedXhrPrototypes.has(proto)) return false;
  hookedXhrPrototypes.add(proto);

  const originalOpen = proto.open;
  const originalSend = proto.send;
  const originalSetRequestHeader = proto.setRequestHeader;
  const requests = new WeakMap<XMLHttpRequest, Omit<ObservedRequest, 'via'>>();

  proto.open = function openWrapper(method: string, url: string | URL, ...args: unknown[]) {
    // open() starts a new request, so headers from an earlier one are dropped
    requests.set(this, { method: String(method), url: String(url), headers: {} });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (originalOpen as any).call(this, method, url, ...args);
  };

  proto.setRequestHeader = function setRequestHeaderWrapper(header: string, value: string) {
    const request = requests.get(this);
    if (request) request.headers[String(header).toLowerCase()] = String(value);
    return originalSetRequestHeader.call(this, header, value);
  };

  proto.send = function sendWrapper(body?: Document | XMLHttpRequestBodyInit | null) {
    const request = requests.get(this);
    if (request && isRogersBankApiUrl(request.url)) {
      runSafely('XHR capture', () => observeRogersBankRequest({ ...request, via: 'xhr' }));

      if (isRegenerateTokenUrl(request.url)) {
        this.addEventListener('load', function handleTokenRegeneration(this: XMLHttpRequest) {
          runSafely('token regeneration capture', () => captureRegeneratedToken(this.getResponseHeader('Accesstoken'), 'xhr'));
        });
      }
    }
    return originalSend.call(this, body);
  };

  return true;
}

/**
 * Copy fetch headers (a Headers object, an array of pairs or a plain object)
 * into a lowercase-keyed record
 */
function addFetchHeaders(headers: HeadersInit | undefined, into: Record<string, string>): void {
  if (!headers) return;
  if (Array.isArray(headers)) {
    headers.forEach(([key, value]) => { into[String(key).toLowerCase()] = String(value); });
  } else if (typeof (headers as Headers).forEach === 'function') {
    (headers as Headers).forEach((value, key) => { into[key.toLowerCase()] = value; });
  } else {
    Object.entries(headers).forEach(([key, value]) => { into[key.toLowerCase()] = String(value); });
  }
}

/**
 * Describe a fetch call as an observed request
 * @returns The request, or null when the URL cannot be determined
 */
function describeFetchRequest(input: RequestInfo | URL, init?: RequestInit): ObservedRequest | null {
  const request = typeof input === 'object' && input !== null && 'url' in input ? input as Request : null;
  const url = typeof input === 'string' ? input : (input instanceof URL ? input.href : request?.url);
  if (!url) return null;

  const headers: Record<string, string> = {};
  addFetchHeaders(request?.headers, headers);
  addFetchHeaders(init?.headers, headers);
  return {
    url, method: init?.method || request?.method || 'GET', headers, via: 'fetch',
  };
}

/**
 * Wrap fetch so Rogers Bank API calls made through it are observed.
 * @returns True if the hook was installed now, false if already present
 */
function hookFetch(): boolean {
  const originalFetch = window.fetch;
  if (typeof originalFetch !== 'function' || (originalFetch as unknown as Record<string, unknown>)[FETCH_HOOK_MARK]) {
    return false;
  }

  const fetchWrapper = async function fetchWrapper(this: unknown, ...args: Parameters<typeof fetch>): Promise<Response> {
    const request = describeFetchRequest(...args);
    if (!request || !isRogersBankApiUrl(request.url)) return originalFetch.apply(this, args);

    runSafely('fetch capture', () => observeRogersBankRequest(request));
    if (!isRegenerateTokenUrl(request.url)) return originalFetch.apply(this, args);

    const response = await originalFetch.apply(this, args);
    runSafely('token regeneration capture', () => captureRegeneratedToken(response.headers?.get('Accesstoken'), 'fetch'));
    return response;
  };
  Object.defineProperty(fetchWrapper, FETCH_HOOK_MARK, { value: true });
  window.fetch = fetchWrapper;
  return true;
}

/**
 * Log the Rogers Bank API requests the page completed before the hooks were
 * installed. Those were not seen, so their credentials were not captured.
 * Uses Resource Timing, which records URLs only (no headers).
 */
function logRequestsMadeBeforeHooks(): void {
  if (typeof performance === 'undefined' || typeof performance.getEntriesByType !== 'function') return;

  const endpoints = performance.getEntriesByType('resource')
    .map((entry) => entry.name)
    .filter(isRogersBankApiUrl)
    .map(describeEndpoint);

  debugLog('[rogersbank] Rogers Bank API requests completed before the network hooks were installed (not captured):', {
    count: endpoints.length,
    endpoints,
  });
}

/**
 * Install the XHR/fetch hooks that capture credentials from the bank page's
 * own API requests. Safe to call more than once: the hooks are installed once.
 * Called at document-start on Rogers Bank pages, before any page request.
 */
export function installRogersBankNetworkHooks(): void {
  const xhrHooked = hookXhr();
  const fetchHooked = hookFetch();
  if (!xhrHooked && !fetchHooked) return;

  debugLog('[rogersbank] Network hooks installed:', {
    xhr: xhrHooked,
    fetch: fetchHooked,
    readyState: document.readyState,
    msSincePageStart: typeof performance !== 'undefined' ? Math.round(performance.now()) : null,
  });
  logRequestsMadeBeforeHooks();
}

/**
 * Setup request interception to capture Rogers Bank credentials, then publish
 * whatever has been captured so far (the hooks may already have seen requests).
 */
export function setupCredentialInterception(): void {
  debugLog('Setting up Rogers Bank credential interception...');

  installRogersBankNetworkHooks();

  const authStatus = checkCredentialStatus();
  debugLog('Rogers Bank credential interception ready:', {
    connected: Boolean(authStatus),
    missing: getMissingFields(),
  });
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

// ============================================================
// API calls
// ============================================================

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

    debugLog('Fetching Rogers Bank account details from:', describeEndpoint(url));

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
  installRogersBankNetworkHooks,
  setupCredentialInterception,
  clearRogersBankCredentials,
  fetchRogersBankAccountDetails,
  fetchRogersBankBalance,
};
