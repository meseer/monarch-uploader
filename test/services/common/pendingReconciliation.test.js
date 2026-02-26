/**
 * Tests for the generic pending reconciliation service
 */

import {
  generatePendingTransactionId,
  extractPendingIdFromNotes,
  cleanPendingIdFromNotes,
  separateAndDeduplicateTransactions,
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

// Get reference to the mocked monarch API
const mockMonarchApi = require('../../../src/api/monarch').default;

// Polyfill crypto.subtle.digest for Node.js test environment
beforeAll(() => {
  if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.subtle) {
    const { webcrypto } = require('crypto');
    globalThis.crypto = webcrypto;
  }
});

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Tests ───────────────────────────────────────────────────

describe('generatePendingTransactionId', () => {
  it('should generate a deterministic ID from field values', async () => {
    const id1 = await generatePendingTransactionId('mbna-tx', ['2024-01-15', 'Amazon', '42.50', '1234']);
    const id2 = await generatePendingTransactionId('mbna-tx', ['2024-01-15', 'Amazon', '42.50', '1234']);

    expect(id1).toBe(id2);
    expect(id1).toMatch(/^mbna-tx:[a-f0-9]{16}$/);
  });

  it('should produce different IDs for different field values', async () => {
    const id1 = await generatePendingTransactionId('mbna-tx', ['2024-01-15', 'Amazon', '42.50', '1234']);
    const id2 = await generatePendingTransactionId('mbna-tx', ['2024-01-16', 'Amazon', '42.50', '1234']);

    expect(id1).not.toBe(id2);
  });

  it('should use the provided prefix', async () => {
    const id = await generatePendingTransactionId('rb-tx', ['2024-01-15', 'Test', '10', 'CAD']);
    expect(id).toMatch(/^rb-tx:[a-f0-9]{16}$/);
  });
});

describe('extractPendingIdFromNotes', () => {
  it('should extract MBNA pending ID from notes', () => {
    const id = extractPendingIdFromNotes('mbna-tx', 'Some notes\nmbna-tx:abc123def4567890');
    expect(id).toBe('mbna-tx:abc123def4567890');
  });

  it('should extract Rogers Bank pending ID from notes', () => {
    const id = extractPendingIdFromNotes('rb-tx', 'rb-tx:1234567890abcdef');
    expect(id).toBe('rb-tx:1234567890abcdef');
  });

  it('should return null if no ID found', () => {
    expect(extractPendingIdFromNotes('mbna-tx', 'Just some notes')).toBeNull();
  });

  it('should return null for null/empty notes', () => {
    expect(extractPendingIdFromNotes('mbna-tx', null)).toBeNull();
    expect(extractPendingIdFromNotes('mbna-tx', '')).toBeNull();
  });

  it('should not match wrong prefix', () => {
    expect(extractPendingIdFromNotes('rb-tx', 'mbna-tx:abc123def4567890')).toBeNull();
  });
});

describe('cleanPendingIdFromNotes', () => {
  it('should remove pending ID from notes', () => {
    const cleaned = cleanPendingIdFromNotes('mbna-tx', 'User note\nmbna-tx:abc123def4567890');
    expect(cleaned).toBe('User note');
  });

  it('should handle notes with only the ID', () => {
    const cleaned = cleanPendingIdFromNotes('mbna-tx', 'mbna-tx:abc123def4567890');
    expect(cleaned).toBe('');
  });

  it('should return empty for null/empty notes', () => {
    expect(cleanPendingIdFromNotes('mbna-tx', null)).toBe('');
    expect(cleanPendingIdFromNotes('mbna-tx', '')).toBe('');
  });

  it('should not remove wrong prefix', () => {
    const cleaned = cleanPendingIdFromNotes('rb-tx', 'mbna-tx:abc123def4567890');
    expect(cleaned).toBe('mbna-tx:abc123def4567890');
  });
});

