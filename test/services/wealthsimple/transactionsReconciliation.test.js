/**
 * Tests for Wealthsimple Phase 2 reconciliation (reconcileWealthsimpleFetchedPending)
 */

import {
  reconcileWealthsimpleFetchedPending,
  formatReconciliationMessage,
} from '../../../src/services/wealthsimple/transactionsReconciliation';

// ── Mocks ───────────────────────────────────────────────────

jest.mock('../../../src/core/utils', () => ({
  debugLog: jest.fn(),
}));

jest.mock('../../../src/api/monarch', () => ({
  __esModule: true,
  default: {
    updateTransaction: jest.fn(),
    setTransactionTags: jest.fn(),
    deleteTransaction: jest.fn(),
  },
}));

const mockMonarchApi = require('../../../src/api/monarch').default;

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Helpers ─────────────────────────────────────────────────

const pendingTag = { id: 'tag-pending', name: 'Pending' };

const makeMonarchTx = (id, notes, overrides = {}) => ({
  id,
  amount: -25.00,
  notes,
  tags: [{ id: 'tag-pending', name: 'Pending' }],
  ownedByUser: { id: 'user-1' },
  ...overrides,
});

const makeWsTx = (externalCanonicalId, overrides = {}) => ({
  externalCanonicalId,
  amount: 25.00,
  amountSign: 'negative',
  status: 'settled',
  type: 'SPEND',
  subType: 'PURCHASE',
  ...overrides,
});

// ── Tests ───────────────────────────────────────────────────

