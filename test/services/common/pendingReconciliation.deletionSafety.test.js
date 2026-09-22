/**
 * Regression tests for shared modular pending reconciliation safety.
 *
 * PR #193 added deletion safety to the Wealthsimple, Canada Life and Rogers Bank
 * reconciliation paths but never touched this shared one, which is the path every
 * modular integration reaches through `syncOrchestrator` (MBNA today). Phase 2
 * deleted every Monarch pending row whose hash it could not find in the source
 * feed, and two situations produce a feed that does not contain a still-valid
 * pending transaction:
 *
 * 1. An empty feed — an auth expiry, a network error or a changed page structure
 *    is indistinguishable from "every pending transaction was cancelled".
 * 2. A partial fetch — MBNA's `getTransactions` degrades to the current cycle
 *    only when the statement list cannot be read, so anything that settled into an
 *    earlier statement is absent from a feed that still looks healthy. The source
 *    reports this via `sourceDataComplete: false`.
 *
 * Deleting hard-deletes the user's categories, notes, splits and tags, and the id
 * stays in the dedup store, so the settled version is never re-uploaded.
 *
 * A genuinely cancelled transaction missing from a trustworthy, non-empty feed
 * must still be deleted — that is the feature, and the anti-regression cases below
 * stop the guard from becoming a blanket disable.
 *
 * Kept separate from `pendingReconciliation.test.js` per the test split convention.
 */

import {
  generatePendingTransactionId,
  reconcileFetchedPendingTransactions,
  reconcilePendingTransactions,
  formatReconciliationMessage,
} from '../../../src/services/common/pendingReconciliation';

// ── Mocks ───────────────────────────────────────────────────

jest.mock('../../../src/core/utils', () => ({
  debugLog: jest.fn(),
  formatDate: jest.fn((d) => d.toISOString().split('T')[0]),
}));

jest.mock('../../../src/api/monarch', () => ({
  __esModule: true,
  default: {
    getTagByName: jest.fn(),
    getTransactionsList: jest.fn(),
    updateTransaction: jest.fn(),
    setTransactionTags: jest.fn(),
    deleteTransaction: jest.fn(),
  },
}));

// ── Setup ───────────────────────────────────────────────────

const mockMonarchApi = require('../../../src/api/monarch').default;

// Real SHA-256 via Node's webcrypto so the hash IDs match production
beforeAll(() => {
  if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.subtle) {
    const { webcrypto } = require('crypto');
    globalThis.crypto = webcrypto;
  }
});

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Fixtures ────────────────────────────────────────────────

const TX_ID_PREFIX = 'mbna-tx';
const pendingTag = { id: 'tag-pending', name: 'Pending' };

const getPendingIdFields = (tx) => [tx.date, tx.desc, String(tx.amt)];
const getSettledAmount = (tx) => -tx.amt;

/** A hold that has been pending long enough to fall into an earlier statement */
const AGED_HOLD_TX = { date: '2026-01-05', desc: 'FAIRMONT HOTEL', amt: 412.0 };

/** A source transaction whose hash never matches AGED_HOLD_TX */
const UNRELATED_TX = { date: '2026-02-20', desc: 'UNRELATED MERCHANT', amt: 99.99 };

const makeMonarchPendingRow = (id, notes) => ({
  id,
  amount: -412.0,
  date: '2026-01-05',
  notes,
  tags: [pendingTag],
  ownedByUser: { id: 'user-1' },
});

/** Phase 2 call with only the trust-relevant knobs varying */
const runPhase2 = (monarchPending, { rawSettled = [], rawPending = [], ...rest } = {}) => (
  reconcileFetchedPendingTransactions({
    txIdPrefix: TX_ID_PREFIX,
    pendingTag,
    monarchPendingTransactions: monarchPending,
    rawPending,
    rawSettled,
    getPendingIdFields,
    getSettledAmount,
    ...rest,
  })
);

// ── Tests ───────────────────────────────────────────────────

