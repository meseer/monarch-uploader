/**
 * Tests for the post-sync update stage.
 *
 * The registry's whole point is that the declared steps and the executed passes
 * cannot drift apart, and that one pass can never take down another. Both are
 * asserted here against the real pass implementations (mocked at their module
 * boundary) rather than a synthetic registry, so the wiring itself is covered.
 */

import { jest } from '@jest/globals';
import {
  buildPostSyncSteps,
  runPostSyncUpdates,
} from '../../../src/services/common/postSyncUpdates';
import { syncTransactionOwners } from '../../../src/services/common/ownerSync';
import { syncPendingStatuses } from '../../../src/services/common/pendingStatusSync';

jest.mock('../../../src/core/utils', () => ({
  debugLog: jest.fn(),
  logInfo: jest.fn(),
  logWarning: jest.fn(),
  logError: jest.fn(),
}));

jest.mock('../../../src/services/common/ownerSync', () => ({
  syncTransactionOwners: jest.fn(),
  buildOwnerResolver: jest.fn(() => () => 'user-1'),
  formatOwnerSyncMessage: jest.fn(() => 'owner message'),
}));

jest.mock('../../../src/services/common/pendingStatusSync', () => ({
  syncPendingStatuses: jest.fn(),
  formatPendingStatusMessage: jest.fn(() => 'pending message'),
}));

