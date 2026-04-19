/**
 * Tests for Canada Life Pending Transaction Reconciliation
 */

import {
  reconcileCanadaLifePendingTransactions,
  reconcileCanadaLifeFetchedPending,
  formatReconciliationMessage,
} from '../../../src/services/canadalife/pendingReconciliation';

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
    deleteTransaction: jest.fn(),
  },
}));

// Mock generateActivityHash to return deterministic values
jest.mock('../../../src/services/canadalife/transactions', () => ({
  generateActivityHash: jest.fn(async (activity) => {
    // Return a predictable hash based on the activity's Activity field
    return `cl-tx:${(activity.Activity || 'unknown').slice(0, 16).padEnd(16, '0').toLowerCase().replace(/[^a-f0-9]/g, '0')}`;
  }),
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
  writable: true,
});

global.TextEncoder = class {
  encode(str) {
    return new Uint8Array(Buffer.from(str, 'utf-8'));
  }
};

beforeEach(() => {
  mockDigest.mockImplementation((_algo, data) => {
    const hash = nodeCrypto.createHash('sha256').update(Buffer.from(data)).digest();
    return Promise.resolve(hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength));
  });
});

afterEach(() => {
  jest.clearAllMocks();
});

// Helper to get mocked monarch API
const getMonarchApi = () => require('../../../src/api/monarch').default;

// Helper to build a mock Monarch pending transaction
const makePendingMonarchTx = (id, notes, overrides = {}) => ({
  id,
  amount: 100,
  date: '2024-01-15',
  notes,
  tags: [{ id: 'tag-pending', name: 'Pending' }],
  ownedByUser: { id: 'user-1' },
  ...overrides,
});

// ============================================================
// reconcileCanadaLifePendingTransactions
// ============================================================

