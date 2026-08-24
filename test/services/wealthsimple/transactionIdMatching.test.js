/**
 * Tests for Wealthsimple pending → settled transaction ID matching.
 *
 * Wealthsimple appends one extra dash-separated segment to a card activity's
 * externalCanonicalId when the transaction settles, e.g.:
 *   pending: card-activity-00000000527000993851-VI-00-0306231535741989-QIRIAS
 *   settled: card-activity-00000000527000993851-VI-00-0306231535741989-QIRIAS-0tk4pfcsob83
 */

import {
  isSettledVariantOfPendingId,
  isSameTransactionId,
  findMatchingUploadedId,
  isAlreadyUploaded,
  resolveWsTransactionByPendingId,
} from '../../../src/services/wealthsimple/transactionIdMatching';

jest.mock('../../../src/core/utils', () => ({
  debugLog: jest.fn(),
}));

const PENDING_ID = 'card-activity-00000000527000993851-VI-00-0306231535741989-QIRIAS';
const SETTLED_ID = `${PENDING_ID}-0tk4pfcsob83`;

describe('isSettledVariantOfPendingId', () => {
  it('matches the real-world pending → settled ID pair', () => {
    expect(isSettledVariantOfPendingId(PENDING_ID, SETTLED_ID)).toBe(true);
  });

  it('returns false for identical IDs', () => {
    expect(isSettledVariantOfPendingId(PENDING_ID, PENDING_ID)).toBe(false);
  });

  it('returns false when the candidate is not prefixed by the pending ID', () => {
    expect(isSettledVariantOfPendingId(PENDING_ID, 'card-activity-other-ID-abc')).toBe(false);
  });

  it('rejects a suffix containing more than one segment', () => {
    expect(isSettledVariantOfPendingId(PENDING_ID, `${PENDING_ID}-abc-def`)).toBe(false);
  });

  it('rejects an empty suffix', () => {
    expect(isSettledVariantOfPendingId(PENDING_ID, `${PENDING_ID}-`)).toBe(false);
  });

  it('rejects a prefix match without the dash separator', () => {
    expect(isSettledVariantOfPendingId(PENDING_ID, `${PENDING_ID}abc`)).toBe(false);
  });

  it('returns false when the candidate is shorter (reversed arguments)', () => {
    expect(isSettledVariantOfPendingId(SETTLED_ID, PENDING_ID)).toBe(false);
  });

  it('handles null and undefined inputs', () => {
    expect(isSettledVariantOfPendingId(null, SETTLED_ID)).toBe(false);
    expect(isSettledVariantOfPendingId(PENDING_ID, null)).toBe(false);
    expect(isSettledVariantOfPendingId(undefined, undefined)).toBe(false);
    expect(isSettledVariantOfPendingId('', SETTLED_ID)).toBe(false);
  });
});

describe('isSameTransactionId', () => {
  it('matches identical IDs', () => {
    expect(isSameTransactionId(PENDING_ID, PENDING_ID)).toBe(true);
  });

  it('matches pending → settled in both directions', () => {
    expect(isSameTransactionId(PENDING_ID, SETTLED_ID)).toBe(true);
    expect(isSameTransactionId(SETTLED_ID, PENDING_ID)).toBe(true);
  });

  it('does not match unrelated IDs', () => {
    expect(isSameTransactionId(PENDING_ID, 'funding_intent-abc123')).toBe(false);
  });

  it('handles missing inputs', () => {
    expect(isSameTransactionId(null, PENDING_ID)).toBe(false);
    expect(isSameTransactionId(PENDING_ID, undefined)).toBe(false);
  });
});

