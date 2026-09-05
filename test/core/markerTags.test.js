/**
 * Tests for the marker-tag retention invariant
 *
 * The rule these tests protect:
 *
 *   Keep the {prefix}:{hash} transaction id in the notes while ANY marker tag
 *   is present. Strip it only when the last marker is removed.
 *
 * That single rule is what makes the follow-up passes (pending reconciliation
 * and owner sync) both crash-safe and order-independent, so the tests below
 * exercise it from both orderings and from a mid-pass failure.
 */

import {
  shouldRetainTxIdInNotes,
  selectTagsByIds,
  resolveNotesTransactionId,
} from '../../src/core/markerTags';

// Realistic tag fixtures: Monarch returns tag objects with id + name
const PENDING = { id: 'tag-pending', name: 'Pending' };
const OWNER = { id: 'tag-owner', name: 'pendingOwnerUpdate' };
const USER_TAG = { id: 'tag-eur', name: 'EUR' };
const CARDHOLDER_TAG = { id: 'tag-mike', name: 'Mykhailo Delegan' };

// Marker recognition is intentionally not exported — it is exercised through
// `shouldRetainTxIdInNotes`, which is the only decision callers should make.
describe('marker recognition (via the retention rule)', () => {
  it('recognises the Pending marker', () => {
    expect(shouldRetainTxIdInNotes([PENDING])).toBe(true);
  });

  it('recognises the pendingOwnerUpdate marker', () => {
    expect(shouldRetainTxIdInNotes([OWNER])).toBe(true);
  });

  it('accepts bare tag names as well as tag objects', () => {
    expect(shouldRetainTxIdInNotes(['Pending'])).toBe(true);
  });

  it('does not treat a user tag as a marker', () => {
    expect(shouldRetainTxIdInNotes([USER_TAG])).toBe(false);
  });

  it('does not treat a cardholder tag as a marker', () => {
    // Cardholder tags are user-visible data, not processing state
    expect(shouldRetainTxIdInNotes([CARDHOLDER_TAG])).toBe(false);
  });

  it('matches case-insensitively, as Monarch tag names are', () => {
    expect(shouldRetainTxIdInNotes(['pendingownerupdate'])).toBe(true);
    expect(shouldRetainTxIdInNotes(['PENDING'])).toBe(true);
  });

  it('ignores surrounding whitespace', () => {
    expect(shouldRetainTxIdInNotes(['  Pending  '])).toBe(true);
  });

  it('ignores null, undefined, and empty tag entries', () => {
    expect(shouldRetainTxIdInNotes([null, undefined, '', {}])).toBe(false);
  });
});

describe('shouldRetainTxIdInNotes', () => {
  it('does not retain when no tags remain', () => {
    expect(shouldRetainTxIdInNotes([])).toBe(false);
  });

  it('does not retain for null/undefined input', () => {
    expect(shouldRetainTxIdInNotes(null)).toBe(false);
    expect(shouldRetainTxIdInNotes(undefined)).toBe(false);
  });

  it('does not retain when only non-marker tags remain', () => {
    expect(shouldRetainTxIdInNotes([USER_TAG, CARDHOLDER_TAG])).toBe(false);
  });

  it('retains while the Pending marker remains', () => {
    expect(shouldRetainTxIdInNotes([PENDING])).toBe(true);
  });

  it('retains while the owner marker remains', () => {
    expect(shouldRetainTxIdInNotes([OWNER])).toBe(true);
  });

  it('retains when a marker is mixed in with user tags', () => {
    expect(shouldRetainTxIdInNotes([USER_TAG, OWNER, CARDHOLDER_TAG])).toBe(true);
  });
});

describe('retention across both settlement orderings', () => {
  // A pending transaction owned by a mapped cardholder carries BOTH markers.
  // Whichever pass runs first must leave the id behind for the other.
  const bothMarkers = [PENDING, OWNER, CARDHOLDER_TAG];

  it('settle-then-own: reconciliation keeps the id for the pending owner update', () => {
    // Reconciliation removes Pending; owner marker still present
    const remaining = bothMarkers.filter((t) => t.id !== PENDING.id);

    expect(shouldRetainTxIdInNotes(remaining)).toBe(true);
  });

  it('settle-then-own: the later owner sync then strips the id', () => {
    // Owner sync removes the last marker
    const remaining = bothMarkers
      .filter((t) => t.id !== PENDING.id)
      .filter((t) => t.id !== OWNER.id);

    expect(shouldRetainTxIdInNotes(remaining)).toBe(false);
  });

  it('own-then-settle: owner sync keeps the id for the pending reconciliation', () => {
    const remaining = bothMarkers.filter((t) => t.id !== OWNER.id);

    expect(shouldRetainTxIdInNotes(remaining)).toBe(true);
  });

  it('own-then-settle: the later reconciliation then strips the id', () => {
    const remaining = bothMarkers
      .filter((t) => t.id !== OWNER.id)
      .filter((t) => t.id !== PENDING.id);

    expect(shouldRetainTxIdInNotes(remaining)).toBe(false);
  });

  it('leaves the cardholder tag in place under either ordering', () => {
    const afterBoth = bothMarkers
      .filter((t) => t.id !== PENDING.id)
      .filter((t) => t.id !== OWNER.id);

    expect(afterBoth).toEqual([CARDHOLDER_TAG]);
    expect(shouldRetainTxIdInNotes(afterBoth)).toBe(false);
  });
});

