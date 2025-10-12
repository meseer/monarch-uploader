/**
 * Tests for Merchant Mapping Utilities
 */

import {
  applyMerchantMapping,
  applyMerchantMappingBatch,
} from '../../src/mappers/merchant';

// Mock dependencies
jest.mock('../../src/core/utils', () => ({
  debugLog: jest.fn(),
}));

describe('Merchant Mapping Utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('applyMerchantMapping', () => {
    test('should return empty string for null/undefined input', () => {
      expect(applyMerchantMapping(null)).toBe('');
      expect(applyMerchantMapping(undefined)).toBe('');
      expect(applyMerchantMapping('')).toBe('');
    });

    test('should convert merchant name to title case', () => {
      expect(applyMerchantMapping('STARBUCKS COFFEE')).toBe('Starbucks Coffee');
      expect(applyMerchantMapping('mcdonald\'s restaurant')).toBe('Mcdonald\'s Restaurant');
      expect(applyMerchantMapping('WALMART SUPERCENTER')).toBe('Walmart Supercenter');
    });

    test('should remove TST- prefix', () => {
      expect(applyMerchantMapping('TST-STARBUCKS COFFEE')).toBe('Starbucks Coffee');
      expect(applyMerchantMapping('tst-mcdonald\'s restaurant')).toBe('Mcdonald\'s Restaurant');
    });

    test('should remove SQ * prefix (Square transactions)', () => {
      expect(applyMerchantMapping('SQ *COFFEE SHOP')).toBe('Coffee Shop');
      expect(applyMerchantMapping('sq *local bakery')).toBe('Local Bakery');
    });

    test('should remove LS prefix (Lightspeed transactions)', () => {
      expect(applyMerchantMapping('LS RESTAURANT NAME')).toBe('Restaurant Name');
      expect(applyMerchantMapping('ls boutique store')).toBe('Boutique Store');
    });

    test('should handle multiple spaces and clean them up', () => {
      expect(applyMerchantMapping('STARBUCKS    COFFEE   SHOP')).toBe('Starbucks Coffee Shop');
      expect(applyMerchantMapping('  WALMART  SUPERCENTER  ')).toBe('Walmart Supercenter');
    });

    test('should preserve special characters', () => {
      expect(applyMerchantMapping('MCDONALD\'S RESTAURANT')).toBe('Mcdonald\'s Restaurant');
      expect(applyMerchantMapping('AT&T STORE')).toBe('At&t Store');
      expect(applyMerchantMapping('7-ELEVEN STORE')).toBe('7-eleven Store');
    });

    test('should handle merchant names with numbers', () => {
      expect(applyMerchantMapping('STORE 123')).toBe('Store 123');
      expect(applyMerchantMapping('WALMART #1234')).toBe('Walmart #1234');
    });

    test('should handle complex merchant names with location info', () => {
      expect(applyMerchantMapping('STARBUCKS #1234 VANCOUVER BC')).toBe('Starbucks #1234 Vancouver Bc');
      expect(applyMerchantMapping('GROCERY STORE 5678 TORONTO ON')).toBe('Grocery Store 5678 Toronto on');
    });

    test('should handle merchant names with various prefixes', () => {
      expect(applyMerchantMapping('TST-TEST MERCHANT')).toBe('Test Merchant');
      expect(applyMerchantMapping('SQ *SQUARE MERCHANT')).toBe('Square Merchant');
      expect(applyMerchantMapping('LS LIGHTSPEED MERCHANT')).toBe('Lightspeed Merchant');
    });

    test('should only remove first matching prefix', () => {
      expect(applyMerchantMapping('TST-SQ *MERCHANT NAME')).toBe('Sq *merchant Name');
      expect(applyMerchantMapping('SQ *TST-MERCHANT NAME')).toBe('Tst-merchant Name');
    });

    test('should handle merchant names without prefixes', () => {
      expect(applyMerchantMapping('REGULAR MERCHANT NAME')).toBe('Regular Merchant Name');
      expect(applyMerchantMapping('amazon marketplace')).toBe('Amazon Marketplace');
    });

    test('should handle small words in title case correctly', () => {
      expect(applyMerchantMapping('BANK of AMERICA')).toBe('Bank of America');
      expect(applyMerchantMapping('STORE and RESTAURANT')).toBe('Store and Restaurant');
      expect(applyMerchantMapping('SHOP in THE MALL')).toBe('Shop in the Mall');
    });

    test('should capitalize first word even if it\'s a small word', () => {
      expect(applyMerchantMapping('THE STORE')).toBe('The Store');
      expect(applyMerchantMapping('OF MICE AND MEN')).toBe('Of Mice and Men');
    });

    test('should handle edge cases', () => {
      expect(applyMerchantMapping('   ')).toBe('');
      expect(applyMerchantMapping('A')).toBe('A');
      expect(applyMerchantMapping('TST-')).toBe('');
      expect(applyMerchantMapping('SQ *')).toBe('');
    });
  });

  describe('applyMerchantMappingBatch', () => {
    test('should process array of transactions', () => {
      const transactions = [
        { merchant: { name: 'TST-STARBUCKS COFFEE' }, amount: 5.50 },
        { merchant: { name: 'SQ *LOCAL BAKERY' }, amount: 12.00 },
        { merchant: { name: 'WALMART SUPERCENTER' }, amount: 45.99 },
      ];

      const result = applyMerchantMappingBatch(transactions);

      expect(result).toEqual([
        { merchant: { name: 'TST-STARBUCKS COFFEE' }, amount: 5.50, mappedMerchantName: 'Starbucks Coffee' },
        { merchant: { name: 'SQ *LOCAL BAKERY' }, amount: 12.00, mappedMerchantName: 'Local Bakery' },
        { merchant: { name: 'WALMART SUPERCENTER' }, amount: 45.99, mappedMerchantName: 'Walmart Supercenter' },
      ]);
    });

    test('should handle transactions without merchant names', () => {
      const transactions = [
        { merchant: { name: null }, amount: 5.50 },
        { merchant: {}, amount: 12.00 },
        { amount: 45.99 },
      ];

      const result = applyMerchantMappingBatch(transactions);

      expect(result).toEqual([
        { merchant: { name: null }, amount: 5.50, mappedMerchantName: '' },
        { merchant: {}, amount: 12.00, mappedMerchantName: '' },
        { amount: 45.99, mappedMerchantName: '' },
      ]);
    });

    test('should handle empty array', () => {
      const result = applyMerchantMappingBatch([]);
      expect(result).toEqual([]);
    });

    test('should preserve original transaction properties', () => {
      const transactions = [
        {
          merchant: { name: 'STARBUCKS COFFEE', category: 'Food' },
          amount: 5.50,
          date: '2023-01-01',
          id: '123',
        },
      ];

      const result = applyMerchantMappingBatch(transactions);

      expect(result[0]).toEqual({
        merchant: { name: 'STARBUCKS COFFEE', category: 'Food' },
        amount: 5.50,
        date: '2023-01-01',
        id: '123',
        mappedMerchantName: 'Starbucks Coffee',
      });
    });

    test('should handle large batch of transactions', () => {
      const transactions = Array(100).fill(0).map((_, i) => ({
        merchant: { name: `TST-MERCHANT ${i}` },
        amount: i * 10,
      }));

      const result = applyMerchantMappingBatch(transactions);

      expect(result).toHaveLength(100);
      expect(result[0].mappedMerchantName).toBe('Merchant 0');
      expect(result[50].mappedMerchantName).toBe('Merchant 50');
      expect(result[99].mappedMerchantName).toBe('Merchant 99');
    });
  });

  describe('Integration tests', () => {
    test('should handle real-world merchant names', () => {
      const testCases = [
        { input: 'TST-UBER * TRIP 123-456-789', expected: 'Uber * Trip 123-456-789' },
        { input: 'SQ *CORNER COFFEE SHOP', expected: 'Corner Coffee Shop' },
        { input: 'AMZN MKTP US*ABC123DEF', expected: 'Amzn Mktp Us*abc123def' },
        { input: 'PAYPAL *MERCHANTNAME', expected: 'Paypal *merchantname' },
        { input: 'GOOGLE *YOUTUBE PREMIUM', expected: 'Google *youtube Premium' },
      ];

      testCases.forEach(({ input, expected }) => {
        expect(applyMerchantMapping(input)).toBe(expected);
      });
    });

    test('should handle merchant names with various formats', () => {
      const testCases = [
        { input: 'MCDONALD\'S #1234', expected: 'Mcdonald\'s #1234' },
        { input: 'AT&T MOBILITY', expected: 'At&t Mobility' },
        { input: 'H&R BLOCK', expected: 'H&r Block' },
        { input: '7-ELEVEN STORE #456', expected: '7-eleven Store #456' },
        { input: 'SHELL OIL 12345678', expected: 'Shell Oil 12345678' },
      ];

      testCases.forEach(({ input, expected }) => {
        expect(applyMerchantMapping(input)).toBe(expected);
      });
    });

    test('should consistently transform similar merchant names', () => {
      const variations = [
        'STARBUCKS COFFEE',
        'starbucks coffee',
        'Starbucks Coffee',
        'STARBUCKS    COFFEE',
      ];

      const expected = 'Starbucks Coffee';
      variations.forEach((variation) => {
        expect(applyMerchantMapping(variation)).toBe(expected);
      });
    });
  });
});
