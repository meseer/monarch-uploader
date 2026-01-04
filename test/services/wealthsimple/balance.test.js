/**
 * Tests for Wealthsimple Balance Service
 */

import {
  getDefaultDateRange,
  processBalanceData,
  BalanceError,
  accountNeedsBalanceReconstruction,
  reconstructBalanceFromTransactions,
  createCurrentBalanceOnly,
} from '../../../src/services/wealthsimple/balance';
import { formatDate } from '../../../src/core/utils';

// Mock GM_getValue
global.GM_getValue = jest.fn((key, defaultValue) => defaultValue);

describe('Wealthsimple Balance Service', () => {
  describe('getDefaultDateRange', () => {
    beforeEach(() => {
      global.GM_getValue = jest.fn((key, defaultValue) => defaultValue);
    });

    test('uses account creation date for first sync', () => {
      const accountData = {
        wealthsimpleAccount: {
          id: 'tfsa-123',
          createdAt: '2020-01-01',
        },
        lastSyncDate: null,
      };

      const today = new Date();
      const result = getDefaultDateRange(accountData);

      expect(result.toDate).toBe(formatDate(today));
      expect(result.fromDate).toBe('2020-01-01');
    });

    test('uses account creation date for recently created account', () => {
      const accountData = {
        wealthsimpleAccount: {
          id: 'tfsa-123',
          createdAt: '2025-06-01',
        },
        lastSyncDate: null,
      };

      const result = getDefaultDateRange(accountData);

      expect(result.fromDate).toBe('2025-06-01');
    });

    test('falls back to 1 year ago if createdAt is not available', () => {
      const accountData = {
        wealthsimpleAccount: {
          id: 'tfsa-123',
          createdAt: null,
        },
        lastSyncDate: null,
      };

      const today = new Date();
      const oneYearAgo = new Date(today);
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

      const result = getDefaultDateRange(accountData);

      expect(result.fromDate).toBe(formatDate(oneYearAgo));
    });

    test('uses lastSyncDate minus lookback days for subsequent sync', () => {
      // Mock lookback days to 2
      global.GM_getValue = jest.fn((key, defaultValue) => {
        if (key === 'wealthsimple_lookback_days') return 2;
        return defaultValue;
      });

      const accountData = {
        wealthsimpleAccount: {
          id: 'tfsa-123',
          createdAt: '2020-01-01',
        },
        lastSyncDate: '2025-12-10',
      };

      const result = getDefaultDateRange(accountData);

      // Should be 2 days before last sync date
      expect(result.fromDate).toBe('2025-12-08');
    });

    test('never returns date before account creation', () => {
      global.GM_getValue = jest.fn((key, defaultValue) => {
        if (key === 'wealthsimple_lookback_days') return 10;
        return defaultValue;
      });

      const accountData = {
        wealthsimpleAccount: {
          id: 'tfsa-123',
          createdAt: '2025-12-15',
        },
        lastSyncDate: '2025-12-20',
      };

      const result = getDefaultDateRange(accountData);

      // Should be account creation date, not 10 days before last sync (which would be Dec 10)
      expect(result.fromDate).toBe('2025-12-15');
    });
  });

  describe('processBalanceData', () => {
    test('converts balance history to CSV format', () => {
      const balanceHistory = [
        { date: '2025-12-01', amount: 10000.50, currency: 'CAD' },
        { date: '2025-12-02', amount: 10050.75, currency: 'CAD' },
        { date: '2025-12-03', amount: 10100.00, currency: 'CAD' },
      ];

      const result = processBalanceData(balanceHistory, 'My TFSA');

      expect(result).toContain('"Date","Total Equity","Account Name"');
      expect(result).toContain('"2025-12-01","10000.5","My TFSA"');
      expect(result).toContain('"2025-12-02","10050.75","My TFSA"');
      expect(result).toContain('"2025-12-03","10100","My TFSA"');
    });

    test('throws error for invalid balance history', () => {
      expect(() => processBalanceData(null, 'My TFSA')).toThrow('Invalid balance history data');
      expect(() => processBalanceData('not an array', 'My TFSA')).toThrow('Invalid balance history data');
    });

    test('throws error for missing account name', () => {
      const balanceHistory = [
        { date: '2025-12-01', amount: 10000.50, currency: 'CAD' },
      ];

      expect(() => processBalanceData(balanceHistory, '')).toThrow('Account name is required');
      expect(() => processBalanceData(balanceHistory, null)).toThrow('Account name is required');
    });

    test('handles empty balance history', () => {
      const result = processBalanceData([], 'My TFSA');

      expect(result).toBe('"Date","Total Equity","Account Name"\n');
    });
  });

  describe('BalanceError', () => {
    test('creates error with message and accountId', () => {
      const error = new BalanceError('Test error', 'account-123');

      expect(error.message).toBe('Test error');
      expect(error.accountId).toBe('account-123');
      expect(error.name).toBe('BalanceError');
      expect(error instanceof Error).toBe(true);
    });
  });

  describe('accountNeedsBalanceReconstruction', () => {
    test('returns true for credit card accounts', () => {
      expect(accountNeedsBalanceReconstruction('CA_CREDIT_CARD')).toBe(true);
      expect(accountNeedsBalanceReconstruction('credit_card')).toBe(true);
      expect(accountNeedsBalanceReconstruction('CREDIT')).toBe(true);
    });

    test('returns true for cash accounts', () => {
      expect(accountNeedsBalanceReconstruction('CA_CASH')).toBe(true);
      expect(accountNeedsBalanceReconstruction('cash')).toBe(true);
      expect(accountNeedsBalanceReconstruction('CASH')).toBe(true);
    });

    test('returns false for investment accounts', () => {
      expect(accountNeedsBalanceReconstruction('MANAGED_TFSA')).toBe(false);
      expect(accountNeedsBalanceReconstruction('CA_RRSP')).toBe(false);
      expect(accountNeedsBalanceReconstruction('TRADE_TFSA')).toBe(false);
      expect(accountNeedsBalanceReconstruction('brokerage')).toBe(false);
    });

    test('returns false for null or undefined', () => {
      expect(accountNeedsBalanceReconstruction(null)).toBe(false);
      expect(accountNeedsBalanceReconstruction(undefined)).toBe(false);
      expect(accountNeedsBalanceReconstruction('')).toBe(false);
    });
  });

  describe('reconstructBalanceFromTransactions', () => {
    test('builds daily balance from transactions', () => {
      const transactions = [
        { date: '2025-01-01', amount: -100 }, // Purchase
        { date: '2025-01-02', amount: -50 }, // Purchase
        { date: '2025-01-03', amount: 150 }, // Payment
      ];

      const result = reconstructBalanceFromTransactions(transactions, '2025-01-01', '2025-01-03');

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ date: '2025-01-01', amount: -100 });
      expect(result[1]).toEqual({ date: '2025-01-02', amount: -150 });
      expect(result[2]).toEqual({ date: '2025-01-03', amount: 0 });
    });

    test('handles multiple transactions on same day', () => {
      const transactions = [
        { date: '2025-01-01', amount: -100 },
        { date: '2025-01-01', amount: -50 },
        { date: '2025-01-01', amount: -25 },
      ];

      const result = reconstructBalanceFromTransactions(transactions, '2025-01-01', '2025-01-01');

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ date: '2025-01-01', amount: -175 });
    });

    test('fills days without transactions with previous balance', () => {
      const transactions = [
        { date: '2025-01-01', amount: -100 },
        { date: '2025-01-05', amount: -50 },
      ];

      const result = reconstructBalanceFromTransactions(transactions, '2025-01-01', '2025-01-05');

      expect(result).toHaveLength(5);
      expect(result[0]).toEqual({ date: '2025-01-01', amount: -100 });
      expect(result[1]).toEqual({ date: '2025-01-02', amount: -100 }); // No change
      expect(result[2]).toEqual({ date: '2025-01-03', amount: -100 }); // No change
      expect(result[3]).toEqual({ date: '2025-01-04', amount: -100 }); // No change
      expect(result[4]).toEqual({ date: '2025-01-05', amount: -150 });
    });

    test('returns empty array for null or invalid transactions', () => {
      expect(reconstructBalanceFromTransactions(null, '2025-01-01', '2025-01-03')).toEqual([]);
      expect(reconstructBalanceFromTransactions(undefined, '2025-01-01', '2025-01-03')).toEqual([]);
      expect(reconstructBalanceFromTransactions('not an array', '2025-01-01', '2025-01-03')).toEqual([]);
    });

    test('returns empty array for invalid date range', () => {
      const transactions = [{ date: '2025-01-01', amount: -100 }];
      expect(reconstructBalanceFromTransactions(transactions, null, '2025-01-03')).toEqual([]);
      expect(reconstructBalanceFromTransactions(transactions, '2025-01-01', null)).toEqual([]);
    });

    test('rounds balance to 2 decimal places', () => {
      const transactions = [
        { date: '2025-01-01', amount: -10.333 },
        { date: '2025-01-02', amount: -10.666 },
      ];

      const result = reconstructBalanceFromTransactions(transactions, '2025-01-01', '2025-01-02');

      expect(result[0].amount).toBe(-10.33);
      expect(result[1].amount).toBe(-21);
    });

    test('ignores transactions with missing date or amount', () => {
      const transactions = [
        { date: '2025-01-01', amount: -100 },
        { date: null, amount: -50 },
        { date: '2025-01-02' }, // Missing amount
        { amount: -25 }, // Missing date
      ];

      const result = reconstructBalanceFromTransactions(transactions, '2025-01-01', '2025-01-02');

      expect(result).toHaveLength(2);
      expect(result[0].amount).toBe(-100);
      expect(result[1].amount).toBe(-100);
    });
  });

  describe('createCurrentBalanceOnly', () => {
    test('creates single-day balance entry', () => {
      const currentBalance = { amount: 1234.56, currency: 'CAD' };
      const result = createCurrentBalanceOnly(currentBalance, '2025-12-15');

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ date: '2025-12-15', amount: 1234.56 });
    });

    test('handles zero balance', () => {
      const currentBalance = { amount: 0, currency: 'CAD' };
      const result = createCurrentBalanceOnly(currentBalance, '2025-12-15');

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ date: '2025-12-15', amount: 0 });
    });

    test('handles negative balance (credit card debt)', () => {
      const currentBalance = { amount: -500.25, currency: 'CAD' };
      const result = createCurrentBalanceOnly(currentBalance, '2025-12-15');

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ date: '2025-12-15', amount: -500.25 });
    });

    test('returns empty array for missing current balance', () => {
      expect(createCurrentBalanceOnly(null, '2025-12-15')).toEqual([]);
      expect(createCurrentBalanceOnly(undefined, '2025-12-15')).toEqual([]);
      expect(createCurrentBalanceOnly({}, '2025-12-15')).toEqual([]);
    });

    test('returns empty array for missing date', () => {
      const currentBalance = { amount: 1234.56, currency: 'CAD' };
      expect(createCurrentBalanceOnly(currentBalance, null)).toEqual([]);
      expect(createCurrentBalanceOnly(currentBalance, '')).toEqual([]);
    });
  });
});