describe('reconcileFetchedPendingTransactions — empty source feed', () => {
  it('deletes nothing when both source arrays are empty', async () => {
    const holdId = await generatePendingTransactionId(TX_ID_PREFIX, getPendingIdFields(AGED_HOLD_TX));
    const monarchPending = [makeMonarchPendingRow('mtx-1', holdId)];

    const result = await runPhase2(monarchPending, { rawSettled: [], rawPending: [] });

    expect(mockMonarchApi.deleteTransaction).not.toHaveBeenCalled();
    expect(result.cancelled).toBe(0);
    expect(result.settled).toBe(0);
    expect(result.success).toBe(false);
    expect(result.sourceUnavailable).toBe(true);
    expect(result.error).toBe('Source transactions unavailable — reconciliation skipped');
  });

  it('deletes nothing when every Monarch pending row would be cancelled at once', async () => {
    // The catastrophic shape: a whole account's pending rows wiped in one sync.
    const firstId = await generatePendingTransactionId(TX_ID_PREFIX, getPendingIdFields(AGED_HOLD_TX));
    const secondId = await generatePendingTransactionId(TX_ID_PREFIX, getPendingIdFields(UNRELATED_TX));
    const monarchPending = [
      makeMonarchPendingRow('mtx-1', firstId),
      makeMonarchPendingRow('mtx-2', secondId),
    ];

    const result = await runPhase2(monarchPending, { rawSettled: [], rawPending: [] });

    expect(mockMonarchApi.deleteTransaction).not.toHaveBeenCalled();
    expect(result.sourceUnavailable).toBe(true);
  });

  it('deletes nothing when the source arrays are null or undefined', async () => {
    const holdId = await generatePendingTransactionId(TX_ID_PREFIX, getPendingIdFields(AGED_HOLD_TX));
    const monarchPending = [makeMonarchPendingRow('mtx-1', holdId)];

    const result = await runPhase2(monarchPending, { rawSettled: null, rawPending: undefined });

    expect(mockMonarchApi.deleteTransaction).not.toHaveBeenCalled();
    expect(result.sourceUnavailable).toBe(true);
  });

  it('deletes nothing when a malformed response is a truthy non-array', async () => {
    // A `|| []` fallback would let these through with `.length === undefined`,
    // which fails the emptiness test and reaches the deletion path.
    const holdId = await generatePendingTransactionId(TX_ID_PREFIX, getPendingIdFields(AGED_HOLD_TX));
    const monarchPending = [makeMonarchPendingRow('mtx-1', holdId)];

    const result = await runPhase2(monarchPending, { rawSettled: {}, rawPending: 'oops' });

    expect(mockMonarchApi.deleteTransaction).not.toHaveBeenCalled();
    expect(result.sourceUnavailable).toBe(true);
  });

  it('does not report sourceUnavailable when Monarch holds no pending rows', async () => {
    // Nothing is at risk, so an empty feed is not an error worth surfacing.
    const result = await runPhase2([], { rawSettled: [], rawPending: [] });

    expect(mockMonarchApi.deleteTransaction).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.sourceUnavailable).toBeUndefined();
  });
});

describe('reconcileFetchedPendingTransactions — partial source fetch', () => {
  it('deletes nothing when the source reports sourceDataComplete: false', async () => {
    const holdId = await generatePendingTransactionId(TX_ID_PREFIX, getPendingIdFields(AGED_HOLD_TX));
    const monarchPending = [makeMonarchPendingRow('mtx-1', holdId)];

    // A healthy-looking, non-empty feed that is nonetheless truncated: the hold
    // settled into a statement the fetch could not read.
    const result = await runPhase2(monarchPending, {
      rawSettled: [UNRELATED_TX],
      sourceDataComplete: false,
    });

    expect(mockMonarchApi.deleteTransaction).not.toHaveBeenCalled();
    expect(result.cancelled).toBe(0);
    expect(result.success).toBe(false);
    expect(result.sourceUnavailable).toBe(true);
    expect(result.error).toBe('Source transactions unavailable — reconciliation skipped');
  });

  it('still settles nothing and deletes nothing on a partial fetch that contains a settled match', async () => {
    // Refusing the whole phase (rather than only the deletion branch) mirrors the
    // three integration paths: the settled row is picked up on the next sync.
    const holdId = await generatePendingTransactionId(TX_ID_PREFIX, getPendingIdFields(AGED_HOLD_TX));
    const monarchPending = [makeMonarchPendingRow('mtx-1', holdId)];

    const result = await runPhase2(monarchPending, {
      rawSettled: [AGED_HOLD_TX],
      sourceDataComplete: false,
    });

    expect(mockMonarchApi.deleteTransaction).not.toHaveBeenCalled();
    expect(mockMonarchApi.setTransactionTags).not.toHaveBeenCalled();
    expect(result.settled).toBe(0);
    expect(result.sourceUnavailable).toBe(true);
  });
});

