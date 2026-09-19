/**
 * Tests for Monarch API — response body parsing and promise settlement.
 *
 * Regression coverage for a hang: `JSON.parse` on the response body used to run
 * unguarded inside the `GM_xmlhttpRequest` `onload` handler. That handler runs
 * asynchronously, outside the Promise executor's synchronous flow, so the
 * `SyntaxError` escaped the Promise rather than rejecting it — neither `resolve`
 * nor `reject` ran, the promise never settled, and every awaiting caller hung
 * forever behind a progress dialog that never moved. `src/api/` sets no request
 * timeout, so nothing ever broke the hang.
 *
 * The trigger is a 200 whose body is not JSON, which is ordinary in the field: a
 * WAF or CDN HTML error page, a captive-portal or proxy interstitial, a
 * rate-limit page, a truncated body. Non-200 responses were already handled.
 *
 * This file deliberately does NOT mock `setTimeout` (unlike `monarch.core`),
 * because the deadline in `settlementOf` needs a real timer to fire.
 */

import { jest } from '@jest/globals';
import '../setup';
import { callMonarchGraphQL } from '../../src/api/monarch';
import authService from '../../src/services/auth';
import { settlementOf } from '../helpers/promiseSettlement';

jest.mock('../../src/services/auth', () => ({
  checkMonarchAuth: jest.fn(),
  getMonarchCredentials: jest.fn(),
  setupMonarchTokenCapture: jest.fn(),
  clearMonarchCredentials: jest.fn(),
}));

jest.mock('../../src/core/state', () => ({
  setMonarchAuth: jest.fn(),
  getState: jest.fn(),
}));

jest.mock('../../src/core/utils', () => ({
  debugLog: jest.fn(),
}));

jest.mock('../../src/ui/components/accountSelectorWithCreate', () => ({
  showMonarchAccountSelectorWithCreate: jest.fn(),
}));

describe('Monarch API - response parsing and settlement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    globalThis.GM_xmlhttpRequest = jest.fn();
    authService.checkMonarchAuth.mockReturnValue({
      authenticated: true,
      credentials: { csrfToken: 'test-csrf-token-123', sessionExpiresAt: '2099-12-31T23:59:59Z' },
    });
  });

  /**
   * Deliver a response to `onload` ASYNCHRONOUSLY, which is what makes this bug
   * class reproducible.
   *
   * Invoking `onload` synchronously would hide the bug entirely: the throw would
   * unwind through the `GM_xmlhttpRequest` call and out of the Promise executor,
   * and the Promise constructor would convert it into a rejection. The promise
   * would settle and the test would pass against the unfixed code. A microtask is
   * used rather than a timer so that an escaping throw becomes a quietly
   * unhandled rejection instead of an uncaught exception that derails the runner
   * — the assertion on `state` is then what reports the failure.
   *
   * @param {Object} response - Response object handed to `onload`
   */
  function respondWith(response) {
    globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
      Promise.resolve().then(() => options.onload(response));
    });
  }

  describe('a 200 whose body is not JSON', () => {
    it('rejects instead of hanging forever', async () => {
      respondWith({
        status: 200,
        responseText: '<html><body>Access denied by firewall</body></html>',
      });

      const outcome = await settlementOf(callMonarchGraphQL('GetAccounts', 'query test', {}));

      // 'pending' here is the bug: the promise never settled at all.
      expect(outcome.state).toBe('rejected');
    });

    it('names the operation that failed', async () => {
      respondWith({ status: 200, responseText: 'not json at all' });

      const outcome = await settlementOf(callMonarchGraphQL('GetAccounts', 'query test', {}));

      expect(outcome.state).toBe('rejected');
      expect(outcome.error.message).toContain('GetAccounts');
      expect(outcome.error.message).toContain('not JSON');
    });

    it('quotes the body, which is the only evidence of what actually answered', async () => {
      // Distinguishing a WAF block page from a proxy interstitial from a
      // truncated body is only possible from the body itself.
      respondWith({
        status: 200,
        responseText: '<html><title>Request blocked by Cloudfront</title></html>',
      });

      const outcome = await settlementOf(callMonarchGraphQL('GetAccounts', 'query test', {}));

      expect(outcome.state).toBe('rejected');
      expect(outcome.error.message).toContain('Request blocked by Cloudfront');
    });

    it('truncates a huge body rather than pasting a whole error page into the message', async () => {
      respondWith({ status: 200, responseText: `<html>${'x'.repeat(50000)}</html>` });

      const outcome = await settlementOf(callMonarchGraphQL('GetAccounts', 'query test', {}));

      expect(outcome.state).toBe('rejected');
      // 500-char excerpt plus the surrounding prose; nowhere near the 50KB body.
      expect(outcome.error.message.length).toBeLessThan(1000);
    });

    it('rejects on an empty 200 body', async () => {
      respondWith({ status: 200, responseText: '' });

      const outcome = await settlementOf(callMonarchGraphQL('GetAccounts', 'query test', {}));

      expect(outcome.state).toBe('rejected');
    });

    it('rejects on a truncated JSON body', async () => {
      respondWith({ status: 200, responseText: '{"data": {"accounts": [{"id": "1"' });

      const outcome = await settlementOf(callMonarchGraphQL('GetAccounts', 'query test', {}));

      expect(outcome.state).toBe('rejected');
    });
  });

  describe('the guard does not swallow the success path', () => {
    it('still resolves with data on a well-formed 200', async () => {
      respondWith({
        status: 200,
        responseText: JSON.stringify({ data: { accounts: [{ id: '1' }] } }),
      });

      const outcome = await settlementOf(callMonarchGraphQL('GetAccounts', 'query test', {}));

      expect(outcome.state).toBe('resolved');
      expect(outcome.value).toEqual({ accounts: [{ id: '1' }] });
    });

    it('still rejects with the GraphQL errors array when the body parses', async () => {
      respondWith({
        status: 200,
        responseText: JSON.stringify({ errors: [{ message: 'field not accepted' }] }),
      });

      const outcome = await settlementOf(callMonarchGraphQL('GetAccounts', 'query test', {}));

      expect(outcome.state).toBe('rejected');
      expect(outcome.error.message).toContain('field not accepted');
    });

    it('settles rather than hanging when the body is valid JSON but null', async () => {
      // `null.errors` threw a TypeError, wedging the promise exactly as the
      // parse failure did.
      respondWith({ status: 200, responseText: 'null' });

      const outcome = await settlementOf(callMonarchGraphQL('GetAccounts', 'query test', {}));

      expect(outcome.state).toBe('resolved');
      expect(outcome.value).toBeUndefined();
    });
  });

  describe('unexpected throws inside the handler', () => {
    it('rejects rather than hanging when clearing credentials throws on a 401', async () => {
      // Any throw inside the async handler wedges the promise, not just a parse
      // failure. The broad catch is what makes this survivable.
      authService.clearMonarchCredentials.mockImplementation(() => {
        throw new Error('storage unavailable');
      });
      respondWith({ status: 401, responseText: '' });

      const outcome = await settlementOf(callMonarchGraphQL('GetAccounts', 'query test', {}));

      expect(outcome.state).toBe('rejected');
      expect(outcome.error.message).toContain('storage unavailable');
    });
  });
});
