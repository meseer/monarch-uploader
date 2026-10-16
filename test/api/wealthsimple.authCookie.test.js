/**
 * Tests for Wealthsimple authentication read from the page's OAuth cookie.
 *
 * The access token is read from the non-HttpOnly `_oauth2_access_v2` cookie
 * whenever it is needed and is never stored (ADR-010). Covers:
 * - checkAuth reading the cookie on demand, with no cached or stored copy
 * - nothing about Wealthsimple auth reaching userscript or page storage
 * - setupTokenMonitoring publishing changes (only) to stateManager, once
 * - a 401 marking the token rejected until the cookie value changes
 *
 * Module state (the monitoring timer and the rejected cookie value) lives for
 * the page, so each test loads a fresh copy of the module.
 */

const {
  OAUTH_COOKIE_NAME,
  buildOAuthCookieValue,
  setWealthsimpleAuthCookie,
  clearWealthsimpleAuthCookie,
  useInMemoryGmStorage,
} = require('../helpers/wealthsimpleAuthCookie');

jest.mock('../../src/core/state', () => ({
  __esModule: true,
  default: {
    setWealthsimpleAuth: jest.fn(),
  },
}));

jest.mock('../../src/core/utils', () => ({
  ...jest.requireActual('../../src/core/utils'),
  debugLog: jest.fn(),
}));

Object.defineProperty(document, 'cookie', {
  writable: true,
  value: '',
});

const ONE_HOUR_MS = 3600000;

/**
 * Load a fresh copy of the Wealthsimple API module and its mocked collaborators
 */
function loadFreshModule() {
  let api;
  let stateManager;
  let debugLog;
  jest.isolateModules(() => {
    api = require('../../src/api/wealthsimple');
    stateManager = require('../../src/core/state').default;
    ({ debugLog } = require('../../src/core/utils'));
  });
  return { api, stateManager, debugLog };
}

/** Make GM_xmlhttpRequest answer every request with the given status */
function respondWith(status, body = { data: {} }) {
  GM_xmlhttpRequest.mockImplementation(({ onload }) => {
    onload({ status, responseText: JSON.stringify(body) });
  });
}

/** The bearer token of the nth request (0-based) */
function bearerOfRequest(index) {
  return GM_xmlhttpRequest.mock.calls[index][0].headers.authorization;
}

