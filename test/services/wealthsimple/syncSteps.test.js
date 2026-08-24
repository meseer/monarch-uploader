/**
 * Tests for Wealthsimple sync step executors.
 *
 * Focus areas:
 * - Pending reconciliation persists settled ref IDs to the dedup store
 * - Phase 1 failures are surfaced as errors (not "No pending transactions")
 * - Transaction sync step status reporting
 */

import {
  fetchRawTransactions,
  executePendingReconciliationStep,
  executeTransactionSyncStep,
} from '../../../src/services/wealthsimple/syncSteps';

jest.mock('../../../src/core/utils', () => ({
  debugLog: jest.fn(),
}));

jest.mock('../../../src/api/wealthsimple', () => ({
  __esModule: true,
  default: {
    fetchTransactions: jest.fn(),
  },
}));

jest.mock('../../../src/services/wealthsimple/account', () => ({
  uploadWealthsimpleTransactions: jest.fn(),
  saveReconciledSettledIds: jest.fn(),
}));

jest.mock('../../../src/services/wealthsimple/transactionsReconciliation', () => ({
  reconcileWealthsimpleFetchedPending: jest.fn(),
}));

const wealthsimpleApi = require('../../../src/api/wealthsimple').default;
const { uploadWealthsimpleTransactions, saveReconciledSettledIds } = require('../../../src/services/wealthsimple/account');
const { reconcileWealthsimpleFetchedPending } = require('../../../src/services/wealthsimple/transactionsReconciliation');

const makeProgressDialog = () => ({
  updateStepStatus: jest.fn(),
});

const pendingTag = { id: 'tag-pending', name: 'Pending' };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('fetchRawTransactions', () => {
  it('returns the fetched transactions and reports progress', async () => {
    const txs = [{ externalCanonicalId: 'tx-1' }, { externalCanonicalId: 'tx-2' }];
    wealthsimpleApi.fetchTransactions.mockResolvedValue(txs);
    const progressDialog = makeProgressDialog();

    const result = await fetchRawTransactions('acct-1', '2026-01-01', progressDialog);

    expect(result).toBe(txs);
    expect(wealthsimpleApi.fetchTransactions).toHaveBeenCalledWith('acct-1', '2026-01-01');
    expect(progressDialog.updateStepStatus).toHaveBeenCalledWith('acct-1', 'transactions', 'processing', 'Fetched 2');
  });

  it('returns an empty array when the fetch fails', async () => {
    wealthsimpleApi.fetchTransactions.mockRejectedValue(new Error('network down'));
    const progressDialog = makeProgressDialog();

    const result = await fetchRawTransactions('acct-1', '2026-01-01', progressDialog);

    expect(result).toEqual([]);
  });
});

