/**
 * Tests for MBNA → Monarch Transaction Processing
 */

import {
  processMbnaTransactions,
  resolveMbnaCategories,
  filterDuplicateSettledTransactions,
} from '../../../../src/integrations/mbna/monarch-mapper/transactions';

// Mock dependencies
jest.mock('../../../../src/core/utils', () => ({
  debugLog: jest.fn(),
  stringSimilarity: jest.fn(() => 0),
}));

jest.mock('../../../../src/mappers/merchant', () => ({
  applyMerchantMapping: jest.fn((desc) => {
    // Simplified merchant mapping for tests
    if (!desc) return '';
    // Strip asterisk suffix (like Amazon.ca*RA6HH70U3 → Amazon.ca)
    const asteriskIndex = desc.indexOf('*');
    if (asteriskIndex > 0 && /^[A-Za-z]/.test(desc)) {
      return desc.substring(0, asteriskIndex);
    }
    // Title case for other descriptions
    return desc.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  }),
}));

jest.mock('../../../../src/core/integrationCapabilities', () => ({
  INTEGRATIONS: { MBNA: 'mbna' },
  getCapabilities: jest.fn(() => ({
    categoryMappings: true,
    categoryMappingsStorageKey: 'mbna_config',
  })),
}));

jest.mock('../../../../src/services/common/configStore', () => ({
  getCategoryMapping: jest.fn(() => null),
  setCategoryMapping: jest.fn(),
}));

jest.mock('../../../../src/mappers/category', () => ({
  calculateAllCategorySimilarities: jest.fn(() => ({
    bankCategory: 'test',
    categoryGroups: [],
    totalCategories: 0,
  })),
}));

jest.mock('../../../../src/ui/components/categorySelector', () => ({
  showMonarchCategorySelector: jest.fn(),
}));

jest.mock('../../../../src/api/monarch', () => ({
  __esModule: true,
  default: {
    getCategoriesAndGroups: jest.fn(() => Promise.resolve({ categories: [] })),
  },
}));

jest.mock('../../../../src/services/common/accountService', () => ({
  __esModule: true,
  default: {
    getAccountData: jest.fn(() => null),
  },
}));

import { getCategoryMapping, setCategoryMapping } from '../../../../src/services/common/configStore';
import { showMonarchCategorySelector } from '../../../../src/ui/components/categorySelector';
import monarchApi from '../../../../src/api/monarch';
import accountService from '../../../../src/services/common/accountService';
import { stringSimilarity } from '../../../../src/core/utils';

