/**
 * Tests for MBNA sync hooks
 */

import mbnaSyncHooks from '../../../src/integrations/mbna/sinks/monarch/syncHooks';

// ── Mocks ───────────────────────────────────────────────────

jest.mock('../../../src/core/utils', () => ({
  debugLog: jest.fn(),
  stringSimilarity: jest.fn(() => 0),
}));

jest.mock('../../../src/core/integrationCapabilities', () => ({
  INTEGRATIONS: { MBNA: 'mbna' },
}));

jest.mock('../../../src/mappers/merchant', () => ({
  applyMerchantMapping: jest.fn((name) => name ? name.trim() : ''),
}));

jest.mock('../../../src/services/common/configStore', () => ({
  getCategoryMapping: jest.fn(() => null),
  setCategoryMapping: jest.fn(),
}));

jest.mock('../../../src/mappers/category', () => ({
  calculateAllCategorySimilarities: jest.fn(() => []),
}));

jest.mock('../../../src/ui/components/categorySelector', () => ({
  showMonarchCategorySelector: jest.fn(),
}));

jest.mock('../../../src/api/monarch', () => ({
  __esModule: true,
  default: {
    getCategoriesAndGroups: jest.fn(() => Promise.resolve({ categories: [] })),
  },
}));

jest.mock('../../../src/services/common/accountService', () => ({
  __esModule: true,
  default: {
    getAccountData: jest.fn(() => ({ skipCategorization: true })),
  },
}));

jest.mock('../../../src/integrations/mbna/source/balanceReconstruction', () => ({
  buildBalanceHistory: jest.fn(() => [{ date: '2024-01-10', amount: 100 }]),
}));

jest.mock('../../../src/integrations/mbna/sinks/monarch/balanceFormatter', () => ({
  formatBalanceHistoryForMonarch: jest.fn((history) => history.map((h) => ({ ...h, amount: -h.amount }))),
}));

// ── Tests ───────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
});

