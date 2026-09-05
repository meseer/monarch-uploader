/**
 * Tests for retention of the transaction id during pending reconciliation
 *
 * Reconciliation used to strip the `{prefix}:{hash}` id from the notes
 * unconditionally at settlement. That silently orphaned any other follow-up pass
 * that still needed the id — most importantly the post-upload owner sync, whose
 * marker tag would then be stuck on the transaction forever.
 *
 * Reconciliation stays unaware of *what* the other marker is for; it only asks
 * "are any markers left?", which is what keeps the two passes order-independent.
 */

import { reconcileFetchedPendingTransactions } from '../../../src/services/common/pendingReconciliation';

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

const monarchApi = require('../../../src/api/monarch').default;

const PENDING_TAG = { id: 'tag-pending', name: 'Pending' };
const OWNER_TAG = { id: 'tag-owner', name: 'pendingOwnerUpdate' };
const CURRENCY_TAG = { id: 'tag-eur', name: 'EUR' };

const TX_PREFIX = 'test-tx';
// Hash of the fixture's id fields, computed via the real crypto in setup
const SOURCE_TX = { id: 'src-1', date: '2026-09-01', amount: 42.5 };

/** getPendingIdFields hook for the fixture */
const getPendingIdFields = (tx) => [tx.date, String(tx.amount)];

/** Run phase 2 with a single Monarch pending row */
const reconcile = async (monarchTx, { settled = [SOURCE_TX], pending = [] } = {}) => (
  reconcileFetchedPendingTransactions({
    txIdPrefix: TX_PREFIX,
    pendingTag: PENDING_TAG,
    monarchPendingTransactions: [monarchTx],
    rawSettled: settled,
    rawPending: pending,
    getPendingIdFields,
    getSettledAmount: (tx) => -tx.amount,
    getSettledRefId: (tx) => tx.id,
  })
);

/**
 * Compute the hash the service will generate for the fixture, so the Monarch
 * notes fixture carries the id the service actually looks for.
 */
async function fixtureHash() {
  const encoder = new TextEncoder();
  const data = encoder.encode([SOURCE_TX.date, String(SOURCE_TX.amount)].join('|'));
  const buf = await crypto.subtle.digest('SHA-256', data);
  const hex = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${TX_PREFIX}:${hex.substring(0, 16)}`;
}

let HASH;

beforeAll(async () => {
  HASH = await fixtureHash();
});

beforeEach(() => {
  jest.clearAllMocks();
  monarchApi.updateTransaction.mockResolvedValue({ id: 'monarch-1' });
  monarchApi.setTransactionTags.mockResolvedValue({ id: 'monarch-1' });
  monarchApi.deleteTransaction.mockResolvedValue(true);
});

/** A Monarch pending row carrying the fixture's hash */
const monarchRow = (tags) => ({
  id: 'monarch-1',
  notes: HASH,
  amount: -42.5,
  tags,
  ownedByUser: null,
});

describe('settlement with no other marker present', () => {
  it('strips the id from the notes', async () => {
    await reconcile(monarchRow([PENDING_TAG]));

    expect(monarchApi.updateTransaction).toHaveBeenCalledWith('monarch-1', expect.objectContaining({
      notes: '',
    }));
  });

  it('removes the Pending tag', async () => {
    await reconcile(monarchRow([PENDING_TAG]));

    expect(monarchApi.setTransactionTags).toHaveBeenCalledWith('monarch-1', []);
  });

  it('strips the id even when a non-marker tag remains', async () => {
    // A currency or cardholder tag is user-facing data, not processing state,
    // so it must not keep the id alive
    await reconcile(monarchRow([PENDING_TAG, CURRENCY_TAG]));

    expect(monarchApi.updateTransaction).toHaveBeenCalledWith('monarch-1', expect.objectContaining({
      notes: '',
    }));
    expect(monarchApi.setTransactionTags).toHaveBeenCalledWith('monarch-1', [CURRENCY_TAG.id]);
  });

  it('reports the settlement', async () => {
    const result = await reconcile(monarchRow([PENDING_TAG]));

    expect(result.settled).toBe(1);
  });
});

describe('settlement with an outstanding owner update', () => {
  it('RETAINS the id in the notes', async () => {
    // The owner sync pass still needs this id to identify the transaction
    await reconcile(monarchRow([PENDING_TAG, OWNER_TAG]));

    expect(monarchApi.updateTransaction).toHaveBeenCalledWith('monarch-1', expect.objectContaining({
      notes: HASH,
    }));
  });

  it('still removes the Pending tag', async () => {
    await reconcile(monarchRow([PENDING_TAG, OWNER_TAG]));

    expect(monarchApi.setTransactionTags).toHaveBeenCalledWith('monarch-1', [OWNER_TAG.id]);
  });

  it('preserves user tags alongside the retained marker', async () => {
    await reconcile(monarchRow([PENDING_TAG, OWNER_TAG, CURRENCY_TAG]));

    expect(monarchApi.setTransactionTags).toHaveBeenCalledWith(
      'monarch-1',
      [OWNER_TAG.id, CURRENCY_TAG.id],
    );
  });

  it('still records the settlement normally', async () => {
    const result = await reconcile(monarchRow([PENDING_TAG, OWNER_TAG]));

    expect(result.settled).toBe(1);
    expect(result.settledRefIds).toEqual(['src-1']);
  });

  it('preserves user notes while retaining the id', async () => {
    const row = { ...monarchRow([PENDING_TAG, OWNER_TAG]), notes: `Groceries\n${HASH}` };

    await reconcile(row);

    expect(monarchApi.updateTransaction).toHaveBeenCalledWith('monarch-1', expect.objectContaining({
      notes: `Groceries\n${HASH}`,
    }));
  });
});

describe('existing owner is never disturbed', () => {
  it('passes through an owner the user set manually', async () => {
    const row = { ...monarchRow([PENDING_TAG]), ownedByUser: { id: 'user-9' } };

    await reconcile(row);

    expect(monarchApi.updateTransaction).toHaveBeenCalledWith('monarch-1', expect.objectContaining({
      ownerUserId: 'user-9',
    }));
  });

  it('passes null when no owner is set', async () => {
    await reconcile(monarchRow([PENDING_TAG]));

    expect(monarchApi.updateTransaction).toHaveBeenCalledWith('monarch-1', expect.objectContaining({
      ownerUserId: null,
    }));
  });
});

describe('non-settlement outcomes are unaffected by retention', () => {
  it('takes no action while the transaction is still pending', async () => {
    await reconcile(monarchRow([PENDING_TAG, OWNER_TAG]), {
      settled: [],
      pending: [SOURCE_TX],
    });

    expect(monarchApi.updateTransaction).not.toHaveBeenCalled();
    expect(monarchApi.setTransactionTags).not.toHaveBeenCalled();
    expect(monarchApi.deleteTransaction).not.toHaveBeenCalled();
  });

  it('deletes a cancelled transaction even if it had an owner update queued', async () => {
    const result = await reconcile(monarchRow([PENDING_TAG, OWNER_TAG]), {
      settled: [],
      pending: [],
    });

    expect(monarchApi.deleteTransaction).toHaveBeenCalledWith('monarch-1');
    expect(result.cancelled).toBe(1);
  });
});