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
  setupCredentialInterception,
  clearRogersBankCredentials,
  fetchRogersBankAccountDetails,
  fetchRogersBankBalance,
} from '../../src/api/rogersbank';

const {
  TRANSACTIONS_URL,
  REGENERATE_TOKEN_URL,
  PAGE_HEADERS,
  CAPTURED,
  installFakeXhr,
  sendPageXhr,
  useInMemoryGmStorage,
  expectNoCredentialsInStorage,
} = require('../helpers/rogersBankPage');

jest.mock('../../src/core/utils', () => ({
  debugLog: jest.fn(),
}));

jest.mock('../../src/core/state', () => ({
  __esModule: true,
  default: {
    setRogersBankAuth: jest.fn(),
  },
}));

jest.mock('../../src/ui/toast', () => ({
  __esModule: true,
  default: {
    show: jest.fn(),
  },
}));

const stateManager = jest.requireMock('../../src/core/state').default;

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
    jest.clearAllMocks();
    gmStore = useInMemoryGmStorage();

    installFakeXhr();
    pageFetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
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

    test('are gone after a page reload, because nothing was persisted', () => {
      setupCredentialInterception();
      sendPageXhr(TRANSACTIONS_URL);
      expect(checkRogersBankAuth().authenticated).toBe(true);

      // A page reload re-evaluates the module against the same GM storage
      let reloaded;
      jest.isolateModules(() => {
        reloaded = require('../../src/api/rogersbank');
      });

      expect(reloaded.checkRogersBankAuth().authenticated).toBe(false);
      expect(reloaded.getRogersBankCredentials().authToken).toBeNull();
    });

    test('report unauthenticated while only some credentials are captured', () => {
      setupCredentialInterception();
      sendPageXhr('https://selfserve.apis.rogersbank.com/corebank/v1/profile', {
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
      const sendSpy = jest.spyOn(XMLHttpRequest.prototype, 'send');
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
      const sendSpy = jest.spyOn(XMLHttpRequest.prototype, 'send');
      setupCredentialInterception();

      sendPageXhr(TRANSACTIONS_URL);

      expect(sendSpy).toHaveBeenCalledTimes(1);
    });

    test('does not replace a captured token from a later non-transaction call', () => {
      setupCredentialInterception();
      sendPageXhr(TRANSACTIONS_URL);

      sendPageXhr('https://selfserve.apis.rogersbank.com/corebank/v1/profile', {
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
        clone: () => ({ headers: { get: () => 'Bearer fetch-refreshed-token' } }),
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
      apiFetch = jest.fn();
      globalThis.fetch = apiFetch;
    }

    function respondWith(data, init = { ok: true, status: 200 }) {
      apiFetch.mockResolvedValue({ ...init, json: jest.fn().mockResolvedValue(data) });
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
      sendPageXhr('https://selfserve.apis.rogersbank.com/corebank/v1/profile', {
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
      apiFetch = jest.fn();
      globalThis.fetch = apiFetch;
    });

    test('returns the current balance', async () => {
      apiFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ statusCode: '200', accountDetail: { currentBalance: { value: 1234.56 } } }),
      });

      await expect(fetchRogersBankBalance()).resolves.toBe(1234.56);
    });

    test('throws on an HTTP failure', async () => {
      apiFetch.mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized', json: jest.fn() });

      await expect(fetchRogersBankBalance()).rejects.toThrow('API request failed: 401 Unauthorized');
    });

    test('throws on an API error status', async () => {
      apiFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ statusCode: '500', message: 'Internal server error' }),
      });

      await expect(fetchRogersBankBalance()).rejects.toThrow('API returned error status: 500');
    });

    test('throws when the balance is missing', async () => {
      apiFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ statusCode: '200', accountDetail: {} }),
      });

      await expect(fetchRogersBankBalance()).rejects.toThrow('Current balance not found in API response');
    });

    test('throws when the balance is not a number', async () => {
      apiFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ statusCode: '200', accountDetail: { currentBalance: { value: 'not-a-number' } } }),
      });

      await expect(fetchRogersBankBalance()).rejects.toThrow('Invalid balance value received from API');
    });

    test('propagates network errors', async () => {
      apiFetch.mockRejectedValue(new Error('Network error'));

      await expect(fetchRogersBankBalance()).rejects.toThrow('Network error');
    });
  });
});
