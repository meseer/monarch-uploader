/**
 * Regression tests for the two Wealthsimple data-loss bugs in Phase 2
 * reconciliation. Kept in their own file because
 * `transactionsReconciliation.test.js` is already at the 1,500-line limit.
 *
 * Bug 1 — a transient fetch failure returned `[]`, which was indistinguishable
 * from "no transactions", so every Monarch pending row was hard-deleted along
 * with the user's categories, notes, splits and tags. The IDs stayed in the
 * dedup store, so the settled versions were never re-uploaded: the charges
 * vanished permanently.
 *
 * Bug 8 — uploads key the notes marker off `getTransactionId(tx)`
 * (`externalCanonicalId` → `canonicalId` → `generated:{...}`), but the Phase 2
 * lookup map was keyed only by `externalCanonicalId`. Any row whose marker came
 * from a fallback id (CASH-account interest transactions have a null
 * `externalCanonicalId`) was unmatchable and deleted as "cancelled" on the very
 * next sync.
 */

import {
  reconcileWealthsimpleFetchedPending,
  formatTransactionIdForNotes,
} from '../../../src/services/wealthsimple/transactionsReconciliation';
import { getTransactionId } from '../../../src/services/wealthsimple/transactionRulesHelpers';

// ── Mocks ───────────────────────────────────────────────────

