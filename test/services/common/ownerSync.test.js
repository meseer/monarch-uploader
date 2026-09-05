/**
 * Tests for the post-upload owner sync service
 *
 * Monarch's CSV importer has no owner column, so the Owner value is applied by
 * this GraphQL pass after the import. The properties under test are the ones the
 * design depends on:
 *
 * - never overwrite an owner the user set by hand (also makes it idempotent)
 * - anything unfinished keeps its marker tag and is retried next sync
 * - the notes id survives while another marker still needs it
 * - nothing here can ever abort a sync
 */

import {
  syncTransactionOwners,
  buildOwnerResolver,
  formatOwnerSyncMessage,
  extractTxIdFromNotes,
  stripTxIdFromNotes,
} from '../../../src/services/common/ownerSync';

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
  },
}));

const monarchApi = require('../../../src/api/monarch').default;

const MARKER_TAG = { id: 'tag-owner', name: 'pendingOwnerUpdate' };
const PENDING_TAG = { id: 'tag-pending', name: 'Pending' };
const CARDHOLDER_TAG = { id: 'tag-mike', name: 'Mykhailo Delegan' };

const TX_ID = 'rb-tx:abcdef0123456789';
const OWNER_ID = '162625044845828370';

/** A Monarch row queued for an owner update */
const queuedRow = (overrides = {}) => ({
  id: 'monarch-tx-1',
  notes: TX_ID,
  tags: [MARKER_TAG],
  ownedByUser: null,
  ...overrides,
});

/** Base params; sleep is stubbed so the retry path never actually waits */
const params = (overrides = {}) => ({
  monarchAccountId: 'monarch-acct-1',
  txIdPrefix: 'rb-tx',
  resolveOwnerForTxId: jest.fn(() => OWNER_ID),
  lookbackDays: 91,
  sleep: jest.fn(() => Promise.resolve()),
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  monarchApi.getTagByName.mockResolvedValue(MARKER_TAG);
  monarchApi.getTransactionsList.mockResolvedValue({ results: [queuedRow()] });
  monarchApi.updateTransaction.mockResolvedValue({ id: 'monarch-tx-1' });
  monarchApi.setTransactionTags.mockResolvedValue({ id: 'monarch-tx-1' });
});

describe('extractTxIdFromNotes', () => {
  it('extracts the id from notes containing only the id', () => {
    expect(extractTxIdFromNotes('rb-tx', TX_ID)).toBe(TX_ID);
  });

  it('extracts the id from notes with surrounding user content', () => {
    expect(extractTxIdFromNotes('rb-tx', `My note\n99.77 USD @ 1.36\n${TX_ID}`)).toBe(TX_ID);
  });

  it('returns null when no id is present', () => {
    expect(extractTxIdFromNotes('rb-tx', 'Just a user note')).toBeNull();
  });

  it('returns null for empty or missing notes', () => {
    expect(extractTxIdFromNotes('rb-tx', '')).toBeNull();
    expect(extractTxIdFromNotes('rb-tx', null)).toBeNull();
    expect(extractTxIdFromNotes('rb-tx', undefined)).toBeNull();
  });

  it('does not match a different integration prefix', () => {
    expect(extractTxIdFromNotes('rb-tx', 'mbna-tx:abcdef0123456789')).toBeNull();
  });

  it('does not match a truncated hash', () => {
    expect(extractTxIdFromNotes('rb-tx', 'rb-tx:abc')).toBeNull();
  });

  it('handles a prefix containing regex-special characters', () => {
    expect(extractTxIdFromNotes('rb.tx', 'rb.tx:abcdef0123456789')).toBe('rb.tx:abcdef0123456789');
  });
});

describe('stripTxIdFromNotes', () => {
  it('removes an id that is the entire notes value', () => {
    expect(stripTxIdFromNotes('rb-tx', TX_ID)).toBe('');
  });

  it('preserves user content around the id', () => {
    expect(stripTxIdFromNotes('rb-tx', `My note\n${TX_ID}`)).toBe('My note');
  });

  it('leaves no stray blank lines behind', () => {
    const cleaned = stripTxIdFromNotes('rb-tx', `Line one\n${TX_ID}\nLine two`);

    expect(cleaned).toBe('Line one\nLine two');
    expect(cleaned).not.toMatch(/\n\n/);
  });

  it('returns an empty string for empty input', () => {
    expect(stripTxIdFromNotes('rb-tx', '')).toBe('');
    expect(stripTxIdFromNotes('rb-tx', null)).toBe('');
  });

  it('leaves notes untouched when no id is present', () => {
    expect(stripTxIdFromNotes('rb-tx', 'Just a user note')).toBe('Just a user note');
  });
});

describe('buildOwnerResolver', () => {
  it('resolves a known id to its Monarch user', () => {
    const resolve = buildOwnerResolver(new Map([[TX_ID, OWNER_ID]]));

    expect(resolve(TX_ID)).toBe(OWNER_ID);
  });

  it('returns null for an unknown id', () => {
    expect(buildOwnerResolver(new Map())(TX_ID)).toBeNull();
  });
});

