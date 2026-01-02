/**
 * Tests for Transaction Storage Utilities
 */

import {
  getTransactionRetentionSettings,
  migrateLegacyTransactions,
  applyRetentionLimits,
  saveUploadedTransactions,
  getUploadedTransactionIds,
} from '../../src/utils/transactionStorage';
import { STORAGE, TRANSACTION_RETENTION_DEFAULTS } from '../../src/core/config';
import * as utils from '../../src/core/utils';

// Mock GM functions
global.GM_getValue = jest.fn();
global.GM_setValue = jest.fn();
global.GM_listValues = jest.fn();
global.GM_deleteValue = jest.fn();

// Mock date utilities to use a fixed date for consistent tests
jest.spyOn(utils, 'getTodayLocal').mockReturnValue('2025-10-24');
jest.spyOn(utils, 'parseLocalDate').mockImplementation((dateString) => new Date(dateString));

describe('Transaction Storage Utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getTransactionRetentionSettings', () => {
    test('returns default settings for questrade', () => {
      GM_getValue.mockImplementation((key, defaultValue) => defaultValue);

      const settings = getTransactionRetentionSettings('questrade');

      expect(settings).toEqual({
        days: TRANSACTION_RETENTION_DEFAULTS.DAYS,
        count: TRANSACTION_RETENTION_DEFAULTS.COUNT,
      });
    });

    test('returns default settings for rogersbank', () => {
      GM_getValue.mockImplementation((key, defaultValue) => defaultValue);

      const settings = getTransactionRetentionSettings('rogersbank');

      expect(settings).toEqual({
        days: TRANSACTION_RETENTION_DEFAULTS.DAYS,
        count: TRANSACTION_RETENTION_DEFAULTS.COUNT,
      });
    });

    test('returns custom settings when configured', () => {
      GM_getValue
        .mockReturnValueOnce(60) // days
        .mockReturnValueOnce(750); // count

      const settings = getTransactionRetentionSettings('questrade');

      expect(settings).toEqual({
        days: 60,
        count: 750,
      });
    });
  });

  describe('migrateLegacyTransactions', () => {
    test('migrates array of strings to objects with dates', () => {
      const legacy = ['id1', 'id2', 'id3'];
      const migrated = migrateLegacyTransactions(legacy);

      expect(migrated).toEqual([
        { id: 'id1', date: null },
        { id: 'id2', date: null },
        { id: 'id3', date: null },
      ]);
    });

    test('returns already migrated data unchanged', () => {
      const alreadyMigrated = [
        { id: 'id1', date: '2025-10-20' },
        { id: 'id2', date: '2025-10-21' },
      ];
      const result = migrateLegacyTransactions(alreadyMigrated);

      expect(result).toEqual(alreadyMigrated);
    });

    test('handles empty array', () => {
      expect(migrateLegacyTransactions([])).toEqual([]);
    });

    test('handles non-array input', () => {
      expect(migrateLegacyTransactions(null)).toEqual([]);
      expect(migrateLegacyTransactions(undefined)).toEqual([]);
    });
  });

  describe('applyRetentionLimits', () => {
    test('filters transactions older than retention days', () => {
      const transactions = [
        { id: 'old1', date: '2025-08-01' },
        { id: 'old2', date: '2025-09-01' },
        { id: 'recent1', date: '2025-10-20' },
        { id: 'recent2', date: '2025-10-21' },
      ];
      const settings = { days: 30, count: 1000 };

      const result = applyRetentionLimits(transactions, settings);

      expect(result.length).toBeLessThan(transactions.length);
      expect(result.every((t) => t.date >= '2025-09-24')).toBe(true);
    });

    test('applies count limit when exceeded', () => {
      const transactions = Array.from({ length: 10 }, (_, i) => ({
        id: `id${i}`,
        date: '2025-10-20',
      }));
      const settings = { days: 90, count: 5 };

      const result = applyRetentionLimits(transactions, settings);

      expect(result.length).toBe(5);
    });

    test('handles empty transaction list', () => {
      const result = applyRetentionLimits([], { days: 90, count: 500 });
      expect(result).toEqual([]);
    });

    test('keeps undated transactions when no dated transactions are old', () => {
      const transactions = [
        { id: 'dated1', date: '2025-10-20' },
        { id: 'undated1', date: null },
        { id: 'undated2', date: null },
      ];
      const settings = { days: 30, count: 1000 };

      const result = applyRetentionLimits(transactions, settings);

      expect(result.length).toBe(3);
      expect(result.some((t) => t.id === 'undated1')).toBe(true);
    });
  });

  describe('getUploadedTransactionIds', () => {
    test('returns Set of transaction IDs with correct parameter order', () => {
      const accountId = '12345';
      const institutionType = 'rogersbank';
      const expectedKey = `${STORAGE.ROGERSBANK_UPLOADED_REFS_PREFIX}${accountId}`;

      GM_getValue.mockImplementation((key, defaultValue) => {
        if (key === expectedKey) {
          return [
            { id: 'tx1', date: '2025-10-20' },
            { id: 'tx2', date: '2025-10-21' },
          ];
        }
        return defaultValue;
      });

      const result = getUploadedTransactionIds(accountId, institutionType);

      expect(GM_getValue).toHaveBeenCalledWith(expectedKey, []);
      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(2);
      expect(result.has('tx1')).toBe(true);
      expect(result.has('tx2')).toBe(true);
    });

    test('works correctly for questrade institution', () => {
      const accountId = '67890';
      const institutionType = 'questrade';
      const expectedKey = `${STORAGE.QUESTRADE_UPLOADED_ORDERS_PREFIX}${accountId}`;

      GM_getValue.mockImplementation((key, defaultValue) => {
        if (key === expectedKey) {
          return [
            { id: 'order1', date: '2025-10-20' },
          ];
        }
        return defaultValue;
      });

      const result = getUploadedTransactionIds(accountId, institutionType);

      expect(GM_getValue).toHaveBeenCalledWith(expectedKey, []);
      expect(result.has('order1')).toBe(true);
    });

    test('returns empty Set when no transactions stored', () => {
      GM_getValue.mockReturnValue([]);

      const result = getUploadedTransactionIds('account123', 'rogersbank');

      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(0);
    });
  });

  describe('saveUploadedTransactions', () => {
    test('saves transactions with correct parameter order for rogersbank', () => {
      const accountId = '12345';
      const newTransactions = ['tx1', 'tx2', 'tx3'];
      const institutionType = 'rogersbank';
      const transactionDate = '2025-10-24';
      const expectedKey = `${STORAGE.ROGERSBANK_UPLOADED_REFS_PREFIX}${accountId}`;

      GM_getValue.mockImplementation((key, defaultValue) => {
        if (key === expectedKey) return [];
        return defaultValue;
      });

      saveUploadedTransactions(accountId, newTransactions, institutionType, transactionDate);

      expect(GM_getValue).toHaveBeenCalledWith(expectedKey, []);
      expect(GM_setValue).toHaveBeenCalled();

      const savedData = GM_setValue.mock.calls[0][1];
      expect(savedData).toHaveLength(3);
      expect(savedData[0]).toEqual({ id: 'tx1', date: transactionDate });
    });

    test('saves transactions with correct parameter order for questrade', () => {
      const accountId = '67890';
      const newTransactions = ['order1', 'order2'];
      const institutionType = 'questrade';
      const transactionDate = '2025-10-24';
      const expectedKey = `${STORAGE.QUESTRADE_UPLOADED_ORDERS_PREFIX}${accountId}`;

      GM_getValue.mockImplementation((key, defaultValue) => {
        if (key === expectedKey) return [];
        return defaultValue;
      });

      saveUploadedTransactions(accountId, newTransactions, institutionType, transactionDate);

      expect(GM_getValue).toHaveBeenCalledWith(expectedKey, []);
      expect(GM_setValue).toHaveBeenCalledWith(
        expectedKey,
        expect.arrayContaining([
          { id: 'order1', date: transactionDate },
          { id: 'order2', date: transactionDate },
        ]),
      );
    });

    test('does not duplicate existing transactions', () => {
      const accountId = '12345';
      const existingTransactions = [
        { id: 'tx1', date: '2025-10-20' },
      ];
      const newTransactions = ['tx1', 'tx2']; // tx1 already exists
      const expectedKey = `${STORAGE.ROGERSBANK_UPLOADED_REFS_PREFIX}${accountId}`;

      GM_getValue.mockImplementation((key, defaultValue) => {
        if (key === expectedKey) return existingTransactions;
        return defaultValue;
      });

      saveUploadedTransactions(accountId, newTransactions, 'rogersbank', '2025-10-24');

      const savedData = GM_setValue.mock.calls[0][1];
      expect(savedData).toHaveLength(2); // Only tx1 and tx2
      expect(savedData.filter((t) => t.id === 'tx1')).toHaveLength(1);
    });

    test('applies retention limits after saving', () => {
      const accountId = '12345';
      const existingTransactions = Array.from({ length: 500 }, (_, i) => ({
        id: `old${i}`,
        date: '2025-10-20',
      }));
      const newTransactions = Array.from({ length: 10 }, (_, i) => `new${i}`);

      GM_getValue
        .mockReturnValueOnce(existingTransactions)
        .mockReturnValue(90); // retention days/count

      saveUploadedTransactions(accountId, newTransactions, 'rogersbank', '2025-10-24');

      const savedData = GM_setValue.mock.calls[0][1];
      // Should be limited by retention count (default 500)
      expect(savedData.length).toBeLessThanOrEqual(500);
    });
  });

  describe('Parameter Order Regression Tests', () => {
    test('getUploadedTransactionIds uses correct storage key with (accountId, institutionType)', () => {
      const accountId = '00000645148';
      const institutionType = 'rogersbank';
      const correctKey = `${STORAGE.ROGERSBANK_UPLOADED_REFS_PREFIX}${accountId}`;
      const wrongKey = `${STORAGE.ROGERSBANK_UPLOADED_REFS_PREFIX}${institutionType}`;

      GM_getValue.mockReturnValue([{ id: 'tx1', date: '2025-10-20' }]);

      getUploadedTransactionIds(accountId, institutionType);

      // Should call with correct key
      expect(GM_getValue).toHaveBeenCalledWith(correctKey, []);
      // Should NOT call with swapped key
      expect(GM_getValue).not.toHaveBeenCalledWith(wrongKey, []);
    });

    test('saveUploadedTransactions uses correct storage key with (accountId, newTransactions, institutionType)', () => {
      const accountId = '00000645148';
      const newTransactions = ['tx1', 'tx2'];
      const institutionType = 'rogersbank';
      const correctKey = `${STORAGE.ROGERSBANK_UPLOADED_REFS_PREFIX}${accountId}`;

      GM_getValue.mockReturnValue([]);

      saveUploadedTransactions(accountId, newTransactions, institutionType, '2025-10-24');

      // Should save to correct key
      expect(GM_setValue).toHaveBeenCalledWith(
        correctKey,
        expect.any(Array),
      );
    });

    test('demonstrates the bug when parameters are swapped', () => {
      const accountId = '00000645148';
      const institutionType = 'rogersbank';

      // This is what the bug would do (calling with swapped parameters)
      const wrongKey = `${STORAGE.ROGERSBANK_UPLOADED_REFS_PREFIX}${institutionType}`;

      GM_getValue.mockReturnValue([]);

      // Simulate the bug by manually calling with wrong key
      const buggedResult = GM_getValue(wrongKey, []);

      // With the bug, we'd look in the wrong place and find nothing
      expect(buggedResult).toEqual([]);

      // But the correct call should use accountId in the key
      const correctKey = `${STORAGE.ROGERSBANK_UPLOADED_REFS_PREFIX}${accountId}`;
      expect(correctKey).not.toBe(wrongKey);
      expect(correctKey).toBe('rogersbank_uploaded_refs_00000645148');
      expect(wrongKey).toBe('rogersbank_uploaded_refs_rogersbank');
    });
  });
});
