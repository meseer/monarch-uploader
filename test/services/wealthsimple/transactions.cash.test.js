/**
 * Tests for Wealthsimple Transaction Service - Cash Transactions
 *
 * Covers: fetchAndProcessTransactions, date conversion, reconcilePendingTransactions,
 * fetchAndProcessCashTransactions
 */

import {
  fetchAndProcessCreditCardTransactions,
  fetchAndProcessCashTransactions,
  fetchAndProcessTransactions,
  reconcilePendingTransactions,
} from '../../../src/services/wealthsimple/transactions';
import wealthsimpleApi from '../../../src/api/wealthsimple';
import monarchApi from '../../../src/api/monarch';
import { applyWealthsimpleCategoryMapping } from '../../../src/mappers/category';
import { showManualTransactionCategorization } from '../../../src/ui/components/categorySelector';

// Mock dependencies
jest.mock('../../../src/api/wealthsimple');
jest.mock('../../../src/api/monarch');
jest.mock('../../../src/mappers/category');
jest.mock('../../../src/ui/toast', () => ({
  show: jest.fn(),
}));
jest.mock('../../../src/ui/components/categorySelector', () => ({
  showMonarchCategorySelector: jest.fn(),
  showManualTransactionCategorization: jest.fn(),
}));

// Set up default mock for fetchSpendTransactions to return empty Map
beforeEach(() => {
  wealthsimpleApi.fetchSpendTransactions = jest.fn().mockResolvedValue(new Map());
});

