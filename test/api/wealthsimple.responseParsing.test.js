/**
 * Tests for Wealthsimple API — response body parsing and promise settlement.
 *
 * `makeGraphQLQuery` and `validateToken` already wrapped `JSON.parse` in
 * try/catch, unlike the Monarch and Questrade clients — but neither guard was
 * covered by a test, so nothing stopped the guard being dropped and reintroducing
 * the hang. A throw that escapes a `GM_xmlhttpRequest` `onload` handler settles
 * the promise neither way, and with no request timeout configured in `src/api/`
 * the awaiting caller hangs permanently.
 *
 * These tests also cover the outer settlement guard, which catches throws from
 * everything in the handler that is not the parse.
 */

import { makeGraphQLQuery } from '../../src/api/wealthsimple';
import { STORAGE } from '../../src/core/config';
import { settlementOf } from '../helpers/promiseSettlement';

global.GM_getValue = jest.fn();
global.GM_setValue = jest.fn();
global.GM_deleteValue = jest.fn();
global.GM_xmlhttpRequest = jest.fn();

jest.mock('../../src/core/state', () => ({
  __esModule: true,
  default: {
    setWealthsimpleAuth: jest.fn(),
  },
}));

describe('Wealthsimple API - response parsing and settlement', () => {
  let stateManager;

  beforeEach(() => {
    jest.clearAllMocks();
    stateManager = jest.requireMock('../../src/core/state').default;

    // configStore.getAuth() reads GM_getValue(STORAGE.WEALTHSIMPLE_CONFIG) and
    // parses it, so authentication is established through that key.
    GM_getValue.mockImplementation((key, defaultValue) => {
      if (key === STORAGE.WEALTHSIMPLE_CONFIG) {
        return JSON.stringify({
          auth: {
            accessToken: 'test-token',
            identityId: 'identity-123',
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
          },
        });
      }
      if (key === 'debug_log_level') return 'info';
      return defaultValue !== undefined ? defaultValue : null;
    });
  });

  /**
   * Deliver a response to `onload` ASYNCHRONOUSLY, which is what makes this bug
   * class reproducible. A synchronous call would let the Promise constructor turn
   * the throw into a rejection, hiding the defect.
   *
   * @param {Object} response - Response object handed to `onload`
   */
  function respondWith(response) {
    global.GM_xmlhttpRequest.mockImplementation((options) => {
      Promise.resolve().then(() => options.onload(response));
    });
  }

  describe('a 200 whose body is not JSON', () => {
    it('rejects instead of hanging forever', async () => {
      respondWith({
        status: 200,
        responseText: '<html><body>Access denied</body></html>',
      });

      const outcome = await settlementOf(makeGraphQLQuery('FetchAccounts', 'query test', {}));

      // 'pending' here would be the bug: a promise that never settled.
      expect(outcome.state).toBe('rejected');
      expect(outcome.error.message).toContain('Failed to parse response');
    });

    it('rejects on a truncated JSON body', async () => {
      respondWith({ status: 200, responseText: '{"data": {"identity"' });

      const outcome = await settlementOf(makeGraphQLQuery('FetchAccounts', 'query test', {}));

      expect(outcome.state).toBe('rejected');
    });
  });

  describe('the guard does not swallow the success path', () => {
    it('still resolves with data on a well-formed 200', async () => {
      respondWith({
        status: 200,
        responseText: JSON.stringify({ data: { identity: { id: 'identity-123' } } }),
      });

      const outcome = await settlementOf(makeGraphQLQuery('FetchAccounts', 'query test', {}));

      expect(outcome.state).toBe('resolved');
      expect(outcome.value).toEqual({ identity: { id: 'identity-123' } });
    });

    it('resolves with undefined for an empty 200 body, which is treated as `{}`', async () => {
      respondWith({ status: 200, responseText: '' });

      const outcome = await settlementOf(makeGraphQLQuery('FetchAccounts', 'query test', {}));

      expect(outcome.state).toBe('resolved');
      expect(outcome.value).toBeUndefined();
    });

    it('still rejects with the GraphQL errors when the body parses', async () => {
      respondWith({
        status: 200,
        responseText: JSON.stringify({ errors: [{ message: 'field not accepted' }] }),
      });

      const outcome = await settlementOf(makeGraphQLQuery('FetchAccounts', 'query test', {}));

      expect(outcome.state).toBe('rejected');
      expect(outcome.error.message).toContain('field not accepted');
    });
  });

  describe('unexpected throws inside the handler', () => {
    it('rejects rather than hanging when clearing the token throws on a 401', async () => {
      // The inner catch only covers the parse. Any other throw in the handler
      // wedges the promise just as effectively, which is what the outer guard is
      // for — here via `clearTokenData` -> `stateManager.setWealthsimpleAuth`.
      stateManager.setWealthsimpleAuth.mockImplementation(() => {
        throw new Error('state write failed');
      });
      respondWith({ status: 401, responseText: '' });

      const outcome = await settlementOf(makeGraphQLQuery('FetchAccounts', 'query test', {}));

      expect(outcome.state).toBe('rejected');
      expect(outcome.error.message).toContain('state write failed');
    });

    it('rejects rather than hanging when `errors` is not an array', async () => {
      // `data.errors.map((e) => e.message)` throws a TypeError on a non-array
      // `errors`. This one happens to land inside the pre-existing inner catch, so
      // it already settled before the outer guard was added — it is pinned here
      // because that inner catch is the only thing making it settle, and nothing
      // else asserts as much.
      respondWith({
        status: 200,
        responseText: JSON.stringify({ errors: { length: 2, message: 'not an array' } }),
      });

      const outcome = await settlementOf(makeGraphQLQuery('FetchAccounts', 'query test', {}));

      expect(outcome.state).toBe('rejected');
    });
  });
});