jest.mock('../../../src/core/utils', () => ({
  debugLog: jest.fn(),
  formatDate: jest.fn((d) => d.toISOString().split('T')[0]),
  formatAmount: (amount) => {
    if (amount === null || amount === undefined || isNaN(Number(amount))) return '0';
    return parseFloat(String(amount)).toString().replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  },
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

jest.mock('../../../src/api/wealthsimple', () => ({
  __esModule: true,
  default: {
    fetchExtendedOrder: jest.fn(),
    fetchActivityByOrdersServiceOrderId: jest.fn(),
    fetchCryptoOrder: jest.fn(),
    fetchCorporateActionChildActivities: jest.fn(),
    fetchShortOptionPositionExpiryDetail: jest.fn(),
    fetchSecurity: jest.fn(),
    fetchCreditCardActivity: jest.fn(),
    fetchSpendTransactions: jest.fn(),
  },
}));

jest.mock('../../../src/mappers/merchant', () => ({
  applyMerchantMapping: jest.fn((name) => name),
}));

jest.mock('../../../src/mappers/category', () => ({
  resolveCategoryForTransaction: jest.fn(),
  getCategoryMappings: jest.fn(() => ({})),
}));

global.GM_getValue = jest.fn(() => '[]');

const mockMonarchApi = require('../../../src/api/monarch').default;

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Helpers ─────────────────────────────────────────────────

const pendingTag = { id: 'tag-pending', name: 'Pending' };

const makeMonarchTx = (id, notes, overrides = {}) => ({
  id,
  amount: -25.0,
  date: '2026-01-10',
  notes,
  tags: [{ id: 'tag-pending', name: 'Pending' }],
  ownedByUser: { id: 'user-1' },
  ...overrides,
});

/** A settled card transaction that has nothing to do with the pending rows */
const makeUnrelatedWsTx = () => ({
  externalCanonicalId: 'card-activity-unrelated-1',
  amount: 9.99,
  amountSign: 'negative',
  status: 'settled',
  type: 'SPEND',
  subType: 'PURCHASE',
});

/** CASH interest activity: Wealthsimple returns these with no externalCanonicalId */
const makeCashInterestTx = (overrides = {}) => ({
  externalCanonicalId: null,
  canonicalId: null,
  accountId: 'cash-abc123',
  occurredAt: '2026-01-10T12:00:00.000Z',
  type: 'INTEREST',
  subType: 'CASH_INTEREST',
  amount: 1.23,
  currency: 'CAD',
  unifiedStatus: 'IN_PROGRESS',
  ...overrides,
});

// ── Bug 1: untrustworthy source feed must never delete ──────

describe('reconcileWealthsimpleFetchedPending — untrustworthy source feed', () => {
  it('deletes nothing when the Wealthsimple fetch failed', async () => {
    const monarchPending = [
      makeMonarchTx('mtx-1', 'ws-tx:card-activity-1'),
      makeMonarchTx('mtx-2', 'ws-tx:card-activity-2'),
    ];

    const result = await reconcileWealthsimpleFetchedPending(
      pendingTag,
      monarchPending,
      [],
      'CREDIT_CARD',
      { sourceFetchFailed: true },
    );

    expect(mockMonarchApi.deleteTransaction).not.toHaveBeenCalled();
    expect(result.cancelled).toBe(0);
    expect(result.settled).toBe(0);
    expect(result.success).toBe(false);
    expect(result.sourceUnavailable).toBe(true);
    expect(result.error).toBe('Wealthsimple transactions unavailable — reconciliation skipped');
  });

  it('deletes nothing when the feed is empty even without an explicit failure flag', async () => {
    // A silently-empty response is just as untrustworthy as a thrown error:
    // an account with Monarch pending rows always has matching source activity.
    const monarchPending = [makeMonarchTx('mtx-1', 'ws-tx:card-activity-1')];

    const result = await reconcileWealthsimpleFetchedPending(pendingTag, monarchPending, []);

    expect(mockMonarchApi.deleteTransaction).not.toHaveBeenCalled();
    expect(result.sourceUnavailable).toBe(true);
    expect(result.cancelled).toBe(0);
  });

  it('deletes nothing when the fetch failed but a partial feed came back', async () => {
    const monarchPending = [makeMonarchTx('mtx-1', 'ws-tx:card-activity-1')];

    const result = await reconcileWealthsimpleFetchedPending(
      pendingTag,
      monarchPending,
      [makeUnrelatedWsTx()],
      'CREDIT_CARD',
      { sourceFetchFailed: true },
    );

    expect(mockMonarchApi.deleteTransaction).not.toHaveBeenCalled();
    expect(result.sourceUnavailable).toBe(true);
  });

  it('treats a non-array feed as untrustworthy rather than crashing', async () => {
    const monarchPending = [makeMonarchTx('mtx-1', 'ws-tx:card-activity-1')];

    const result = await reconcileWealthsimpleFetchedPending(pendingTag, monarchPending, null);

    expect(mockMonarchApi.deleteTransaction).not.toHaveBeenCalled();
    expect(result.sourceUnavailable).toBe(true);
  });

  it('is a successful no-op when the feed is empty and Monarch holds no pending rows', async () => {
    const result = await reconcileWealthsimpleFetchedPending(pendingTag, [], [], 'CREDIT_CARD', {
      sourceFetchFailed: true,
    });

    expect(result.success).toBe(true);
    expect(result.sourceUnavailable).toBeUndefined();
    expect(mockMonarchApi.deleteTransaction).not.toHaveBeenCalled();
  });

  it('still deletes a genuinely cancelled transaction when the feed is trustworthy', async () => {
    // Guard rail on the guard: a trustworthy, non-empty feed that simply lacks
    // the pending transaction must still reconcile it as cancelled.
    const monarchPending = [makeMonarchTx('mtx-1', 'ws-tx:card-activity-gone')];

    const result = await reconcileWealthsimpleFetchedPending(
      pendingTag,
      monarchPending,
      [makeUnrelatedWsTx()],
    );

    expect(mockMonarchApi.deleteTransaction).toHaveBeenCalledWith('mtx-1');
    expect(result.cancelled).toBe(1);
    expect(result.success).toBe(true);
    expect(result.sourceUnavailable).toBeUndefined();
  });
});

// ── Bug 8: fallback transaction ids must match ──────────────

describe('reconcileWealthsimpleFetchedPending — fallback transaction identity', () => {
  it('matches a pending row whose marker is a canonicalId', async () => {
    const wsTx = makeCashInterestTx({ canonicalId: 'canonical-interest-1' });
    const markerId = getTransactionId(wsTx);
    expect(markerId).toBe('canonical-interest-1');

    const monarchPending = [makeMonarchTx('mtx-1', formatTransactionIdForNotes(markerId))];

    const result = await reconcileWealthsimpleFetchedPending(
      pendingTag,
      monarchPending,
      [wsTx],
      'CASH',
    );

    // Still IN_PROGRESS upstream, so the correct outcome is "leave it alone"
    expect(mockMonarchApi.deleteTransaction).not.toHaveBeenCalled();
    expect(result.cancelled).toBe(0);
    expect(result.settled).toBe(0);
    expect(result.success).toBe(true);
  });

  it('matches a pending row whose marker is a generated: fallback id', async () => {
    const wsTx = makeCashInterestTx();
    const markerId = getTransactionId(wsTx);
    expect(markerId).toBe('generated:cash-abc123:2026-01-10T12:00:00.000Z:INTEREST:CASH_INTEREST:1.23:CAD');

    const monarchPending = [makeMonarchTx('mtx-1', formatTransactionIdForNotes(markerId))];

    const result = await reconcileWealthsimpleFetchedPending(
      pendingTag,
      monarchPending,
      [wsTx, makeUnrelatedWsTx()],
      'CASH',
    );

    expect(mockMonarchApi.deleteTransaction).not.toHaveBeenCalled();
    expect(result.cancelled).toBe(0);
  });

  it('round-trips a generated: marker embedded in multi-line notes', async () => {
    const wsTx = makeCashInterestTx();
    const markerId = getTransactionId(wsTx);
    const notes = `Interest earned\nCAD$1.23\n${formatTransactionIdForNotes(markerId)}`;

    const result = await reconcileWealthsimpleFetchedPending(
      pendingTag,
      [makeMonarchTx('mtx-1', notes)],
      [wsTx],
      'CASH',
    );

    expect(mockMonarchApi.deleteTransaction).not.toHaveBeenCalled();
    expect(result.cancelled).toBe(0);
  });

  it('settles a generated:-id transaction and reports its id for the dedup store', async () => {
    const wsTx = makeCashInterestTx({ unifiedStatus: 'COMPLETED' });
    const markerId = getTransactionId(wsTx);

    const result = await reconcileWealthsimpleFetchedPending(
      pendingTag,
      [makeMonarchTx('mtx-1', formatTransactionIdForNotes(markerId))],
      [wsTx],
      'CASH',
    );

    expect(mockMonarchApi.deleteTransaction).not.toHaveBeenCalled();
    expect(result.settled).toBe(1);
    expect(result.settledRefIds).toEqual([markerId]);
  });

  it('parses legacy pipe-separated markers written by older versions', async () => {
    const wsTx = makeCashInterestTx({ canonicalId: 'canonical-interest-2' });
    const markerId = getTransactionId(wsTx);
    const notes = `${formatTransactionIdForNotes(markerId)}|Interest earned`;

    const result = await reconcileWealthsimpleFetchedPending(
      pendingTag,
      [makeMonarchTx('mtx-1', notes)],
      [wsTx],
      'CASH',
    );

    expect(mockMonarchApi.deleteTransaction).not.toHaveBeenCalled();
    expect(result.cancelled).toBe(0);
  });

  it('parses legacy comma-separated markers written by older versions', async () => {
    const wsTx = makeCashInterestTx({ canonicalId: 'canonical-interest-3' });
    const markerId = getTransactionId(wsTx);
    const notes = `${formatTransactionIdForNotes(markerId)},Interest earned`;

    const result = await reconcileWealthsimpleFetchedPending(
      pendingTag,
      [makeMonarchTx('mtx-1', notes)],
      [wsTx],
      'CASH',
    );

    expect(mockMonarchApi.deleteTransaction).not.toHaveBeenCalled();
    expect(result.cancelled).toBe(0);
  });

  it('still deletes a fallback-id row that is genuinely absent from a trustworthy feed', async () => {
    const goneTx = makeCashInterestTx({ occurredAt: '2025-12-01T00:00:00.000Z' });
    const markerId = getTransactionId(goneTx);

    const result = await reconcileWealthsimpleFetchedPending(
      pendingTag,
      [makeMonarchTx('mtx-1', formatTransactionIdForNotes(markerId))],
      [makeCashInterestTx(), makeUnrelatedWsTx()],
      'CASH',
    );

    expect(mockMonarchApi.deleteTransaction).toHaveBeenCalledWith('mtx-1');
    expect(result.cancelled).toBe(1);
  });
});
