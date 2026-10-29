/**
 * Tests for Rogers Bank API Client
 *
 * Rogers Bank credentials are captured from the bank page's own API requests
 * and held in memory for the current page only. They must never be written to
 * userscript (GM) storage. The real configStore is used (not mocked) so that a
 * re-introduced `setAuth` call would reach the in-memory GM store and fail the
 * storage assertions below.
 */

import {
  getRogersBankCredentials,
  checkRogersBankAuth,
  checkCredentialStatus,
  installRogersBankNetworkHooks,
  setupCredentialInterception,
  clearRogersBankCredentials,
  fetchRogersBankAccountDetails,
  fetchRogersBankBalance,
} from '../../src/api/rogersbank';

import { ACCOUNT_ID, CUSTOMER_ID, TRANSACTIONS_URL, REGENERATE_TOKEN_URL, ACCOUNT_DETAIL_URL, PROFILE_URL, PAGE_HEADERS, CAPTURED, installFakeXhr, sendPageXhr, useInMemoryGmStorage, expectNoCredentialsInStorage, expectNoCredentialsInCalls } from '../helpers/rogersBankPage';

vi.mock('../../src/core/utils', () => ({
  debugLog: vi.fn(),
}));

vi.mock('../../src/core/state', () => ({
  __esModule: true,
  default: {
    setRogersBankAuth: vi.fn(),
  },
}));

vi.mock('../../src/ui/toast', () => ({
  __esModule: true,
  default: {
    show: vi.fn(),
  },
}));

import stateManager from '../../src/core/state';
import { debugLog } from '../../src/core/utils';
import toast from '../../src/ui/toast';

/** The per-request diagnostics logged by the network hooks */
const observedRequestLogs = () => debugLog.mock.calls
  .filter(([message]) => message === '[rogersbank] API request observed:')
  .map(([, details]) => details);

/** Credentials stored by older versions, to prove they are never read back */
const STORED_BY_OLD_VERSION = {
  rogersbank_config: JSON.stringify({
    auth: {
      authToken: 'Bearer old-stored-token',
      accountId: 'old-account',
      customerId: 'old-customer',
      accountIdEncoded: 'old-enc-account',
      customerIdEncoded: 'old-enc-customer',
      deviceId: 'old-device',
    },
  }),
  rogersbank_auth_token: 'Bearer old-legacy-token',
  rogersbank_account_id: 'old-legacy-account',
  rogersbank_customer_id: 'old-legacy-customer',
  rogersbank_device_id: 'old-legacy-device',
};

