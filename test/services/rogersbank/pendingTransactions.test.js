/**
 * Tests for Rogers Bank Pending Transactions
 * Tests ID generation, deduplication, and reconciliation logic
 */

import {
  getLocalDateFromActivityId,
  generatePendingTransactionId,
  isPendingTransaction,
  isSettledTransaction,
  separateAndDeduplicateTransactions,
  reconcileRogersPendingTransactions,
  formatReconciliationMessage,
  formatPendingIdForNotes,
  extractPendingIdFromNotes,
} from '../../../src/services/rogersbank/pendingTransactions';

// Mock dependencies
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

// Use Node.js crypto for real SHA-256 in the Web Crypto API mock
const nodeCrypto = require('crypto');

const mockDigest = jest.fn();
Object.defineProperty(global, 'crypto', {
  value: {
    subtle: {
      digest: mockDigest,
    },
  },
});

// Mock TextEncoder
global.TextEncoder = class {
  encode(str) {
    return new Uint8Array(Buffer.from(str, 'utf-8'));
  }
};

// Setup mock digest using real SHA-256 via Node.js crypto
beforeEach(() => {
  mockDigest.mockImplementation((_algo, data) => {
    const hash = nodeCrypto.createHash('sha256').update(Buffer.from(data)).digest();
    return Promise.resolve(hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength));
  });
});

afterEach(() => {
  jest.clearAllMocks();
});

// ============================================================
// Local date extraction from activityId
// ============================================================

describe('getLocalDateFromActivityId', () => {
  // Helper to BASE64-encode a string (Node.js compatible)
  const encode = (str) => Buffer.from(str).toString('base64');

  it('extracts local date from a valid activityId', () => {
    // "DT|2026-02-19T15:49:53-05:00"  3:49 PM EST = 12:49 PM PST, still Feb 19
    const activityId = encode('DT|2026-02-19T15:49:53-05:00');
    const result = getLocalDateFromActivityId(activityId);
    expect(result).toBe('2026-02-19');
  });

  it('converts cross-midnight EST transaction to correct local date', () => {
    // "DT|2026-02-20T01:30:00-05:00"  1:30 AM EST Feb 20 = 10:30 PM PST Feb 19
    const activityId = encode('DT|2026-02-20T01:30:00-05:00');
    const result = getLocalDateFromActivityId(activityId);
    // In PST (UTC-8), this is Feb 19 at 22:30
    expect(result).toBe('2026-02-19');
  });

  it('handles EDT offset correctly', () => {
    // "DT|2026-07-15T23:30:00-04:00"  11:30 PM EDT Jul 15 = 8:30 PM PDT Jul 15
    const activityId = encode('DT|2026-07-15T23:30:00-04:00');
    const result = getLocalDateFromActivityId(activityId);
    expect(result).toBe('2026-07-15');
  });

  it('handles EDT cross-midnight to different local date', () => {
    // "DT|2026-07-16T02:00:00-04:00"  2:00 AM EDT Jul 16 = 11:00 PM PDT Jul 15
    const activityId = encode('DT|2026-07-16T02:00:00-04:00');
    const result = getLocalDateFromActivityId(activityId);
    // In PDT (UTC-7), this is Jul 15 at 23:00
    expect(result).toBe('2026-07-15');
  });

  it('returns null for null/undefined/empty input', () => {
    expect(getLocalDateFromActivityId(null)).toBeNull();
    expect(getLocalDateFromActivityId(undefined)).toBeNull();
    expect(getLocalDateFromActivityId('')).toBeNull();
  });

  it('returns null for invalid base64', () => {
    expect(getLocalDateFromActivityId('not-valid-base64!!!')).toBeNull();
  });

  it('returns null when decoded string has no valid date', () => {
    const activityId = encode('DT|not-a-date');
    expect(getLocalDateFromActivityId(activityId)).toBeNull();
  });

  it('handles decoded string without DT| prefix', () => {
    // If the decoded string is just an ISO timestamp without prefix, it should still work
    const activityId = encode('2026-02-19T15:49:53-05:00');
    const result = getLocalDateFromActivityId(activityId);
    expect(result).toBe('2026-02-19');
  });
});

