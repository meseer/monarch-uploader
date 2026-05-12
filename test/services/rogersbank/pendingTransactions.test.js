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
  buildFxNotes,
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

  it('uses foreign.originalAmount for foreign transactions (ignores CAD amount)', async () => {
    // Real API structure: amount is always in CAD, foreign.originalAmount has original currency
    const txPending = {
      date: '2026-05-05',
      amount: { value: '114.81', currency: 'CAD' },
      merchant: { name: 'TADEOS MEXICAN RESTAUR', categoryCode: '5812' },
      cardNumber: '************8584',
      foreign: {
        originalAmount: { value: '84.28', currency: 'USD' },
        conversionRate: { source: '0.0', parsedValue: 0 },
      },
    };
    const txSettled = {
      date: '2026-05-05',
      amount: { value: '139.31', currency: 'CAD' }, // Different CAD amount after final FX rate
      merchant: { name: 'TADEOS MEXICAN RESTAUR', categoryCode: '5812' },
      cardNumber: '************8584',
      foreign: {
        originalAmount: { value: '84.28', currency: 'USD' }, // Same original amount
        conversionRate: 1.362233136,
      },
    };

    // Same original foreign amount should produce same hash despite different CAD amounts
    const id1 = await generatePendingTransactionId(txPending);
    const id2 = await generatePendingTransactionId(txSettled);
    expect(id1).toBe(id2);
  });

  it('generates different IDs for different foreign amounts', async () => {
    const tx1 = {
      date: '2026-05-05',
      amount: { value: '114.81', currency: 'CAD' },
      merchant: { name: 'STORE', categoryCode: '5812' },
      cardNumber: '************8584',
      foreign: { originalAmount: { value: '84.28', currency: 'USD' } },
    };
    const tx2 = {
      date: '2026-05-05',
      amount: { value: '55.00', currency: 'CAD' },
      merchant: { name: 'STORE', categoryCode: '5812' },
      cardNumber: '************8584',
      foreign: { originalAmount: { value: '40.00', currency: 'USD' } },
    };

    const id1 = await generatePendingTransactionId(tx1);
    const id2 = await generatePendingTransactionId(tx2);
    expect(id1).not.toBe(id2);
  });

  it('generates same ID for pending and settled versions of a foreign transaction', async () => {
    // Uses the real sample data from the Rogers Bank API
    const pendingTx = {
      date: '2026-05-05',
      amount: { value: '114.81', currency: 'CAD' },
      activityStatus: 'PENDING',
      merchant: { name: 'TADEOS MEXICAN RESTAUR', categoryCode: '5812' },
      cardNumber: '************8584',
      activityType: 'AUTH',
      foreign: {
        conversionMarkupRate: { source: '0.0', parsedValue: 0 },
        markupRate: 0,
        originalAmount: { value: '84.28', currency: 'USD' },
        appliedConversionRate: { source: '0.0', parsedValue: 0 },
        conversionRate: { source: '0.0', parsedValue: 0 },
      },
    };
    const settledTx = {
      date: '2026-05-04',
      amount: { value: '139.31', currency: 'CAD' },
      activityStatus: 'APPROVED',
      merchant: { name: 'TADEOS MEXICAN RESTAUR', categoryCode: '5812' },
      cardNumber: '************8584',
      activityType: 'TRANS',
      referenceNumber: '72700696125900010079992',
      foreign: {
        conversionMarkupRate: 1.396311516,
        markupRate: 0,
        originalAmount: { value: '99.77', currency: 'USD' },
        exchangeFee: { value: '3.40', currency: 'CAD' },
        appliedConversionRate: { source: '0.0', parsedValue: 0 },
        conversionRate: 1.362233136,
      },
    };

    // NOTE: These are different transactions (different foreign amounts: 84.28 vs 99.77)
    // so they should produce different hashes
    const pendingId = await generatePendingTransactionId(pendingTx);
    const settledId = await generatePendingTransactionId(settledTx);
    expect(pendingId).not.toBe(settledId);

    // But if foreign amount is the same, they should match
    const settledSameAmount = { ...settledTx, foreign: { ...settledTx.foreign, originalAmount: { value: '84.28', currency: 'USD' } } };
    const settledSameId = await generatePendingTransactionId(settledSameAmount);
    // Date differs (05-05 vs 05-04) so still won't match — this is expected for the real data
    // The key point is: same date + same foreign amount = same hash
    const pendingWithSettledDate = { ...pendingTx, date: '2026-05-04' };
    const adjustedPendingId = await generatePendingTransactionId(pendingWithSettledDate);
    expect(adjustedPendingId).toBe(settledSameId);
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

  it('produces same hash for pending (truncated to 21 chars) and settled (23 chars) merchant names', async () => {
    // Rogers Bank truncates pending descriptions to ~21 chars and settled to ~23 chars.
    // The hash should use only the first 20 chars so both versions match.
    const fullMerchantName = 'DILLY DALLY KIDS STORE'; // 22 chars (settled)
    const truncatedMerchantName = 'DILLY DALLY KIDS STO'; // 20 chars (pending, truncated at 21 but we use 20)

    const pendingTx = {
      date: '2026-03-15',
      amount: { value: '45.99', currency: 'CAD' },
      activityStatus: 'PENDING',
      merchant: { name: truncatedMerchantName, categoryCode: '5641' },
      cardNumber: '************8584',
    };
    const settledTx = {
      date: '2026-03-15',
      amount: { value: '45.99', currency: 'CAD' },
      activityStatus: 'APPROVED',
      merchant: { name: fullMerchantName, categoryCode: '5641' },
      cardNumber: '************8584',
    };

    const pendingId = await generatePendingTransactionId(pendingTx);
    const settledId = await generatePendingTransactionId(settledTx);
    expect(pendingId).toBe(settledId);
  });

  it('produces same hash regardless of characters beyond position 20', async () => {
    // Even longer merchant names should match as long as the first 20 chars are identical
    const name23Chars = 'ABCDEFGHIJ1234567890XYZ'; // 23 chars
    const name21Chars = 'ABCDEFGHIJ1234567890X'; // 21 chars
    const name20Chars = 'ABCDEFGHIJ1234567890'; // 20 chars

    const baseTx = {
      date: '2026-04-01',
      amount: { value: '100.00', currency: 'CAD' },
      merchant: { categoryCode: '5411' },
      cardNumber: '************1234',
    };

    const id23 = await generatePendingTransactionId({ ...baseTx, merchant: { ...baseTx.merchant, name: name23Chars } });
    const id21 = await generatePendingTransactionId({ ...baseTx, merchant: { ...baseTx.merchant, name: name21Chars } });
    const id20 = await generatePendingTransactionId({ ...baseTx, merchant: { ...baseTx.merchant, name: name20Chars } });

    expect(id23).toBe(id21);
    expect(id23).toBe(id20);
  });

  it('still differentiates merchants whose first 20 chars differ', async () => {
    // Merchants with different first 20 chars should still produce different hashes
    const baseTx = {
      date: '2026-04-01',
      amount: { value: '50.00', currency: 'CAD' },
      merchant: { categoryCode: '5411' },
      cardNumber: '************1234',
    };

    const id1 = await generatePendingTransactionId({ ...baseTx, merchant: { ...baseTx.merchant, name: 'STORE AAAAAAAAAAAAAA' } });
    const id2 = await generatePendingTransactionId({ ...baseTx, merchant: { ...baseTx.merchant, name: 'STORE BBBBBBBBBBBBBBB' } });

    expect(id1).not.toBe(id2);
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

  it('handles foreign transaction duplicate where CAD amounts differ', async () => {
    // Real API structure: amount is always CAD, foreign.originalAmount has original currency
    // Pending and settled have different CAD amounts but same foreign amount → should match
    const transactions = [
      {
        activityStatus: 'APPROVED',
        date: '2026-05-05',
        amount: { value: '139.31', currency: 'CAD' }, // Final CAD amount after FX
        merchant: { name: 'TADEOS MEXICAN RESTAUR', categoryCode: '5812' },
        cardNumber: '************8584',
        referenceNumber: '72700696125900010079992',
        foreign: {
          originalAmount: { value: '84.28', currency: 'USD' },
          conversionRate: 1.362233136,
          exchangeFee: { value: '3.40', currency: 'CAD' },
        },
      },
      {
        activityStatus: 'PENDING',
        date: '2026-05-05',
        amount: { value: '114.81', currency: 'CAD' }, // Preliminary CAD amount
        merchant: { name: 'TADEOS MEXICAN RESTAUR', categoryCode: '5812' },
        cardNumber: '************8584',
        foreign: {
          originalAmount: { value: '84.28', currency: 'USD' }, // Same original amount
          conversionRate: { source: '0.0', parsedValue: 0 },
        },
      },
    ];

    const result = await separateAndDeduplicateTransactions(transactions);
    expect(result.settled).toHaveLength(1);
    // Foreign original amount is the same, so hashes match → pending removed
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
// buildFxNotes
// ============================================================

describe('buildFxNotes', () => {
  it('returns empty string for non-foreign transactions', () => {
    expect(buildFxNotes({})).toBe('');
    expect(buildFxNotes({ amount: { value: '10', currency: 'CAD' } })).toBe('');
    expect(buildFxNotes(null)).toBe('');
    expect(buildFxNotes(undefined)).toBe('');
  });

  it('returns empty string when foreign.originalAmount.value is missing', () => {
    expect(buildFxNotes({ foreign: {} })).toBe('');
    expect(buildFxNotes({ foreign: { originalAmount: {} } })).toBe('');
  });

  it('builds FX notes with numeric conversion rate', () => {
    const tx = {
      foreign: {
        originalAmount: { value: '99.77', currency: 'USD' },
        conversionRate: 1.362233136,
        exchangeFee: { value: '3.40', currency: 'CAD' },
      },
    };

    const result = buildFxNotes(tx);
    expect(result).toBe('99.77 USD @ 1.362233136\nExchange fee: 3.40 CAD');
  });

  it('builds FX notes with object conversion rate (parsedValue)', () => {
    const tx = {
      foreign: {
        originalAmount: { value: '84.28', currency: 'USD' },
        conversionRate: { source: '0.0', parsedValue: 0 },
      },
    };

    // Zero rate should show N/A
    const result = buildFxNotes(tx);
    expect(result).toBe('84.28 USD @ N/A');
  });

  it('omits exchange fee when not available', () => {
    const tx = {
      foreign: {
        originalAmount: { value: '50.00', currency: 'EUR' },
        conversionRate: 1.5,
      },
    };

    const result = buildFxNotes(tx);
    expect(result).toBe('50.00 EUR @ 1.5');
  });

  it('handles exchange fee with default currency', () => {
    const tx = {
      foreign: {
        originalAmount: { value: '25.00', currency: 'GBP' },
        conversionRate: 1.8,
        exchangeFee: { value: '1.50' }, // No currency specified
      },
    };

    const result = buildFxNotes(tx);
    expect(result).toBe('25.00 GBP @ 1.8\nExchange fee: 1.50 CAD');
  });
});

// ============================================================
// Reconciliation FX enrichment
// ============================================================

describe('reconcileRogersPendingTransactions - FX enrichment', () => {
  const monarchApi = require('../../../src/api/monarch').default;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('adds FX notes when settling a foreign transaction', async () => {
    monarchApi.getTagByName.mockResolvedValue({ id: 'tag-pending', name: 'Pending' });

    // Foreign transaction — pending version had FX placeholder in notes
    const testTx = {
      date: '2026-05-05',
      amount: { value: '114.81', currency: 'CAD' },
      merchant: { name: 'TADEOS MEXICAN RESTAUR', categoryCode: '5812' },
      cardNumber: '************8584',
      foreign: {
        originalAmount: { value: '84.28', currency: 'USD' },
        conversionRate: { source: '0.0', parsedValue: 0 },
      },
    };
    const expectedId = await generatePendingTransactionId(testTx);

    monarchApi.getTransactionsList.mockResolvedValue({
      results: [{
        id: 'monarch-tx-1',
        amount: -114.81,
        date: '2026-05-05',
        notes: `84.28 USD @ pending\n${expectedId}`,
        ownedByUser: { id: 'user-1' },
      }],
    });

    monarchApi.updateTransaction.mockResolvedValue({});
    monarchApi.setTransactionTags.mockResolvedValue({});

    // Settled version has full FX data
    const settledVersion = {
      ...testTx,
      amount: { value: '139.31', currency: 'CAD' },
      activityStatus: 'APPROVED',
      referenceNumber: '72700696125900010079992',
      foreign: {
        originalAmount: { value: '84.28', currency: 'USD' },
        conversionRate: 1.362233136,
        exchangeFee: { value: '3.40', currency: 'CAD' },
      },
    };

    const result = await reconcileRogersPendingTransactions('monarch-123', [settledVersion], 90);

    expect(result.settled).toBe(1);

    // Verify notes were updated with FX info (replacing pending placeholder)
    const updateCall = monarchApi.updateTransaction.mock.calls[0];
    expect(updateCall[0]).toBe('monarch-tx-1');
    expect(updateCall[1].notes).toContain('84.28 USD @ 1.362233136');
    expect(updateCall[1].notes).toContain('Exchange fee: 3.40 CAD');
    // Should NOT contain the pending placeholder or the hash ID
    expect(updateCall[1].notes).not.toContain('@ pending');
    expect(updateCall[1].notes).not.toContain('rb-tx:');
  });

  it('preserves user notes when adding FX info on settlement', async () => {
    monarchApi.getTagByName.mockResolvedValue({ id: 'tag-pending', name: 'Pending' });

    const testTx = {
      date: '2026-05-05',
      amount: { value: '114.81', currency: 'CAD' },
      merchant: { name: 'STORE', categoryCode: '5812' },
      cardNumber: '************8584',
      foreign: {
        originalAmount: { value: '84.28', currency: 'USD' },
        conversionRate: { source: '0.0', parsedValue: 0 },
      },
    };
    const expectedId = await generatePendingTransactionId(testTx);

    // User added "Business dinner" note alongside the system notes
    monarchApi.getTransactionsList.mockResolvedValue({
      results: [{
        id: 'monarch-tx-1',
        amount: -114.81,
        date: '2026-05-05',
        notes: `84.28 USD @ pending\n${expectedId}\nBusiness dinner`,
        ownedByUser: { id: 'user-1' },
      }],
    });

    monarchApi.updateTransaction.mockResolvedValue({});
    monarchApi.setTransactionTags.mockResolvedValue({});

    const settledVersion = {
      ...testTx,
      amount: { value: '120.00', currency: 'CAD' },
      activityStatus: 'APPROVED',
      referenceNumber: '999',
      foreign: {
        originalAmount: { value: '84.28', currency: 'USD' },
        conversionRate: 1.42,
      },
    };

    await reconcileRogersPendingTransactions('monarch-123', [settledVersion], 90);

    const updateCall = monarchApi.updateTransaction.mock.calls[0];
    // FX notes should be present
    expect(updateCall[1].notes).toContain('84.28 USD @ 1.42');
    // User note should be preserved
    expect(updateCall[1].notes).toContain('Business dinner');
    // System notes should be cleaned
    expect(updateCall[1].notes).not.toContain('@ pending');
    expect(updateCall[1].notes).not.toContain('rb-tx:');
  });

  it('does not add FX notes for domestic CAD transactions on settlement', async () => {
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
      referenceNumber: '123',
    };

    await reconcileRogersPendingTransactions('monarch-123', [settledVersion], 90);

    const updateCall = monarchApi.updateTransaction.mock.calls[0];
    // No FX notes for domestic transaction
    expect(updateCall[1].notes).toBe('');
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