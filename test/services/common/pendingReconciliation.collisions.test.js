/**
 * Hash-collision behaviour of the shared pending reconciliation service.
 *
 * `getPendingIdFields` deliberately hashes only fields that are equal for the
 * pending and settled versions of the same charge, so it carries no unique
 * discriminator: two identical charges on the same card on the same day hash to
 * the same value. These tests pin down what happens then.
 *
 * Split out of `pendingReconciliation.test.js` (already ~613 lines) per the
 * `feature.category.test.js` convention.
 *
 * `test/setup.js` wires real Node SHA-256 into `crypto.subtle`, so every
 * collision below is a genuine hash collision built from identical field sets —
 * not a stubbed digest.
 */

import {
  separateAndDeduplicateTransactions,
  generatePendingTransactionId,
} from '../../../src/services/common/pendingReconciliation';
import { collectOwnerAssignments } from '../../../src/services/common/cardholders';
import { resolveNotesTransactionId } from '../../../src/core/markerTags';

// ── Mocks ───────────────────────────────────────────────────

jest.mock('../../../src/core/utils', () => ({
  debugLog: jest.fn(),
  formatDate: jest.fn((d) => d.toISOString().split('T')[0]),
  toTitleCase: jest.fn((name) => name || ''),
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

jest.mock('../../../src/api/monarchHousehold', () => ({
  getHouseholdMembers: jest.fn(() => Promise.resolve({ currentUserId: null, members: [] })),
}));

jest.mock('../../../src/services/common/accountService', () => ({
  __esModule: true,
  default: {
    getAccountData: jest.fn(() => ({})),
    updateAccountInList: jest.fn(() => true),
  },
}));

// ── Fixtures ────────────────────────────────────────────────

const TX_PREFIX = 'mbna-tx';

/**
 * Mirrors MBNA's real hook (`src/integrations/mbna/sinks/monarch/syncHooks.ts`):
 * date, description, amount, card suffix — and deliberately NOT
 * `referenceNumber`. See the frozen-hash-inputs note in that file.
 */
const getPendingIdFields = (tx) => [
  tx.transactionDate || '',
  tx.description || '',
  tx.amount !== undefined && tx.amount !== null ? String(tx.amount) : '',
  tx.endingIn || '',
];

/** Two identical coffees on the same card on the same day — a certain collision. */
const coffeeA = {
  transactionDate: '2024-03-04',
  description: 'TIM HORTONS',
  amount: 2.35,
  endingIn: '4321',
  referenceNumber: 'REF-AAA',
};
const coffeeB = { ...coffeeA, referenceNumber: 'REF-BBB' };

/** A distinct transaction, placed between the colliding pair to pin ordering. */
const lunch = {
  transactionDate: '2024-03-04',
  description: 'SUBWAY',
  amount: 14.99,
  endingIn: '4321',
  referenceNumber: 'REF-LUNCH',
};

const collidingHash = () => generatePendingTransactionId(TX_PREFIX, getPendingIdFields(coffeeA));

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Tests ───────────────────────────────────────────────────

describe('separateAndDeduplicateTransactions — colliding settled transactions', () => {
  it('keeps every settled transaction when two of them share a hash', async () => {
    const result = await separateAndDeduplicateTransactions({
      txIdPrefix: TX_PREFIX,
      getPendingIdFields,
      settled: [coffeeA, lunch, coffeeB],
      pending: [],
    });

    // Length invariant: one output row per input row, no silent drop.
    expect(result.settled).toHaveLength(3);
    expect(result.settled.map((tx) => tx.referenceNumber)).toEqual([
      'REF-AAA', 'REF-LUNCH', 'REF-BBB',
    ]);
  });

  it('preserves oldest-first input order that buildTransactionRefs depends on', async () => {
    const result = await separateAndDeduplicateTransactions({
      txIdPrefix: TX_PREFIX,
      getPendingIdFields,
      settled: [coffeeA, lunch, coffeeB],
      pending: [],
    });

    expect(result.settled[0]).toMatchObject({ referenceNumber: 'REF-AAA', description: 'TIM HORTONS' });
    expect(result.settled[1]).toMatchObject({ referenceNumber: 'REF-LUNCH', description: 'SUBWAY' });
    expect(result.settled[2]).toMatchObject({ referenceNumber: 'REF-BBB', description: 'TIM HORTONS' });
  });

  it('gives both colliding members the same non-empty txHashId', async () => {
    const expectedHash = await collidingHash();

    const result = await separateAndDeduplicateTransactions({
      txIdPrefix: TX_PREFIX,
      getPendingIdFields,
      settled: [coffeeA, lunch, coffeeB],
      pending: [],
    });

    expect(expectedHash).toMatch(/^mbna-tx:[a-f0-9]{16}$/);
    expect(result.settled[0].txHashId).toBe(expectedHash);
    expect(result.settled[2].txHashId).toBe(expectedHash);
    expect(result.settled[1].txHashId).toMatch(/^mbna-tx:[a-f0-9]{16}$/);
    expect(result.settled[1].txHashId).not.toBe(expectedHash);
  });

  it('never attaches generatedId to settled transactions', async () => {
    const result = await separateAndDeduplicateTransactions({
      txIdPrefix: TX_PREFIX,
      getPendingIdFields,
      settled: [coffeeA, coffeeB],
      pending: [],
    });

    expect(result.settled.every((tx) => tx.generatedId === undefined)).toBe(true);
    expect(result.settled.every((tx) => tx.isPending === undefined)).toBe(true);
  });

  it('still exposes one map entry per hash for reconciliation lookups', async () => {
    const expectedHash = await collidingHash();

    const result = await separateAndDeduplicateTransactions({
      txIdPrefix: TX_PREFIX,
      getPendingIdFields,
      settled: [coffeeA, lunch, coffeeB],
      pending: [],
    });

    // The map stays a hash → single transaction lookup; only the returned array
    // is one-per-input.
    expect(result.settledIdMap.size).toBe(2);
    expect(result.settledIdMap.has(expectedHash)).toBe(true);
  });
});

describe('separateAndDeduplicateTransactions — collision counters', () => {
  it('counts one settled collision for a colliding pair', async () => {
    const result = await separateAndDeduplicateTransactions({
      txIdPrefix: TX_PREFIX,
      getPendingIdFields,
      settled: [coffeeA, lunch, coffeeB],
      pending: [],
    });

    expect(result.settledHashCollisions).toBe(1);
    expect(result.pendingHashCollisions).toBe(0);
  });

  it('reports zero collisions when every hash is distinct', async () => {
    const result = await separateAndDeduplicateTransactions({
      txIdPrefix: TX_PREFIX,
      getPendingIdFields,
      settled: [coffeeA, lunch],
      pending: [{ ...lunch, transactionDate: '2024-03-05' }],
    });

    expect(result.settledHashCollisions).toBe(0);
    expect(result.pendingHashCollisions).toBe(0);
    expect(result.duplicatesRemoved).toBe(0);
  });

  it('counts pending collisions separately from duplicatesRemoved', async () => {
    const pendingA = { ...coffeeA, referenceNumber: 'TEMP' };
    const pendingB = { ...coffeeB, referenceNumber: 'TEMP' };

    const result = await separateAndDeduplicateTransactions({
      txIdPrefix: TX_PREFIX,
      getPendingIdFields,
      settled: [],
      pending: [pendingA, pendingB],
    });

    // Pending deliberately still collapses — a second Monarch pending row with
    // the same notes hash cannot be reconciled independently.
    expect(result.pending).toHaveLength(1);
    expect(result.pendingHashCollisions).toBe(1);
    // duplicatesRemoved is a different concept: pending that matched a SETTLED
    // hash. Nothing settled here, so it must stay 0.
    expect(result.duplicatesRemoved).toBe(0);
    expect(result.settledHashCollisions).toBe(0);
  });

  it('keeps duplicatesRemoved counting pending that matched a settled hash', async () => {
    const result = await separateAndDeduplicateTransactions({
      txIdPrefix: TX_PREFIX,
      getPendingIdFields,
      settled: [coffeeA],
      pending: [{ ...coffeeA, referenceNumber: 'TEMP' }],
    });

    expect(result.duplicatesRemoved).toBe(1);
    expect(result.pending).toHaveLength(0);
    expect(result.settled).toHaveLength(1);
    expect(result.settledHashCollisions).toBe(0);
    expect(result.pendingHashCollisions).toBe(0);
  });
});

describe('settle-before-first-upload owner correlation', () => {
  it('lets a settled transaction with no generatedId resolve a notes id', async () => {
    const expectedHash = await generatePendingTransactionId(TX_PREFIX, getPendingIdFields(lunch));

    const result = await separateAndDeduplicateTransactions({
      txIdPrefix: TX_PREFIX,
      getPendingIdFields,
      settled: [lunch],
      pending: [],
    });

    const settledTx = result.settled[0];
    expect(settledTx.generatedId).toBeUndefined();
    expect(settledTx.txHashId).toBe(expectedHash);

    const notesId = resolveNotesTransactionId({
      isPending: false,
      pendingId: settledTx.pendingId ?? null,
      txHashId: settledTx.txHashId,
      ownerSyncPending: true,
    });

    expect(notesId).toBe(expectedHash);
    expect(notesId).not.toBe('');
  });

  it('resolves both colliding members to the same notes id and owner', async () => {
    const expectedHash = await collidingHash();

    const result = await separateAndDeduplicateTransactions({
      txIdPrefix: TX_PREFIX,
      getPendingIdFields,
      settled: [coffeeA, coffeeB],
      pending: [],
    });

    // Both members share an owner by construction: endingIn is a hash input, so
    // identical hashes imply the same card and therefore the same cardholder.
    const annotated = result.settled.map((tx) => ({ ...tx, cardholderOwnerUserId: 'user-7' }));
    const assignments = collectOwnerAssignments(annotated);

    expect(assignments.size).toBe(1);
    expect(assignments.get(expectedHash)).toBe('user-7');
  });
});