describe('reconcileCanadaLifePendingTransactions', () => {
  describe('early exit conditions', () => {
    test('returns noPendingTag: true when "Pending" tag does not exist in Monarch', async () => {
      const monarchApi = getMonarchApi();
      monarchApi.getTagByName.mockResolvedValue(null);

      const result = await reconcileCanadaLifePendingTransactions('monarch-acct-1', [], 90);

      expect(result.noPendingTag).toBe(true);
      expect(result.success).toBe(true);
      expect(result.cancelled).toBe(0);
      expect(result.failed).toBe(0);
      expect(monarchApi.getTransactionsList).not.toHaveBeenCalled();
    });

    test('returns noPendingTransactions: true when no pending Monarch transactions found', async () => {
      const monarchApi = getMonarchApi();
      monarchApi.getTagByName.mockResolvedValue({ id: 'tag-pending', name: 'Pending' });
      monarchApi.getTransactionsList.mockResolvedValue({ results: [] });

      const result = await reconcileCanadaLifePendingTransactions('monarch-acct-1', [], 90);

      expect(result.noPendingTransactions).toBe(true);
      expect(result.success).toBe(true);
      expect(result.cancelled).toBe(0);
      expect(monarchApi.deleteTransaction).not.toHaveBeenCalled();
    });

    test('queries Monarch with correct accountIds and tag', async () => {
      const monarchApi = getMonarchApi();
      monarchApi.getTagByName.mockResolvedValue({ id: 'tag-pending-id', name: 'Pending' });
      monarchApi.getTransactionsList.mockResolvedValue({ results: [] });

      await reconcileCanadaLifePendingTransactions('monarch-acct-123', [], 90);

      expect(monarchApi.getTransactionsList).toHaveBeenCalledWith(
        expect.objectContaining({
          accountIds: ['monarch-acct-123'],
          tags: ['tag-pending-id'],
        }),
      );
    });
  });

  describe('reconciliation — activity still present', () => {
    test('does NOT delete a transaction whose hash is still in current activities', async () => {
      const monarchApi = getMonarchApi();
      const { generateActivityHash } = require('../../../src/services/canadalife/transactions');

      // The mock generateActivityHash produces 'cl-tx:new contribution0' for this activity
      const currentActivity = { Activity: 'New contribution' };
      const activityHash = await generateActivityHash(currentActivity);

      monarchApi.getTagByName.mockResolvedValue({ id: 'tag-pending', name: 'Pending' });
      monarchApi.getTransactionsList.mockResolvedValue({
        results: [makePendingMonarchTx('monarch-tx-1', `Some notes\n${activityHash}`)],
      });

      const result = await reconcileCanadaLifePendingTransactions(
        'monarch-acct-1',
        [currentActivity],
        90,
      );

      expect(result.cancelled).toBe(0);
      expect(result.failed).toBe(0);
      expect(monarchApi.deleteTransaction).not.toHaveBeenCalled();
    });
  });

  describe('reconciliation — activity no longer present (cancelled/settled)', () => {
    test('deletes a pending Monarch transaction when its hash is not in current activities', async () => {
      const monarchApi = getMonarchApi();

      monarchApi.getTagByName.mockResolvedValue({ id: 'tag-pending', name: 'Pending' });
      monarchApi.getTransactionsList.mockResolvedValue({
        results: [
          makePendingMonarchTx('monarch-tx-gone', 'cl-tx:abcdef1234567890'),
        ],
      });
      monarchApi.deleteTransaction.mockResolvedValue({});

      // currentActivities is empty — the activity is gone
      const result = await reconcileCanadaLifePendingTransactions('monarch-acct-1', [], 90);

      expect(result.cancelled).toBe(1);
      expect(result.failed).toBe(0);
      expect(result.success).toBe(true);
      expect(monarchApi.deleteTransaction).toHaveBeenCalledWith('monarch-tx-gone');
    });

    test('deletes multiple gone transactions', async () => {
      const monarchApi = getMonarchApi();

      monarchApi.getTagByName.mockResolvedValue({ id: 'tag-pending', name: 'Pending' });
      monarchApi.getTransactionsList.mockResolvedValue({
        results: [
          makePendingMonarchTx('monarch-tx-1', 'cl-tx:aaaa111122223333'),
          makePendingMonarchTx('monarch-tx-2', 'cl-tx:bbbb444455556666'),
        ],
      });
      monarchApi.deleteTransaction.mockResolvedValue({});

      const result = await reconcileCanadaLifePendingTransactions('monarch-acct-1', [], 90);

      expect(result.cancelled).toBe(2);
      expect(monarchApi.deleteTransaction).toHaveBeenCalledTimes(2);
      expect(monarchApi.deleteTransaction).toHaveBeenCalledWith('monarch-tx-1');
      expect(monarchApi.deleteTransaction).toHaveBeenCalledWith('monarch-tx-2');
    });
  });

  describe('reconciliation — notes without extractable ID', () => {
    test('skips transaction when no cl-tx: ID found in notes', async () => {
      const monarchApi = getMonarchApi();

      monarchApi.getTagByName.mockResolvedValue({ id: 'tag-pending', name: 'Pending' });
      monarchApi.getTransactionsList.mockResolvedValue({
        results: [
          makePendingMonarchTx('monarch-tx-no-id', 'Just some user notes, no hash'),
        ],
      });

      const result = await reconcileCanadaLifePendingTransactions('monarch-acct-1', [], 90);

      expect(result.cancelled).toBe(0);
      expect(result.failed).toBe(0);
      expect(monarchApi.deleteTransaction).not.toHaveBeenCalled();
    });

    test('skips transaction when notes are empty', async () => {
      const monarchApi = getMonarchApi();

      monarchApi.getTagByName.mockResolvedValue({ id: 'tag-pending', name: 'Pending' });
      monarchApi.getTransactionsList.mockResolvedValue({
        results: [makePendingMonarchTx('monarch-tx-empty', '')],
      });

      const result = await reconcileCanadaLifePendingTransactions('monarch-acct-1', [], 90);

      expect(result.cancelled).toBe(0);
      expect(monarchApi.deleteTransaction).not.toHaveBeenCalled();
    });

    test('skips transaction when notes are null', async () => {
      const monarchApi = getMonarchApi();

      monarchApi.getTagByName.mockResolvedValue({ id: 'tag-pending', name: 'Pending' });
      monarchApi.getTransactionsList.mockResolvedValue({
        results: [makePendingMonarchTx('monarch-tx-null', null)],
      });

      const result = await reconcileCanadaLifePendingTransactions('monarch-acct-1', [], 90);

      expect(result.cancelled).toBe(0);
      expect(monarchApi.deleteTransaction).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    test('counts failed when deleteTransaction throws', async () => {
      const monarchApi = getMonarchApi();

      monarchApi.getTagByName.mockResolvedValue({ id: 'tag-pending', name: 'Pending' });
      monarchApi.getTransactionsList.mockResolvedValue({
        results: [makePendingMonarchTx('monarch-tx-fail', 'cl-tx:abcdef1234567890')],
      });
      monarchApi.deleteTransaction.mockRejectedValue(new Error('Network error'));

      const result = await reconcileCanadaLifePendingTransactions('monarch-acct-1', [], 90);

      expect(result.failed).toBe(1);
      expect(result.cancelled).toBe(0);
      expect(result.success).toBe(true); // outer success still true
    });

    test('continues processing remaining transactions after one fails', async () => {
      const monarchApi = getMonarchApi();

      monarchApi.getTagByName.mockResolvedValue({ id: 'tag-pending', name: 'Pending' });
      monarchApi.getTransactionsList.mockResolvedValue({
        results: [
          makePendingMonarchTx('monarch-tx-fail', 'cl-tx:aaaa111122223333'),
          makePendingMonarchTx('monarch-tx-ok', 'cl-tx:bbbb444455556666'),
        ],
      });
      monarchApi.deleteTransaction
        .mockRejectedValueOnce(new Error('First fails'))
        .mockResolvedValueOnce({});

      const result = await reconcileCanadaLifePendingTransactions('monarch-acct-1', [], 90);

      expect(result.failed).toBe(1);
      expect(result.cancelled).toBe(1);
      expect(monarchApi.deleteTransaction).toHaveBeenCalledTimes(2);
    });

    test('returns success: false when top-level error occurs', async () => {
      const monarchApi = getMonarchApi();
      monarchApi.getTagByName.mockRejectedValue(new Error('Monarch API unavailable'));

      const result = await reconcileCanadaLifePendingTransactions('monarch-acct-1', [], 90);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Monarch API unavailable');
    });
  });

  describe('currentActivities edge cases', () => {
    test('handles null currentActivities gracefully', async () => {
      const monarchApi = getMonarchApi();

      monarchApi.getTagByName.mockResolvedValue({ id: 'tag-pending', name: 'Pending' });
      monarchApi.getTransactionsList.mockResolvedValue({
        results: [makePendingMonarchTx('monarch-tx-1', 'cl-tx:abcdef1234567890')],
      });
      monarchApi.deleteTransaction.mockResolvedValue({});

      // Pass null for currentActivities — should treat as empty and delete
      const result = await reconcileCanadaLifePendingTransactions('monarch-acct-1', null, 90);

      expect(result.cancelled).toBe(1);
    });

    test('handles empty currentActivities — all pending transactions deleted', async () => {
      const monarchApi = getMonarchApi();

      monarchApi.getTagByName.mockResolvedValue({ id: 'tag-pending', name: 'Pending' });
      monarchApi.getTransactionsList.mockResolvedValue({
        results: [
          makePendingMonarchTx('monarch-tx-1', 'cl-tx:aaaa111122223333'),
          makePendingMonarchTx('monarch-tx-2', 'cl-tx:bbbb444455556666'),
        ],
      });
      monarchApi.deleteTransaction.mockResolvedValue({});

      const result = await reconcileCanadaLifePendingTransactions('monarch-acct-1', [], 90);

      expect(result.cancelled).toBe(2);
      expect(result.success).toBe(true);
    });
  });
});

// ============================================================
// reconcileCanadaLifeFetchedPending (Phase 2)
// ============================================================

describe('reconcileCanadaLifeFetchedPending', () => {
  const pendingTag = { id: 'tag-pending', name: 'Pending' };

  test('deletes transactions whose hash is not in current activities', async () => {
    const monarchApi = getMonarchApi();
    monarchApi.deleteTransaction.mockResolvedValue({});

    const result = await reconcileCanadaLifeFetchedPending(
      pendingTag,
      [makePendingMonarchTx('mtx-1', 'cl-tx:abcdef1234567890')],
      [], // empty activities — all gone
    );

    expect(result.cancelled).toBe(1);
    expect(monarchApi.deleteTransaction).toHaveBeenCalledWith('mtx-1');
  });

  test('does NOT delete when activity hash still present', async () => {
    const monarchApi = getMonarchApi();
    const { generateActivityHash } = require('../../../src/services/canadalife/transactions');

    const activity = { Activity: 'New contribution' };
    const hash = await generateActivityHash(activity);

    const result = await reconcileCanadaLifeFetchedPending(
      pendingTag,
      [makePendingMonarchTx('mtx-1', `Notes\n${hash}`)],
      [activity],
    );

    expect(result.cancelled).toBe(0);
    expect(monarchApi.deleteTransaction).not.toHaveBeenCalled();
  });

  test('skips transactions without extractable cl-tx: ID', async () => {
    const monarchApi = getMonarchApi();

    const result = await reconcileCanadaLifeFetchedPending(
      pendingTag,
      [makePendingMonarchTx('mtx-1', 'No hash here')],
      [],
    );

    expect(result.cancelled).toBe(0);
    expect(result.failed).toBe(0);
    expect(monarchApi.deleteTransaction).not.toHaveBeenCalled();
  });

  test('handles null currentActivities gracefully', async () => {
    const monarchApi = getMonarchApi();
    monarchApi.deleteTransaction.mockResolvedValue({});

    const result = await reconcileCanadaLifeFetchedPending(
      pendingTag,
      [makePendingMonarchTx('mtx-1', 'cl-tx:abcdef1234567890')],
      null,
    );

    expect(result.cancelled).toBe(1);
  });

  test('counts failed when deleteTransaction throws', async () => {
    const monarchApi = getMonarchApi();
    monarchApi.deleteTransaction.mockRejectedValue(new Error('fail'));

    const result = await reconcileCanadaLifeFetchedPending(
      pendingTag,
      [makePendingMonarchTx('mtx-1', 'cl-tx:abcdef1234567890')],
      [],
    );

    expect(result.failed).toBe(1);
    expect(result.cancelled).toBe(0);
    expect(result.success).toBe(true);
  });
});

// ============================================================
// formatReconciliationMessage
// ============================================================

describe('formatReconciliationMessage', () => {
  test('returns "No pending transactions" when noPendingTag is true', () => {
    expect(formatReconciliationMessage({ noPendingTag: true })).toBe('No pending transactions');
  });

  test('returns "No pending transactions" when noPendingTransactions is true', () => {
    expect(formatReconciliationMessage({ noPendingTransactions: true })).toBe('No pending transactions');
  });

  test('returns "No pending transactions" when both flags are true', () => {
    expect(formatReconciliationMessage({ noPendingTag: true, noPendingTransactions: true })).toBe(
      'No pending transactions',
    );
  });

  test('returns cancelled count when only cancellations occurred', () => {
    expect(formatReconciliationMessage({ cancelled: 3, failed: 0 })).toBe('3 removed');
  });

  test('returns failed count when only failures occurred', () => {
    expect(formatReconciliationMessage({ cancelled: 0, failed: 2 })).toBe('2 failed');
  });

  test('returns combined message when both cancelled and failed', () => {
    expect(formatReconciliationMessage({ cancelled: 2, failed: 1 })).toBe('2 removed, 1 failed');
  });

  test('returns "Nothing to reconcile" when all counts are zero', () => {
    expect(formatReconciliationMessage({ cancelled: 0, failed: 0 })).toBe('Nothing to reconcile');
  });

  test('returns "Nothing to reconcile" when no counts provided', () => {
    expect(formatReconciliationMessage({})).toBe('Nothing to reconcile');
  });

  test('handles single cancellation with correct grammar', () => {
    expect(formatReconciliationMessage({ cancelled: 1, failed: 0 })).toBe('1 removed');
  });

  test('handles single failure with correct grammar', () => {
    expect(formatReconciliationMessage({ cancelled: 0, failed: 1 })).toBe('1 failed');
  });
});