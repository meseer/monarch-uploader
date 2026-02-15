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

    test('should NOT include transaction details in notes for settled transactions (storeTransactionDetailsInNotes has no effect)', () => {
      const transactions = [
        {
          id: 'tx-unique-123',
          date: '2024-01-15',
          merchant: 'STARBUCKS',
          originalMerchant: 'STARBUCKS #1234',
          amount: -5.50,
          subType: 'PURCHASE',
          status: 'settled',
          resolvedMonarchCategory: 'Dining & Drinks',
        },
      ];

      // Even with storeTransactionDetailsInNotes: true, settled transactions don't include transaction ID
      const result = convertWealthsimpleTransactionsToMonarchCSV(
        transactions,
        'Test Account',
        { storeTransactionDetailsInNotes: true },
      );

      // Settled transactions should NOT have transaction ID in notes
      expect(result).not.toContain('tx-unique-123');
      expect(result).not.toContain('PURCHASE');
    });

    test('should NOT include transaction details in notes for settled transactions when storeTransactionDetailsInNotes is false', () => {
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
          status: 'settled',
          // No subType
          resolvedMonarchCategory: 'Shopping',
        },
      ];

      // Settled transactions don't include transaction ID regardless of storeTransactionDetailsInNotes
      const resultWithDetails = convertWealthsimpleTransactionsToMonarchCSV(
        transactions,
        'Test Account',
        { storeTransactionDetailsInNotes: true },
      );
      // Settled transactions should NOT have transaction ID in notes
      expect(resultWithDetails).not.toContain('tx123');

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

    test('should pass through empty string category when resolvedMonarchCategory is empty (skip categorization)', () => {
      const transactions = [
        {
          id: 'tx-skip',
          date: '2024-01-15',
          merchant: 'STARBUCKS',
          originalMerchant: 'STARBUCKS #1234',
          amount: -5.50,
          subType: 'PURCHASE',
          resolvedMonarchCategory: '',
        },
      ];

      const result = convertWealthsimpleTransactionsToMonarchCSV(transactions, 'Test Account');
      // Empty category should produce empty field (not 'Uncategorized')
      const lines = result.split('\n');
      const dataRow = lines[1];
      // CSV: Date,Merchant,Category,Account,...
      expect(dataRow).toContain('STARBUCKS,,Test Account');
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

    test('should add "Pending" tag for authorized transactions', () => {
      const transactions = [
        {
          id: 'tx-authorized',
          date: '2024-01-15',
          merchant: 'STARBUCKS',
          originalMerchant: 'STARBUCKS #1234',
          amount: -5.50,
          subType: 'PURCHASE',
          status: 'authorized',
          resolvedMonarchCategory: 'Dining & Drinks',
        },
      ];

      const result = convertWealthsimpleTransactionsToMonarchCSV(transactions, 'Test Account');
      expect(result).toContain('Pending');
    });

    test('should NOT add "Pending" tag for settled transactions', () => {
      const transactions = [
        {
          id: 'tx-settled',
          date: '2024-01-15',
          merchant: 'STARBUCKS',
          originalMerchant: 'STARBUCKS #1234',
          amount: -5.50,
          subType: 'PURCHASE',
          status: 'settled',
          resolvedMonarchCategory: 'Dining & Drinks',
        },
      ];

      const result = convertWealthsimpleTransactionsToMonarchCSV(transactions, 'Test Account');
      // Tags column should be empty for settled transactions
      const lines = result.split('\n');
      const dataRow = lines[1]; // Second line is data
      // The last field (Tags) should be empty
      expect(dataRow.endsWith(',')).toBe(true);
    });

    test('should always include transaction ID in notes for authorized transactions', () => {
      const transactions = [
        {
          id: 'tx-unique-pending-123',
          date: '2024-01-15',
          merchant: 'STARBUCKS',
          originalMerchant: 'STARBUCKS #1234',
          amount: -5.50,
          subType: 'PURCHASE',
          status: 'authorized',
          resolvedMonarchCategory: 'Dining & Drinks',
        },
      ];

      // Even with storeTransactionDetailsInNotes = false, pending transactions should have ID in notes
      const result = convertWealthsimpleTransactionsToMonarchCSV(
        transactions,
        'Test Account',
        { storeTransactionDetailsInNotes: false },
      );

      // Pending transactions include transaction ID with ws-tx: prefix (no transaction type)
      expect(result).toContain('ws-tx:tx-unique-pending-123');
      // Transaction type is NOT included in notes anymore
      expect(result).not.toContain('PURCHASE /');
    });

    test('should NOT include transaction ID in notes for settled transactions when storeTransactionDetailsInNotes is false', () => {
      const transactions = [
        {
          id: 'tx-settled-456',
          date: '2024-01-15',
          merchant: 'STARBUCKS',
          originalMerchant: 'STARBUCKS #1234',
          amount: -5.50,
          subType: 'PURCHASE',
          status: 'settled',
          resolvedMonarchCategory: 'Dining & Drinks',
        },
      ];

      const result = convertWealthsimpleTransactionsToMonarchCSV(
        transactions,
        'Test Account',
        { storeTransactionDetailsInNotes: false },
      );

      // Notes should NOT contain transaction ID for settled transactions when setting is disabled
      expect(result).not.toContain('tx-settled-456');
    });

    test('should handle mixed settled and authorized transactions correctly', () => {
      const transactions = [
        {
          id: 'tx-settled',
          date: '2024-01-15',
          merchant: 'SETTLED MERCHANT',
          originalMerchant: 'SETTLED MERCHANT',
          amount: -10.00,
          subType: 'PURCHASE',
          status: 'settled',
          resolvedMonarchCategory: 'Shopping',
        },
        {
          id: 'tx-pending',
          date: '2024-01-16',
          merchant: 'PENDING MERCHANT',
          originalMerchant: 'PENDING MERCHANT',
          amount: -20.00,
          subType: 'PURCHASE',
          status: 'authorized',
          resolvedMonarchCategory: 'Shopping',
        },
      ];

      const result = convertWealthsimpleTransactionsToMonarchCSV(
        transactions,
        'Test Account',
        { storeTransactionDetailsInNotes: false },
      );

      const lines = result.split('\n');
      expect(lines).toHaveLength(3); // Header + 2 data rows

      // First transaction (settled) should NOT have Pending tag or transaction ID in notes
      expect(lines[1]).toContain('SETTLED MERCHANT');
      expect(lines[1]).not.toContain('tx-settled');

      // Second transaction (authorized) should have Pending tag and transaction ID in notes
      expect(lines[2]).toContain('PENDING MERCHANT');
      expect(lines[2]).toContain('Pending');
      expect(lines[2]).toContain('tx-pending');
    });

    describe('Interac memo handling', () => {
      test('should include Interac memo in notes for settled transactions when storeTransactionDetailsInNotes is false', () => {
        const transactions = [
          {
            id: 'funding_intent-abc123',
            date: '2024-01-15',
            merchant: 'e-Transfer from John Doe',
            originalMerchant: 'Interac e-Transfer from John Doe (john@example.com)',
            amount: 500.00,
            subType: 'E_TRANSFER',
            status: 'settled',
            resolvedMonarchCategory: 'Transfer',
            notes: 'Rent payment for January', // Interac memo from funding intent
            technicalDetails: '', // No technical details for incoming
          },
        ];

        const result = convertWealthsimpleTransactionsToMonarchCSV(
          transactions,
          'Test Account',
          { storeTransactionDetailsInNotes: false },
        );

        // Only the Interac memo should appear in notes
        expect(result).toContain('Rent payment for January');
        expect(result).not.toContain('E_TRANSFER');
        expect(result).not.toContain('funding_intent-abc123');
      });

      test('should include memo and technical details only for settled transactions (storeTransactionDetailsInNotes has no effect on transaction ID)', () => {
        const transactions = [
          {
            id: 'funding_intent-def456',
            date: '2024-01-15',
            merchant: 'e-Transfer to Jane Smith',
            originalMerchant: 'Interac e-Transfer to Jane Smith (jane@example.com)',
            amount: -200.00,
            subType: 'E_TRANSFER',
            status: 'settled',
            resolvedMonarchCategory: 'Transfer',
            notes: 'Payment for groceries',
            technicalDetails: 'Auto Deposit: No; Reference Number: CAkJgEwf',
          },
        ];

        const result = convertWealthsimpleTransactionsToMonarchCSV(
          transactions,
          'Test Account',
          { storeTransactionDetailsInNotes: true },
        );

        // Settled transactions: include memo and technical details, but NOT transaction ID
        expect(result).toContain('Payment for groceries');
        expect(result).toContain('Auto Deposit: No; Reference Number: CAkJgEwf');
        // Transaction ID is never stored for settled transactions
        expect(result).not.toContain('ws-tx:funding_intent-def456');
        expect(result).not.toContain('E_TRANSFER');
      });

      test('should include Interac memo and transaction ID in notes for pending transactions', () => {
        const transactions = [
          {
            id: 'funding_intent-pending123',
            date: '2024-01-15',
            merchant: 'e-Transfer to Someone',
            originalMerchant: 'Interac e-Transfer to Someone',
            amount: -100.00,
            subType: 'E_TRANSFER',
            isPending: true,
            resolvedMonarchCategory: 'Transfer',
            notes: 'Pending transfer memo',
            technicalDetails: 'Auto Deposit: Yes; Reference Number: XYZ123',
          },
        ];

        const result = convertWealthsimpleTransactionsToMonarchCSV(
          transactions,
          'Test Account',
          { storeTransactionDetailsInNotes: false },
        );

        // Pending transactions always include transaction ID (just ws-tx: format, no transaction type)
        expect(result).toContain('Pending transfer memo');
        expect(result).toContain('Auto Deposit: Yes; Reference Number: XYZ123');
        expect(result).toContain('ws-tx:funding_intent-pending123');
        // Transaction type is no longer included in notes
        expect(result).not.toContain('E_TRANSFER /');
        expect(result).toContain('Pending'); // Tag
      });

      test('should handle transactions with empty notes but technical details', () => {
        const transactions = [
          {
            id: 'funding_intent-techonly',
            date: '2024-01-15',
            merchant: 'e-Transfer to Unknown',
            originalMerchant: 'Interac e-Transfer to Unknown',
            amount: -50.00,
            subType: 'E_TRANSFER',
            status: 'settled',
            resolvedMonarchCategory: 'Transfer',
            notes: '', // Empty memo
            technicalDetails: 'Auto Deposit: No; Reference Number: ABC123',
          },
        ];

        const result = convertWealthsimpleTransactionsToMonarchCSV(
          transactions,
          'Test Account',
          { storeTransactionDetailsInNotes: false },
        );

        // Technical details should be present even without memo
        expect(result).toContain('Auto Deposit: No; Reference Number: ABC123');
        expect(result).not.toContain('E_TRANSFER'); // No transaction ID when storeTransactionDetailsInNotes is false
      });

      test('should handle transactions with empty notes and technicalDetails', () => {
        const transactions = [
          {
            id: 'funding_intent-nomemo',
            date: '2024-01-15',
            merchant: 'e-Transfer from Unknown',
            originalMerchant: 'Interac e-Transfer from Unknown',
            amount: 50.00,
            subType: 'E_TRANSFER',
            status: 'settled',
            resolvedMonarchCategory: 'Transfer',
            notes: '', // Empty memo
            technicalDetails: '', // Empty technical details
          },
        ];

        const result = convertWealthsimpleTransactionsToMonarchCSV(
          transactions,
          'Test Account',
          { storeTransactionDetailsInNotes: false },
        );

        // Notes should be empty when no memo, no technical details, and details are disabled
        const lines = result.split('\n');
        expect(lines).toHaveLength(2);
        // The Notes field should be empty (empty string between commas)
        expect(lines[1]).toContain(',,'); // Empty notes field
      });

      test('should handle transactions without notes or technicalDetails properties', () => {
        const transactions = [
          {
            id: 'funding_intent-nonotesprop',
            date: '2024-01-15',
            merchant: 'e-Transfer from Unknown',
            originalMerchant: 'Interac e-Transfer from Unknown',
            amount: 50.00,
            subType: 'E_TRANSFER',
            status: 'settled',
            resolvedMonarchCategory: 'Transfer',
            // No notes or technicalDetails properties at all
          },
        ];

        const result = convertWealthsimpleTransactionsToMonarchCSV(
          transactions,
          'Test Account',
          { storeTransactionDetailsInNotes: false },
        );

        // Should not crash and notes should be empty
        const lines = result.split('\n');
        expect(lines).toHaveLength(2);
      });

      test('should escape special characters in Interac memo', () => {
        const transactions = [
          {
            id: 'funding_intent-special',
            date: '2024-01-15',
            merchant: 'e-Transfer from Test',
            originalMerchant: 'Interac e-Transfer from Test',
            amount: 100.00,
            subType: 'E_TRANSFER',
            status: 'settled',
            resolvedMonarchCategory: 'Transfer',
            notes: 'Memo with "quotes" and, commas',
            technicalDetails: '',
          },
        ];

        const result = convertWealthsimpleTransactionsToMonarchCSV(
          transactions,
          'Test Account',
          { storeTransactionDetailsInNotes: false },
        );

        // CSV escaping should handle the special characters
        expect(result).toContain('"Memo with ""quotes"" and, commas"');
      });

      test('should format notes with memo and technical details for settled transactions (no transaction ID)', () => {
        const transactions = [
          {
            id: 'funding_intent-fullformat',
            date: '2024-01-15',
            merchant: 'e-Transfer to Test',
            originalMerchant: 'Interac e-Transfer to Test',
            amount: -100.00,
            subType: 'E_TRANSFER',
            status: 'settled',
            resolvedMonarchCategory: 'Transfer',
            notes: 'Testing interac notes',
            technicalDetails: 'Auto Deposit: No; Reference Number: CAkJgEwf',
          },
        ];

        const result = convertWealthsimpleTransactionsToMonarchCSV(
          transactions,
          'Test Account',
          { storeTransactionDetailsInNotes: true },
        );

        // Settled transactions include memo and technical details, but NOT transaction ID
        expect(result).toContain('Testing interac notes');
        expect(result).toContain('Auto Deposit: No; Reference Number: CAkJgEwf');
        // Transaction ID is never stored for settled transactions
        expect(result).not.toContain('ws-tx:funding_intent-fullformat');
        expect(result).not.toContain('E_TRANSFER /');
      });

      test('should format notes correctly when only memo exists for settled transactions', () => {
        const transactions = [
          {
            id: 'funding_intent-memoonly',
            date: '2024-01-15',
            merchant: 'e-Transfer from Test',
            originalMerchant: 'Interac e-Transfer from Test',
            amount: 100.00,
            subType: 'E_TRANSFER',
            status: 'settled',
            resolvedMonarchCategory: 'Transfer',
            notes: 'Just a memo',
            technicalDetails: '',
          },
        ];

        const result = convertWealthsimpleTransactionsToMonarchCSV(
          transactions,
          'Test Account',
          { storeTransactionDetailsInNotes: true },
        );

        // Settled transactions: only memo, no transaction ID
        expect(result).toContain('Just a memo');
        expect(result).not.toContain('ws-tx:funding_intent-memoonly');
        expect(result).not.toContain('E_TRANSFER /');
      });

      test('should format notes correctly when only technical details exist for settled transactions', () => {
        const transactions = [
          {
            id: 'funding_intent-techonly2',
            date: '2024-01-15',
            merchant: 'e-Transfer to Test',
            originalMerchant: 'Interac e-Transfer to Test',
            amount: -100.00,
            subType: 'E_TRANSFER',
            status: 'settled',
            resolvedMonarchCategory: 'Transfer',
            notes: '',
            technicalDetails: 'Auto Deposit: Yes; Reference Number: XYZ789',
          },
        ];

        const result = convertWealthsimpleTransactionsToMonarchCSV(
          transactions,
          'Test Account',
          { storeTransactionDetailsInNotes: true },
        );

        // Settled transactions: only technical details, no transaction ID
        expect(result).toContain('Auto Deposit: Yes; Reference Number: XYZ789');
        expect(result).not.toContain('ws-tx:funding_intent-techonly2');
        expect(result).not.toContain('E_TRANSFER /');
      });
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
