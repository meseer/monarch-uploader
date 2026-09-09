/**
 * Tests for Transaction Storage Utilities
 * Tests pure logic functions for transaction ID management
 */

import {
  migrateLegacyTransactions,
  applyRetentionLimits,
  getRetentionSettingsFromAccount,
  getTransactionIdsFromArray,
  mergeAndRetainTransactions,
  getTransactionsNewestFirst,
} from '../../src/utils/transactionStorage';
import { TRANSACTION_RETENTION_DEFAULTS } from '../../src/core/config';
import * as utils from '../../src/core/utils';

// Mock date utilities to use a fixed date for consistent tests
jest.spyOn(utils, 'getTodayLocal').mockReturnValue('2025-10-24');
jest.spyOn(utils, 'parseLocalDate').mockImplementation((dateString) => new Date(dateString));

describe('Transaction Storage Utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getRetentionSettingsFromAccount', () => {
    test('returns default settings when account has no retention config', () => {
      const accountData = {};
      const settings = getRetentionSettingsFromAccount(accountData);

      expect(settings).toEqual({
        days: TRANSACTION_RETENTION_DEFAULTS.DAYS,
        count: TRANSACTION_RETENTION_DEFAULTS.COUNT,
      });
    });

    test('returns custom settings from account', () => {
      const accountData = {
        transactionRetentionDays: 60,
        transactionRetentionCount: 500,
      };
      const settings = getRetentionSettingsFromAccount(accountData);

      expect(settings).toEqual({
        days: 60,
        count: 500,
      });
    });

    test('handles null account data', () => {
      const settings = getRetentionSettingsFromAccount(null);

      expect(settings).toEqual({
        days: TRANSACTION_RETENTION_DEFAULTS.DAYS,
        count: TRANSACTION_RETENTION_DEFAULTS.COUNT,
      });
    });

    test('handles undefined account data', () => {
      const settings = getRetentionSettingsFromAccount(undefined);

      expect(settings).toEqual({
        days: TRANSACTION_RETENTION_DEFAULTS.DAYS,
        count: TRANSACTION_RETENTION_DEFAULTS.COUNT,
      });
    });

    test('uses defaults for missing individual settings', () => {
      const accountData = {
        transactionRetentionDays: 45,
        // transactionRetentionCount is missing
      };
      const settings = getRetentionSettingsFromAccount(accountData);

      expect(settings).toEqual({
        days: 45,
        count: TRANSACTION_RETENTION_DEFAULTS.COUNT,
      });
    });
  });

  describe('migrateLegacyTransactions', () => {
    test('migrates array of strings to objects with dates', () => {
      const legacy = ['id1', 'id2', 'id3'];
      const migrated = migrateLegacyTransactions(legacy);

      expect(migrated).toEqual([
        { id: 'id1', date: null, merchant: null },
        { id: 'id2', date: null, merchant: null },
        { id: 'id3', date: null, merchant: null },
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

    test('handles null input', () => {
      expect(migrateLegacyTransactions(null)).toEqual([]);
    });

    test('handles undefined input', () => {
      expect(migrateLegacyTransactions(undefined)).toEqual([]);
    });

    test('converts non-string IDs to strings', () => {
      const legacy = [123, 456];
      const migrated = migrateLegacyTransactions(legacy);

      expect(migrated).toEqual([
        { id: '123', date: null, merchant: null },
        { id: '456', date: null, merchant: null },
      ]);
    });
  });

  describe('getTransactionsNewestFirst', () => {
    test('reverses the stored oldest-first order', () => {
      const stored = [
        { id: 'oldest', date: '2025-10-20' },
        { id: 'middle', date: '2025-10-21' },
        { id: 'newest', date: '2025-10-22' },
      ];

      const result = getTransactionsNewestFirst(stored);

      expect(result.map((t) => t.id)).toEqual(['newest', 'middle', 'oldest']);
    });

    test('does not mutate the input array', () => {
      const stored = [{ id: 'a', date: '2025-10-20' }, { id: 'b', date: '2025-10-21' }];

      getTransactionsNewestFirst(stored);

      expect(stored.map((t) => t.id)).toEqual(['a', 'b']);
    });

    test('is a plain reversal, not a re-sort (out-of-order input stays out of order)', () => {
      // An insertion-order bug must remain visible rather than being corrected.
      const misordered = [
        { id: 'newest', date: '2025-10-22' },
        { id: 'oldest', date: '2025-10-20' },
      ];

      const result = getTransactionsNewestFirst(misordered);

      expect(result.map((t) => t.id)).toEqual(['oldest', 'newest']);
    });

    test('preserves merchant on each entry', () => {
      const stored = [{ id: 'tx1', date: '2025-10-20', merchant: 'AMAZON' }];

      const result = getTransactionsNewestFirst(stored);

      expect(result[0].merchant).toBe('AMAZON');
    });

    test('returns empty array for null input', () => {
      expect(getTransactionsNewestFirst(null)).toEqual([]);
    });

    test('returns empty array for undefined input', () => {
      expect(getTransactionsNewestFirst(undefined)).toEqual([]);
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

    test('handles null input', () => {
      const result = applyRetentionLimits(null, { days: 90, count: 500 });
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

    test('removes undated transactions when dated transactions are old', () => {
      const transactions = [
        { id: 'old', date: '2025-08-01' }, // Older than 30 days
        { id: 'recent', date: '2025-10-20' },
        { id: 'undated', date: null },
      ];
      const settings = { days: 30, count: 1000 };

      const result = applyRetentionLimits(transactions, settings);

      // Old dated transaction is removed, undated should also be removed
      expect(result.some((t) => t.id === 'undated')).toBe(false);
      expect(result.some((t) => t.id === 'recent')).toBe(true);
      expect(result.some((t) => t.id === 'old')).toBe(false);
    });

    test('count limit keeps the tail (newest) and drops from the head (oldest)', () => {
      // Storage is oldest-first, so the newest entries live at the end.
      const transactions = [
        { id: 'oldest', date: '2025-10-20' },
        { id: 'middle', date: '2025-10-21' },
        { id: 'newest', date: '2025-10-22' },
      ];
      const settings = { days: 90, count: 2 };

      const result = applyRetentionLimits(transactions, settings);

      expect(result.map((t) => t.id)).toEqual(['middle', 'newest']);
    });

    test('preserves the stored order rather than re-sorting', () => {
      // An out-of-order list must come back out of order: ordering is owned by
      // insertion time, so a caller bug stays visible.
      const transactions = [
        { id: 'b', date: '2025-10-22' },
        { id: 'a', date: '2025-10-20' },
        { id: 'c', date: '2025-10-21' },
      ];
      const settings = { days: 90, count: 1000 };

      const result = applyRetentionLimits(transactions, settings);

      expect(result.map((t) => t.id)).toEqual(['b', 'a', 'c']);
    });

    test('keeps undated legacy entries at their original position', () => {
      const transactions = [
        { id: 'undated1', date: null },
        { id: 'undated2', date: null },
        { id: 'dated', date: '2025-10-22' },
      ];
      const settings = { days: 30, count: 1000 };

      const result = applyRetentionLimits(transactions, settings);

      expect(result.map((t) => t.id)).toEqual(['undated1', 'undated2', 'dated']);
    });

    test('preserves merchant through retention', () => {
      const transactions = [{ id: 'tx1', date: '2025-10-22', merchant: 'AMAZON' }];

      const result = applyRetentionLimits(transactions, { days: 90, count: 1000 });

      expect(result[0].merchant).toBe('AMAZON');
    });

    describe('unlimited retention (0)', () => {
      test('days: 0 keeps transactions of any age', () => {
        const transactions = [
          { id: 'ancient', date: '2020-01-01' },
          { id: 'recent', date: '2025-10-22' },
        ];

        const result = applyRetentionLimits(transactions, { days: 0, count: 1000 });

        expect(result.map((t) => t.id)).toEqual(['ancient', 'recent']);
      });

      test('days: 0 keeps undated legacy entries', () => {
        const transactions = [
          { id: 'undated', date: null },
          { id: 'ancient', date: '2020-01-01' },
        ];

        const result = applyRetentionLimits(transactions, { days: 0, count: 1000 });

        expect(result.map((t) => t.id)).toEqual(['undated', 'ancient']);
      });

      test('count: 0 keeps every transaction', () => {
        const transactions = Array.from({ length: 50 }, (_, i) => ({
          id: `id${i}`,
          date: '2025-10-22',
        }));

        const result = applyRetentionLimits(transactions, { days: 90, count: 0 });

        expect(result.length).toBe(50);
      });

      test('days: 0 and count: 0 together keep everything', () => {
        const transactions = [
          { id: 'ancient', date: '2020-01-01' },
          { id: 'undated', date: null },
          { id: 'recent', date: '2025-10-22' },
        ];

        const result = applyRetentionLimits(transactions, { days: 0, count: 0 });

        expect(result.map((t) => t.id)).toEqual(['ancient', 'undated', 'recent']);
      });

      test('treats negative limits as unlimited', () => {
        const transactions = [
          { id: 'ancient', date: '2020-01-01' },
          { id: 'recent', date: '2025-10-22' },
        ];

        const result = applyRetentionLimits(transactions, { days: -1, count: -1 });

        expect(result.length).toBe(2);
      });
    });
  });

  describe('getTransactionIdsFromArray', () => {
    test('returns Set of IDs from transaction array', () => {
      const transactions = [
        { id: 'tx1', date: '2025-10-20' },
        { id: 'tx2', date: '2025-10-21' },
      ];

      const result = getTransactionIdsFromArray(transactions);

      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(2);
      expect(result.has('tx1')).toBe(true);
      expect(result.has('tx2')).toBe(true);
    });

    test('handles legacy string array format', () => {
      const legacyTransactions = ['id1', 'id2', 'id3'];

      const result = getTransactionIdsFromArray(legacyTransactions);

      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(3);
      expect(result.has('id1')).toBe(true);
    });

    test('returns empty Set for null input', () => {
      const result = getTransactionIdsFromArray(null);

      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(0);
    });

    test('returns empty Set for undefined input', () => {
      const result = getTransactionIdsFromArray(undefined);

      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(0);
    });

    test('returns empty Set for empty array', () => {
      const result = getTransactionIdsFromArray([]);

      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(0);
    });
  });

  describe('mergeAndRetainTransactions', () => {
    test('merges new transactions with existing and applies retention', () => {
      const existing = [
        { id: 'tx1', date: '2025-10-20' },
      ];
      const newTransactions = ['tx2', 'tx3'];
      const settings = { days: 90, count: 1000 };

      const result = mergeAndRetainTransactions(existing, newTransactions, settings, '2025-10-24');

      expect(result.length).toBe(3);
      expect(result.some((t) => t.id === 'tx1')).toBe(true);
      expect(result.some((t) => t.id === 'tx2')).toBe(true);
      expect(result.some((t) => t.id === 'tx3')).toBe(true);
    });

    test('skips duplicate transactions', () => {
      const existing = [
        { id: 'tx1', date: '2025-10-20' },
      ];
      const newTransactions = ['tx1', 'tx2']; // tx1 already exists
      const settings = { days: 90, count: 1000 };

      const result = mergeAndRetainTransactions(existing, newTransactions, settings, '2025-10-24');

      expect(result.length).toBe(2);
      expect(result.filter((t) => t.id === 'tx1').length).toBe(1);
    });

    test('preserves date from transaction objects', () => {
      const existing = [];
      const newTransactions = [
        { id: 'tx1', date: '2025-10-22' },
        { id: 'tx2', date: '2025-10-23' },
      ];
      const settings = { days: 90, count: 1000 };

      const result = mergeAndRetainTransactions(existing, newTransactions, settings, '2025-10-24');

      expect(result.length).toBe(2);
      const tx1 = result.find((t) => t.id === 'tx1');
      expect(tx1.date).toBe('2025-10-22');
    });

    test('uses default date for string transactions', () => {
      const existing = [];
      const newTransactions = ['tx1', 'tx2'];
      const settings = { days: 90, count: 1000 };
      const defaultDate = '2025-10-24';

      const result = mergeAndRetainTransactions(existing, newTransactions, settings, defaultDate);

      expect(result.every((t) => t.date === defaultDate)).toBe(true);
    });

    test('uses today as default date when not provided', () => {
      const existing = [];
      const newTransactions = ['tx1'];
      const settings = { days: 90, count: 1000 };

      const result = mergeAndRetainTransactions(existing, newTransactions, settings);

      expect(result[0].date).toBe('2025-10-24'); // Mocked today
    });

    test('handles legacy existing format', () => {
      const existing = ['tx1', 'tx2']; // Legacy string format
      const newTransactions = ['tx3'];
      const settings = { days: 90, count: 1000 };

      const result = mergeAndRetainTransactions(existing, newTransactions, settings, '2025-10-24');

      expect(result.length).toBe(3);
      // Legacy transactions should have null date
      const tx1 = result.find((t) => t.id === 'tx1');
      expect(tx1.date).toBe(null);
    });

    test('applies count limit', () => {
      const existing = Array.from({ length: 10 }, (_, i) => ({
        id: `old${i}`,
        date: '2025-10-20',
      }));
      const newTransactions = ['new1', 'new2'];
      const settings = { days: 90, count: 5 };

      const result = mergeAndRetainTransactions(existing, newTransactions, settings, '2025-10-24');

      expect(result.length).toBe(5);
    });

    test('handles empty existing array', () => {
      const existing = [];
      const newTransactions = ['tx1', 'tx2'];
      const settings = { days: 90, count: 1000 };

      const result = mergeAndRetainTransactions(existing, newTransactions, settings, '2025-10-24');

      expect(result.length).toBe(2);
    });

    test('handles empty new transactions array', () => {
      const existing = [
        { id: 'tx1', date: '2025-10-20' },
      ];
      const newTransactions = [];
      const settings = { days: 90, count: 1000 };

      const result = mergeAndRetainTransactions(existing, newTransactions, settings, '2025-10-24');

      expect(result.length).toBe(1);
      expect(result[0].id).toBe('tx1');
    });

    test('handles mixed format new transactions', () => {
      const existing = [];
      const newTransactions = [
        'stringId',
        { id: 'objectId', date: '2025-10-22' },
        { id: 'objectWithoutDate' },
      ];
      const settings = { days: 90, count: 1000 };
      const defaultDate = '2025-10-24';

      const result = mergeAndRetainTransactions(existing, newTransactions, settings, defaultDate);

      expect(result.length).toBe(3);
      expect(result.find((t) => t.id === 'stringId').date).toBe(defaultDate);
      expect(result.find((t) => t.id === 'objectId').date).toBe('2025-10-22');
      expect(result.find((t) => t.id === 'objectWithoutDate').date).toBe(defaultDate);
    });

    test('appends new transactions at the tail, preserving oldest-first order', () => {
      const existing = [
        { id: 'old1', date: '2025-10-20' },
        { id: 'old2', date: '2025-10-21' },
      ];
      // Callers pass new transactions oldest-first
      const newTransactions = [
        { id: 'new1', date: '2025-10-22' },
        { id: 'new2', date: '2025-10-23' },
      ];
      const settings = { days: 90, count: 1000 };

      const result = mergeAndRetainTransactions(existing, newTransactions, settings, '2025-10-24');

      expect(result.map((t) => t.id)).toEqual(['old1', 'old2', 'new1', 'new2']);
    });

    test('count limit drops the oldest entries from the head', () => {
      const existing = [
        { id: 'oldest', date: '2025-10-20' },
        { id: 'older', date: '2025-10-21' },
      ];
      const newTransactions = [{ id: 'newest', date: '2025-10-22' }];
      const settings = { days: 90, count: 2 };

      const result = mergeAndRetainTransactions(existing, newTransactions, settings, '2025-10-24');

      expect(result.map((t) => t.id)).toEqual(['older', 'newest']);
    });

    test('preserves merchant from new transaction records', () => {
      const existing = [];
      const newTransactions = [
        { id: 'tx1', date: '2025-10-22', merchant: 'AMAZON' },
        { id: 'tx2', date: '2025-10-23', merchant: 'STARBUCKS' },
      ];
      const settings = { days: 90, count: 1000 };

      const result = mergeAndRetainTransactions(existing, newTransactions, settings, '2025-10-24');

      expect(result.find((t) => t.id === 'tx1').merchant).toBe('AMAZON');
      expect(result.find((t) => t.id === 'tx2').merchant).toBe('STARBUCKS');
    });

    test('sets merchant to null for string refs and records without merchant', () => {
      const existing = [];
      const newTransactions = ['stringId', { id: 'objectId', date: '2025-10-22' }];
      const settings = { days: 90, count: 1000 };

      const result = mergeAndRetainTransactions(existing, newTransactions, settings, '2025-10-24');

      expect(result.find((t) => t.id === 'stringId').merchant).toBe(null);
      expect(result.find((t) => t.id === 'objectId').merchant).toBe(null);
    });
  });
});