describe('separateAndDeduplicateTransactions', () => {
  const getPendingIdFields = (tx) => [tx.date, tx.description, String(tx.amount)];

  it('should separate and deduplicate transactions', async () => {
    const settled = [
      { date: '2024-01-15', description: 'Amazon', amount: 42.50 },
    ];
    const pending = [
      { date: '2024-01-15', description: 'Amazon', amount: 42.50 }, // duplicate
      { date: '2024-01-16', description: 'Starbucks', amount: 5.25 },
    ];

    const result = await separateAndDeduplicateTransactions({
      txIdPrefix: 'test-tx',
      getPendingIdFields,
      settled,
      pending,
    });

    expect(result.settled).toHaveLength(1);
    expect(result.pending).toHaveLength(1);
    expect(result.duplicatesRemoved).toBe(1);
    expect(result.pending[0].generatedId).toMatch(/^test-tx:/);
    expect(result.pending[0].isPending).toBe(true);
  });

  it('should keep all pending when no duplicates', async () => {
    const settled = [
      { date: '2024-01-15', description: 'Amazon', amount: 42.50 },
    ];
    const pending = [
      { date: '2024-01-16', description: 'Starbucks', amount: 5.25 },
    ];

    const result = await separateAndDeduplicateTransactions({
      txIdPrefix: 'test-tx',
      getPendingIdFields,
      settled,
      pending,
    });

    expect(result.pending).toHaveLength(1);
    expect(result.duplicatesRemoved).toBe(0);
  });
});