describe('Wealthsimple Transaction Service - Cash', () => {
  const mockConsolidatedAccount = {
    wealthsimpleAccount: {
      id: 'test-account-id',
      nickname: 'Test Credit Card',
      type: 'CREDIT_CARD',
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('fetchAndProcessTransactions', () => {
    it('should route CREDIT_CARD accounts to transaction processor', async () => {
      const creditCardAccount = {
        wealthsimpleAccount: {
          id: 'test-id',
          nickname: 'Credit Card',
          type: 'CREDIT_CARD',
        },
      };

      wealthsimpleApi.fetchTransactions.mockResolvedValue([]);
      monarchApi.getCategoriesAndGroups.mockResolvedValue({ categories: [] });

      const result = await fetchAndProcessTransactions(
        creditCardAccount,
        '2025-01-01',
        '2025-01-31',
      );

      expect(wealthsimpleApi.fetchTransactions).toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('should route PORTFOLIO_LINE_OF_CREDIT accounts to transaction processor', async () => {
      const locAccount = {
        wealthsimpleAccount: {
          id: 'test-id',
          nickname: 'Line of Credit',
          type: 'PORTFOLIO_LINE_OF_CREDIT',
        },
      };

      wealthsimpleApi.fetchTransactions.mockResolvedValue([]);
      monarchApi.getCategoriesAndGroups.mockResolvedValue({ categories: [] });

      const result = await fetchAndProcessTransactions(
        locAccount,
        '2025-01-01',
        '2025-01-31',
      );

      expect(wealthsimpleApi.fetchTransactions).toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('should route CASH account types to cash transaction processor', async () => {
      const cashAccount = {
        wealthsimpleAccount: {
          id: 'test-id',
          nickname: 'Cash Account',
          type: 'CASH', // Matches the routing check for 'CASH' or 'CASH_USD'
        },
      };

      wealthsimpleApi.fetchTransactions.mockResolvedValue([]);

      const result = await fetchAndProcessTransactions(
        cashAccount,
        '2025-01-01',
        '2025-01-31',
      );

      // CASH accounts are now processed via fetchAndProcessCashTransactions
      expect(result).toEqual([]);
      expect(wealthsimpleApi.fetchTransactions).toHaveBeenCalled();
    });

    it('should route CASH_USD account types to cash transaction processor', async () => {
      const cashUsdAccount = {
        wealthsimpleAccount: {
          id: 'test-id',
          nickname: 'Cash USD Account',
          type: 'CASH_USD', // Matches the routing check for 'CASH' or 'CASH_USD'
        },
      };

      wealthsimpleApi.fetchTransactions.mockResolvedValue([]);

      const result = await fetchAndProcessTransactions(
        cashUsdAccount,
        '2025-01-01',
        '2025-01-31',
      );

      // CASH_USD accounts are processed via fetchAndProcessCashTransactions
      expect(result).toEqual([]);
      expect(wealthsimpleApi.fetchTransactions).toHaveBeenCalled();
    });

    it('should route investment accounts (TFSA) to investment transaction processor', async () => {
      const tfsaAccount = {
        wealthsimpleAccount: {
          id: 'test-id',
          nickname: 'TFSA',
          type: 'MANAGED_TFSA',
        },
      };

      wealthsimpleApi.fetchTransactions.mockResolvedValue([]);

      const result = await fetchAndProcessTransactions(
        tfsaAccount,
        '2025-01-01',
        '2025-01-31',
      );

      expect(result).toEqual([]);
      // Investment accounts now support transaction sync
      expect(wealthsimpleApi.fetchTransactions).toHaveBeenCalledWith('test-id', '2025-01-01');
    });
  });

  describe('date conversion', () => {
    it('should convert ISO timestamps to local dates correctly', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'tx-1',
          occurredAt: '2025-01-15T23:59:59.000000+00:00',
          type: 'CREDIT_CARD',
          subType: 'PURCHASE',
          status: 'settled',
          spendMerchant: 'Test',
          amount: 10.00,
          amountSign: 'negative',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);
      monarchApi.getCategoriesAndGroups.mockResolvedValue({ categories: [] });
      applyWealthsimpleCategoryMapping.mockReturnValue('Shopping');

      const result = await fetchAndProcessCreditCardTransactions(
        mockConsolidatedAccount,
        '2025-01-01',
        '2025-01-31',
      );

      // Date should be in YYYY-MM-DD format
      expect(result[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('reconcilePendingTransactions', () => {
    const mockMonarchAccountId = 'monarch-account-123';
    const mockPendingTagId = 'pending-tag-456';

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should return early if Pending tag does not exist in Monarch', async () => {
      monarchApi.getTagByName.mockResolvedValue(null);

      const result = await reconcilePendingTransactions(
        mockMonarchAccountId,
        [],
        30,
      );

      expect(result.success).toBe(true);
      expect(result.noPendingTag).toBe(true);
      expect(monarchApi.getTransactionsList).not.toHaveBeenCalled();
    });

    it('should return early if no pending transactions found in Monarch', async () => {
      monarchApi.getTagByName.mockResolvedValue({ id: mockPendingTagId, name: 'Pending' });
      monarchApi.getTransactionsList.mockResolvedValue({ results: [] });

      const result = await reconcilePendingTransactions(
        mockMonarchAccountId,
        [],
        30,
      );

      expect(result.success).toBe(true);
      expect(result.noPendingTransactions).toBe(true);
      expect(result.settled).toBe(0);
      expect(result.cancelled).toBe(0);
    });

    it('should update transaction and remove tag when status changes to settled', async () => {
      monarchApi.getTagByName.mockResolvedValue({ id: mockPendingTagId, name: 'Pending' });
      monarchApi.getTransactionsList.mockResolvedValue({
        results: [
          {
            id: 'monarch-tx-1',
            amount: -50.00,
            date: '2025-01-10',
            notes: 'PURCHASE / credit-transaction-527000993851-20260111-00-32943086',
            ownedByUser: { id: 'user-123' },
          },
        ],
      });
      monarchApi.updateTransaction.mockResolvedValue({});
      monarchApi.setTransactionTags.mockResolvedValue({});

      const wealthsimpleTransactions = [
        {
          externalCanonicalId: 'credit-transaction-527000993851-20260111-00-32943086',
          status: 'settled',
          amount: 52.00,
          amountSign: 'negative',
        },
      ];

      const result = await reconcilePendingTransactions(
        mockMonarchAccountId,
        wealthsimpleTransactions,
        30,
      );

      expect(result.success).toBe(true);
      expect(result.settled).toBe(1);
      expect(result.cancelled).toBe(0);
      expect(result.failed).toBe(0);

      // Should update notes first (separate call to avoid 400 error)
      expect(monarchApi.updateTransaction).toHaveBeenNthCalledWith(1, 'monarch-tx-1', {
        notes: '',
        ownerUserId: 'user-123',
      });

      // Should update amount separately since it changed (-50 -> -52)
      expect(monarchApi.updateTransaction).toHaveBeenNthCalledWith(2, 'monarch-tx-1', {
        amount: -52.00,
        ownerUserId: 'user-123',
      });

      expect(monarchApi.updateTransaction).toHaveBeenCalledTimes(2);

      // Should remove Pending tag
      expect(monarchApi.setTransactionTags).toHaveBeenCalledWith('monarch-tx-1', []);
    });

    it('should preserve user notes when cleaning system notes', async () => {
      monarchApi.getTagByName.mockResolvedValue({ id: mockPendingTagId, name: 'Pending' });
      monarchApi.getTransactionsList.mockResolvedValue({
        results: [
          {
            id: 'monarch-tx-1',
            amount: -50.00,
            date: '2025-01-10',
            notes: 'PURCHASE / credit-transaction-527000993851-20260111-00-32943086 | My custom note',
            ownedByUser: null,
          },
        ],
      });
      monarchApi.updateTransaction.mockResolvedValue({});
      monarchApi.setTransactionTags.mockResolvedValue({});

      const wealthsimpleTransactions = [
        {
          externalCanonicalId: 'credit-transaction-527000993851-20260111-00-32943086',
          status: 'settled',
          amount: 50.00,
          amountSign: 'negative',
        },
      ];

      const result = await reconcilePendingTransactions(
        mockMonarchAccountId,
        wealthsimpleTransactions,
        30,
      );

      expect(result.settled).toBe(1);

      // Should preserve user notes (system notes and separators are cleaned)
      // ownerUserId should be null when ownedByUser is null
      // Notes update first
      expect(monarchApi.updateTransaction).toHaveBeenNthCalledWith(1, 'monarch-tx-1', {
        notes: 'My custom note',
        ownerUserId: null,
      });

      // Amount hasn't changed (-50 -> -50), so no second update call
      expect(monarchApi.updateTransaction).toHaveBeenCalledTimes(1);
    });

    it('should not update amount when it has not changed', async () => {
      monarchApi.getTagByName.mockResolvedValue({ id: mockPendingTagId, name: 'Pending' });
      monarchApi.getTransactionsList.mockResolvedValue({
        results: [
          {
            id: 'monarch-tx-1',
            amount: -50.00,
            date: '2025-01-10',
            notes: 'PURCHASE / credit-transaction-unchanged-amount',
            ownedByUser: { id: 'user-123' },
          },
        ],
      });
      monarchApi.updateTransaction.mockResolvedValue({});
      monarchApi.setTransactionTags.mockResolvedValue({});

      const wealthsimpleTransactions = [
        {
          externalCanonicalId: 'credit-transaction-unchanged-amount',
          status: 'settled',
          amount: 50.00, // Same as Monarch amount (will be -50.00 after sign)
          amountSign: 'negative',
        },
      ];

      const result = await reconcilePendingTransactions(
        mockMonarchAccountId,
        wealthsimpleTransactions,
        30,
      );

      expect(result.success).toBe(true);
      expect(result.settled).toBe(1);

      // Should only update notes (one call), not amount since it hasn't changed
      expect(monarchApi.updateTransaction).toHaveBeenCalledTimes(1);
      expect(monarchApi.updateTransaction).toHaveBeenCalledWith('monarch-tx-1', {
        notes: '',
        ownerUserId: 'user-123',
      });

      // Should still remove Pending tag
      expect(monarchApi.setTransactionTags).toHaveBeenCalledWith('monarch-tx-1', []);
    });

    it('should delete transaction when not found in Wealthsimple (cancelled)', async () => {
      monarchApi.getTagByName.mockResolvedValue({ id: mockPendingTagId, name: 'Pending' });
      monarchApi.getTransactionsList.mockResolvedValue({
        results: [
          {
            id: 'monarch-tx-1',
            amount: -50.00,
            date: '2025-01-10',
            notes: 'PURCHASE / credit-transaction-not-found-in-ws',
          },
        ],
      });
      monarchApi.deleteTransaction.mockResolvedValue(true);

      // Empty Wealthsimple transactions - the pending transaction was cancelled
      const wealthsimpleTransactions = [];

      const result = await reconcilePendingTransactions(
        mockMonarchAccountId,
        wealthsimpleTransactions,
        30,
      );

      expect(result.success).toBe(true);
      expect(result.settled).toBe(0);
      expect(result.cancelled).toBe(1);

      expect(monarchApi.deleteTransaction).toHaveBeenCalledWith('monarch-tx-1');
    });

    it('should delete transaction when status is unknown (not authorized or settled)', async () => {
      monarchApi.getTagByName.mockResolvedValue({ id: mockPendingTagId, name: 'Pending' });
      monarchApi.getTransactionsList.mockResolvedValue({
        results: [
          {
            id: 'monarch-tx-1',
            amount: -50.00,
            date: '2025-01-10',
            notes: 'PURCHASE / credit-transaction-unknown-status',
          },
        ],
      });
      monarchApi.deleteTransaction.mockResolvedValue(true);

      const wealthsimpleTransactions = [
        {
          externalCanonicalId: 'credit-transaction-unknown-status',
          status: 'rejected', // Unknown status - should be deleted
          amount: 50.00,
          amountSign: 'negative',
        },
      ];

      const result = await reconcilePendingTransactions(
        mockMonarchAccountId,
        wealthsimpleTransactions,
        30,
      );

      expect(result.success).toBe(true);
      expect(result.settled).toBe(0);
      expect(result.cancelled).toBe(1);

      expect(monarchApi.deleteTransaction).toHaveBeenCalledWith('monarch-tx-1');
    });

    it('should skip transaction if still authorized (pending)', async () => {
      monarchApi.getTagByName.mockResolvedValue({ id: mockPendingTagId, name: 'Pending' });
      monarchApi.getTransactionsList.mockResolvedValue({
        results: [
          {
            id: 'monarch-tx-1',
            amount: -50.00,
            date: '2025-01-10',
            notes: 'PURCHASE / credit-transaction-still-pending',
          },
        ],
      });

      const wealthsimpleTransactions = [
        {
          externalCanonicalId: 'credit-transaction-still-pending',
          status: 'authorized', // Still pending
          amount: 50.00,
          amountSign: 'negative',
        },
      ];

      const result = await reconcilePendingTransactions(
        mockMonarchAccountId,
        wealthsimpleTransactions,
        30,
      );

      expect(result.success).toBe(true);
      expect(result.settled).toBe(0);
      expect(result.cancelled).toBe(0);

      // Should not call update or delete
      expect(monarchApi.updateTransaction).not.toHaveBeenCalled();
      expect(monarchApi.deleteTransaction).not.toHaveBeenCalled();
    });

    it('should skip transaction if cannot extract transaction ID from notes', async () => {
      monarchApi.getTagByName.mockResolvedValue({ id: mockPendingTagId, name: 'Pending' });
      monarchApi.getTransactionsList.mockResolvedValue({
        results: [
          {
            id: 'monarch-tx-1',
            amount: -50.00,
            date: '2025-01-10',
            notes: 'Some random notes without transaction ID',
          },
        ],
      });

      const wealthsimpleTransactions = [];

      const result = await reconcilePendingTransactions(
        mockMonarchAccountId,
        wealthsimpleTransactions,
        30,
      );

      expect(result.success).toBe(true);
      expect(result.settled).toBe(0);
      expect(result.cancelled).toBe(0);

      // Should not call update or delete
      expect(monarchApi.updateTransaction).not.toHaveBeenCalled();
      expect(monarchApi.deleteTransaction).not.toHaveBeenCalled();
    });

    it('should handle transaction ID without type prefix', async () => {
      monarchApi.getTagByName.mockResolvedValue({ id: mockPendingTagId, name: 'Pending' });
      monarchApi.getTransactionsList.mockResolvedValue({
        results: [
          {
            id: 'monarch-tx-1',
            amount: -50.00,
            date: '2025-01-10',
            notes: 'credit-transaction-527000993851-20260111-00-32943086', // Just ID, no type prefix
            ownedByUser: { id: 'user-456' },
          },
        ],
      });
      monarchApi.updateTransaction.mockResolvedValue({});
      monarchApi.setTransactionTags.mockResolvedValue({});

      const wealthsimpleTransactions = [
        {
          externalCanonicalId: 'credit-transaction-527000993851-20260111-00-32943086',
          status: 'settled',
          amount: 50.00,
          amountSign: 'negative',
        },
      ];

      const result = await reconcilePendingTransactions(
        mockMonarchAccountId,
        wealthsimpleTransactions,
        30,
      );

      expect(result.settled).toBe(1);

      // Should only update notes (amount unchanged: -50 -> -50)
      expect(monarchApi.updateTransaction).toHaveBeenCalledTimes(1);
      expect(monarchApi.updateTransaction).toHaveBeenCalledWith('monarch-tx-1', {
        notes: '',
        ownerUserId: 'user-456',
      });
    });

    it('should find pending transactions with future dates (user-modified dates)', async () => {
      // This test covers the fix for future-dated pending transactions
      // When a user modifies a pending transaction date in Monarch to be in the future,
      // the reconciliation should still find and process it

      monarchApi.getTagByName.mockResolvedValue({ id: mockPendingTagId, name: 'Pending' });

      // Mock transaction with a future date (e.g., 6 months from now)
      monarchApi.getTransactionsList.mockResolvedValue({
        results: [
          {
            id: 'monarch-tx-future',
            amount: -75.00,
            date: '2026-07-15', // Future date
            notes: 'PURCHASE / credit-transaction-future-dated',
            ownedByUser: { id: 'user-123' },
          },
        ],
      });
      monarchApi.updateTransaction.mockResolvedValue({});
      monarchApi.setTransactionTags.mockResolvedValue({});

      // The transaction has settled in Wealthsimple
      const wealthsimpleTransactions = [
        {
          externalCanonicalId: 'credit-transaction-future-dated',
          status: 'settled',
          amount: 75.00,
          amountSign: 'negative',
        },
      ];

      const result = await reconcilePendingTransactions(
        mockMonarchAccountId,
        wealthsimpleTransactions,
        30, // lookback days
      );

      // The fix: endDate is now 1 year in the future, so this transaction should be found
      // and processed correctly
      expect(result.success).toBe(true);
      expect(result.settled).toBe(1);
      expect(result.cancelled).toBe(0);

      // Verify getTransactionsList was called with an endDate in the future
      expect(monarchApi.getTransactionsList).toHaveBeenCalledWith(
        expect.objectContaining({
          accountIds: [mockMonarchAccountId],
          tags: [mockPendingTagId],
          // startDate should be around 30 days ago
          startDate: expect.any(String),
          // endDate should be about 1 year in the future
          endDate: expect.any(String),
        }),
      );

      // Verify the endDate is actually in the future (approximately 1 year from now)
      const callArgs = monarchApi.getTransactionsList.mock.calls[0][0];
      const endDateParsed = new Date(callArgs.endDate);
      const today = new Date();
      const oneYearFromNow = new Date(today);
      oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);

      // endDate should be close to 1 year from now (within a few days tolerance)
      const diffDays = Math.abs((endDateParsed - oneYearFromNow) / (1000 * 60 * 60 * 24));
      expect(diffDays).toBeLessThan(5);

      // Should have processed the transaction
      expect(monarchApi.updateTransaction).toHaveBeenCalled();
      expect(monarchApi.setTransactionTags).toHaveBeenCalledWith('monarch-tx-future', []);
    });

    it('should handle multiple pending transactions', async () => {
      monarchApi.getTagByName.mockResolvedValue({ id: mockPendingTagId, name: 'Pending' });
      monarchApi.getTransactionsList.mockResolvedValue({
        results: [
          {
            id: 'monarch-tx-1',
            amount: -50.00,
            date: '2025-01-10',
            notes: 'PURCHASE / credit-transaction-settled-one',
            ownedByUser: { id: 'user-123' },
          },
          {
            id: 'monarch-tx-2',
            amount: -25.00,
            date: '2025-01-11',
            notes: 'PURCHASE / credit-transaction-cancelled-one',
            ownedByUser: null,
          },
          {
            id: 'monarch-tx-3',
            amount: -75.00,
            date: '2025-01-12',
            notes: 'PURCHASE / credit-transaction-still-pending',
            ownedByUser: { id: 'user-456' },
          },
        ],
      });
      monarchApi.updateTransaction.mockResolvedValue({});
      monarchApi.setTransactionTags.mockResolvedValue({});
      monarchApi.deleteTransaction.mockResolvedValue(true);

      const wealthsimpleTransactions = [
        {
          externalCanonicalId: 'credit-transaction-settled-one',
          status: 'settled',
          amount: 50.00,
          amountSign: 'negative',
        },
        // credit-transaction-cancelled-one is not in the list (cancelled)
        {
          externalCanonicalId: 'credit-transaction-still-pending',
          status: 'authorized',
          amount: 75.00,
          amountSign: 'negative',
        },
      ];

      const result = await reconcilePendingTransactions(
        mockMonarchAccountId,
        wealthsimpleTransactions,
        30,
      );

      expect(result.success).toBe(true);
      expect(result.settled).toBe(1);
      expect(result.cancelled).toBe(1);
      expect(result.failed).toBe(0);

      expect(monarchApi.updateTransaction).toHaveBeenCalledTimes(1);
      expect(monarchApi.deleteTransaction).toHaveBeenCalledTimes(1);
    });

    it('should continue processing if one transaction fails and track failed count', async () => {
      monarchApi.getTagByName.mockResolvedValue({ id: mockPendingTagId, name: 'Pending' });
      monarchApi.getTransactionsList.mockResolvedValue({
        results: [
          {
            id: 'monarch-tx-1',
            amount: -50.00,
            date: '2025-01-10',
            notes: 'PURCHASE / credit-transaction-first',
            ownedByUser: { id: 'user-123' },
          },
          {
            id: 'monarch-tx-2',
            amount: -25.00,
            date: '2025-01-11',
            notes: 'PURCHASE / credit-transaction-second',
            ownedByUser: null,
          },
        ],
      });
      // First update fails
      monarchApi.updateTransaction
        .mockRejectedValueOnce(new Error('API Error'))
        .mockResolvedValueOnce({});
      monarchApi.setTransactionTags.mockResolvedValue({});

      const wealthsimpleTransactions = [
        {
          externalCanonicalId: 'credit-transaction-first',
          status: 'settled',
          amount: 50.00,
          amountSign: 'negative',
        },
        {
          externalCanonicalId: 'credit-transaction-second',
          status: 'settled',
          amount: 25.00,
          amountSign: 'negative',
        },
      ];

      const result = await reconcilePendingTransactions(
        mockMonarchAccountId,
        wealthsimpleTransactions,
        30,
      );

      // Should continue despite first failure and track failed count
      expect(result.settled).toBe(1);
      expect(result.failed).toBe(1);
      expect(monarchApi.updateTransaction).toHaveBeenCalledTimes(2);
    });
  });

  describe('fetchAndProcessCashTransactions', () => {
    const mockCashAccount = {
      wealthsimpleAccount: {
        id: 'cash-account-id',
        nickname: 'Cash Account',
        type: 'CASH', // Updated to match routing logic
      },
    };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should process E_TRANSFER deposit transactions', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'tx-etransfer-1',
          occurredAt: '2026-01-15T10:30:00.000000+00:00',
          type: 'DEPOSIT',
          subType: 'E_TRANSFER',
          unifiedStatus: 'COMPLETED',
          eTransferName: 'John Doe',
          eTransferEmail: 'john@example.com',
          amount: 100.00,
          amountSign: 'positive',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);

      const result = await fetchAndProcessCashTransactions(
        mockCashAccount,
        '2026-01-01',
        '2026-01-31',
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'tx-etransfer-1',
        date: '2026-01-15',
        merchant: 'e-Transfer from John Doe',
        originalMerchant: 'DEPOSIT:E_TRANSFER:Interac e-Transfer from John Doe (john@example.com)',
        amount: 100.00, // positive (deposit)
        resolvedMonarchCategory: 'Transfer',
        isPending: false,
        ruleId: 'e-transfer',
      });
    });

    it('should process E_TRANSFER withdrawal transactions', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'tx-etransfer-2',
          occurredAt: '2026-01-16T14:30:00.000000+00:00',
          type: 'WITHDRAWAL',
          subType: 'E_TRANSFER',
          unifiedStatus: 'COMPLETED',
          eTransferName: 'Jane Smith',
          eTransferEmail: 'jane@example.com',
          amount: 50.00,
          amountSign: 'negative',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);

      const result = await fetchAndProcessCashTransactions(
        mockCashAccount,
        '2026-01-01',
        '2026-01-31',
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'tx-etransfer-2',
        merchant: 'e-Transfer to Jane Smith',
        originalMerchant: 'WITHDRAWAL:E_TRANSFER:Interac e-Transfer to Jane Smith (jane@example.com)',
        amount: -50.00, // negative (withdrawal)
        resolvedMonarchCategory: 'Transfer',
      });
    });

    it('should filter transactions by unifiedStatus - only COMPLETED', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'tx-completed',
          type: 'DEPOSIT',
          subType: 'E_TRANSFER',
          unifiedStatus: 'COMPLETED',
          eTransferName: 'Completed',
          amount: 100.00,
          amountSign: 'positive',
          occurredAt: '2026-01-15T10:00:00.000000+00:00',
        },
        {
          externalCanonicalId: 'tx-cancelled',
          type: 'DEPOSIT',
          subType: 'E_TRANSFER',
          unifiedStatus: 'CANCELLED', // Should be excluded
          eTransferName: 'Cancelled',
          amount: 50.00,
          amountSign: 'positive',
          occurredAt: '2026-01-16T10:00:00.000000+00:00',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);

      const result = await fetchAndProcessCashTransactions(
        mockCashAccount,
        '2026-01-01',
        '2026-01-31',
      );

      // Should only include COMPLETED transaction
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('tx-completed');
    });

    it('should include IN_PROGRESS transactions as pending when includePendingTransactions is true', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'tx-in-progress',
          type: 'DEPOSIT',
          subType: 'E_TRANSFER',
          unifiedStatus: 'IN_PROGRESS',
          eTransferName: 'Pending Person',
          eTransferEmail: 'pending@example.com',
          amount: 75.00,
          amountSign: 'positive',
          occurredAt: '2026-01-17T10:00:00.000000+00:00',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);

      const result = await fetchAndProcessCashTransactions(
        { ...mockCashAccount, includePendingTransactions: true },
        '2026-01-01',
        '2026-01-31',
      );

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('tx-in-progress');
      expect(result[0].isPending).toBe(true);
      expect(result[0].unifiedStatus).toBe('IN_PROGRESS');
    });

    it('should include PENDING transactions as pending when includePendingTransactions is true', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'tx-pending',
          type: 'DEPOSIT',
          subType: 'E_TRANSFER',
          unifiedStatus: 'PENDING',
          eTransferName: 'Pending Person',
          amount: 60.00,
          amountSign: 'positive',
          occurredAt: '2026-01-18T10:00:00.000000+00:00',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);

      const result = await fetchAndProcessCashTransactions(
        { ...mockCashAccount, includePendingTransactions: true },
        '2026-01-01',
        '2026-01-31',
      );

      expect(result).toHaveLength(1);
      expect(result[0].isPending).toBe(true);
    });

    it('should exclude pending transactions when includePendingTransactions is false', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'tx-completed',
          type: 'DEPOSIT',
          subType: 'E_TRANSFER',
          unifiedStatus: 'COMPLETED',
          eTransferName: 'Completed',
          amount: 100.00,
          amountSign: 'positive',
          occurredAt: '2026-01-15T10:00:00.000000+00:00',
        },
        {
          externalCanonicalId: 'tx-in-progress',
          type: 'DEPOSIT',
          subType: 'E_TRANSFER',
          unifiedStatus: 'IN_PROGRESS',
          eTransferName: 'Pending',
          amount: 50.00,
          amountSign: 'positive',
          occurredAt: '2026-01-16T10:00:00.000000+00:00',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);

      const result = await fetchAndProcessCashTransactions(
        { ...mockCashAccount, includePendingTransactions: false },
        '2026-01-01',
        '2026-01-31',
      );

      // Should only include COMPLETED transaction
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('tx-completed');
    });

    it('should process transactions without matching rules via manual categorization', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'tx-unsupported',
          type: 'FEE',
          subType: 'SERVICE_FEE', // No rule for this
          unifiedStatus: 'COMPLETED',
          amount: 5.00,
          amountSign: 'negative',
          occurredAt: '2026-01-15T10:00:00.000000+00:00',
        },
        {
          externalCanonicalId: 'tx-etransfer',
          type: 'DEPOSIT',
          subType: 'E_TRANSFER', // Has a rule
          unifiedStatus: 'COMPLETED',
          eTransferName: 'John',
          amount: 100.00,
          amountSign: 'positive',
          occurredAt: '2026-01-16T10:00:00.000000+00:00',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);

      // Mock manual categorization for the unsupported transaction
      showManualTransactionCategorization.mockImplementation((transaction, callback) => {
        callback({
          merchant: 'Service Fee',
          category: { id: 'cat-fees', name: 'Financial Fees' },
        });
      });

      const result = await fetchAndProcessCashTransactions(
        mockCashAccount,
        '2026-01-01',
        '2026-01-31',
      );

      // Should include both: e-transfer (has a rule) and manually categorized transaction
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('tx-etransfer');
      expect(result[1].id).toBe('tx-unsupported');
      expect(result[1].merchant).toBe('Service Fee');
      expect(result[1].resolvedMonarchCategory).toBe('Financial Fees');
      expect(result[1].ruleId).toBe('manual');
    });

    it('should return empty array when no transactions found', async () => {
      wealthsimpleApi.fetchTransactions.mockResolvedValue([]);

      const result = await fetchAndProcessCashTransactions(
        mockCashAccount,
        '2026-01-01',
        '2026-01-31',
      );

      expect(result).toEqual([]);
    });

    it('should handle API errors gracefully', async () => {
      wealthsimpleApi.fetchTransactions.mockRejectedValue(new Error('API Error'));

      await expect(
        fetchAndProcessCashTransactions(
          mockCashAccount,
          '2026-01-01',
          '2026-01-31',
        ),
      ).rejects.toThrow('API Error');
    });

    it('should fall back to email when eTransferName is missing', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'tx-no-name',
          type: 'DEPOSIT',
          subType: 'E_TRANSFER',
          unifiedStatus: 'COMPLETED',
          eTransferName: null,
          eTransferEmail: 'person@example.com',
          amount: 100.00,
          amountSign: 'positive',
          occurredAt: '2026-01-15T10:00:00.000000+00:00',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);

      const result = await fetchAndProcessCashTransactions(
        mockCashAccount,
        '2026-01-01',
        '2026-01-31',
      );

      expect(result[0].merchant).toBe('e-Transfer from person@example.com');
    });

    it('should use Unknown when both name and email are missing', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'tx-unknown',
          type: 'DEPOSIT',
          subType: 'E_TRANSFER',
          unifiedStatus: 'COMPLETED',
          eTransferName: null,
          eTransferEmail: null,
          amount: 100.00,
          amountSign: 'positive',
          occurredAt: '2026-01-15T10:00:00.000000+00:00',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);

      const result = await fetchAndProcessCashTransactions(
        mockCashAccount,
        '2026-01-01',
        '2026-01-31',
      );

      expect(result[0].merchant).toBe('e-Transfer from Unknown');
    });

    it('should show manual categorization dialog for transactions without matching rules', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'tx-unknown-type',
          occurredAt: '2026-01-15T10:00:00.000000+00:00',
          type: 'UNKNOWN_TYPE',
          subType: 'UNKNOWN_SUBTYPE',
          unifiedStatus: 'COMPLETED',
          amount: 123.45,
          amountSign: 'negative',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);

      // Mock manual categorization - user provides merchant and category
      showManualTransactionCategorization.mockImplementation((transaction, callback) => {
        callback({
          merchant: 'My Custom Merchant',
          category: { id: 'cat-1', name: 'Custom Category' },
        });
      });

      const result = await fetchAndProcessCashTransactions(
        mockCashAccount,
        '2026-01-01',
        '2026-01-31',
      );

      // Should have called manual categorization
      expect(showManualTransactionCategorization).toHaveBeenCalledWith(
        expect.objectContaining({
          externalCanonicalId: 'tx-unknown-type',
          type: 'UNKNOWN_TYPE',
          subType: 'UNKNOWN_SUBTYPE',
        }),
        expect.any(Function),
      );

      // Should include the manually categorized transaction
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'tx-unknown-type',
        merchant: 'My Custom Merchant',
        originalMerchant: 'UNKNOWN_TYPE:UNKNOWN_SUBTYPE:My Custom Merchant',
        amount: -123.45,
        resolvedMonarchCategory: 'Custom Category',
        ruleId: 'manual',
        needsCategoryMapping: false,
      });
    });

    it('should throw error when user cancels manual categorization', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'tx-unknown-type',
          occurredAt: '2026-01-15T10:00:00.000000+00:00',
          type: 'UNKNOWN_TYPE',
          subType: 'UNKNOWN_SUBTYPE',
          unifiedStatus: 'COMPLETED',
          amount: 50.00,
          amountSign: 'negative',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);

      // Mock manual categorization - user cancels
      showManualTransactionCategorization.mockImplementation((transaction, callback) => {
        callback(null);
      });

      await expect(
        fetchAndProcessCashTransactions(
          mockCashAccount,
          '2026-01-01',
          '2026-01-31',
        ),
      ).rejects.toThrow('Manual categorization cancelled');
    });

    it('should process both rule-matched and manual transactions together', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'tx-etransfer',
          occurredAt: '2026-01-15T10:00:00.000000+00:00',
          type: 'DEPOSIT',
          subType: 'E_TRANSFER',
          unifiedStatus: 'COMPLETED',
          eTransferName: 'John',
          eTransferEmail: 'john@example.com',
          amount: 100.00,
          amountSign: 'positive',
        },
        {
          externalCanonicalId: 'tx-unknown',
          occurredAt: '2026-01-16T10:00:00.000000+00:00',
          type: 'DIVIDEND',
          subType: 'STOCK_DIVIDEND',
          unifiedStatus: 'COMPLETED',
          amount: 25.00,
          amountSign: 'positive',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);

      // Mock manual categorization for the unknown transaction
      showManualTransactionCategorization.mockImplementation((transaction, callback) => {
        callback({
          merchant: 'Stock Dividend',
          category: { id: 'cat-income', name: 'Investment Income' },
        });
      });

      const result = await fetchAndProcessCashTransactions(
        mockCashAccount,
        '2026-01-01',
        '2026-01-31',
      );

      // Should have 2 transactions total
      expect(result).toHaveLength(2);

      // First should be the e-transfer (processed via rules)
      expect(result[0]).toMatchObject({
        id: 'tx-etransfer',
        merchant: 'e-Transfer from John',
        resolvedMonarchCategory: 'Transfer',
        ruleId: 'e-transfer',
      });

      // Second should be the manually categorized transaction
      expect(result[1]).toMatchObject({
        id: 'tx-unknown',
        merchant: 'Stock Dividend',
        resolvedMonarchCategory: 'Investment Income',
        ruleId: 'manual',
      });
    });

    it('should mark manually categorized transactions with correct pending status', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'tx-pending-manual',
          occurredAt: '2026-01-15T10:00:00.000000+00:00',
          type: 'UNKNOWN_TYPE',
          subType: 'UNKNOWN_SUBTYPE',
          unifiedStatus: 'IN_PROGRESS', // Pending status
          amount: 50.00,
          amountSign: 'negative',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);

      // Mock manual categorization
      showManualTransactionCategorization.mockImplementation((transaction, callback) => {
        callback({
          merchant: 'Manual Merchant',
          category: { id: 'cat-1', name: 'Some Category' },
        });
      });

      const result = await fetchAndProcessCashTransactions(
        { ...mockCashAccount, includePendingTransactions: true },
        '2026-01-01',
        '2026-01-31',
      );

      expect(result).toHaveLength(1);
      expect(result[0].isPending).toBe(true);
      expect(result[0].unifiedStatus).toBe('IN_PROGRESS');
    });

    it('should always include ATM fee reimbursement transactions regardless of null status', async () => {
      // ATM reimbursements have status: null but should always be included
      const mockRawTransactions = [
        {
          externalCanonicalId: 'tx-atm-reimbursement',
          occurredAt: '2026-01-15T10:00:00.000000+00:00',
          type: 'REIMBURSEMENT',
          subType: 'ATM',
          status: null, // ATM reimbursements have null status
          unifiedStatus: null, // May also be null
          amount: 3.00,
          amountSign: 'positive',
        },
        {
          externalCanonicalId: 'tx-etransfer',
          occurredAt: '2026-01-16T10:00:00.000000+00:00',
          type: 'DEPOSIT',
          subType: 'E_TRANSFER',
          unifiedStatus: 'COMPLETED',
          eTransferName: 'John',
          amount: 100.00,
          amountSign: 'positive',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);

      const result = await fetchAndProcessCashTransactions(
        mockCashAccount,
        '2026-01-01',
        '2026-01-31',
      );

      // Should include both: ATM reimbursement (null status bypass) and e-transfer (COMPLETED)
      expect(result).toHaveLength(2);

      // ATM reimbursement should be processed correctly
      const atmTx = result.find((tx) => tx.id === 'tx-atm-reimbursement');
      expect(atmTx).toBeDefined();
      expect(atmTx.resolvedMonarchCategory).toBe('Cash & ATM');
      expect(atmTx.merchant).toBe('ATM Fee Reimbursement');
      expect(atmTx.originalMerchant).toBe('REIMBURSEMENT:ATM:ATM Fee Reimbursement');
      expect(atmTx.amount).toBe(3.00);
      expect(atmTx.ruleId).toBe('reimbursement-atm');
    });

    it('should include ATM fee reimbursement even when includePendingTransactions is false', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'tx-atm-reimbursement',
          occurredAt: '2026-01-15T10:00:00.000000+00:00',
          type: 'REIMBURSEMENT',
          subType: 'ATM',
          status: null,
          unifiedStatus: null,
          amount: 5.00,
          amountSign: 'positive',
        },
        {
          externalCanonicalId: 'tx-pending-etransfer',
          occurredAt: '2026-01-16T10:00:00.000000+00:00',
          type: 'DEPOSIT',
          subType: 'E_TRANSFER',
          unifiedStatus: 'IN_PROGRESS', // Pending - should be excluded
          eTransferName: 'Pending Person',
          amount: 50.00,
          amountSign: 'positive',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);

      const result = await fetchAndProcessCashTransactions(
        { ...mockCashAccount, includePendingTransactions: false },
        '2026-01-01',
        '2026-01-31',
      );

      // Should only include ATM reimbursement (pending e-transfer excluded)
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('tx-atm-reimbursement');
      expect(result[0].resolvedMonarchCategory).toBe('Cash & ATM');
    });
  });

});