describe('Rogers Bank API Client', () => {
  let gmStore;
  let pageFetch;

  beforeEach(() => {
    clearRogersBankCredentials();
    vi.clearAllMocks();
    gmStore = useInMemoryGmStorage();

    installFakeXhr();
    pageFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    globalThis.fetch = pageFetch;
  });

  describe('in-memory credentials', () => {
    test('start empty, without reading credentials stored by older versions', () => {
      gmStore = useInMemoryGmStorage(STORED_BY_OLD_VERSION);

      expect(getRogersBankCredentials()).toEqual({
        authToken: null,
        accountId: null,
        customerId: null,
        accountIdEncoded: null,
        customerIdEncoded: null,
        deviceId: null,
        lastUpdated: null,
      });
      expect(checkRogersBankAuth().authenticated).toBe(false);
      expect(GM_getValue).not.toHaveBeenCalled();
      expect(GM_setValue).not.toHaveBeenCalled();
    });

    test('are captured from the page and returned from memory', () => {
      setupCredentialInterception();
      sendPageXhr(TRANSACTIONS_URL);

      expect(getRogersBankCredentials()).toEqual({
        ...CAPTURED,
        lastUpdated: expect.any(String),
      });
      expect(checkRogersBankAuth()).toEqual({
        authenticated: true,
        credentials: expect.objectContaining(CAPTURED),
        source: 'intercepted',
      });
    });

    test('are returned as a copy that callers cannot mutate', () => {
      setupCredentialInterception();
      sendPageXhr(TRANSACTIONS_URL);

      const copy = getRogersBankCredentials();
      copy.authToken = 'tampered';

      expect(getRogersBankCredentials().authToken).toBe(CAPTURED.authToken);
    });

    test('are gone after a page reload, because nothing was persisted', async () => {
      setupCredentialInterception();
      sendPageXhr(TRANSACTIONS_URL);
      expect(checkRogersBankAuth().authenticated).toBe(true);

      // A page reload re-evaluates the module against the same GM storage
      vi.resetModules();
      const reloaded = await import('../../src/api/rogersbank');

      expect(reloaded.checkRogersBankAuth().authenticated).toBe(false);
      expect(reloaded.getRogersBankCredentials().authToken).toBeNull();
    });

    test('report unauthenticated while only some credentials are captured', () => {
      setupCredentialInterception();
      sendPageXhr(PROFILE_URL, {
        Authorization: PAGE_HEADERS.Authorization,
      });

      expect(getRogersBankCredentials().authToken).toBe(CAPTURED.authToken);
      expect(checkRogersBankAuth().authenticated).toBe(false);
    });
  });

  describe('no credential persistence', () => {
    test('capturing from an XHR request writes nothing to GM storage', () => {
      setupCredentialInterception();
      sendPageXhr(TRANSACTIONS_URL);

      expect(checkRogersBankAuth().authenticated).toBe(true);
      expect(GM_setValue).not.toHaveBeenCalled();
      expect(gmStore.size).toBe(0);
    });

    test('capturing from a fetch request writes nothing to GM storage', async () => {
      setupCredentialInterception();
      await globalThis.fetch(TRANSACTIONS_URL, { headers: PAGE_HEADERS });

      expect(checkRogersBankAuth().authenticated).toBe(true);
      expect(GM_setValue).not.toHaveBeenCalled();
      expect(gmStore.size).toBe(0);
    });

    test('a token refresh writes nothing to GM storage', () => {
      setupCredentialInterception();
      sendPageXhr(TRANSACTIONS_URL);
      const regen = sendPageXhr(REGENERATE_TOKEN_URL, {}, 'POST');
      regen.responseHeaders.Accesstoken = 'Bearer refreshed-token';
      regen.listeners.load.call(regen);

      expect(getRogersBankCredentials().authToken).toBe('Bearer refreshed-token');
      expect(GM_setValue).not.toHaveBeenCalled();
    });

    test('no credential value reaches storage alongside existing Rogers data', () => {
      gmStore = useInMemoryGmStorage({
        rogersbank_config: JSON.stringify({ settings: { lookbackDays: 7 } }),
        rogersbank_accounts_list: JSON.stringify([{ rogersbankAccount: { id: '12345' } }]),
      });

      setupCredentialInterception();
      sendPageXhr(TRANSACTIONS_URL);
      clearRogersBankCredentials();

      expect(GM_setValue).not.toHaveBeenCalled();
      expect(GM_deleteValue).not.toHaveBeenCalled();
      expectNoCredentialsInStorage(gmStore);
    });
  });

  describe('checkCredentialStatus', () => {
    test('returns null and publishes null state before capture', () => {
      expect(checkCredentialStatus()).toBeNull();
      expect(stateManager.setRogersBankAuth).toHaveBeenCalledWith(null);
    });

    test('returns the status and publishes credentials after capture', () => {
      setupCredentialInterception();
      sendPageXhr(TRANSACTIONS_URL);
      stateManager.setRogersBankAuth.mockClear();

      const result = checkCredentialStatus();

      expect(result.authenticated).toBe(true);
      expect(stateManager.setRogersBankAuth).toHaveBeenCalledWith(expect.objectContaining(CAPTURED));
    });
  });

  describe('setupCredentialInterception', () => {
    test('wraps XMLHttpRequest and fetch', () => {
      const originalSend = XMLHttpRequest.prototype.send;

      setupCredentialInterception();

      expect(XMLHttpRequest.prototype.send).not.toBe(originalSend);
      expect(globalThis.fetch).not.toBe(pageFetch);
    });

    test('notifies the state manager when credentials are captured', () => {
      setupCredentialInterception();
      stateManager.setRogersBankAuth.mockClear();

      sendPageXhr(TRANSACTIONS_URL);

      expect(stateManager.setRogersBankAuth).toHaveBeenCalledWith(expect.objectContaining(CAPTURED));
    });

    test('still sends the page request and keeps the capture when a listener throws', () => {
      const sendSpy = vi.spyOn(XMLHttpRequest.prototype, 'send');
      setupCredentialInterception();
      stateManager.setRogersBankAuth.mockImplementationOnce(() => {
        throw new Error('listener failed');
      });

      expect(() => sendPageXhr(TRANSACTIONS_URL)).not.toThrow();
      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(checkRogersBankAuth().authenticated).toBe(true);
    });

    test('captures credentials from a fetch call with a Headers object', async () => {
      setupCredentialInterception();

      await globalThis.fetch(TRANSACTIONS_URL, { headers: new Headers(PAGE_HEADERS) });

      expect(getRogersBankCredentials()).toEqual(expect.objectContaining(CAPTURED));
    });

    test('passes the page request through to the original XHR send', () => {
      const sendSpy = vi.spyOn(XMLHttpRequest.prototype, 'send');
      setupCredentialInterception();

      sendPageXhr(TRANSACTIONS_URL);

      expect(sendSpy).toHaveBeenCalledTimes(1);
    });

    test('does not replace a captured token from a later non-transaction call', () => {
      setupCredentialInterception();
      sendPageXhr(TRANSACTIONS_URL);

      sendPageXhr(PROFILE_URL, {
        Authorization: 'Bearer other-token',
      });

      expect(getRogersBankCredentials().authToken).toBe(CAPTURED.authToken);
    });

    test('keeps the token when a regeneration response has no new token', () => {
      setupCredentialInterception();
      sendPageXhr(TRANSACTIONS_URL);
      const regen = sendPageXhr(REGENERATE_TOKEN_URL, {}, 'POST');
      regen.listeners.load.call(regen);

      expect(getRogersBankCredentials().authToken).toBe(CAPTURED.authToken);
    });

    test('captures a regenerated token from a fetch call', async () => {
      const response = {
        ok: true,
        headers: new Headers({ Accesstoken: 'Bearer fetch-refreshed-token' }),
      };
      pageFetch.mockResolvedValue(response);
      setupCredentialInterception();

      const result = await globalThis.fetch(REGENERATE_TOKEN_URL, {});

      expect(result).toBe(response);
      expect(getRogersBankCredentials().authToken).toBe('Bearer fetch-refreshed-token');
      expect(GM_setValue).not.toHaveBeenCalled();
    });

    test('propagates fetch errors from token regeneration', async () => {
      pageFetch.mockRejectedValue(new Error('Network error'));
      setupCredentialInterception();

      await expect(globalThis.fetch(REGENERATE_TOKEN_URL, {})).rejects.toThrow('Network error');
    });

    test('passes non-Rogers Bank fetch calls through untouched', async () => {
      setupCredentialInterception();

      await globalThis.fetch('https://example.com/api/data', {});

      expect(pageFetch).toHaveBeenCalledWith('https://example.com/api/data', {});
      expect(getRogersBankCredentials().authToken).toBeNull();
    });
  });

  describe('capture from any Rogers Bank API request', () => {
    test('connects from the account details request the landing page makes', () => {
      setupCredentialInterception();

      sendPageXhr(ACCOUNT_DETAIL_URL);

      expect(getRogersBankCredentials()).toEqual({ ...CAPTURED, lastUpdated: expect.any(String) });
      expect(checkRogersBankAuth().authenticated).toBe(true);
    });

    test('connects from a fetch request to any account endpoint', async () => {
      setupCredentialInterception();

      await globalThis.fetch(ACCOUNT_DETAIL_URL.replace('/detail', '/rewards/summary?year=2026'), {
        headers: new Headers(PAGE_HEADERS),
      });

      expect(getRogersBankCredentials()).toEqual(expect.objectContaining(CAPTURED));
      expect(checkRogersBankAuth().authenticated).toBe(true);
    });

    test('takes header credentials from a request with no IDs in its path, and the IDs from a later path', () => {
      setupCredentialInterception();

      sendPageXhr(PROFILE_URL);

      expect(getRogersBankCredentials()).toEqual(expect.objectContaining({
        authToken: CAPTURED.authToken,
        accountIdEncoded: CAPTURED.accountIdEncoded,
        customerIdEncoded: CAPTURED.customerIdEncoded,
        deviceId: CAPTURED.deviceId,
        accountId: null,
        customerId: null,
      }));
      expect(checkRogersBankAuth().authenticated).toBe(false);

      sendPageXhr(ACCOUNT_DETAIL_URL, {});

      expect(getRogersBankCredentials()).toEqual(expect.objectContaining(CAPTURED));
      expect(checkRogersBankAuth().authenticated).toBe(true);
    });

    test('picks up a token the page has rotated from its next fully authenticated request', () => {
      setupCredentialInterception();
      sendPageXhr(ACCOUNT_DETAIL_URL);

      sendPageXhr(TRANSACTIONS_URL, { ...PAGE_HEADERS, Authorization: 'Bearer rotated-token' });

      expect(getRogersBankCredentials().authToken).toBe('Bearer rotated-token');
    });

    test('only fills gaps from a request that lacks some credential headers', () => {
      setupCredentialInterception();
      sendPageXhr(ACCOUNT_DETAIL_URL);

      sendPageXhr('https://selfserve.apis.rogersbank.com/corebank/v1/account/99999/customer/11111/detail', {
        Authorization: 'Bearer other-token',
        DeviceId: 'other-device',
      });

      expect(getRogersBankCredentials()).toEqual(expect.objectContaining(CAPTURED));
    });

    test('follows the account of the latest fully authenticated request', () => {
      setupCredentialInterception();
      sendPageXhr(ACCOUNT_DETAIL_URL);

      sendPageXhr('https://selfserve.apis.rogersbank.com/corebank/v1/account/99999/customer/67890/detail', {
        ...PAGE_HEADERS,
        AccountId: 'encoded-other-account',
      });

      expect(getRogersBankCredentials()).toEqual(expect.objectContaining({
        accountId: '99999',
        accountIdEncoded: 'encoded-other-account',
        customerId: CAPTURED.customerId,
      }));
    });

    test('ignores requests to other hosts that carry the same headers', () => {
      setupCredentialInterception();

      sendPageXhr('https://selfserve.rogersbank.com/corebank/v1/account/1/customer/2/detail');
      sendPageXhr('https://example.com/selfserve.apis.rogersbank.com/corebank/v1/account/1/customer/2/detail');

      expect(getRogersBankCredentials().authToken).toBeNull();
      expect(observedRequestLogs()).toHaveLength(0);
    });

    test('does not carry headers over when the page reuses an XHR object', () => {
      setupCredentialInterception();
      const xhr = new XMLHttpRequest();
      xhr.open('GET', 'https://example.com/other');
      Object.entries(PAGE_HEADERS).forEach(([name, value]) => xhr.setRequestHeader(name, value));
      xhr.send(null);

      xhr.open('GET', PROFILE_URL);
      xhr.send(null);

      expect(getRogersBankCredentials().authToken).toBeNull();
    });

    test('captures from fetch called with a Request object', async () => {
      setupCredentialInterception();

      await globalThis.fetch({ url: ACCOUNT_DETAIL_URL, method: 'GET', headers: new Headers(PAGE_HEADERS) });

      expect(checkRogersBankAuth().authenticated).toBe(true);
    });

    test('captures from fetch called with a URL and an array of headers', async () => {
      setupCredentialInterception();

      await globalThis.fetch(new URL(ACCOUNT_DETAIL_URL), { headers: Object.entries(PAGE_HEADERS) });

      expect(getRogersBankCredentials()).toEqual(expect.objectContaining(CAPTURED));
    });

    test('notifies listeners only when a captured value changes', () => {
      setupCredentialInterception();
      stateManager.setRogersBankAuth.mockClear();

      sendPageXhr(ACCOUNT_DETAIL_URL);
      sendPageXhr(ACCOUNT_DETAIL_URL);
      sendPageXhr(TRANSACTIONS_URL);

      expect(stateManager.setRogersBankAuth).toHaveBeenCalledTimes(1);
    });

    test('keeps sending the page request when capture itself fails', () => {
      const sendSpy = vi.spyOn(XMLHttpRequest.prototype, 'send');
      setupCredentialInterception();
      debugLog.mockImplementationOnce(() => {
        throw new Error('logging failed');
      });

      expect(() => sendPageXhr(ACCOUNT_DETAIL_URL)).not.toThrow();
      expect(sendSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('installRogersBankNetworkHooks', () => {
    test('installs the hooks once, however often it is called', () => {
      installRogersBankNetworkHooks();
      const wrappedSend = XMLHttpRequest.prototype.send;
      const wrappedFetch = globalThis.fetch;

      installRogersBankNetworkHooks();
      setupCredentialInterception();
      sendPageXhr(ACCOUNT_DETAIL_URL);

      expect(XMLHttpRequest.prototype.send).toBe(wrappedSend);
      expect(globalThis.fetch).toBe(wrappedFetch);
      expect(observedRequestLogs()).toHaveLength(1);
    });

    test('captures before setupCredentialInterception, which then publishes the capture', () => {
      installRogersBankNetworkHooks();
      sendPageXhr(ACCOUNT_DETAIL_URL);
      stateManager.setRogersBankAuth.mockClear();

      setupCredentialInterception();

      expect(stateManager.setRogersBankAuth).toHaveBeenLastCalledWith(expect.objectContaining(CAPTURED));
    });

    test('shows no toast when capture happens before the page has a body', () => {
      const { body } = document;
      body.remove();
      try {
        installRogersBankNetworkHooks();
        sendPageXhr(ACCOUNT_DETAIL_URL);
      } finally {
        document.documentElement.appendChild(body);
      }

      expect(checkRogersBankAuth().authenticated).toBe(true);
      expect(toast.show).not.toHaveBeenCalled();
    });
  });

  describe('debug diagnostics', () => {
    let performanceNow;

    beforeEach(() => {
      // Keep log output deterministic, so it can't contain an ID by chance
      performanceNow = vi.spyOn(performance, 'now').mockReturnValue(42);
    });

    afterEach(() => {
      performanceNow.mockRestore();
      delete performance.getEntriesByType;
    });

    test('logs each Rogers Bank request with its endpoint, header names and capture result', () => {
      setupCredentialInterception();

      sendPageXhr(PROFILE_URL);
      sendPageXhr(`${ACCOUNT_DETAIL_URL}?fromDate=2026-01-01`, {});

      expect(observedRequestLogs()).toEqual([
        {
          via: 'xhr',
          method: 'GET',
          endpoint: '/corebank/v1/profile',
          headerNames: ['authorization', 'accountid', 'customerid', 'deviceid'],
          captured: ['authToken', 'accountIdEncoded', 'customerIdEncoded', 'deviceId'],
          missing: ['accountId', 'customerId'],
          connected: false,
        },
        {
          via: 'xhr',
          method: 'GET',
          endpoint: '/corebank/v1/account/{id}/customer/{id}/detail',
          headerNames: [],
          captured: ['accountId', 'customerId'],
          missing: [],
          connected: true,
        },
      ]);
      expect(debugLog).toHaveBeenCalledWith(
        '[rogersbank] Credentials captured from /corebank/v1/account/{id}/customer/{id}/detail; connected (held in memory only)',
      );
    });

    test('replaces ID-like path segments in logged endpoints', () => {
      setupCredentialInterception();

      sendPageXhr('https://selfserve.apis.rogersbank.com/corebank/v1/statements/202601', {});
      sendPageXhr(`${REGENERATE_TOKEN_URL}abcdefghijklmnopqrstuvwxyz`, {}, 'POST');

      expect(observedRequestLogs().map(({ endpoint }) => endpoint)).toEqual([
        '/corebank/v1/statements/{value}',
        '/authenticate/v1/authenticate/regeneratetoken/{value}',
      ]);
    });

    test('never logs a credential value', async () => {
      setupCredentialInterception();
      sendPageXhr(ACCOUNT_DETAIL_URL);
      await globalThis.fetch(TRANSACTIONS_URL, {
        headers: new Headers({ ...PAGE_HEADERS, Authorization: 'Bearer rotated-token' }),
      });
      const regen = sendPageXhr(REGENERATE_TOKEN_URL, {}, 'POST');
      regen.responseHeaders.Accesstoken = 'Bearer refreshed-token';
      regen.listeners.load.call(regen);

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ statusCode: '200', accountDetail: { currentBalance: { value: '1' } } }),
      });
      await fetchRogersBankAccountDetails();

      expect(debugLog).toHaveBeenCalledWith(
        'Fetching Rogers Bank account details from:',
        '/corebank/v1/account/{id}/customer/{id}/detail',
      );
      expectNoCredentialsInCalls(debugLog, [ACCOUNT_ID, CUSTOMER_ID, 'rotated-token', 'refreshed-token']);
      expectNoCredentialsInCalls(toast.show, [ACCOUNT_ID, CUSTOMER_ID, 'rotated-token', 'refreshed-token']);
    });

    test('reports Rogers Bank requests that completed before the hooks were installed', () => {
      performance.getEntriesByType = vi.fn(() => [
        { name: `${ACCOUNT_DETAIL_URL}?fromDate=2026-01-01` },
        { name: 'https://selfserve.rogersbank.com/main.js' },
        { name: PROFILE_URL },
      ]);

      installRogersBankNetworkHooks();

      expect(performance.getEntriesByType).toHaveBeenCalledWith('resource');
      expect(debugLog).toHaveBeenCalledWith(
        '[rogersbank] Rogers Bank API requests completed before the network hooks were installed (not captured):',
        { count: 2, endpoints: ['/corebank/v1/account/{id}/customer/{id}/detail', '/corebank/v1/profile'] },
      );
      expect(debugLog).toHaveBeenCalledWith('[rogersbank] Network hooks installed:', expect.objectContaining({
        xhr: true, fetch: true, readyState: 'complete', msSincePageStart: 42,
      }));
    });
  });

  describe('clearRogersBankCredentials', () => {
    test('clears the in-memory credentials and the state', () => {
      setupCredentialInterception();
      sendPageXhr(TRANSACTIONS_URL);
      stateManager.setRogersBankAuth.mockClear();

      clearRogersBankCredentials();

      expect(checkRogersBankAuth().authenticated).toBe(false);
      expect(getRogersBankCredentials().authToken).toBeNull();
      expect(stateManager.setRogersBankAuth).toHaveBeenCalledWith(null);
    });
  });

  describe('fetchRogersBankAccountDetails', () => {
    let apiFetch;

    /** Capture credentials from the page, then swap in a fetch mock for the API call */
    function captureCredentials() {
      setupCredentialInterception();
      sendPageXhr(TRANSACTIONS_URL);
      apiFetch = vi.fn();
      globalThis.fetch = apiFetch;
    }

    function respondWith(data, init = { ok: true, status: 200 }) {
      apiFetch.mockResolvedValue({ ...init, json: vi.fn().mockResolvedValue(data) });
    }

    test('calls the API with the captured credentials', async () => {
      captureCredentials();
      respondWith({
        statusCode: '200',
        accountDetail: {
          currentBalance: { value: '1234.56' },
          creditLimit: { value: '5000' },
          openedDate: '2020-01-15',
        },
      });

      const details = await fetchRogersBankAccountDetails();

      expect(details).toEqual({ balance: 1234.56, creditLimit: 5000, openedDate: '2020-01-15' });
      expect(apiFetch).toHaveBeenCalledWith(
        'https://selfserve.apis.rogersbank.com/corebank/v1/account/12345/customer/67890/detail',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            accountid: CAPTURED.accountIdEncoded,
            authorization: CAPTURED.authToken,
            customerid: CAPTURED.customerIdEncoded,
            deviceid: CAPTURED.deviceId,
          }),
        }),
      );
    });

    test('throws when no credentials were captured on this page', async () => {
      useInMemoryGmStorage(STORED_BY_OLD_VERSION);

      await expect(fetchRogersBankAccountDetails()).rejects.toThrow(
        'Missing Rogers Bank credentials. Please navigate to your account page first.',
      );
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    test('throws when only some credentials were captured', async () => {
      setupCredentialInterception();
      sendPageXhr(PROFILE_URL, {
        Authorization: PAGE_HEADERS.Authorization,
      });

      await expect(fetchRogersBankAccountDetails()).rejects.toThrow('Missing Rogers Bank credentials');
    });

    test('sets the credit limit to null when it is not a number', async () => {
      captureCredentials();
      respondWith({
        statusCode: '200',
        accountDetail: { currentBalance: { value: 10 }, creditLimit: { value: 'n/a' } },
      });

      const details = await fetchRogersBankAccountDetails();

      expect(details.creditLimit).toBeNull();
      expect(details.openedDate).toBeNull();
    });
  });

  describe('fetchRogersBankBalance', () => {
    let apiFetch;

    beforeEach(() => {
      setupCredentialInterception();
      sendPageXhr(TRANSACTIONS_URL);
      apiFetch = vi.fn();
      globalThis.fetch = apiFetch;
    });

    test('returns the current balance', async () => {
      apiFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ statusCode: '200', accountDetail: { currentBalance: { value: 1234.56 } } }),
      });

      await expect(fetchRogersBankBalance()).resolves.toBe(1234.56);
    });

    test('throws on an HTTP failure', async () => {
      apiFetch.mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized', json: vi.fn() });

      await expect(fetchRogersBankBalance()).rejects.toThrow('API request failed: 401 Unauthorized');
    });

    test('throws on an API error status', async () => {
      apiFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ statusCode: '500', message: 'Internal server error' }),
      });

      await expect(fetchRogersBankBalance()).rejects.toThrow('API returned error status: 500');
    });

    test('throws when the balance is missing', async () => {
      apiFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ statusCode: '200', accountDetail: {} }),
      });

      await expect(fetchRogersBankBalance()).rejects.toThrow('Current balance not found in API response');
    });

    test('throws when the balance is not a number', async () => {
      apiFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ statusCode: '200', accountDetail: { currentBalance: { value: 'not-a-number' } } }),
      });

      await expect(fetchRogersBankBalance()).rejects.toThrow('Invalid balance value received from API');
    });

    test('propagates network errors', async () => {
      apiFetch.mockRejectedValue(new Error('Network error'));

      await expect(fetchRogersBankBalance()).rejects.toThrow('Network error');
    });
  });
});
