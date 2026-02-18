/**
 * Tests for Transaction Upload Service
 */

import {
  uploadTransactionsAndSaveRefs,
  formatTransactionUploadMessage,
} from '../../../src/services/common/transactionUpload';

// Mock dependencies
jest.mock('../../../src/core/utils', () => ({
  debugLog: jest.fn(),
  getTodayLocal: jest.fn(() => '2025-02-17'),
  saveLastUploadDate: jest.fn(),
}));

jest.mock('../../../src/api/monarch', () => ({
  __esModule: true,
  default: {
    uploadTransactions: jest.fn(),
  },
}));

jest.mock('../../../src/services/common/accountService', () => ({
  __esModule: true,
  default: {
    getAccountData: jest.fn(),
    updateAccountInList: jest.fn(() => true),
  },
}));

jest.mock('../../../src/utils/transactionStorage', () => ({
  mergeAndRetainTransactions: jest.fn((existing, newRefs, settings, date) => [
    ...existing,
    ...newRefs.map((id) => ({ id, date })),
  ]),
  getRetentionSettingsFromAccount: jest.fn(() => ({
    retentionDays: 91,
    retentionCount: 1000,
  })),
}));

import monarchApi from '../../../src/api/monarch';
import accountService from '../../../src/services/common/accountService';
import { saveLastUploadDate } from '../../../src/core/utils';
import { mergeAndRetainTransactions } from '../../../src/utils/transactionStorage';

