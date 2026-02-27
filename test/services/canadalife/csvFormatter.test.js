/**
 * Tests for Canada Life CSV Formatter
 */

import { convertCanadaLifeTransactionsToMonarchCSV } from '../../../src/services/canadalife/csvFormatter';

// Mock dependencies
jest.mock('../../../src/core/utils', () => ({
  debugLog: jest.fn(),
}));

jest.mock('../../../src/utils/csv', () => ({
  convertToCSV: jest.fn((rows, columns) => {
    // Simple faithful mock: return header + rows as pipe-separated strings
    const header = columns.join('|');
    const dataRows = rows.map((row) => columns.map((col) => String(row[col] ?? '')).join('|'));
    return [header, ...dataRows].join('\n');
  }),
}));

afterEach(() => {
  jest.clearAllMocks();
});

describe('convertCanadaLifeTransactionsToMonarchCSV', () => {
  const accountName = 'My Canada Life RRSP';

  describe('empty / null input', () => {
    test('returns empty string for empty array', () => {
      expect(convertCanadaLifeTransactionsToMonarchCSV([], accountName)).toBe('');
    });

    test('returns empty string for null', () => {
      expect(convertCanadaLifeTransactionsToMonarchCSV(null, accountName)).toBe('');
    });

    test('returns empty string for undefined', () => {
      expect(convertCanadaLifeTransactionsToMonarchCSV(undefined, accountName)).toBe('');
    });
  });

  describe('settled transactions', () => {
    test('passes through a settled transaction with correct columns', () => {
      const { convertToCSV } = require('../../../src/utils/csv');

      const transactions = [
        {
          date: '2024-01-15',
          merchant: 'Sun Life MFS Global Growth Fund',
          category: 'Buy',
          originalMerchant: 'Sun Life MFS Global Growth Fund-Member',
          notes: 'New contribution: Bought 5.1234 units @ $19.62',
          amount: 100.5,
          isPending: false,
          pendingId: 'cl-tx:abcdef1234567890',
          id: 'cl-tx:abcdef1234567890',
        },
      ];

      convertCanadaLifeTransactionsToMonarchCSV(transactions, accountName);

      expect(convertToCSV).toHaveBeenCalledTimes(1);
      const [rows, columns] = convertToCSV.mock.calls[0];

      // Verify columns
      expect(columns).toEqual([
        'Date', 'Merchant', 'Category', 'Account',
        'Original Statement', 'Notes', 'Amount', 'Tags',
      ]);

      // Verify settled row values
      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect(row.Date).toBe('2024-01-15');
      expect(row.Merchant).toBe('Sun Life MFS Global Growth Fund');
      expect(row.Category).toBe('Buy');
      expect(row.Account).toBe(accountName);
      expect(row['Original Statement']).toBe('Sun Life MFS Global Growth Fund-Member');
      expect(row.Amount).toBe(100.5);
    });

    test('Tags is empty string for settled transaction', () => {
      const { convertToCSV } = require('../../../src/utils/csv');

      const transactions = [
        {
          date: '2024-01-15',
          merchant: 'Test Fund',
          category: 'Buy',
          notes: 'Some notes',
          amount: 50,
          isPending: false,
          pendingId: 'cl-tx:1234567890abcdef',
        },
      ];

      convertCanadaLifeTransactionsToMonarchCSV(transactions, accountName);

      const [rows] = convertToCSV.mock.calls[0];
      expect(rows[0].Tags).toBe('');
    });

    test('Notes does NOT include pendingId for settled transaction', () => {
      const { convertToCSV } = require('../../../src/utils/csv');

      const transactions = [
        {
          date: '2024-01-15',
          merchant: 'Test Fund',
          category: 'Sell',
          notes: 'New contribution (reversed): Sold 2.5 units @ $20.00',
          amount: -50,
          isPending: false,
          pendingId: 'cl-tx:1234567890abcdef',
        },
      ];

      convertCanadaLifeTransactionsToMonarchCSV(transactions, accountName);

      const [rows] = convertToCSV.mock.calls[0];
      expect(rows[0].Notes).toBe('New contribution (reversed): Sold 2.5 units @ $20.00');
      expect(rows[0].Notes).not.toContain('cl-tx:');
    });

    test('preserves positive amount for Buy transaction', () => {
      const { convertToCSV } = require('../../../src/utils/csv');

      const transactions = [
        {
          date: '2024-02-01',
          merchant: 'Equity Fund',
          category: 'Buy',
          notes: '',
          amount: 250.75,
          isPending: false,
          pendingId: 'cl-tx:aabbccddeeff0011',
        },
      ];

      convertCanadaLifeTransactionsToMonarchCSV(transactions, accountName);

      const [rows] = convertToCSV.mock.calls[0];
      expect(rows[0].Amount).toBe(250.75);
    });

    test('preserves negative amount for Sell transaction', () => {
      const { convertToCSV } = require('../../../src/utils/csv');

      const transactions = [
        {
          date: '2024-02-01',
          merchant: 'Equity Fund',
          category: 'Sell',
          notes: '',
          amount: -150.00,
          isPending: false,
          pendingId: 'cl-tx:aabbccddeeff0022',
        },
      ];

      convertCanadaLifeTransactionsToMonarchCSV(transactions, accountName);

      const [rows] = convertToCSV.mock.calls[0];
      expect(rows[0].Amount).toBe(-150.00);
    });

    test('falls back to Uncategorized when category is missing', () => {
      const { convertToCSV } = require('../../../src/utils/csv');

      const transactions = [
        {
          date: '2024-01-15',
          merchant: 'Test Fund',
          notes: '',
          amount: 100,
          isPending: false,
        },
      ];

      convertCanadaLifeTransactionsToMonarchCSV(transactions, accountName);

      const [rows] = convertToCSV.mock.calls[0];
      expect(rows[0].Category).toBe('Uncategorized');
    });
  });

  describe('pending transactions', () => {
    test('Tags is "Pending" for pending transaction', () => {
      const { convertToCSV } = require('../../../src/utils/csv');

      const transactions = [
        {
          date: '2024-01-15',
          merchant: 'Canadian Equity Index',
          category: 'Buy',
          notes: 'New contribution  - awaiting investment: Pending - awaiting investment',
          amount: 200,
          isPending: true,
          pendingId: 'cl-tx:fedcba9876543210',
        },
      ];

      convertCanadaLifeTransactionsToMonarchCSV(transactions, accountName);

      const [rows] = convertToCSV.mock.calls[0];
      expect(rows[0].Tags).toBe('Pending');
    });

    test('Notes includes pendingId on a new line for pending transaction', () => {
      const { convertToCSV } = require('../../../src/utils/csv');

      const pendingId = 'cl-tx:fedcba9876543210';
      const activityNotes = 'New contribution  - awaiting investment: Pending - awaiting investment';

      const transactions = [
        {
          date: '2024-01-15',
          merchant: 'Canadian Equity Index',
          category: 'Buy',
          notes: activityNotes,
          amount: 200,
          isPending: true,
          pendingId,
        },
      ];

      convertCanadaLifeTransactionsToMonarchCSV(transactions, accountName);

      const [rows] = convertToCSV.mock.calls[0];
      expect(rows[0].Notes).toBe(`${activityNotes}\n${pendingId}`);
    });

    test('Notes is just pendingId when activity notes are empty', () => {
      const { convertToCSV } = require('../../../src/utils/csv');

      const pendingId = 'cl-tx:1122334455667788';

      const transactions = [
        {
          date: '2024-01-15',
          merchant: 'Some Fund',
          category: 'Buy',
          notes: '',
          amount: 100,
          isPending: true,
          pendingId,
        },
      ];

      convertCanadaLifeTransactionsToMonarchCSV(transactions, accountName);

      const [rows] = convertToCSV.mock.calls[0];
      expect(rows[0].Notes).toBe(pendingId);
    });

    test('pending transaction without pendingId does not append undefined to notes', () => {
      const { convertToCSV } = require('../../../src/utils/csv');

      const transactions = [
        {
          date: '2024-01-15',
          merchant: 'Some Fund',
          category: 'Buy',
          notes: 'Some notes',
          amount: 100,
          isPending: true,
          // no pendingId
        },
      ];

      convertCanadaLifeTransactionsToMonarchCSV(transactions, accountName);

      const [rows] = convertToCSV.mock.calls[0];
      expect(rows[0].Notes).toBe('Some notes');
      expect(rows[0].Notes).not.toContain('undefined');
    });
  });

  describe('mixed transactions', () => {
    test('handles mix of settled and pending transactions correctly', () => {
      const { convertToCSV } = require('../../../src/utils/csv');

      const transactions = [
        {
          date: '2024-01-14',
          merchant: 'Settled Fund',
          category: 'Buy',
          notes: 'Settled notes',
          amount: 100,
          isPending: false,
          pendingId: 'cl-tx:aaaa1111bbbb2222',
        },
        {
          date: '2024-01-15',
          merchant: 'Pending Fund',
          category: 'Buy',
          notes: 'Pending notes',
          amount: 200,
          isPending: true,
          pendingId: 'cl-tx:cccc3333dddd4444',
        },
      ];

      convertCanadaLifeTransactionsToMonarchCSV(transactions, accountName);

      const [rows] = convertToCSV.mock.calls[0];
      expect(rows).toHaveLength(2);

      const settledRow = rows[0];
      const pendingRow = rows[1];

      expect(settledRow.Tags).toBe('');
      expect(settledRow.Notes).toBe('Settled notes');

      expect(pendingRow.Tags).toBe('Pending');
      expect(pendingRow.Notes).toContain('cl-tx:cccc3333dddd4444');
    });

    test('passes all transactions to convertToCSV', () => {
      const { convertToCSV } = require('../../../src/utils/csv');

      const transactions = Array.from({ length: 5 }, (_, i) => ({
        date: `2024-01-${String(i + 1).padStart(2, '0')}`,
        merchant: `Fund ${i}`,
        category: 'Buy',
        notes: '',
        amount: (i + 1) * 10,
        isPending: false,
        pendingId: `cl-tx:${String(i).padStart(16, '0')}`,
      }));

      convertCanadaLifeTransactionsToMonarchCSV(transactions, accountName);

      const [rows] = convertToCSV.mock.calls[0];
      expect(rows).toHaveLength(5);
    });
  });

  describe('account name', () => {
    test('uses provided accountName in Account column for all rows', () => {
      const { convertToCSV } = require('../../../src/utils/csv');
      const customAccount = 'My Custom RRSP Account';

      const transactions = [
        {
          date: '2024-01-15', merchant: 'Fund A', category: 'Buy',
          notes: '', amount: 100, isPending: false,
        },
        {
          date: '2024-01-16', merchant: 'Fund B', category: 'Sell',
          notes: '', amount: -50, isPending: false,
        },
      ];

      convertCanadaLifeTransactionsToMonarchCSV(transactions, customAccount);

      const [rows] = convertToCSV.mock.calls[0];
      expect(rows[0].Account).toBe(customAccount);
      expect(rows[1].Account).toBe(customAccount);
    });
  });
});