describe('executePendingReconciliationStep', () => {
  const baseParams = {
    accountId: 'acct-1',
    accountType: 'CREDIT_CARD',
    rawTransactions: [{ externalCanonicalId: 'tx-1' }],
    stripStoreNumbers: true,
  };

  it('reports an ERROR (not "no pending") when Phase 1 failed', async () => {
    const progressDialog = makeProgressDialog();

    const result = await executePendingReconciliationStep({
      ...baseParams,
      phase1Result: null,
      phase1Error: 'Monarch request failed',
      progressDialog,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Monarch request failed');
    expect(result.settledRefIds).toEqual([]);
    expect(progressDialog.updateStepStatus).toHaveBeenCalledWith(
      'acct-1',
      'pendingReconciliation',
      'error',
      'Monarch request failed',
    );
    expect(reconcileWealthsimpleFetchedPending).not.toHaveBeenCalled();
  });

  it('uses a fallback error message when Phase 1 gave no message', async () => {
    const progressDialog = makeProgressDialog();

    const result = await executePendingReconciliationStep({
      ...baseParams,
      phase1Result: null,
      phase1Error: null,
      progressDialog,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Could not fetch pending transactions');
    expect(progressDialog.updateStepStatus).toHaveBeenCalledWith(
      'acct-1',
      'pendingReconciliation',
      'error',
      'Could not fetch pending transactions',
    );
  });

  it('reports noPendingTag when Monarch has no Pending tag', async () => {
    const progressDialog = makeProgressDialog();

    const result = await executePendingReconciliationStep({
      ...baseParams,
      phase1Result: { noPendingTag: true, monarchPendingTransactions: [], pendingTag: null },
      phase1Error: null,
      progressDialog,
    });

    expect(result.noPendingTag).toBe(true);
    expect(result.success).toBe(true);
    expect(reconcileWealthsimpleFetchedPending).not.toHaveBeenCalled();
  });

  it('reports noPendingTransactions when there are no pending transactions', async () => {
    const progressDialog = makeProgressDialog();

    const result = await executePendingReconciliationStep({
      ...baseParams,
      phase1Result: { monarchPendingTransactions: [], pendingTag },
      phase1Error: null,
      progressDialog,
    });

    expect(result.noPendingTransactions).toBe(true);
    expect(reconcileWealthsimpleFetchedPending).not.toHaveBeenCalled();
  });

  it('persists settled ref IDs so the upload step skips the settled version', async () => {
    const settledId = 'card-activity-abc-QIRIAS-0tk4pfcsob83';
    reconcileWealthsimpleFetchedPending.mockResolvedValue({
      success: true,
      settled: 1,
      cancelled: 0,
      failed: 0,
      error: null,
      settledRefIds: [settledId],
    });
    const progressDialog = makeProgressDialog();

    const result = await executePendingReconciliationStep({
      ...baseParams,
      phase1Result: { monarchPendingTransactions: [{ id: 'mtx-1' }], pendingTag },
      phase1Error: null,
      progressDialog,
    });

    expect(result.settled).toBe(1);
    expect(saveReconciledSettledIds).toHaveBeenCalledWith('acct-1', [settledId]);
  });

  it('passes the stripStoreNumbers setting through to reconciliation', async () => {
    reconcileWealthsimpleFetchedPending.mockResolvedValue({
      success: true, settled: 0, cancelled: 0, failed: 0, error: null, settledRefIds: [],
    });
    const progressDialog = makeProgressDialog();

    await executePendingReconciliationStep({
      ...baseParams,
      stripStoreNumbers: false,
      phase1Result: { monarchPendingTransactions: [{ id: 'mtx-1' }], pendingTag },
      phase1Error: null,
      progressDialog,
    });

    expect(reconcileWealthsimpleFetchedPending).toHaveBeenCalledWith(
      pendingTag,
      [{ id: 'mtx-1' }],
      baseParams.rawTransactions,
      'CREDIT_CARD',
      { stripStoreNumbers: false },
    );
  });
});

describe('executeTransactionSyncStep', () => {
  const baseParams = {
    accountId: 'acct-1',
    monarchAccountId: 'monarch-1',
    fromDate: '2026-01-01',
    toDate: '2026-01-31',
    rawTransactions: [{ externalCanonicalId: 'tx-1' }],
  };

  it('reports the synced count on success', async () => {
    uploadWealthsimpleTransactions.mockResolvedValue({ success: true, synced: 3, skipped: 1 });
    const progressDialog = makeProgressDialog();

    const result = await executeTransactionSyncStep({ ...baseParams, progressDialog });

    expect(result.synced).toBe(3);
    expect(progressDialog.updateStepStatus).toHaveBeenCalledWith(
      'acct-1',
      'transactions',
      'success',
      '3 synced, 1 skipped',
    );
  });

  it('reports "No transactions" when nothing was synced or skipped', async () => {
    uploadWealthsimpleTransactions.mockResolvedValue({ success: true, synced: 0, skipped: 0 });
    const progressDialog = makeProgressDialog();

    const result = await executeTransactionSyncStep({ ...baseParams, progressDialog });

    expect(result.synced).toBe(0);
    expect(progressDialog.updateStepStatus).toHaveBeenCalledWith(
      'acct-1',
      'transactions',
      'success',
      'No transactions',
    );
  });

  it('marks the step skipped for unsupported account types', async () => {
    uploadWealthsimpleTransactions.mockResolvedValue({ success: false, unsupported: true });
    const progressDialog = makeProgressDialog();

    const result = await executeTransactionSyncStep({ ...baseParams, progressDialog });

    expect(result.synced).toBe(0);
    expect(progressDialog.updateStepStatus).toHaveBeenCalledWith(
      'acct-1',
      'transactions',
      'skipped',
      'Not supported',
    );
  });

  it('reports the error message on failure', async () => {
    uploadWealthsimpleTransactions.mockResolvedValue({ success: false, error: 'CSV upload failed' });
    const progressDialog = makeProgressDialog();

    const result = await executeTransactionSyncStep({ ...baseParams, progressDialog });

    expect(result.synced).toBe(0);
    expect(progressDialog.updateStepStatus).toHaveBeenCalledWith(
      'acct-1',
      'transactions',
      'error',
      'CSV upload failed',
    );
  });

  it('passes the pre-fetched raw transactions to the upload service', async () => {
    uploadWealthsimpleTransactions.mockResolvedValue({ success: true, synced: 1, skipped: 0 });
    const progressDialog = makeProgressDialog();

    await executeTransactionSyncStep({ ...baseParams, progressDialog });

    expect(uploadWealthsimpleTransactions).toHaveBeenCalledWith(
      'acct-1',
      'monarch-1',
      '2026-01-01',
      '2026-01-31',
      expect.objectContaining({ rawTransactions: baseParams.rawTransactions }),
    );
  });
});