describe('Transaction Upload Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    accountService.getAccountData.mockReturnValue(null);
  });

  describe('uploadTransactionsAndSaveRefs', () => {
    it('should upload CSV and save refs on success', async () => {
      monarchApi.uploadTransactions.mockResolvedValue(true);

      const result = await uploadTransactionsAndSaveRefs({
        integrationId: 'mbna',
        sourceAccountId: 'acc-1',
        monarchAccountId: 'monarch-1',
        csvData: 'csv-content',
        filename: 'test.csv',
        transactionRefs: ['ref-1', 'ref-2'],
        transactions: [{ date: '2025-01-15' }, { date: '2025-01-10' }],
      });

      expect(result).toBe(true);
      expect(monarchApi.uploadTransactions).toHaveBeenCalledWith(
        'monarch-1', 'csv-content', 'test.csv', false, false,
      );
    });

    it('should return false on upload failure', async () => {
      monarchApi.uploadTransactions.mockResolvedValue(false);

      const result = await uploadTransactionsAndSaveRefs({
        integrationId: 'mbna',
        sourceAccountId: 'acc-1',
        monarchAccountId: 'monarch-1',
        csvData: 'csv-content',
        filename: 'test.csv',
        transactionRefs: ['ref-1'],
        transactions: [],
      });

      expect(result).toBe(false);
      expect(accountService.updateAccountInList).not.toHaveBeenCalled();
      expect(saveLastUploadDate).not.toHaveBeenCalled();
    });

    it('should merge new refs with existing uploaded transactions', async () => {
      monarchApi.uploadTransactions.mockResolvedValue(true);
      accountService.getAccountData.mockReturnValue({
        uploadedTransactions: [{ id: 'old-ref', date: '2025-01-01' }],
      });

      await uploadTransactionsAndSaveRefs({
        integrationId: 'mbna',
        sourceAccountId: 'acc-1',
        monarchAccountId: 'monarch-1',
        csvData: 'csv-content',
        filename: 'test.csv',
        transactionRefs: ['new-ref-1', 'new-ref-2'],
        transactions: [{ date: '2025-01-20' }],
      });

      expect(mergeAndRetainTransactions).toHaveBeenCalledWith(
        [{ id: 'old-ref', date: '2025-01-01' }],
        ['new-ref-1', 'new-ref-2'],
        { retentionDays: 91, retentionCount: 1000 },
        '2025-01-20',
      );

      expect(accountService.updateAccountInList).toHaveBeenCalledWith(
        'mbna', 'acc-1',
        expect.objectContaining({ uploadedTransactions: expect.any(Array) }),
      );
    });

    it('should use latest transaction date for ref storage', async () => {
      monarchApi.uploadTransactions.mockResolvedValue(true);

      await uploadTransactionsAndSaveRefs({
        integrationId: 'mbna',
        sourceAccountId: 'acc-1',
        monarchAccountId: 'monarch-1',
        csvData: 'csv',
        filename: 'test.csv',
        transactionRefs: ['ref-1'],
        transactions: [
          { date: '2025-01-10' },
          { date: '2025-01-20' },
          { date: '2025-01-15' },
        ],
      });

      // Should use the latest date (2025-01-20)
      expect(mergeAndRetainTransactions).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(Array),
        expect.any(Object),
        '2025-01-20',
      );
    });

    it('should use today as fallback when no transactions have dates', async () => {
      monarchApi.uploadTransactions.mockResolvedValue(true);

      await uploadTransactionsAndSaveRefs({
        integrationId: 'mbna',
        sourceAccountId: 'acc-1',
        monarchAccountId: 'monarch-1',
        csvData: 'csv',
        filename: 'test.csv',
        transactionRefs: ['ref-1'],
        transactions: [{ amount: 10 }, { amount: 20 }],
      });

      expect(mergeAndRetainTransactions).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(Array),
        expect.any(Object),
        '2025-02-17',
      );
    });

    it('should skip ref storage when transactionRefs is empty', async () => {
      monarchApi.uploadTransactions.mockResolvedValue(true);

      await uploadTransactionsAndSaveRefs({
        integrationId: 'mbna',
        sourceAccountId: 'acc-1',
        monarchAccountId: 'monarch-1',
        csvData: 'csv',
        filename: 'test.csv',
        transactionRefs: [],
        transactions: [],
      });

      expect(mergeAndRetainTransactions).not.toHaveBeenCalled();
      // Should still save upload date
      expect(saveLastUploadDate).toHaveBeenCalled();
    });

    it('should save last upload date after successful upload', async () => {
      monarchApi.uploadTransactions.mockResolvedValue(true);

      await uploadTransactionsAndSaveRefs({
        integrationId: 'rogersbank',
        sourceAccountId: 'rb-1',
        monarchAccountId: 'monarch-1',
        csvData: 'csv',
        filename: 'test.csv',
        transactionRefs: [],
        transactions: [],
      });

      expect(saveLastUploadDate).toHaveBeenCalledWith('rb-1', '2025-02-17', 'rogersbank');
    });

    it('should handle empty existing uploadedTransactions', async () => {
      monarchApi.uploadTransactions.mockResolvedValue(true);
      accountService.getAccountData.mockReturnValue({
        uploadedTransactions: [],
      });

      await uploadTransactionsAndSaveRefs({
        integrationId: 'mbna',
        sourceAccountId: 'acc-1',
        monarchAccountId: 'monarch-1',
        csvData: 'csv',
        filename: 'test.csv',
        transactionRefs: ['ref-1'],
        transactions: [{ date: '2025-01-15' }],
      });

      expect(mergeAndRetainTransactions).toHaveBeenCalledWith(
        [],
        ['ref-1'],
        expect.any(Object),
        '2025-01-15',
      );
    });
  });

  describe('formatTransactionUploadMessage', () => {
    it('should format settled only', () => {
      expect(formatTransactionUploadMessage(5, 0, 0)).toBe('5 settled uploaded');
    });

    it('should format pending only', () => {
      expect(formatTransactionUploadMessage(0, 3, 0)).toBe('3 pending uploaded');
    });

    it('should format both settled and pending', () => {
      expect(formatTransactionUploadMessage(5, 3, 0)).toBe('5 settled, 3 pending uploaded');
    });

    it('should format with duplicates skipped', () => {
      expect(formatTransactionUploadMessage(5, 0, 2)).toBe('5 settled uploaded (2 skipped)');
    });

    it('should format settled and pending with duplicates', () => {
      expect(formatTransactionUploadMessage(5, 3, 2)).toBe('5 settled, 3 pending uploaded (2 skipped)');
    });

    it('should format duplicates only (no new transactions)', () => {
      expect(formatTransactionUploadMessage(0, 0, 10)).toBe('10 already uploaded');
    });

    it('should format no transactions at all', () => {
      expect(formatTransactionUploadMessage(0, 0, 0)).toBe('No new');
    });
  });
});