// ============================================================
// Transaction status helpers
// ============================================================

describe('isPendingTransaction', () => {
  it('returns true for PENDING status', () => {
    expect(isPendingTransaction({ activityStatus: 'PENDING' })).toBe(true);
  });

  it('returns false for APPROVED status', () => {
    expect(isPendingTransaction({ activityStatus: 'APPROVED' })).toBe(false);
  });

  it('returns false for other statuses', () => {
    expect(isPendingTransaction({ activityStatus: 'DECLINED' })).toBe(false);
    expect(isPendingTransaction({})).toBe(false);
  });
});

describe('isSettledTransaction', () => {
  it('returns true for APPROVED status', () => {
    expect(isSettledTransaction({ activityStatus: 'APPROVED' })).toBe(true);
  });

  it('returns false for PENDING status', () => {
    expect(isSettledTransaction({ activityStatus: 'PENDING' })).toBe(false);
  });
});

// ============================================================
// ID generation
// ============================================================

describe('generatePendingTransactionId', () => {
  it('generates an ID with rb-tx: prefix', async () => {
    const tx = {
      date: '2026-02-13',
      amount: { value: '5.50', currency: 'CAD' },
      merchant: { name: 'STORE', categoryCode: '7523' },
      cardNumber: '************8584',
    };

    const id = await generatePendingTransactionId(tx);
    expect(id).toMatch(/^rb-tx:[a-f0-9]{16}$/);
  });

  it('generates the same ID for identical transactions', async () => {
    const tx1 = {
      date: '2026-02-13',
      amount: { value: '5.50', currency: 'CAD' },
      merchant: { name: 'STORE', categoryCode: '7523' },
      cardNumber: '************8584',
    };
    const tx2 = { ...tx1 };

    const id1 = await generatePendingTransactionId(tx1);
    const id2 = await generatePendingTransactionId(tx2);
    expect(id1).toBe(id2);
  });

  it('generates different IDs for different transactions', async () => {
    const tx1 = {
      date: '2026-02-13',
      amount: { value: '5.50', currency: 'CAD' },
      merchant: { name: 'STORE_A', categoryCode: '7523' },
      cardNumber: '************8584',
    };
    const tx2 = {
      date: '2026-02-13',
      amount: { value: '22.22', currency: 'CAD' },
      merchant: { name: 'STORE_B', categoryCode: '7512' },
      cardNumber: '************8584',
    };

    const id1 = await generatePendingTransactionId(tx1);
    const id2 = await generatePendingTransactionId(tx2);
    expect(id1).not.toBe(id2);
  });

  it('includes amount.value for CAD transactions', async () => {
    const txWithAmount = {
      date: '2026-02-13',
      amount: { value: '5.50', currency: 'CAD' },
      merchant: { name: 'STORE', categoryCode: '7523' },
      cardNumber: '************8584',
    };
    const txDifferentAmount = {
      date: '2026-02-13',
      amount: { value: '10.00', currency: 'CAD' },
      merchant: { name: 'STORE', categoryCode: '7523' },
      cardNumber: '************8584',
    };

    const id1 = await generatePendingTransactionId(txWithAmount);
    const id2 = await generatePendingTransactionId(txDifferentAmount);
    expect(id1).not.toBe(id2);
  });

  it('excludes amount.value for non-CAD transactions', async () => {
    const txUsd5 = {
      date: '2026-02-13',
      amount: { value: '5.50', currency: 'USD' },
      merchant: { name: 'STORE', categoryCode: '7523' },
      cardNumber: '************8584',
    };
    const txUsd10 = {
      date: '2026-02-13',
      amount: { value: '10.00', currency: 'USD' },
      merchant: { name: 'STORE', categoryCode: '7523' },
      cardNumber: '************8584',
    };

    // Different amounts but same currency (non-CAD) should produce same ID
    const id1 = await generatePendingTransactionId(txUsd5);
    const id2 = await generatePendingTransactionId(txUsd10);
    expect(id1).toBe(id2);
  });

  it('generates same ID for pending and settled versions of the same CAD transaction', async () => {
    const pendingTx = {
      date: '2026-02-13',
      amount: { value: '5.50', currency: 'CAD' },
      activityStatus: 'PENDING',
      merchant: { name: 'IMPARK00011928U', categoryCode: '7523' },
      cardNumber: '************8584',
      activityType: 'AUTH',
    };
    const settledTx = {
      date: '2026-02-13',
      amount: { value: '5.50', currency: 'CAD' },
      activityStatus: 'APPROVED',
      merchant: { name: 'IMPARK00011928U', categoryCode: '7523' },
      cardNumber: '************8584',
      activityType: 'TRANS',
      referenceNumber: '12305016044000800255086',
    };

    const pendingId = await generatePendingTransactionId(pendingTx);
    const settledId = await generatePendingTransactionId(settledTx);
    expect(pendingId).toBe(settledId);
  });

  it('handles missing fields gracefully', async () => {
    const tx = { date: '2026-02-13' };
    const id = await generatePendingTransactionId(tx);
    expect(id).toMatch(/^rb-tx:[a-f0-9]{16}$/);
  });
});

