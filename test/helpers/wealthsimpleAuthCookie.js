/**
 * Test helpers for Wealthsimple authentication.
 *
 * The Wealthsimple access token is read from the page's `_oauth2_access_v2`
 * cookie whenever it is needed and is never stored (see `checkAuth` in
 * `src/api/wealthsimple.ts`). Suites authenticate by setting that cookie, the
 * way Wealthsimple's own web app does, not by seeding userscript storage.
 *
 * Suites using these helpers must make `document.cookie` a plain writable
 * property (`Object.defineProperty(document, 'cookie', { writable: true, value: '' })`)
 * so that setting it replaces the whole cookie string.
 */

const OAUTH_COOKIE_NAME = '_oauth2_access_v2';

/** The access token used when a suite does not pass its own */
const TEST_ACCESS_TOKEN = 'test-token';

let cookieSequence = 0;

/**
 * Build the raw (URI-encoded) value of the Wealthsimple OAuth cookie
 * @param {Object} [auth] - Token fields; anything omitted gets a valid default
 * @param {string} [auth.accessToken]
 * @param {string} [auth.identityId]
 * @param {string} [auth.expiresAt] - ISO timestamp, defaults to one hour from now
 * @param {string} [auth.investProfile]
 * @param {string} [auth.tradeProfile]
 * @returns {string} Raw cookie value
 */
function buildOAuthCookieValue({
  accessToken = TEST_ACCESS_TOKEN,
  identityId = 'identity-123',
  expiresAt = new Date(Date.now() + 3600000).toISOString(),
  investProfile,
  tradeProfile,
} = {}) {
  cookieSequence += 1;
  const payload = {
    access_token: accessToken,
    identity_canonical_id: identityId,
    expires_at: expiresAt,
    // Makes every cookie value unique, as each token refresh on the real site
    // is, so a 401 recorded against one test's cookie never matches the next.
    test_sequence: cookieSequence,
  };
  if (investProfile || tradeProfile) {
    payload.profiles = {
      ...(investProfile ? { invest: { default: investProfile } } : {}),
      ...(tradeProfile ? { trade: { default: tradeProfile } } : {}),
    };
  }
  return encodeURIComponent(JSON.stringify(payload));
}

/**
 * Sign in: set the OAuth cookie as Wealthsimple's web app does
 * @param {Object} [auth] - See buildOAuthCookieValue
 * @param {string} [otherCookies] - Other cookies to keep alongside it
 * @returns {string} The raw cookie value that was set
 */
function setWealthsimpleAuthCookie(auth = {}, otherCookies = '') {
  const value = buildOAuthCookieValue(auth);
  const cookie = `${OAUTH_COOKIE_NAME}=${value}`;
  document.cookie = otherCookies ? `${otherCookies}; ${cookie}` : cookie;
  return value;
}

/** Sign out: remove every cookie */
function clearWealthsimpleAuthCookie() {
  document.cookie = '';
}

/**
 * Sign in for an API test (null signs out). GM storage holds no auth, so
 * GM_getValue only answers the debug log level and otherwise returns defaults.
 * @param {Object|null} authData - Token fields for the cookie, see buildOAuthCookieValue
 */
function setupWealthsimpleAuth(authData) {
  if (authData) {
    setWealthsimpleAuthCookie(authData);
  } else {
    clearWealthsimpleAuthCookie();
  }
  globalThis.GM_getValue.mockImplementation((key, defaultValue) => {
    if (key === 'debug_log_level') return 'info';
    return defaultValue !== undefined ? defaultValue : null;
  });
}

/**
 * Back the GM_* storage functions with a Map, so a suite can inspect exactly
 * what reached userscript storage
 * @param {Object} [initial] - Initial key/value pairs
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

module.exports = {
  OAUTH_COOKIE_NAME,
  TEST_ACCESS_TOKEN,
  buildOAuthCookieValue,
  setWealthsimpleAuthCookie,
  clearWealthsimpleAuthCookie,
  setupWealthsimpleAuth,
  useInMemoryGmStorage,
};
