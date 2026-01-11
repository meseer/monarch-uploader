/**
 * Tests for Wealthsimple Transaction Service
 */

import {
  fetchAndProcessCreditCardTransactions,
  fetchAndProcessTransactions,
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
});
