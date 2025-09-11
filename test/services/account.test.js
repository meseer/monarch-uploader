/**
 * Account Service Tests
 */

import accountService, { 
  AccountError,
  loadCurrentAccountInfo,
  getAccountDetails,
  getAllAccounts,
  processAccountBalanceHistory,
  linkAccounts,
  getLinkedAccount
} from '../../src/services/account';
import questradeApi from '../../src/api/questrade';
import stateManager from '../../src/core/state';
import authService from '../../src/services/auth';
import balanceService from '../../src/services/balance';
import { STORAGE } from '../../src/core/config';

// Mock dependencies
jest.mock('../../src/api/questrade', () => ({
  fetchAccounts: jest.fn(),
  getAccount: jest.fn()
}));

jest.mock('../../src/services/auth', () => ({
  checkQuestradeAuth: jest.fn()
}));

jest.mock('../../src/services/balance', () => ({
  processAndUploadBalance: jest.fn(),
  bulkProcessAccounts: jest.fn(),
  getDefaultDateRange: jest.fn()
}));

jest.mock('../../src/core/state', () => ({
  setAccount: jest.fn(),
  getState: jest.fn().mockReturnValue({
    currentAccount: { name: 'Test Account' }
  })
}));

// Mock GM storage functions
global.GM_getValue = jest.fn();
global.GM_setValue = jest.fn();
global.window = {
  location: {
    pathname: '/accounts/12345'
  }
};

