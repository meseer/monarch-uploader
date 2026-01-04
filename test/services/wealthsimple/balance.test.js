/**
 * Tests for Wealthsimple Balance Service
 */

import {
  getDefaultDateRange,
  processBalanceData,
  BalanceError,
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
});
