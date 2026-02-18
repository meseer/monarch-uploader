/**
 * Tests for MBNA → Monarch Pending Transactions
 */

import {
  generatePendingTransactionId,
  isPendingTransaction,
  isSettledTransaction,
  separateAndDeduplicateTransactions,
  formatReconciliationMessage,
  formatPendingIdForNotes,
  extractPendingIdFromNotes,
} from '../../../../src/integrations/mbna/monarch-mapper/pendingTransactions';

describe('MBNA Pending Transactions', () => {
  describe('isPendingTransaction', () => {
    it('should return true for TEMP referenceNumber', () => {
      expect(isPendingTransaction({ referenceNumber: 'TEMP' })).toBe(true);
    });

    it('should return false for real referenceNumber', () => {
      expect(isPendingTransaction({ referenceNumber: '55490535351206796539264' })).toBe(false);
    });

    it('should return false for missing referenceNumber', () => {
      expect(isPendingTransaction({})).toBe(false);
    });
  });

  describe('isSettledTransaction', () => {
    it('should return true for real referenceNumber', () => {
      expect(isSettledTransaction({ referenceNumber: '55490535351206796539264' })).toBe(true);
    });

    it('should return false for TEMP referenceNumber', () => {
      expect(isSettledTransaction({ referenceNumber: 'TEMP' })).toBe(false);
    });

    it('should return false for missing referenceNumber', () => {
      expect(isSettledTransaction({})).toBe(false);
    });

    it('should return false for empty referenceNumber', () => {
      expect(isSettledTransaction({ referenceNumber: '' })).toBe(false);
    });
  });

  describe('generatePendingTransactionId', () => {
    it('should generate mbna-tx: prefixed ID', async () => {
      const tx = {
        transactionDate: '2026-02-17',
        description: 'UBER *EATS HELP.UBER.COM ON',
        amount: 25.50,
        endingIn: '4201',
      };
      const id = await generatePendingTransactionId(tx);
      expect(id).toMatch(/^mbna-tx:[a-f0-9]{16}$/);
    });

    it('should generate same ID for same inputs', async () => {
      const tx = {
        transactionDate: '2026-02-17',
        description: 'Amazon.ca*RA6HH70U3 TORONTO ON',
        amount: 77.82,
        endingIn: '4201',
      };
      const id1 = await generatePendingTransactionId(tx);
      const id2 = await generatePendingTransactionId(tx);
      expect(id1).toBe(id2);
    });

    it('should generate different IDs for different amounts', async () => {
      const tx1 = { transactionDate: '2026-02-17', description: 'TEST', amount: 10.00, endingIn: '4201' };
      const tx2 = { transactionDate: '2026-02-17', description: 'TEST', amount: 20.00, endingIn: '4201' };
      const id1 = await generatePendingTransactionId(tx1);
      const id2 = await generatePendingTransactionId(tx2);
      expect(id1).not.toBe(id2);
    });

    it('should generate different IDs for different dates', async () => {
      const tx1 = { transactionDate: '2026-02-17', description: 'TEST', amount: 10, endingIn: '4201' };
      const tx2 = { transactionDate: '2026-02-18', description: 'TEST', amount: 10, endingIn: '4201' };
      const id1 = await generatePendingTransactionId(tx1);
      const id2 = await generatePendingTransactionId(tx2);
      expect(id1).not.toBe(id2);
    });

    it('should strip asterisk suffix from description for hashing', async () => {
      // "Amazon.ca*RA6HH70U3 TORONTO ON" and "Amazon.ca*DIFFERENT CODE" should hash the same
      // because both strip to "Amazon.ca"
      const tx1 = { transactionDate: '2026-02-17', description: 'Amazon.ca*RA6HH70U3 TORONTO ON', amount: 50, endingIn: '4201' };
      const tx2 = { transactionDate: '2026-02-17', description: 'Amazon.ca*DIFFERENT_CODE', amount: 50, endingIn: '4201' };
      const id1 = await generatePendingTransactionId(tx1);
      const id2 = await generatePendingTransactionId(tx2);
      expect(id1).toBe(id2);
    });

    it('should handle missing fields gracefully', async () => {
      const tx = {};
      const id = await generatePendingTransactionId(tx);
      expect(id).toMatch(/^mbna-tx:[a-f0-9]{16}$/);
    });
  });

  describe('separateAndDeduplicateTransactions', () => {
    it('should return all pending when no settled match', async () => {
      const pending = [
        { transactionDate: '2026-02-17', description: 'UBER *EATS', amount: 25.50, endingIn: '4201', referenceNumber: 'TEMP' },
      ];
      const settled = [
        { transactionDate: '2026-02-15', description: 'Amazon.ca*TEST', amount: 77.82, endingIn: '4201', referenceNumber: 'REF1' },
      ];

      const result = await separateAndDeduplicateTransactions(pending, settled);

      expect(result.pending).toHaveLength(1);
      expect(result.settled).toHaveLength(1);
      expect(result.duplicatesRemoved).toBe(0);
      expect(result.pending[0].isPending).toBe(true);
      expect(result.pending[0].generatedId).toMatch(/^mbna-tx:/);
    });

    it('should remove pending that matches settled by hash', async () => {
      // Same transaction as pending and settled (same date, description root, amount, endingIn)
      const pending = [
        { transactionDate: '2026-02-17', description: 'TEST MERCHANT', amount: 25.50, endingIn: '4201', referenceNumber: 'TEMP' },
      ];
      const settled = [
        { transactionDate: '2026-02-17', description: 'TEST MERCHANT', amount: 25.50, endingIn: '4201', referenceNumber: 'REF1' },
      ];

      const result = await separateAndDeduplicateTransactions(pending, settled);

      expect(result.pending).toHaveLength(0);
      expect(result.settled).toHaveLength(1);
      expect(result.duplicatesRemoved).toBe(1);
    });

    it('should handle empty arrays', async () => {
      const result = await separateAndDeduplicateTransactions([], []);
      expect(result.pending).toHaveLength(0);
      expect(result.settled).toHaveLength(0);
      expect(result.duplicatesRemoved).toBe(0);
    });
  });

  describe('formatPendingIdForNotes', () => {
    it('should return the ID unchanged', () => {
      expect(formatPendingIdForNotes('mbna-tx:abc123def456ab78')).toBe('mbna-tx:abc123def456ab78');
    });

    it('should return empty string for null', () => {
      expect(formatPendingIdForNotes(null)).toBe('');
    });
  });

  describe('extractPendingIdFromNotes', () => {
    it('should extract mbna-tx ID from notes', () => {
      const id = extractPendingIdFromNotes('Some note\nmbna-tx:abc123def456ab78');
      expect(id).toBe('mbna-tx:abc123def456ab78');
    });

    it('should extract ID when it is the only content', () => {
      const id = extractPendingIdFromNotes('mbna-tx:1234567890abcdef');
      expect(id).toBe('mbna-tx:1234567890abcdef');
    });

    it('should return null when no mbna-tx ID present', () => {
      expect(extractPendingIdFromNotes('Just a regular note')).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(extractPendingIdFromNotes('')).toBeNull();
    });

    it('should return null for null input', () => {
      expect(extractPendingIdFromNotes(null)).toBeNull();
    });

    it('should not match rb-tx IDs (Rogers Bank)', () => {
      expect(extractPendingIdFromNotes('rb-tx:1234567890abcdef')).toBeNull();
    });
  });

  describe('formatReconciliationMessage', () => {
    it('should format settled count', () => {
      expect(formatReconciliationMessage({ settled: 3, cancelled: 0, failed: 0 })).toBe('3 settled');
    });

    it('should format cancelled count', () => {
      expect(formatReconciliationMessage({ settled: 0, cancelled: 2, failed: 0 })).toBe('2 cancelled');
    });

    it('should format combined counts', () => {
      expect(formatReconciliationMessage({ settled: 2, cancelled: 1, failed: 1 })).toBe('2 settled, 1 cancelled, 1 failed');
    });

    it('should return no pending message for noPendingTag', () => {
      expect(formatReconciliationMessage({ noPendingTag: true })).toBe('No pending transactions');
    });

    it('should return no pending message for noPendingTransactions', () => {
      expect(formatReconciliationMessage({ noPendingTransactions: true })).toBe('No pending transactions');
    });

    it('should return no pending message for zero counts', () => {
      expect(formatReconciliationMessage({ settled: 0, cancelled: 0, failed: 0 })).toBe('No pending transactions');
    });
  });
});