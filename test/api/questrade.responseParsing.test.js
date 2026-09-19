/**
 * Tests for Questrade API — response body parsing and promise settlement.
 *
 * Regression coverage for the same hang guarded in
 * `monarch.responseParsing.test.js`: `resolve(JSON.parse(res.responseText))` ran
 * unguarded inside the `GM_xmlhttpRequest` `onload` handler. The handler runs
 * asynchronously, outside the Promise executor's synchronous flow, so the
 * `SyntaxError` escaped the Promise rather than rejecting it and the promise
 * never settled. With no request timeout configured anywhere in `src/api/`, every
 * awaiting caller hung permanently.
 */

import { makeQuestradeApiCall } from '../../src/api/questrade';
import { settlementOf } from '../helpers/promiseSettlement';

jest.mock('../../src/core/utils', () => ({
  debugLog: jest.fn(),
}));

jest.mock('../../src/core/state', () => ({
  __esModule: true,
  default: {
    setQuestradeAuth: jest.fn(),
  },
}));

jest.mock('../../src/services/questrade/auth', () => ({
  __esModule: true,
  default: {
    checkQuestradeAuth: jest.fn(),
    getQuestradeToken: jest.fn(),
    waitForQuestradeToken: jest.fn(),
    saveQuestradeToken: jest.fn(),
  },
}));

globalThis.GM_getValue = jest.fn();
globalThis.GM_setValue = jest.fn();
globalThis.GM_xmlhttpRequest = jest.fn();

describe('Questrade API - response parsing and settlement', () => {
  let authService;

  beforeEach(() => {
    jest.clearAllMocks();
    authService = jest.requireMock('../../src/services/questrade/auth').default;
    globalThis.GM_getValue.mockReturnValue('[]');
    authService.checkQuestradeAuth.mockReturnValue({
      authenticated: true,
      token: 'Bearer test-token',
    });
  });

  /**
   * Deliver a response to `onload` ASYNCHRONOUSLY, which is what makes this bug
   * class reproducible.
   *
   * Invoking `onload` synchronously would hide the bug: the throw would unwind
   * out of the Promise executor and the Promise constructor would turn it into a
   * rejection, so the test would pass against the unfixed code. A microtask is
   * used rather than a timer so that an escaping throw becomes a quietly
   * unhandled rejection instead of an uncaught exception that derails the runner.
   *
   * @param {Object} response - Response object handed to `onload`
   */
  function respondWith(response) {
    globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
      Promise.resolve().then(() => options.onload(response));
    });
  }

  describe('a success status whose body is not JSON', () => {
    it('rejects instead of hanging forever', async () => {
      respondWith({
        status: 200,
        responseText: '<html><body>Rate limited</body></html>',
      });

      const outcome = await settlementOf(makeQuestradeApiCall('/v1/accounts'));

      // 'pending' here is the bug: the promise never settled at all.
      expect(outcome.state).toBe('rejected');
    });

    it('names the endpoint that failed and quotes the body', async () => {
      respondWith({
        status: 200,
        responseText: '<html><title>Proxy authentication required</title></html>',
      });

      const outcome = await settlementOf(makeQuestradeApiCall('/v1/accounts'));

      expect(outcome.state).toBe('rejected');
      expect(outcome.error.message).toContain('/v1/accounts');
      expect(outcome.error.message).toContain('not JSON');
      expect(outcome.error.message).toContain('Proxy authentication required');
    });

    it('truncates a huge body rather than pasting a whole error page into the message', async () => {
      respondWith({ status: 200, responseText: `<html>${'x'.repeat(50000)}</html>` });

      const outcome = await settlementOf(makeQuestradeApiCall('/v1/accounts'));

      expect(outcome.state).toBe('rejected');
      expect(outcome.error.message.length).toBeLessThan(1000);
    });

    it('rejects on an empty body', async () => {
      respondWith({ status: 200, responseText: '' });

      const outcome = await settlementOf(makeQuestradeApiCall('/v1/accounts'));

      expect(outcome.state).toBe('rejected');
    });

    it('rejects on a truncated JSON body', async () => {
      respondWith({ status: 200, responseText: '[{"number": "123"' });

      const outcome = await settlementOf(makeQuestradeApiCall('/v1/accounts'));

      expect(outcome.state).toBe('rejected');
    });

    it('rejects on a non-200 success status with a non-JSON body', async () => {
      // The guarded branch is `>= 200 && < 300`, not just 200.
      respondWith({ status: 202, responseText: 'Accepted' });

      const outcome = await settlementOf(makeQuestradeApiCall('/v1/accounts'));

      expect(outcome.state).toBe('rejected');
    });
  });

  describe('the guard does not swallow the success path', () => {
    it('still resolves with the parsed body on a well-formed 200', async () => {
      respondWith({
        status: 200,
        responseText: JSON.stringify({ accounts: [{ id: '123', type: 'Margin' }] }),
      });

      const outcome = await settlementOf(makeQuestradeApiCall('/v1/accounts'));

      expect(outcome.state).toBe('resolved');
      expect(outcome.value).toEqual({ accounts: [{ id: '123', type: 'Margin' }] });
    });
  });

  describe('unexpected throws inside the handler', () => {
    it('rejects rather than hanging when clearing the token throws on a 401', async () => {
      // Any throw inside the async handler wedges the promise, not just a parse
      // failure.
      authService.saveQuestradeToken.mockImplementation(() => {
        throw new Error('storage unavailable');
      });
      respondWith({ status: 401, responseText: '' });

      const outcome = await settlementOf(makeQuestradeApiCall('/v1/accounts'));

      expect(outcome.state).toBe('rejected');
      expect(outcome.error.message).toContain('storage unavailable');
    });
  });
});
