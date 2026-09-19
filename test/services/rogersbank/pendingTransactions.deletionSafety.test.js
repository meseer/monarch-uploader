/**
 * Regression tests for Rogers Bank pending reconciliation safety (bug 2).
 *
 * Phase 2 used to delete every Monarch pending row it could not find in the
 * Rogers response. Two situations produce a response that does not contain a
 * still-valid pending transaction:
 *
 * 1. An empty response — a failed or throttled fetch is indistinguishable from
 *    "every pending transaction was cancelled".
 * 2. A transaction pending for longer than the source fetch window (hotel and
 *    car-rental holds, disputed charges). Monarch pending rows are collected 90
 *    days back while the Rogers fetch started at lastSync − 7 days, so those
 *    rows were deleted and, once settled, were outside every future window too.
 *
 * The window half of the fix lives in `rogersbank-upload.ts` (covered by
 * `test/services/rogersbank-upload.fetch.test.js`); this file covers the Phase 2
 * refusal to act on an untrustworthy response.
 *
 * Kept separate from `pendingTransactions.test.js`, which is already past the
 * 1,200-line split threshold.
 */

import {
  generatePendingTransactionId,
  reconcileRogersFetchedPending,
  formatReconciliationMessage,
} from '../../../src/services/rogersbank/pendingTransactions';

jest.mock('../../../src/core/utils', () => ({
  debugLog: jest.fn(),
  formatDate: jest.fn((date) => {
    const d = date instanceof Date ? date : new Date(date);
    return d.toISOString().split('T')[0];
  }),
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

// Real SHA-256 via Node crypto so the hash IDs match production
const nodeCrypto = require('crypto');

const mockDigest = jest.fn();
Object.defineProperty(global, 'crypto', {
  value: { subtle: { digest: mockDigest } },
});

global.TextEncoder = class {
  encode(str) {
    return new Uint8Array(Buffer.from(str, 'utf-8'));
  }
};

const monarchApi = require('../../../src/api/monarch').default;

beforeEach(() => {
  mockDigest.mockImplementation((_algo, data) => {
    const hash = nodeCrypto.createHash('sha256').update(Buffer.from(data)).digest();
    return Promise.resolve(hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength));
  });
});

afterEach(() => {
  jest.clearAllMocks();
});

const pendingTag = { id: 'tag-pending', name: 'Pending' };

/** A hotel hold that has been pending far longer than the default fetch window */
const AGED_HOLD_TX = {
  date: '2026-01-05',
  amount: { value: '412.00', currency: 'CAD' },
  merchant: { name: 'FAIRMONT HOTEL', categoryCode: '7011' },
  cardNumber: '************8584',
};

/** A Rogers transaction whose hash never matches AGED_HOLD_TX */
const UNRELATED_ROGERS_TX = {
  activityStatus: 'PENDING',
  date: '2026-02-20',
  amount: { value: '99.99', currency: 'CAD' },
  merchant: { name: 'UNRELATED MERCHANT', categoryCode: '5999' },
  cardNumber: '************8584',
};

const makeMonarchPendingRow = (id, notes) => ({
  id,
  amount: -412.0,
  date: '2026-01-05',
  notes,
  tags: [pendingTag],
  ownedByUser: { id: 'user-1' },
});

describe('reconcileRogersFetchedPending — untrustworthy source response', () => {
  it('deletes nothing when the Rogers response is empty', async () => {
    const holdId = await generatePendingTransactionId(AGED_HOLD_TX);
    const monarchPending = [makeMonarchPendingRow('monarch-tx-1', holdId)];

    const result = await reconcileRogersFetchedPending(pendingTag, monarchPending, []);

    expect(monarchApi.deleteTransaction).not.toHaveBeenCalled();
    expect(result.cancelled).toBe(0);
    expect(result.settled).toBe(0);
    expect(result.success).toBe(false);
    expect(result.sourceUnavailable).toBe(true);
    expect(result.error).toBe('Rogers Bank transactions unavailable — reconciliation skipped');
  });

  it('deletes nothing when the response is not an array', async () => {
    const holdId = await generatePendingTransactionId(AGED_HOLD_TX);
    const monarchPending = [makeMonarchPendingRow('monarch-tx-1', holdId)];

    const result = await reconcileRogersFetchedPending(pendingTag, monarchPending, null);

    expect(monarchApi.deleteTransaction).not.toHaveBeenCalled();
    expect(result.sourceUnavailable).toBe(true);
  });

  it('leaves an aged hold alone when the widened window returns it as still pending', async () => {
    // This is the bug-2 scenario after the fix: the upload service extends the
    // fetch window back to the oldest Monarch pending date, so the hold is in
    // the response and is correctly recognised as still pending.
    const holdId = await generatePendingTransactionId(AGED_HOLD_TX);
    const monarchPending = [makeMonarchPendingRow('monarch-tx-1', holdId)];

    const result = await reconcileRogersFetchedPending(pendingTag, monarchPending, [
      { ...AGED_HOLD_TX, activityStatus: 'PENDING' },
      UNRELATED_ROGERS_TX,
    ]);

    expect(monarchApi.deleteTransaction).not.toHaveBeenCalled();
    expect(result.cancelled).toBe(0);
    expect(result.settled).toBe(0);
    expect(result.success).toBe(true);
  });

  it('still deletes a genuinely cancelled hold when the response is trustworthy', async () => {
    // Guard rail on the guard: a non-empty response that simply lacks the
    // transaction must still reconcile it as cancelled.
    const holdId = await generatePendingTransactionId(AGED_HOLD_TX);
    const monarchPending = [makeMonarchPendingRow('monarch-tx-1', holdId)];
    monarchApi.deleteTransaction.mockResolvedValue({});

    const result = await reconcileRogersFetchedPending(pendingTag, monarchPending, [UNRELATED_ROGERS_TX]);

    expect(monarchApi.deleteTransaction).toHaveBeenCalledWith('monarch-tx-1');
    expect(result.cancelled).toBe(1);
    expect(result.success).toBe(true);
    expect(result.sourceUnavailable).toBeUndefined();
  });
});

describe('formatReconciliationMessage — unavailable source', () => {
  it('reports the skip rather than an empty reconciliation', () => {
    const message = formatReconciliationMessage({
      success: false,
      settled: 0,
      cancelled: 0,
      failed: 0,
      error: 'Rogers Bank transactions unavailable — reconciliation skipped',
      settledRefIds: [],
      sourceUnavailable: true,
    });

    expect(message).toBe('Skipped — Rogers Bank data unavailable');
  });
});