describe('reconcilePendingTransactions', () => {
  const getPendingIdFields = (tx) => [tx.date, tx.desc, String(tx.amt)];
  const getSettledAmount = (tx) => -tx.amt;

  it('should return early if no Pending tag exists', async () => {
    mockMonarchApi.getTagByName.mockResolvedValue(null);

    const result = await reconcilePendingTransactions({
      txIdPrefix: 'test-tx',
      monarchAccountId: 'monarch-1',
      rawPending: [],
      rawSettled: [],
      lookbackDays: 90,
      getPendingIdFields,
      getSettledAmount,
    });

    expect(result.noPendingTag).toBe(true);
    expect(result.settled).toBe(0);
  });

  it('should return early if no pending transactions in Monarch', async () => {
    mockMonarchApi.getTagByName.mockResolvedValue({ id: 'tag-1', name: 'Pending' });
    mockMonarchApi.getTransactionsList.mockResolvedValue({ results: [] });

    const result = await reconcilePendingTransactions({
      txIdPrefix: 'test-tx',
      monarchAccountId: 'monarch-1',
      rawPending: [],
      rawSettled: [],
      lookbackDays: 90,
      getPendingIdFields,
      getSettledAmount,
    });

    expect(result.noPendingTransactions).toBe(true);
  });

  it('should settle transactions that have settled', async () => {
    const settledTx = { date: '2024-01-15', desc: 'Amazon', amt: 42.50 };
    const pendingId = await generatePendingTransactionId('test-tx', getPendingIdFields(settledTx));

    mockMonarchApi.getTagByName.mockResolvedValue({ id: 'tag-1', name: 'Pending' });
    mockMonarchApi.getTransactionsList.mockResolvedValue({
      results: [{
        id: 'mtx-1',
        notes: pendingId,
        amount: -42.50,
        tags: [{ id: 'tag-1', name: 'Pending' }],
        ownedByUser: { id: 'user-1' },
      }],
    });
    mockMonarchApi.updateTransaction.mockResolvedValue({});
    mockMonarchApi.setTransactionTags.mockResolvedValue({});

    const result = await reconcilePendingTransactions({
      txIdPrefix: 'test-tx',
      monarchAccountId: 'monarch-1',
      rawPending: [],
      rawSettled: [settledTx],
      lookbackDays: 90,
      getPendingIdFields,
      getSettledAmount,
    });

    expect(result.settled).toBe(1);
    expect(result.cancelled).toBe(0);
    expect(mockMonarchApi.setTransactionTags).toHaveBeenCalledWith('mtx-1', []);
  });

  it('should preserve other tags when removing Pending tag on settle', async () => {
    const settledTx = { date: '2024-01-15', desc: 'Amazon', amt: 42.50 };
    const pendingId = await generatePendingTransactionId('test-tx', getPendingIdFields(settledTx));

    mockMonarchApi.getTagByName.mockResolvedValue({ id: 'tag-pending', name: 'Pending' });
    mockMonarchApi.getTransactionsList.mockResolvedValue({
      results: [{
        id: 'mtx-1',
        notes: pendingId,
        amount: -42.50,
        tags: [
          { id: 'tag-pending', name: 'Pending' },
          { id: 'tag-groceries', name: 'Groceries' },
          { id: 'tag-shared', name: 'Shared' },
        ],
        ownedByUser: { id: 'user-1' },
      }],
    });
    mockMonarchApi.updateTransaction.mockResolvedValue({});
    mockMonarchApi.setTransactionTags.mockResolvedValue({});

    const result = await reconcilePendingTransactions({
      txIdPrefix: 'test-tx',
      monarchAccountId: 'monarch-1',
      rawPending: [],
      rawSettled: [settledTx],
      lookbackDays: 90,
      getPendingIdFields,
      getSettledAmount,
    });

    expect(result.settled).toBe(1);
    expect(mockMonarchApi.setTransactionTags).toHaveBeenCalledWith(
      'mtx-1',
      ['tag-groceries', 'tag-shared'],
    );
  });

  it('should handle transaction with no tags array when settling', async () => {
    const settledTx = { date: '2024-01-15', desc: 'Amazon', amt: 42.50 };
    const pendingId = await generatePendingTransactionId('test-tx', getPendingIdFields(settledTx));

    mockMonarchApi.getTagByName.mockResolvedValue({ id: 'tag-1', name: 'Pending' });
    mockMonarchApi.getTransactionsList.mockResolvedValue({
      results: [{
        id: 'mtx-1',
        notes: pendingId,
        amount: -42.50,
        tags: undefined,
        ownedByUser: null,
      }],
    });
    mockMonarchApi.updateTransaction.mockResolvedValue({});
    mockMonarchApi.setTransactionTags.mockResolvedValue({});

    const result = await reconcilePendingTransactions({
      txIdPrefix: 'test-tx',
      monarchAccountId: 'monarch-1',
      rawPending: [],
      rawSettled: [settledTx],
      lookbackDays: 90,
      getPendingIdFields,
      getSettledAmount,
    });

    expect(result.settled).toBe(1);
    expect(mockMonarchApi.setTransactionTags).toHaveBeenCalledWith('mtx-1', []);
  });

  it('should delete cancelled transactions', async () => {
    // Transaction not in settled or pending = cancelled
    mockMonarchApi.getTagByName.mockResolvedValue({ id: 'tag-1', name: 'Pending' });
    mockMonarchApi.getTransactionsList.mockResolvedValue({
      results: [{ id: 'mtx-1', notes: 'test-tx:abcdef1234567890', ownedByUser: null }],
    });
    mockMonarchApi.deleteTransaction.mockResolvedValue({});

    const result = await reconcilePendingTransactions({
      txIdPrefix: 'test-tx',
      monarchAccountId: 'monarch-1',
      rawPending: [],
      rawSettled: [],
      lookbackDays: 90,
      getPendingIdFields,
      getSettledAmount,
    });

    expect(result.cancelled).toBe(1);
    expect(mockMonarchApi.deleteTransaction).toHaveBeenCalledWith('mtx-1');
  });

  it('should handle errors gracefully', async () => {
    mockMonarchApi.getTagByName.mockRejectedValue(new Error('Network error'));

    const result = await reconcilePendingTransactions({
      txIdPrefix: 'test-tx',
      monarchAccountId: 'monarch-1',
      rawPending: [],
      rawSettled: [],
      lookbackDays: 90,
      getPendingIdFields,
      getSettledAmount,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Network error');
  });
});

describe('formatReconciliationMessage', () => {
  it('should format "No pending transactions" for noPendingTag', () => {
    expect(formatReconciliationMessage({ noPendingTag: true })).toBe('No pending transactions');
  });

  it('should format "No pending transactions" for noPendingTransactions', () => {
    expect(formatReconciliationMessage({ noPendingTransactions: true })).toBe('No pending transactions');
  });

  it('should format settled count', () => {
    expect(formatReconciliationMessage({ settled: 2, cancelled: 0, failed: 0 })).toBe('2 settled');
  });

  it('should format multiple results', () => {
    expect(formatReconciliationMessage({ settled: 1, cancelled: 2, failed: 0 })).toBe('1 settled, 2 cancelled');
  });

  it('should format all zeros as "Nothing settled or cancelled"', () => {
    expect(formatReconciliationMessage({ settled: 0, cancelled: 0, failed: 0 })).toBe('Nothing settled or cancelled');
  });
});