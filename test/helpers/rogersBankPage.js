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
 *   credential value ever reaches userscript storage,
 * - assert that no credential value is logged,
 * - make the document look as it does at `@run-at document-start`, so the
 *   startup suites can check what runs before and after DOMContentLoaded.
 */

const ACCOUNT_ID = '12345';
const CUSTOMER_ID = '67890';

const TRANSACTIONS_URL = `https://selfserve.apis.rogersbank.com/corebank/v1/account/${ACCOUNT_ID}/customer/${CUSTOMER_ID}/transactions`;
const REGENERATE_TOKEN_URL = 'https://selfserve.apis.rogersbank.com/authenticate/v1/authenticate/regeneratetoken/';

/**
 * The account details request. The landing page (/home) shows the balance and
 * credit limit this returns; the script sends the same request itself.
 */
const ACCOUNT_DETAIL_URL = `https://selfserve.apis.rogersbank.com/corebank/v1/account/${ACCOUNT_ID}/customer/${CUSTOMER_ID}/detail`;

/** A request with no account/customer IDs in its path */
const PROFILE_URL = 'https://selfserve.apis.rogersbank.com/corebank/v1/profile';

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

/**
 * Assert that no credential value was passed to a mock in any call, e.g. to
 * debugLog or toast.show (nothing logged) or GM_setValue (nothing written,
 * even if it was deleted again later)
 * @param {jest.Mock} mock - The mocked function
 * @param {string[]} extraSecrets - More values that must not appear, such as
 *   the plain account/customer IDs for logs
 */
function expectNoCredentialsInCalls(mock, extraSecrets = []) {
  const dump = JSON.stringify(mock.mock.calls);
  [...SECRET_VALUES, ...extraSecrets].forEach((secret) => {
    expect(dump).not.toContain(secret);
  });
}

/**
 * Make the document look as it does when a `@run-at document-start` script is
 * injected: still loading, with no body yet.
 * @returns Controls to finish parsing (fires DOMContentLoaded) and to restore
 */
function simulateDocumentStart() {
  let readyState = 'loading';
  Object.defineProperty(document, 'readyState', { configurable: true, get: () => readyState });
  document.body?.remove();

  const finishParsing = (bodyHtml = '') => {
    const body = document.createElement('body');
    body.innerHTML = bodyHtml;
    document.documentElement.appendChild(body);
    readyState = 'interactive';
    document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true }));
  };

  return {
    /** Parse the body and dispatch DOMContentLoaded */
    finishParsing,
    /**
     * Put jsdom's own readyState and a body back. Fires DOMContentLoaded first
     * if the test did not, so no listener is left for a later test to trigger:
     * call it while fake timers are still on, then clear the timers.
     */
    restore() {
      if (readyState === 'loading') finishParsing();
      delete document.readyState;
    },
  };
}

module.exports = {
  ACCOUNT_ID,
  CUSTOMER_ID,
  TRANSACTIONS_URL,
  REGENERATE_TOKEN_URL,
  ACCOUNT_DETAIL_URL,
  PROFILE_URL,
  PAGE_HEADERS,
  CAPTURED,
  installFakeXhr,
  sendPageXhr,
  useInMemoryGmStorage,
  expectNoCredentialsInStorage,
  expectNoCredentialsInCalls,
  simulateDocumentStart,
};