describe('MBNA Transaction Processing', () => {
  describe('processMbnaTransactions', () => {
    const sampleSettled = [
      {
        transactionDate: '2026-02-15',
        description: 'Amazon.ca*RA6HH70U3 TORONTO ON',
        referenceNumber: '55490535351206796539264',
        amount: 77.82,
        endingIn: '4201',
      },
      {
        transactionDate: '2026-02-10',
        description: 'PAYMENT',
        referenceNumber: '03000306013000455833905',
        amount: -13.32,
        endingIn: '4201',
      },
    ];

    const samplePending = [
      {
        transactionDate: '2026-02-17',
        description: 'UBER *EATS HELP.UBER.COM ON',
        referenceNumber: 'TEMP',
        amount: 25.50,
        endingIn: '4201',
        generatedId: 'mbna-tx:abc123def456ab78',
        isPending: true,
      },
    ];

    it('should process settled transactions with merchant mapping', () => {
      const result = processMbnaTransactions(sampleSettled, []);

      expect(result.settled).toHaveLength(2);
      expect(result.pending).toHaveLength(0);
      expect(result.all).toHaveLength(2);

      // Amazon.ca*RA6HH70U3 TORONTO ON → "Amazon.ca" (asterisk stripped)
      expect(result.settled[0].merchant).toBe('Amazon.ca');
      expect(result.settled[0].originalStatement).toBe('Amazon.ca*RA6HH70U3 TORONTO ON');
      expect(result.settled[0].date).toBe('2026-02-15');
      expect(result.settled[0].amount).toBe(-77.82);
      expect(result.settled[0].isPending).toBe(false);
    });

    it('should auto-categorize PAYMENT transactions', () => {
      const result = processMbnaTransactions(sampleSettled, []);

      const paymentTx = result.settled.find((tx) => tx.originalStatement === 'PAYMENT');
      expect(paymentTx.autoCategory).toBe('Credit Card Payment');
      expect(paymentTx.merchant).toBe('MBNA Credit Card Payment');
    });

    it('should not auto-categorize non-PAYMENT transactions', () => {
      const result = processMbnaTransactions(sampleSettled, []);

      const amazonTx = result.settled.find((tx) => tx.originalStatement === 'Amazon.ca*RA6HH70U3 TORONTO ON');
      expect(amazonTx.autoCategory).toBeNull();
    });

    it('should process pending transactions with generatedId', () => {
      const result = processMbnaTransactions([], samplePending);

      expect(result.pending).toHaveLength(1);
      expect(result.pending[0].isPending).toBe(true);
      expect(result.pending[0].pendingId).toBe('mbna-tx:abc123def456ab78');
    });

    it('should exclude pending when includePending is false', () => {
      const result = processMbnaTransactions(sampleSettled, samplePending, { includePending: false });

      expect(result.settled).toHaveLength(2);
      expect(result.pending).toHaveLength(0);
      expect(result.all).toHaveLength(2);
    });

    it('should combine settled and pending in all array', () => {
      const result = processMbnaTransactions(sampleSettled, samplePending);

      expect(result.all).toHaveLength(3);
      expect(result.all.filter((tx) => tx.isPending)).toHaveLength(1);
      expect(result.all.filter((tx) => !tx.isPending)).toHaveLength(2);
    });

    it('should handle empty inputs', () => {
      const result = processMbnaTransactions([], []);
      expect(result.settled).toHaveLength(0);
      expect(result.pending).toHaveLength(0);
      expect(result.all).toHaveLength(0);
    });

    it('should invert amount signs for Monarch (charge → negative, payment → positive)', () => {
      const result = processMbnaTransactions(sampleSettled, []);

      // MBNA charge 77.82 → Monarch -77.82
      const charge = result.settled.find((tx) => tx.originalStatement === 'Amazon.ca*RA6HH70U3 TORONTO ON');
      expect(charge.amount).toBe(-77.82);

      // MBNA payment -13.32 → Monarch 13.32
      const payment = result.settled.find((tx) => tx.originalStatement === 'PAYMENT');
      expect(payment.amount).toBe(13.32);
    });
  });

  describe('resolveMbnaCategories', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      accountService.getAccountData.mockReturnValue(null);
      getCategoryMapping.mockReturnValue(null);
      stringSimilarity.mockReturnValue(0);
      monarchApi.getCategoriesAndGroups.mockResolvedValue({ categories: [] });
    });

    it('should return empty array for empty input', async () => {
      const result = await resolveMbnaCategories([], 'acc-123');
      expect(result).toEqual([]);
    });

    it('should return empty array for null input', async () => {
      const result = await resolveMbnaCategories(null, 'acc-123');
      expect(result).toEqual([]);
    });

    it('should preserve auto-categorized transactions', async () => {
      const transactions = [
        { merchant: 'MBNA Credit Card Payment', autoCategory: 'Credit Card Payment', date: '2026-02-10', amount: 100 },
        { merchant: 'Amazon.ca', autoCategory: null, date: '2026-02-15', amount: -50 },
      ];

      const result = await resolveMbnaCategories(transactions, 'acc-123');

      expect(result[0].resolvedMonarchCategory).toBe('Credit Card Payment');
    });

    it('should set Uncategorized for all non-auto-categorized when skipCategorization is true', async () => {
      accountService.getAccountData.mockReturnValue({ skipCategorization: true });

      const transactions = [
        { merchant: 'MBNA Credit Card Payment', autoCategory: 'Credit Card Payment', date: '2026-02-10', amount: 100 },
        { merchant: 'Amazon.ca', autoCategory: null, date: '2026-02-15', amount: -50 },
        { merchant: 'Uber Eats', autoCategory: null, date: '2026-02-16', amount: -25 },
      ];

      const result = await resolveMbnaCategories(transactions, 'acc-123');

      expect(result[0].resolvedMonarchCategory).toBe('Credit Card Payment');
      expect(result[1].resolvedMonarchCategory).toBe('Uncategorized');
      expect(result[2].resolvedMonarchCategory).toBe('Uncategorized');
      // Should NOT fetch categories from Monarch when skipping
      expect(monarchApi.getCategoriesAndGroups).not.toHaveBeenCalled();
    });

    it('should use stored category mappings when available', async () => {
      getCategoryMapping.mockImplementation((integration, merchant) => {
        if (merchant === 'Amazon.ca') return 'Shopping';
        return null;
      });

      const transactions = [
        { merchant: 'Amazon.ca', autoCategory: null, date: '2026-02-15', amount: -50 },
      ];

      const result = await resolveMbnaCategories(transactions, 'acc-123');

      expect(result[0].resolvedMonarchCategory).toBe('Shopping');
      expect(getCategoryMapping).toHaveBeenCalledWith('mbna', 'Amazon.ca');
    });

    it('should apply high-confidence auto-match and save mapping', async () => {
      monarchApi.getCategoriesAndGroups.mockResolvedValue({
        categories: [{ name: 'Groceries', id: 'cat-1' }],
      });
      stringSimilarity.mockReturnValue(0.98);

      const transactions = [
        { merchant: 'Groceries', autoCategory: null, date: '2026-02-15', amount: -50 },
      ];

      const result = await resolveMbnaCategories(transactions, 'acc-123');

      expect(result[0].resolvedMonarchCategory).toBe('Groceries');
      expect(setCategoryMapping).toHaveBeenCalledWith('mbna', 'Groceries', 'Groceries');
    });

    it('should prompt manual categorization for unresolved merchants', async () => {
      monarchApi.getCategoriesAndGroups.mockResolvedValue({
        categories: [{ name: 'Shopping', id: 'cat-1' }],
      });
      stringSimilarity.mockReturnValue(0.3); // Low similarity

      showMonarchCategorySelector.mockImplementation((_merchant, callback) => {
        callback({ name: 'Shopping' });
      });

      const transactions = [
        { merchant: 'Amazon.ca', autoCategory: null, date: '2026-02-15', amount: -50, originalStatement: 'Amazon.ca*RA6HH70U3' },
      ];

      const result = await resolveMbnaCategories(transactions, 'acc-123');

      expect(result[0].resolvedMonarchCategory).toBe('Shopping');
      expect(showMonarchCategorySelector).toHaveBeenCalled();
      expect(setCategoryMapping).toHaveBeenCalledWith('mbna', 'Amazon.ca', 'Shopping');
    });

    it('should handle Skip All during manual categorization', async () => {
      monarchApi.getCategoriesAndGroups.mockResolvedValue({
        categories: [{ name: 'Shopping', id: 'cat-1' }],
      });
      stringSimilarity.mockReturnValue(0.3);

      showMonarchCategorySelector.mockImplementation((_merchant, callback) => {
        callback({ skipAll: true });
      });

      const transactions = [
        { merchant: 'Amazon.ca', autoCategory: null, date: '2026-02-15', amount: -50 },
        { merchant: 'Uber Eats', autoCategory: null, date: '2026-02-16', amount: -25 },
      ];

      const result = await resolveMbnaCategories(transactions, 'acc-123');

      expect(result[0].resolvedMonarchCategory).toBe('Uncategorized');
      expect(result[1].resolvedMonarchCategory).toBe('Uncategorized');
      // Only the first prompt should have been shown
      expect(showMonarchCategorySelector).toHaveBeenCalledTimes(1);
    });

    it('should handle Skip (single) during manual categorization', async () => {
      monarchApi.getCategoriesAndGroups.mockResolvedValue({
        categories: [{ name: 'Shopping', id: 'cat-1' }],
      });
      stringSimilarity.mockReturnValue(0.3);

      let callCount = 0;
      showMonarchCategorySelector.mockImplementation((_merchant, callback) => {
        callCount += 1;
        if (callCount === 1) {
          callback({ skipped: true }); // Skip first
        } else {
          callback({ name: 'Food & Drink' }); // Resolve second
        }
      });

      const transactions = [
        { merchant: 'Amazon.ca', autoCategory: null, date: '2026-02-15', amount: -50 },
        { merchant: 'Uber Eats', autoCategory: null, date: '2026-02-16', amount: -25 },
      ];

      const result = await resolveMbnaCategories(transactions, 'acc-123');

      expect(result[0].resolvedMonarchCategory).toBe('Uncategorized');
      expect(result[1].resolvedMonarchCategory).toBe('Food & Drink');
      expect(showMonarchCategorySelector).toHaveBeenCalledTimes(2);
    });

    it('should throw error when user cancels category selection', async () => {
      monarchApi.getCategoriesAndGroups.mockResolvedValue({
        categories: [{ name: 'Shopping', id: 'cat-1' }],
      });
      stringSimilarity.mockReturnValue(0.3);

      showMonarchCategorySelector.mockImplementation((_merchant, callback) => {
        callback(null); // Cancel
      });

      const transactions = [
        { merchant: 'Amazon.ca', autoCategory: null, date: '2026-02-15', amount: -50 },
      ];

      await expect(resolveMbnaCategories(transactions, 'acc-123'))
        .rejects.toThrow('Category selection cancelled for "Amazon.ca"');
    });

    it('should deduplicate merchants — only prompt once per unique merchant', async () => {
      monarchApi.getCategoriesAndGroups.mockResolvedValue({
        categories: [{ name: 'Shopping', id: 'cat-1' }],
      });
      stringSimilarity.mockReturnValue(0.3);

      showMonarchCategorySelector.mockImplementation((_merchant, callback) => {
        callback({ name: 'Shopping' });
      });

      const transactions = [
        { merchant: 'Amazon.ca', autoCategory: null, date: '2026-02-15', amount: -50 },
        { merchant: 'Amazon.ca', autoCategory: null, date: '2026-02-16', amount: -30 },
        { merchant: 'Amazon.ca', autoCategory: null, date: '2026-02-17', amount: -20 },
      ];

      const result = await resolveMbnaCategories(transactions, 'acc-123');

      // All three should resolve to Shopping
      expect(result[0].resolvedMonarchCategory).toBe('Shopping');
      expect(result[1].resolvedMonarchCategory).toBe('Shopping');
      expect(result[2].resolvedMonarchCategory).toBe('Shopping');
      // But only prompted once
      expect(showMonarchCategorySelector).toHaveBeenCalledTimes(1);
    });

    it('should read skipCategorization from account data', async () => {
      accountService.getAccountData.mockReturnValue({ skipCategorization: true });

      const transactions = [
        { merchant: 'Amazon.ca', autoCategory: null, date: '2026-02-15', amount: -50 },
      ];

      await resolveMbnaCategories(transactions, 'acc-123');

      expect(accountService.getAccountData).toHaveBeenCalledWith('mbna', 'acc-123');
    });

    it('should handle failed Monarch categories fetch gracefully', async () => {
      monarchApi.getCategoriesAndGroups.mockRejectedValue(new Error('Network error'));

      const transactions = [
        { merchant: 'Amazon.ca', autoCategory: null, date: '2026-02-15', amount: -50 },
      ];

      // Should not throw, just set Uncategorized
      const result = await resolveMbnaCategories(transactions, 'acc-123');
      expect(result[0].resolvedMonarchCategory).toBe('Uncategorized');
    });
  });

  describe('filterDuplicateSettledTransactions', () => {
    const transactions = [
      { referenceNumber: 'REF1', date: '2026-02-10', amount: 10 },
      { referenceNumber: 'REF2', date: '2026-02-11', amount: 20 },
      { referenceNumber: 'REF3', date: '2026-02-12', amount: 30 },
    ];

    it('should filter out already uploaded transactions', () => {
      const uploaded = [
        { id: 'REF1', date: '2026-02-10' },
        { id: 'REF2', date: '2026-02-11' },
      ];

      const result = filterDuplicateSettledTransactions(transactions, uploaded);

      expect(result.newTransactions).toHaveLength(1);
      expect(result.newTransactions[0].referenceNumber).toBe('REF3');
      expect(result.duplicateCount).toBe(2);
    });

    it('should return all when no uploaded history', () => {
      const result = filterDuplicateSettledTransactions(transactions, []);
      expect(result.newTransactions).toHaveLength(3);
      expect(result.duplicateCount).toBe(0);
    });

    it('should return all when uploaded is null', () => {
      const result = filterDuplicateSettledTransactions(transactions, null);
      expect(result.newTransactions).toHaveLength(3);
      expect(result.duplicateCount).toBe(0);
    });

    it('should handle empty transaction list', () => {
      const result = filterDuplicateSettledTransactions([], [{ id: 'REF1' }]);
      expect(result.newTransactions).toHaveLength(0);
      expect(result.duplicateCount).toBe(0);
    });
  });
});