// ============================================================
// Notes formatting and extraction
// ============================================================

describe('formatPendingIdForNotes', () => {
  it('returns the pending ID as-is', () => {
    expect(formatPendingIdForNotes('rb-tx:abc123def4567890')).toBe('rb-tx:abc123def4567890');
  });

  it('returns empty string for null/undefined', () => {
    expect(formatPendingIdForNotes(null)).toBe('');
    expect(formatPendingIdForNotes(undefined)).toBe('');
    expect(formatPendingIdForNotes('')).toBe('');
  });
});

describe('extractPendingIdFromNotes', () => {
  it('extracts ID from simple notes', () => {
    expect(extractPendingIdFromNotes('rb-tx:abc123def4567890')).toBe('rb-tx:abc123def4567890');
  });

  it('extracts ID from notes with other content', () => {
    expect(extractPendingIdFromNotes('Some user note\nrb-tx:abc123def4567890')).toBe('rb-tx:abc123def4567890');
  });

  it('extracts ID from notes with prefix text', () => {
    expect(extractPendingIdFromNotes('AUTH / 12345\nrb-tx:abc123def4567890')).toBe('rb-tx:abc123def4567890');
  });

  it('returns null for notes without ID', () => {
    expect(extractPendingIdFromNotes('Just some notes')).toBeNull();
    expect(extractPendingIdFromNotes('')).toBeNull();
    expect(extractPendingIdFromNotes(null)).toBeNull();
    expect(extractPendingIdFromNotes(undefined)).toBeNull();
  });

  it('returns null for non-string input', () => {
    expect(extractPendingIdFromNotes(123)).toBeNull();
    expect(extractPendingIdFromNotes({})).toBeNull();
  });

  it('round-trips with formatPendingIdForNotes', () => {
    const id = 'rb-tx:abc123def4567890';
    const formatted = formatPendingIdForNotes(id);
    const extracted = extractPendingIdFromNotes(formatted);
    expect(extracted).toBe(id);
  });
});

// ============================================================
// Transaction separation and deduplication
// ============================================================