describe('reconcileFetchedPendingTransactions — absent trust signal defaults safely', () => {
  it('suppresses deletion on an empty feed when sourceDataComplete is omitted', async () => {
    const holdId = await generatePendingTransactionId(TX_ID_PREFIX, getPendingIdFields(AGED_HOLD_TX));
    const monarchPending = [makeMonarchPendingRow('mtx-1', holdId)];

    const result = await runPhase2(monarchPending, { rawSettled: [], rawPending: [] });

    expect(mockMonarchApi.deleteTransaction).not.toHaveBeenCalled();
    expect(result.sourceUnavailable).toBe(true);
  });

  it('suppresses deletion on an empty feed when sourceDataComplete is undefined', async () => {
    const holdId = await generatePendingTransactionId(TX_ID_PREFIX, getPendingIdFields(AGED_HOLD_TX));
    const monarchPending = [makeMonarchPendingRow('mtx-1', holdId)];

    const result = await runPhase2(monarchPending, {
      rawSettled: [],
      rawPending: [],
      sourceDataComplete: undefined,
    });

    expect(mockMonarchApi.deleteTransaction).not.toHaveBeenCalled();
    expect(result.sourceUnavailable).toBe(true);
  });

  it('treats an omitted flag on a non-empty feed as trustworthy', async () => {
    // Hooks that are all-or-nothing never report completeness; their feeds must
    // keep working, or the guard becomes a blanket disable of cancellations.
    const holdId = await generatePendingTransactionId(TX_ID_PREFIX, getPendingIdFields(AGED_HOLD_TX));
    const monarchPending = [makeMonarchPendingRow('mtx-1', holdId)];
    mockMonarchApi.deleteTransaction.mockResolvedValue({});

    const result = await runPhase2(monarchPending, { rawSettled: [UNRELATED_TX] });

    expect(mockMonarchApi.deleteTransaction).toHaveBeenCalledWith('mtx-1');
    expect(result.cancelled).toBe(1);
    expect(result.sourceUnavailable).toBeUndefined();
  });
});

