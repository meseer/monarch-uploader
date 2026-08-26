/**
 * Tests for Wealthsimple Transaction Service - Credit Card Transactions
 *
 * Covers: fetchAndProcessCreditCardTransactions
 */

import {
  fetchAndProcessCreditCardTransactions,
} from '../../../src/services/wealthsimple/transactions';
import wealthsimpleApi from '../../../src/api/wealthsimple';
import monarchApi from '../../../src/api/monarch';
import { applyWealthsimpleCategoryMapping, saveUserWealthsimpleCategorySelection } from '../../../src/mappers/category';
import { showMonarchCategorySelector } from '../../../src/ui/components/categorySelector';

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

// Set up default mocks for the card enrichment APIs
beforeEach(() => {
  wealthsimpleApi.fetchSpendTransactions = jest.fn().mockResolvedValue(new Map());
  wealthsimpleApi.fetchCreditCardActivity = jest.fn().mockResolvedValue(null);
});

describe('Wealthsimple Transaction Service - Credit Card', () => {
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

    it('should apply one-time category (assignmentType=once) to all same-merchant transactions this sync', async () => {
      // With "Assign Once", the selected category applies to ALL transactions that
      // share the merchant for the current sync (but is NOT persisted as a rule).
      // Regression: previously only the example transaction was categorized and any
      // subsequent same-merchant transactions were incorrectly left "Uncategorized".
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

      // "Assign Once" never persists a mapping, so applyWealthsimpleCategoryMapping
      // always reports needsManualSelection. The one-time assignment (keyed by
      // category key) is what resolves the remaining same-merchant transactions.
      applyWealthsimpleCategoryMapping.mockReturnValue({
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

      // With "Assign Once": both same-merchant transactions get "Food" for this sync
      expect(result).toHaveLength(2);
      expect(result[0].resolvedMonarchCategory).toBe('Food');
      expect(result[1].resolvedMonarchCategory).toBe('Food');

      // Should only show selector once (for unique merchant - deduplication still happens)
      expect(showMonarchCategorySelector).toHaveBeenCalledTimes(1);

      // "Assign Once" must NOT persist a rule
      expect(saveUserWealthsimpleCategorySelection).not.toHaveBeenCalled();
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

    it('should skip already-uploaded settled transactions before categorization (externalCanonicalId)', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'tx-already-uploaded',
          occurredAt: '2025-01-15T10:30:00.000000+00:00',
          type: 'CREDIT_CARD',
          subType: 'PURCHASE',
          status: 'settled',
          spendMerchant: 'Uncategorized Merchant',
          amount: 50.00,
          amountSign: 'negative',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);
      monarchApi.getCategoriesAndGroups.mockResolvedValue({ categories: [], categoryGroups: [] });
      applyWealthsimpleCategoryMapping.mockReturnValue({
        needsManualSelection: true,
        bankCategory: 'Uncategorized Merchant',
        suggestedCategory: 'Shopping',
        similarityScore: 0.5,
      });

      const uploadedIds = new Set(['tx-already-uploaded']);

      const result = await fetchAndProcessCreditCardTransactions(
        mockConsolidatedAccount,
        '2025-01-01',
        '2025-01-31',
        { uploadedTransactionIds: uploadedIds },
      );

      // Transaction should be filtered out before categorization
      expect(result).toEqual([]);
      // Category selector must never be invoked for an already-uploaded transaction
      expect(showMonarchCategorySelector).not.toHaveBeenCalled();
    });

    it('should skip already-uploaded settled transactions that lack externalCanonicalId (canonicalId fallback)', async () => {
      // Regression: early dedup must use getTransactionId (which falls back to
      // canonicalId) so already-uploaded transactions without externalCanonicalId
      // do not get re-categorized every sync before the final dedup discards them.
      const mockRawTransactions = [
        {
          externalCanonicalId: null,
          canonicalId: 'canonical-already-uploaded',
          occurredAt: '2025-01-15T10:30:00.000000+00:00',
          type: 'CREDIT_CARD',
          subType: 'PURCHASE',
          status: 'settled',
          spendMerchant: 'Uncategorized Merchant',
          amount: 50.00,
          amountSign: 'negative',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);
      monarchApi.getCategoriesAndGroups.mockResolvedValue({ categories: [], categoryGroups: [] });
      applyWealthsimpleCategoryMapping.mockReturnValue({
        needsManualSelection: true,
        bankCategory: 'Uncategorized Merchant',
        suggestedCategory: 'Shopping',
        similarityScore: 0.5,
      });

      // Stored using the same key getTransactionId produces (canonicalId fallback)
      const uploadedIds = new Set(['canonical-already-uploaded']);

      const result = await fetchAndProcessCreditCardTransactions(
        mockConsolidatedAccount,
        '2025-01-01',
        '2025-01-31',
        { uploadedTransactionIds: uploadedIds },
      );

      // Transaction should be filtered out before categorization
      expect(result).toEqual([]);
      // Category selector must never be invoked for an already-uploaded transaction
      expect(showMonarchCategorySelector).not.toHaveBeenCalled();
    });

    it('should skip already-uploaded PENDING (authorized) transactions before categorization', async () => {
      // Regression: an already-uploaded PENDING transaction that is still pending must
      // NOT be re-categorized. Its ID is stored after the first upload, so the early
      // dedup filter must skip it regardless of status (the final dedup by ID then
      // prevents a duplicate, but only after categorization already happened).
      const mockRawTransactions = [
        {
          externalCanonicalId: 'tx-pending-already-uploaded',
          occurredAt: '2025-01-15T10:30:00.000000+00:00',
          type: 'CREDIT_CARD',
          subType: 'PURCHASE',
          status: 'authorized', // still pending
          spendMerchant: 'Uncategorized Merchant',
          amount: 50.00,
          amountSign: 'negative',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);
      monarchApi.getCategoriesAndGroups.mockResolvedValue({ categories: [], categoryGroups: [] });
      applyWealthsimpleCategoryMapping.mockReturnValue({
        needsManualSelection: true,
        bankCategory: 'Uncategorized Merchant',
        suggestedCategory: 'Shopping',
        similarityScore: 0.5,
      });

      const uploadedIds = new Set(['tx-pending-already-uploaded']);

      const result = await fetchAndProcessCreditCardTransactions(
        { ...mockConsolidatedAccount, includePendingTransactions: true },
        '2025-01-01',
        '2025-01-31',
        { uploadedTransactionIds: uploadedIds },
      );

      // Transaction should be filtered out before categorization
      expect(result).toEqual([]);
      // Category selector must never be invoked for an already-uploaded pending transaction
      expect(showMonarchCategorySelector).not.toHaveBeenCalled();
    });

    it('should skip a settled transaction whose ID gained a suffix after settling', async () => {
      // Regression: Wealthsimple appends one dash-separated segment to the
      // externalCanonicalId when card activity settles. Without variant-aware
      // dedup, the settled version looks brand new and the user is prompted to
      // categorize the same purchase again.
      const pendingId = 'card-activity-00000000527000993851-VI-00-0306231535741989-QIRIAS';
      const settledId = `${pendingId}-0tk4pfcsob83`;

      const mockRawTransactions = [
        {
          externalCanonicalId: settledId,
          occurredAt: '2025-01-15T10:30:00.000000+00:00',
          type: 'CREDIT_CARD',
          subType: 'PURCHASE',
          status: 'settled',
          spendMerchant: 'Settled Merchant Name',
          amount: 52.00,
          amountSign: 'negative',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);
      monarchApi.getCategoriesAndGroups.mockResolvedValue({ categories: [], categoryGroups: [] });
      applyWealthsimpleCategoryMapping.mockReturnValue({
        needsManualSelection: true,
        bankCategory: 'Settled Merchant Name',
        suggestedCategory: 'Shopping',
        similarityScore: 0.5,
      });

      // Only the PENDING ID was stored on the previous sync
      const uploadedIds = new Set([pendingId]);

      const result = await fetchAndProcessCreditCardTransactions(
        { ...mockConsolidatedAccount, includePendingTransactions: true },
        '2025-01-01',
        '2025-01-31',
        { uploadedTransactionIds: uploadedIds },
      );

      expect(result).toEqual([]);
      expect(showMonarchCategorySelector).not.toHaveBeenCalled();
    });

    it('should still process an unrelated transaction that merely shares a prefix-like ID', async () => {
      const pendingId = 'card-activity-00000000527000993851-VI-00-0306231535741989-QIRIAS';

      const mockRawTransactions = [
        {
          // Two extra segments — NOT a settled variant, must be treated as new
          externalCanonicalId: `${pendingId}-aaa-bbb`,
          occurredAt: '2025-01-16T10:30:00.000000+00:00',
          type: 'CREDIT_CARD',
          subType: 'PURCHASE',
          status: 'settled',
          spendMerchant: 'Different Merchant',
          amount: 10.00,
          amountSign: 'negative',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);
      monarchApi.getCategoriesAndGroups.mockResolvedValue({ categories: [], categoryGroups: [] });
      applyWealthsimpleCategoryMapping.mockReturnValue('Shopping');

      const uploadedIds = new Set([pendingId]);

      const result = await fetchAndProcessCreditCardTransactions(
        { ...mockConsolidatedAccount, includePendingTransactions: true },
        '2025-01-01',
        '2025-01-31',
        { uploadedTransactionIds: uploadedIds },
      );

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(`${pendingId}-aaa-bbb`);
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

  describe('foreign currency enrichment', () => {
    /**
     * FetchCreditCardActivity replaced FetchSpendTransactions for credit card
     * accounts, which started returning 403 Forbidden for ca-credit-card-* IDs.
     */
    const buildPurchase = (id, status) => ({
      externalCanonicalId: id,
      occurredAt: '2025-01-15T10:30:00.000000+00:00',
      type: 'CREDIT_CARD',
      subType: 'PURCHASE',
      status,
      spendMerchant: 'CAFE BERLIN',
      amount: 47.16,
      amountSign: 'negative',
    });

    const FOREIGN_ACTIVITY = {
      id: 'tx-fx',
      status: 'settled',
      isForeign: true,
      originalAmount: '-29.29',
      originalCurrency: 'EUR',
      foreignAmount: -29,
      foreignCurrency: 'EUR',
      foreignExchangeRate: '1.610106',
      hasReward: true,
      rewardAmount: '0.94',
      rewardRate: '0.02',
    };

    beforeEach(() => {
      monarchApi.getCategoriesAndGroups.mockResolvedValue({ categories: [], categoryGroups: [] });
      applyWealthsimpleCategoryMapping.mockReturnValue('Shopping');
    });

    it('fetches card activity per purchase instead of the batched spend API', async () => {
      wealthsimpleApi.fetchTransactions.mockResolvedValue([buildPurchase('tx-fx', 'settled')]);
      wealthsimpleApi.fetchCreditCardActivity.mockResolvedValue(FOREIGN_ACTIVITY);

      await fetchAndProcessCreditCardTransactions(
        mockConsolidatedAccount,
        '2025-01-01',
        '2025-01-31',
      );

      expect(wealthsimpleApi.fetchCreditCardActivity).toHaveBeenCalledWith('tx-fx');
      expect(wealthsimpleApi.fetchSpendTransactions).not.toHaveBeenCalled();
    });

    it('adds FX notes with the precise original amount and the reward rate', async () => {
      wealthsimpleApi.fetchTransactions.mockResolvedValue([buildPurchase('tx-fx', 'settled')]);
      wealthsimpleApi.fetchCreditCardActivity.mockResolvedValue(FOREIGN_ACTIVITY);

      const result = await fetchAndProcessCreditCardTransactions(
        mockConsolidatedAccount,
        '2025-01-01',
        '2025-01-31',
      );

      expect(result).toHaveLength(1);
      expect(result[0].notes).toBe('Amount: 29.29 EUR (rate: 1.610106)\nRewards: 0.94 (rate: 2%)');
      expect(result[0].foreignCurrency).toBe('EUR');
    });

    it('fetches card activity for a pending purchase and surfaces the FX data', async () => {
      // Wealthsimple already populates the FX fields for some authorizations, so
      // the data must be fetched and used rather than withheld until settlement.
      wealthsimpleApi.fetchTransactions.mockResolvedValue([buildPurchase('tx-pending', 'authorized')]);
      wealthsimpleApi.fetchCreditCardActivity.mockResolvedValue({
        ...FOREIGN_ACTIVITY,
        id: 'tx-pending',
        status: 'authorized',
        hasReward: false,
      });

      const result = await fetchAndProcessCreditCardTransactions(
        { ...mockConsolidatedAccount, includePendingTransactions: true },
        '2025-01-01',
        '2025-01-31',
      );

      expect(wealthsimpleApi.fetchCreditCardActivity).toHaveBeenCalledWith('tx-pending');
      expect(result).toHaveLength(1);
      expect(result[0].notes).toBe('Amount: 29.29 EUR (rate: 1.610106)');
      expect(result[0].foreignCurrency).toBe('EUR');
    });

    it('leaves notes empty for a pending purchase whose FX data is not populated yet', async () => {
      wealthsimpleApi.fetchTransactions.mockResolvedValue([buildPurchase('tx-pending-bare', 'authorized')]);
      wealthsimpleApi.fetchCreditCardActivity.mockResolvedValue({
        id: 'tx-pending-bare',
        status: 'authorized',
        isForeign: true,
        originalAmount: null,
        originalCurrency: null,
        foreignExchangeRate: null,
        hasReward: false,
      });

      const result = await fetchAndProcessCreditCardTransactions(
        { ...mockConsolidatedAccount, includePendingTransactions: true },
        '2025-01-01',
        '2025-01-31',
      );

      expect(result).toHaveLength(1);
      // No placeholder note — the FX values genuinely do not exist yet
      expect(result[0].notes).toBe('');
      expect(result[0].foreignCurrency).toBeNull();
    });

    it('leaves notes and currency empty for a domestic purchase', async () => {
      wealthsimpleApi.fetchTransactions.mockResolvedValue([buildPurchase('tx-domestic', 'settled')]);
      wealthsimpleApi.fetchCreditCardActivity.mockResolvedValue({
        id: 'tx-domestic',
        status: 'settled',
        isForeign: false,
        originalAmount: '-47.16',
        originalCurrency: 'CAD',
        hasReward: false,
      });

      const result = await fetchAndProcessCreditCardTransactions(
        mockConsolidatedAccount,
        '2025-01-01',
        '2025-01-31',
      );

      expect(result[0].notes).toBe('');
      expect(result[0].foreignCurrency).toBeNull();
    });

    it('continues processing when the card activity fetch returns null', async () => {
      wealthsimpleApi.fetchTransactions.mockResolvedValue([buildPurchase('tx-fail', 'settled')]);
      wealthsimpleApi.fetchCreditCardActivity.mockResolvedValue(null);

      const result = await fetchAndProcessCreditCardTransactions(
        mockConsolidatedAccount,
        '2025-01-01',
        '2025-01-31',
      );

      expect(result).toHaveLength(1);
      expect(result[0].notes).toBe('');
      expect(result[0].foreignCurrency).toBeNull();
    });

    it('reports card activity fetch progress', async () => {
      wealthsimpleApi.fetchTransactions.mockResolvedValue([buildPurchase('tx-fx', 'settled')]);
      wealthsimpleApi.fetchCreditCardActivity.mockResolvedValue(FOREIGN_ACTIVITY);
      const onProgress = jest.fn();

      await fetchAndProcessCreditCardTransactions(
        mockConsolidatedAccount,
        '2025-01-01',
        '2025-01-31',
        { onProgress },
      );

      expect(onProgress).toHaveBeenCalledWith('Card activity details (1/1)');
    });

    it('does not fetch card activity for non-purchase subtypes', async () => {
      wealthsimpleApi.fetchTransactions.mockResolvedValue([
        {
          externalCanonicalId: 'tx-payment',
          occurredAt: '2025-01-15T10:30:00.000000+00:00',
          type: 'CREDIT_CARD',
          subType: 'PAYMENT',
          status: 'settled',
          spendMerchant: null,
          amount: 100,
          amountSign: 'positive',
        },
      ]);

      await fetchAndProcessCreditCardTransactions(
        mockConsolidatedAccount,
        '2025-01-01',
        '2025-01-31',
      );

      expect(wealthsimpleApi.fetchCreditCardActivity).not.toHaveBeenCalled();
    });
  });

});