describe('postSyncUpdates', () => {
  let progressDialog;

  /** Build a context with both passes enabled unless overridden */
  function makeContext(overrides = {}) {
    return {
      accountId: 'src-acct-1',
      monarchAccountId: 'monarch-1',
      txIdPrefix: 'rb-tx',
      lookbackDays: 90,
      ownerSyncEnabled: true,
      pendingStatusEnabled: true,
      ownerAssignments: new Map([['rb-tx:abc123def4567890', 'user-1']]),
      ...overrides,
    };
  }

  /** Step keys reported to the progress dialog, in call order */
  function reportedStepKeys() {
    return progressDialog.updateStepStatus.mock.calls.map((call) => call[1]);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    progressDialog = { updateStepStatus: jest.fn() };
    syncTransactionOwners.mockResolvedValue({ success: true, updated: 1 });
    syncPendingStatuses.mockResolvedValue({ success: true, flagged: 1 });
  });

  describe('buildPostSyncSteps', () => {
    test('declares both steps when both passes apply', () => {
      const steps = buildPostSyncSteps(makeContext());

      expect(steps).toEqual([
        { key: 'ownerSync', name: 'Owner sync' },
        { key: 'pendingStatus', name: 'Pending status' },
      ]);
    });

    test('omits owner sync when the account did not opt in', () => {
      const steps = buildPostSyncSteps(makeContext({ ownerSyncEnabled: false }));

      expect(steps).toEqual([{ key: 'pendingStatus', name: 'Pending status' }]);
    });

    test('omits owner sync without a txIdPrefix to correlate rows', () => {
      // The notes hash is the only handle linking a Monarch row to its source
      // transaction, so owner sync cannot run without a prefix.
      const steps = buildPostSyncSteps(makeContext({ txIdPrefix: null }));

      expect(steps.map((s) => s.key)).toEqual(['pendingStatus']);
    });

    test('omits pending status when the integration has not enabled it', () => {
      const steps = buildPostSyncSteps(makeContext({ pendingStatusEnabled: false }));

      expect(steps).toEqual([{ key: 'ownerSync', name: 'Owner sync' }]);
    });

    test('declares no steps when neither pass applies', () => {
      const steps = buildPostSyncSteps(makeContext({
        ownerSyncEnabled: false, pendingStatusEnabled: false,
      }));

      expect(steps).toEqual([]);
    });
  });

  describe('runPostSyncUpdates', () => {
    test('runs exactly the passes that were declared as steps', async () => {
      // The anti-drift guarantee: declared steps === executed passes.
      const ctx = makeContext();
      const declared = buildPostSyncSteps(ctx).map((s) => s.key);

      const results = await runPostSyncUpdates(ctx, progressDialog);

      expect(Object.keys(results)).toEqual(declared);
    });

    test('runs owner sync before pending status', async () => {
      // Ordering matters: the owner mutation carries the pending flag, so running
      // it first leaves the pending pass with nothing to do for those rows.
      await runPostSyncUpdates(makeContext(), progressDialog);

      const finalStatuses = reportedStepKeys().filter((key, i, all) => all.indexOf(key) === i);
      expect(finalStatuses).toEqual(['ownerSync', 'pendingStatus']);
    });

    test('skips a disabled pass entirely', async () => {
      const results = await runPostSyncUpdates(
        makeContext({ ownerSyncEnabled: false }),
        progressDialog,
      );

      expect(syncTransactionOwners).not.toHaveBeenCalled();
      expect(results).not.toHaveProperty('ownerSync');
      expect(reportedStepKeys()).not.toContain('ownerSync');
    });

    test('tells owner sync to bundle the pending flag when pending status is on', async () => {
      await runPostSyncUpdates(makeContext(), progressDialog);

      expect(syncTransactionOwners).toHaveBeenCalledWith(expect.objectContaining({
        flagPending: true,
      }));
    });

    test('does NOT bundle the pending flag when pending status is off', async () => {
      // Flagging without a matching settle path would leave rows permanently
      // pending, so this must stay off for integrations not yet migrated.
      await runPostSyncUpdates(
        makeContext({ pendingStatusEnabled: false }),
        progressDialog,
      );

      expect(syncTransactionOwners).toHaveBeenCalledWith(expect.objectContaining({
        flagPending: false,
      }));
    });

    test('passes the account, prefix and lookback through to each pass', async () => {
      await runPostSyncUpdates(makeContext(), progressDialog);

      expect(syncTransactionOwners).toHaveBeenCalledWith(expect.objectContaining({
        monarchAccountId: 'monarch-1',
        txIdPrefix: 'rb-tx',
        lookbackDays: 90,
      }));
      expect(syncPendingStatuses).toHaveBeenCalledWith(expect.objectContaining({
        monarchAccountId: 'monarch-1',
        lookbackDays: 90,
      }));
    });
  });

  describe('progress reporting', () => {
    test('marks a step processing then successful', async () => {
      await runPostSyncUpdates(makeContext({ pendingStatusEnabled: false }), progressDialog);

      expect(progressDialog.updateStepStatus).toHaveBeenNthCalledWith(
        1, 'src-acct-1', 'ownerSync', 'processing', expect.any(String),
      );
      expect(progressDialog.updateStepStatus).toHaveBeenNthCalledWith(
        2, 'src-acct-1', 'ownerSync', 'success', 'owner message',
      );
    });

    test('reports an unsupported feature as skipped, not an error', async () => {
      // A missing platform field must not make a healthy sync look broken.
      syncPendingStatuses.mockResolvedValue({ success: true, unsupported: true });

      await runPostSyncUpdates(makeContext({ ownerSyncEnabled: false }), progressDialog);

      expect(progressDialog.updateStepStatus).toHaveBeenLastCalledWith(
        'src-acct-1', 'pendingStatus', 'skipped', 'pending message',
      );
    });

    test('reports a genuine pass failure as an error', async () => {
      syncPendingStatuses.mockResolvedValue({ success: false, error: 'boom' });

      await runPostSyncUpdates(makeContext({ ownerSyncEnabled: false }), progressDialog);

      expect(progressDialog.updateStepStatus).toHaveBeenLastCalledWith(
        'src-acct-1', 'pendingStatus', 'error', 'pending message',
      );
    });
  });

  describe('pass isolation', () => {
    test('a failing pass does not prevent the next one running', async () => {
      syncTransactionOwners.mockResolvedValue({ success: false, error: 'owner boom' });

      const results = await runPostSyncUpdates(makeContext(), progressDialog);

      expect(syncPendingStatuses).toHaveBeenCalled();
      expect(results.pendingStatus).toEqual(expect.objectContaining({ success: true }));
    });

    test('a pass that throws unexpectedly is contained', async () => {
      // The passes are written not to throw; this guards the contract anyway.
      syncTransactionOwners.mockRejectedValue(new Error('unexpected'));

      const results = await runPostSyncUpdates(makeContext(), progressDialog);

      expect(results.ownerSync).toEqual({ success: false, error: 'unexpected' });
      expect(progressDialog.updateStepStatus).toHaveBeenCalledWith(
        'src-acct-1', 'ownerSync', 'error', 'unexpected',
      );
      // And the other pass still ran
      expect(syncPendingStatuses).toHaveBeenCalled();
    });

    test('never throws out of the stage', async () => {
      syncTransactionOwners.mockRejectedValue(new Error('a'));
      syncPendingStatuses.mockRejectedValue(new Error('b'));

      await expect(runPostSyncUpdates(makeContext(), progressDialog)).resolves.toBeDefined();
    });
  });
});