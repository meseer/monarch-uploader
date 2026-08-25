/**
 * Tests for CSV Conversion Utilities
 *
 * Wealthsimple coverage lives in csv.wealthsimple.test.js (file-size limit).
 */

import {
  convertToCSV,
  convertTransactionsToMonarchCSV,
  convertMbnaTransactionsToMonarchCSV,
  convertQuestradeOrdersToMonarchCSV,
  parseCSV,
} from '../../src/utils/csv';

// Mock dependencies
jest.mock('../../src/core/utils', () => ({
  debugLog: jest.fn(),
}));

jest.mock('../../src/mappers/merchant', () => ({
  applyMerchantMapping: jest.fn((merchant) => merchant || 'Unknown Merchant'),
}));

jest.mock('../../src/mappers/category', () => ({
  applyCategoryMapping: jest.fn((category) => category || 'Uncategorized'),
}));

describe('CSV Conversion Utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('convertToCSV', () => {
    test('should convert array of objects to CSV string', () => {
      const data = [
        { name: 'John', age: 30, city: 'New York' },
        { name: 'Jane', age: 25, city: 'Los Angeles' },
        { name: 'Bob', age: 35, city: 'Chicago' },
      ];

      const result = convertToCSV(data);
      const expectedCSV = 'name,age,city\nJohn,30,New York\nJane,25,Los Angeles\nBob,35,Chicago';

      expect(result).toBe(expectedCSV);
    });

    test('should use provided columns array', () => {
      const data = [
        { name: 'John', age: 30, city: 'New York', country: 'USA' },
        { name: 'Jane', age: 25, city: 'Los Angeles', country: 'USA' },
      ];
      const columns = ['name', 'city'];

      const result = convertToCSV(data, columns);
      const expectedCSV = 'name,city\nJohn,New York\nJane,Los Angeles';

      expect(result).toBe(expectedCSV);
    });

    test('should escape CSV special characters', () => {
      const data = [
        { name: 'John, Jr.', description: 'Has "quotes"', notes: 'Line\nbreak' },
        { name: 'Jane', description: 'Normal text', notes: 'No issues' },
      ];

      const result = convertToCSV(data);
      expect(result).toContain('"John, Jr."');
      expect(result).toContain('"Has ""quotes"""');
      expect(result).toContain('"Line\nbreak"');
      expect(result).toContain('Normal text'); // No escaping needed
    });

    test('should handle null and undefined values', () => {
      const data = [
        { name: 'John', age: null, city: undefined },
        { name: null, age: 25, city: 'Los Angeles' },
      ];

      const result = convertToCSV(data);
      const expectedCSV = 'name,age,city\nJohn,,\n,25,Los Angeles';

      expect(result).toBe(expectedCSV);
    });

    test('should handle empty data array', () => {
      const result = convertToCSV([]);
      expect(result).toBe('');
    });

    test('should handle null or undefined input', () => {
      expect(convertToCSV(null)).toBe('');
      expect(convertToCSV(undefined)).toBe('');
    });

    test('should handle non-array input', () => {
      expect(convertToCSV('not an array')).toBe('');
    });

    test('should handle objects with different structures', () => {
      const data = [
        { name: 'John', age: 30 },
        { name: 'Jane', city: 'Los Angeles' }, // Missing age
        { age: 35, city: 'Chicago' }, // Missing name
      ];

      const result = convertToCSV(data);
      const lines = result.split('\n');

      expect(lines[0]).toBe('name,age'); // Header from first object
      expect(lines[1]).toBe('John,30');
      expect(lines[2]).toBe('Jane,'); // Missing age shows as empty
      expect(lines[3]).toBe(',35'); // Missing name shows as empty
    });
  });

  describe('convertTransactionsToMonarchCSV', () => {
    test('should not include transaction details in notes by default', () => {
      const transactions = [
        {
          date: '2024-01-15',
          merchant: { name: 'Amazon' },
          amount: { value: 50.00 },
          activityType: 'PURCHASE',
          referenceNumber: 'REF123',
        },
      ];

      const result = convertTransactionsToMonarchCSV(transactions, 'Test Account');

      // Notes should be empty when storeTransactionDetailsInNotes is false (default)
      expect(result).not.toContain('PURCHASE');
      expect(result).not.toContain('REF123');
      // Notes column should be empty (just commas between fields)
      expect(result).toContain('Amazon,,-50'); // Empty notes between original statement and amount
    });

    test('should include transaction details in notes when option is enabled', () => {
      const transactions = [
        {
          date: '2024-01-15',
          merchant: { name: 'Amazon' },
          amount: { value: 50.00 },
          activityType: 'PURCHASE',
          referenceNumber: 'REF123',
        },
      ];

      const result = convertTransactionsToMonarchCSV(transactions, 'Test Account', {
        storeTransactionDetailsInNotes: true,
      });

      // Notes should contain activity type and reference number
      expect(result).toContain('PURCHASE');
      expect(result).toContain('REF123');
    });

    test('should handle missing activity type and reference number gracefully', () => {
      const transactions = [
        {
          date: '2024-01-15',
          merchant: { name: 'Amazon' },
          amount: { value: 50.00 },
        },
      ];

      const result = convertTransactionsToMonarchCSV(transactions, 'Test Account', {
        storeTransactionDetailsInNotes: true,
      });

      // Should not throw and should produce valid CSV
      expect(result).toContain('Date');
      expect(result).toContain('Amazon');
    });

    test('should convert Rogers Bank transactions to Monarch CSV format', () => {
      const transactions = [
        {
          date: '2024-01-15',
          merchant: {
            name: 'STARBUCKS #1234',
            categoryDescription: 'Restaurants',
          },
          amount: { value: 5.50 },
          activityType: 'PURCHASE',
          referenceNumber: 'REF123',
        },
        {
          date: '2024-01-14',
          merchant: {
            name: 'GROCERY STORE',
            categoryDescription: 'Groceries',
          },
          amount: { value: 75.25 },
          activityType: 'PURCHASE',
          referenceNumber: 'REF124',
        },
      ];

      const accountName = 'Rogers Mastercard';
      // With storeTransactionDetailsInNotes enabled to test full functionality
      const result = convertTransactionsToMonarchCSV(transactions, accountName, {
        storeTransactionDetailsInNotes: true,
      });

      expect(result).toContain('Date,Merchant,Category,Account,Original Statement,Notes,Amount,Tags');
      expect(result).toContain('2024-01-15');
      expect(result).toContain('STARBUCKS #1234');
      expect(result).toContain('Rogers Mastercard');
      expect(result).toContain('PURCHASE / REF123');
      expect(result).toContain('-5.5'); // Negated amount for credit card
      expect(result).toContain('-75.25');
    });

    test('should handle transactions with resolved Monarch categories', () => {
      const transactions = [
        {
          date: '2024-01-15',
          merchant: { name: 'STARBUCKS' },
          amount: { value: 5.50 },
          resolvedMonarchCategory: 'Dining & Drinks',
          activityType: 'PURCHASE',
          referenceNumber: 'REF123',
        },
      ];

      const result = convertTransactionsToMonarchCSV(transactions, 'Test Account');
      expect(result).toContain('Dining & Drinks');
    });

    test('should handle empty transactions array', () => {
      const result = convertTransactionsToMonarchCSV([], 'Test Account');
      expect(result).toBe('');
    });

    test('should handle null transactions', () => {
      const result = convertTransactionsToMonarchCSV(null, 'Test Account');
      expect(result).toBe('');
    });

    test('should handle transactions with missing fields', () => {
      const transactions = [
        {
          // Missing date, merchant, amount
          activityType: 'PURCHASE',
        },
      ];

      const result = convertTransactionsToMonarchCSV(transactions, 'Test Account', {
        storeTransactionDetailsInNotes: true,
      });
      expect(result).toContain('Date,Merchant,Category,Account,Original Statement,Notes,Amount,Tags');
      expect(result).toContain(',,'); // Empty fields for missing data
      expect(result).toContain('Test Account');
      expect(result).toContain('PURCHASE');
    });

    test('should create proper notes field when storeTransactionDetailsInNotes is enabled', () => {
      const transactions = [
        {
          date: '2024-01-15',
          merchant: { name: 'TEST MERCHANT' },
          amount: { value: 10.00 },
          activityType: 'PURCHASE',
          referenceNumber: 'REF123',
        },
        {
          date: '2024-01-14',
          merchant: { name: 'TEST MERCHANT 2' },
          amount: { value: 20.00 },
          // Missing activityType and referenceNumber
        },
      ];

      const result = convertTransactionsToMonarchCSV(transactions, 'Test Account', {
        storeTransactionDetailsInNotes: true,
      });
      expect(result).toContain('PURCHASE / REF123');
      expect(result).toContain(' / '); // Empty activityType and referenceNumber should still create separator
    });

    test('should pass through empty string category when resolvedMonarchCategory is empty (skip categorization)', () => {
      const transactions = [
        {
          date: '2024-01-15',
          merchant: { name: 'STARBUCKS' },
          amount: { value: 5.50 },
          resolvedMonarchCategory: '',
          activityType: 'PURCHASE',
          referenceNumber: 'REF123',
        },
      ];

      const result = convertTransactionsToMonarchCSV(transactions, 'Test Account');
      // Empty category should produce empty field between commas (not 'Uncategorized')
      const lines = result.split('\n');
      const dataRow = lines[1];
      // CSV format: Date,Merchant,Category,Account,...
      // With empty category: ...STARBUCKS,,Test Account...
      expect(dataRow).toContain('STARBUCKS,,Test Account');
    });

    test('should handle category mapping fallback', () => {
      const { applyCategoryMapping } = jest.requireMock('../../src/mappers/category');
      applyCategoryMapping.mockReturnValue({ id: 'cat123', name: 'Test Category' });

      const transactions = [
        {
          date: '2024-01-15',
          merchant: {
            name: 'TEST MERCHANT',
            categoryDescription: 'Original Category',
          },
          amount: { value: 10.00 },
        },
      ];

      const result = convertTransactionsToMonarchCSV(transactions, 'Test Account');
      expect(result).toContain('Uncategorized'); // Should use 'Uncategorized' when mapping returns object
    });

    describe('Pending transaction support', () => {
      test('should add "Pending" tag for pending transactions', () => {
        const transactions = [
          {
            date: '2024-01-15',
            merchant: { name: 'STARBUCKS' },
            amount: { value: 5.50 },
            isPending: true,
            pendingId: 'rb-tx:abc123def456789a',
          },
        ];

        const result = convertTransactionsToMonarchCSV(transactions, 'Test Account');
        expect(result).toContain('Pending');
      });

      test('should NOT add "Pending" tag for settled transactions', () => {
        const transactions = [
          {
            date: '2024-01-15',
            merchant: { name: 'STARBUCKS' },
            amount: { value: 5.50 },
            referenceNumber: 'REF123',
            activityType: 'PURCHASE',
          },
        ];

        const result = convertTransactionsToMonarchCSV(transactions, 'Test Account');
        const lines = result.split('\n');
        const dataRow = lines[1];
        // Tags column should be empty for settled transactions
        expect(dataRow.endsWith(',')).toBe(true);
      });

      test('should include pending ID in notes for pending transactions', () => {
        const transactions = [
          {
            date: '2024-01-15',
            merchant: { name: 'STARBUCKS' },
            amount: { value: 5.50 },
            isPending: true,
            pendingId: 'rb-tx:abc123def456789a',
          },
        ];

        const result = convertTransactionsToMonarchCSV(transactions, 'Test Account');
        expect(result).toContain('rb-tx:abc123def456789a');
      });

      test('should NOT include pending ID in notes for settled transactions', () => {
        const transactions = [
          {
            date: '2024-01-15',
            merchant: { name: 'STARBUCKS' },
            amount: { value: 5.50 },
            referenceNumber: 'REF123',
            activityType: 'PURCHASE',
          },
        ];

        const result = convertTransactionsToMonarchCSV(transactions, 'Test Account', {
          storeTransactionDetailsInNotes: false,
        });
        expect(result).not.toContain('rb-tx:');
      });

      test('should not include transaction details for pending transactions even when storeTransactionDetailsInNotes is true', () => {
        const transactions = [
          {
            date: '2024-01-15',
            merchant: { name: 'STARBUCKS' },
            amount: { value: 5.50 },
            isPending: true,
            pendingId: 'rb-tx:abc123def456789a',
            activityType: 'PURCHASE',
            referenceNumber: 'REF123',
          },
        ];

        const result = convertTransactionsToMonarchCSV(transactions, 'Test Account', {
          storeTransactionDetailsInNotes: true,
        });
        // Should have pending ID but NOT activity type / reference for pending transactions
        expect(result).toContain('rb-tx:abc123def456789a');
        expect(result).not.toContain('PURCHASE / REF123');
      });

      test('should add FX notes for pending foreign transactions', () => {
        const transactions = [
          {
            date: '2026-05-05',
            merchant: { name: 'TADEOS MEXICAN RESTAUR' },
            amount: { value: 114.81 },
            isPending: true,
            pendingId: 'rb-tx:abc123def456789a',
            foreign: {
              originalAmount: { value: '84.28', currency: 'USD' },
              conversionRate: { source: '0.0', parsedValue: 0 },
            },
          },
        ];

        const result = convertTransactionsToMonarchCSV(transactions, 'Rogers Mastercard');
        expect(result).toContain('84.28 USD @ pending');
        expect(result).toContain('rb-tx:abc123def456789a');
        // Should NOT contain exchange fee for pending
        expect(result).not.toContain('Exchange fee');
      });

      test('should add FX notes with conversion rate for settled foreign transactions', () => {
        const transactions = [
          {
            date: '2026-05-04',
            merchant: { name: 'TADEOS MEXICAN RESTAUR' },
            amount: { value: 139.31 },
            activityType: 'TRANS',
            referenceNumber: '72700696125900010079992',
            foreign: {
              originalAmount: { value: '99.77', currency: 'USD' },
              conversionRate: 1.362233136,
              exchangeFee: { value: '3.40', currency: 'CAD' },
            },
          },
        ];

        const result = convertTransactionsToMonarchCSV(transactions, 'Rogers Mastercard', {
          storeTransactionDetailsInNotes: true,
        });
        expect(result).toContain('99.77 USD @ 1.362233136');
        expect(result).toContain('Exchange fee: 3.40 CAD');
        // Should also contain transaction details since storeTransactionDetailsInNotes is true
        expect(result).toContain('TRANS / 72700696125900010079992');
      });

      test('should not add FX notes for domestic CAD transactions', () => {
        const transactions = [
          {
            date: '2024-01-15',
            merchant: { name: 'LOCAL STORE' },
            amount: { value: 25.00 },
            activityType: 'PURCHASE',
            referenceNumber: 'REF123',
          },
        ];

        const result = convertTransactionsToMonarchCSV(transactions, 'Rogers Mastercard', {
          storeTransactionDetailsInNotes: true,
        });
        expect(result).not.toContain('@ pending');
        expect(result).not.toContain('Exchange fee');
        expect(result).toContain('PURCHASE / REF123');
      });

      test('should show N/A rate for settled foreign transaction with zero conversion rate', () => {
        const transactions = [
          {
            date: '2026-05-04',
            merchant: { name: 'FOREIGN STORE' },
            amount: { value: 50.00 },
            foreign: {
              originalAmount: { value: '35.00', currency: 'EUR' },
              conversionRate: 0,
            },
          },
        ];

        const result = convertTransactionsToMonarchCSV(transactions, 'Rogers Mastercard');
        expect(result).toContain('35.00 EUR @ N/A');
      });

      test('should prefer conversionMarkupRate over conversionRate when available', () => {
        const transactions = [
          {
            date: '2026-05-07',
            merchant: { name: '8th Pine Joint Ventu' },
            amount: { value: 1020.74 },
            activityType: 'TRANS',
            referenceNumber: '12302026127001094097228',
            foreign: {
              conversionMarkupRate: 1.396265645,
              originalAmount: { value: '731.05', currency: 'USD' },
              conversionRate: 1.362205048,
              exchangeFee: { value: '24.90', currency: 'CAD' },
            },
          },
        ];

        const result = convertTransactionsToMonarchCSV(transactions, 'Rogers Mastercard', {
          storeTransactionDetailsInNotes: true,
        });
        // Should use conversionMarkupRate (1.396265645) instead of conversionRate (1.362205048)
        expect(result).toContain('731.05 USD @ 1.396265645');
        expect(result).not.toContain('1.362205048');
        expect(result).toContain('Exchange fee: 24.90 CAD');
      });

      test('should fall back to conversionRate when conversionMarkupRate is not present', () => {
        const transactions = [
          {
            date: '2026-05-04',
            merchant: { name: 'FOREIGN STORE' },
            amount: { value: 139.31 },
            foreign: {
              originalAmount: { value: '99.77', currency: 'USD' },
              conversionRate: 1.362233136,
              exchangeFee: { value: '3.40', currency: 'CAD' },
            },
          },
        ];

        const result = convertTransactionsToMonarchCSV(transactions, 'Rogers Mastercard');
        expect(result).toContain('99.77 USD @ 1.362233136');
        expect(result).toContain('Exchange fee: 3.40 CAD');
      });
    });

    describe('Foreign currency transaction support', () => {
      test('should handle mixed settled and pending transactions', () => {
        const transactions = [
          {
            date: '2024-01-15',
            merchant: { name: 'SETTLED MERCHANT' },
            amount: { value: 10.00 },
            referenceNumber: 'REF1',
            activityType: 'PURCHASE',
          },
          {
            date: '2024-01-16',
            merchant: { name: 'PENDING MERCHANT' },
            amount: { value: 20.00 },
            isPending: true,
            pendingId: 'rb-tx:abc123def456789a',
          },
        ];

        const result = convertTransactionsToMonarchCSV(transactions, 'Test Account', {
          storeTransactionDetailsInNotes: false,
        });

        const lines = result.split('\n');
        expect(lines).toHaveLength(3); // Header + 2 data rows

        // First transaction (settled) should NOT have Pending tag
        expect(lines[1]).toContain('SETTLED MERCHANT');
        expect(lines[1]).not.toContain('Pending');

        // Second transaction (pending) should have Pending tag and pending ID in notes
        expect(lines[2]).toContain('PENDING MERCHANT');
        expect(lines[2]).toContain('Pending');
        expect(lines[2]).toContain('rb-tx:abc123def456789a');
      });

      test('should handle pending transaction without pendingId gracefully', () => {
        const transactions = [
          {
            date: '2024-01-15',
            merchant: { name: 'STARBUCKS' },
            amount: { value: 5.50 },
            isPending: true,
            // No pendingId
          },
        ];

        const result = convertTransactionsToMonarchCSV(transactions, 'Test Account');
        // Should still have Pending tag but empty notes
        expect(result).toContain('Pending');
        expect(result).not.toContain('rb-tx:');
      });
    });
  });

  describe('parseCSV', () => {
    test('should parse CSV string with headers', () => {
      const csvString = 'name,age,city\nJohn,30,New York\nJane,25,Los Angeles';
      const result = parseCSV(csvString, true);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ name: 'John', age: '30', city: 'New York' });
      expect(result[1]).toEqual({ name: 'Jane', age: '25', city: 'Los Angeles' });
    });

    test('should parse CSV string without headers', () => {
      const csvString = 'John,30,New York\nJane,25,Los Angeles';
      const result = parseCSV(csvString, false);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(['John', '30', 'New York']);
      expect(result[1]).toEqual(['Jane', '25', 'Los Angeles']);
    });

    test('should handle quoted fields with commas', () => {
      const csvString = 'name,description\n"John, Jr.","A person with, commas"\nJane,Normal';
      const result = parseCSV(csvString, true);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ name: 'John, Jr.', description: 'A person with, commas' });
      expect(result[1]).toEqual({ name: 'Jane', description: 'Normal' });
    });

    test('should handle escaped quotes', () => {
      const csvString = 'name,quote\n"John ""The Man""","He said ""Hello"""';
      const result = parseCSV(csvString, true);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ name: 'John "The Man"', quote: 'He said "Hello"' });
    });

    test('should handle empty CSV string', () => {
      expect(parseCSV('', true)).toEqual([]);
      expect(parseCSV('', false)).toEqual([]);
    });

    test('should handle null/undefined CSV string', () => {
      expect(parseCSV(null, true)).toEqual([]);
      expect(parseCSV(undefined, true)).toEqual([]);
    });

    test('should filter out empty lines', () => {
      const csvString = 'name,age\n\nJohn,30\n\nJane,25\n';
      const result = parseCSV(csvString, true);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ name: 'John', age: '30' });
      expect(result[1]).toEqual({ name: 'Jane', age: '25' });
    });

    test('should handle missing values in rows', () => {
      const csvString = 'name,age,city\nJohn,30\nJane,,Los Angeles\n,,';
      const result = parseCSV(csvString, true);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ name: 'John', age: '30', city: '' });
      expect(result[1]).toEqual({ name: 'Jane', age: '', city: 'Los Angeles' });
      expect(result[2]).toEqual({ name: '', age: '', city: '' });
    });

    test('should handle single column CSV', () => {
      const csvString = 'name\nJohn\nJane\nBob';
      const result = parseCSV(csvString, true);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ name: 'John' });
      expect(result[1]).toEqual({ name: 'Jane' });
      expect(result[2]).toEqual({ name: 'Bob' });
    });
  });

  describe('convertQuestradeOrdersToMonarchCSV', () => {
    test('should convert Questrade Buy orders to Monarch CSV format with positive amounts', () => {
      const orders = [
        {
          orderUuid: 'uuid1',
          status: 'Executed',
          action: 'Buy',
          security: {
            displayName: 'Apple Inc.',
            currency: 'USD',
          },
          updatedDateTime: '2024-01-15T10:30:00.000Z',
          filledQuantity: 10,
          averageFilledPrice: 150.00,
          totalFees: 5.00,
          orderStatement: 'Bought 10 shares',
          resolvedMonarchCategory: 'Investment',
        },
      ];

      const accountName = 'Questrade TFSA';
      const result = convertQuestradeOrdersToMonarchCSV(orders, accountName);

      expect(result).toContain('Date,Merchant,Category,Account,Original Statement,Notes,Amount,Tags');
      expect(result).toContain('2024-01-15');
      expect(result).toContain('Apple Inc.');
      expect(result).toContain('Investment');
      expect(result).toContain('Questrade TFSA');
      expect(result).toContain('1500'); // Positive amount for Buy
    });

    test('should convert Questrade Sell orders to Monarch CSV format with negative amounts', () => {
      const orders = [
        {
          orderUuid: 'uuid2',
          status: 'Executed',
          action: 'Sell',
          security: {
            displayName: 'Tesla Inc.',
            currency: 'USD',
          },
          updatedDateTime: '2024-01-16T14:20:00.000Z',
          filledQuantity: 5,
          averageFilledPrice: 200.00,
          totalFees: 3.00,
          orderStatement: 'Sold 5 shares',
          resolvedMonarchCategory: 'Investment',
        },
      ];

      const accountName = 'Questrade RRSP';
      const result = convertQuestradeOrdersToMonarchCSV(orders, accountName);

      expect(result).toContain('Date,Merchant,Category,Account,Original Statement,Notes,Amount,Tags');
      expect(result).toContain('2024-01-16');
      expect(result).toContain('Tesla Inc.');
      expect(result).toContain('Investment');
      expect(result).toContain('Questrade RRSP');
      expect(result).toContain('-1000'); // Negative amount for Sell
    });

    test('should handle mixed Buy and Sell orders correctly', () => {
      const orders = [
        {
          action: 'Buy',
          security: { displayName: 'Stock A', currency: 'USD' },
          updatedDateTime: '2024-01-15T10:00:00.000Z',
          filledQuantity: 10,
          averageFilledPrice: 50.00,
          totalFees: 2.00,
          orderStatement: 'Buy order',
          resolvedMonarchCategory: 'Investment',
        },
        {
          action: 'Sell',
          security: { displayName: 'Stock B', currency: 'USD' },
          updatedDateTime: '2024-01-16T10:00:00.000Z',
          filledQuantity: 20,
          averageFilledPrice: 30.00,
          totalFees: 3.00,
          orderStatement: 'Sell order',
          resolvedMonarchCategory: 'Investment',
        },
      ];

      const result = convertQuestradeOrdersToMonarchCSV(orders, 'Test Account');

      // Check the CSV contains both positive and negative amounts
      expect(result).toContain('500,'); // Buy: positive
      expect(result).toContain('-600,'); // Sell: negative

      // Verify it has 2 data rows plus header
      expect(result).toContain('2024-01-15');
      expect(result).toContain('2024-01-16');
      expect(result).toContain('Stock A');
      expect(result).toContain('Stock B');
    });

    test('should handle orders with missing fields', () => {
      const orders = [
        {
          action: 'Buy',
          // Missing most fields
        },
      ];

      const result = convertQuestradeOrdersToMonarchCSV(orders, 'Test Account');
      expect(result).toContain('Date,Merchant,Category,Account,Original Statement,Notes,Amount,Tags');
      expect(result).toContain('Unknown Security');
      expect(result).toContain('Uncategorized');
      expect(result).toContain('0'); // Amount should be 0 for missing values
    });

    test('should build comprehensive notes field', () => {
      const orders = [
        {
          action: 'Buy',
          security: {
            displayName: 'Apple Inc.',
            currency: 'CAD',
          },
          updatedDateTime: '2024-01-15T10:00:00.000Z',
          filledQuantity: 100,
          averageFilledPrice: 25.50,
          totalFees: 9.99,
          orderStatement: 'Market order filled',
          resolvedMonarchCategory: 'Investment',
        },
      ];

      const result = convertQuestradeOrdersToMonarchCSV(orders, 'Test Account');
      expect(result).toContain('Market order filled');
      expect(result).toContain('Filled 100 @ 25.5');
      expect(result).toContain('fees: 9.99 CAD');
      expect(result).toContain('Total: 2550 CAD');
    });

    test('should format date correctly from updatedDateTime', () => {
      const orders = [
        {
          action: 'Buy',
          security: { displayName: 'Test Security' },
          updatedDateTime: '2024-12-31T23:59:59.999Z',
          filledQuantity: 1,
          averageFilledPrice: 100,
          resolvedMonarchCategory: 'Investment',
        },
      ];

      const result = convertQuestradeOrdersToMonarchCSV(orders, 'Test Account');
      expect(result).toContain('2024-12-31'); // ISO date format YYYY-MM-DD
    });

    test('should handle empty orders array', () => {
      const result = convertQuestradeOrdersToMonarchCSV([], 'Test Account');
      expect(result).toBe('');
    });

    test('should handle null orders', () => {
      const result = convertQuestradeOrdersToMonarchCSV(null, 'Test Account');
      expect(result).toBe('');
    });

    test('should use resolved Monarch category', () => {
      const orders = [
        {
          action: 'Buy',
          security: { displayName: 'Test Security' },
          updatedDateTime: '2024-01-15T10:00:00.000Z',
          filledQuantity: 10,
          averageFilledPrice: 50,
          resolvedMonarchCategory: 'Custom Category',
        },
      ];

      const result = convertQuestradeOrdersToMonarchCSV(orders, 'Test Account');
      expect(result).toContain('Custom Category');
    });

    test('should fall back to Uncategorized when no category provided', () => {
      const orders = [
        {
          action: 'Buy',
          security: { displayName: 'Test Security' },
          updatedDateTime: '2024-01-15T10:00:00.000Z',
          filledQuantity: 10,
          averageFilledPrice: 50,
          // No resolvedMonarchCategory
        },
      ];

      const result = convertQuestradeOrdersToMonarchCSV(orders, 'Test Account');
      expect(result).toContain('Uncategorized');
    });

    test('should pass through empty string category when resolvedMonarchCategory is empty (skip categorization)', () => {
      const orders = [
        {
          action: 'Buy',
          security: { displayName: 'Test Security' },
          updatedDateTime: '2024-01-15T10:00:00.000Z',
          filledQuantity: 10,
          averageFilledPrice: 50,
          resolvedMonarchCategory: '',
        },
      ];

      const result = convertQuestradeOrdersToMonarchCSV(orders, 'Test Account');
      // Empty category should produce empty field (not 'Uncategorized')
      const lines = result.split('\n');
      const dataRow = lines[1];
      // CSV: Date,Merchant,Category,Account,...
      expect(dataRow).toContain('Test Security,,Test Account');
    });
  });


  describe('convertMbnaTransactionsToMonarchCSV', () => {
    const sampleSettled = [
      {
        date: '2026-02-15',
        merchant: 'Amazon.ca',
        originalStatement: 'Amazon.ca*RA6HH70U3 TORONTO ON',
        amount: -77.82,
        referenceNumber: '55490535351206796539264',
        isPending: false,
        autoCategory: null,
        resolvedMonarchCategory: 'Shopping',
      },
      {
        date: '2026-02-10',
        merchant: 'MBNA Credit Card Payment',
        originalStatement: 'PAYMENT',
        amount: 13.32,
        referenceNumber: '03000306013000455833905',
        isPending: false,
        autoCategory: 'Credit Card Payment',
        resolvedMonarchCategory: null,
      },
    ];

    const samplePending = [
      {
        date: '2026-02-17',
        merchant: 'Uber',
        originalStatement: 'UBER *EATS HELP.UBER.COM ON',
        amount: 25.50,
        isPending: true,
        pendingId: 'mbna-tx:abc123def456ab78',
        autoCategory: null,
        resolvedMonarchCategory: null,
      },
    ];

    test('should convert settled MBNA transactions to Monarch CSV format', () => {
      const result = convertMbnaTransactionsToMonarchCSV(sampleSettled, 'MBNA Mastercard');

      expect(result).toContain('Date,Merchant,Category,Account,Original Statement,Notes,Amount,Tags');
      expect(result).toContain('2026-02-15');
      expect(result).toContain('Amazon.ca');
      expect(result).toContain('MBNA Mastercard');
      expect(result).toContain('77.82');
    });

    test('should use resolvedMonarchCategory when available', () => {
      const result = convertMbnaTransactionsToMonarchCSV(sampleSettled, 'MBNA Mastercard');
      expect(result).toContain('Shopping');
    });

    test('should fall back to autoCategory when resolvedMonarchCategory is null', () => {
      const result = convertMbnaTransactionsToMonarchCSV(sampleSettled, 'MBNA Mastercard');
      // PAYMENT tx has resolvedMonarchCategory=null, autoCategory='Credit Card Payment'
      expect(result).toContain('Credit Card Payment');
    });

    test('should use Uncategorized when both resolvedMonarchCategory and autoCategory are null', () => {
      const txs = [{
        date: '2026-02-17',
        merchant: 'Some Store',
        originalStatement: 'SOME STORE',
        amount: 10.00,
        isPending: false,
        autoCategory: null,
        resolvedMonarchCategory: null,
      }];

      const result = convertMbnaTransactionsToMonarchCSV(txs, 'MBNA Mastercard');
      expect(result).toContain('Uncategorized');
    });

    test('should have inverted amount signs (charge ’ negative, payment ’ positive)', () => {
      const result = convertMbnaTransactionsToMonarchCSV(sampleSettled, 'MBNA Mastercard');
      expect(result).toContain('-77.82');
      expect(result).toContain('13.32');
    });

    test('should add Pending tag for pending transactions', () => {
      const result = convertMbnaTransactionsToMonarchCSV(samplePending, 'MBNA Mastercard');
      expect(result).toContain('Pending');
    });

    test('should include pending ID in notes for pending transactions', () => {
      const result = convertMbnaTransactionsToMonarchCSV(samplePending, 'MBNA Mastercard');
      expect(result).toContain('mbna-tx:abc123def456ab78');
    });

    test('should NOT add Pending tag for settled transactions', () => {
      const result = convertMbnaTransactionsToMonarchCSV(sampleSettled, 'MBNA Mastercard');
      const lines = result.split('\n');
      // Data rows should end with empty Tags field (comma at end)
      expect(lines[1]).not.toContain('Pending');
    });

    test('should include referenceNumber in notes when storeTransactionDetailsInNotes is true', () => {
      const result = convertMbnaTransactionsToMonarchCSV(sampleSettled, 'MBNA Mastercard', {
        storeTransactionDetailsInNotes: true,
      });
      expect(result).toContain('55490535351206796539264');
    });

    test('should NOT include referenceNumber in notes by default', () => {
      const result = convertMbnaTransactionsToMonarchCSV(sampleSettled, 'MBNA Mastercard');
      expect(result).not.toContain('55490535351206796539264');
    });

    test('should preserve original statement in Original Statement column', () => {
      const result = convertMbnaTransactionsToMonarchCSV(sampleSettled, 'MBNA Mastercard');
      expect(result).toContain('Amazon.ca*RA6HH70U3 TORONTO ON');
      expect(result).toContain('PAYMENT');
    });

    test('should handle mixed settled and pending transactions', () => {
      const mixed = [...sampleSettled, ...samplePending];
      const result = convertMbnaTransactionsToMonarchCSV(mixed, 'MBNA Mastercard');

      const lines = result.split('\n');
      expect(lines).toHaveLength(4); // Header + 3 data rows

      // Last line (pending) should have Pending tag and pendingId
      expect(lines[3]).toContain('Pending');
      expect(lines[3]).toContain('mbna-tx:abc123def456ab78');
    });

    test('should handle empty transactions array', () => {
      const result = convertMbnaTransactionsToMonarchCSV([], 'MBNA Mastercard');
      expect(result).toBe('');
    });

    test('should handle null transactions', () => {
      const result = convertMbnaTransactionsToMonarchCSV(null, 'MBNA Mastercard');
      expect(result).toBe('');
    });

    test('should handle pending transaction without pendingId', () => {
      const txs = [{
        date: '2026-02-17',
        merchant: 'Test',
        originalStatement: 'TEST',
        amount: 5.00,
        isPending: true,
        // No pendingId
      }];

      const result = convertMbnaTransactionsToMonarchCSV(txs, 'MBNA Mastercard');
      expect(result).toContain('Pending');
      expect(result).not.toContain('mbna-tx:');
    });

    test('should pass through empty string category for skip categorization', () => {
      const txs = [{
        date: '2026-02-17',
        merchant: 'Store',
        originalStatement: 'STORE',
        amount: 10.00,
        isPending: false,
        resolvedMonarchCategory: '',
        autoCategory: null,
      }];

      const result = convertMbnaTransactionsToMonarchCSV(txs, 'MBNA Mastercard');
      const lines = result.split('\n');
      // Empty category: ...Store,,MBNA Mastercard...
      expect(lines[1]).toContain('Store,,MBNA Mastercard');
    });
  });

  describe('escapeCSVField (internal function)', () => {
    // This function is tested indirectly through convertToCSV tests above
    test('should be tested through integration', () => {
      // The escapeCSVField function is internal and tested through convertToCSV
      expect(true).toBe(true);
    });
  });
});