describe('syncTransactionOwners — happy path', () => {
  it('sets the owner on a queued transaction', async () => {
    const result = await syncTransactionOwners(params());

    expect(monarchApi.updateTransaction).toHaveBeenCalledWith('monarch-tx-1', expect.objectContaining({
      ownerUserId: OWNER_ID,
    }));
    expect(result.updated).toBe(1);
    expect(result.success).toBe(true);
  });

  it('queries only the marker-tagged transactions for the account', async () => {
    await syncTransactionOwners(params());

    expect(monarchApi.getTransactionsList).toHaveBeenCalledWith(expect.objectContaining({
      accountIds: ['monarch-acct-1'],
      tags: [MARKER_TAG.id],
    }));
  });

  it('drops the marker tag once the owner is set', async () => {
    await syncTransactionOwners(params());

    expect(monarchApi.setTransactionTags).toHaveBeenCalledWith('monarch-tx-1', []);
  });

  it('preserves non-marker tags when dropping the marker', async () => {
    monarchApi.getTransactionsList.mockResolvedValue({
      results: [queuedRow({ tags: [MARKER_TAG, CARDHOLDER_TAG] })],
    });

    await syncTransactionOwners(params());

    expect(monarchApi.setTransactionTags).toHaveBeenCalledWith('monarch-tx-1', [CARDHOLDER_TAG.id]);
  });

  it('strips the id from notes when no marker remains', async () => {
    await syncTransactionOwners(params());

    expect(monarchApi.updateTransaction).toHaveBeenCalledWith('monarch-tx-1', expect.objectContaining({
      notes: '',
    }));
  });

  it('preserves user notes while stripping the id', async () => {
    monarchApi.getTransactionsList.mockResolvedValue({
      results: [queuedRow({ notes: `Dinner with friends\n${TX_ID}` })],
    });

    await syncTransactionOwners(params());

    expect(monarchApi.updateTransaction).toHaveBeenCalledWith('monarch-tx-1', expect.objectContaining({
      notes: 'Dinner with friends',
    }));
  });

  it('RETAINS the id in notes while the Pending marker is still present', async () => {
    // The transaction is still pending, so reconciliation will need this id later
    monarchApi.getTransactionsList.mockResolvedValue({
      results: [queuedRow({ tags: [MARKER_TAG, PENDING_TAG] })],
    });

    await syncTransactionOwners(params());

    expect(monarchApi.updateTransaction).toHaveBeenCalledWith('monarch-tx-1', expect.objectContaining({
      notes: TX_ID,
    }));
    expect(monarchApi.setTransactionTags).toHaveBeenCalledWith('monarch-tx-1', [PENDING_TAG.id]);
  });

  it('processes several queued transactions', async () => {
    monarchApi.getTransactionsList.mockResolvedValue({
      results: [
        queuedRow({ id: 'tx-1', notes: 'rb-tx:1111111111111111' }),
        queuedRow({ id: 'tx-2', notes: 'rb-tx:2222222222222222' }),
      ],
    });

    const result = await syncTransactionOwners(params());

    expect(result.updated).toBe(2);
  });
});

describe('syncTransactionOwners — never overwrites a manual owner', () => {
  it('skips a row that already has an owner', async () => {
    monarchApi.getTransactionsList.mockResolvedValue({
      results: [queuedRow({ ownedByUser: { id: 'someone-else' } })],
    });

    const result = await syncTransactionOwners(params());

    expect(monarchApi.updateTransaction).not.toHaveBeenCalled();
    expect(result.alreadyOwned).toBe(1);
    expect(result.updated).toBe(0);
  });

  it('is idempotent: a second pass over an owned row changes nothing', async () => {
    monarchApi.getTransactionsList.mockResolvedValue({
      results: [queuedRow({ ownedByUser: { id: OWNER_ID } })],
    });

    await syncTransactionOwners(params());
    await syncTransactionOwners(params());

    expect(monarchApi.updateTransaction).not.toHaveBeenCalled();
  });
});

