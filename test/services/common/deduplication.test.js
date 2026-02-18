/**
 * Tests for Transaction Deduplication Service
 */

import {
  filterDuplicateSettledTransactions,
  filterDuplicatePendingTransactions,
  getUploadedTransactionIds,
} from '../../../src/services/common/deduplication';

// Mock dependencies
jest.mock('../../../src/core/utils', () => ({
  debugLog: jest.fn(),
}));

jest.mock('../../../src/services/common/accountService', () => ({
  __esModule: true,
  default: {
    getAccountData: jest.fn(),
  },
}));

jest.mock('../../../src/utils/transactionStorage', () => ({
  getTransactionIdsFromArray: jest.fn((arr) => new Set(arr.map((item) => (typeof item === 'string' ? item : item.id)))),
}));

import accountService from '../../../src/services/common/accountService';

describe('Transaction Deduplication Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    accountService.getAccountData.mockReturnValue(null);
  });

  describe('filterDuplicateSettledTransactions', () => {
    const getRefId = (tx) => tx.referenceNumber;

    it('should return all transactions when no previous uploads', () => {
      const transactions = [
        { referenceNumber: 'ref-1', amount: 10 },
        { referenceNumber: 'ref-2', amount: 20 },
      ];

      const result = filterDuplicateSettledTransactions('mbna', 'acc-1', transactions, getRefId);

      expect(result.newTransactions).toHaveLength(2);
      expect(result.duplicateCount).toBe(0);
    });

    it('should filter out already-uploaded transactions', () => {
      accountService.getAccountData.mockReturnValue({
        uploadedTransactions: [
          { id: 'ref-1', date: '2025-01-01' },
          { id: 'ref-2', date: '2025-01-02' },
        ],
      });

      const transactions = [
        { referenceNumber: 'ref-1', amount: 10 },
        { referenceNumber: 'ref-2', amount: 20 },
        { referenceNumber: 'ref-3', amount: 30 },
      ];

      const result = filterDuplicateSettledTransactions('mbna', 'acc-1', transactions, getRefId);

      expect(result.newTransactions).toHaveLength(1);
      expect(result.newTransactions[0].referenceNumber).toBe('ref-3');
      expect(result.duplicateCount).toBe(2);
    });

    it('should return empty when all are duplicates', () => {
      accountService.getAccountData.mockReturnValue({
        uploadedTransactions: [{ id: 'ref-1', date: '2025-01-01' }],
      });

      const transactions = [{ referenceNumber: 'ref-1', amount: 10 }];

      const result = filterDuplicateSettledTransactions('mbna', 'acc-1', transactions, getRefId);

      expect(result.newTransactions).toHaveLength(0);
      expect(result.duplicateCount).toBe(1);
    });

    it('should handle empty transaction list', () => {
      const result = filterDuplicateSettledTransactions('mbna', 'acc-1', [], getRefId);

      expect(result.newTransactions).toHaveLength(0);
      expect(result.duplicateCount).toBe(0);
    });

    it('should work with different integrations', () => {
      accountService.getAccountData.mockReturnValue({
        uploadedTransactions: [{ id: 'rb-ref-1', date: '2025-01-01' }],
      });

      const transactions = [
        { referenceNumber: 'rb-ref-1', amount: 10 },
        { referenceNumber: 'rb-ref-2', amount: 20 },
      ];

      const result = filterDuplicateSettledTransactions('rogersbank', 'rb-1', transactions, getRefId);

      expect(result.newTransactions).toHaveLength(1);
      expect(result.duplicateCount).toBe(1);
    });

    it('should use custom getRefId callback', () => {
      accountService.getAccountData.mockReturnValue({
        uploadedTransactions: [{ id: 'custom-id-1', date: '2025-01-01' }],
      });

      const transactions = [
        { customField: 'custom-id-1', amount: 10 },
        { customField: 'custom-id-2', amount: 20 },
      ];

      const customGetRefId = (tx) => tx.customField;
      const result = filterDuplicateSettledTransactions('mbna', 'acc-1', transactions, customGetRefId);

      expect(result.newTransactions).toHaveLength(1);
      expect(result.duplicateCount).toBe(1);
    });
  });

  describe('filterDuplicatePendingTransactions', () => {
    const getRefId = (tx) => tx.pendingId;

    it('should return all transactions when no previous uploads', () => {
      const transactions = [
        { pendingId: 'pending-1', amount: 10 },
        { pendingId: 'pending-2', amount: 20 },
      ];

      const result = filterDuplicatePendingTransactions('mbna', 'acc-1', transactions, getRefId);

      expect(result.newTransactions).toHaveLength(2);
      expect(result.duplicateCount).toBe(0);
    });

    it('should filter out already-uploaded pending transactions', () => {
      accountService.getAccountData.mockReturnValue({
        uploadedTransactions: [{ id: 'pending-1', date: '2025-01-01' }],
      });

      const transactions = [
        { pendingId: 'pending-1', amount: 10 },
        { pendingId: 'pending-2', amount: 20 },
      ];

      const result = filterDuplicatePendingTransactions('mbna', 'acc-1', transactions, getRefId);

      expect(result.newTransactions).toHaveLength(1);
      expect(result.newTransactions[0].pendingId).toBe('pending-2');
      expect(result.duplicateCount).toBe(1);
    });

    it('should keep transactions with null/undefined refId (not yet hashed)', () => {
      accountService.getAccountData.mockReturnValue({
        uploadedTransactions: [{ id: 'pending-1', date: '2025-01-01' }],
      });

      const transactions = [
        { pendingId: null, amount: 10 },
        { pendingId: undefined, amount: 20 },
        { pendingId: 'pending-1', amount: 30 },
      ];

      const result = filterDuplicatePendingTransactions('mbna', 'acc-1', transactions, getRefId);

      // null and undefined refIds should pass through (not filtered)
      expect(result.newTransactions).toHaveLength(2);
      expect(result.duplicateCount).toBe(1);
    });

    it('should handle empty transaction list', () => {
      const result = filterDuplicatePendingTransactions('mbna', 'acc-1', [], getRefId);

      expect(result.newTransactions).toHaveLength(0);
      expect(result.duplicateCount).toBe(0);
    });
  });

  describe('getUploadedTransactionIds', () => {
    it('should return empty set when no account data', () => {
      const ids = getUploadedTransactionIds('mbna', 'acc-1');

      expect(ids).toBeInstanceOf(Set);
      expect(ids.size).toBe(0);
    });

    it('should return set of uploaded IDs', () => {
      accountService.getAccountData.mockReturnValue({
        uploadedTransactions: [
          { id: 'ref-1', date: '2025-01-01' },
          { id: 'ref-2', date: '2025-01-02' },
        ],
      });

      const ids = getUploadedTransactionIds('mbna', 'acc-1');

      expect(ids.size).toBe(2);
      expect(ids.has('ref-1')).toBe(true);
      expect(ids.has('ref-2')).toBe(true);
    });

    it('should return empty set when uploadedTransactions is empty', () => {
      accountService.getAccountData.mockReturnValue({
        uploadedTransactions: [],
      });

      const ids = getUploadedTransactionIds('mbna', 'acc-1');

      expect(ids.size).toBe(0);
    });
  });
});