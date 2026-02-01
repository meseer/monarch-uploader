/**
 * Balance Service Tests
 */

import {
  BalanceError,
  fetchBalanceHistory,
  processBalanceData,
  getDefaultDateRange,
  storeDateRange,
  uploadBalanceToMonarch,
  processAndUploadBalance,
  bulkProcessAccounts,
} from '../../../src/services/questrade/balance';
import questradeApi from '../../../src/api/questrade';
import monarchApi from '../../../src/api/monarch';
import accountService from '../../../src/services/common/accountService';
import stateManager from '../../../src/core/state';
import toast from '../../../src/ui/toast';
import * as utils from '../../../src/core/utils';

// Mock dependencies
jest.mock('../../../src/api/questrade', () => ({
  makeApiCall: jest.fn(),
}));

jest.mock('../../../src/api/monarch', () => ({
  uploadBalance: jest.fn(),
  resolveAccountMapping: jest.fn(),
  listAccounts: jest.fn(),
}));

jest.mock('../../../src/services/common/accountService', () => ({
  getMonarchAccountMapping: jest.fn(),
  upsertAccount: jest.fn(),
}));

jest.mock('../../../src/ui/components/accountSelectorWithCreate', () => ({
  showMonarchAccountSelectorWithCreate: jest.fn(),
}));

jest.mock('../../../src/core/state', () => ({
  setAccount: jest.fn(),
  getState: jest.fn().mockReturnValue({
    currentAccount: { name: 'Test Account' },
  }),
}));

jest.mock('../../../src/ui/toast', () => ({
  show: jest.fn(),
}));

// Mock utils functions for date storage
jest.mock('../../../src/core/utils', () => {
  const actual = jest.requireActual('../../../src/core/utils');
  return {
    ...actual,
    getLastUpdateDate: jest.fn(),
    saveLastUploadDate: jest.fn(),
  };
});

// Mock GM storage functions
globalThis.GM_getValue = jest.fn();
globalThis.GM_setValue = jest.fn();