describe('retention after a mid-pass failure', () => {
  it('keeps the id when the notes update succeeded but the tag removal did not', () => {
    // Owner sync updates notes, then removes the tag. If the second call throws,
    // the transaction still carries its marker — so the id must still be there
    // for the retry. Recomputing the rule from the UNCHANGED tags proves it.
    const tagsAsStillStored = [OWNER, CARDHOLDER_TAG];

    expect(shouldRetainTxIdInNotes(tagsAsStillStored)).toBe(true);
  });

  it('is idempotent: re-running the same removal yields the same decision', () => {
    const remaining = [PENDING, OWNER].filter((t) => t.id !== OWNER.id);

    expect(shouldRetainTxIdInNotes(remaining)).toBe(true);
    expect(shouldRetainTxIdInNotes(remaining)).toBe(true);
  });

  it('a fully-processed transaction never re-acquires the id', () => {
    // No markers left => nothing should put the id back
    expect(shouldRetainTxIdInNotes([CARDHOLDER_TAG])).toBe(false);
  });
});

describe('selectTagsByIds', () => {
  const allTags = [PENDING, OWNER, USER_TAG];

  it('returns only the tags whose ids were kept', () => {
    expect(selectTagsByIds(allTags, [OWNER.id, USER_TAG.id])).toEqual([OWNER, USER_TAG]);
  });

  it('preserves the original order', () => {
    expect(selectTagsByIds(allTags, [USER_TAG.id, PENDING.id])).toEqual([PENDING, USER_TAG]);
  });

  it('returns an empty array when no ids are kept', () => {
    expect(selectTagsByIds(allTags, [])).toEqual([]);
  });

  it('handles null/undefined inputs', () => {
    expect(selectTagsByIds(null, ['x'])).toEqual([]);
    expect(selectTagsByIds(allTags, null)).toEqual([]);
  });

  it('ignores ids that match no tag', () => {
    expect(selectTagsByIds(allTags, ['does-not-exist'])).toEqual([]);
  });

  it('bridges id-based tag computation to the name-based retention rule', () => {
    // computeSettledTagIds works in ids; the retention rule works in names
    const remainingIds = [OWNER.id, USER_TAG.id];

    expect(shouldRetainTxIdInNotes(selectTagsByIds(allTags, remainingIds))).toBe(true);
  });
});

describe('resolveNotesTransactionId', () => {
  it('writes the pending id for a pending row', () => {
    expect(resolveNotesTransactionId({ isPending: true, pendingId: 'rb-tx:aaaaaaaaaaaaaaaa' }))
      .toBe('rb-tx:aaaaaaaaaaaaaaaa');
  });

  it('falls back to the hash id for a pending row without a pendingId', () => {
    expect(resolveNotesTransactionId({ isPending: true, txHashId: 'rb-tx:bbbbbbbbbbbbbbbb' }))
      .toBe('rb-tx:bbbbbbbbbbbbbbbb');
  });

  it('writes nothing for a settled row with no owner update queued', () => {
    // This is the no-op case for every user who has not enabled owner mapping
    expect(resolveNotesTransactionId({
      isPending: false,
      txHashId: 'rb-tx:cccccccccccccccc',
      ownerSyncPending: false,
    })).toBe('');
  });

  it('writes the hash id for a settled row that still needs an owner', () => {
    // Without this, a transaction that settled before its first upload could
    // never be matched back to its cardholder
    expect(resolveNotesTransactionId({
      isPending: false,
      txHashId: 'rb-tx:dddddddddddddddd',
      ownerSyncPending: true,
    })).toBe('rb-tx:dddddddddddddddd');
  });

  it('returns an empty string when there is no id to write', () => {
    expect(resolveNotesTransactionId({ isPending: true })).toBe('');
    expect(resolveNotesTransactionId({ ownerSyncPending: true })).toBe('');
  });

  it('returns an empty string with no arguments', () => {
    expect(resolveNotesTransactionId()).toBe('');
  });

  it('round-trips with the retention rule for an owned pending row', () => {
    // The id written at CSV time is the same id retention later protects
    const id = resolveNotesTransactionId({
      isPending: true,
      pendingId: 'rb-tx:eeeeeeeeeeeeeeee',
      ownerSyncPending: true,
    });

    expect(id).toBe('rb-tx:eeeeeeeeeeeeeeee');
    expect(shouldRetainTxIdInNotes([OWNER])).toBe(true);
  });
});