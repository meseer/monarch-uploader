/**
 * Tests for Wealthsimple Balance Service
 */

import {
  getDefaultDateRange,
  processBalanceData,
  BalanceError,
  accountNeedsBalanceReconstruction,
  reconstructBalanceFromTransactions,
  reconstructBalanceFromCheckpoint,
  calculateCheckpointDate,
  getBalanceAtDate,
  createCurrentBalanceOnly,
  extractDateFromISO,
  filterInvalidBalanceEntries,
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
    test('returns true for supported account types', () => {
      // Only exact matches in WEALTHSIMPLE_TRANSACTION_SUPPORTED_TYPES Set
      expect(accountNeedsBalanceReconstruction('CREDIT_CARD')).toBe(true);
      expect(accountNeedsBalanceReconstruction('PORTFOLIO_LINE_OF_CREDIT')).toBe(true);
    });

    test('returns false for investment accounts', () => {
      expect(accountNeedsBalanceReconstruction('MANAGED_TFSA')).toBe(false);
      expect(accountNeedsBalanceReconstruction('CA_RRSP')).toBe(false);
      expect(accountNeedsBalanceReconstruction('TRADE_TFSA')).toBe(false);
      expect(accountNeedsBalanceReconstruction('brokerage')).toBe(false);
    });

    test('returns false for cash accounts (not yet supported)', () => {
      expect(accountNeedsBalanceReconstruction('CA_CASH')).toBe(false);
      expect(accountNeedsBalanceReconstruction('cash')).toBe(false);
      expect(accountNeedsBalanceReconstruction('CASH')).toBe(false);
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

  describe('reconstructBalanceFromTransactions with startingBalance', () => {
    test('uses starting balance when provided', () => {
      const transactions = [
        { date: '2025-01-01', amount: -100 },
        { date: '2025-01-02', amount: -50 },
      ];

      const result = reconstructBalanceFromTransactions(transactions, '2025-01-01', '2025-01-02', -500);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ date: '2025-01-01', amount: -600 }); // -500 + (-100)
      expect(result[1]).toEqual({ date: '2025-01-02', amount: -650 }); // -600 + (-50)
    });

    test('defaults to 0 starting balance when not provided', () => {
      const transactions = [
        { date: '2025-01-01', amount: -100 },
      ];

      const result = reconstructBalanceFromTransactions(transactions, '2025-01-01', '2025-01-01');

      expect(result[0].amount).toBe(-100); // 0 + (-100)
    });

    test('handles positive starting balance', () => {
      const transactions = [
        { date: '2025-01-01', amount: -50 },
      ];

      const result = reconstructBalanceFromTransactions(transactions, '2025-01-01', '2025-01-01', 100);

      expect(result[0].amount).toBe(50); // 100 + (-50)
    });
  });

  describe('calculateCheckpointDate', () => {
    test('calculates checkpoint date from lastSyncDate minus lookbackDays', () => {
      const result = calculateCheckpointDate('2025-12-10', 2, null);

      expect(result).toBe('2025-12-08');
    });

    test('respects account creation date boundary', () => {
      // If calculated date is before account creation, should return account creation date
      const result = calculateCheckpointDate('2025-12-05', 10, '2025-12-01');

      expect(result).toBe('2025-12-01');
    });

    test('handles ISO timestamp format for account creation', () => {
      const result = calculateCheckpointDate('2025-12-05', 10, '2025-12-01T12:00:00Z');

      expect(result).toBe('2025-12-01');
    });

    test('returns null for missing lastSyncDate', () => {
      const result = calculateCheckpointDate(null, 2, '2025-01-01');

      expect(result).toBeNull();
    });

    test('handles various lookback day values', () => {
      expect(calculateCheckpointDate('2025-12-15', 0, null)).toBe('2025-12-15');
      expect(calculateCheckpointDate('2025-12-15', 1, null)).toBe('2025-12-14');
      expect(calculateCheckpointDate('2025-12-15', 7, null)).toBe('2025-12-08');
      expect(calculateCheckpointDate('2025-12-15', 30, null)).toBe('2025-11-15');
    });
  });

  describe('getBalanceAtDate', () => {
    test('returns balance for exact date match', () => {
      const balanceHistory = [
        { date: '2025-01-01', amount: 100 },
        { date: '2025-01-02', amount: 150 },
        { date: '2025-01-03', amount: 200 },
      ];

      expect(getBalanceAtDate(balanceHistory, '2025-01-02')).toBe(150);
    });

    test('returns null for date not in history', () => {
      const balanceHistory = [
        { date: '2025-01-01', amount: 100 },
        { date: '2025-01-03', amount: 200 },
      ];

      expect(getBalanceAtDate(balanceHistory, '2025-01-02')).toBeNull();
    });

    test('returns null for empty balance history', () => {
      expect(getBalanceAtDate([], '2025-01-01')).toBeNull();
    });

    test('returns null for null or undefined inputs', () => {
      const balanceHistory = [{ date: '2025-01-01', amount: 100 }];

      expect(getBalanceAtDate(null, '2025-01-01')).toBeNull();
      expect(getBalanceAtDate(undefined, '2025-01-01')).toBeNull();
      expect(getBalanceAtDate(balanceHistory, null)).toBeNull();
      expect(getBalanceAtDate(balanceHistory, undefined)).toBeNull();
    });

    test('handles zero balance', () => {
      const balanceHistory = [
        { date: '2025-01-01', amount: 0 },
      ];

      expect(getBalanceAtDate(balanceHistory, '2025-01-01')).toBe(0);
    });
  });

  describe('reconstructBalanceFromCheckpoint', () => {
    test('reconstructs balance from checkpoint to today', () => {
      const checkpoint = { date: '2025-01-01', amount: -100 };
      const transactions = [
        { date: '2025-01-02', amount: -50 },
        { date: '2025-01-03', amount: 75 },
      ];
      const currentBalance = { amount: -75 };

      const result = reconstructBalanceFromCheckpoint(transactions, checkpoint, '2025-01-04', currentBalance);

      expect(result).toHaveLength(4);
      expect(result[0]).toEqual({ date: '2025-01-01', amount: -100 }); // Checkpoint
      expect(result[1]).toEqual({ date: '2025-01-02', amount: -150 }); // -100 + (-50)
      expect(result[2]).toEqual({ date: '2025-01-03', amount: -75 }); // -150 + 75
      expect(result[3]).toEqual({ date: '2025-01-04', amount: -75 }); // Current balance for today
    });

    test('uses current balance for today instead of reconstructed value', () => {
      const checkpoint = { date: '2025-01-01', amount: -100 };
      const transactions = [
        { date: '2025-01-02', amount: -50 },
      ];
      // Even if calculated would be different, we use the actual current balance
      const currentBalance = { amount: -200 };

      const result = reconstructBalanceFromCheckpoint(transactions, checkpoint, '2025-01-03', currentBalance);

      expect(result[result.length - 1]).toEqual({ date: '2025-01-03', amount: -200 });
    });

    test('handles checkpoint date being yesterday', () => {
      const checkpoint = { date: '2025-01-02', amount: -100 };
      const transactions = [];
      const currentBalance = { amount: -100 };

      const result = reconstructBalanceFromCheckpoint(transactions, checkpoint, '2025-01-03', currentBalance);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ date: '2025-01-02', amount: -100 });
      expect(result[1]).toEqual({ date: '2025-01-03', amount: -100 });
    });

    test('returns empty array for invalid checkpoint', () => {
      const transactions = [{ date: '2025-01-01', amount: -100 }];
      const currentBalance = { amount: -100 };

      expect(reconstructBalanceFromCheckpoint(transactions, null, '2025-01-02', currentBalance)).toEqual([]);
      expect(reconstructBalanceFromCheckpoint(transactions, {}, '2025-01-02', currentBalance)).toEqual([]);
      expect(reconstructBalanceFromCheckpoint(transactions, { date: null }, '2025-01-02', currentBalance)).toEqual([]);
    });

    test('returns empty array for invalid toDate', () => {
      const checkpoint = { date: '2025-01-01', amount: -100 };
      const transactions = [];
      const currentBalance = { amount: -100 };

      expect(reconstructBalanceFromCheckpoint(transactions, checkpoint, null, currentBalance)).toEqual([]);
    });

    test('handles empty transactions array', () => {
      const checkpoint = { date: '2025-01-01', amount: -100 };
      const transactions = [];
      const currentBalance = { amount: -100 };

      const result = reconstructBalanceFromCheckpoint(transactions, checkpoint, '2025-01-03', currentBalance);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ date: '2025-01-01', amount: -100 });
      expect(result[1]).toEqual({ date: '2025-01-02', amount: -100 }); // Same as checkpoint, no transactions
      expect(result[2]).toEqual({ date: '2025-01-03', amount: -100 }); // Current balance
    });
  });

  describe('filterInvalidBalanceEntries', () => {
    test('filters out negative balances for CASH accounts', () => {
      const balanceHistory = [
        { date: '2025-01-01', amount: 100 },
        { date: '2025-01-02', amount: -50 }, // Invalid for CASH
        { date: '2025-01-03', amount: 200 },
        { date: '2025-01-04', amount: -100 }, // Invalid for CASH
        { date: '2025-01-05', amount: 300 },
      ];

      const result = filterInvalidBalanceEntries(balanceHistory, 'CASH', null, null);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ date: '2025-01-01', amount: 100 });
      expect(result[1]).toEqual({ date: '2025-01-03', amount: 200 });
      expect(result[2]).toEqual({ date: '2025-01-05', amount: 300 });
    });

    test('filters out negative balances for CASH_USD accounts', () => {
      const balanceHistory = [
        { date: '2025-01-01', amount: 500 },
        { date: '2025-01-02', amount: -1000 }, // Invalid for CASH_USD
        { date: '2025-01-03', amount: 750 },
      ];

      const result = filterInvalidBalanceEntries(balanceHistory, 'CASH_USD', null, null);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ date: '2025-01-01', amount: 500 });
      expect(result[1]).toEqual({ date: '2025-01-03', amount: 750 });
    });

    test('does not filter negative balances for non-CASH account types', () => {
      const balanceHistory = [
        { date: '2025-01-01', amount: 100 },
        { date: '2025-01-02', amount: -50 },
        { date: '2025-01-03', amount: -200 },
      ];

      // Investment accounts can have negative balance (margin, etc.)
      const result = filterInvalidBalanceEntries(balanceHistory, 'MANAGED_TFSA', null, null);

      expect(result).toHaveLength(3);
      expect(result).toEqual(balanceHistory);
    });

    test('corrects today balance with currentBalance for CASH accounts', () => {
      const balanceHistory = [
        { date: '2025-01-01', amount: 100 },
        { date: '2025-01-02', amount: 200 },
        { date: '2025-01-03', amount: -500 }, // API returned wrong negative value
      ];
      const currentBalance = { amount: 634.51, currency: 'CAD' };

      const result = filterInvalidBalanceEntries(balanceHistory, 'CASH', currentBalance, '2025-01-03');

      // Should filter out the negative balance, then add correct today's balance
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ date: '2025-01-01', amount: 100 });
      expect(result[1]).toEqual({ date: '2025-01-02', amount: 200 });
      expect(result[2]).toEqual({ date: '2025-01-03', amount: 634.51 });
    });

    test('adds today balance if missing for CASH accounts', () => {
      const balanceHistory = [
        { date: '2025-01-01', amount: 100 },
        { date: '2025-01-02', amount: 200 },
      ];
      const currentBalance = { amount: 300, currency: 'CAD' };

      const result = filterInvalidBalanceEntries(balanceHistory, 'CASH', currentBalance, '2025-01-03');

      expect(result).toHaveLength(3);
      expect(result[2]).toEqual({ date: '2025-01-03', amount: 300 });
    });

    test('corrects today balance for non-CASH account types', () => {
      const balanceHistory = [
        { date: '2025-01-01', amount: 1000 },
        { date: '2025-01-02', amount: 1100 },
        { date: '2025-01-03', amount: 999 }, // API returned wrong value
      ];
      const currentBalance = { amount: 1200, currency: 'CAD' };

      const result = filterInvalidBalanceEntries(balanceHistory, 'MANAGED_TFSA', currentBalance, '2025-01-03');

      expect(result).toHaveLength(3);
      expect(result[2]).toEqual({ date: '2025-01-03', amount: 1200 });
    });

    test('returns empty array for null input', () => {
      expect(filterInvalidBalanceEntries(null, 'CASH', null, null)).toEqual([]);
      expect(filterInvalidBalanceEntries(undefined, 'CASH', null, null)).toEqual([]);
    });

    test('handles zero balance correctly for CASH accounts', () => {
      const balanceHistory = [
        { date: '2025-01-01', amount: 100 },
        { date: '2025-01-02', amount: 0 }, // Zero is valid
        { date: '2025-01-03', amount: -50 }, // Negative is invalid
      ];

      const result = filterInvalidBalanceEntries(balanceHistory, 'CASH', null, null);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ date: '2025-01-01', amount: 100 });
      expect(result[1]).toEqual({ date: '2025-01-02', amount: 0 });
    });

    test('returns balance history unchanged if no currentBalance provided for non-CASH types', () => {
      const balanceHistory = [
        { date: '2025-01-01', amount: 100 },
        { date: '2025-01-02', amount: 200 },
      ];

      const result = filterInvalidBalanceEntries(balanceHistory, 'MANAGED_TFSA', null, null);

      expect(result).toEqual(balanceHistory);
    });

    test('preserves date order after filtering and adding today balance', () => {
      const balanceHistory = [
        { date: '2025-01-03', amount: 300 },
        { date: '2025-01-01', amount: 100 },
        { date: '2025-01-02', amount: -50 }, // Invalid, will be filtered
      ];
      const currentBalance = { amount: 400, currency: 'CAD' };

      const result = filterInvalidBalanceEntries(balanceHistory, 'CASH', currentBalance, '2025-01-04');

      // Should sort by date after adding today's balance
      expect(result).toHaveLength(3);
      expect(result[0].date).toBe('2025-01-01');
      expect(result[1].date).toBe('2025-01-03');
      expect(result[2].date).toBe('2025-01-04');
    });
  });

  describe('extractDateFromISO', () => {
    test('extracts date from ISO timestamp', () => {
      expect(extractDateFromISO('2025-02-18T21:16:55.685461Z')).toBe('2025-02-18');
    });

    test('extracts date from ISO timestamp with timezone', () => {
      expect(extractDateFromISO('2025-12-31T23:59:59.000000+00:00')).toBe('2025-12-31');
    });

    test('returns YYYY-MM-DD as-is', () => {
      expect(extractDateFromISO('2025-01-15')).toBe('2025-01-15');
    });

    test('returns null for null input', () => {
      expect(extractDateFromISO(null)).toBeNull();
    });

    test('returns null for undefined input', () => {
      expect(extractDateFromISO(undefined)).toBeNull();
    });

    test('returns null for empty string', () => {
      expect(extractDateFromISO('')).toBeNull();
    });

    test('handles various ISO formats', () => {
      expect(extractDateFromISO('2025-06-15T00:00:00Z')).toBe('2025-06-15');
      expect(extractDateFromISO('2025-01-01T12:30:00.000Z')).toBe('2025-01-01');
      expect(extractDateFromISO('2020-03-25T09:15:30.123456+05:30')).toBe('2020-03-25');
    });

    test('returns null for invalid format', () => {
      expect(extractDateFromISO('invalid-date')).toBeNull();
      expect(extractDateFromISO('25-01-2025')).toBeNull();
      expect(extractDateFromISO('2025/01/15')).toBeNull();
    });
  });
});