describe('separateAndDeduplicateTransactions', () => {
  it('separates pending and settled transactions', async () => {
    const transactions = [
      { activityStatus: 'APPROVED', date: '2026-02-13', amount: { value: '10', currency: 'CAD' }, merchant: { name: 'A', categoryCode: '1' }, cardNumber: '1234' },
      { activityStatus: 'PENDING', date: '2026-02-14', amount: { value: '20', currency: 'CAD' }, merchant: { name: 'B', categoryCode: '2' }, cardNumber: '1234' },
    ];

    const result = await separateAndDeduplicateTransactions(transactions);
    expect(result.settled).toHaveLength(1);
    expect(result.pending).toHaveLength(1);
    expect(result.duplicatesRemoved).toBe(0);
  });

  it('removes pending duplicates when settled version exists', async () => {
    // Same transaction appearing as both PENDING and APPROVED
    const transactions = [
      {
        activityStatus: 'APPROVED',
        date: '2026-02-13',
        amount: { value: '5.50', currency: 'CAD' },
        merchant: { name: 'STORE', categoryCode: '7523' },
        cardNumber: '************8584',
        referenceNumber: '123',
      },
      {
        activityStatus: 'PENDING',
        date: '2026-02-13',
        amount: { value: '5.50', currency: 'CAD' },
        merchant: { name: 'STORE', categoryCode: '7523' },
        cardNumber: '************8584',
      },
    ];

    const result = await separateAndDeduplicateTransactions(transactions);
    expect(result.settled).toHaveLength(1);
    expect(result.pending).toHaveLength(0);
    expect(result.duplicatesRemoved).toBe(1);
  });

  it('assigns generatedId to pending transactions', async () => {
    const transactions = [
      {
        activityStatus: 'PENDING',
        date: '2026-02-14',
        amount: { value: '20', currency: 'CAD' },
        merchant: { name: 'B', categoryCode: '2' },
        cardNumber: '1234',
      },
    ];

    const result = await separateAndDeduplicateTransactions(transactions);
    expect(result.pending).toHaveLength(1);
    expect(result.pending[0].generatedId).toMatch(/^rb-tx:[a-f0-9]{16}$/);
  });

  it('ignores transactions with other statuses', async () => {
    const transactions = [
      { activityStatus: 'DECLINED', date: '2026-02-13', amount: { value: '10', currency: 'CAD' }, merchant: { name: 'A', categoryCode: '1' }, cardNumber: '1234' },
    ];

    const result = await separateAndDeduplicateTransactions(transactions);
    expect(result.settled).toHaveLength(0);
    expect(result.pending).toHaveLength(0);
  });

  it('handles empty transaction list', async () => {
    const result = await separateAndDeduplicateTransactions([]);
    expect(result.settled).toHaveLength(0);
    expect(result.pending).toHaveLength(0);
    expect(result.duplicatesRemoved).toBe(0);
  });

  it('assigns generatedId to settled transactions without referenceNumber', async () => {
    const transactions = [
      {
        activityStatus: 'APPROVED',
        date: '2026-03-11',
        amount: { value: '57.65', currency: 'CAD' },
        merchant: { name: 'BALANCE PROTECTION', categoryCode: '6012' },
        cardNumber: '************8584',
        // No referenceNumber
      },
    ];

    const result = await separateAndDeduplicateTransactions(transactions);
    expect(result.settled).toHaveLength(1);
    expect(result.settled[0].generatedId).toMatch(/^rb-tx:[a-f0-9]{16}$/);
  });

  it('does not assign generatedId to settled transactions with referenceNumber', async () => {
    const transactions = [
      {
        activityStatus: 'APPROVED',
        date: '2026-03-11',
        amount: { value: '25.00', currency: 'CAD' },
        merchant: { name: 'STORE', categoryCode: '5411' },
        cardNumber: '************8584',
        referenceNumber: '12345678901234567890123',
      },
    ];

    const result = await separateAndDeduplicateTransactions(transactions);
    expect(result.settled).toHaveLength(1);
    expect(result.settled[0].generatedId).toBeUndefined();
  });

  it('converts pending transaction date from activityId before hashing', async () => {
    // Pending transaction at 1:30 AM EST Feb 20 = 10:30 PM PST Feb 19
    // Settled version has local date Feb 19
    const activityId = Buffer.from('DT|2026-02-20T01:30:00-05:00').toString('base64');

    const pendingTx = {
      activityStatus: 'PENDING',
      activityId,
      date: '2026-02-20', // EST date (wrong for PST user)
      amount: { value: '5.50', currency: 'CAD' },
      merchant: { name: 'STORE', categoryCode: '7523' },
      cardNumber: '************8584',
    };
    const settledTx = {
      activityStatus: 'APPROVED',
      date: '2026-02-19', // Local date (correct)
      amount: { value: '5.50', currency: 'CAD' },
      merchant: { name: 'STORE', categoryCode: '7523' },
      cardNumber: '************8584',
      referenceNumber: '999',
    };

    const result = await separateAndDeduplicateTransactions([settledTx, pendingTx]);

    // Pending should be removed because after date conversion, hashes match
    expect(result.settled).toHaveLength(1);
    expect(result.pending).toHaveLength(0);
    expect(result.duplicatesRemoved).toBe(1);
  });

  it('updates pending transaction date in output after activityId conversion', async () => {
    const activityId = Buffer.from('DT|2026-02-20T01:30:00-05:00').toString('base64');

    const pendingTx = {
      activityStatus: 'PENDING',
      activityId,
      date: '2026-02-20', // EST date
      amount: { value: '25.00', currency: 'CAD' },
      merchant: { name: 'UNIQUE_STORE', categoryCode: '5411' },
      cardNumber: '************1111',
    };

    const result = await separateAndDeduplicateTransactions([pendingTx]);

    // Pending transaction should have its date converted to local
    expect(result.pending).toHaveLength(1);
    expect(result.pending[0].date).toBe('2026-02-19');
  });

  it('preserves pending transaction date when activityId is absent', async () => {
    const pendingTx = {
      activityStatus: 'PENDING',
      // No activityId
      date: '2026-02-20',
      amount: { value: '25.00', currency: 'CAD' },
      merchant: { name: 'SOME_STORE', categoryCode: '5411' },
      cardNumber: '************2222',
    };

    const result = await separateAndDeduplicateTransactions([pendingTx]);

    // Date should remain unchanged when activityId is not available
    expect(result.pending).toHaveLength(1);
    expect(result.pending[0].date).toBe('2026-02-20');
  });

  it('handles non-CAD duplicate where amounts differ', async () => {
    // Foreign currency: pending and settled have different amounts but should still match
    const transactions = [
      {
        activityStatus: 'APPROVED',
        date: '2026-02-13',
        amount: { value: '7.25', currency: 'USD' },
        merchant: { name: 'US_STORE', categoryCode: '5411' },
        cardNumber: '************8584',
        referenceNumber: '456',
      },
      {
        activityStatus: 'PENDING',
        date: '2026-02-13',
        amount: { value: '5.50', currency: 'USD' },
        merchant: { name: 'US_STORE', categoryCode: '5411' },
        cardNumber: '************8584',
      },
    ];

    const result = await separateAndDeduplicateTransactions(transactions);
    expect(result.settled).toHaveLength(1);
    // For non-CAD, amount.value is excluded from hash, so they should match
    expect(result.pending).toHaveLength(0);
    expect(result.duplicatesRemoved).toBe(1);
  });
});

