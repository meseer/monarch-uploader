/**
 * Tests for cross-source trade deduplication between Orders API and Activity API
 */

import transactionsService from '../../../src/services/questrade/transactions';
import { cleanString } from '../../../src/services/questrade/transactionRules';

// Mock dependencies (same as transactions.test.js)
jest.mock('../../../src/api/questrade');
jest.mock('../../../src/api/monarch');
jest.mock('../../../src/utils/csv');
jest.mock('../../../src/ui/toast');
jest.mock('../../../src/mappers/category');
jest.mock('../../../src/ui/components/categorySelector');
jest.mock('../../../src/utils/transactionStorage', () => ({
  getTransactionIdsFromArray: jest.fn(() => new Set()),
  getRetentionSettingsFromAccount: jest.fn(() => ({ days: 91, count: 1000 })),
  mergeAndRetainTransactions: jest.fn((existing, newTx) => [...(existing || []), ...newTx]),
}));
jest.mock('../../../src/services/common/accountService', () => ({
  __esModule: true,
  default: {
    getMonarchAccountMapping: jest.fn(),
    getAccountData: jest.fn(),
    upsertAccount: jest.fn(),
    updateAccountInList: jest.fn(),
  },
}));

describe('Cross-Source Trade Deduplication', () => {
  describe('buildOrderSignatures', () => {
    const { buildOrderSignatures } = transactionsService;

    test('builds signatures from executed orders', () => {
      const orders = [
        {
          security: { symbol: 'VGRO.TO', displayName: 'Vanguard Growth ETF' },
          action: 'Buy',
          updatedDateTime: '2024-10-09T14:30:00Z',
        },
        {
          security: { symbol: 'AMZN', displayName: 'Amazon.com' },
          action: 'Sell',
          updatedDateTime: '2025-04-23T10:00:00Z',
        },
      ];

      const signatures = buildOrderSignatures(orders);
      expect(signatures.size).toBe(2);
      expect(signatures.has('vgro.to:2024-10-09:buy')).toBe(true);
      expect(signatures.has('amzn:2025-04-23:sell')).toBe(true);
    });

    test('returns empty set for null/undefined input', () => {
      expect(buildOrderSignatures(null).size).toBe(0);
      expect(buildOrderSignatures(undefined).size).toBe(0);
      expect(buildOrderSignatures([]).size).toBe(0);
    });

    test('skips orders with missing fields', () => {
      const orders = [
        { security: { symbol: 'AAPL' }, action: 'Buy' }, // missing date
        { security: {}, action: 'Sell', updatedDateTime: '2025-01-01T10:00:00Z' }, // missing symbol
        { security: { symbol: 'MSFT' }, updatedDateTime: '2025-01-01T10:00:00Z' }, // missing action
        {
          security: { symbol: 'GOOG' },
          action: 'Buy',
          updatedDateTime: '2025-01-01T10:00:00Z',
        }, // valid
      ];

      const signatures = buildOrderSignatures(orders);
      expect(signatures.size).toBe(1);
      expect(signatures.has('goog:2025-01-01:buy')).toBe(true);
    });

    test('handles date without time component', () => {
      const orders = [
        {
          security: { symbol: 'AAPL' },
          action: 'Buy',
          updatedDateTime: '2025-03-15',
        },
      ];

      const signatures = buildOrderSignatures(orders);
      expect(signatures.has('aapl:2025-03-15:buy')).toBe(true);
    });

    test('deduplicates same-day same-symbol same-action orders', () => {
      const orders = [
        {
          security: { symbol: 'AAPL' },
          action: 'Buy',
          updatedDateTime: '2025-01-15T10:00:00Z',
        },
        {
          security: { symbol: 'AAPL' },
          action: 'Buy',
          updatedDateTime: '2025-01-15T14:00:00Z',
        },
      ];

      const signatures = buildOrderSignatures(orders);
      // Same composite key — Set deduplicates automatically
      expect(signatures.size).toBe(1);
    });

    test('differentiates buy and sell of same symbol on same day', () => {
      const orders = [
        {
          security: { symbol: 'AAPL' },
          action: 'Buy',
          updatedDateTime: '2025-01-15T10:00:00Z',
        },
        {
          security: { symbol: 'AAPL' },
          action: 'Sell',
          updatedDateTime: '2025-01-15T14:00:00Z',
        },
      ];

      const signatures = buildOrderSignatures(orders);
      expect(signatures.size).toBe(2);
      expect(signatures.has('aapl:2025-01-15:buy')).toBe(true);
      expect(signatures.has('aapl:2025-01-15:sell')).toBe(true);
    });
  });

  describe('filterActivityTradesMatchingOrders', () => {
    const { filterActivityTradesMatchingOrders } = transactionsService;

    test('removes activity trades that match order signatures', () => {
      const orderSignatures = new Set(['vgro.to:2024-10-09:buy', 'amzn:2025-04-23:sell']);

      const processedTransactions = [
        {
          transaction: { transactionType: 'Trades', action: 'Buy', symbol: 'VGRO.TO', transactionDate: '2024-10-09' },
          details: {},
          ruleResult: { category: 'Buy' },
        },
        {
          transaction: { transactionType: 'Dividends', action: 'DIV', symbol: 'VGRO.TO', transactionDate: '2024-10-09' },
          details: {},
          ruleResult: { category: 'Dividends & Capital Gains' },
        },
        {
          transaction: { transactionType: 'Trades', action: 'Sell', symbol: 'AMZN', transactionDate: '2025-04-23' },
          details: {},
          ruleResult: { category: 'Sell' },
        },
      ];

      const result = filterActivityTradesMatchingOrders(processedTransactions, orderSignatures);
      expect(result.transactions.length).toBe(1);
      expect(result.matchedTradeCount).toBe(2);
      // Only the dividend should remain
      expect(result.transactions[0].transaction.transactionType).toBe('Dividends');
    });

    test('keeps activity trades that do NOT match any order', () => {
      const orderSignatures = new Set(['vgro.to:2024-10-09:buy']);

      const processedTransactions = [
        {
          transaction: { transactionType: 'Trades', action: 'Buy', symbol: 'AOA', transactionDate: '2024-12-30' },
          details: {},
          ruleResult: { category: 'Buy' },
        },
      ];

      const result = filterActivityTradesMatchingOrders(processedTransactions, orderSignatures);
      expect(result.transactions.length).toBe(1);
      expect(result.matchedTradeCount).toBe(0);
    });

    test('passes through all transactions when orderSignatures is null or empty', () => {
      const processedTransactions = [
        {
          transaction: { transactionType: 'Trades', action: 'Buy', symbol: 'AAPL', transactionDate: '2025-01-15' },
          details: {},
          ruleResult: {},
        },
        {
          transaction: { transactionType: 'Dividends', action: 'DIV', symbol: 'AAPL', transactionDate: '2025-01-15' },
          details: {},
          ruleResult: {},
        },
      ];

      const resultNull = filterActivityTradesMatchingOrders(processedTransactions, null);
      expect(resultNull.transactions.length).toBe(2);
      expect(resultNull.matchedTradeCount).toBe(0);

      const resultEmpty = filterActivityTradesMatchingOrders(processedTransactions, new Set());
      expect(resultEmpty.transactions.length).toBe(2);
      expect(resultEmpty.matchedTradeCount).toBe(0);
    });

    test('handles empty processedTransactions', () => {
      const orderSignatures = new Set(['aapl:2025-01-15:buy']);

      const result = filterActivityTradesMatchingOrders([], orderSignatures);
      expect(result.transactions.length).toBe(0);
      expect(result.matchedTradeCount).toBe(0);
    });

    test('non-trade transactions always pass through', () => {
      const orderSignatures = new Set(['aapl:2025-01-15:buy']);

      const processedTransactions = [
        {
          transaction: { transactionType: 'Dividends', action: 'DIV', symbol: 'AAPL', transactionDate: '2025-01-15' },
          details: {},
          ruleResult: {},
        },
        {
          transaction: { transactionType: 'Deposits', action: 'DEP', transactionDate: '2025-01-15' },
          details: {},
          ruleResult: {},
        },
        {
          transaction: { transactionType: 'FX conversion', action: 'FXT', transactionDate: '2025-01-15' },
          details: {},
          ruleResult: {},
        },
      ];

      const result = filterActivityTradesMatchingOrders(processedTransactions, orderSignatures);
      expect(result.transactions.length).toBe(3);
      expect(result.matchedTradeCount).toBe(0);
    });

    test('uses symbol from details as fallback when not on transaction', () => {
      const orderSignatures = new Set(['aapl:2025-01-15:buy']);

      const processedTransactions = [
        {
          transaction: { transactionType: 'Trades', action: 'Buy', transactionDate: '2025-01-15' },
          details: { symbol: 'AAPL' },
          ruleResult: {},
        },
      ];

      const result = filterActivityTradesMatchingOrders(processedTransactions, orderSignatures);
      expect(result.transactions.length).toBe(0);
      expect(result.matchedTradeCount).toBe(1);
    });

    test('case-insensitive matching', () => {
      const orderSignatures = new Set(['aapl:2025-01-15:buy']);

      const processedTransactions = [
        {
          transaction: { transactionType: 'Trades', action: 'Buy', symbol: 'AAPL', transactionDate: '2025-01-15' },
          details: {},
          ruleResult: {},
        },
      ];

      const result = filterActivityTradesMatchingOrders(processedTransactions, orderSignatures);
      expect(result.matchedTradeCount).toBe(1);
    });

    test('handles date with time component', () => {
      const orderSignatures = new Set(['aapl:2025-01-15:buy']);

      const processedTransactions = [
        {
          transaction: { transactionType: 'Trades', action: 'Buy', symbol: 'AAPL', transactionDate: '2025-01-15T14:30:00Z' },
          details: {},
          ruleResult: {},
        },
      ];

      const result = filterActivityTradesMatchingOrders(processedTransactions, orderSignatures);
      expect(result.matchedTradeCount).toBe(1);
    });
  });

  describe('formatTradeNotes (via cleanString import)', () => {
    // cleanString is imported to verify it's available
    test('cleanString helper works for trade data normalization', () => {
      expect(cleanString(null)).toBe('');
      expect(cleanString('  AAPL  ')).toBe('AAPL');
      expect(cleanString(undefined)).toBe('');
    });
  });
});