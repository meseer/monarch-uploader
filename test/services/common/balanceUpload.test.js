/**
 * Tests for Balance Upload Service
 */

import {
  generateBalanceCSV,
  generateBalanceHistoryCSV,
  applyBalanceSign,
  uploadSingleDayBalance,
  uploadBalanceHistory,
  executeBalanceUploadStep,
} from '../../../src/services/common/balanceUpload';

// Mock dependencies
jest.mock('../../../src/core/utils', () => ({
  debugLog: jest.fn(),
  getTodayLocal: jest.fn(() => '2025-02-17'),
  saveLastUploadDate: jest.fn(),
}));

jest.mock('../../../src/api/monarch', () => ({
  __esModule: true,
  default: {
    uploadBalance: jest.fn(),
  },
}));

import monarchApi from '../../../src/api/monarch';
import { saveLastUploadDate } from '../../../src/core/utils';

describe('Balance Upload Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('generateBalanceCSV', () => {
    it('should generate CSV with provided date', () => {
      const csv = generateBalanceCSV(-1500.50, 'My Card', '2025-01-15');

      expect(csv).toContain('"Date","Total Equity","Account Name"');
      expect(csv).toContain('"2025-01-15","-1500.5","My Card"');
    });

    it('should use today when no date provided', () => {
      const csv = generateBalanceCSV(100, 'Account');

      expect(csv).toContain('"2025-02-17","100","Account"');
    });

    it('should handle zero balance', () => {
      const csv = generateBalanceCSV(0, 'Account', '2025-01-01');

      expect(csv).toContain('"2025-01-01","0","Account"');
    });
  });

  describe('generateBalanceHistoryCSV', () => {
    it('should generate CSV with multiple entries', () => {
      const history = [
        { date: '2025-01-01', amount: -100 },
        { date: '2025-01-02', amount: -200 },
        { date: '2025-01-03', amount: -150 },
      ];

      const csv = generateBalanceHistoryCSV(history, 'My Card');

      expect(csv).toContain('"Date","Total Equity","Account Name"');
      expect(csv).toContain('"2025-01-01","-100","My Card"');
      expect(csv).toContain('"2025-01-02","-200","My Card"');
      expect(csv).toContain('"2025-01-03","-150","My Card"');
    });

    it('should handle empty history', () => {
      const csv = generateBalanceHistoryCSV([], 'Account');

      expect(csv).toBe('"Date","Total Equity","Account Name"\n');
    });
  });

  describe('applyBalanceSign', () => {
    it('should negate balance by default (credit card convention)', () => {
      expect(applyBalanceSign(1500)).toBe(-1500);
    });

    it('should keep positive when invertBalance is true', () => {
      expect(applyBalanceSign(1500, true)).toBe(1500);
    });

    it('should handle zero', () => {
      expect(applyBalanceSign(0)).toBe(-0);
      expect(applyBalanceSign(0, true)).toBe(0);
    });

    it('should handle negative raw balance', () => {
      expect(applyBalanceSign(-500)).toBe(500);
      expect(applyBalanceSign(-500, true)).toBe(-500);
    });

    it('should return null for null input', () => {
      expect(applyBalanceSign(null)).toBeNull();
    });

    it('should return null for undefined input', () => {
      expect(applyBalanceSign(undefined)).toBeNull();
    });
  });

  describe('uploadSingleDayBalance', () => {
    it('should upload balance CSV to Monarch', async () => {
      monarchApi.uploadBalance.mockResolvedValue(true);

      const result = await uploadSingleDayBalance({
        monarchAccountId: 'monarch-1',
        balance: -1500,
        accountName: 'My Card',
        date: '2025-01-15',
      });

      expect(result).toBe(true);
      expect(monarchApi.uploadBalance).toHaveBeenCalledWith(
        'monarch-1',
        expect.stringContaining('"2025-01-15","-1500","My Card"'),
        '2025-01-15',
        '2025-01-15',
      );
    });

    it('should use today when no date provided', async () => {
      monarchApi.uploadBalance.mockResolvedValue(true);

      await uploadSingleDayBalance({
        monarchAccountId: 'monarch-1',
        balance: -100,
        accountName: 'Card',
      });

      expect(monarchApi.uploadBalance).toHaveBeenCalledWith(
        'monarch-1',
        expect.any(String),
        '2025-02-17',
        '2025-02-17',
      );
    });
  });

  describe('uploadBalanceHistory', () => {
    it('should upload history CSV with date range', async () => {
      monarchApi.uploadBalance.mockResolvedValue(true);
      const history = [
        { date: '2025-01-01', amount: -100 },
        { date: '2025-01-02', amount: -200 },
      ];

      const result = await uploadBalanceHistory({
        monarchAccountId: 'monarch-1',
        balanceHistory: history,
        accountName: 'My Card',
        fromDate: '2025-01-01',
        toDate: '2025-01-02',
      });

      expect(result).toBe(true);
      expect(monarchApi.uploadBalance).toHaveBeenCalledWith(
        'monarch-1',
        expect.stringContaining('"2025-01-01","-100","My Card"'),
        '2025-01-01',
        '2025-01-02',
      );
    });
  });

  describe('executeBalanceUploadStep', () => {
    let mockProgressDialog;

    beforeEach(() => {
      mockProgressDialog = {
        updateStepStatus: jest.fn(),
        updateBalanceChange: jest.fn(),
      };
      monarchApi.uploadBalance.mockResolvedValue(true);
    });

    it('should skip when balance is null', async () => {
      const result = await executeBalanceUploadStep({
        integrationId: 'mbna',
        sourceAccountId: 'acc-1',
        monarchAccountId: 'monarch-1',
        accountName: 'Card',
        currentBalance: null,
        progressDialog: mockProgressDialog,
      });

      expect(result.success).toBe(true);
      expect(result.message).toBe('Not available');
      expect(result.monarchBalance).toBeNull();
      expect(mockProgressDialog.updateStepStatus).toHaveBeenCalledWith(
        'acc-1', 'balance', 'skipped', 'Not available',
      );
    });

    it('should upload single-day balance on regular sync', async () => {
      const result = await executeBalanceUploadStep({
        integrationId: 'mbna',
        sourceAccountId: 'acc-1',
        monarchAccountId: 'monarch-1',
        accountName: 'Card',
        currentBalance: 1500,
        progressDialog: mockProgressDialog,
      });

      expect(result.success).toBe(true);
      expect(result.monarchBalance).toBe(-1500);
      expect(monarchApi.uploadBalance).toHaveBeenCalled();
      expect(saveLastUploadDate).toHaveBeenCalledWith('acc-1', '2025-02-17', 'mbna');
    });

    it('should apply invertBalance on regular sync', async () => {
      const result = await executeBalanceUploadStep({
        integrationId: 'mbna',
        sourceAccountId: 'acc-1',
        monarchAccountId: 'monarch-1',
        accountName: 'Card',
        currentBalance: 1500,
        invertBalance: true,
        progressDialog: mockProgressDialog,
      });

      expect(result.monarchBalance).toBe(1500);
    });

    it('should upload balance history on first sync with reconstruction', async () => {
      const history = [
        { date: '2025-01-01', amount: -100 },
        { date: '2025-01-02', amount: -200 },
      ];

      const result = await executeBalanceUploadStep({
        integrationId: 'mbna',
        sourceAccountId: 'acc-1',
        monarchAccountId: 'monarch-1',
        accountName: 'Card',
        currentBalance: 200,
        isFirstSync: true,
        reconstructBalance: true,
        balanceHistory: history,
        fromDate: '2025-01-01',
        progressDialog: mockProgressDialog,
      });

      expect(result.success).toBe(true);
      expect(result.message).toBe('2 days');
      expect(mockProgressDialog.updateBalanceChange).toHaveBeenCalled();
    });

    it('should skip when first sync reconstruction has empty history', async () => {
      const result = await executeBalanceUploadStep({
        integrationId: 'mbna',
        sourceAccountId: 'acc-1',
        monarchAccountId: 'monarch-1',
        accountName: 'Card',
        currentBalance: 200,
        isFirstSync: true,
        reconstructBalance: true,
        balanceHistory: [],
        progressDialog: mockProgressDialog,
      });

      expect(result.success).toBe(true);
      expect(result.message).toBe('No history data');
    });

    it('should handle upload failure on regular sync', async () => {
      monarchApi.uploadBalance.mockResolvedValue(false);

      const result = await executeBalanceUploadStep({
        integrationId: 'mbna',
        sourceAccountId: 'acc-1',
        monarchAccountId: 'monarch-1',
        accountName: 'Card',
        currentBalance: 1500,
        progressDialog: mockProgressDialog,
      });

      expect(result.success).toBe(false);
      expect(result.message).toBe('Upload failed');
      expect(saveLastUploadDate).not.toHaveBeenCalled();
    });

    it('should handle upload failure on history reconstruction', async () => {
      monarchApi.uploadBalance.mockResolvedValue(false);
      const history = [{ date: '2025-01-01', amount: -100 }];

      const result = await executeBalanceUploadStep({
        integrationId: 'mbna',
        sourceAccountId: 'acc-1',
        monarchAccountId: 'monarch-1',
        accountName: 'Card',
        currentBalance: 100,
        isFirstSync: true,
        reconstructBalance: true,
        balanceHistory: history,
        progressDialog: mockProgressDialog,
      });

      expect(result.success).toBe(false);
      expect(result.message).toBe('Upload failed');
    });

    it('should work without progress dialog', async () => {
      const result = await executeBalanceUploadStep({
        integrationId: 'mbna',
        sourceAccountId: 'acc-1',
        monarchAccountId: 'monarch-1',
        accountName: 'Card',
        currentBalance: 1500,
      });

      expect(result.success).toBe(true);
      expect(result.monarchBalance).toBe(-1500);
    });

    it('should format success message with dollar amount', async () => {
      const result = await executeBalanceUploadStep({
        integrationId: 'mbna',
        sourceAccountId: 'acc-1',
        monarchAccountId: 'monarch-1',
        accountName: 'Card',
        currentBalance: 1500.75,
        progressDialog: mockProgressDialog,
      });

      expect(result.message).toBe('$1,500.75');
    });
  });
});