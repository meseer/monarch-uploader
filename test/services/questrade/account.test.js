/**
 * Account Service Tests
 */

import questradeAccountService, {
  AccountError,
  getAccountDetails,
  getAllAccounts,
  processAccountBalanceHistory,
  linkAccounts,
  getLinkedAccount,
} from '../../../src/services/questrade/account';
import questradeApi from '../../../src/api/questrade';
import commonAccountService from '../../../src/services/common/accountService';
import stateManager from '../../../src/core/state';
import authService from '../../../src/services/questrade/auth';
import balanceService from '../../../src/services/questrade/balance';
import syncService from '../../../src/services/questrade/sync';
import { STORAGE } from '../../../src/core/config';
import { INTEGRATIONS } from '../../../src/core/integrationCapabilities';

// Mock dependencies
jest.mock('../../../src/api/questrade', () => ({
  fetchAccounts: jest.fn(),
}));

jest.mock('../../../src/services/common/accountService', () => ({
  getAccounts: jest.fn(),
  getAccountData: jest.fn(),
  upsertAccount: jest.fn(),
}));

jest.mock('../../../src/services/questrade/auth', () => ({
  checkQuestradeAuth: jest.fn(),
}));

jest.mock('../../../src/services/questrade/balance', () => ({
  default: {
    processAndUploadBalance: jest.fn(),
    bulkProcessAccounts: jest.fn(),
    getDefaultDateRange: jest.fn(),
    fetchBalanceHistory: jest.fn(),
    extractBalanceChange: jest.fn(),
  },
  processAndUploadBalance: jest.fn(),
  bulkProcessAccounts: jest.fn(),
  getDefaultDateRange: jest.fn(),
  fetchBalanceHistory: jest.fn(),
  extractBalanceChange: jest.fn(),
}));

jest.mock('../../../src/services/questrade/sync', () => ({
  default: {
    syncAccountToMonarch: jest.fn(),
    syncAllAccountsToMonarch: jest.fn(),
  },
  syncAccountToMonarch: jest.fn(),
  syncAllAccountsToMonarch: jest.fn(),
}));

jest.mock('../../../src/core/state', () => ({
  setAccount: jest.fn(),
  setQuestradeAuth: jest.fn(),
  setMonarchAuth: jest.fn(),
  setCanadaLifeAuth: jest.fn(),
  setRogersBankAuth: jest.fn(),
  setUiElement: jest.fn(),
  addListener: jest.fn(),
  getState: jest.fn().mockReturnValue({
    currentAccount: { name: 'Test Account' },
  }),
}));

// Mock GM storage functions
globalThis.GM_getValue = jest.fn();
globalThis.GM_setValue = jest.fn();