// ============================================================
// Reconciliation
// ============================================================

describe('reconcileRogersPendingTransactions', () => {
  const monarchApi = require('../../../src/api/monarch').default;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns early when no Pending tag exists', async () => {
    monarchApi.getTagByName.mockResolvedValue(null);

    const result = await reconcileRogersPendingTransactions('monarch-123', [], 90);

    expect(result.noPendingTag).toBe(true);
    expect(result.settled).toBe(0);
    expect(result.cancelled).toBe(0);
  });

  it('returns early when no pending transactions in Monarch', async () => {
    monarchApi.getTagByName.mockResolvedValue({ id: 'tag-pending', name: 'Pending' });
    monarchApi.getTransactionsList.mockResolvedValue({ results: [] });

    const result = await reconcileRogersPendingTransactions('monarch-123', [], 90);

    expect(result.noPendingTransactions).toBe(true);
  });

  it('collects hash ID as settledRefId when settled transaction has no referenceNumber', async () => {
    monarchApi.getTagByName.mockResolvedValue({ id: 'tag-pending', name: 'Pending' });

    // Transaction without referenceNumber
    const testTx = {
      date: '2026-03-11',
      amount: { value: '57.65', currency: 'CAD' },
      merchant: { name: 'BALANCE PROTECTION', categoryCode: '6012' },
      cardNumber: '************8584',
    };
    const expectedId = await generatePendingTransactionId(testTx);

    monarchApi.getTransactionsList.mockResolvedValue({
      results: [{
        id: 'monarch-tx-1',
        amount: -57.65,
        date: '2026-03-11',
        notes: expectedId,
        ownedByUser: { id: 'user-1' },
      }],
    });

    monarchApi.updateTransaction.mockResolvedValue({});
    monarchApi.setTransactionTags.mockResolvedValue({});

    const settledVersion = {
      ...testTx,
      activityStatus: 'APPROVED',
      // No referenceNumber
    };

    const result = await reconcileRogersPendingTransactions('monarch-123', [settledVersion], 90);

    expect(result.settled).toBe(1);
    // Should save the hash ID as the dedup key since there's no referenceNumber
    expect(result.settledRefIds).toContain(expectedId);
  });

  it('collects referenceNumber as settledRefId when present', async () => {
    monarchApi.getTagByName.mockResolvedValue({ id: 'tag-pending', name: 'Pending' });

    const testTx = {
      date: '2026-02-13',
      amount: { value: '5.50', currency: 'CAD' },
      merchant: { name: 'STORE', categoryCode: '7523' },
      cardNumber: '************8584',
    };
    const expectedId = await generatePendingTransactionId(testTx);

    monarchApi.getTransactionsList.mockResolvedValue({
      results: [{
        id: 'monarch-tx-1',
        amount: -5.50,
        date: '2026-02-13',
        notes: expectedId,
        ownedByUser: { id: 'user-1' },
      }],
    });

    monarchApi.updateTransaction.mockResolvedValue({});
    monarchApi.setTransactionTags.mockResolvedValue({});

    const settledVersion = {
      ...testTx,
      activityStatus: 'APPROVED',
      referenceNumber: '123456',
    };

    const result = await reconcileRogersPendingTransactions('monarch-123', [settledVersion], 90);

    expect(result.settled).toBe(1);
    // Should save the referenceNumber (not the hash) as the dedup key
    expect(result.settledRefIds).toContain('123456');
    expect(result.settledRefIds).not.toContain(expectedId);
  });

  it('settles transactions that are now approved', async () => {
    monarchApi.getTagByName.mockResolvedValue({ id: 'tag-pending', name: 'Pending' });

    // Generate the hash ID for the test transaction
    const testTx = {
      date: '2026-02-13',
      amount: { value: '5.50', currency: 'CAD' },
      merchant: { name: 'STORE', categoryCode: '7523' },
      cardNumber: '************8584',
    };
    const expectedId = await generatePendingTransactionId(testTx);

    monarchApi.getTransactionsList.mockResolvedValue({
      results: [{
        id: 'monarch-tx-1',
        amount: -5.50,
        date: '2026-02-13',
        notes: expectedId,
        ownedByUser: { id: 'user-1' },
      }],
    });

    monarchApi.updateTransaction.mockResolvedValue({});
    monarchApi.setTransactionTags.mockResolvedValue({});

    const settledVersion = {
      ...testTx,
      activityStatus: 'APPROVED',
      referenceNumber: '123',
    };

    const result = await reconcileRogersPendingTransactions('monarch-123', [settledVersion], 90);

    expect(result.settled).toBe(1);
    expect(result.cancelled).toBe(0);
    expect(monarchApi.setTransactionTags).toHaveBeenCalledWith('monarch-tx-1', []);
  });

  it('deletes cancelled transactions not found in Rogers data', async () => {
    monarchApi.getTagByName.mockResolvedValue({ id: 'tag-pending', name: 'Pending' });
    monarchApi.getTransactionsList.mockResolvedValue({
      results: [{
        id: 'monarch-tx-1',
        amount: -5.50,
        date: '2026-02-13',
        notes: 'rb-tx:0000111122223333',
        ownedByUser: { id: 'user-1' },
      }],
    });

    monarchApi.deleteTransaction.mockResolvedValue({});

    // Empty Rogers transactions = cancelled
    const result = await reconcileRogersPendingTransactions('monarch-123', [], 90);

    expect(result.cancelled).toBe(1);
    expect(monarchApi.deleteTransaction).toHaveBeenCalledWith('monarch-tx-1');
  });

  it('skips transactions without extractable ID in notes', async () => {
    monarchApi.getTagByName.mockResolvedValue({ id: 'tag-pending', name: 'Pending' });
    monarchApi.getTransactionsList.mockResolvedValue({
      results: [{
        id: 'monarch-tx-1',
        amount: -5.50,
        date: '2026-02-13',
        notes: 'Some random notes without an ID',
        ownedByUser: { id: 'user-1' },
      }],
    });

    const result = await reconcileRogersPendingTransactions('monarch-123', [], 90);

    expect(result.settled).toBe(0);
    expect(result.cancelled).toBe(0);
    expect(monarchApi.deleteTransaction).not.toHaveBeenCalled();
  });

  it('handles errors gracefully for individual transactions', async () => {
    monarchApi.getTagByName.mockResolvedValue({ id: 'tag-pending', name: 'Pending' });
    monarchApi.getTransactionsList.mockResolvedValue({
      results: [{
        id: 'monarch-tx-1',
        amount: -5.50,
        date: '2026-02-13',
        notes: 'rb-tx:0000111122223333',
        ownedByUser: { id: 'user-1' },
      }],
    });

    monarchApi.deleteTransaction.mockRejectedValue(new Error('API error'));

    const result = await reconcileRogersPendingTransactions('monarch-123', [], 90);

    expect(result.failed).toBe(1);
    expect(result.success).toBe(true); // Overall success despite individual failure
  });
});

