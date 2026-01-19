/**
 * Tests for Wealthsimple Transaction Service
 */

import {
  fetchAndProcessCreditCardTransactions,
  fetchAndProcessCashTransactions,
  fetchAndProcessLineOfCreditTransactions,
  fetchAndProcessInvestmentTransactions,
  fetchAndProcessTransactions,
  reconcilePendingTransactions,
  formatReconciliationMessage,
} from '../../../src/services/wealthsimple/transactions';
import wealthsimpleApi from '../../../src/api/wealthsimple';
import monarchApi from '../../../src/api/monarch';
import { applyWealthsimpleCategoryMapping } from '../../../src/mappers/category';
import { showManualTransactionCategorization, showMonarchCategorySelector } from '../../../src/ui/components/categorySelector';

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
      expect(result[0].originalMerchant).toMatch(/^CREDIT_CARD:[^:]*:TST-STARBUCKS #123$/);
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
      expect(result[0].originalMerchant).toMatch(/^CREDIT_CARD:[^:]*:Cash Advance Interest$/);
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

    it('should use one-time category selection (assignmentType=once) for only the specific transaction', async () => {
      // With "Assign Once", the category should ONLY apply to the specific transaction
      // Other transactions with the same merchant should NOT automatically get the category
      const mockRawTransactions = [
        {
          externalCanonicalId: 'tx-1',
          occurredAt: '2025-01-15T10:30:00.000000+00:00',
          type: 'CREDIT_CARD',
          subType: 'PURCHASE',
          status: 'settled',
          spendMerchant: 'New Unique Merchant',
          amount: 50.00,
          amountSign: 'negative',
        },
        {
          externalCanonicalId: 'tx-2',
          occurredAt: '2025-01-16T10:30:00.000000+00:00',
          type: 'CREDIT_CARD',
          subType: 'PURCHASE',
          status: 'settled',
          spendMerchant: 'New Unique Merchant', // Same merchant
          amount: 75.00,
          amountSign: 'negative',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);
      monarchApi.getCategoriesAndGroups.mockResolvedValue({
        categories: [
          { id: '1', name: 'Shopping', group: { id: 'g1', name: 'Expenses' } },
          { id: '2', name: 'Food', group: { id: 'g2', name: 'Expenses' } },
        ],
        categoryGroups: [],
      });

      // First call returns needsManualSelection, subsequent calls should still return needsManualSelection
      // because "Assign Once" doesn't save to persistent storage
      applyWealthsimpleCategoryMapping
        .mockReturnValueOnce({
          needsManualSelection: true,
          bankCategory: 'New Unique Merchant',
          suggestedCategory: 'Shopping',
          similarityScore: 0.5,
        })
        // Re-check during processing (still needsManualSelection since not saved)
        .mockReturnValueOnce({
          needsManualSelection: true,
          bankCategory: 'New Unique Merchant',
          suggestedCategory: 'Shopping',
          similarityScore: 0.5,
        })
        // Final resolution also indicates no saved mapping (assignmentType=once doesn't save)
        .mockReturnValue({
          needsManualSelection: true,
          bankCategory: 'New Unique Merchant',
          suggestedCategory: 'Shopping',
          similarityScore: 0.5,
        });

      // Mock the category selector to return selection with assignmentType='once'
      showMonarchCategorySelector.mockImplementation((bankCategory, callback) => {
        callback({
          id: '2',
          name: 'Food',
          assignmentType: 'once', // User clicked "Assign Once" button
        });
      });

      const result = await fetchAndProcessCreditCardTransactions(
        mockConsolidatedAccount,
        '2025-01-01',
        '2025-01-31',
      );

      // With "Assign Once":
      // - First transaction (tx-1) gets "Food" (the one user selected for)
      // - Second transaction (tx-2) gets "Uncategorized" (NOT automatically assigned)
      // This is the intended behavior - "Assign Once" means ONLY that transaction
      expect(result).toHaveLength(2);
      expect(result[0].resolvedMonarchCategory).toBe('Food');
      expect(result[1].resolvedMonarchCategory).toBe('Uncategorized');

      // Should only show selector once (for unique merchant - deduplication still happens)
      expect(showMonarchCategorySelector).toHaveBeenCalledTimes(1);
    });

    it('should apply category to all matching merchants when assignmentType=rule', async () => {
      // With "Save as Rule", the category should apply to ALL transactions with the same merchant
      const mockRawTransactions = [
        {
          externalCanonicalId: 'tx-1',
          occurredAt: '2025-01-15T10:30:00.000000+00:00',
          type: 'CREDIT_CARD',
          subType: 'PURCHASE',
          status: 'settled',
          spendMerchant: 'New Unique Merchant',
          amount: 50.00,
          amountSign: 'negative',
        },
        {
          externalCanonicalId: 'tx-2',
          occurredAt: '2025-01-16T10:30:00.000000+00:00',
          type: 'CREDIT_CARD',
          subType: 'PURCHASE',
          status: 'settled',
          spendMerchant: 'New Unique Merchant', // Same merchant
          amount: 75.00,
          amountSign: 'negative',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);
      monarchApi.getCategoriesAndGroups.mockResolvedValue({
        categories: [
          { id: '1', name: 'Shopping', group: { id: 'g1', name: 'Expenses' } },
          { id: '2', name: 'Food', group: { id: 'g2', name: 'Expenses' } },
        ],
        categoryGroups: [],
      });

      // First call returns needsManualSelection
      applyWealthsimpleCategoryMapping
        .mockReturnValueOnce({
          needsManualSelection: true,
          bankCategory: 'New Unique Merchant',
          suggestedCategory: 'Shopping',
          similarityScore: 0.5,
        })
        // Re-check - still needsManualSelection before user picks
        .mockReturnValueOnce({
          needsManualSelection: true,
          bankCategory: 'New Unique Merchant',
          suggestedCategory: 'Shopping',
          similarityScore: 0.5,
        })
        // Final resolution - with 'rule' type, mapping is saved so this returns saved value
        .mockReturnValue('Food');

      // Mock the category selector to return selection with assignmentType='rule'
      showMonarchCategorySelector.mockImplementation((bankCategory, callback) => {
        callback({
          id: '2',
          name: 'Food',
          assignmentType: 'rule', // User clicked "Save as Rule" button
        });
      });

      const result = await fetchAndProcessCreditCardTransactions(
        mockConsolidatedAccount,
        '2025-01-01',
        '2025-01-31',
      );

      // With "Save as Rule":
      // - Both transactions get "Food" (applied to all matching merchants)
      expect(result).toHaveLength(2);
      expect(result[0].resolvedMonarchCategory).toBe('Food');
      expect(result[1].resolvedMonarchCategory).toBe('Food');

      // Should only show selector once (for unique merchant)
      expect(showMonarchCategorySelector).toHaveBeenCalledTimes(1);
    });

    it('should save category selection when rememberMapping=true', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'tx-1',
          occurredAt: '2025-01-15T10:30:00.000000+00:00',
          type: 'CREDIT_CARD',
          subType: 'PURCHASE',
          status: 'settled',
          spendMerchant: 'Another Merchant',
          amount: 50.00,
          amountSign: 'negative',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);
      monarchApi.getCategoriesAndGroups.mockResolvedValue({
        categories: [
          { id: '1', name: 'Shopping', group: { id: 'g1', name: 'Expenses' } },
        ],
        categoryGroups: [],
      });

      // Return needsManualSelection first, then the saved mapping after save
      applyWealthsimpleCategoryMapping
        .mockReturnValueOnce({
          needsManualSelection: true,
          bankCategory: 'Another Merchant',
          suggestedCategory: 'Shopping',
          similarityScore: 0.5,
        })
        // After saving, the mapping should be found
        .mockReturnValue('Shopping');

      // Mock the category selector to return selection with rememberMapping=true (or undefined/default)
      showMonarchCategorySelector.mockImplementation((bankCategory, callback) => {
        callback({
          id: '1',
          name: 'Shopping',
          // rememberMapping: true is the default when not false
        });
      });

      const result = await fetchAndProcessCreditCardTransactions(
        mockConsolidatedAccount,
        '2025-01-01',
        '2025-01-31',
      );

      // Transaction should have the selected category
      expect(result).toHaveLength(1);
      expect(result[0].resolvedMonarchCategory).toBe('Shopping');
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

  describe('fetchAndProcessLineOfCreditTransactions', () => {
    const mockLocAccount = {
      wealthsimpleAccount: {
        id: 'loc-account-id',
        nickname: 'Portfolio Line of Credit',
        type: 'PORTFOLIO_LINE_OF_CREDIT',
      },
    };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should auto-categorize INTERNAL_TRANSFER/SOURCE as borrow from LOC', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'loc-borrow-1',
          occurredAt: '2026-01-15T10:30:00.000000+00:00',
          type: 'INTERNAL_TRANSFER',
          subType: 'SOURCE',
          status: 'completed',
          amount: 5000.00,
          amountSign: 'negative',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);

      const result = await fetchAndProcessLineOfCreditTransactions(
        mockLocAccount,
        '2026-01-01',
        '2026-01-31',
      );

      // Should NOT call manual categorization (rule matched)
      expect(showManualTransactionCategorization).not.toHaveBeenCalled();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'loc-borrow-1',
        date: '2026-01-15',
        merchant: 'Borrow from Portfolio Line of Credit',
        originalMerchant: 'INTERNAL_TRANSFER:SOURCE:Borrow from Portfolio Line of Credit',
        amount: -5000.00,
        resolvedMonarchCategory: 'Transfer',
        ruleId: 'loc-borrow',
        isPending: false,
      });
    });

    it('should auto-categorize INTERNAL_TRANSFER/DESTINATION as repayment to LOC', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'loc-repay-1',
          occurredAt: '2026-01-16T10:30:00.000000+00:00',
          type: 'INTERNAL_TRANSFER',
          subType: 'DESTINATION',
          status: 'completed',
          amount: 1000.00,
          amountSign: 'positive',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);

      const result = await fetchAndProcessLineOfCreditTransactions(
        mockLocAccount,
        '2026-01-01',
        '2026-01-31',
      );

      // Should NOT call manual categorization (rule matched)
      expect(showManualTransactionCategorization).not.toHaveBeenCalled();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'loc-repay-1',
        merchant: 'Repayment to Portfolio Line of Credit',
        originalMerchant: 'INTERNAL_TRANSFER:DESTINATION:Repayment to Portfolio Line of Credit',
        amount: 1000.00,
        resolvedMonarchCategory: 'Loan Repayment',
        ruleId: 'loc-repay',
      });
    });

    it('should process unknown transaction types via manual categorization', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'loc-unknown-1',
          occurredAt: '2026-01-15T10:30:00.000000+00:00',
          type: 'INTEREST',
          subType: 'MARGIN_INTEREST',
          status: 'completed',
          amount: 50.00,
          amountSign: 'negative',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);

      // Mock manual categorization - user provides merchant and category
      showManualTransactionCategorization.mockImplementation((transaction, callback) => {
        callback({
          merchant: 'Margin Interest',
          category: { id: '1', name: 'Financial Fees' },
        });
      });

      const result = await fetchAndProcessLineOfCreditTransactions(
        mockLocAccount,
        '2026-01-01',
        '2026-01-31',
      );

      // Should have called manual categorization for unknown type
      expect(showManualTransactionCategorization).toHaveBeenCalledTimes(1);
      expect(showManualTransactionCategorization).toHaveBeenCalledWith(
        expect.objectContaining({
          externalCanonicalId: 'loc-unknown-1',
          type: 'INTEREST',
        }),
        expect.any(Function),
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'loc-unknown-1',
        merchant: 'Margin Interest',
        resolvedMonarchCategory: 'Financial Fees',
        ruleId: 'manual',
      });
    });

    it('should filter by status - settled, completed, and authorized only', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'loc-completed',
          occurredAt: '2026-01-15T10:30:00.000000+00:00',
          type: 'INTERNAL_TRANSFER',
          subType: 'SOURCE',
          status: 'completed', // Should be included
          amount: 5000.00,
          amountSign: 'negative',
        },
        {
          externalCanonicalId: 'loc-settled',
          occurredAt: '2026-01-16T10:30:00.000000+00:00',
          type: 'INTERNAL_TRANSFER',
          subType: 'DESTINATION',
          status: 'settled', // Should be included
          amount: 1000.00,
          amountSign: 'positive',
        },
        {
          externalCanonicalId: 'loc-authorized',
          occurredAt: '2026-01-17T10:30:00.000000+00:00',
          type: 'INTERNAL_TRANSFER',
          subType: 'SOURCE',
          status: 'authorized', // Should be included (pending)
          amount: 2000.00,
          amountSign: 'negative',
        },
        {
          externalCanonicalId: 'loc-pending',
          occurredAt: '2026-01-18T10:30:00.000000+00:00',
          type: 'INTERNAL_TRANSFER',
          subType: 'SOURCE',
          status: 'pending', // Should be excluded
          amount: 3000.00,
          amountSign: 'negative',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);

      const result = await fetchAndProcessLineOfCreditTransactions(
        { ...mockLocAccount, includePendingTransactions: true },
        '2026-01-01',
        '2026-01-31',
      );

      // Should include completed, settled, and authorized; exclude pending
      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('loc-completed');
      expect(result[0].isPending).toBe(false);
      expect(result[1].id).toBe('loc-settled');
      expect(result[1].isPending).toBe(false);
      expect(result[2].id).toBe('loc-authorized');
      expect(result[2].isPending).toBe(true);
    });

    it('should exclude authorized transactions when includePendingTransactions is false', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'loc-completed',
          occurredAt: '2026-01-15T10:30:00.000000+00:00',
          type: 'INTERNAL_TRANSFER',
          subType: 'SOURCE',
          status: 'completed',
          amount: 5000.00,
          amountSign: 'negative',
        },
        {
          externalCanonicalId: 'loc-authorized',
          occurredAt: '2026-01-16T10:30:00.000000+00:00',
          type: 'INTERNAL_TRANSFER',
          subType: 'DESTINATION',
          status: 'authorized',
          amount: 1000.00,
          amountSign: 'positive',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);

      const result = await fetchAndProcessLineOfCreditTransactions(
        { ...mockLocAccount, includePendingTransactions: false },
        '2026-01-01',
        '2026-01-31',
      );

      // Should only include completed/settled
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('loc-completed');
    });

    it('should handle negative amounts correctly for borrow transactions', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'loc-borrow',
          occurredAt: '2026-01-15T10:30:00.000000+00:00',
          type: 'INTERNAL_TRANSFER',
          subType: 'SOURCE',
          status: 'completed',
          amount: 1000.00,
          amountSign: 'negative', // Borrowing shows as negative (money leaving LOC)
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);

      const result = await fetchAndProcessLineOfCreditTransactions(
        mockLocAccount,
        '2026-01-01',
        '2026-01-31',
      );

      expect(result).toHaveLength(1);
      expect(result[0].amount).toBe(-1000.00); // Negative for borrow
    });

    it('should throw error when user cancels manual categorization', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'loc-unknown',
          occurredAt: '2026-01-15T10:30:00.000000+00:00',
          type: 'FEE',
          subType: 'ADMIN_FEE',
          status: 'completed',
          amount: 25.00,
          amountSign: 'negative',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);

      // User cancels
      showManualTransactionCategorization.mockImplementation((transaction, callback) => {
        callback(null);
      });

      await expect(
        fetchAndProcessLineOfCreditTransactions(
          mockLocAccount,
          '2026-01-01',
          '2026-01-31',
        ),
      ).rejects.toThrow('Manual categorization cancelled');
    });

    it('should return empty array when no transactions found', async () => {
      wealthsimpleApi.fetchTransactions.mockResolvedValue([]);

      const result = await fetchAndProcessLineOfCreditTransactions(
        mockLocAccount,
        '2026-01-01',
        '2026-01-31',
      );

      expect(result).toEqual([]);
      expect(showManualTransactionCategorization).not.toHaveBeenCalled();
    });

    it('should skip already-uploaded completed transactions', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'loc-already-uploaded',
          occurredAt: '2026-01-15T10:30:00.000000+00:00',
          type: 'INTERNAL_TRANSFER',
          subType: 'SOURCE',
          status: 'completed',
          amount: 5000.00,
          amountSign: 'negative',
        },
        {
          externalCanonicalId: 'loc-new',
          occurredAt: '2026-01-16T10:30:00.000000+00:00',
          type: 'INTERNAL_TRANSFER',
          subType: 'DESTINATION',
          status: 'completed',
          amount: 1000.00,
          amountSign: 'positive',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);

      // Pass already-uploaded IDs
      const uploadedIds = new Set(['loc-already-uploaded']);

      const result = await fetchAndProcessLineOfCreditTransactions(
        mockLocAccount,
        '2026-01-01',
        '2026-01-31',
        { uploadedTransactionIds: uploadedIds },
      );

      // Should only process the new transaction
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('loc-new');
    });

    it('should handle API errors gracefully', async () => {
      wealthsimpleApi.fetchTransactions.mockRejectedValue(new Error('API Error'));

      await expect(
        fetchAndProcessLineOfCreditTransactions(
          mockLocAccount,
          '2026-01-01',
          '2026-01-31',
        ),
      ).rejects.toThrow('API Error');
    });

    it('should use provided raw transactions if passed in options', async () => {
      const providedTransactions = [
        {
          externalCanonicalId: 'loc-provided',
          occurredAt: '2026-01-15T10:30:00.000000+00:00',
          type: 'INTERNAL_TRANSFER',
          subType: 'SOURCE',
          status: 'completed',
          amount: 3000.00,
          amountSign: 'negative',
        },
      ];

      const result = await fetchAndProcessLineOfCreditTransactions(
        mockLocAccount,
        '2026-01-01',
        '2026-01-31',
        { rawTransactions: providedTransactions },
      );

      // Should NOT call API since transactions were provided
      expect(wealthsimpleApi.fetchTransactions).not.toHaveBeenCalled();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('loc-provided');
      expect(result[0].merchant).toBe('Borrow from Portfolio Line of Credit');
    });

    it('should process mix of rule-matched and manual categorization transactions', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'loc-borrow',
          occurredAt: '2026-01-15T10:30:00.000000+00:00',
          type: 'INTERNAL_TRANSFER',
          subType: 'SOURCE',
          status: 'completed',
          amount: 5000.00,
          amountSign: 'negative',
        },
        {
          externalCanonicalId: 'loc-interest',
          occurredAt: '2026-01-16T10:30:00.000000+00:00',
          type: 'INTEREST',
          subType: 'MARGIN_INTEREST',
          status: 'completed',
          amount: 25.00,
          amountSign: 'negative',
        },
        {
          externalCanonicalId: 'loc-repay',
          occurredAt: '2026-01-17T10:30:00.000000+00:00',
          type: 'INTERNAL_TRANSFER',
          subType: 'DESTINATION',
          status: 'completed',
          amount: 1000.00,
          amountSign: 'positive',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);

      // Mock manual categorization for the interest transaction
      showManualTransactionCategorization.mockImplementation((transaction, callback) => {
        callback({
          merchant: 'Interest Charge',
          category: { id: '1', name: 'Financial Fees' },
        });
      });

      const result = await fetchAndProcessLineOfCreditTransactions(
        mockLocAccount,
        '2026-01-01',
        '2026-01-31',
      );

      expect(result).toHaveLength(3);

      // Borrow - auto-categorized
      expect(result[0]).toMatchObject({
        id: 'loc-borrow',
        merchant: 'Borrow from Portfolio Line of Credit',
        resolvedMonarchCategory: 'Transfer',
        ruleId: 'loc-borrow',
      });

      // Repay - auto-categorized
      expect(result[1]).toMatchObject({
        id: 'loc-repay',
        merchant: 'Repayment to Portfolio Line of Credit',
        resolvedMonarchCategory: 'Loan Repayment',
        ruleId: 'loc-repay',
      });

      // Interest - manually categorized
      expect(result[2]).toMatchObject({
        id: 'loc-interest',
        merchant: 'Interest Charge',
        resolvedMonarchCategory: 'Financial Fees',
        ruleId: 'manual',
      });

      // Manual categorization called only for interest
      expect(showManualTransactionCategorization).toHaveBeenCalledTimes(1);
    });
  });

  describe('fetchAndProcessInvestmentTransactions', () => {
    const mockInvestmentAccount = {
      wealthsimpleAccount: {
        id: 'investment-account-id',
        nickname: 'My TFSA',
        type: 'MANAGED_TFSA',
      },
    };

    beforeEach(() => {
      jest.clearAllMocks();
      // Mock GM_getValue for account name lookup in internal transfer rule
      global.GM_getValue = jest.fn().mockReturnValue(JSON.stringify([
        {
          wealthsimpleAccount: {
            id: 'investment-account-id',
            nickname: 'My TFSA',
            type: 'MANAGED_TFSA',
          },
        },
        {
          wealthsimpleAccount: {
            id: 'cash-account-id',
            nickname: 'Cash Account',
            type: 'CASH',
          },
        },
      ]));
    });

    it('should auto-categorize INTERNAL_TRANSFER/SOURCE as transfer out', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'funding_intent-transfer-out-1',
          occurredAt: '2026-01-15T10:30:00.000000+00:00',
          type: 'INTERNAL_TRANSFER',
          subType: 'SOURCE',
          status: 'completed',
          accountId: 'investment-account-id',
          opposingAccountId: 'cash-account-id',
          amount: 500.00,
          amountSign: 'negative',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);
      wealthsimpleApi.fetchInternalTransfer.mockResolvedValue({ annotation: '' });

      const result = await fetchAndProcessInvestmentTransactions(
        mockInvestmentAccount,
        '2026-01-01',
        '2026-01-31',
      );

      // Should NOT call manual categorization (rule matched)
      expect(showManualTransactionCategorization).not.toHaveBeenCalled();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'funding_intent-transfer-out-1',
        date: '2026-01-15',
        merchant: 'Transfer Out: My TFSA → Cash Account',
        originalMerchant: 'INTERNAL_TRANSFER:SOURCE:Transfer Out: My TFSA → Cash Account',
        amount: -500.00,
        resolvedMonarchCategory: 'Transfer',
        ruleId: 'internal-transfer',
        isPending: false,
      });
    });

    it('should auto-categorize INTERNAL_TRANSFER/DESTINATION as transfer in', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'funding_intent-transfer-in-1',
          occurredAt: '2026-01-16T10:30:00.000000+00:00',
          type: 'INTERNAL_TRANSFER',
          subType: 'DESTINATION',
          status: 'completed',
          accountId: 'investment-account-id',
          opposingAccountId: 'cash-account-id',
          amount: 1000.00,
          amountSign: 'positive',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);
      wealthsimpleApi.fetchInternalTransfer.mockResolvedValue({ annotation: '' });

      const result = await fetchAndProcessInvestmentTransactions(
        mockInvestmentAccount,
        '2026-01-01',
        '2026-01-31',
      );

      // Should NOT call manual categorization (rule matched)
      expect(showManualTransactionCategorization).not.toHaveBeenCalled();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'funding_intent-transfer-in-1',
        merchant: 'Transfer In: My TFSA ← Cash Account',
        originalMerchant: 'INTERNAL_TRANSFER:DESTINATION:Transfer In: My TFSA ← Cash Account',
        amount: 1000.00,
        resolvedMonarchCategory: 'Transfer',
        ruleId: 'internal-transfer',
      });
    });

    it('should include annotation from internal transfer data in notes', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'funding_intent-transfer-with-note',
          occurredAt: '2026-01-15T10:30:00.000000+00:00',
          type: 'INTERNAL_TRANSFER',
          subType: 'DESTINATION',
          status: 'completed',
          accountId: 'investment-account-id',
          opposingAccountId: 'cash-account-id',
          amount: 500.00,
          amountSign: 'positive',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);
      wealthsimpleApi.fetchInternalTransfer.mockResolvedValue({
        annotation: 'Monthly contribution',
      });

      const result = await fetchAndProcessInvestmentTransactions(
        mockInvestmentAccount,
        '2026-01-01',
        '2026-01-31',
      );

      expect(result).toHaveLength(1);
      expect(result[0].notes).toBe('Transfer of CAD$500\nMonthly contribution');
    });

    it('should process unknown transaction types via manual categorization', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'tx-unknown-type-1',
          occurredAt: '2026-01-15T10:30:00.000000+00:00',
          type: 'UNKNOWN_TYPE',
          subType: 'UNKNOWN_SUBTYPE', // Truly unknown type - no rule exists for this
          status: 'completed',
          amount: 25.00,
          amountSign: 'negative',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);

      // Mock manual categorization
      showManualTransactionCategorization.mockImplementation((transaction, callback) => {
        callback({
          merchant: 'Unknown Transaction',
          category: { id: '1', name: 'Miscellaneous' },
        });
      });

      const result = await fetchAndProcessInvestmentTransactions(
        mockInvestmentAccount,
        '2026-01-01',
        '2026-01-31',
      );

      // Should have called manual categorization
      expect(showManualTransactionCategorization).toHaveBeenCalledTimes(1);
      expect(showManualTransactionCategorization).toHaveBeenCalledWith(
        expect.objectContaining({
          externalCanonicalId: 'tx-unknown-type-1',
          type: 'UNKNOWN_TYPE',
        }),
        expect.any(Function),
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'tx-unknown-type-1',
        merchant: 'Unknown Transaction',
        resolvedMonarchCategory: 'Miscellaneous',
        ruleId: 'manual',
      });
    });

    it('should process mix of rule-matched and manual categorization transactions', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'funding_intent-transfer-in',
          occurredAt: '2026-01-15T10:30:00.000000+00:00',
          type: 'INTERNAL_TRANSFER',
          subType: 'DESTINATION',
          status: 'completed',
          accountId: 'investment-account-id',
          opposingAccountId: 'cash-account-id',
          amount: 1000.00,
          amountSign: 'positive',
        },
        {
          externalCanonicalId: 'tx-unknown-type',
          occurredAt: '2026-01-16T10:30:00.000000+00:00',
          type: 'UNKNOWN_TYPE',
          subType: 'UNKNOWN_SUBTYPE', // Truly unknown type - no rule exists
          status: 'completed',
          amount: 25.00,
          amountSign: 'negative',
        },
        {
          externalCanonicalId: 'funding_intent-transfer-out',
          occurredAt: '2026-01-17T10:30:00.000000+00:00',
          type: 'INTERNAL_TRANSFER',
          subType: 'SOURCE',
          status: 'completed',
          accountId: 'investment-account-id',
          opposingAccountId: 'cash-account-id',
          amount: 500.00,
          amountSign: 'negative',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);
      wealthsimpleApi.fetchInternalTransfer.mockResolvedValue({ annotation: '' });

      // Mock manual categorization for the unknown type transaction
      showManualTransactionCategorization.mockImplementation((transaction, callback) => {
        callback({
          merchant: 'Unknown Transaction',
          category: { id: '1', name: 'Miscellaneous' },
        });
      });

      const result = await fetchAndProcessInvestmentTransactions(
        mockInvestmentAccount,
        '2026-01-01',
        '2026-01-31',
      );

      expect(result).toHaveLength(3);

      // Transfer in - auto-categorized
      expect(result[0]).toMatchObject({
        id: 'funding_intent-transfer-in',
        merchant: 'Transfer In: My TFSA ← Cash Account',
        resolvedMonarchCategory: 'Transfer',
        ruleId: 'internal-transfer',
      });

      // Transfer out - auto-categorized
      expect(result[1]).toMatchObject({
        id: 'funding_intent-transfer-out',
        merchant: 'Transfer Out: My TFSA → Cash Account',
        resolvedMonarchCategory: 'Transfer',
        ruleId: 'internal-transfer',
      });

      // Unknown type - manually categorized
      expect(result[2]).toMatchObject({
        id: 'tx-unknown-type',
        merchant: 'Unknown Transaction',
        resolvedMonarchCategory: 'Miscellaneous',
        ruleId: 'manual',
      });

      // Manual categorization called only for the unknown type
      expect(showManualTransactionCategorization).toHaveBeenCalledTimes(1);
    });

    it('should throw error when user cancels manual categorization', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'tx-unknown',
          occurredAt: '2026-01-15T10:30:00.000000+00:00',
          type: 'UNKNOWN_TYPE',
          subType: 'UNKNOWN_SUBTYPE', // Truly unknown type - no rule exists
          status: 'completed',
          amount: 10.00,
          amountSign: 'negative',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);

      // User cancels
      showManualTransactionCategorization.mockImplementation((transaction, callback) => {
        callback(null);
      });

      await expect(
        fetchAndProcessInvestmentTransactions(
          mockInvestmentAccount,
          '2026-01-01',
          '2026-01-31',
        ),
      ).rejects.toThrow('Manual categorization cancelled');
    });

    it('should return empty array when no transactions found', async () => {
      wealthsimpleApi.fetchTransactions.mockResolvedValue([]);

      const result = await fetchAndProcessInvestmentTransactions(
        mockInvestmentAccount,
        '2026-01-01',
        '2026-01-31',
      );

      expect(result).toEqual([]);
      expect(showManualTransactionCategorization).not.toHaveBeenCalled();
    });

    it('should skip already-uploaded completed transactions', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'funding_intent-already-uploaded',
          occurredAt: '2026-01-15T10:30:00.000000+00:00',
          type: 'INTERNAL_TRANSFER',
          subType: 'DESTINATION',
          status: 'completed',
          accountId: 'investment-account-id',
          opposingAccountId: 'cash-account-id',
          amount: 500.00,
          amountSign: 'positive',
        },
        {
          externalCanonicalId: 'funding_intent-new',
          occurredAt: '2026-01-16T10:30:00.000000+00:00',
          type: 'INTERNAL_TRANSFER',
          subType: 'SOURCE',
          status: 'completed',
          accountId: 'investment-account-id',
          opposingAccountId: 'cash-account-id',
          amount: 200.00,
          amountSign: 'negative',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);
      wealthsimpleApi.fetchInternalTransfer.mockResolvedValue({ annotation: '' });

      // Pass already-uploaded IDs
      const uploadedIds = new Set(['funding_intent-already-uploaded']);

      const result = await fetchAndProcessInvestmentTransactions(
        mockInvestmentAccount,
        '2026-01-01',
        '2026-01-31',
        { uploadedTransactionIds: uploadedIds },
      );

      // Should only process the new transaction
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('funding_intent-new');
    });

    it('should handle API errors gracefully', async () => {
      wealthsimpleApi.fetchTransactions.mockRejectedValue(new Error('API Error'));

      await expect(
        fetchAndProcessInvestmentTransactions(
          mockInvestmentAccount,
          '2026-01-01',
          '2026-01-31',
        ),
      ).rejects.toThrow('API Error');
    });

    it('should use provided raw transactions if passed in options', async () => {
      const providedTransactions = [
        {
          externalCanonicalId: 'funding_intent-provided',
          occurredAt: '2026-01-15T10:30:00.000000+00:00',
          type: 'INTERNAL_TRANSFER',
          subType: 'DESTINATION',
          status: 'completed',
          accountId: 'investment-account-id',
          opposingAccountId: 'cash-account-id',
          amount: 750.00,
          amountSign: 'positive',
        },
      ];

      wealthsimpleApi.fetchInternalTransfer.mockResolvedValue({ annotation: '' });

      const result = await fetchAndProcessInvestmentTransactions(
        mockInvestmentAccount,
        '2026-01-01',
        '2026-01-31',
        { rawTransactions: providedTransactions },
      );

      // Should NOT call API since transactions were provided
      expect(wealthsimpleApi.fetchTransactions).not.toHaveBeenCalled();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('funding_intent-provided');
      expect(result[0].merchant).toBe('Transfer In: My TFSA ← Cash Account');
      expect(result[0].resolvedMonarchCategory).toBe('Transfer');
    });

    it('should filter by status - settled, completed, and authorized only', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'funding_intent-completed',
          occurredAt: '2026-01-15T10:30:00.000000+00:00',
          type: 'INTERNAL_TRANSFER',
          subType: 'DESTINATION',
          status: 'completed',
          accountId: 'investment-account-id',
          opposingAccountId: 'cash-account-id',
          amount: 500.00,
          amountSign: 'positive',
        },
        {
          externalCanonicalId: 'funding_intent-settled',
          occurredAt: '2026-01-16T10:30:00.000000+00:00',
          type: 'INTERNAL_TRANSFER',
          subType: 'SOURCE',
          status: 'settled',
          accountId: 'investment-account-id',
          opposingAccountId: 'cash-account-id',
          amount: 200.00,
          amountSign: 'negative',
        },
        {
          externalCanonicalId: 'funding_intent-pending',
          occurredAt: '2026-01-17T10:30:00.000000+00:00',
          type: 'INTERNAL_TRANSFER',
          subType: 'DESTINATION',
          status: 'pending', // Should be excluded
          accountId: 'investment-account-id',
          opposingAccountId: 'cash-account-id',
          amount: 100.00,
          amountSign: 'positive',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);
      wealthsimpleApi.fetchInternalTransfer.mockResolvedValue({ annotation: '' });

      const result = await fetchAndProcessInvestmentTransactions(
        { ...mockInvestmentAccount, includePendingTransactions: true },
        '2026-01-01',
        '2026-01-31',
      );

      // Should include completed and settled; exclude pending
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('funding_intent-completed');
      expect(result[1].id).toBe('funding_intent-settled');
    });

    it('should include authorized transactions as pending when includePendingTransactions is true', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'funding_intent-authorized',
          occurredAt: '2026-01-15T10:30:00.000000+00:00',
          type: 'INTERNAL_TRANSFER',
          subType: 'DESTINATION',
          status: 'authorized',
          accountId: 'investment-account-id',
          opposingAccountId: 'cash-account-id',
          amount: 500.00,
          amountSign: 'positive',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);
      wealthsimpleApi.fetchInternalTransfer.mockResolvedValue({ annotation: '' });

      const result = await fetchAndProcessInvestmentTransactions(
        { ...mockInvestmentAccount, includePendingTransactions: true },
        '2026-01-01',
        '2026-01-31',
      );

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('funding_intent-authorized');
      expect(result[0].isPending).toBe(true);
    });
  });

  describe('reconcilePendingTransactions - investment accounts', () => {
    const mockMonarchAccountId = 'monarch-investment-123';
    const mockPendingTagId = 'pending-tag-456';

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should reconcile investment account transactions using unifiedStatus field', async () => {
      monarchApi.getTagByName.mockResolvedValue({ id: mockPendingTagId, name: 'Pending' });
      monarchApi.getTransactionsList.mockResolvedValue({
        results: [
          {
            id: 'monarch-tx-1',
            amount: -100.00,
            date: '2026-01-10',
            notes: 'ws-tx:diy-buy-order-123',
            ownedByUser: { id: 'user-123' },
          },
        ],
      });
      monarchApi.updateTransaction.mockResolvedValue({});
      monarchApi.setTransactionTags.mockResolvedValue({});

      // Investment buy transaction uses unifiedStatus, not status
      const wealthsimpleTransactions = [
        {
          externalCanonicalId: 'diy-buy-order-123',
          type: 'DIY_BUY',
          status: null, // Investment orders often have null status
          unifiedStatus: 'COMPLETED',
          amount: 100.00,
          amountSign: 'negative',
        },
      ];

      const result = await reconcilePendingTransactions(
        mockMonarchAccountId,
        wealthsimpleTransactions,
        30,
        'SELF_DIRECTED_TFSA', // Investment account type
      );

      expect(result.success).toBe(true);
      expect(result.settled).toBe(1);
      expect(result.cancelled).toBe(0);
      expect(monarchApi.updateTransaction).toHaveBeenCalled();
      expect(monarchApi.setTransactionTags).toHaveBeenCalledWith('monarch-tx-1', []);
    });

    it('should skip investment transaction when unifiedStatus is IN_PROGRESS', async () => {
      monarchApi.getTagByName.mockResolvedValue({ id: mockPendingTagId, name: 'Pending' });
      monarchApi.getTransactionsList.mockResolvedValue({
        results: [
          {
            id: 'monarch-tx-1',
            amount: -50.00,
            date: '2026-01-10',
            notes: 'ws-tx:diy-buy-order-pending',
            ownedByUser: { id: 'user-123' },
          },
        ],
      });

      const wealthsimpleTransactions = [
        {
          externalCanonicalId: 'diy-buy-order-pending',
          type: 'DIY_BUY',
          status: null,
          unifiedStatus: 'IN_PROGRESS', // Still pending
          amount: 50.00,
          amountSign: 'negative',
        },
      ];

      const result = await reconcilePendingTransactions(
        mockMonarchAccountId,
        wealthsimpleTransactions,
        30,
        'SELF_DIRECTED_RRSP',
      );

      expect(result.success).toBe(true);
      expect(result.settled).toBe(0);
      expect(result.cancelled).toBe(0);
      expect(monarchApi.updateTransaction).not.toHaveBeenCalled();
      expect(monarchApi.deleteTransaction).not.toHaveBeenCalled();
    });

    it('should skip investment transaction when unifiedStatus is PENDING', async () => {
      monarchApi.getTagByName.mockResolvedValue({ id: mockPendingTagId, name: 'Pending' });
      monarchApi.getTransactionsList.mockResolvedValue({
        results: [
          {
            id: 'monarch-tx-1',
            amount: -75.00,
            date: '2026-01-10',
            notes: 'ws-tx:managed-buy-order-pending',
            ownedByUser: { id: 'user-123' },
          },
        ],
      });

      const wealthsimpleTransactions = [
        {
          externalCanonicalId: 'managed-buy-order-pending',
          type: 'MANAGED_BUY',
          status: null,
          unifiedStatus: 'PENDING',
          amount: 75.00,
          amountSign: 'negative',
        },
      ];

      const result = await reconcilePendingTransactions(
        mockMonarchAccountId,
        wealthsimpleTransactions,
        30,
        'MANAGED_TFSA',
      );

      expect(result.success).toBe(true);
      expect(result.settled).toBe(0);
      expect(result.cancelled).toBe(0);
    });

    it('should delete investment transaction when unifiedStatus is CANCELLED', async () => {
      monarchApi.getTagByName.mockResolvedValue({ id: mockPendingTagId, name: 'Pending' });
      monarchApi.getTransactionsList.mockResolvedValue({
        results: [
          {
            id: 'monarch-tx-1',
            amount: -200.00,
            date: '2026-01-10',
            notes: 'ws-tx:diy-sell-order-cancelled',
            ownedByUser: null,
          },
        ],
      });
      monarchApi.deleteTransaction.mockResolvedValue(true);

      const wealthsimpleTransactions = [
        {
          externalCanonicalId: 'diy-sell-order-cancelled',
          type: 'DIY_SELL',
          status: null,
          unifiedStatus: 'CANCELLED', // Order was cancelled
          amount: 200.00,
          amountSign: 'positive',
        },
      ];

      const result = await reconcilePendingTransactions(
        mockMonarchAccountId,
        wealthsimpleTransactions,
        30,
        'SELF_DIRECTED_NON_REGISTERED',
      );

      expect(result.success).toBe(true);
      expect(result.settled).toBe(0);
      expect(result.cancelled).toBe(1);
      expect(monarchApi.deleteTransaction).toHaveBeenCalledWith('monarch-tx-1');
    });

    it('should use status field for INTERNAL_TRANSFER in investment accounts', async () => {
      monarchApi.getTagByName.mockResolvedValue({ id: mockPendingTagId, name: 'Pending' });
      monarchApi.getTransactionsList.mockResolvedValue({
        results: [
          {
            id: 'monarch-tx-1',
            amount: 500.00,
            date: '2026-01-10',
            notes: 'ws-tx:funding_intent-transfer-123',
            ownedByUser: { id: 'user-123' },
          },
        ],
      });
      monarchApi.updateTransaction.mockResolvedValue({});
      monarchApi.setTransactionTags.mockResolvedValue({});

      // Internal transfers use status field even in investment accounts
      const wealthsimpleTransactions = [
        {
          externalCanonicalId: 'funding_intent-transfer-123',
          type: 'INTERNAL_TRANSFER',
          subType: 'DESTINATION',
          status: 'settled', // Internal transfers use status field
          unifiedStatus: null,
          amount: 500.00,
          amountSign: 'positive',
        },
      ];

      const result = await reconcilePendingTransactions(
        mockMonarchAccountId,
        wealthsimpleTransactions,
        30,
        'SELF_DIRECTED_TFSA',
      );

      expect(result.success).toBe(true);
      expect(result.settled).toBe(1);
      expect(monarchApi.setTransactionTags).toHaveBeenCalledWith('monarch-tx-1', []);
    });

    it('should skip internal transfer when status is authorized in investment account', async () => {
      monarchApi.getTagByName.mockResolvedValue({ id: mockPendingTagId, name: 'Pending' });
      monarchApi.getTransactionsList.mockResolvedValue({
        results: [
          {
            id: 'monarch-tx-1',
            amount: 300.00,
            date: '2026-01-10',
            notes: 'ws-tx:funding_intent-transfer-pending',
            ownedByUser: { id: 'user-123' },
          },
        ],
      });

      const wealthsimpleTransactions = [
        {
          externalCanonicalId: 'funding_intent-transfer-pending',
          type: 'INTERNAL_TRANSFER',
          subType: 'DESTINATION',
          status: 'authorized', // Still pending
          unifiedStatus: null,
          amount: 300.00,
          amountSign: 'positive',
        },
      ];

      const result = await reconcilePendingTransactions(
        mockMonarchAccountId,
        wealthsimpleTransactions,
        30,
        'MANAGED_RRSP',
      );

      expect(result.success).toBe(true);
      expect(result.settled).toBe(0);
      expect(result.cancelled).toBe(0);
      expect(monarchApi.updateTransaction).not.toHaveBeenCalled();
    });

    it('should delete investment transaction when not found in Wealthsimple', async () => {
      monarchApi.getTagByName.mockResolvedValue({ id: mockPendingTagId, name: 'Pending' });
      monarchApi.getTransactionsList.mockResolvedValue({
        results: [
          {
            id: 'monarch-tx-1',
            amount: -150.00,
            date: '2026-01-10',
            notes: 'ws-tx:cancelled-order-not-in-ws',
            ownedByUser: null,
          },
        ],
      });
      monarchApi.deleteTransaction.mockResolvedValue(true);

      // Transaction not in Wealthsimple data - was cancelled
      const wealthsimpleTransactions = [];

      const result = await reconcilePendingTransactions(
        mockMonarchAccountId,
        wealthsimpleTransactions,
        30,
        'SELF_DIRECTED_CRYPTO',
      );

      expect(result.success).toBe(true);
      expect(result.settled).toBe(0);
      expect(result.cancelled).toBe(1);
      expect(monarchApi.deleteTransaction).toHaveBeenCalledWith('monarch-tx-1');
    });

    it('should handle mixed investment transaction types correctly', async () => {
      monarchApi.getTagByName.mockResolvedValue({ id: mockPendingTagId, name: 'Pending' });
      monarchApi.getTransactionsList.mockResolvedValue({
        results: [
          {
            id: 'monarch-tx-buy',
            amount: -100.00,
            date: '2026-01-10',
            notes: 'ws-tx:diy-buy-completed',
            ownedByUser: { id: 'user-123' },
          },
          {
            id: 'monarch-tx-transfer',
            amount: 500.00,
            date: '2026-01-11',
            notes: 'ws-tx:funding_intent-transfer-settled',
            ownedByUser: { id: 'user-123' },
          },
          {
            id: 'monarch-tx-sell-pending',
            amount: 200.00,
            date: '2026-01-12',
            notes: 'ws-tx:diy-sell-in-progress',
            ownedByUser: null,
          },
        ],
      });
      monarchApi.updateTransaction.mockResolvedValue({});
      monarchApi.setTransactionTags.mockResolvedValue({});

      const wealthsimpleTransactions = [
        {
          externalCanonicalId: 'diy-buy-completed',
          type: 'DIY_BUY',
          status: null,
          unifiedStatus: 'COMPLETED', // Buy order completed
          amount: 100.00,
          amountSign: 'negative',
        },
        {
          externalCanonicalId: 'funding_intent-transfer-settled',
          type: 'INTERNAL_TRANSFER',
          subType: 'DESTINATION',
          status: 'settled', // Transfer settled (uses status)
          unifiedStatus: null,
          amount: 500.00,
          amountSign: 'positive',
        },
        {
          externalCanonicalId: 'diy-sell-in-progress',
          type: 'DIY_SELL',
          status: null,
          unifiedStatus: 'IN_PROGRESS', // Sell order still pending
          amount: 200.00,
          amountSign: 'positive',
        },
      ];

      const result = await reconcilePendingTransactions(
        mockMonarchAccountId,
        wealthsimpleTransactions,
        30,
        'SELF_DIRECTED_NON_REGISTERED',
      );

      expect(result.success).toBe(true);
      expect(result.settled).toBe(2); // Buy completed + transfer settled
      expect(result.cancelled).toBe(0);
      expect(result.failed).toBe(0);
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

    it('should return "No pending transactions" when all counts are 0', () => {
      const result = formatReconciliationMessage({ settled: 0, cancelled: 0, failed: 0 });
      expect(result).toBe('No pending transactions');
    });

    it('should format message with only settled count', () => {
      const result = formatReconciliationMessage({ settled: 3, cancelled: 0, failed: 0 });
      expect(result).toBe('3 settled');
    });

    it('should format message with only cancelled count', () => {
      const result = formatReconciliationMessage({ settled: 0, cancelled: 2, failed: 0 });
      expect(result).toBe('2 cancelled');
    });

    it('should format message with only failed count', () => {
      const result = formatReconciliationMessage({ settled: 0, cancelled: 0, failed: 2 });
      expect(result).toBe('2 failed');
    });

    it('should format message with both settled and cancelled counts', () => {
      const result = formatReconciliationMessage({ settled: 3, cancelled: 2, failed: 0 });
      expect(result).toBe('3 settled, 2 cancelled');
    });

    it('should format message with settled, cancelled, and failed counts', () => {
      const result = formatReconciliationMessage({ settled: 3, cancelled: 2, failed: 1 });
      expect(result).toBe('3 settled, 2 cancelled, 1 failed');
    });

    it('should format message with settled and failed counts', () => {
      const result = formatReconciliationMessage({ settled: 5, cancelled: 0, failed: 2 });
      expect(result).toBe('5 settled, 2 failed');
    });
  });
});
