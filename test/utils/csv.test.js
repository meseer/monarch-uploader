/**
 * Tests for CSV Conversion Utilities
 */

import {
  convertToCSV,
  convertTransactionsToMonarchCSV,
  convertQuestradeOrdersToMonarchCSV,
  convertWealthsimpleTransactionsToMonarchCSV,
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
      const result = convertTransactionsToMonarchCSV(transactions, accountName);

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

      const result = convertTransactionsToMonarchCSV(transactions, 'Test Account');
      expect(result).toContain('Date,Merchant,Category,Account,Original Statement,Notes,Amount,Tags');
      expect(result).toContain(',,'); // Empty fields for missing data
      expect(result).toContain('Test Account');
      expect(result).toContain('PURCHASE');
    });

    test('should create proper notes field', () => {
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

      const result = convertTransactionsToMonarchCSV(transactions, 'Test Account');
      expect(result).toContain('PURCHASE / REF123');
      expect(result).toContain(' / '); // Empty activityType and referenceNumber should still create separator
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
  });

  describe('convertWealthsimpleTransactionsToMonarchCSV', () => {
    test('should convert Wealthsimple transactions to Monarch CSV format', () => {
      const transactions = [
        {
          id: 'tx123',
          date: '2024-01-15',
          merchant: 'STARBUCKS',
          originalMerchant: 'STARBUCKS #1234',
          amount: -5.50,
          subType: 'PURCHASE',
          resolvedMonarchCategory: 'Dining & Drinks',
        },
        {
          id: 'tx124',
          date: '2024-01-14',
          merchant: 'GROCERY STORE',
          originalMerchant: 'GROCERY STORE LTD',
          amount: -75.25,
          subType: 'PURCHASE',
          resolvedMonarchCategory: 'Groceries',
        },
      ];

      const accountName = 'Wealthsimple Cash Card';
      const result = convertWealthsimpleTransactionsToMonarchCSV(transactions, accountName);

      expect(result).toContain('Date,Merchant,Category,Account,Original Statement,Notes,Amount,Tags');
      expect(result).toContain('2024-01-15');
      expect(result).toContain('STARBUCKS');
      expect(result).toContain('Wealthsimple Cash Card');
      expect(result).toContain('-5.5');
      expect(result).toContain('-75.25');
    });

    test('should include transaction details in notes when storeTransactionDetailsInNotes is true', () => {
      const transactions = [
        {
          id: 'tx-unique-123',
          date: '2024-01-15',
          merchant: 'STARBUCKS',
          originalMerchant: 'STARBUCKS #1234',
          amount: -5.50,
          subType: 'PURCHASE',
          resolvedMonarchCategory: 'Dining & Drinks',
        },
      ];

      const result = convertWealthsimpleTransactionsToMonarchCSV(
        transactions,
        'Test Account',
        { storeTransactionDetailsInNotes: true },
      );

      expect(result).toContain('PURCHASE / tx-unique-123');
    });

    test('should NOT include transaction details in notes when storeTransactionDetailsInNotes is false', () => {
      const transactions = [
        {
          id: 'tx-unique-123',
          date: '2024-01-15',
          merchant: 'STARBUCKS',
          originalMerchant: 'STARBUCKS #1234',
          amount: -5.50,
          subType: 'PURCHASE',
          resolvedMonarchCategory: 'Dining & Drinks',
        },
      ];

      const result = convertWealthsimpleTransactionsToMonarchCSV(
        transactions,
        'Test Account',
        { storeTransactionDetailsInNotes: false },
      );

      // Notes should be empty when disabled
      expect(result).not.toContain('PURCHASE');
      expect(result).not.toContain('tx-unique-123');
    });

    test('should default to NOT including transaction details in notes', () => {
      const transactions = [
        {
          id: 'tx-unique-123',
          date: '2024-01-15',
          merchant: 'STARBUCKS',
          originalMerchant: 'STARBUCKS #1234',
          amount: -5.50,
          subType: 'PURCHASE',
          resolvedMonarchCategory: 'Dining & Drinks',
        },
      ];

      // No options provided (should default to false)
      const result = convertWealthsimpleTransactionsToMonarchCSV(transactions, 'Test Account');

      // Notes should be empty when disabled (default)
      expect(result).not.toContain('tx-unique-123');
    });

    test('should handle empty options object', () => {
      const transactions = [
        {
          id: 'tx-unique-123',
          date: '2024-01-15',
          merchant: 'STARBUCKS',
          subType: 'PURCHASE',
          resolvedMonarchCategory: 'Dining & Drinks',
        },
      ];

      const result = convertWealthsimpleTransactionsToMonarchCSV(transactions, 'Test Account', {});

      // Notes should be empty when disabled (default)
      expect(result).not.toContain('tx-unique-123');
    });

    test('should handle transactions without subType', () => {
      const transactions = [
        {
          id: 'tx123',
          date: '2024-01-15',
          merchant: 'MERCHANT',
          amount: -10.00,
          // No subType
          resolvedMonarchCategory: 'Shopping',
        },
      ];

      const resultWithDetails = convertWealthsimpleTransactionsToMonarchCSV(
        transactions,
        'Test Account',
        { storeTransactionDetailsInNotes: true },
      );
      expect(resultWithDetails).toContain('/ tx123');

      const resultWithoutDetails = convertWealthsimpleTransactionsToMonarchCSV(
        transactions,
        'Test Account',
        { storeTransactionDetailsInNotes: false },
      );
      // Notes should be empty when disabled
      const lines = resultWithoutDetails.split('\n');
      expect(lines.length).toBe(2); // Header + data row
    });

    test('should handle empty transactions array', () => {
      const result = convertWealthsimpleTransactionsToMonarchCSV([], 'Test Account');
      expect(result).toBe('');
    });

    test('should handle null transactions', () => {
      const result = convertWealthsimpleTransactionsToMonarchCSV(null, 'Test Account');
      expect(result).toBe('');
    });

    test('should use Uncategorized for missing resolvedMonarchCategory', () => {
      const transactions = [
        {
          id: 'tx123',
          date: '2024-01-15',
          merchant: 'MERCHANT',
          amount: -10.00,
          subType: 'PURCHASE',
          // No resolvedMonarchCategory
        },
      ];

      const result = convertWealthsimpleTransactionsToMonarchCSV(transactions, 'Test Account');
      expect(result).toContain('Uncategorized');
    });

    test('should preserve original merchant in Original Statement field', () => {
      const transactions = [
        {
          id: 'tx123',
          date: '2024-01-15',
          merchant: 'Starbucks', // Cleaned up merchant name
          originalMerchant: 'STARBUCKS #1234 VANCOUVER BC', // Original from bank
          amount: -5.50,
          subType: 'PURCHASE',
          resolvedMonarchCategory: 'Dining & Drinks',
        },
      ];

      const result = convertWealthsimpleTransactionsToMonarchCSV(transactions, 'Test Account');
      expect(result).toContain('STARBUCKS #1234 VANCOUVER BC');
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
