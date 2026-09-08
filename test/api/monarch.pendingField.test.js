/**
 * Tests for the defensive Monarch-native `pending` field write.
 *
 * Monarch's `pending` field is not part of any documented mutation contract, so
 * `updateTransactionWithPending` probes it and latches the result. These tests
 * pin the property that matters most: **the caller's own update always lands**,
 * whether the flag is accepted, rejected, or silently discarded.
 */

import { jest } from '@jest/globals';
import '../setup';
import {
  updateTransactionWithPending,
  isPendingFieldSupported,
  hasPendingFieldBeenProbed,
  getPendingFieldProbe,
  getPersistedPendingFieldProbe,
  resetPendingFieldSupport,
} from '../../src/api/monarch';
import authService from '../../src/services/auth';
import stateManager from '../../src/core/state';

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
  logInfo: jest.fn(),
  logWarning: jest.fn(),
  logError: jest.fn(),
}));

jest.mock('../../src/ui/components/accountSelectorWithCreate', () => ({
  showMonarchAccountSelectorWithCreate: jest.fn(),
}));

describe('Monarch API - native pending field', () => {
  let mockGMXmlHttpRequest;
  /** Backing store for the GM_getValue/GM_setValue stubs */
  let gmStore;

  /**
   * Queue GraphQL responses, one per request, in order.
   *
   * @param responses - Either a transaction payload (success) or
   *   `{ error: 'msg' }` to make that request fail
   */
  function respondWith(...responses) {
    let call = 0;

    mockGMXmlHttpRequest.mockImplementation((options) => {
      const response = responses[Math.min(call, responses.length - 1)];
      call += 1;

      if (response?.error) {
        // Default to a 200-with-GraphQL-errors response; `status` opts into a
        // real HTTP failure, which is how Monarch refused the `pending` field.
        options.onload({
          status: response.status ?? 200,
          responseText: JSON.stringify({
            errors: [{ message: response.error }],
          }),
        });
        return;
      }

      options.onload({
        status: 200,
        responseText: JSON.stringify({
          data: {
            updateTransaction: {
              transaction: response,
              errors: null,
            },
          },
        }),
      });
    });
  }

  /** The parsed `input` of the Nth GraphQL request (0-based) */
  function inputOfCall(n) {
    return JSON.parse(mockGMXmlHttpRequest.mock.calls[n][0].data).variables.input;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    // The latch is module state and deliberately survives calls, so each test
    // must start from an unprobed state.
    resetPendingFieldSupport();

    mockGMXmlHttpRequest = jest.fn();
    globalThis.GM_xmlhttpRequest = mockGMXmlHttpRequest;

    // A real in-memory store, so the persistence behaviour is genuinely
    // exercised rather than asserted against an inert stub.
    gmStore = {};
    globalThis.GM_setValue = jest.fn((key, value) => { gmStore[key] = value; });
    globalThis.GM_getValue = jest.fn((key, fallback) => (key in gmStore ? gmStore[key] : fallback));

    authService.checkMonarchAuth.mockReturnValue({
      authenticated: true,
      credentials: { csrfToken: 'csrf-123', sessionExpiresAt: '2099-12-31T23:59:59Z' },
    });
    stateManager.getState.mockReturnValue({
      currentAccount: { nickname: 'Test Account', name: 'Test Name' },
    });
  });

  describe('when Monarch accepts the field', () => {
    test('sends pending alongside the caller updates in ONE mutation', async () => {
      respondWith({ id: 'tx-1', pending: true, notes: 'hello' });

      const result = await updateTransactionWithPending('tx-1', { notes: 'hello' }, true);

      expect(result.pendingApplied).toBe(true);
      expect(mockGMXmlHttpRequest).toHaveBeenCalledTimes(1);
      expect(inputOfCall(0)).toEqual(expect.objectContaining({
        id: 'tx-1',
        notes: 'hello',
        pending: true,
      }));
    });

    test('returns the updated transaction', async () => {
      respondWith({ id: 'tx-1', pending: true, notes: 'hello' });

      const result = await updateTransactionWithPending('tx-1', { notes: 'hello' }, true);

      expect(result.transaction).toEqual(expect.objectContaining({ id: 'tx-1', pending: true }));
    });

    test('can clear the flag as well as set it', async () => {
      respondWith({ id: 'tx-1', pending: false, notes: 'settled' });

      const result = await updateTransactionWithPending('tx-1', { notes: 'settled' }, false);

      expect(result.pendingApplied).toBe(true);
      expect(inputOfCall(0).pending).toBe(false);
    });

    test('leaves the field marked supported for later calls', async () => {
      respondWith({ id: 'tx-1', pending: true });

      await updateTransactionWithPending('tx-1', {}, true);

      expect(isPendingFieldSupported()).toBe(true);
    });
  });

  describe('when Monarch rejects the field', () => {
    test('retries without the field so the caller updates still apply', async () => {
      respondWith(
        { error: 'Unknown field "pending"' },
        { id: 'tx-1', pending: false, notes: 'hello' },
      );

      const result = await updateTransactionWithPending('tx-1', { notes: 'hello' }, true);

      expect(result.pendingApplied).toBe(false);
      expect(mockGMXmlHttpRequest).toHaveBeenCalledTimes(2);

      // The retry carries the caller's update but NOT the rejected field
      const retryInput = inputOfCall(1);
      expect(retryInput.notes).toBe('hello');
      expect(retryInput).not.toHaveProperty('pending');
    });

    test('returns the transaction from the retry, not the failed attempt', async () => {
      respondWith(
        { error: 'Unknown field "pending"' },
        { id: 'tx-1', notes: 'hello' },
      );

      const result = await updateTransactionWithPending('tx-1', { notes: 'hello' }, true);

      expect(result.transaction).toEqual(expect.objectContaining({ id: 'tx-1', notes: 'hello' }));
    });

    test('latches the field as unsupported', async () => {
      respondWith(
        { error: 'Unknown field "pending"' },
        { id: 'tx-1', notes: 'hello' },
      );

      await updateTransactionWithPending('tx-1', { notes: 'hello' }, true);

      expect(isPendingFieldSupported()).toBe(false);
    });

    test('propagates a genuine failure from the retry', async () => {
      respondWith(
        { error: 'Unknown field "pending"' },
        { error: 'Transaction not found' },
      );

      // The retry's failure is a real error about the caller's own update, so it
      // must not be swallowed.
      await expect(updateTransactionWithPending('tx-1', { notes: 'hello' }, true))
        .rejects.toThrow('Transaction not found');
    });
  });

  describe('when Monarch silently ignores the field', () => {
    test('detects the discarded value from the response', async () => {
      // Mutation succeeds, but the returned pending does not match the request
      respondWith({ id: 'tx-1', pending: false, notes: 'hello' });

      const result = await updateTransactionWithPending('tx-1', { notes: 'hello' }, true);

      expect(result.pendingApplied).toBe(false);
      expect(isPendingFieldSupported()).toBe(false);
    });

    test('does NOT retry, because the rest of the update already applied', async () => {
      respondWith({ id: 'tx-1', pending: false, notes: 'hello' });

      await updateTransactionWithPending('tx-1', { notes: 'hello' }, true);

      expect(mockGMXmlHttpRequest).toHaveBeenCalledTimes(1);
    });

    test('treats a missing pending field in the response as ignored', async () => {
      respondWith({ id: 'tx-1', notes: 'hello' });

      const result = await updateTransactionWithPending('tx-1', { notes: 'hello' }, true);

      expect(result.pendingApplied).toBe(false);
    });
  });

  describe('once latched unsupported', () => {
    /** Trip the latch via a rejected probe */
    async function tripLatch() {
      respondWith(
        { error: 'Unknown field "pending"' },
        { id: 'tx-0' },
      );
      await updateTransactionWithPending('tx-0', {}, true);
      jest.clearAllMocks();
    }

    test('issues a single clean mutation with no pending field', async () => {
      await tripLatch();
      respondWith({ id: 'tx-2', notes: 'later' });

      const result = await updateTransactionWithPending('tx-2', { notes: 'later' }, true);

      // No wasted probe: one call, and the field is not sent at all
      expect(mockGMXmlHttpRequest).toHaveBeenCalledTimes(1);
      expect(inputOfCall(0)).not.toHaveProperty('pending');
      expect(inputOfCall(0).notes).toBe('later');
      expect(result.pendingApplied).toBe(false);
    });

    test('still applies the caller updates', async () => {
      await tripLatch();
      respondWith({ id: 'tx-2', notes: 'later' });

      const result = await updateTransactionWithPending('tx-2', { notes: 'later' }, true);

      expect(result.transaction).toEqual(expect.objectContaining({ notes: 'later' }));
    });

    test('resetPendingFieldSupport allows the field to be probed again', async () => {
      await tripLatch();
      expect(isPendingFieldSupported()).toBe(false);

      resetPendingFieldSupport();

      // A fresh session is optimistic by design, so the field is retried
      expect(isPendingFieldSupported()).toBe(true);
      respondWith({ id: 'tx-3', pending: true });
      const result = await updateTransactionWithPending('tx-3', {}, true);
      expect(result.pendingApplied).toBe(true);
      expect(inputOfCall(0).pending).toBe(true);
    });
  });

  describe('isPendingFieldSupported', () => {
    test('is optimistic before the first probe', () => {
      expect(isPendingFieldSupported()).toBe(true);
    });

    test('reports whether the field has been probed at all', async () => {
      // Distinguishing "unprobed" from "probed and supported" is what stops a
      // later pass claiming a verdict nothing has actually established.
      expect(hasPendingFieldBeenProbed()).toBe(false);

      respondWith({ id: 'tx-1', pending: true });
      await updateTransactionWithPending('tx-1', {}, true);

      expect(hasPendingFieldBeenProbed()).toBe(true);
    });
  });

  describe('the verdict is decided by experiment, not by error text', () => {
    /**
     * The real 400 Monarch returns for the `pending` field.
     *
     * Note how uninformative it is — "Something went wrong while processing" with
     * no mention of the field. Two earlier versions of this code tried to classify
     * failures by pattern-matching the message and got it wrong in both
     * directions: first blaming the field for auth errors, then refusing to blame
     * it for exactly this response. The retry is a far better instrument.
     */
    const MONARCH_400 = {
      status: 400,
      error: 'Something went wrong while processing: None on request_id: None.',
    };

    test('blames the field when removing it fixes the request', async () => {
      // The controlled experiment: one variable changed between the two attempts.
      respondWith(MONARCH_400, { id: 'tx-1', notes: 'hello' });

      const result = await updateTransactionWithPending('tx-1', { notes: 'hello' }, true, 'ownerSync');

      expect(result.pendingApplied).toBe(false);
      expect(isPendingFieldSupported()).toBe(false);
      expect(getPendingFieldProbe()).toMatchObject({ verdict: 'rejected', context: 'ownerSync' });
    });

    test("still applies the caller's update when the field is blamed", async () => {
      // The regression that mattered: 7.11.1 threw here, so owner sync rows failed.
      respondWith(MONARCH_400, { id: 'tx-1', notes: 'hello' });

      const result = await updateTransactionWithPending('tx-1', { notes: 'hello' }, true, 'ownerSync');

      expect(result.transaction).toEqual(expect.objectContaining({ notes: 'hello' }));
      expect(mockGMXmlHttpRequest).toHaveBeenCalledTimes(2);
      expect(inputOfCall(1)).not.toHaveProperty('pending');
    });

    test('does NOT blame the field when the retry fails too', async () => {
      // Failing both ways means the field was never the problem.
      respondWith(
        { status: 500, error: 'upstream exploded' },
        { status: 500, error: 'upstream exploded' },
      );

      await expect(updateTransactionWithPending('tx-1', { notes: 'hello' }, true, 'ownerSync'))
        .rejects.toThrow();

      expect(isPendingFieldSupported()).toBe(true);
      expect(getPendingFieldProbe()).toMatchObject({ verdict: 'inconclusive' });
    });

    test('records inconclusive — not rejected — when a 5xx is fixed by the retry', async () => {
      // Removing the field appeared to help, but a server fault says nothing
      // about the schema, so this must not latch.
      respondWith({ status: 500, error: 'transient' }, { id: 'tx-1', notes: 'hello' });

      const result = await updateTransactionWithPending('tx-1', { notes: 'hello' }, true, 'ownerSync');

      expect(result.transaction).toEqual(expect.objectContaining({ notes: 'hello' }));
      expect(isPendingFieldSupported()).toBe(true);
      expect(getPendingFieldProbe()).toMatchObject({ verdict: 'inconclusive' });
    });

    test('blames the field for a 200-with-GraphQL-errors refusal', async () => {
      // A GraphQL errors array is a refusal by definition, whatever the status.
      respondWith(
        { error: 'Unknown argument "pending"' },
        { id: 'tx-1', notes: 'hello' },
      );

      await updateTransactionWithPending('tx-1', { notes: 'hello' }, true, 'ownerSync');

      expect(isPendingFieldSupported()).toBe(false);
      expect(getPendingFieldProbe().verdict).toBe('rejected');
    });
  });

  describe('authentication failures', () => {
    const authFailures = [
      ['an expired session', 'Monarch Auth Error: Session was invalid or expired.'],
      ['a missing session', 'Monarch session not found. Please open Monarch Money in another tab.'],
    ];

    test.each(authFailures)('rethrows immediately for %s', async (_label, message) => {
      respondWith({ status: 401, error: message });

      await expect(updateTransactionWithPending('tx-1', { notes: 'hello' }, true, 'ownerSync'))
        .rejects.toThrow();

      // No retry: credentials are already cleared, so a second attempt is futile
      expect(mockGMXmlHttpRequest).toHaveBeenCalledTimes(1);
    });

    test('never records a verdict for an auth failure', async () => {
      // This produced the original false "Monarch does not accept the pending
      // field" report, so it is pinned explicitly.
      respondWith({ status: 401, error: 'Monarch Auth Error: Session was invalid or expired.' });

      await expect(updateTransactionWithPending('tx-1', {}, true, 'ownerSync')).rejects.toThrow();

      expect(isPendingFieldSupported()).toBe(true);
      expect(hasPendingFieldBeenProbed()).toBe(false);
      expect(getPendingFieldProbe()).toBeNull();
    });
  });

  describe('probe record', () => {
    test('records a rejection with the verbatim error, context and transaction', async () => {
      // This record is the whole point: without it a later pass can only say
      // "unsupported", with no evidence and no idea which pass decided.
      const monarchError = '[{"message":"Unknown argument \\"pending\\""}]';
      respondWith({ error: monarchError }, { id: 'tx-7', notes: 'hello' });

      await updateTransactionWithPending('tx-7', { notes: 'hello' }, true, 'ownerSync');

      const probe = getPendingFieldProbe();
      expect(probe).toMatchObject({
        verdict: 'rejected',
        context: 'ownerSync',
        transactionId: 'tx-7',
      });
      expect(probe.detail).toContain('Unknown argument');
      expect(probe.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    test('records a silent ignore distinctly from a rejection', async () => {
      // The two verdicts imply completely different next steps, so they must
      // never be collapsed into one.
      respondWith({ id: 'tx-8', pending: false });

      await updateTransactionWithPending('tx-8', {}, true, 'pendingStatusSync');

      const probe = getPendingFieldProbe();
      expect(probe.verdict).toBe('ignored');
      expect(probe.detail).toContain('requested true');
      expect(probe.detail).toContain('returned false');
      expect(probe.context).toBe('pendingStatusSync');
    });

    test('records a success verdict', async () => {
      respondWith({ id: 'tx-9', pending: true });

      await updateTransactionWithPending('tx-9', {}, true, 'rogersReconciliation');

      expect(getPendingFieldProbe()).toMatchObject({
        verdict: 'supported',
        context: 'rogersReconciliation',
      });
    });

    test('is cleared by resetPendingFieldSupport', async () => {
      respondWith({ id: 'tx-1', pending: false });
      await updateTransactionWithPending('tx-1', {}, true);
      expect(getPendingFieldProbe()).not.toBeNull();

      resetPendingFieldSupport();

      expect(getPendingFieldProbe()).toBeNull();
    });
  });

  describe('persistence', () => {
    test('persists a rejection so the verdict survives a lost console', async () => {
      // The evidence was lost once already to a page navigation; writing it down
      // means the answer can always be read back.
      respondWith(
        { error: '[{"message":"Unknown argument \\"pending\\""}]' },
        { id: 'tx-1', notes: 'hello' },
      );

      await updateTransactionWithPending('tx-1', { notes: 'hello' }, true, 'ownerSync');

      const persisted = getPersistedPendingFieldProbe();
      expect(persisted).toMatchObject({ verdict: 'rejected', context: 'ownerSync' });
      expect(persisted.detail).toContain('Unknown argument');
    });

    test('persists a success verdict too', async () => {
      respondWith({ id: 'tx-1', pending: true });

      await updateTransactionWithPending('tx-1', {}, true, 'ownerSync');

      expect(getPersistedPendingFieldProbe()).toMatchObject({ verdict: 'supported' });
    });

    test('survives the session latch being reset', async () => {
      respondWith({ id: 'tx-1', pending: false });
      await updateTransactionWithPending('tx-1', {}, true, 'ownerSync');

      // The runtime latch is session-scoped, but the written record is not —
      // that asymmetry is deliberate.
      resetPendingFieldSupport();

      expect(getPendingFieldProbe()).toBeNull();
      expect(getPersistedPendingFieldProbe()).toMatchObject({ verdict: 'ignored' });
    });

    test('a storage failure never breaks the update', async () => {
      globalThis.GM_setValue = jest.fn(() => { throw new Error('storage quota exceeded'); });
      respondWith({ id: 'tx-1', pending: true });

      const result = await updateTransactionWithPending('tx-1', { notes: 'hello' }, true);

      expect(result.pendingApplied).toBe(true);
    });

    test('returns null when nothing has been persisted', () => {
      expect(getPersistedPendingFieldProbe()).toBeNull();
    });
  });
});