describe('Account Service', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
    
    // Set up console mocks for debugLog
    global.console = { log: jest.fn() };
  });

  describe('loadCurrentAccountInfo', () => {
    test('should extract account ID from URL and load account info', async () => {
      // Mock accounts list
      const mockAccounts = [
        { key: '12345', name: 'Test Account' },
        { key: '67890', name: 'Another Account' }
      ];
      
      // Mock getting accounts from storage
      GM_getValue.mockReturnValueOnce(JSON.stringify(mockAccounts));
      
      const result = await loadCurrentAccountInfo();
      
      expect(result).toEqual({ key: '12345', name: 'Test Account' });
      expect(stateManager.setAccount).toHaveBeenCalledWith('12345', 'Test Account');
      expect(questradeApi.fetchAccounts).not.toHaveBeenCalled(); // Should use cached accounts
    });
    
    test('should fetch accounts when cache is empty', async () => {
      // Mock empty accounts list
      GM_getValue.mockReturnValueOnce('[]');
      
      // Mock fetching accounts from API
      const mockAccounts = [
        { key: '12345', name: 'Test Account' },
        { key: '67890', name: 'Another Account' }
      ];
      questradeApi.fetchAccounts.mockResolvedValueOnce(mockAccounts);
      
      const result = await loadCurrentAccountInfo();
      
      expect(result).toEqual({ key: '12345', name: 'Test Account' });
      expect(questradeApi.fetchAccounts).toHaveBeenCalled();
    });
    
    test('should return null when account not found', async () => {
      // Mock accounts list without matching ID
      const mockAccounts = [
        { key: '67890', name: 'Another Account' }
      ];
      
      // Mock getting accounts from storage
      GM_getValue.mockReturnValueOnce(JSON.stringify(mockAccounts));
      
      const result = await loadCurrentAccountInfo();
      
      expect(result).toBeNull();
    });
    
    test('should handle errors gracefully', async () => {
      // Mock error when fetching accounts
      GM_getValue.mockReturnValueOnce('[]');
      questradeApi.fetchAccounts.mockRejectedValueOnce(new Error('API error'));
      
      const result = await loadCurrentAccountInfo();
      
      expect(result).toBeNull();
    });
  });

  describe('getAccountDetails', () => {
    test('should get account details when auth is valid', async () => {
      // Mock auth status
      authService.checkQuestradeAuth.mockReturnValueOnce({
        authenticated: true
      });
      
      // Mock account detail
      const mockAccount = { key: '12345', name: 'Test Account' };
      questradeApi.getAccount.mockReturnValueOnce(mockAccount);
      
      const result = await getAccountDetails('12345');
      
      expect(result).toEqual(mockAccount);
      expect(authService.checkQuestradeAuth).toHaveBeenCalled();
      expect(questradeApi.getAccount).toHaveBeenCalledWith('12345');
    });
    
    test('should throw AccountError when auth is invalid', async () => {
      // Mock auth status as not authenticated
      authService.checkQuestradeAuth.mockReturnValueOnce({
        authenticated: false
      });
      
      await expect(getAccountDetails('12345'))
        .rejects
        .toThrow(AccountError);
        
      expect(questradeApi.getAccount).not.toHaveBeenCalled();
    });
    
    test('should try to fetch fresh accounts when account not found', async () => {
      // Mock auth status
      authService.checkQuestradeAuth.mockReturnValueOnce({
        authenticated: true
      });
      
      // Mock account not found, then found after refresh
      questradeApi.getAccount.mockReturnValueOnce(null);
      
      const mockAccount = { key: '12345', name: 'Test Account' };
      questradeApi.fetchAccounts.mockResolvedValueOnce([mockAccount]);
      questradeApi.getAccount.mockReturnValueOnce(mockAccount);
      
      const result = await getAccountDetails('12345');
      
      expect(result).toEqual(mockAccount);
      expect(questradeApi.fetchAccounts).toHaveBeenCalled();
      expect(questradeApi.getAccount).toHaveBeenCalledTimes(2);
    });
    
    test('should throw AccountError when account not found even after refresh', async () => {
      // Mock auth status
      authService.checkQuestradeAuth.mockReturnValueOnce({
        authenticated: true
      });
      
      // Mock account not found, and still not found after refresh
      questradeApi.getAccount.mockReturnValue(null);
      questradeApi.fetchAccounts.mockResolvedValueOnce([]);
      
      await expect(getAccountDetails('12345'))
        .rejects
        .toThrow(AccountError);
        
      expect(questradeApi.fetchAccounts).toHaveBeenCalled();
      expect(questradeApi.getAccount).toHaveBeenCalledTimes(2);
    });
  });

  describe('getAllAccounts', () => {
    test('should get accounts from cache when available', async () => {
      // Mock auth status
      authService.checkQuestradeAuth.mockReturnValueOnce({
        authenticated: true
      });
      
      // Mock accounts in cache
      const mockAccounts = [
        { key: '12345', name: 'Test Account' },
        { key: '67890', name: 'Another Account' }
      ];
      GM_getValue.mockReturnValueOnce(JSON.stringify(mockAccounts));
      
      const result = await getAllAccounts();
      
      expect(result).toEqual(mockAccounts);
      expect(questradeApi.fetchAccounts).not.toHaveBeenCalled();
    });
    
    test('should fetch accounts when cache is empty', async () => {
      // Mock auth status
      authService.checkQuestradeAuth.mockReturnValueOnce({
        authenticated: true
      });
      
      // Mock empty cache
      GM_getValue.mockReturnValueOnce('[]');
      
      // Mock API response
      const mockAccounts = [
        { key: '12345', name: 'Test Account' },
        { key: '67890', name: 'Another Account' }
      ];
      questradeApi.fetchAccounts.mockResolvedValueOnce(mockAccounts);
      
      const result = await getAllAccounts();
      
      expect(result).toEqual(mockAccounts);
      expect(questradeApi.fetchAccounts).toHaveBeenCalled();
    });
    
    test('should force refresh when requested', async () => {
      // Mock auth status
      authService.checkQuestradeAuth.mockReturnValueOnce({
        authenticated: true
      });
      
      // Mock API response
      const mockAccounts = [
        { key: '12345', name: 'Test Account' },
        { key: '67890', name: 'Another Account' }
      ];
      questradeApi.fetchAccounts.mockResolvedValueOnce(mockAccounts);
      
      const result = await getAllAccounts(true);
      
      expect(result).toEqual(mockAccounts);
      expect(questradeApi.fetchAccounts).toHaveBeenCalled();
    });
    
    test('should throw AccountError when auth is invalid', async () => {
      // Mock auth status as not authenticated
      authService.checkQuestradeAuth.mockReturnValueOnce({
        authenticated: false
      });
      
      await expect(getAllAccounts())
        .rejects
        .toThrow(AccountError);
        
      expect(questradeApi.fetchAccounts).not.toHaveBeenCalled();
    });
  });

  describe('processAccountBalanceHistory', () => {
    test('should delegate to balance service', async () => {
      // Mock balance service method
      balanceService.processAndUploadBalance.mockResolvedValueOnce(true);
      
      const result = await processAccountBalanceHistory(
        '12345', 
        'Test Account', 
        '2025-01-01', 
        '2025-01-31'
      );
      
      expect(result).toBe(true);
      expect(balanceService.processAndUploadBalance).toHaveBeenCalledWith(
        '12345', 
        'Test Account', 
        '2025-01-01', 
        '2025-01-31'
      );
    });
  });

  describe('Account Mapping', () => {
    test('linkAccounts should save mapping between accounts', () => {
      const questradeAccountId = '12345';
      const questradeAccountName = 'Test Questrade Account';
      const monarchAccount = { id: 'monarch-123', displayName: 'Test Monarch Account' };
      
      const result = linkAccounts(questradeAccountId, questradeAccountName, monarchAccount);
      
      expect(result).toBe(true);
      expect(GM_setValue).toHaveBeenCalledWith(
        `${STORAGE.ACCOUNT_MAPPING_PREFIX}${questradeAccountId}`,
        JSON.stringify(monarchAccount)
      );
      expect(stateManager.setAccount).toHaveBeenCalledWith(questradeAccountId, questradeAccountName);
    });
    
    test('linkAccounts should handle invalid inputs', () => {
      const result = linkAccounts('12345', 'Test Account', null);
      
      expect(result).toBe(false);
      expect(GM_setValue).not.toHaveBeenCalled();
    });
    
    test('getLinkedAccount should return mapped account', () => {
      const questradeAccountId = '12345';
      const monarchAccount = { id: 'monarch-123', displayName: 'Test Monarch Account' };
      
      // Mock getting mapping from storage
      GM_getValue.mockReturnValueOnce(JSON.stringify(monarchAccount));
      
      const result = getLinkedAccount(questradeAccountId);
      
      expect(result).toEqual(monarchAccount);
      expect(GM_getValue).toHaveBeenCalledWith(
        `${STORAGE.ACCOUNT_MAPPING_PREFIX}${questradeAccountId}`,
        null
      );
    });
    
    test('getLinkedAccount should return null when no mapping exists', () => {
      const questradeAccountId = '12345';
      
      // Mock no mapping in storage
      GM_getValue.mockReturnValueOnce(null);
      
      const result = getLinkedAccount(questradeAccountId);
      
      expect(result).toBeNull();
    });
    
    test('getLinkedAccount should handle errors gracefully', () => {
      const questradeAccountId = '12345';
      
      // Mock error when parsing mapping
      GM_getValue.mockReturnValueOnce('invalid json');
      
      const result = getLinkedAccount(questradeAccountId);
      
      expect(result).toBeNull();
    });
  });

  describe('Date Range Methods', () => {
    test('getDateRange should delegate to balance service', () => {
      // Mock expected return value
      const expectedDateRange = {
        fromDate: '2025-01-01',
        toDate: '2025-01-31'
      };
      
      balanceService.getDefaultDateRange.mockReturnValueOnce(expectedDateRange);
      
      const result = accountService.getDateRange('12345', 90);
      
      expect(result).toEqual(expectedDateRange);
      expect(balanceService.getDefaultDateRange).toHaveBeenCalledWith('12345', 90);
    });
  });
});
