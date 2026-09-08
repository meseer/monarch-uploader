/**
 * Tests for the post-upload pending status sync.
 *
 * The pass reconciles Monarch's native `pending` flag from our `Pending` tag,
 * using the tag as a self-maintaining work queue. The properties that matter:
 * it is nearly free in the steady state, it never throws, and an unsupported
 * field costs exactly one wasted mutation.
 */

import { jest } from '@jest/globals';
import {
  syncPendingStatuses,
  formatPendingStatusMessage,
} from '../../../src/services/common/pendingStatusSync';
import monarchApi from '../../../src/api/monarch';

jest.mock('../../../src/core/utils', () => ({
  debugLog: jest.fn(),
  logInfo: jest.fn(),
  logWarning: jest.fn(),
  logError: jest.fn(),
  formatDate: jest.fn((date) => {
    const d = date instanceof Date ? date : new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }),
}));

jest.mock('../../../src/api/monarch', () => ({
  __esModule: true,
  default: {
    getTagByName: jest.fn(),
    getTransactionsList: jest.fn(),
    updateTransactionWithPending: jest.fn(),
    isPendingFieldSupported: jest.fn(),
    // Read when reporting an unsupported field, so the log can cite the actual
    // evidence and the pass that produced it.
    getPendingFieldProbe: jest.fn(() => null),
  },
}));