describe('MBNA SyncHooks', () => {
  describe('fetchTransactions', () => {
    it('should call api.getTransactions and return normalized result', async () => {
      const mockApi = {
        getTransactions: jest.fn(() => Promise.resolve({
          allSettled: [{ referenceNumber: 'REF1', description: 'Amazon', amount: 42.50 }],
          allPending: [{ referenceNumber: 'TEMP', description: 'Starbucks', amount: 5.25 }],
          statements: [{ closingDate: '2024-01-01' }],
          currentCycle: { settled: [], pending: [] },
        })),
      };

      const result = await mbnaSyncHooks.fetchTransactions(mockApi, 'acc-1', '2024-01-01', {
        onProgress: jest.fn(),
      });

      expect(result.settled).toHaveLength(1);
      expect(result.pending).toHaveLength(1);
      expect(result.metadata.statements).toHaveLength(1);
      expect(result.metadata.currentCycle).toBeDefined();
    });
  });

  describe('processTransactions', () => {
    it('should process settled and pending transactions', () => {
      const settled = [{ transactionDate: '2024-01-15', description: 'AMAZON', amount: 42.50, referenceNumber: 'REF1' }];
      const pending = [{ transactionDate: '2024-01-16', description: 'STARBUCKS', amount: 5.25, generatedId: 'mbna-tx:abc123' }];

      const result = mbnaSyncHooks.processTransactions(settled, pending, { includePending: true });

      expect(result.settled).toHaveLength(1);
      expect(result.pending).toHaveLength(1);
      // Amount should be negated (MBNA positive charge → Monarch negative)
      expect(result.settled[0].amount).toBe(-42.50);
    });

    it('should exclude pending when includePending is false', () => {
      const settled = [{ transactionDate: '2024-01-15', description: 'AMAZON', amount: 42.50, referenceNumber: 'REF1' }];
      const pending = [{ transactionDate: '2024-01-16', description: 'STARBUCKS', amount: 5.25, generatedId: 'mbna-tx:abc123' }];

      const result = mbnaSyncHooks.processTransactions(settled, pending, { includePending: false });

      expect(result.settled).toHaveLength(1);
      expect(result.pending).toHaveLength(0);
    });
  });

  describe('getSettledRefId', () => {
    it('should return referenceNumber', () => {
      expect(mbnaSyncHooks.getSettledRefId({ referenceNumber: 'REF123' })).toBe('REF123');
    });
  });

  describe('getPendingRefId', () => {
    it('should return pendingId', () => {
      expect(mbnaSyncHooks.getPendingRefId({ pendingId: 'mbna-tx:abc123' })).toBe('mbna-tx:abc123');
    });
  });

  describe('buildTransactionNotes', () => {
    it('should return empty string for settled without storeTransactionDetailsInNotes', () => {
      const tx = { isPending: false, referenceNumber: 'REF1' };
      expect(mbnaSyncHooks.buildTransactionNotes(tx, { storeTransactionDetailsInNotes: false })).toBe('');
    });

    it('should include referenceNumber for settled with storeTransactionDetailsInNotes', () => {
      const tx = { isPending: false, referenceNumber: 'REF1' };
      expect(mbnaSyncHooks.buildTransactionNotes(tx, { storeTransactionDetailsInNotes: true })).toBe('REF1');
    });

    it('should include pendingId for pending transactions', () => {
      const tx = { isPending: true, pendingId: 'mbna-tx:abc123def4567890' };
      expect(mbnaSyncHooks.buildTransactionNotes(tx, { storeTransactionDetailsInNotes: false })).toBe('mbna-tx:abc123def4567890');
    });
  });

  describe('getPendingIdFields', () => {
    it('should return ordered field values for hashing', () => {
      const tx = {
        transactionDate: '2024-01-15',
        description: 'Amazon.ca*RA6HH70U3 TORONTO ON',
        amount: 42.50,
        endingIn: '1234',
      };

      const fields = mbnaSyncHooks.getPendingIdFields(tx);

      expect(fields).toEqual([
        '2024-01-15',
        'Amazon.ca',  // asterisk suffix stripped
        '42.5',
        '1234',
      ]);
    });

    it('should handle missing fields gracefully', () => {
      const tx = {};
      const fields = mbnaSyncHooks.getPendingIdFields(tx);

      expect(fields).toEqual(['', '', '', '']);
    });
  });

  describe('getSettledAmount', () => {
    it('should negate the raw amount', () => {
      expect(mbnaSyncHooks.getSettledAmount({ amount: 42.50 })).toBe(-42.50);
      expect(mbnaSyncHooks.getSettledAmount({ amount: -10 })).toBe(10);
    });

    it('should handle zero amount', () => {
      expect(mbnaSyncHooks.getSettledAmount({ amount: 0 })).toBe(-0);
    });
  });

  describe('buildBalanceHistory', () => {
    it('should call balance reconstruction and format for Monarch', () => {
      const { buildBalanceHistory } = require('../../../src/integrations/mbna/source/balanceReconstruction');
      const { formatBalanceHistoryForMonarch } = require('../../../src/integrations/mbna/sinks/monarch/balanceFormatter');

      const result = mbnaSyncHooks.buildBalanceHistory({
        currentBalance: 500,
        metadata: { statements: [{ closingDate: '2024-01-01' }], currentCycle: { settled: [] } },
        fromDate: '2023-12-01',
        invertBalance: false,
      });

      expect(buildBalanceHistory).toHaveBeenCalled();
      expect(formatBalanceHistoryForMonarch).toHaveBeenCalled();
      expect(result).toEqual([{ date: '2024-01-10', amount: -100 }]);
    });

    it('should skip formatting when invertBalance is true', () => {
      const { formatBalanceHistoryForMonarch } = require('../../../src/integrations/mbna/sinks/monarch/balanceFormatter');

      const result = mbnaSyncHooks.buildBalanceHistory({
        currentBalance: 500,
        metadata: { statements: [{ closingDate: '2024-01-01' }], currentCycle: { settled: [] } },
        fromDate: '2023-12-01',
        invertBalance: true,
      });

      expect(formatBalanceHistoryForMonarch).not.toHaveBeenCalled();
      expect(result).toEqual([{ date: '2024-01-10', amount: 100 }]);
    });

    it('should return null when no history', () => {
      const { buildBalanceHistory } = require('../../../src/integrations/mbna/source/balanceReconstruction');
      buildBalanceHistory.mockReturnValueOnce([]);

      const result = mbnaSyncHooks.buildBalanceHistory({
        currentBalance: 500,
        metadata: { statements: [], currentCycle: { settled: [] } },
        fromDate: '2023-12-01',
        invertBalance: false,
      });

      expect(result).toBeNull();
    });
  });

  describe('suggestStartDate', () => {
    it('should return date 30 days before oldest closing date', async () => {
      const mockApi = {
        getClosingDates: jest.fn(() => Promise.resolve([
          '2024-03-15', '2024-02-15', '2024-01-15',
        ])),
      };

      const result = await mbnaSyncHooks.suggestStartDate(mockApi, 'acc-1');

      expect(result).not.toBeNull();
      expect(result.date).toBe('2023-12-16');
      expect(result.description).toBe('30 days before oldest statement');
    });

    it('should return null when no closing dates available', async () => {
      const mockApi = {
        getClosingDates: jest.fn(() => Promise.resolve([])),
      };

      const result = await mbnaSyncHooks.suggestStartDate(mockApi, 'acc-1');

      expect(result).toBeNull();
    });

    it('should return null when API call fails', async () => {
      const mockApi = {
        getClosingDates: jest.fn(() => Promise.reject(new Error('API error'))),
      };

      const result = await mbnaSyncHooks.suggestStartDate(mockApi, 'acc-1');

      expect(result).toBeNull();
    });
  });

  describe('buildAccountEntry', () => {
    it('should build account entry from raw account data', () => {
      const account = {
        accountId: '00240691635',
        endingIn: '4201',
        cardName: 'Amazon.ca Rewards Mastercard®',
        displayName: 'Amazon.ca Rewards Mastercard® (4201)',
      };

      const result = mbnaSyncHooks.buildAccountEntry(account);

      expect(result).toEqual({
        id: '00240691635',
        endingIn: '4201',
        cardName: 'Amazon.ca Rewards Mastercard®',
        nickname: 'Amazon.ca Rewards Mastercard® (4201)',
      });
    });

    it('should use fallback nickname when displayName is missing', () => {
      const account = {
        accountId: '123',
        endingIn: '9999',
        cardName: 'Test Card',
      };

      const result = mbnaSyncHooks.buildAccountEntry(account);

      expect(result).toEqual({
        id: '123',
        endingIn: '9999',
        cardName: 'Test Card',
        nickname: 'MBNA Card (9999)',
      });
    });
  });

  describe('resolveCategories', () => {
    it('should resolve categories (with skipCategorization)', async () => {
      const transactions = [
        { merchant: 'Amazon', autoCategory: null },
        { merchant: 'MBNA Credit Card Payment', autoCategory: 'Credit Card Payment' },
      ];

      const result = await mbnaSyncHooks.resolveCategories(transactions, 'acc-1');

      // With skipCategorization=true, non-auto should get Uncategorized
      expect(result).toHaveLength(2);
      expect(result[0].resolvedMonarchCategory).toBe('Uncategorized');
      expect(result[1].resolvedMonarchCategory).toBe('Credit Card Payment');
    });
  });
});