describe('findMatchingUploadedId', () => {
  it('returns the exact ID when present', () => {
    const uploaded = new Set([PENDING_ID, 'other-id']);
    expect(findMatchingUploadedId(uploaded, PENDING_ID)).toBe(PENDING_ID);
  });

  it('returns the stored pending ID when the settled ID is looked up', () => {
    const uploaded = new Set([PENDING_ID]);
    expect(findMatchingUploadedId(uploaded, SETTLED_ID)).toBe(PENDING_ID);
  });

  it('returns the stored settled ID when the pending ID is looked up', () => {
    const uploaded = new Set([SETTLED_ID]);
    expect(findMatchingUploadedId(uploaded, PENDING_ID)).toBe(SETTLED_ID);
  });

  it('returns null when there is no match', () => {
    const uploaded = new Set(['unrelated-1', 'unrelated-2']);
    expect(findMatchingUploadedId(uploaded, PENDING_ID)).toBeNull();
  });

  it('returns null for an empty or missing set', () => {
    expect(findMatchingUploadedId(new Set(), PENDING_ID)).toBeNull();
    expect(findMatchingUploadedId(null, PENDING_ID)).toBeNull();
  });

  it('returns null for a missing transaction ID', () => {
    expect(findMatchingUploadedId(new Set([PENDING_ID]), null)).toBeNull();
    expect(findMatchingUploadedId(new Set([PENDING_ID]), '')).toBeNull();
  });
});

describe('isAlreadyUploaded', () => {
  it('treats a settled variant of a stored pending ID as already uploaded', () => {
    expect(isAlreadyUploaded(new Set([PENDING_ID]), SETTLED_ID)).toBe(true);
  });

  it('treats an unrelated transaction as not uploaded', () => {
    expect(isAlreadyUploaded(new Set([PENDING_ID]), 'funding_intent-xyz')).toBe(false);
  });

  it('handles an empty dedup store', () => {
    expect(isAlreadyUploaded(new Set(), SETTLED_ID)).toBe(false);
  });
});

describe('resolveWsTransactionByPendingId', () => {
  it('resolves via exact match', () => {
    const tx = { externalCanonicalId: PENDING_ID, status: 'authorized' };
    const map = new Map([[PENDING_ID, tx]]);

    const result = resolveWsTransactionByPendingId(map, PENDING_ID);

    expect(result).toEqual({ transactionId: PENDING_ID, transaction: tx });
  });

  it('resolves the settled variant when only the suffixed ID is present', () => {
    const settledTx = { externalCanonicalId: SETTLED_ID, status: 'settled' };
    const map = new Map([[SETTLED_ID, settledTx]]);

    const result = resolveWsTransactionByPendingId(map, PENDING_ID);

    expect(result).toEqual({ transactionId: SETTLED_ID, transaction: settledTx });
  });

  it('prefers the exact match over a settled variant', () => {
    const pendingTx = { externalCanonicalId: PENDING_ID, status: 'authorized' };
    const settledTx = { externalCanonicalId: SETTLED_ID, status: 'settled' };
    const map = new Map([
      [SETTLED_ID, settledTx],
      [PENDING_ID, pendingTx],
    ]);

    const result = resolveWsTransactionByPendingId(map, PENDING_ID);

    expect(result.transactionId).toBe(PENDING_ID);
  });

  it('returns null when nothing matches', () => {
    const map = new Map([['unrelated-id', { externalCanonicalId: 'unrelated-id' }]]);

    expect(resolveWsTransactionByPendingId(map, PENDING_ID)).toBeNull();
  });

  it('returns null for an empty map or missing pending ID', () => {
    expect(resolveWsTransactionByPendingId(new Map(), PENDING_ID)).toBeNull();
    expect(resolveWsTransactionByPendingId(new Map([[PENDING_ID, {}]]), null)).toBeNull();
  });

  it('returns the first candidate when multiple settled variants are ambiguous', () => {
    const first = { externalCanonicalId: `${PENDING_ID}-aaa` };
    const second = { externalCanonicalId: `${PENDING_ID}-bbb` };
    const map = new Map([
      [`${PENDING_ID}-aaa`, first],
      [`${PENDING_ID}-bbb`, second],
    ]);

    const result = resolveWsTransactionByPendingId(map, PENDING_ID);

    expect(result.transaction).toBe(first);
  });

  it('does not match a candidate with a multi-segment suffix', () => {
    const map = new Map([[`${PENDING_ID}-aaa-bbb`, { externalCanonicalId: `${PENDING_ID}-aaa-bbb` }]]);

    expect(resolveWsTransactionByPendingId(map, PENDING_ID)).toBeNull();
  });
});