describe('Balance Service', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();

    // Set up console mocks for debugLog
    globalThis.console = { log: jest.fn() };
  });

  describe('fetchBalanceHistory', () => {
    test('should fetch and return balance history data', async () => {
      // Mock API responses
      const mockBalanceData = {
        totalEquity: {
          combined: [{ currencyCode: 'CAD', amount: 10000 }],
        },
      };

      const mockHistoryData = {
        data: [
          { date: '2025-01-01', totalEquity: 9800 },
          { date: '2025-01-02', totalEquity: 9900 },
        ],
      };

      // Setup mocks
      questradeApi.makeApiCall
        .mockResolvedValueOnce(mockBalanceData)
        .mockResolvedValueOnce(mockHistoryData);

      const result = await fetchBalanceHistory('12345', '2025-01-01', '2025-01-31');

      expect(questradeApi.makeApiCall).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        currentBalance: mockBalanceData,
        history: mockHistoryData,
      });
    });

    test('should throw BalanceError when dates are invalid', async () => {
      await expect(fetchBalanceHistory('12345', '', '2025-01-31'))
        .rejects
        .toThrow(BalanceError);

      expect(questradeApi.makeApiCall).not.toHaveBeenCalled();
    });

    test('should throw BalanceError when API call fails', async () => {
      questradeApi.makeApiCall.mockRejectedValueOnce(new Error('API Error'));

      await expect(fetchBalanceHistory('12345', '2025-01-01', '2025-01-31'))
        .rejects
        .toThrow(BalanceError);
    });
  });

  describe('processBalanceData', () => {
    test('should process raw data into CSV format', () => {
      const rawData = {
        currentBalance: {
          totalEquity: {
            combined: [{ currencyCode: 'CAD', amount: 10000 }],
          },
        },
        history: {
          data: [
            { date: '2025-01-01', totalEquity: 9800 },
            { date: '2025-01-02', totalEquity: 9900 },
          ],
        },
      };

      const result = processBalanceData(rawData, 'Test Account');

      // Check that CSV contains header and data rows
      expect(result).toContain('"Date","Total Equity","Account Name"');
      expect(result).toContain('"2025-01-01","9800","Test Account"');
      expect(result).toContain('"2025-01-02","9900","Test Account"');

      // Check that current balance is included with today's date (flexible date check)
      expect(result).toContain('"10000","Test Account"');
      // Check that today's date pattern is present (YYYY-MM-DD format)
      expect(result).toMatch(/"20\d{2}-\d{2}-\d{2}","10000","Test Account"/);
    });

    test('should throw error when invalid data is provided', () => {
      expect(() => processBalanceData({}, 'Test Account'))
        .toThrow('Failed to process balance data');
    });
  });

  describe('Date Range Management', () => {
    test('getDefaultDateRange should return default dates when no saved date', () => {
      // Mock no saved date
      GM_getValue.mockReturnValueOnce(null);

      const result = getDefaultDateRange('12345', 30);

      expect(result).toHaveProperty('fromDate');
      expect(result).toHaveProperty('toDate');

      // Check that fromDate is approximately 30 days ago (allow for some variance)
      const fromDate = new Date(result.fromDate);
      const today = new Date();
      const daysDiff = Math.round((today - fromDate) / (1000 * 60 * 60 * 24));

      expect(daysDiff).toBeGreaterThanOrEqual(29);
      expect(daysDiff).toBeLessThanOrEqual(31);
    });

    test('getDefaultDateRange should use saved date when available', () => {
      // Mock saved date (30 days ago) via getLastUpdateDate
      const savedDate = new Date();
      savedDate.setDate(savedDate.getDate() - 30);
      const savedDateStr = savedDate.toISOString().split('T')[0];
      utils.getLastUpdateDate.mockReturnValueOnce(savedDateStr);

      const result = getDefaultDateRange('12345');

      // Check that fromDate matches saved date
      expect(result.fromDate).toBe(savedDateStr);
      expect(utils.getLastUpdateDate).toHaveBeenCalledWith('12345', 'questrade');
    });

    test('storeDateRange should save date for account', () => {
      storeDateRange('12345', '2025-01-31');

      // Should now call saveLastUploadDate instead of direct GM_setValue
      expect(utils.saveLastUploadDate).toHaveBeenCalledWith('12345', 'questrade', '2025-01-31');
    });
  });

  describe('uploadBalanceToMonarch', () => {
    test('should upload CSV data to Monarch', async () => {
      // Mock successful upload and account mapping via accountService
      accountService.getMonarchAccountMapping.mockReturnValueOnce({ id: 'monarch-account-123', displayName: 'My Account' });
      monarchApi.uploadBalance.mockResolvedValueOnce(true);

      const result = await uploadBalanceToMonarch(
        '12345',
        '"Date","Amount"\n"2025-01-01","1000"',
        '2025-01-01',
        '2025-01-31',
      );

      expect(result).toBe(true);
      expect(accountService.getMonarchAccountMapping).toHaveBeenCalled();
      expect(monarchApi.uploadBalance).toHaveBeenCalled();
    });

    test('should throw BalanceError when no CSV data', async () => {
      await expect(uploadBalanceToMonarch('12345', '', '2025-01-01', '2025-01-31'))
        .rejects
        .toThrow(BalanceError);

      expect(monarchApi.uploadBalance).not.toHaveBeenCalled();
    });
  });

  describe('processAndUploadBalance', () => {
    test('should complete the full balance processing workflow', async () => {
      // Mock successful API calls and account mapping via accountService
      accountService.getMonarchAccountMapping.mockReturnValueOnce({ id: 'monarch-account-123', displayName: 'My Account' });
      questradeApi.makeApiCall
        .mockResolvedValueOnce({
          totalEquity: {
            combined: [{ currencyCode: 'CAD', amount: 10000 }],
          },
        })
        .mockResolvedValueOnce({
          data: [
            { date: '2025-01-01', totalEquity: 9800 },
            { date: '2025-01-02', totalEquity: 9900 },
          ],
        });

      monarchApi.uploadBalance.mockResolvedValueOnce(true);

      const result = await processAndUploadBalance(
        '12345',
        'Test Account',
        '2025-01-01',
        '2025-01-31',
      );

      // Check result
      expect(result).toBe(true);
      expect(stateManager.setAccount).toHaveBeenCalledWith('12345', 'Test Account');
      expect(questradeApi.makeApiCall).toHaveBeenCalledTimes(2);
      expect(monarchApi.uploadBalance).toHaveBeenCalled();
    });

    test('should handle errors and show error toast', async () => {
      // Mock API failure directly
      questradeApi.makeApiCall.mockRejectedValueOnce(new Error('Failed to fetch current balance data'));

      const result = await processAndUploadBalance(
        '12345',
        'Test Account',
        '2025-01-01',
        '2025-01-31',
      );

      // Check result and error toast (should show the actual error message from the service)
      expect(result).toBe(false);
      expect(toast.show).toHaveBeenCalledWith('Failed to fetch balance history: Failed to fetch current balance data', 'error');
    });
  });

  describe('bulkProcessAccounts', () => {
    test('should process multiple accounts sequentially', async () => {
      // Mock accounts with correct property names
      const accounts = [
        { id: '12345', nickname: 'Account 1' },
        { id: '67890', nickname: 'Account 2' },
      ];

      // Mock successful API calls for both accounts via accountService
      accountService.getMonarchAccountMapping.mockReturnValue({ id: 'monarch-account-123', displayName: 'My Account' });
      questradeApi.makeApiCall.mockResolvedValue({
        totalEquity: {
          combined: [{ currencyCode: 'CAD', amount: 10000 }],
        },
      });

      monarchApi.uploadBalance.mockResolvedValue(true);

      const result = await bulkProcessAccounts(
        accounts,
        '2025-01-01',
        '2025-01-31',
      );

      // Check results
      expect(result.success).toBe(2);
      expect(result.failed).toBe(0);
      expect(toast.show).toHaveBeenCalledWith('Completed: 2 successful, 0 failed', 'info');
    });

    test('should handle mixed success and failure', async () => {
      // Mock accounts with correct property names
      const accounts = [
        { id: '12345', nickname: 'Account 1' },
        { id: '67890', nickname: 'Account 2' },
      ];

      // Mock first account success, second account failure via accountService
      accountService.getMonarchAccountMapping
        .mockReturnValueOnce({ id: 'monarch-account-123', displayName: 'Account 1' })
        .mockReturnValueOnce({ id: 'monarch-account-456', displayName: 'Account 2' });
      questradeApi.makeApiCall
        .mockResolvedValueOnce({
          totalEquity: {
            combined: [{ currencyCode: 'CAD', amount: 10000 }],
          },
        })
        .mockResolvedValueOnce({
          data: [{ date: '2025-01-01', totalEquity: 9800 }],
        })
        .mockRejectedValueOnce(new Error('API Error')); // Fail on second account

      monarchApi.uploadBalance.mockResolvedValue(true);

      const result = await bulkProcessAccounts(
        accounts,
        '2025-01-01',
        '2025-01-31',
      );

      // Check results
      expect(result.success).toBe(1);
      expect(result.failed).toBe(1);
      expect(toast.show).toHaveBeenCalledWith('Completed: 1 successful, 1 failed', 'warning');
    });

    test('should handle empty accounts list', async () => {
      const result = await bulkProcessAccounts(
        [],
        '2025-01-01',
        '2025-01-31',
      );

      // Check results
      expect(result.success).toBe(0);
      expect(result.failed).toBe(0);
      expect(toast.show).toHaveBeenCalledWith('No accounts to process', 'warning');
    });

    test('should handle null accounts list', async () => {
      const result = await bulkProcessAccounts(
        null,
        '2025-01-01',
        '2025-01-31',
      );

      // Check results
      expect(result.success).toBe(0);
      expect(result.failed).toBe(0);
      expect(toast.show).toHaveBeenCalledWith('No accounts to process', 'warning');
    });
  });

  describe('Real Code Path Tests', () => {
    beforeEach(() => {
      // Mock only the external dependencies, let internal logic execute
      jest.clearAllMocks();
    });

    test('should handle real date parsing and validation in getDefaultDateRange', () => {
      // Test with no saved date - should use default lookback
      GM_getValue.mockReturnValue(null);

      const result = getDefaultDateRange('test-account', 60);

      expect(result).toHaveProperty('fromDate');
      expect(result).toHaveProperty('toDate');
      expect(typeof result.fromDate).toBe('string');
      expect(typeof result.toDate).toBe('string');

      // Verify date format (YYYY-MM-DD)
      expect(result.fromDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(result.toDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    test('should handle invalid saved date and fallback to default', () => {
      // Test with invalid saved date
      GM_getValue.mockReturnValue('invalid-date');

      const result = getDefaultDateRange('test-account', 30);

      expect(result).toHaveProperty('fromDate');
      expect(result).toHaveProperty('toDate');

      // Should fallback to default behavior when parsing fails
      expect(result.fromDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(result.toDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    test('should handle future saved date and fallback to default', () => {
      // Test with future date (should fallback)
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 10);
      GM_getValue.mockReturnValue(futureDate.toISOString().split('T')[0]);

      const result = getDefaultDateRange('test-account', 30);

      expect(result).toHaveProperty('fromDate');
      expect(result).toHaveProperty('toDate');

      // Should fallback to default lookback when saved date is in future
      const fromDate = new Date(result.fromDate);
      const toDate = new Date(result.toDate);
      expect(fromDate.getTime()).toBeLessThan(toDate.getTime());
    });

    test('should execute real error handling in processBalanceData', () => {
      // Test with null data
      expect(() => processBalanceData(null, 'Test Account')).toThrow('Failed to process balance data: Invalid balance data provided');

      // Test with missing history
      expect(() => processBalanceData({ currentBalance: {} }, 'Test Account')).toThrow('Failed to process balance data: Invalid balance data provided');

      // Test with invalid history structure
      expect(() => processBalanceData({ history: { data: 'not-an-array' } }, 'Test Account')).not.toThrow();
    });

    test('should execute real CSV processing with various data structures', () => {
      // Test with complete data structure
      const completeData = {
        currentBalance: {
          totalEquity: {
            combined: [
              { currencyCode: 'USD', amount: 5000 },
              { currencyCode: 'CAD', amount: 10000 },
            ],
          },
        },
        history: {
          data: [
            { date: '2024-12-01', totalEquity: 9500 },
            { date: '2024-12-02', totalEquity: 9750 },
            { date: '2024-12-03', totalEquity: 9900 },
          ],
        },
      };

      const result = processBalanceData(completeData, 'My Investment Account');

      // Should contain header
      expect(result).toContain('"Date","Total Equity","Account Name"');

      // Should contain historical data
      expect(result).toContain('"2024-12-01","9500","My Investment Account"');
      expect(result).toContain('"2024-12-02","9750","My Investment Account"');
      expect(result).toContain('"2024-12-03","9900","My Investment Account"');

      // Should contain current balance (CAD only)
      expect(result).toContain('"10000","My Investment Account"');

      // Should NOT contain USD balance
      expect(result).not.toContain('"5000","My Investment Account"');
    });

    test('should handle missing CAD balance in current data', () => {
      const dataWithoutCAD = {
        currentBalance: {
          totalEquity: {
            combined: [
              { currencyCode: 'USD', amount: 5000 },
              { currencyCode: 'EUR', amount: 3000 },
            ],
          },
        },
        history: {
          data: [
            { date: '2024-12-01', totalEquity: 9500 },
          ],
        },
      };

      const result = processBalanceData(dataWithoutCAD, 'USD Account');

      // Should still process historical data
      expect(result).toContain('"2024-12-01","9500","USD Account"');

      // Should not contain current balance since no CAD found
      expect(result).not.toContain('"5000","USD Account"');
      expect(result).not.toContain('"3000","USD Account"');
    });

    test('should execute real error handling in fetchBalanceHistory', async () => {
      // Test missing dates
      await expect(fetchBalanceHistory('account123', '', '2024-12-31')).rejects.toThrow(BalanceError);
      await expect(fetchBalanceHistory('account123', '2024-01-01', '')).rejects.toThrow(BalanceError);
      await expect(fetchBalanceHistory('account123', null, '2024-12-31')).rejects.toThrow(BalanceError);

      // Test that error message contains account ID
      try {
        await fetchBalanceHistory('test-account-456', '', '2024-12-31');
      } catch (error) {
        expect(error.accountId).toBe('test-account-456');
        expect(error.message).toBe('Invalid date range provided');
      }
    });

    test('should execute real error handling in uploadBalanceToMonarch', async () => {
      // Test missing CSV data
      await expect(uploadBalanceToMonarch('account123', '', '2024-01-01', '2024-12-31')).rejects.toThrow(BalanceError);
      await expect(uploadBalanceToMonarch('account123', null, '2024-01-01', '2024-12-31')).rejects.toThrow(BalanceError);

      // Test that error contains account ID
      try {
        await uploadBalanceToMonarch('test-account-789', '', '2024-01-01', '2024-12-31');
      } catch (error) {
        expect(error.accountId).toBe('test-account-789');
        expect(error.message).toBe('No CSV data to upload');
      }
    });

    test('should execute real error handling in processAndUploadBalance', async () => {
      // Test missing account info
      const result1 = await processAndUploadBalance('', 'Test Account', '2024-01-01', '2024-12-31');
      expect(result1).toBe(false);
      expect(toast.show).toHaveBeenCalledWith('Account information missing', 'error');

      const result2 = await processAndUploadBalance('account123', '', '2024-01-01', '2024-12-31');
      expect(result2).toBe(false);
      expect(toast.show).toHaveBeenCalledWith('Account information missing', 'error');
    });

    test('should handle state management correctly', async () => {
      // Mock successful flow to test state management via accountService
      accountService.getMonarchAccountMapping.mockReturnValue({ id: 'monarch-123', displayName: 'My Account' });
      questradeApi.makeApiCall
        .mockResolvedValueOnce({ totalEquity: { combined: [{ currencyCode: 'CAD', amount: 10000 }] } })
        .mockResolvedValueOnce({ data: [{ date: '2024-12-01', totalEquity: 9500 }] });
      monarchApi.uploadBalance.mockResolvedValue(true);

      const result = await processAndUploadBalance('test-account', 'My Test Account', '2024-01-01', '2024-12-31');

      expect(result).toBe(true);
      expect(stateManager.setAccount).toHaveBeenCalledWith('test-account', 'My Test Account');
      expect(toast.show).toHaveBeenCalledWith('Downloading My Test Account balance history...', 'trace');
      expect(toast.show).toHaveBeenCalledWith('Uploading My Test Account balance history to Monarch (may take up to 2 minutes for large files)...', 'trace');
      expect(toast.show).toHaveBeenCalledWith('Successfully uploaded My Test Account balance history to Monarch', 'info');
    });

    test('should store date range on successful upload', async () => {
      // Test the storeDateRange function with edge cases
      storeDateRange('', '2024-12-31');
      expect(utils.saveLastUploadDate).not.toHaveBeenCalled();

      storeDateRange('account123', '');
      expect(utils.saveLastUploadDate).not.toHaveBeenCalled();

      storeDateRange('account123', '2024-12-31');
      expect(utils.saveLastUploadDate).toHaveBeenCalledWith('account123', 'questrade', '2024-12-31');
    });

    test('should handle saveLastUploadDate errors gracefully', () => {
      // Mock saveLastUploadDate to throw an error
      utils.saveLastUploadDate.mockImplementation(() => {
        throw new Error('Storage error');
      });

      // Should not crash when storage fails
      expect(() => storeDateRange('account123', '2024-12-31')).not.toThrow();
    });
  });

  describe('BalanceError Class', () => {
    test('should create BalanceError with message and accountId', () => {
      const error = new BalanceError('Test error message', 'account-456');

      expect(error.message).toBe('Test error message');
      expect(error.accountId).toBe('account-456');
      expect(error.name).toBe('BalanceError');
      expect(error instanceof Error).toBe(true);
      expect(error instanceof BalanceError).toBe(true);
    });

    test('should have proper error stack trace', () => {
      const error = new BalanceError('Stack test', 'account-789');
      expect(error.stack).toBeDefined();
      expect(error.toString()).toContain('BalanceError: Stack test');
    });

    test('should handle undefined accountId', () => {
      const error = new BalanceError('Test message', undefined);
      expect(error.message).toBe('Test message');
      expect(error.accountId).toBeUndefined();
    });
  });

  describe('Edge Cases and Error Handling', () => {
    test('should handle corrupt balance data structures', () => {
      const corruptData = {
        currentBalance: {
          totalEquity: null, // Null totalEquity
        },
        history: {
          data: [
            { date: '2024-12-01' }, // Missing totalEquity
            { totalEquity: 9500 }, // Missing date
            { date: null, totalEquity: null }, // Both null
          ],
        },
      };

      const result = processBalanceData(corruptData, 'Corrupt Account');

      // Should still generate CSV with header
      expect(result).toContain('"Date","Total Equity","Account Name"');

      // Should handle missing/null values gracefully
      expect(result).toContain('"2024-12-01","","Corrupt Account"');
      expect(result).toContain('"","9500","Corrupt Account"');
      expect(result).toContain('"","","Corrupt Account"');
    });

    test('should handle empty arrays and undefined values', () => {
      const emptyData = {
        currentBalance: {
          totalEquity: {
            combined: [], // Empty array
          },
        },
        history: {
          data: [], // Empty history
        },
      };

      const result = processBalanceData(emptyData, 'Empty Account');

      // Should still generate valid CSV with just header
      expect(result).toBe('"Date","Total Equity","Account Name"\n');
    });

    test('should handle malformed currentBalance structure', () => {
      const malformedData = {
        currentBalance: 'not-an-object',
        history: {
          data: [{ date: '2024-12-01', totalEquity: 9500 }],
        },
      };

      const result = processBalanceData(malformedData, 'Malformed Account');

      // Should still process history data
      expect(result).toContain('"2024-12-01","9500","Malformed Account"');

      // Should not crash on malformed currentBalance
      expect(result).toContain('"Date","Total Equity","Account Name"');
    });

    test('should validate API response structure in fetchBalanceHistory', async () => {
      // Test with null API responses - first call returns null
      questradeApi.makeApiCall.mockResolvedValueOnce(null);

      await expect(fetchBalanceHistory('account123', '2024-01-01', '2024-12-31')).rejects.toThrow('Failed to fetch current balance data');

      // Clear previous calls
      jest.clearAllMocks();

      // Test with successful first call but null second call
      questradeApi.makeApiCall
        .mockResolvedValueOnce({ totalEquity: { combined: [] } })
        .mockResolvedValueOnce(null);

      await expect(fetchBalanceHistory('account123', '2024-01-01', '2024-12-31')).rejects.toThrow('Failed to fetch historical balance data');
    });

    test('should wrap generic errors in BalanceError', async () => {
      // Test generic error wrapping
      questradeApi.makeApiCall.mockRejectedValue(new Error('Network timeout'));

      try {
        await fetchBalanceHistory('account123', '2024-01-01', '2024-12-31');
      } catch (error) {
        expect(error instanceof BalanceError).toBe(true);
        expect(error.message).toBe('Failed to fetch balance history: Network timeout');
        expect(error.accountId).toBe('account123');
      }
    });

    test('should preserve BalanceError instances', async () => {
      // Test that BalanceError instances are not double-wrapped
      const originalError = new BalanceError('Original error', 'account123');
      questradeApi.makeApiCall.mockRejectedValue(originalError);

      try {
        await fetchBalanceHistory('account123', '2024-01-01', '2024-12-31');
      } catch (error) {
        expect(error).toBe(originalError); // Should be the same instance
        expect(error.message).toBe('Original error');
      }
    });
  });
});