describe('pendingStatusSync', () => {
  const PENDING_TAG = { id: 'tag-pending', name: 'Pending' };

  /** Arrange the Pending tag queue to contain the given Monarch rows */
  function queueContains(...rows) {
    monarchApi.getTagByName.mockResolvedValue(PENDING_TAG);
    monarchApi.getTransactionsList.mockResolvedValue({ results: rows });
  }

  /** Default params; `sleep` is stubbed so the tag retry never really waits */
  const params = {
    monarchAccountId: 'acct-1',
    lookbackDays: 90,
    sleep: () => Promise.resolve(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Optimistic by default, matching a fresh session
    monarchApi.isPendingFieldSupported.mockReturnValue(true);
    monarchApi.updateTransactionWithPending.mockResolvedValue({ transaction: {}, pendingApplied: true });
    monarchApi.getPendingFieldProbe.mockReturnValue(null);
  });

  describe('nothing to do', () => {
    test('no-ops when the Pending tag does not exist', async () => {
      monarchApi.getTagByName.mockResolvedValue(null);

      const result = await syncPendingStatuses(params);

      expect(result.noPendingTag).toBe(true);
      expect(result.success).toBe(true);
      expect(monarchApi.updateTransactionWithPending).not.toHaveBeenCalled();
    });

    test('no-ops when no transaction carries the Pending tag', async () => {
      queueContains();

      const result = await syncPendingStatuses(params);

      expect(result.noPendingTransactions).toBe(true);
      expect(monarchApi.updateTransactionWithPending).not.toHaveBeenCalled();
    });
  });

  describe('flagging', () => {
    test('marks a tagged transaction that is not yet natively pending', async () => {
      queueContains({ id: 'tx-1', pending: false });

      const result = await syncPendingStatuses(params);

      expect(result.flagged).toBe(1);
      // The 4th argument labels the probing pass in diagnostics
      expect(monarchApi.updateTransactionWithPending).toHaveBeenCalledWith(
        'tx-1', {}, true, 'pendingStatusSync',
      );
    });

    test('does not touch notes or tags when flagging', async () => {
      // The tag stays the source of truth; this pass only adds the native flag.
      queueContains({ id: 'tx-1', pending: false, notes: 'rb-tx:abc123def4567890' });

      await syncPendingStatuses(params);

      const [, updates] = monarchApi.updateTransactionWithPending.mock.calls[0];
      expect(updates).toEqual({});
    });

    test('skips rows already natively pending, issuing no mutation', async () => {
      // The steady state: this is what keeps the pass nearly free.
      queueContains({ id: 'tx-1', pending: true }, { id: 'tx-2', pending: true });

      const result = await syncPendingStatuses(params);

      expect(result.alreadyPending).toBe(2);
      expect(result.flagged).toBe(0);
      expect(monarchApi.updateTransactionWithPending).not.toHaveBeenCalled();
    });

    test('flags only the rows that need it in a mixed queue', async () => {
      queueContains(
        { id: 'tx-1', pending: true },
        { id: 'tx-2', pending: false },
        { id: 'tx-3', pending: true },
      );

      const result = await syncPendingStatuses(params);

      expect(result.flagged).toBe(1);
      expect(result.alreadyPending).toBe(2);
      expect(monarchApi.updateTransactionWithPending).toHaveBeenCalledTimes(1);
      expect(monarchApi.updateTransactionWithPending).toHaveBeenCalledWith(
        'tx-2', {}, true, 'pendingStatusSync',
      );
    });

    test('counts a row with no id as failed rather than crashing', async () => {
      queueContains({ pending: false });

      const result = await syncPendingStatuses(params);

      expect(result.failed).toBe(1);
      expect(result.success).toBe(true);
    });
  });

  describe('when the pending field is unsupported', () => {
    test('stops after the first ignored mutation', async () => {
      queueContains(
        { id: 'tx-1', pending: false },
        { id: 'tx-2', pending: false },
        { id: 'tx-3', pending: false },
      );

      // First attempt is dropped and trips the API latch
      monarchApi.updateTransactionWithPending.mockResolvedValueOnce({ transaction: {}, pendingApplied: false });
      monarchApi.isPendingFieldSupported
        .mockReturnValueOnce(true)   // checked before tx-1
        .mockReturnValue(false);     // latch tripped thereafter

      const result = await syncPendingStatuses(params);

      // Exactly ONE wasted mutation, not one per row
      expect(monarchApi.updateTransactionWithPending).toHaveBeenCalledTimes(1);
      expect(result.ignored).toBe(1);
      expect(result.unsupported).toBe(true);
    });

    test('reports unsupported rather than failed', async () => {
      queueContains({ id: 'tx-1', pending: false }, { id: 'tx-2', pending: false });
      monarchApi.updateTransactionWithPending.mockResolvedValue({ transaction: {}, pendingApplied: false });
      monarchApi.isPendingFieldSupported.mockReturnValueOnce(true).mockReturnValue(false);

      const result = await syncPendingStatuses(params);

      // A missing platform feature is not a sync failure
      expect(result.success).toBe(true);
      expect(result.failed).toBe(0);
      expect(result.unsupported).toBe(true);
    });

    test('issues no mutations at all when already latched before the pass', async () => {
      queueContains({ id: 'tx-1', pending: false });
      monarchApi.isPendingFieldSupported.mockReturnValue(false);

      const result = await syncPendingStatuses(params);

      expect(monarchApi.updateTransactionWithPending).not.toHaveBeenCalled();
      expect(result.unsupported).toBe(true);
    });

    test('reports that an EARLIER pass reached the verdict, not this one', async () => {
      // The failure mode this exists to prevent: claiming "Monarch does not accept
      // the field" when this pass never tested it. The deciding probe usually runs
      // in owner sync or the settle path.
      queueContains({ id: 'tx-1', pending: false }, { id: 'tx-2', pending: false });
      monarchApi.isPendingFieldSupported.mockReturnValue(false);
      monarchApi.getPendingFieldProbe.mockReturnValue({
        verdict: 'rejected',
        detail: 'Unknown argument "pending"',
        context: 'ownerSync',
        transactionId: 'monarch-tx-9',
        at: '2026-09-07T18:32:00.000Z',
      });

      const result = await syncPendingStatuses(params);

      expect(result.alreadyUnsupported).toBe(true);
      expect(result.unsupported).toBe(true);
      expect(monarchApi.updateTransactionWithPending).not.toHaveBeenCalled();
    });

    test('does NOT claim it was already unsupported when this pass proved it', async () => {
      queueContains({ id: 'tx-1', pending: false }, { id: 'tx-2', pending: false });
      monarchApi.updateTransactionWithPending.mockResolvedValue({ transaction: {}, pendingApplied: false });
      monarchApi.isPendingFieldSupported.mockReturnValueOnce(true).mockReturnValue(false);

      const result = await syncPendingStatuses(params);

      expect(result.ignored).toBe(1);
      expect(result.unsupported).toBe(true);
      expect(result.alreadyUnsupported).toBeUndefined();
    });

    test('cites the probe evidence in a warning so it is never lost', async () => {
      const { logWarning } = require('../../../src/core/utils');
      queueContains({ id: 'tx-1', pending: false });
      monarchApi.isPendingFieldSupported.mockReturnValue(false);
      monarchApi.getPendingFieldProbe.mockReturnValue({
        verdict: 'rejected',
        detail: 'Unknown argument "pending" on field UpdateTransactionMutationInput',
        context: 'ownerSync',
        transactionId: 'monarch-tx-9',
        at: '2026-09-07T18:32:00.000Z',
      });

      await syncPendingStatuses(params);

      const message = logWarning.mock.calls.map((call) => call.join(' ')).join('\n');
      expect(message).toContain('Unknown argument "pending"');
      expect(message).toContain('ownerSync');
      expect(message).toContain('monarch-tx-9');
    });

    test('survives a missing probe record without crashing', async () => {
      queueContains({ id: 'tx-1', pending: false });
      monarchApi.isPendingFieldSupported.mockReturnValue(false);
      monarchApi.getPendingFieldProbe.mockReturnValue(null);

      const result = await syncPendingStatuses(params);

      expect(result.success).toBe(true);
      expect(result.unsupported).toBe(true);
    });
  });

  describe('bounded work', () => {
    test('defers rows beyond the per-sync cap', async () => {
      queueContains(
        { id: 'tx-1', pending: false },
        { id: 'tx-2', pending: false },
        { id: 'tx-3', pending: false },
      );

      const result = await syncPendingStatuses({ ...params, maxUpdates: 2 });

      expect(result.flagged).toBe(2);
      expect(result.deferred).toBe(1);
      // The tag keeps the deferred row queued, so nothing is lost
      expect(monarchApi.updateTransactionWithPending).toHaveBeenCalledTimes(2);
    });
  });

  describe('systemic failure', () => {
    /** Build N queued rows that all need flagging */
    const rowsNeedingFlag = (n) => Array.from(
      { length: n },
      (_, i) => ({ id: `tx-${i}`, pending: false }),
    );

    test('abandons the pass after three consecutive failures', async () => {
      // The failure this exists to prevent: a real run failed once per row for
      // 23 rows. The latch cannot catch a fault it never learns about, so the
      // pass has to notice for itself.
      queueContains(...rowsNeedingFlag(23));
      monarchApi.updateTransactionWithPending.mockRejectedValue(new Error('upstream exploded'));

      const result = await syncPendingStatuses(params);

      expect(monarchApi.updateTransactionWithPending).toHaveBeenCalledTimes(3);
      expect(result.failed).toBe(3);
      expect(result.abortedAfterFailures).toBe(true);
    });

    test('leaves the remaining rows queued rather than failing them', async () => {
      queueContains(...rowsNeedingFlag(23));
      monarchApi.updateTransactionWithPending.mockRejectedValue(new Error('upstream exploded'));

      const result = await syncPendingStatuses(params);

      // 20 rows were never touched; the Pending tag keeps them for next sync
      expect(result.failed).toBeLessThan(23);
      expect(result.success).toBe(true);
    });

    test('does not abort when failures are interleaved with successes', async () => {
      // Isolated failures are a per-row problem, not a systemic one.
      queueContains(...rowsNeedingFlag(6));
      monarchApi.updateTransactionWithPending
        .mockRejectedValueOnce(new Error('blip'))
        .mockResolvedValueOnce({ transaction: {}, pendingApplied: true })
        .mockRejectedValueOnce(new Error('blip'))
        .mockResolvedValueOnce({ transaction: {}, pendingApplied: true })
        .mockRejectedValueOnce(new Error('blip'))
        .mockResolvedValueOnce({ transaction: {}, pendingApplied: true });

      const result = await syncPendingStatuses(params);

      expect(result.abortedAfterFailures).toBeUndefined();
      expect(result.flagged).toBe(3);
      expect(result.failed).toBe(3);
    });

    test('reports the abort as the headline in the step message', async () => {
      expect(formatPendingStatusMessage({
        success: true,
        flagged: 0,
        alreadyPending: 0,
        ignored: 0,
        failed: 3,
        deferred: 0,
        abortedAfterFailures: true,
        error: null,
      })).toBe('Stopped after 3 failures');
    });
  });

  describe('non-fatal behaviour', () => {
    test('counts a per-row error without aborting the remaining rows', async () => {
      queueContains({ id: 'tx-1', pending: false }, { id: 'tx-2', pending: false });
      monarchApi.updateTransactionWithPending
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({ transaction: {}, pendingApplied: true });

      const result = await syncPendingStatuses(params);

      expect(result.failed).toBe(1);
      expect(result.flagged).toBe(1);
      expect(result.success).toBe(true);
    });

    test('never throws when the transaction query fails', async () => {
      monarchApi.getTagByName.mockResolvedValue(PENDING_TAG);
      monarchApi.getTransactionsList.mockRejectedValue(new Error('network down'));

      const result = await syncPendingStatuses(params);

      expect(result.success).toBe(false);
      expect(result.error).toBe('network down');
    });

    test('never throws when the tag lookup fails outright', async () => {
      monarchApi.getTagByName.mockRejectedValue(new Error('tag service down'));

      const result = await syncPendingStatuses(params);

      expect(result.success).toBe(false);
      expect(result.error).toBe('tag service down');
    });
  });

  describe('formatPendingStatusMessage', () => {
    const base = {
      success: true, flagged: 0, alreadyPending: 0, ignored: 0, failed: 0, deferred: 0, error: null,
    };

    test('reports none pending when the tag is absent', () => {
      expect(formatPendingStatusMessage({ ...base, noPendingTag: true })).toBe('None pending');
    });

    test('reports none pending when nothing is queued', () => {
      expect(formatPendingStatusMessage({ ...base, noPendingTransactions: true })).toBe('None pending');
    });

    test('reports an unsupported field as not supported, not an error', () => {
      expect(formatPendingStatusMessage({ ...base, ignored: 1, unsupported: true })).toBe('Not supported');
    });

    test('reports the flagged count', () => {
      expect(formatPendingStatusMessage({ ...base, flagged: 3 })).toBe('3 flagged');
    });

    test('reports already-pending rows', () => {
      expect(formatPendingStatusMessage({ ...base, alreadyPending: 12 })).toBe('12 already pending');
    });

    test('surfaces every non-zero outcome', () => {
      const message = formatPendingStatusMessage({
        ...base, flagged: 2, alreadyPending: 5, failed: 1, deferred: 3,
      });

      expect(message).toBe('2 flagged, 5 already pending, 1 failed, 3 deferred');
    });

    test('falls back to a neutral message when nothing happened', () => {
      expect(formatPendingStatusMessage(base)).toBe('Nothing to update');
    });
  });
});