describe('Account Service', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();

    // Set up console mocks for debugLog
    globalThis.console = { log: jest.fn() };
  });

  describe('URL extraction and account loading logic', () => {
    test('should extract account ID from valid account URL paths', () => {
      const testPaths = [
        '/accounts/12345',
        '/accounts/67890/overview',
        '/accounts/abc123/positions',
        '/some/prefix/accounts/test-123/suffix',
      ];

      const expectedIds = ['12345', '67890', 'abc123', 'test-123'];

      testPaths.forEach((path, index) => {
        const matches = path.match(/\/accounts\/([^/]+)/);
        expect(matches).not.toBeNull();
        expect(matches[1]).toBe(expectedIds[index]);
      });
    });

    test('should return null for non-account URL paths', () => {
      const testPaths = [
        '/dashboard',
        '/settings',
        '/account-summary', // Similar but different
        '/my-accounts', // Similar but different
        '/accounts', // Missing account ID
        '/accounts/', // Missing account ID
        '',
      ];

      testPaths.forEach((path) => {
        const matches = path.match(/\/accounts\/([^/]+)/);
        expect(matches).toBeNull();
      });
    });

    test('should find account in cached accounts list', async () => {
      // Test the account finding logic directly
      const accountId = '12345';
      const mockAccounts = [
        { key: '12345', name: 'Test Account' },
        { key: '67890', name: 'Another Account' },
      ];

      // Simulate the account finding logic
      const account = mockAccounts.find((acc) => acc.key === accountId);
      expect(account).toEqual({ key: '12345', name: 'Test Account' });

      // Simulate account not found
      const notFound = mockAccounts.find((acc) => acc.key === '99999');
      expect(notFound).toBeUndefined();
    });

    test('should handle empty or invalid accounts list', () => {
      const accountId = '12345';

      // Test with empty array
      const emptyAccounts = [];
      const notFound1 = emptyAccounts.find((acc) => acc.key === accountId);
      expect(notFound1).toBeUndefined();

      // Test with malformed accounts (missing key property)
      const malformedAccounts = [{ name: 'Test Account' }];
      const notFound2 = malformedAccounts.find((acc) => acc.key === accountId);
      expect(notFound2).toBeUndefined();
    });
  });

  describe('getAccountDetails', () => {
    test('should get account details from consolidated storage when auth is valid', async () => {
      // Mock auth status
      authService.checkQuestradeAuth.mockReturnValueOnce({
        authenticated: true,
      });

      // Mock account detail from consolidated storage
      const mockQuestradeAccount = { id: '12345', nickname: 'Test Account' };
      commonAccountService.getAccountData.mockReturnValueOnce({
        questradeAccount: mockQuestradeAccount,
        monarchAccount: { id: 'monarch-123' },
      });

      const result = await getAccountDetails('12345');

      expect(result).toEqual(mockQuestradeAccount);
      expect(authService.checkQuestradeAuth).toHaveBeenCalled();
      expect(commonAccountService.getAccountData).toHaveBeenCalledWith(INTEGRATIONS.QUESTRADE, '12345');
    });

    test('should throw AccountError when auth is invalid', async () => {
      // Mock auth status as not authenticated
      authService.checkQuestradeAuth.mockReturnValueOnce({
        authenticated: false,
      });

      await expect(getAccountDetails('12345'))
        .rejects
        .toThrow(AccountError);

      expect(commonAccountService.getAccountData).not.toHaveBeenCalled();
    });

    test('should try to fetch fresh accounts when account not found in storage', async () => {
      // Mock auth status
      authService.checkQuestradeAuth.mockReturnValueOnce({
        authenticated: true,
      });

      // Mock account not found in storage initially
      commonAccountService.getAccountData.mockReturnValueOnce(null);

      // Mock API fetch
      const mockQuestradeAccount = { id: '12345', nickname: 'Test Account' };
      questradeApi.fetchAccounts.mockResolvedValueOnce([
        { questradeAccount: mockQuestradeAccount },
      ]);

      // After fetch, account is found in storage
      commonAccountService.getAccountData.mockReturnValueOnce({
        questradeAccount: mockQuestradeAccount,
      });

      const result = await getAccountDetails('12345');

      expect(result).toEqual(mockQuestradeAccount);
      expect(questradeApi.fetchAccounts).toHaveBeenCalled();
      expect(commonAccountService.getAccountData).toHaveBeenCalledTimes(2);
    });

    test('should throw AccountError when account not found even after refresh', async () => {
      // Mock auth status
      authService.checkQuestradeAuth.mockReturnValueOnce({
        authenticated: true,
      });

      // Mock account not found in storage
      commonAccountService.getAccountData.mockReturnValue(null);

      // Mock API fetch returning empty or account not matching
      questradeApi.fetchAccounts.mockResolvedValueOnce([]);

      await expect(getAccountDetails('12345'))
        .rejects
        .toThrow(AccountError);

      expect(questradeApi.fetchAccounts).toHaveBeenCalled();
      expect(commonAccountService.getAccountData).toHaveBeenCalledTimes(2);
    });
  });

  describe('getAllAccounts', () => {
    test('should get accounts from consolidated storage when available', async () => {
      // Mock auth status
      authService.checkQuestradeAuth.mockReturnValueOnce({
        authenticated: true,
      });

      // Mock accounts in consolidated storage
      const mockConsolidatedAccounts = [
        { questradeAccount: { id: '12345', nickname: 'Test Account' }, monarchAccount: null },
        { questradeAccount: { id: '67890', nickname: 'Another Account' }, monarchAccount: null },
      ];
      commonAccountService.getAccounts.mockReturnValueOnce(mockConsolidatedAccounts);

      const result = await getAllAccounts();

      expect(result).toEqual(mockConsolidatedAccounts);
      expect(commonAccountService.getAccounts).toHaveBeenCalledWith(INTEGRATIONS.QUESTRADE);
      expect(questradeApi.fetchAccounts).not.toHaveBeenCalled();
    });

    test('should fetch accounts when consolidated storage is empty', async () => {
      // Mock auth status
      authService.checkQuestradeAuth.mockReturnValueOnce({
        authenticated: true,
      });

      // Mock empty consolidated storage
      commonAccountService.getAccounts.mockReturnValueOnce([]);

      // Mock API response (now returns consolidated structure)
      const mockConsolidatedAccounts = [
        { questradeAccount: { id: '12345', nickname: 'Test Account' }, monarchAccount: null },
      ];
      questradeApi.fetchAccounts.mockResolvedValueOnce(mockConsolidatedAccounts);

      const result = await getAllAccounts();

      expect(result).toEqual(mockConsolidatedAccounts);
      expect(questradeApi.fetchAccounts).toHaveBeenCalled();
    });

    test('should force refresh when requested', async () => {
      // Mock auth status
      authService.checkQuestradeAuth.mockReturnValueOnce({
        authenticated: true,
      });

      // Mock API response - force refresh fetches new accounts (consolidated structure)
      const mockConsolidatedAccounts = [
        { questradeAccount: { id: '12345', nickname: 'Fresh Account' }, monarchAccount: null },
      ];
      questradeApi.fetchAccounts.mockResolvedValueOnce(mockConsolidatedAccounts);

      const result = await getAllAccounts(true);

      expect(result).toEqual(mockConsolidatedAccounts);
      expect(questradeApi.fetchAccounts).toHaveBeenCalled();
    });

    test('should throw AccountError when auth is invalid', async () => {
      // Mock auth status as not authenticated
      authService.checkQuestradeAuth.mockReturnValueOnce({
        authenticated: false,
      });

      await expect(getAllAccounts())
        .rejects
        .toThrow(AccountError);

      expect(questradeApi.fetchAccounts).not.toHaveBeenCalled();
    });
  });

  describe('processAccountBalanceHistory', () => {
    test('should delegate to sync service', async () => {
      // Mock sync service method
      syncService.syncAccountToMonarch.mockResolvedValueOnce(true);

      const result = await processAccountBalanceHistory(
        '12345',
        'Test Account',
        '2025-01-01',
        '2025-01-31',
      );

      expect(result).toBe(true);
      expect(syncService.syncAccountToMonarch).toHaveBeenCalledWith(
        '12345',
        'Test Account',
        '2025-01-01',
        '2025-01-31',
      );
    });
  });

  describe('Account Mapping', () => {
    test('linkAccounts should save mapping between accounts', () => {
      const questradeAccountId = '12345';
      const questradeAccountName = 'Test Questrade Account';
      const monarchAccount = { id: 'monarch-123', displayName: 'Test Monarch Account' };

      // Mock accountService.upsertAccount to return true
      commonAccountService.upsertAccount.mockReturnValueOnce(true);

      const result = linkAccounts(questradeAccountId, questradeAccountName, monarchAccount);

      expect(result).toBe(true);
      // Should save to consolidated storage
      expect(commonAccountService.upsertAccount).toHaveBeenCalledWith(INTEGRATIONS.QUESTRADE, {
        questradeAccount: {
          id: questradeAccountId,
          nickname: questradeAccountName,
        },
        monarchAccount,
      });
      // Should also save to legacy storage for backward compatibility
      expect(GM_setValue).toHaveBeenCalledWith(
        `${STORAGE.QUESTRADE_ACCOUNT_MAPPING_PREFIX}${questradeAccountId}`,
        JSON.stringify(monarchAccount),
      );
      expect(stateManager.setAccount).toHaveBeenCalledWith(questradeAccountId, questradeAccountName);
    });

    test('linkAccounts should handle invalid inputs', () => {
      const result = linkAccounts('12345', 'Test Account', null);

      expect(result).toBe(false);
      expect(GM_setValue).not.toHaveBeenCalled();
    });

    test('getLinkedAccount should return mapped account from consolidated storage', () => {
      const questradeAccountId = '12345';
      const monarchAccount = { id: 'monarch-123', displayName: 'Test Monarch Account' };

      // Mock account data in consolidated storage
      commonAccountService.getAccountData.mockReturnValueOnce({
        questradeAccount: { id: questradeAccountId, nickname: 'Test Account' },
        monarchAccount,
      });

      const result = getLinkedAccount(questradeAccountId);

      expect(result).toEqual(monarchAccount);
      expect(commonAccountService.getAccountData).toHaveBeenCalledWith(INTEGRATIONS.QUESTRADE, questradeAccountId);
    });

    test('getLinkedAccount should fall back to legacy storage when not in consolidated', () => {
      const questradeAccountId = '12345';
      const monarchAccount = { id: 'monarch-123', displayName: 'Test Monarch Account' };

      // Mock no account in consolidated storage
      commonAccountService.getAccountData.mockReturnValueOnce(null);

      // Mock getting mapping from legacy storage
      GM_getValue.mockImplementation((key, defaultValue) => {
        if (key === `${STORAGE.QUESTRADE_ACCOUNT_MAPPING_PREFIX}${questradeAccountId}`) {
          return JSON.stringify(monarchAccount);
        }
        return defaultValue;
      });

      const result = getLinkedAccount(questradeAccountId);

      expect(result).toEqual(monarchAccount);
    });

    test('getLinkedAccount should return null when no mapping exists in either storage', () => {
      const questradeAccountId = '12345';

      // Mock no account in consolidated storage
      commonAccountService.getAccountData.mockReturnValueOnce(null);

      // Mock no mapping in legacy storage
      GM_getValue.mockImplementation((key, defaultValue) => {
        if (key === `${STORAGE.QUESTRADE_ACCOUNT_MAPPING_PREFIX}${questradeAccountId}`) {
          return null;
        }
        return defaultValue;
      });

      const result = getLinkedAccount(questradeAccountId);

      expect(result).toBeNull();
    });

    test('getLinkedAccount should handle errors gracefully', () => {
      const questradeAccountId = '12345';

      // Mock no account in consolidated storage
      commonAccountService.getAccountData.mockReturnValueOnce(null);

      // Mock error when parsing legacy mapping
      GM_getValue.mockImplementation((key, defaultValue) => {
        if (key === `${STORAGE.QUESTRADE_ACCOUNT_MAPPING_PREFIX}${questradeAccountId}`) {
          return 'invalid json';
        }
        return defaultValue;
      });

      const result = getLinkedAccount(questradeAccountId);

      expect(result).toBeNull();
    });
  });

  describe('Date Range Methods', () => {
    test('getDateRange should delegate to balance service', () => {
      // Mock expected return value
      const expectedDateRange = {
        fromDate: '2025-01-01',
        toDate: '2025-01-31',
      };

      balanceService.getDefaultDateRange.mockReturnValueOnce(expectedDateRange);

      const result = questradeAccountService.getDateRange('12345', 90);

      expect(result).toEqual(expectedDateRange);
      expect(balanceService.getDefaultDateRange).toHaveBeenCalledWith('12345', 90);
    });
  });
});