describe('syncTransactionOwners — self-healing queue', () => {
  it('keeps the marker on an unmatched row so a later sync retries it', async () => {
    const result = await syncTransactionOwners(params({
      resolveOwnerForTxId: jest.fn(() => null),
    }));

    expect(monarchApi.setTransactionTags).not.toHaveBeenCalled();
    expect(monarchApi.updateTransaction).not.toHaveBeenCalled();
    expect(result.unmatched).toBe(1);
  });

  it('treats a row with no id in its notes as unmatched, not failed', async () => {
    monarchApi.getTransactionsList.mockResolvedValue({
      results: [queuedRow({ notes: 'user note only' })],
    });

    const result = await syncTransactionOwners(params());

    expect(result.unmatched).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('defers rows beyond the per-sync cap instead of firing an unbounded burst', async () => {
    monarchApi.getTransactionsList.mockResolvedValue({
      results: Array.from({ length: 5 }, (_, i) => queuedRow({
        id: `tx-${i}`,
        notes: `rb-tx:${String(i).repeat(16)}`,
      })),
    });

    const result = await syncTransactionOwners(params({ maxUpdates: 2 }));

    expect(result.updated).toBe(2);
    expect(result.deferred).toBe(3);
    expect(monarchApi.updateTransaction).toHaveBeenCalledTimes(2);
  });

  it('counts a per-row error without aborting the remaining rows', async () => {
    monarchApi.getTransactionsList.mockResolvedValue({
      results: [
        queuedRow({ id: 'tx-1', notes: 'rb-tx:1111111111111111' }),
        queuedRow({ id: 'tx-2', notes: 'rb-tx:2222222222222222' }),
      ],
    });
    monarchApi.updateTransaction
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValue({ id: 'tx-2' });

    const result = await syncTransactionOwners(params());

    expect(result.failed).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.success).toBe(true);
  });

  it('leaves the marker in place when the tag removal fails mid-row', async () => {
    // The notes update succeeded but the tag removal did not, so the row keeps
    // both its marker and its id and the next sync repeats the update.
    monarchApi.setTransactionTags.mockRejectedValue(new Error('tag write failed'));

    const result = await syncTransactionOwners(params());

    expect(result.failed).toBe(1);
    expect(result.updated).toBe(0);
  });
});

describe('syncTransactionOwners — marker tag propagation', () => {
  it('retries the tag lookup while the tag may still be propagating', async () => {
    // The tag is created by the import that just finished, so it can be briefly
    // invisible. Retrying converts a wasted sync into a successful one.
    monarchApi.getTagByName
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(MARKER_TAG);

    const result = await syncTransactionOwners(params());

    expect(monarchApi.getTagByName).toHaveBeenCalledTimes(2);
    expect(result.updated).toBe(1);
  });

  it('waits between lookup attempts', async () => {
    const sleep = jest.fn(() => Promise.resolve());
    monarchApi.getTagByName.mockResolvedValueOnce(null).mockResolvedValueOnce(MARKER_TAG);

    await syncTransactionOwners(params({ sleep }));

    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('gives up after the bounded attempts and defers to the next sync', async () => {
    monarchApi.getTagByName.mockResolvedValue(null);

    const result = await syncTransactionOwners(params());

    expect(result.noMarkerTag).toBe(true);
    expect(result.success).toBe(true); // deferring is not a failure
    expect(monarchApi.getTransactionsList).not.toHaveBeenCalled();
  });

  it('does not retry once the tag resolves on the first attempt', async () => {
    const sleep = jest.fn(() => Promise.resolve());

    await syncTransactionOwners(params({ sleep }));

    expect(monarchApi.getTagByName).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe('syncTransactionOwners — non-fatal behaviour', () => {
  it('reports no pending owners when nothing carries the marker', async () => {
    monarchApi.getTransactionsList.mockResolvedValue({ results: [] });

    const result = await syncTransactionOwners(params());

    expect(result.noPendingOwners).toBe(true);
    expect(result.updated).toBe(0);
  });

  it('never throws when the transaction query fails', async () => {
    monarchApi.getTransactionsList.mockRejectedValue(new Error('Monarch API Error'));

    const result = await syncTransactionOwners(params());

    expect(result.success).toBe(false);
    expect(result.error).toBe('Monarch API Error');
  });

  it('never throws when the tag lookup fails outright', async () => {
    monarchApi.getTagByName.mockRejectedValue(new Error('auth expired'));

    const result = await syncTransactionOwners(params());

    expect(result.success).toBe(false);
    expect(result.error).toBe('auth expired');
  });

  it('counts a row with no id field as failed rather than crashing', async () => {
    monarchApi.getTransactionsList.mockResolvedValue({ results: [queuedRow({ id: undefined })] });

    const result = await syncTransactionOwners(params());

    expect(result.failed).toBe(1);
  });
});

describe('formatOwnerSyncMessage', () => {
  const base = {
    success: true, updated: 0, alreadyOwned: 0, unmatched: 0, failed: 0, deferred: 0, error: null,
  };

  it('reports none pending when the marker tag is absent', () => {
    expect(formatOwnerSyncMessage({ ...base, noMarkerTag: true })).toBe('None pending');
  });

  it('reports none pending when nothing is queued', () => {
    expect(formatOwnerSyncMessage({ ...base, noPendingOwners: true })).toBe('None pending');
  });

  it('pluralises a single owner correctly', () => {
    expect(formatOwnerSyncMessage({ ...base, updated: 1 })).toBe('1 owner set');
  });

  it('pluralises multiple owners correctly', () => {
    expect(formatOwnerSyncMessage({ ...base, updated: 3 })).toBe('3 owners set');
  });

  it('surfaces every non-zero outcome', () => {
    expect(formatOwnerSyncMessage({
      ...base, updated: 2, alreadyOwned: 1, unmatched: 3, deferred: 4, failed: 1,
    })).toBe('2 owners set, 1 already set, 3 unmatched, 4 deferred, 1 failed');
  });

  it('falls back to a neutral message when nothing happened', () => {
    expect(formatOwnerSyncMessage(base)).toBe('Nothing to update');
  });
});