describe('reconcileFetchedPendingTransactions — genuine cancellations still delete', () => {
  it('deletes a cancelled hold when the feed is non-empty and complete', async () => {
    const holdId = await generatePendingTransactionId(TX_ID_PREFIX, getPendingIdFields(AGED_HOLD_TX));
    const monarchPending = [makeMonarchPendingRow('mtx-1', holdId)];
    mockMonarchApi.deleteTransaction.mockResolvedValue({});

    const result = await runPhase2(monarchPending, {
      rawSettled: [UNRELATED_TX],
      sourceDataComplete: true,
    });

    expect(mockMonarchApi.deleteTransaction).toHaveBeenCalledWith('mtx-1');
    expect(result.cancelled).toBe(1);
    expect(result.success).toBe(true);
    expect(result.sourceUnavailable).toBeUndefined();
  });

  it('deletes a cancelled hold when only the pending side of the feed is populated', async () => {
    const holdId = await generatePendingTransactionId(TX_ID_PREFIX, getPendingIdFields(AGED_HOLD_TX));
    const monarchPending = [makeMonarchPendingRow('mtx-1', holdId)];
    mockMonarchApi.deleteTransaction.mockResolvedValue({});

    const result = await runPhase2(monarchPending, {
      rawSettled: [],
      rawPending: [UNRELATED_TX],
      sourceDataComplete: true,
    });

    expect(mockMonarchApi.deleteTransaction).toHaveBeenCalledWith('mtx-1');
    expect(result.cancelled).toBe(1);
  });

  it('leaves a still-pending hold alone without deleting it', async () => {
    const holdId = await generatePendingTransactionId(TX_ID_PREFIX, getPendingIdFields(AGED_HOLD_TX));
    const monarchPending = [makeMonarchPendingRow('mtx-1', holdId)];

    const result = await runPhase2(monarchPending, {
      rawPending: [AGED_HOLD_TX, UNRELATED_TX],
      sourceDataComplete: true,
    });

    expect(mockMonarchApi.deleteTransaction).not.toHaveBeenCalled();
    expect(result.cancelled).toBe(0);
    expect(result.success).toBe(true);
  });

  it('still settles a transaction that reached the feed as settled', async () => {
    const holdId = await generatePendingTransactionId(TX_ID_PREFIX, getPendingIdFields(AGED_HOLD_TX));
    const monarchPending = [makeMonarchPendingRow('mtx-1', holdId)];
    mockMonarchApi.updateTransaction.mockResolvedValue({});
    mockMonarchApi.setTransactionTags.mockResolvedValue({});

    const result = await runPhase2(monarchPending, {
      rawSettled: [AGED_HOLD_TX],
      sourceDataComplete: true,
    });

    expect(mockMonarchApi.deleteTransaction).not.toHaveBeenCalled();
    expect(result.settled).toBe(1);
    expect(mockMonarchApi.setTransactionTags).toHaveBeenCalledWith('mtx-1', []);
  });
});

describe('reconcilePendingTransactions — trust signal reaches Phase 2', () => {
  it('forwards sourceDataComplete: false through the convenience wrapper', async () => {
    const holdId = await generatePendingTransactionId(TX_ID_PREFIX, getPendingIdFields(AGED_HOLD_TX));
    mockMonarchApi.getTagByName.mockResolvedValue(pendingTag);
    mockMonarchApi.getTransactionsList.mockResolvedValue({
      results: [makeMonarchPendingRow('mtx-1', holdId)],
    });

    const result = await reconcilePendingTransactions({
      txIdPrefix: TX_ID_PREFIX,
      monarchAccountId: 'monarch-1',
      rawPending: [],
      rawSettled: [UNRELATED_TX],
      lookbackDays: 91,
      getPendingIdFields,
      getSettledAmount,
      sourceDataComplete: false,
    });

    expect(mockMonarchApi.deleteTransaction).not.toHaveBeenCalled();
    expect(result.sourceUnavailable).toBe(true);
  });

  it('still deletes through the wrapper when the feed is complete', async () => {
    const holdId = await generatePendingTransactionId(TX_ID_PREFIX, getPendingIdFields(AGED_HOLD_TX));
    mockMonarchApi.getTagByName.mockResolvedValue(pendingTag);
    mockMonarchApi.getTransactionsList.mockResolvedValue({
      results: [makeMonarchPendingRow('mtx-1', holdId)],
    });
    mockMonarchApi.deleteTransaction.mockResolvedValue({});

    const result = await reconcilePendingTransactions({
      txIdPrefix: TX_ID_PREFIX,
      monarchAccountId: 'monarch-1',
      rawPending: [],
      rawSettled: [UNRELATED_TX],
      lookbackDays: 91,
      getPendingIdFields,
      getSettledAmount,
      sourceDataComplete: true,
    });

    expect(mockMonarchApi.deleteTransaction).toHaveBeenCalledWith('mtx-1');
    expect(result.cancelled).toBe(1);
  });
});

describe('formatReconciliationMessage — unavailable source', () => {
  it('reports the skip rather than an empty reconciliation', () => {
    const message = formatReconciliationMessage({
      success: false,
      settled: 0,
      cancelled: 0,
      failed: 0,
      error: 'Source transactions unavailable — reconciliation skipped',
      settledRefIds: [],
      sourceUnavailable: true,
    });

    expect(message).toBe('Skipped — source data unavailable');
  });
});
