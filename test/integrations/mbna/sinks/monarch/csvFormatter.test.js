/**
 * Tests for MBNA → Monarch CSV Formatter
 *
 * Moved from test/utils/csv.test.js to co-locate with the integration module.
 */

import { convertMbnaTransactionsToMonarchCSV } from '../../../../../src/integrations/mbna/sinks/monarch/csvFormatter';

jest.mock('../../../../../src/core/utils', () => ({
  debugLog: jest.fn(),
}));

describe('MBNA CSV Formatter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

    test('should have inverted amount signs (charge → negative, payment → positive)', () => {
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
      expect(lines[1]).toContain('Store,,MBNA Mastercard');
    });
  });
});