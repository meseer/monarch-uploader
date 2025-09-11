/**
 * Balance Service Tests
 */

import balanceService, { 
  BalanceError,
  fetchBalanceHistory,
  processBalanceData,
  getDefaultDateRange,
  storeDateRange,
  uploadBalanceToMonarch,
  processAndUploadBalance
} from '../../src/services/balance';
import questradeApi from '../../src/api/questrade';
import monarchApi from '../../src/api/monarch';
import stateManager from '../../src/core/state';
import { STORAGE } from '../../src/core/config';
import toast from '../../src/ui/toast';

// Mock dependencies
jest.mock('../../src/api/questrade', () => ({
  makeApiCall: jest.fn()
}));

jest.mock('../../src/api/monarch', () => ({
  uploadBalance: jest.fn()
}));

jest.mock('../../src/core/state', () => ({
  setAccount: jest.fn(),
  getState: jest.fn().mockReturnValue({
    currentAccount: { name: 'Test Account' }
  })
}));

jest.mock('../../src/ui/toast', () => ({
  show: jest.fn()
}));

// Mock GM storage functions
global.GM_getValue = jest.fn();
global.GM_setValue = jest.fn();

describe('Balance Service', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
    
    // Set up console mocks for debugLog
    global.console = { log: jest.fn() };
  });

  describe('fetchBalanceHistory', () => {
    test('should fetch and return balance history data', async () => {
      // Mock API responses
      const mockBalanceData = {
        totalEquity: {
          combined: [{ currencyCode: 'CAD', amount: 10000 }]
        }
      };
      
      const mockHistoryData = {
        data: [
          { date: '2025-01-01', totalEquity: 9800 },
          { date: '2025-01-02', totalEquity: 9900 }
        ]
      };
      
      // Setup mocks
      questradeApi.makeApiCall
        .mockResolvedValueOnce(mockBalanceData)
        .mockResolvedValueOnce(mockHistoryData);
      
      const result = await fetchBalanceHistory('12345', '2025-01-01', '2025-01-31');
      
      expect(questradeApi.makeApiCall).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        currentBalance: mockBalanceData,
        history: mockHistoryData
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
            combined: [{ currencyCode: 'CAD', amount: 10000 }]
          }
        },
        history: {
          data: [
            { date: '2025-01-01', totalEquity: 9800 },
            { date: '2025-01-02', totalEquity: 9900 }
          ]
        }
      };
      
      const result = processBalanceData(rawData, 'Test Account');
      
      // Check that CSV contains header and data rows
      expect(result).toContain('"Date","Total Equity","Account Name"');
      expect(result).toContain('"2025-01-01","9800","Test Account"');
      expect(result).toContain('"2025-01-02","9900","Test Account"');
      
      // Check that current balance is included with today's date
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      expect(result).toContain(`"${today}","10000","Test Account"`);
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
      
      // Check that fromDate is approximately 30 days ago
      const fromDate = new Date(result.fromDate);
      const today = new Date();
      const daysDiff = Math.round((today - fromDate) / (1000 * 60 * 60 * 24));
      
      expect(daysDiff).toBeCloseTo(30, 1); // Within 1 day of expected
    });
    
    test('getDefaultDateRange should use saved date when available', () => {
      // Mock saved date (30 days ago)
      const savedDate = new Date();
      savedDate.setDate(savedDate.getDate() - 30);
      GM_getValue.mockReturnValueOnce(savedDate.toISOString().split('T')[0]);
      
      const result = getDefaultDateRange('12345');
      
      // Check that fromDate matches saved date
      expect(result.fromDate).toBe(savedDate.toISOString().split('T')[0]);
    });
    
    test('storeDateRange should save date for account', () => {
      storeDateRange('12345', '2025-01-31');
      
      expect(GM_setValue).toHaveBeenCalledWith(`${STORAGE.LAST_DATE_PREFIX}12345`, '2025-01-31');
    });
  });

  describe('uploadBalanceToMonarch', () => {
    test('should upload CSV data to Monarch', async () => {
      // Mock successful upload
      monarchApi.uploadBalance.mockResolvedValueOnce(true);
      
      // Mock account mapping
      GM_getValue.mockReturnValueOnce(JSON.stringify({ id: 'monarch-123' }));
      
      const result = await uploadBalanceToMonarch(
        '12345', 
        '"Date","Amount"\n"2025-01-01","1000"', 
        '2025-01-01', 
        '2025-01-31'
      );
      
      expect(result).toBe(true);
      expect(monarchApi.uploadBalance).toHaveBeenCalled();
    });
    
    test('should throw BalanceError when no CSV data', async () => {
      await expect(uploadBalanceToMonarch('12345', '', '2025-01-01', '2025-01-31'))
        .rejects
        .toThrow(BalanceError);
        
      expect(monarchApi.uploadBalance).not.toHaveBeenCalled();
    });
    
    test('should throw BalanceError when no account mapping found', async () => {
      // Mock no account mapping
      GM_getValue.mockReturnValueOnce(null);
      
      await expect(uploadBalanceToMonarch(
        '12345', 
        '"Date","Amount"\n"2025-01-01","1000"', 
        '2025-01-01', 
        '2025-01-31'
      ))
        .rejects
        .toThrow(BalanceError);
        
      expect(monarchApi.uploadBalance).not.toHaveBeenCalled();
    });
  });

  describe('processAndUploadBalance', () => {
    test('should complete the full balance processing workflow', async () => {
      // Mock successful API calls
      const mockBalanceData = {
        currentBalance: {
          totalEquity: {
            combined: [{ currencyCode: 'CAD', amount: 10000 }]
          }
        },
        history: {
          data: [
            { date: '2025-01-01', totalEquity: 9800 },
            { date: '2025-01-02', totalEquity: 9900 }
          ]
        }
      };
      
      // Setup spies and mocks
      const fetchBalanceSpy = jest.spyOn(balanceService, 'fetchBalanceHistory')
        .mockResolvedValueOnce(mockBalanceData);
      
      const processSpy = jest.spyOn(balanceService, 'processBalanceData')
        .mockReturnValueOnce('"Date","Total Equity","Account Name"\n"2025-01-01","9800","Test Account"');
      
      const uploadSpy = jest.spyOn(balanceService, 'uploadBalanceToMonarch')
        .mockResolvedValueOnce(true);
      
      const result = await processAndUploadBalance(
        '12345',
        'Test Account',
        '2025-01-01',
        '2025-01-31'
      );
      
      // Check result and toast notifications
      expect(result).toBe(true);
      expect(stateManager.setAccount).toHaveBeenCalledWith('12345', 'Test Account');
      expect(fetchBalanceSpy).toHaveBeenCalledWith('12345', '2025-01-01', '2025-01-31');
      expect(processSpy).toHaveBeenCalledWith(mockBalanceData, 'Test Account');
      expect(uploadSpy).toHaveBeenCalled();
      expect(toast.show).toHaveBeenCalledTimes(3); // Three notifications during the process
    });
    
    test('should handle errors and show error toast', async () => {
      // Mock error in fetch
      jest.spyOn(balanceService, 'fetchBalanceHistory')
        .mockRejectedValueOnce(new BalanceError('API failure', '12345'));
      
      const result = await processAndUploadBalance(
        '12345',
        'Test Account',
        '2025-01-01',
        '2025-01-31'
      );
      
      // Check result and error toast
      expect(result).toBe(false);
      expect(toast.show).toHaveBeenCalledWith('API failure', 'error');
    });
  });

  describe('bulkProcessAccounts', () => {
    test('should process multiple accounts sequentially', async () => {
      // Mock accounts
      const accounts = [
        { id: '12345', name: 'Account 1' },
        { id: '67890', name: 'Account 2' }
      ];
      
      // Mock successful processing for both accounts
      const processSpy = jest.spyOn(balanceService, 'processAndUploadBalance')
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true);
      
      const result = await balanceService.bulkProcessAccounts(
        accounts,
        '2025-01-01',
        '2025-01-31'
      );
      
      // Check results
      expect(result.success).toBe(2);
      expect(result.failed).toBe(0);
      expect(processSpy).toHaveBeenCalledTimes(2);
      expect(toast.show).toHaveBeenCalledWith('Completed: 2 successful, 0 failed', 'success');
    });
    
    test('should handle mixed success and failure', async () => {
      // Mock accounts
      const accounts = [
        { id: '12345', name: 'Account 1' },
        { id: '67890', name: 'Account 2' }
      ];
      
      // Mock one success, one failure
      const processSpy = jest.spyOn(balanceService, 'processAndUploadBalance')
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      
      const result = await balanceService.bulkProcessAccounts(
        accounts,
        '2025-01-01',
        '2025-01-31'
      );
      
      // Check results
      expect(result.success).toBe(1);
      expect(result.failed).toBe(1);
      expect(processSpy).toHaveBeenCalledTimes(2);
      expect(toast.show).toHaveBeenCalledWith('Completed: 1 successful, 1 failed', 'warning');
    });
    
    test('should handle empty accounts list', async () => {
      const result = await balanceService.bulkProcessAccounts(
        [],
        '2025-01-01',
        '2025-01-31'
      );
      
      // Check results
      expect(result.success).toBe(0);
      expect(result.failed).toBe(0);
      expect(toast.show).toHaveBeenCalledWith('No accounts to process', 'warning');
    });
  });
});