describe('reconcileWealthsimpleFetchedPending', () => {
  describe('settled transactions', () => {
    it('settles a transaction when WS shows it as settled (credit card)', async () => {
      mockMonarchApi.updateTransaction.mockResolvedValue({});
      mockMonarchApi.setTransactionTags.mockResolvedValue({});

      const result = await reconcileWealthsimpleFetchedPending(
        pendingTag,
        [makeMonarchTx('mtx-1', 'ws-tx:credit-transaction-abc123')],
        [makeWsTx('credit-transaction-abc123', { status: 'settled', amount: 25.00, amountSign: 'negative' })],
        'CREDIT_CARD',
      );

      expect(result.settled).toBe(1);
      expect(result.cancelled).toBe(0);
      expect(mockMonarchApi.setTransactionTags).toHaveBeenCalledWith('mtx-1', []);
    });

    it('updates amount when settled amount differs', async () => {
      mockMonarchApi.updateTransaction.mockResolvedValue({});
      mockMonarchApi.setTransactionTags.mockResolvedValue({});

      const result = await reconcileWealthsimpleFetchedPending(
        pendingTag,
        [makeMonarchTx('mtx-1', 'ws-tx:credit-transaction-abc123', { amount: -20.00 })],
        [makeWsTx('credit-transaction-abc123', { status: 'settled', amount: 25.00, amountSign: 'negative' })],
        'CREDIT_CARD',
      );

      expect(result.settled).toBe(1);
      // Called twice: once for notes, once for amount
      expect(mockMonarchApi.updateTransaction).toHaveBeenCalledTimes(2);
    });
  });

  describe('still pending transactions', () => {
    it('takes no action for transactions still pending', async () => {
      const result = await reconcileWealthsimpleFetchedPending(
        pendingTag,
        [makeMonarchTx('mtx-1', 'ws-tx:credit-transaction-abc123')],
        [makeWsTx('credit-transaction-abc123', { status: 'authorized' })],
        'CREDIT_CARD',
      );

      expect(result.settled).toBe(0);
      expect(result.cancelled).toBe(0);
      expect(mockMonarchApi.deleteTransaction).not.toHaveBeenCalled();
      expect(mockMonarchApi.updateTransaction).not.toHaveBeenCalled();
    });
  });

  describe('cancelled/missing transactions', () => {
    it('deletes when WS transaction not found', async () => {
      mockMonarchApi.deleteTransaction.mockResolvedValue({});

      const result = await reconcileWealthsimpleFetchedPending(
        pendingTag,
        [makeMonarchTx('mtx-1', 'ws-tx:credit-transaction-abc123')],
        [], // WS returns no transactions
        'CREDIT_CARD',
      );

      expect(result.cancelled).toBe(1);
      expect(mockMonarchApi.deleteTransaction).toHaveBeenCalledWith('mtx-1');
    });

    it('deletes when WS transaction has unknown status', async () => {
      mockMonarchApi.deleteTransaction.mockResolvedValue({});

      const result = await reconcileWealthsimpleFetchedPending(
        pendingTag,
        [makeMonarchTx('mtx-1', 'ws-tx:credit-transaction-abc123')],
        [makeWsTx('credit-transaction-abc123', { status: 'cancelled' })],
        'CREDIT_CARD',
      );

      expect(result.cancelled).toBe(1);
    });
  });

  describe('notes handling', () => {
    it('skips transactions without extractable WS ID', async () => {
      const result = await reconcileWealthsimpleFetchedPending(
        pendingTag,
        [makeMonarchTx('mtx-1', 'Random user notes')],
        [],
        'CREDIT_CARD',
      );

      expect(result.settled).toBe(0);
      expect(result.cancelled).toBe(0);
      expect(mockMonarchApi.deleteTransaction).not.toHaveBeenCalled();
    });

    it('handles null notes', async () => {
      const result = await reconcileWealthsimpleFetchedPending(
        pendingTag,
        [makeMonarchTx('mtx-1', null)],
        [],
        'CREDIT_CARD',
      );

      expect(result.settled).toBe(0);
      expect(result.cancelled).toBe(0);
    });
  });

  describe('CASH account type', () => {
    it('uses unifiedStatus for CASH accounts', async () => {
      mockMonarchApi.updateTransaction.mockResolvedValue({});
      mockMonarchApi.setTransactionTags.mockResolvedValue({});

      const result = await reconcileWealthsimpleFetchedPending(
        pendingTag,
        [makeMonarchTx('mtx-1', 'ws-tx:tx-abc')],
        [makeWsTx('tx-abc', { unifiedStatus: 'COMPLETED', status: undefined, type: 'P2P_PAYMENT', subType: undefined, amountSign: 'negative', amount: 10 })],
        'CASH',
      );

      expect(result.settled).toBe(1);
    });

    it('uses status field for SPEND/PREPAID on CASH accounts', async () => {
      mockMonarchApi.updateTransaction.mockResolvedValue({});
      mockMonarchApi.setTransactionTags.mockResolvedValue({});

      const result = await reconcileWealthsimpleFetchedPending(
        pendingTag,
        [makeMonarchTx('mtx-1', 'ws-tx:tx-abc')],
        [makeWsTx('tx-abc', { type: 'SPEND', subType: 'PREPAID', status: 'settled', amountSign: 'negative', amount: 10 })],
        'CASH',
      );

      expect(result.settled).toBe(1);
    });
  });

  describe('error handling', () => {
    it('counts failed on per-transaction errors', async () => {
      mockMonarchApi.deleteTransaction.mockRejectedValue(new Error('API error'));

      const result = await reconcileWealthsimpleFetchedPending(
        pendingTag,
        [makeMonarchTx('mtx-1', 'ws-tx:credit-transaction-abc123')],
        [],
        'CREDIT_CARD',
      );

      expect(result.failed).toBe(1);
      expect(result.cancelled).toBe(0);
      expect(result.success).toBe(true);
    });

    it('handles empty monarchPendingTransactions gracefully', async () => {
      const result = await reconcileWealthsimpleFetchedPending(
        pendingTag,
        [],
        [],
        'CREDIT_CARD',
      );

      expect(result.success).toBe(true);
      expect(result.settled).toBe(0);
      expect(result.cancelled).toBe(0);
    });
  });
});

describe('formatReconciliationMessage', () => {
  it('returns "No pending transactions" for noPendingTag', () => {
    expect(formatReconciliationMessage({ noPendingTag: true })).toBe('No pending transactions');
  });

  it('returns "Nothing settled or cancelled" for all zeros', () => {
    expect(formatReconciliationMessage({ settled: 0, cancelled: 0, failed: 0 })).toBe('Nothing settled or cancelled');
  });

  it('formats settled and cancelled counts', () => {
    expect(formatReconciliationMessage({ settled: 2, cancelled: 1, failed: 0 })).toBe('2 settled, 1 cancelled');
  });
});