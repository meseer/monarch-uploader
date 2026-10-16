/**
 * Test helpers that simulate the Rogers Bank page for credential capture.
 *
 * Rogers Bank credentials are captured from the bank page's own API requests
 * (see `setupCredentialInterception` in `src/api/rogersbank.ts`) and held in
 * memory only. These helpers let a suite:
 * - install a fake `XMLHttpRequest` whose prototype the interceptor can wrap
 *   (jsdom's real XHR would try to hit the network),
 * - send the request Rogers Bank's own page makes, with its credential headers,
 * - back the GM_* storage functions with a Map, so a suite can assert that no
 *   credential value ever reaches userscript storage.
 */

const ACCOUNT_ID = '12345';
const CUSTOMER_ID = '67890';

const TRANSACTIONS_URL = `https://selfserve.apis.rogersbank.com/corebank/v1/account/${ACCOUNT_ID}/customer/${CUSTOMER_ID}/transactions`;
const REGENERATE_TOKEN_URL = 'https://selfserve.apis.rogersbank.com/authenticate/v1/authenticate/regeneratetoken/';

/** Headers Rogers Bank's own page sends with its API requests */
const PAGE_HEADERS = {
  Authorization: 'Bearer secret-auth-token-abc123',
  AccountId: 'secret-encoded-account-def456',
  CustomerId: 'secret-encoded-customer-ghi789',
  DeviceId: 'secret-device-id-jkl012',
};

/** The credentials the interceptor should capture from PAGE_HEADERS */
const CAPTURED = {
  authToken: PAGE_HEADERS.Authorization,
  accountId: ACCOUNT_ID,
  customerId: CUSTOMER_ID,
  accountIdEncoded: PAGE_HEADERS.AccountId,
  customerIdEncoded: PAGE_HEADERS.CustomerId,
  deviceId: PAGE_HEADERS.DeviceId,
};

/** Every credential value, for scanning storage for leaks */
const SECRET_VALUES = [
  CAPTURED.authToken,
  CAPTURED.accountIdEncoded,
  CAPTURED.customerIdEncoded,
  CAPTURED.deviceId,
];

/**
 * Replace the global XMLHttpRequest with an inert fake. Call before
 * `setupCredentialInterception()`, which wraps its prototype.
 */
function installFakeXhr() {
  class FakeXMLHttpRequest {
    constructor() {
      this.listeners = {};
      this.responseHeaders = {};
    }

    open() {}

    send() {}

    setRequestHeader() {}

    addEventListener(type, callback) {
      this.listeners[type] = callback;
    }

    getResponseHeader(name) {
      return this.responseHeaders[name] ?? null;
    }
  }

  globalThis.XMLHttpRequest = FakeXMLHttpRequest;
  return FakeXMLHttpRequest;
}

/**
 * Send a request the way Rogers Bank's own page does
 * @returns {XMLHttpRequest} The fake request, for firing response events
 */
function sendPageXhr(url, headers = PAGE_HEADERS, method = 'GET') {
  const xhr = new XMLHttpRequest();
  xhr.open(method, url);
  Object.entries(headers).forEach(([name, value]) => xhr.setRequestHeader(name, value));
  xhr.send(null);
  return xhr;
}

/**
 * Back GM_getValue / GM_setValue / GM_deleteValue with a Map
 * @param {Object} initial - Values already in storage
 * @returns {Map} The backing store
 */
function useInMemoryGmStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  globalThis.GM_getValue.mockImplementation((key, defaultValue) => (store.has(key) ? store.get(key) : defaultValue));
  globalThis.GM_setValue.mockImplementation((key, value) => {
    store.set(key, value);
  });
  globalThis.GM_deleteValue.mockImplementation((key) => {
    store.delete(key);
  });
  return store;
}

/**
 * Assert no credential value is in userscript storage, under any key
 */
function expectNoCredentialsInStorage(store) {
  const dump = JSON.stringify(Array.from(store.entries()));
  SECRET_VALUES.forEach((secret) => {
    expect(dump).not.toContain(secret);
  });
}

module.exports = {
  ACCOUNT_ID,
  CUSTOMER_ID,
  TRANSACTIONS_URL,
  REGENERATE_TOKEN_URL,
  PAGE_HEADERS,
  CAPTURED,
  installFakeXhr,
  sendPageXhr,
  useInMemoryGmStorage,
  expectNoCredentialsInStorage,
};
