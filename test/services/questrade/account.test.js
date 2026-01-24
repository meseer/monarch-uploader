/**
 * Account Service Tests
 */

import accountService, {
  AccountError,
  getAccountDetails,
  getAllAccounts,
  processAccountBalanceHistory,
  linkAccounts,
  getLinkedAccount,
} from '../../../src/services/questrade/account';
import questradeApi from '../../../src/api/questrade';
import stateManager from '../../../src/core/state';
import authService from '../../../src/services/questrade/auth';
import balanceService from '../../../src/services/questrade/balance';
import syncService from '../../../src/services/questrade/sync';
import { STORAGE } from '../../../src/core/config';

// Mock dependencies
jest.mock('../../../src/api/questrade', () => ({
  fetchAccounts: jest.fn(),
  getAccount: jest.fn(),
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
    test('should get account details when auth is valid', async () => {
      // Mock auth status
      authService.checkQuestradeAuth.mockReturnValueOnce({
        authenticated: true,
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
        authenticated: false,
      });

      await expect(getAccountDetails('12345'))
        .rejects
        .toThrow(AccountError);

      expect(questradeApi.getAccount).not.toHaveBeenCalled();
    });

    test('should try to fetch fresh accounts when account not found', async () => {
      // Mock auth status
      authService.checkQuestradeAuth.mockReturnValueOnce({
        authenticated: true,
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
        authenticated: true,
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
        authenticated: true,
      });

      // Mock accounts in cache
      const mockAccounts = [
        { key: '12345', name: 'Test Account' },
        { key: '67890', name: 'Another Account' },
      ];
      GM_getValue.mockReturnValueOnce(JSON.stringify(mockAccounts));

      const result = await getAllAccounts();

      expect(result).toEqual(mockAccounts);
      expect(questradeApi.fetchAccounts).not.toHaveBeenCalled();
    });

    test('should fetch accounts when cache is empty', async () => {
      // Mock auth status
      authService.checkQuestradeAuth.mockReturnValueOnce({
        authenticated: true,
      });

      // Mock empty cache - GM_getValue should return a string
      GM_getValue.mockReturnValueOnce('[]');

      // Mock API response
      const mockAccounts = [
        { key: '12345', name: 'Test Account' },
      ];
      questradeApi.fetchAccounts.mockResolvedValueOnce(mockAccounts);

      const result = await getAllAccounts();

      expect(result).toEqual(mockAccounts);
      expect(questradeApi.fetchAccounts).toHaveBeenCalled();
    });

    test('should force refresh when requested', async () => {
      // Mock auth status
      authService.checkQuestradeAuth.mockReturnValueOnce({
        authenticated: true,
      });

      // Mock API response - force refresh fetches new accounts
      const mockAccounts = [
        { key: '12345', name: 'Fresh Account' },
      ];
      questradeApi.fetchAccounts.mockResolvedValueOnce(mockAccounts);

      const result = await getAllAccounts(true);

      expect(result).toEqual(mockAccounts);
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

      const result = linkAccounts(questradeAccountId, questradeAccountName, monarchAccount);

      expect(result).toBe(true);
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

    test('getLinkedAccount should return mapped account', () => {
      const questradeAccountId = '12345';
      const monarchAccount = { id: 'monarch-123', displayName: 'Test Monarch Account' };

      // Mock getting mapping from storage - need to mock the specific key call
      GM_getValue.mockImplementation((key, defaultValue) => {
        if (key === `${STORAGE.QUESTRADE_ACCOUNT_MAPPING_PREFIX}${questradeAccountId}`) {
          return JSON.stringify(monarchAccount);
        }
        return defaultValue;
      });

      const result = getLinkedAccount(questradeAccountId);

      expect(result).toEqual(monarchAccount);
    });

    test('getLinkedAccount should return null when no mapping exists', () => {
      const questradeAccountId = '12345';

      // Mock no mapping in storage
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

      // Mock error when parsing mapping
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

      const result = accountService.getDateRange('12345', 90);

      expect(result).toEqual(expectedDateRange);
      expect(balanceService.getDefaultDateRange).toHaveBeenCalledWith('12345', 90);
    });
  });
});