describe('Wealthsimple auth read from the OAuth cookie', () => {
  let store;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    clearWealthsimpleAuthCookie();
    store = useInMemoryGmStorage();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('checkAuth reads the cookie on demand', () => {
    it('is not authenticated when the page has no OAuth cookie', () => {
      const { api } = loadFreshModule();

      expect(api.checkAuth()).toEqual({
        authenticated: false,
        token: null,
        identityId: null,
        expiresAt: null,
      });
    });

    it('returns the token, identity, expiry and profiles from the cookie', () => {
      const expiresAt = new Date(Date.now() + ONE_HOUR_MS).toISOString();
      setWealthsimpleAuthCookie({
        accessToken: 'cookie-token',
        identityId: 'identity-abc',
        expiresAt,
        investProfile: 'invest-456',
        tradeProfile: 'trade-789',
      });
      const { api } = loadFreshModule();

      expect(api.checkAuth()).toEqual({
        authenticated: true,
        token: 'cookie-token',
        identityId: 'identity-abc',
        expiresAt,
        investProfile: 'invest-456',
        tradeProfile: 'trade-789',
      });
    });

    it('defaults missing profiles to null', () => {
      setWealthsimpleAuthCookie();
      const { api } = loadFreshModule();

      const status = api.checkAuth();

      expect(status.investProfile).toBeNull();
      expect(status.tradeProfile).toBeNull();
    });

    it('re-reads the cookie on every call, with no cached copy', () => {
      const { api } = loadFreshModule();
      setWealthsimpleAuthCookie({ accessToken: 'first-token' });
      expect(api.checkAuth().token).toBe('first-token');

      // The page refreshes its token
      setWealthsimpleAuthCookie({ accessToken: 'refreshed-token' });
      expect(api.checkAuth().token).toBe('refreshed-token');

      // The user signs out
      clearWealthsimpleAuthCookie();
      expect(api.checkAuth().authenticated).toBe(false);
    });

    it('finds the cookie among other cookies and ignores look-alike names', () => {
      const value = buildOAuthCookieValue({ accessToken: 'real-token' });
      document.cookie = `x${OAUTH_COOKIE_NAME}=${buildOAuthCookieValue({ accessToken: 'decoy' })}; `
        + `theme=dark; ${OAUTH_COOKIE_NAME}=${value}; other=1`;
      const { api } = loadFreshModule();

      expect(api.checkAuth().token).toBe('real-token');
    });

    it('reports an expired token as expired, without the token', () => {
      const expiresAt = new Date(Date.now() - 1000).toISOString();
      setWealthsimpleAuthCookie({ expiresAt });
      const { api } = loadFreshModule();

      expect(api.checkAuth()).toEqual({
        authenticated: false,
        token: null,
        identityId: null,
        expiresAt,
        expired: true,
      });
    });

    it('is not authenticated when the cookie has no access token', () => {
      setWealthsimpleAuthCookie({ accessToken: '' });
      const { api } = loadFreshModule();

      expect(api.checkAuth().authenticated).toBe(false);
    });

    it('treats a malformed cookie as signed out and does not log its contents', () => {
      document.cookie = `${OAUTH_COOKIE_NAME}=secret-fragment-not-json`;
      const { api, debugLog } = loadFreshModule();

      expect(api.checkAuth().authenticated).toBe(false);
      expect(JSON.stringify(debugLog.mock.calls)).not.toContain('secret-fragment');
    });

    it('ignores a token an older version left in wealthsimple_config', () => {
      store.set('wealthsimple_config', JSON.stringify({
        auth: {
          accessToken: 'stored-token',
          identityId: 'identity-123',
          expiresAt: new Date(Date.now() + ONE_HOUR_MS).toISOString(),
        },
      }));
      const { api } = loadFreshModule();

      expect(api.checkAuth().authenticated).toBe(false);
    });

    it('sends the token from the current cookie with each request', async () => {
      respondWith(200);
      const { api } = loadFreshModule();

      setWealthsimpleAuthCookie({ accessToken: 'first-token' });
      await api.makeGraphQLQuery('TestQuery', 'query { test }', {});
      setWealthsimpleAuthCookie({ accessToken: 'refreshed-token' });
      await api.makeGraphQLQuery('TestQuery', 'query { test }', {});

      expect(bearerOfRequest(0)).toBe('Bearer first-token');
      expect(bearerOfRequest(1)).toBe('Bearer refreshed-token');
    });
  });

  describe('nothing about Wealthsimple auth is written anywhere', () => {
    it('leaves userscript storage, page storage and cookies untouched', async () => {
      const cookieValue = setWealthsimpleAuthCookie({ accessToken: 'secret-access-token' });
      const cookieBefore = document.cookie;
      // jsdom's localStorage uses Storage.prototype; test/setup.js replaces
      // sessionStorage with a mock whose setItem is already a jest.fn
      const localSetItem = jest.spyOn(Storage.prototype, 'setItem');
      const { api } = loadFreshModule();

      api.setupTokenMonitoring();
      jest.advanceTimersByTime(5000);
      api.checkAuth();
      respondWith(200);
      await api.makeGraphQLQuery('TestQuery', 'query { test }', {});
      respondWith(401);
      await expect(api.makeGraphQLQuery('TestQuery', 'query { test }', {})).rejects.toThrow();
      jest.advanceTimersByTime(5000);

      expect(store.size).toBe(0);
      expect(GM_setValue).not.toHaveBeenCalled();
      expect(GM_deleteValue).not.toHaveBeenCalled();
      expect(localSetItem).not.toHaveBeenCalled();
      expect(sessionStorage.setItem).not.toHaveBeenCalled();
      expect(document.cookie).toBe(cookieBefore);
      expect(document.cookie).toContain(cookieValue);
      localSetItem.mockRestore();
    });
  });

  describe('setupTokenMonitoring', () => {
    it('publishes the current status at once, without the token', () => {
      const expiresAt = new Date(Date.now() + ONE_HOUR_MS).toISOString();
      setWealthsimpleAuthCookie({ accessToken: 'secret-access-token', identityId: 'identity-abc', expiresAt });
      const { api, stateManager } = loadFreshModule();

      api.setupTokenMonitoring();

      expect(stateManager.setWealthsimpleAuth).toHaveBeenCalledTimes(1);
      expect(stateManager.setWealthsimpleAuth).toHaveBeenCalledWith({
        authenticated: true,
        identityId: 'identity-abc',
        expiresAt,
      });
      expect(JSON.stringify(stateManager.setWealthsimpleAuth.mock.calls)).not.toContain('secret-access-token');
    });

    it('does not publish again while nothing changes', () => {
      setWealthsimpleAuthCookie();
      const { api, stateManager } = loadFreshModule();

      api.setupTokenMonitoring();
      jest.advanceTimersByTime(30000);

      expect(stateManager.setWealthsimpleAuth).toHaveBeenCalledTimes(1);
    });

    it('publishes when the user signs in, the token is refreshed, and the user signs out', () => {
      const { api, stateManager } = loadFreshModule();
      api.setupTokenMonitoring();
      expect(stateManager.setWealthsimpleAuth).toHaveBeenLastCalledWith(null);

      const firstExpiry = new Date(Date.now() + ONE_HOUR_MS).toISOString();
      setWealthsimpleAuthCookie({ expiresAt: firstExpiry });
      jest.advanceTimersByTime(1000);
      expect(stateManager.setWealthsimpleAuth).toHaveBeenLastCalledWith(
        expect.objectContaining({ authenticated: true, expiresAt: firstExpiry }),
      );

      const refreshedExpiry = new Date(Date.now() + 2 * ONE_HOUR_MS).toISOString();
      setWealthsimpleAuthCookie({ expiresAt: refreshedExpiry });
      jest.advanceTimersByTime(1000);
      expect(stateManager.setWealthsimpleAuth).toHaveBeenLastCalledWith(
        expect.objectContaining({ authenticated: true, expiresAt: refreshedExpiry }),
      );

      clearWealthsimpleAuthCookie();
      jest.advanceTimersByTime(1000);
      expect(stateManager.setWealthsimpleAuth).toHaveBeenLastCalledWith(null);
      expect(stateManager.setWealthsimpleAuth).toHaveBeenCalledTimes(4);
    });

    it('publishes when the token expires while the page is open', () => {
      setWealthsimpleAuthCookie({ expiresAt: new Date(Date.now() + 5000).toISOString() });
      const { api, stateManager } = loadFreshModule();
      api.setupTokenMonitoring();
      expect(stateManager.setWealthsimpleAuth).toHaveBeenLastCalledWith(
        expect.objectContaining({ authenticated: true }),
      );

      jest.advanceTimersByTime(6000);

      expect(stateManager.setWealthsimpleAuth).toHaveBeenLastCalledWith(null);
    });

    it('re-checks the cookie when the tab becomes visible again', () => {
      const { api, stateManager } = loadFreshModule();
      api.setupTokenMonitoring();
      setWealthsimpleAuthCookie();

      document.dispatchEvent(new Event('visibilitychange'));

      expect(stateManager.setWealthsimpleAuth).toHaveBeenLastCalledWith(
        expect.objectContaining({ authenticated: true }),
      );
    });

    it('starts only once when called again', () => {
      const setIntervalSpy = jest.spyOn(global, 'setInterval');
      setWealthsimpleAuthCookie();
      const { api, stateManager } = loadFreshModule();

      api.setupTokenMonitoring();
      api.setupTokenMonitoring();

      expect(setIntervalSpy).toHaveBeenCalledTimes(1);
      expect(stateManager.setWealthsimpleAuth).toHaveBeenCalledTimes(1);
      setIntervalSpy.mockRestore();
    });

    it('keeps polling when a state listener throws', () => {
      const { api, stateManager } = loadFreshModule();
      stateManager.setWealthsimpleAuth.mockImplementationOnce(() => {
        throw new Error('listener failed');
      });

      expect(() => api.setupTokenMonitoring()).not.toThrow();
      setWealthsimpleAuthCookie();
      jest.advanceTimersByTime(1000);

      expect(stateManager.setWealthsimpleAuth).toHaveBeenLastCalledWith(
        expect.objectContaining({ authenticated: true }),
      );
    });
  });

  describe('a 401 marks the token rejected until the cookie changes', () => {
    it('stops using the rejected token and publishes the signed-out state', async () => {
      setWealthsimpleAuthCookie({ accessToken: 'rejected-token' });
      respondWith(401);
      const { api, stateManager } = loadFreshModule();

      await expect(api.makeGraphQLQuery('TestQuery', 'query { test }', {}))
        .rejects.toThrow('Auth token expired. Please refresh the page.');

      expect(api.checkAuth()).toEqual(expect.objectContaining({ authenticated: false, token: null, expired: true }));
      expect(stateManager.setWealthsimpleAuth).toHaveBeenLastCalledWith(null);

      // The same cookie is not sent again
      await expect(api.makeGraphQLQuery('TestQuery', 'query { test }', {}))
        .rejects.toThrow('Wealthsimple auth token not found');
      expect(GM_xmlhttpRequest).toHaveBeenCalledTimes(1);
    });

    it('uses the token again once the page writes a new cookie value', async () => {
      setWealthsimpleAuthCookie({ accessToken: 'rejected-token' });
      respondWith(401);
      const { api } = loadFreshModule();
      await expect(api.makeGraphQLQuery('TestQuery', 'query { test }', {})).rejects.toThrow();

      setWealthsimpleAuthCookie({ accessToken: 'refreshed-token' });
      respondWith(200);

      expect(api.checkAuth()).toEqual(expect.objectContaining({ authenticated: true, token: 'refreshed-token' }));
      await api.makeGraphQLQuery('TestQuery', 'query { test }', {});
      expect(bearerOfRequest(1)).toBe('Bearer refreshed-token');
    });

    it('lets monitoring publish the refreshed token after a rejection', async () => {
      setWealthsimpleAuthCookie({ accessToken: 'rejected-token' });
      respondWith(401);
      const { api, stateManager } = loadFreshModule();
      api.setupTokenMonitoring();
      await expect(api.makeGraphQLQuery('TestQuery', 'query { test }', {})).rejects.toThrow();
      jest.advanceTimersByTime(3000);
      expect(stateManager.setWealthsimpleAuth).toHaveBeenLastCalledWith(null);

      setWealthsimpleAuthCookie({ accessToken: 'refreshed-token' });
      jest.advanceTimersByTime(1000);

      expect(stateManager.setWealthsimpleAuth).toHaveBeenLastCalledWith(
        expect.objectContaining({ authenticated: true }),
      );
    });

    it('rejects only the cookie the request was sent with', async () => {
      setWealthsimpleAuthCookie({ accessToken: 'old-token' });
      let deliverResponse;
      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        deliverResponse = onload;
      });
      const { api } = loadFreshModule();

      const request = api.makeGraphQLQuery('TestQuery', 'query { test }', {});
      // Handled below; this only stops an early failure leaving it unhandled
      request.catch(() => {});
      // The page refreshes its token while the request is in flight
      setWealthsimpleAuthCookie({ accessToken: 'new-token' });
      deliverResponse({ status: 401, responseText: '' });
      await expect(request).rejects.toThrow('Auth token expired');

      expect(api.checkAuth()).toEqual(expect.objectContaining({ authenticated: true, token: 'new-token' }));
    });
  });
});
