/**
 * Tests for Wealthsimple Transaction Service
 */

import {
  fetchAndProcessCreditCardTransactions,
  fetchAndProcessTransactions,
  reconcilePendingTransactions,
  formatReconciliationMessage,
} from '../../../src/services/wealthsimple/transactions';
import wealthsimpleApi from '../../../src/api/wealthsimple';
import monarchApi from '../../../src/api/monarch';
import { applyWealthsimpleCategoryMapping } from '../../../src/mappers/category';

// Mock dependencies
jest.mock('../../../src/api/wealthsimple');
jest.mock('../../../src/api/monarch');
jest.mock('../../../src/mappers/category');
jest.mock('../../../src/ui/toast', () => ({
  show: jest.fn(),
}));

describe('Wealthsimple Transaction Service', () => {
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

  describe('fetchAndProcessCreditCardTransactions', () => {
    it('should fetch and process settled credit card transactions', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'tx-1',
          occurredAt: '2025-01-15T10:30:00.000000+00:00',
          type: 'CREDIT_CARD',
          subType: 'PURCHASE',
          status: 'settled',
          spendMerchant: 'Amazon',
          amount: 50.00,
          amountSign: 'negative',
        },
        {
          externalCanonicalId: 'tx-2',
          occurredAt: '2025-01-16T14:20:00.000000+00:00',
          type: 'CREDIT_CARD',
          subType: 'PAYMENT',
          status: 'settled',
          spendMerchant: null,
          amount: 100.00,
          amountSign: 'positive',
        },
        {
          externalCanonicalId: 'tx-3',
          occurredAt: '2025-01-17T09:00:00.000000+00:00',
          type: 'CREDIT_CARD',
          subType: 'PURCHASE',
          status: 'pending',
          spendMerchant: 'Starbucks',
          amount: 5.50,
          amountSign: 'negative',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);
      monarchApi.getCategoriesAndGroups.mockResolvedValue({
        categories: [
          { id: '1', name: 'Shopping', group: { name: 'Shopping' } },
        ],
      });
      applyWealthsimpleCategoryMapping.mockReturnValue('Shopping');

      const result = await fetchAndProcessCreditCardTransactions(
        mockConsolidatedAccount,
        '2025-01-01',
        '2025-01-31',
      );

      expect(wealthsimpleApi.fetchTransactions).toHaveBeenCalledWith(
        'test-account-id',
        '2025-01-01',
      );

      // Should only include settled transactions (2 out of 3)
      expect(result).toHaveLength(2);

      // Check first transaction (PURCHASE)
      expect(result[0]).toMatchObject({
        id: 'tx-1',
        date: '2025-01-15',
        amount: -50.00, // negative amountSign
        subType: 'PURCHASE',
        resolvedMonarchCategory: 'Shopping',
      });

      // Check second transaction (PAYMENT)
      expect(result[1]).toMatchObject({
        id: 'tx-2',
        date: '2025-01-16',
        amount: 100.00, // positive amountSign
        subType: 'PAYMENT',
        resolvedMonarchCategory: 'Credit Card Payment', // auto-category
      });
    });

    it('should apply merchant cleanup for non-PAYMENT transactions', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'tx-1',
          occurredAt: '2025-01-15T10:30:00.000000+00:00',
          type: 'CREDIT_CARD',
          subType: 'PURCHASE',
          status: 'settled',
          spendMerchant: 'TST-STARBUCKS #123',
          amount: 5.50,
          amountSign: 'negative',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);
      monarchApi.getCategoriesAndGroups.mockResolvedValue({
        categories: [],
      });
      applyWealthsimpleCategoryMapping.mockReturnValue('Coffee Shops');

      const result = await fetchAndProcessCreditCardTransactions(
        mockConsolidatedAccount,
        '2025-01-01',
        '2025-01-31',
      );

      // Merchant should be cleaned up (TST- prefix removed, title cased, store number stripped)
      expect(result[0].merchant).toBe('Starbucks');
      expect(result[0].originalMerchant).toBe('TST-STARBUCKS #123');
    });

    it('should auto-categorize CASH_WITHDRAWAL transactions', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'tx-1',
          occurredAt: '2025-01-15T10:30:00.000000+00:00',
          type: 'CREDIT_CARD',
          subType: 'CASH_WITHDRAWAL',
          status: 'settled',
          spendMerchant: 'ATM Withdrawal',
          amount: 40.00,
          amountSign: 'negative',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);
      monarchApi.getCategoriesAndGroups.mockResolvedValue({
        categories: [],
      });

      const result = await fetchAndProcessCreditCardTransactions(
        mockConsolidatedAccount,
        '2025-01-01',
        '2025-01-31',
      );

      expect(result[0].resolvedMonarchCategory).toBe('Cash & ATM');
    });

    it('should auto-categorize INTEREST transactions with custom merchant', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'tx-1',
          occurredAt: '2025-01-15T10:30:00.000000+00:00',
          type: 'CREDIT_CARD',
          subType: 'INTEREST',
          status: 'settled',
          spendMerchant: 'Some Interest Merchant',
          amount: 12.50,
          amountSign: 'negative',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);
      monarchApi.getCategoriesAndGroups.mockResolvedValue({
        categories: [],
      });

      const result = await fetchAndProcessCreditCardTransactions(
        mockConsolidatedAccount,
        '2025-01-01',
        '2025-01-31',
      );

      // Should auto-categorize to Financial Fees
      expect(result[0].resolvedMonarchCategory).toBe('Financial Fees');
      // Should override merchant to 'Cash Advance Interest'
      expect(result[0].merchant).toBe('Cash Advance Interest');
      expect(result[0].originalMerchant).toBe('Cash Advance Interest');
    });

    it('should handle REFUND transactions correctly', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'tx-1',
          occurredAt: '2025-01-15T10:30:00.000000+00:00',
          type: 'CREDIT_CARD',
          subType: 'REFUND',
          status: 'settled',
          spendMerchant: 'Amazon',
          amount: 25.00,
          amountSign: 'positive',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);
      monarchApi.getCategoriesAndGroups.mockResolvedValue({
        categories: [],
      });
      applyWealthsimpleCategoryMapping.mockReturnValue('Shopping');

      const result = await fetchAndProcessCreditCardTransactions(
        mockConsolidatedAccount,
        '2025-01-01',
        '2025-01-31',
      );

      expect(result[0].amount).toBe(25.00); // positive (credit)
      expect(result[0].subType).toBe('REFUND');
      expect(result[0].resolvedMonarchCategory).toBe('Shopping');
    });

    it('should return empty array when no syncable transactions found', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'tx-1',
          occurredAt: '2025-01-15T10:30:00.000000+00:00',
          type: 'CREDIT_CARD',
          subType: 'PURCHASE',
          status: 'pending', // Neither settled nor authorized
          spendMerchant: 'Test Merchant',
          amount: 10.00,
          amountSign: 'negative',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);

      const result = await fetchAndProcessCreditCardTransactions(
        mockConsolidatedAccount,
        '2025-01-01',
        '2025-01-31',
      );

      expect(result).toEqual([]);
    });

    it('should include authorized (pending) transactions when includePendingTransactions is true', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'tx-settled',
          occurredAt: '2025-01-15T10:30:00.000000+00:00',
          type: 'CREDIT_CARD',
          subType: 'PURCHASE',
          status: 'settled',
          spendMerchant: 'Settled Merchant',
          amount: 50.00,
          amountSign: 'negative',
        },
        {
          externalCanonicalId: 'tx-authorized',
          occurredAt: '2025-01-16T14:20:00.000000+00:00',
          type: 'CREDIT_CARD',
          subType: 'PURCHASE',
          status: 'authorized',
          spendMerchant: 'Pending Merchant',
          amount: 25.00,
          amountSign: 'negative',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);
      monarchApi.getCategoriesAndGroups.mockResolvedValue({ categories: [] });
      applyWealthsimpleCategoryMapping.mockReturnValue('Shopping');

      // Account with includePendingTransactions = true (default)
      const accountWithPending = {
        ...mockConsolidatedAccount,
        includePendingTransactions: true,
      };

      const result = await fetchAndProcessCreditCardTransactions(
        accountWithPending,
        '2025-01-01',
        '2025-01-31',
      );

      // Should include both settled and authorized transactions
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('tx-settled');
      expect(result[0].status).toBe('settled');
      expect(result[1].id).toBe('tx-authorized');
      expect(result[1].status).toBe('authorized');
    });

    it('should exclude authorized transactions when includePendingTransactions is false', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'tx-settled',
          occurredAt: '2025-01-15T10:30:00.000000+00:00',
          type: 'CREDIT_CARD',
          subType: 'PURCHASE',
          status: 'settled',
          spendMerchant: 'Settled Merchant',
          amount: 50.00,
          amountSign: 'negative',
        },
        {
          externalCanonicalId: 'tx-authorized',
          occurredAt: '2025-01-16T14:20:00.000000+00:00',
          type: 'CREDIT_CARD',
          subType: 'PURCHASE',
          status: 'authorized',
          spendMerchant: 'Pending Merchant',
          amount: 25.00,
          amountSign: 'negative',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);
      monarchApi.getCategoriesAndGroups.mockResolvedValue({ categories: [] });
      applyWealthsimpleCategoryMapping.mockReturnValue('Shopping');

      // Account with includePendingTransactions = false
      const accountWithoutPending = {
        ...mockConsolidatedAccount,
        includePendingTransactions: false,
      };

      const result = await fetchAndProcessCreditCardTransactions(
        accountWithoutPending,
        '2025-01-01',
        '2025-01-31',
      );

      // Should only include settled transactions
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('tx-settled');
      expect(result[0].status).toBe('settled');
    });

    it('should include pending transactions by default when includePendingTransactions is not set', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'tx-authorized',
          occurredAt: '2025-01-16T14:20:00.000000+00:00',
          type: 'CREDIT_CARD',
          subType: 'PURCHASE',
          status: 'authorized',
          spendMerchant: 'Pending Merchant',
          amount: 25.00,
          amountSign: 'negative',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);
      monarchApi.getCategoriesAndGroups.mockResolvedValue({ categories: [] });
      applyWealthsimpleCategoryMapping.mockReturnValue('Shopping');

      // Account without includePendingTransactions property (should default to true)
      const accountDefault = {
        wealthsimpleAccount: {
          id: 'test-account-id',
          nickname: 'Test Credit Card',
          type: 'CREDIT_CARD',
        },
      };

      const result = await fetchAndProcessCreditCardTransactions(
        accountDefault,
        '2025-01-01',
        '2025-01-31',
      );

      // Should include authorized transaction by default
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('tx-authorized');
      expect(result[0].status).toBe('authorized');
    });

    it('should process all settled transactions regardless of type', async () => {
      // Note: We no longer filter by transaction type, only by settled status.
      // This is because transactions are fetched per-account, so they're already
      // of the correct type for that account.
      const mockRawTransactions = [
        {
          externalCanonicalId: 'tx-1',
          occurredAt: '2025-01-15T10:30:00.000000+00:00',
          type: 'DEBIT',
          subType: 'PURCHASE',
          status: 'settled',
          spendMerchant: 'Test Merchant',
          amount: 10.00,
          amountSign: 'negative',
        },
        {
          externalCanonicalId: 'tx-2',
          occurredAt: '2025-01-16T10:30:00.000000+00:00',
          type: 'CREDIT_CARD',
          subType: 'PURCHASE',
          status: 'settled',
          spendMerchant: 'Valid Merchant',
          amount: 20.00,
          amountSign: 'negative',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);
      monarchApi.getCategoriesAndGroups.mockResolvedValue({
        categories: [],
      });
      applyWealthsimpleCategoryMapping.mockReturnValue('Shopping');

      const result = await fetchAndProcessCreditCardTransactions(
        mockConsolidatedAccount,
        '2025-01-01',
        '2025-01-31',
      );

      // Both settled transactions are processed (no type filtering)
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('tx-1');
      expect(result[1].id).toBe('tx-2');
    });

    it('should handle API errors gracefully', async () => {
      wealthsimpleApi.fetchTransactions.mockRejectedValue(new Error('API Error'));

      await expect(
        fetchAndProcessCreditCardTransactions(
          mockConsolidatedAccount,
          '2025-01-01',
          '2025-01-31',
        ),
      ).rejects.toThrow('API Error');
    });
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

    it('should return empty array for unsupported account types (CASH)', async () => {
      const cashAccount = {
        wealthsimpleAccount: {
          id: 'test-id',
          nickname: 'Cash Account',
          type: 'CA_CASH',
        },
      };

      const result = await fetchAndProcessTransactions(
        cashAccount,
        '2025-01-01',
        '2025-01-31',
      );

      expect(result).toEqual([]);
      expect(wealthsimpleApi.fetchTransactions).not.toHaveBeenCalled();
    });

    it('should return empty array for unsupported account types (TFSA)', async () => {
      const tfsaAccount = {
        wealthsimpleAccount: {
          id: 'test-id',
          nickname: 'TFSA',
          type: 'MANAGED_TFSA',
        },
      };

      const result = await fetchAndProcessTransactions(
        tfsaAccount,
        '2025-01-01',
        '2025-01-31',
      );

      expect(result).toEqual([]);
      expect(wealthsimpleApi.fetchTransactions).not.toHaveBeenCalled();
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

      // Should update transaction with settled amount and cleaned notes
      expect(monarchApi.updateTransaction).toHaveBeenCalledWith('monarch-tx-1', {
        amount: -52.00,
        notes: '',
      });

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
      expect(monarchApi.updateTransaction).toHaveBeenCalledWith('monarch-tx-1', {
        amount: -50.00,
        notes: 'My custom note',
      });
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
      expect(monarchApi.updateTransaction).toHaveBeenCalled();
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
          },
          {
            id: 'monarch-tx-2',
            amount: -25.00,
            date: '2025-01-11',
            notes: 'PURCHASE / credit-transaction-cancelled-one',
          },
          {
            id: 'monarch-tx-3',
            amount: -75.00,
            date: '2025-01-12',
            notes: 'PURCHASE / credit-transaction-still-pending',
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

      expect(monarchApi.updateTransaction).toHaveBeenCalledTimes(1);
      expect(monarchApi.deleteTransaction).toHaveBeenCalledTimes(1);
    });

    it('should continue processing if one transaction fails', async () => {
      monarchApi.getTagByName.mockResolvedValue({ id: mockPendingTagId, name: 'Pending' });
      monarchApi.getTransactionsList.mockResolvedValue({
        results: [
          {
            id: 'monarch-tx-1',
            amount: -50.00,
            date: '2025-01-10',
            notes: 'PURCHASE / credit-transaction-first',
          },
          {
            id: 'monarch-tx-2',
            amount: -25.00,
            date: '2025-01-11',
            notes: 'PURCHASE / credit-transaction-second',
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

      // Should continue despite first failure
      expect(result.settled).toBe(1);
      expect(monarchApi.updateTransaction).toHaveBeenCalledTimes(2);
    });
  });

  describe('formatReconciliationMessage', () => {
    it('should return "No pending transactions" when noPendingTag is true', () => {
      const result = formatReconciliationMessage({ noPendingTag: true });
      expect(result).toBe('No pending transactions');
    });

    it('should return "No pending transactions" when noPendingTransactions is true', () => {
      const result = formatReconciliationMessage({ noPendingTransactions: true });
      expect(result).toBe('No pending transactions');
    });

    it('should return "No pending transactions" when both settled and cancelled are 0', () => {
      const result = formatReconciliationMessage({ settled: 0, cancelled: 0 });
      expect(result).toBe('No pending transactions');
    });

    it('should format message with only settled count', () => {
      const result = formatReconciliationMessage({ settled: 3, cancelled: 0 });
      expect(result).toBe('3 settled');
    });

    it('should format message with only cancelled count', () => {
      const result = formatReconciliationMessage({ settled: 0, cancelled: 2 });
      expect(result).toBe('2 cancelled');
    });

    it('should format message with both settled and cancelled counts', () => {
      const result = formatReconciliationMessage({ settled: 3, cancelled: 2 });
      expect(result).toBe('3 settled, 2 cancelled');
    });
  });
});