// ============================================================
// Format reconciliation message
// ============================================================

describe('formatReconciliationMessage', () => {
  it('shows no pending transactions when tag not found', () => {
    expect(formatReconciliationMessage({ noPendingTag: true })).toBe('No pending transactions');
  });

  it('shows no pending transactions when none found', () => {
    expect(formatReconciliationMessage({ noPendingTransactions: true })).toBe('No pending transactions');
  });

  it('shows settled count', () => {
    expect(formatReconciliationMessage({ settled: 2, cancelled: 0, failed: 0 })).toBe('2 settled');
  });

  it('shows cancelled count', () => {
    expect(formatReconciliationMessage({ settled: 0, cancelled: 1, failed: 0 })).toBe('1 cancelled');
  });

  it('shows combined message', () => {
    expect(formatReconciliationMessage({ settled: 2, cancelled: 1, failed: 0 })).toBe('2 settled, 1 cancelled');
  });

  it('shows failed count', () => {
    expect(formatReconciliationMessage({ settled: 0, cancelled: 0, failed: 1 })).toBe('1 failed');
  });

  it('shows no pending when all counts are zero', () => {
    expect(formatReconciliationMessage({ settled: 0, cancelled: 0, failed: 0 })).toBe('Nothing settled or cancelled');
  });
});