/**
 * Comprehensive Tests for Questrade API
 */

import {
  makeQuestradeApiCall,
  fetchAndCacheQuestradeAccounts,
  getQuestradeAccount,
  fetchAccountPositions,
  fetchAccountOrders,
  fetchAccountTransactionsPage,
  fetchTransactionDetails,
  fetchAccountTransactionsSinceDate,
  fetchAllAccountTransactions,
  checkTokenStatus,
  getToken,
} from '../../src/api/questrade';

// Mock dependencies
jest.mock('../../src/core/utils', () => ({
  debugLog: jest.fn(),
}));

jest.mock('../../src/core/state', () => ({
  __esModule: true,
  default: {
    setQuestradeAuth: jest.fn(),
  },
}));

jest.mock('../../src/services/questrade/auth', () => ({
  __esModule: true,
  default: {
    checkQuestradeAuth: jest.fn(),
    getQuestradeToken: jest.fn(),
    saveQuestradeToken: jest.fn(),
  },
}));

// Mock Greasemonkey functions
globalThis.GM_getValue = jest.fn();
globalThis.GM_setValue = jest.fn();
globalThis.GM_xmlhttpRequest = jest.fn();

describe('Questrade API', () => {
  let authService;
  let stateManager;

  beforeEach(() => {
    jest.clearAllMocks();
    authService = jest.requireMock('../../src/services/questrade/auth').default;
    stateManager = jest.requireMock('../../src/core/state').default;

    // Default mock values
    globalThis.GM_getValue.mockReturnValue('[]');
    authService.checkQuestradeAuth.mockReturnValue({
      authenticated: true,
      token: 'Bearer test-token',
    });
  });

  describe('makeQuestradeApiCall', () => {
    test('should make successful API call', async () => {
      const mockResponse = { accounts: [{ id: '123', type: 'Margin' }] };

      globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
        expect(options.method).toBe('GET');
        expect(options.url).toBe('https://api.questrade.com/v1/accounts');
        expect(options.headers.Authorization).toBe('Bearer test-token');

        setTimeout(() => {
          options.onload({
            status: 200,
            responseText: JSON.stringify(mockResponse),
          });
        }, 0);
      });

      const result = await makeQuestradeApiCall('/v1/accounts');
      expect(result).toEqual(mockResponse);
    });

    test('should throw error when not authenticated', async () => {
      authService.checkQuestradeAuth.mockReturnValue({
        authenticated: false,
        token: null,
      });

      await expect(makeQuestradeApiCall('/v1/accounts')).rejects.toThrow(
        'Questrade auth token not found. Please ensure you are logged in to Questrade.',
      );
    });

    test('should handle 401 unauthorized and clear auth', async () => {
      globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
        setTimeout(() => {
          options.onload({
            status: 401,
            responseText: '{"error": "Unauthorized"}',
          });
        }, 0);
      });

      await expect(makeQuestradeApiCall('/v1/accounts')).rejects.toThrow(
        'Questrade Auth Error (401): Token was invalid or expired. Please refresh the page.',
      );

      expect(authService.saveQuestradeToken).toHaveBeenCalledWith(null);
      expect(stateManager.setQuestradeAuth).toHaveBeenCalledWith(null);
    });

    test('should handle other HTTP errors', async () => {
      globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
        setTimeout(() => {
          options.onload({
            status: 500,
            responseText: 'Internal Server Error',
          });
        }, 0);
      });

      await expect(makeQuestradeApiCall('/v1/accounts')).rejects.toThrow(
        'Questrade API Error: Received status 500 from /v1/accounts',
      );
    });

    test('should handle network errors', async () => {
      globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
        setTimeout(() => {
          options.onerror({ error: 'Network error' });
        }, 0);
      });

      await expect(makeQuestradeApiCall('/v1/accounts')).rejects.toThrow(
        'A network error occurred while contacting the Questrade API.',
      );
    });

    test('should handle successful response with various status codes', async () => {
      const testCases = [200, 201, 202, 204, 299];

      for (const status of testCases) {
        const mockResponse = { status: 'success', code: status };

        globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
          setTimeout(() => {
            options.onload({
              status,
              responseText: JSON.stringify(mockResponse),
            });
          }, 0);
        });

        const result = await makeQuestradeApiCall('/v1/test');
        expect(result).toEqual(mockResponse);
      }
    });
  });

  describe('fetchAndCacheQuestradeAccounts', () => {
    test('should fetch and cache accounts with consolidated structure from API response array', async () => {
      const mockApiAccounts = [
        { key: 'acc1', type: 'Margin', nickname: 'Margin Account' },
        { key: 'acc2', type: 'TFSA', nickname: 'TFSA Account' },
      ];

      globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
        expect(options.url).toBe('https://api.questrade.com/v2/brokerage-accounts');
        setTimeout(() => {
          options.onload({
            status: 200,
            responseText: JSON.stringify(mockApiAccounts),
          });
        }, 0);
      });

      const result = await fetchAndCacheQuestradeAccounts();

      // Should return consolidated structure
      expect(result).toHaveLength(2);
      expect(result[0].questradeAccount.id).toBe('acc1');
      expect(result[0].questradeAccount.key).toBe('acc1');
      expect(result[0].questradeAccount.type).toBe('Margin');
      expect(result[0].syncEnabled).toBe(true);
      expect(result[0].monarchAccount).toBeNull();

      // Should save to consolidated storage (questrade_accounts_list)
      expect(globalThis.GM_setValue).toHaveBeenCalledWith(
        'questrade_accounts_list',
        expect.any(String),
      );
    });

    test('should handle API response with accounts property', async () => {
      const mockApiAccounts = [
        { key: 'acc1', type: 'Margin' },
        { key: 'acc2', type: 'TFSA' },
      ];
      const mockResponse = { accounts: mockApiAccounts };

      globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
        expect(options.url).toBe('https://api.questrade.com/v2/brokerage-accounts');
        setTimeout(() => {
          options.onload({
            status: 200,
            responseText: JSON.stringify(mockResponse),
          });
        }, 0);
      });

      const result = await fetchAndCacheQuestradeAccounts();

      // Should return consolidated structure
      expect(result).toHaveLength(2);
      expect(result[0].questradeAccount.id).toBe('acc1');
      expect(result[1].questradeAccount.id).toBe('acc2');

      // Should save to consolidated storage
      expect(globalThis.GM_setValue).toHaveBeenCalledWith(
        'questrade_accounts_list',
        expect.any(String),
      );
    });

    test('should handle API response with data property', async () => {
      const mockApiAccounts = [
        { key: 'acc1', type: 'Margin' },
        { key: 'acc2', type: 'TFSA' },
      ];
      const mockResponse = { data: mockApiAccounts };

      globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
        expect(options.url).toBe('https://api.questrade.com/v2/brokerage-accounts');
        setTimeout(() => {
          options.onload({
            status: 200,
            responseText: JSON.stringify(mockResponse),
          });
        }, 0);
      });

      const result = await fetchAndCacheQuestradeAccounts();

      // Should return consolidated structure
      expect(result).toHaveLength(2);
      expect(result[0].questradeAccount.id).toBe('acc1');

      // Should save to consolidated storage
      expect(globalThis.GM_setValue).toHaveBeenCalledWith(
        'questrade_accounts_list',
        expect.any(String),
      );
    });

    test('should return empty array when no accounts found', async () => {
      globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
        expect(options.url).toBe('https://api.questrade.com/v2/brokerage-accounts');
        setTimeout(() => {
          options.onload({
            status: 200,
            responseText: JSON.stringify({ accounts: [] }),
          });
        }, 0);
      });

      const result = await fetchAndCacheQuestradeAccounts();

      expect(result).toEqual([]);
      expect(globalThis.GM_setValue).not.toHaveBeenCalled();
    });

    test('should handle invalid response format', async () => {
      globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
        expect(options.url).toBe('https://api.questrade.com/v2/brokerage-accounts');
        setTimeout(() => {
          options.onload({
            status: 200,
            responseText: JSON.stringify({ invalid: 'format' }),
          });
        }, 0);
      });

      const result = await fetchAndCacheQuestradeAccounts();

      expect(result).toEqual([]);
      expect(globalThis.GM_setValue).not.toHaveBeenCalled();
    });

    test('should preserve existing monarchAccount and settings when refreshing', async () => {
      const existingAccounts = [
        {
          questradeAccount: { id: 'acc1', key: 'acc1', type: 'Margin' },
          monarchAccount: { id: 'monarch-123', displayName: 'My Monarch Account' },
          syncEnabled: false,
          lastSyncDate: '2026-01-01',
          uploadedTransactions: [{ id: 'tx-1', date: '2026-01-01' }],
        },
      ];
      globalThis.GM_getValue.mockImplementation((key, defaultVal) => {
        if (key === 'questrade_accounts_list') {
          return JSON.stringify(existingAccounts);
        }
        return defaultVal;
      });

      const mockApiAccounts = [
        { key: 'acc1', type: 'Margin', nickname: 'Updated Name' },
        { key: 'acc2', type: 'TFSA', nickname: 'New Account' },
      ];

      globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
        setTimeout(() => {
          options.onload({
            status: 200,
            responseText: JSON.stringify(mockApiAccounts),
          });
        }, 0);
      });

      const result = await fetchAndCacheQuestradeAccounts();

      // Should preserve existing settings for acc1
      expect(result[0].monarchAccount).toEqual({ id: 'monarch-123', displayName: 'My Monarch Account' });
      expect(result[0].syncEnabled).toBe(false);
      expect(result[0].lastSyncDate).toBe('2026-01-01');
      expect(result[0].uploadedTransactions).toHaveLength(1);

      // acc2 should have defaults
      expect(result[1].monarchAccount).toBeNull();
      expect(result[1].syncEnabled).toBe(true);
    });

    test('should clean up legacy cache if it exists', async () => {
      globalThis.GM_getValue.mockImplementation((key, defaultVal) => {
        if (key === 'questrade_accounts_cache') {
          return '[{"key": "old-acc"}]';
        }
        return defaultVal;
      });
      globalThis.GM_deleteValue = jest.fn();

      const mockApiAccounts = [{ key: 'acc1', type: 'Margin' }];

      globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
        setTimeout(() => {
          options.onload({
            status: 200,
            responseText: JSON.stringify(mockApiAccounts),
          });
        }, 0);
      });

      await fetchAndCacheQuestradeAccounts();

      // Should clean up legacy cache
      expect(globalThis.GM_deleteValue).toHaveBeenCalledWith('questrade_accounts_cache');
    });

    test('should preserve orphaned accounts in storage but NOT return them (only return API accounts)', async () => {
      // Simulate existing accounts where one (acc2) has a Monarch mapping but is no longer in API
      const existingAccounts = [
        {
          questradeAccount: { id: 'acc1', key: 'acc1', type: 'Margin', nickname: 'Margin Account' },
          monarchAccount: { id: 'monarch-1', displayName: 'Monarch Margin' },
          syncEnabled: true,
          lastSyncDate: '2026-01-01',
          uploadedTransactions: [{ id: 'tx-1', date: '2026-01-01' }],
        },
        {
          questradeAccount: { id: 'acc2', key: 'acc2', type: 'TFSA', nickname: 'Closed TFSA' },
          monarchAccount: { id: 'monarch-2', displayName: 'Monarch TFSA' },
          syncEnabled: false,
          lastSyncDate: '2025-12-15',
          uploadedTransactions: [{ id: 'tx-2', date: '2025-12-15' }],
        },
      ];

      globalThis.GM_getValue.mockImplementation((key, defaultVal) => {
        if (key === 'questrade_accounts_list') {
          return JSON.stringify(existingAccounts);
        }
        return defaultVal;
      });

      // API only returns acc1 (acc2 has been closed/transferred)
      const mockApiAccounts = [
        { key: 'acc1', type: 'Margin', nickname: 'Margin Account Updated' },
      ];

      globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
        setTimeout(() => {
          options.onload({
            status: 200,
            responseText: JSON.stringify(mockApiAccounts),
          });
        }, 0);
      });

      const result = await fetchAndCacheQuestradeAccounts();

      // Should return ONLY the active API account (orphans not returned)
      expect(result).toHaveLength(1);

      // First account (from API) should have updated questradeAccount
      expect(result[0].questradeAccount).not.toBeNull();
      expect(result[0].questradeAccount.id).toBe('acc1');
      expect(result[0].questradeAccount.nickname).toBe('Margin Account Updated');
      expect(result[0].monarchAccount).toEqual({ id: 'monarch-1', displayName: 'Monarch Margin' });

      // Verify storage includes BOTH accounts (active + orphaned with isOrphanedFromApi marker)
      expect(globalThis.GM_setValue).toHaveBeenCalledWith(
        'questrade_accounts_list',
        expect.any(String),
      );

      // Parse the saved data to verify both accounts are in storage
      const savedCall = globalThis.GM_setValue.mock.calls.find((call) => call[0] === 'questrade_accounts_list');
      const savedAccounts = JSON.parse(savedCall[1]);
      expect(savedAccounts).toHaveLength(2);

      // Orphaned account should be in storage with isOrphanedFromApi marker
      const orphanedAccount = savedAccounts.find((acc) => acc.questradeAccount?.id === 'acc2');
      expect(orphanedAccount).toBeDefined();
      expect(orphanedAccount.isOrphanedFromApi).toBe(true);
      expect(orphanedAccount.questradeAccount.type).toBe('TFSA');
      expect(orphanedAccount.questradeAccount.nickname).toBe('Closed TFSA');
      expect(orphanedAccount.monarchAccount).toEqual({ id: 'monarch-2', displayName: 'Monarch TFSA' });
      expect(orphanedAccount.syncEnabled).toBe(false);
      expect(orphanedAccount.lastSyncDate).toBe('2025-12-15');
    });

    test('should not duplicate orphaned accounts that are already orphaned', async () => {
      // Simulate existing accounts where acc2 is already orphaned (questradeAccount: null)
      const existingAccounts = [
        {
          questradeAccount: { id: 'acc1', key: 'acc1', type: 'Margin' },
          monarchAccount: { id: 'monarch-1', displayName: 'Monarch Margin' },
          syncEnabled: true,
        },
        {
          questradeAccount: null, // Already orphaned
          monarchAccount: { id: 'monarch-2', displayName: 'Monarch TFSA (closed)' },
          syncEnabled: false,
          lastSyncDate: '2025-12-15',
        },
      ];

      globalThis.GM_getValue.mockImplementation((key, defaultVal) => {
        if (key === 'questrade_accounts_list') {
          return JSON.stringify(existingAccounts);
        }
        return defaultVal;
      });

      // API only returns acc1
      const mockApiAccounts = [
        { key: 'acc1', type: 'Margin', nickname: 'Margin Account' },
      ];

      globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
        setTimeout(() => {
          options.onload({
            status: 200,
            responseText: JSON.stringify(mockApiAccounts),
          });
        }, 0);
      });

      const result = await fetchAndCacheQuestradeAccounts();

      // Should still have 2 accounts, not duplicate the orphaned one
      // Note: The current implementation requires questradeAccount.id or questradeAccount.key to add to orphan list
      // so already-orphaned accounts (with null questradeAccount) won't be duplicated
      expect(result).toHaveLength(1);
      expect(result[0].questradeAccount.id).toBe('acc1');
    });

    test('should handle API errors', async () => {
      authService.checkQuestradeAuth.mockReturnValue({
        authenticated: false,
        token: null,
      });

      await expect(fetchAndCacheQuestradeAccounts()).rejects.toThrow(
        'Questrade auth token not found. Please ensure you are logged in to Questrade.',
      );
    });

    test('should handle network errors during fetch', async () => {
      globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
        expect(options.url).toBe('https://api.questrade.com/v2/brokerage-accounts');
        setTimeout(() => {
          options.onerror({ error: 'Network error' });
        }, 0);
      });

      await expect(fetchAndCacheQuestradeAccounts()).rejects.toThrow(
        'A network error occurred while contacting the Questrade API.',
      );
    });
  });

  describe('getQuestradeAccount', () => {
    test('should return account by ID', () => {
      const mockAccounts = [
        { key: 'acc1', type: 'Margin', name: 'Margin Account' },
        { key: 'acc2', type: 'TFSA', name: 'TFSA Account' },
      ];

      globalThis.GM_getValue.mockReturnValue(JSON.stringify(mockAccounts));

      const result = getQuestradeAccount('acc2');

      expect(result).toEqual({ key: 'acc2', type: 'TFSA', name: 'TFSA Account' });
      expect(globalThis.GM_getValue).toHaveBeenCalledWith('questrade_accounts_cache', '[]');
    });

    test('should return undefined for non-existent account', () => {
      const mockAccounts = [
        { key: 'acc1', type: 'Margin', name: 'Margin Account' },
      ];

      globalThis.GM_getValue.mockReturnValue(JSON.stringify(mockAccounts));

      const result = getQuestradeAccount('nonexistent');

      expect(result).toBeUndefined();
    });

    test('should handle empty accounts list', () => {
      globalThis.GM_getValue.mockReturnValue('[]');

      const result = getQuestradeAccount('acc1');

      expect(result).toBeUndefined();
    });

    test('should handle invalid JSON in storage', () => {
      globalThis.GM_getValue.mockReturnValue('invalid json');

      expect(() => getQuestradeAccount('acc1')).toThrow();
    });
  });

  describe('checkTokenStatus', () => {
    test('should return auth status from auth service', () => {
      const mockAuthStatus = {
        authenticated: true,
        token: 'Bearer test-token',
        expiresAt: Date.now() + 3600000,
      };

      authService.checkQuestradeAuth.mockReturnValue(mockAuthStatus);

      const result = checkTokenStatus();

      expect(result).toEqual(mockAuthStatus);
      expect(authService.checkQuestradeAuth).toHaveBeenCalled();
    });

    test('should return null when not authenticated', () => {
      authService.checkQuestradeAuth.mockReturnValue({
        authenticated: false,
        token: null,
      });

      const result = checkTokenStatus();

      expect(result).toEqual({
        authenticated: false,
        token: null,
      });
    });
  });

  describe('getToken', () => {
    test('should return token from auth service', () => {
      const mockToken = {
        accessToken: 'test-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() + 3600000,
      };

      authService.getQuestradeToken.mockReturnValue(mockToken);

      const result = getToken();

      expect(result).toEqual(mockToken);
      expect(authService.getQuestradeToken).toHaveBeenCalled();
    });

    test('should return null when no token available', () => {
      authService.getQuestradeToken.mockReturnValue(null);

      const result = getToken();

      expect(result).toBeNull();
    });
  });

  describe('fetchAccountPositions', () => {
    test('should fetch positions with default sort order', async () => {
      const mockResponse = {
        data: [
          {
            securityUuid: '18111621-1e01-4892-0aef-1956144a7e9e',
            openQuantity: 106,
            marketValue: 824.68,
            security: { symbol: 'SNAP', description: 'SNAP INC' },
          },
        ],
        metadata: { totalCount: 1, count: 1 },
      };

      globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
        expect(options.url).toBe(
          'https://api.questrade.com/v1/positions?sort-by=%2BmarketValue&account-uuid=test-uuid',
        );
        setTimeout(() => {
          options.onload({
            status: 200,
            responseText: JSON.stringify(mockResponse),
          });
        }, 0);
      });

      const result = await fetchAccountPositions('test-uuid');
      expect(result).toEqual(mockResponse);
      expect(result.data).toHaveLength(1);
      expect(result.metadata.totalCount).toBe(1);
    });

    test('should fetch positions with custom sort order', async () => {
      const mockResponse = {
        data: [
          {
            securityUuid: '4c0c0b3f-1f4e-4c22-0c9a-a4851d4c092b',
            openQuantity: 20,
            marketValue: 14106,
            security: { symbol: 'META', description: 'META PLATFORMS INC' },
          },
        ],
        metadata: { totalCount: 1, count: 1 },
      };

      globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
        expect(options.url).toBe(
          'https://api.questrade.com/v1/positions?sort-by=-marketValue&account-uuid=test-uuid',
        );
        setTimeout(() => {
          options.onload({
            status: 200,
            responseText: JSON.stringify(mockResponse),
          });
        }, 0);
      });

      const result = await fetchAccountPositions('test-uuid', '-marketValue');
      expect(result).toEqual(mockResponse);
    });

    test('should throw error when accountUuid is missing', async () => {
      await expect(fetchAccountPositions('')).rejects.toThrow('Account Id is required');
      await expect(fetchAccountPositions(null)).rejects.toThrow('Account Id is required');
      await expect(fetchAccountPositions(undefined)).rejects.toThrow('Account Id is required');
    });

    test('should handle empty positions array', async () => {
      const mockResponse = {
        data: [],
        metadata: { totalCount: 0, count: 0 },
      };

      globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
        setTimeout(() => {
          options.onload({
            status: 200,
            responseText: JSON.stringify(mockResponse),
          });
        }, 0);
      });

      const result = await fetchAccountPositions('test-uuid');
      expect(result.data).toHaveLength(0);
      expect(result.metadata.totalCount).toBe(0);
    });

    test('should handle auth errors', async () => {
      authService.checkQuestradeAuth.mockReturnValue({
        authenticated: false,
        token: null,
      });

      await expect(fetchAccountPositions('test-uuid')).rejects.toThrow(
        'Questrade auth token not found. Please ensure you are logged in to Questrade.',
      );
    });

    test('should handle 401 unauthorized and clear auth', async () => {
      globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
        setTimeout(() => {
          options.onload({
            status: 401,
            responseText: '{"error": "Unauthorized"}',
          });
        }, 0);
      });

      await expect(fetchAccountPositions('test-uuid')).rejects.toThrow(
        'Questrade Auth Error (401): Token was invalid or expired. Please refresh the page.',
      );

      expect(authService.saveQuestradeToken).toHaveBeenCalledWith(null);
      expect(stateManager.setQuestradeAuth).toHaveBeenCalledWith(null);
    });

    test('should handle HTTP errors', async () => {
      globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
        setTimeout(() => {
          options.onload({
            status: 500,
            responseText: 'Internal Server Error',
          });
        }, 0);
      });

      await expect(fetchAccountPositions('test-uuid')).rejects.toThrow(
        'Questrade API Error: Received status 500',
      );
    });

    test('should handle network errors', async () => {
      globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
        setTimeout(() => {
          options.onerror({ error: 'Network error' });
        }, 0);
      });

      await expect(fetchAccountPositions('test-uuid')).rejects.toThrow(
        'A network error occurred while contacting the Questrade API.',
      );
    });

    test('should validate response structure', async () => {
      const mockResponse = {
        data: [
          {
            securityUuid: '18111621-1e01-4892-0aef-1956144a7e9e',
            openQuantity: 106,
            closedQuantity: 0,
            averagePrice: 24.4102,
            marketValue: 824.68,
            percentageOfPortfolio: 0.0551,
            openPnl: -1762.8,
            currency: 'USD',
            account: {
              accountUuid: 'ab37ef5b-226a-4522-0ebc-630c828e3b2a',
              number: '26831722',
              name: 'Joint Margin',
            },
            security: {
              symbol: 'SNAP',
              description: 'SNAP INC',
              type: 'Stock',
            },
            currentPrice: {
              value: 7.78,
              type: 'lastTradePrice',
            },
          },
        ],
        metadata: {
          previousLink: '',
          nextLink: '',
          totalCount: 1,
          count: 1,
        },
      };

      globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
        setTimeout(() => {
          options.onload({
            status: 200,
            responseText: JSON.stringify(mockResponse),
          });
        }, 0);
      });

      const result = await fetchAccountPositions('test-uuid');

      // Validate structure
      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('metadata');
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data[0]).toHaveProperty('securityUuid');
      expect(result.data[0]).toHaveProperty('openQuantity');
      expect(result.data[0]).toHaveProperty('marketValue');
      expect(result.data[0]).toHaveProperty('account');
      expect(result.data[0]).toHaveProperty('security');
      expect(result.metadata).toHaveProperty('totalCount');
      expect(result.metadata).toHaveProperty('count');
    });

    test('should handle malformed JSON response', async () => {
      globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
        options.onload({
          status: 200,
          responseText: 'invalid json{',
        });
      });

      await expect(fetchAccountPositions('test-uuid')).rejects.toThrow();
    });
  });

  describe('fetchAccountOrders', () => {
    test('should fetch orders with default parameters', async () => {
      const mockResponse = {
        data: [
          {
            orderUuid: 'order-123',
            status: 'Executed',
            action: 'Buy',
            dollarValue: 1000,
            security: { displayName: 'Apple Inc' },
            updatedDateTime: '2025-09-12T10:00:00.000Z',
          },
        ],
        metadata: { totalCount: 1, count: 1 },
      };

      globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
        expect(options.url).toContain('https://api.questrade.com/v1/orders');
        expect(options.url).toContain('from-date=2025-09-12T00:00:00.000Z');
        expect(options.url).toContain('status-group=All');
        expect(options.url).toContain('limit=1000');
        expect(options.url).toContain('sort-by=-createdDateTime');
        expect(options.url).toContain('account-uuid=test-uuid');
        setTimeout(() => {
          options.onload({
            status: 200,
            responseText: JSON.stringify(mockResponse),
          });
        }, 0);
      });

      const result = await fetchAccountOrders('test-uuid', '2025-09-12T00:00:00.000Z');
      expect(result).toEqual(mockResponse);
      expect(result.data).toHaveLength(1);
    });

    test('should fetch orders with custom parameters', async () => {
      const mockResponse = {
        data: [
          {
            orderUuid: 'order-456',
            status: 'Executed',
            action: 'Sell',
          },
        ],
        metadata: { totalCount: 1, count: 1 },
      };

      globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
        expect(options.url).toContain('status-group=Executed');
        expect(options.url).toContain('limit=500');
        expect(options.url).toContain('sort-by=createdDateTime');
        setTimeout(() => {
          options.onload({
            status: 200,
            responseText: JSON.stringify(mockResponse),
          });
        }, 0);
      });

      const result = await fetchAccountOrders(
        'test-uuid',
        '2025-09-12T00:00:00.000Z',
        'Executed',
        500,
        'createdDateTime',
      );
      expect(result).toEqual(mockResponse);
    });

    test('should throw error when accountUuid is missing', async () => {
      await expect(fetchAccountOrders('', '2025-09-12T00:00:00.000Z')).rejects.toThrow('Account Id is required');
      await expect(fetchAccountOrders(null, '2025-09-12T00:00:00.000Z')).rejects.toThrow('Account Id is required');
      await expect(fetchAccountOrders(undefined, '2025-09-12T00:00:00.000Z')).rejects.toThrow('Account Id is required');
    });

    test('should throw error when fromDate is missing', async () => {
      await expect(fetchAccountOrders('test-uuid', '')).rejects.toThrow('From date is required');
      await expect(fetchAccountOrders('test-uuid', null)).rejects.toThrow('From date is required');
      await expect(fetchAccountOrders('test-uuid', undefined)).rejects.toThrow('From date is required');
    });

    test('should handle empty orders array', async () => {
      const mockResponse = {
        data: [],
        metadata: { totalCount: 0, count: 0 },
      };

      globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
        setTimeout(() => {
          options.onload({
            status: 200,
            responseText: JSON.stringify(mockResponse),
          });
        }, 0);
      });

      const result = await fetchAccountOrders('test-uuid', '2025-09-12T00:00:00.000Z');
      expect(result.data).toHaveLength(0);
      expect(result.metadata.totalCount).toBe(0);
    });

    test('should handle auth errors', async () => {
      authService.checkQuestradeAuth.mockReturnValue({
        authenticated: false,
        token: null,
      });

      await expect(fetchAccountOrders('test-uuid', '2025-09-12T00:00:00.000Z')).rejects.toThrow(
        'Questrade auth token not found. Please ensure you are logged in to Questrade.',
      );
    });

    test('should handle 401 unauthorized and clear auth', async () => {
      globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
        setTimeout(() => {
          options.onload({
            status: 401,
            responseText: '{"error": "Unauthorized"}',
          });
        }, 0);
      });

      await expect(fetchAccountOrders('test-uuid', '2025-09-12T00:00:00.000Z')).rejects.toThrow(
        'Questrade Auth Error (401): Token was invalid or expired. Please refresh the page.',
      );

      expect(authService.saveQuestradeToken).toHaveBeenCalledWith(null);
      expect(stateManager.setQuestradeAuth).toHaveBeenCalledWith(null);
    });

    test('should handle HTTP errors', async () => {
      globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
        setTimeout(() => {
          options.onload({
            status: 500,
            responseText: 'Internal Server Error',
          });
        }, 0);
      });

      await expect(fetchAccountOrders('test-uuid', '2025-09-12T00:00:00.000Z')).rejects.toThrow(
        'Questrade API Error: Received status 500',
      );
    });

    test('should handle network errors', async () => {
      globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
        setTimeout(() => {
          options.onerror({ error: 'Network error' });
        }, 0);
      });

      await expect(fetchAccountOrders('test-uuid', '2025-09-12T00:00:00.000Z')).rejects.toThrow(
        'A network error occurred while contacting the Questrade API.',
      );
    });

    test('should validate response structure', async () => {
      const mockResponse = {
        data: [
          {
            orderUuid: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            status: 'Executed',
            action: 'Buy',
            dollarValue: 5000,
            security: {
              displayName: 'Apple Inc',
              symbol: 'AAPL',
            },
            createdDateTime: '2025-09-12T09:30:00.000Z',
            updatedDateTime: '2025-09-12T10:00:00.000Z',
          },
        ],
        metadata: {
          previousLink: '',
          nextLink: '',
          totalCount: 1,
          count: 1,
        },
      };

      globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
        setTimeout(() => {
          options.onload({
            status: 200,
            responseText: JSON.stringify(mockResponse),
          });
        }, 0);
      });

      const result = await fetchAccountOrders('test-uuid', '2025-09-12T00:00:00.000Z');

      // Validate structure
      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('metadata');
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data[0]).toHaveProperty('orderUuid');
      expect(result.data[0]).toHaveProperty('status');
      expect(result.data[0]).toHaveProperty('action');
      expect(result.data[0]).toHaveProperty('security');
      expect(result.metadata).toHaveProperty('totalCount');
      expect(result.metadata).toHaveProperty('count');
    });
  });

  describe('Integration Tests', () => {
    test('should handle complete workflow from auth check to account fetch', async () => {
      const mockApiAccounts = [
        { key: 'acc1', type: 'Margin', name: 'Test Account' },
      ];

      // Mock successful auth
      authService.checkQuestradeAuth.mockReturnValue({
        authenticated: true,
        token: 'Bearer integration-token',
      });

      // Mock successful API response
      globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
        expect(options.url).toBe('https://api.questrade.com/v2/brokerage-accounts');
        setTimeout(() => {
          options.onload({
            status: 200,
            responseText: JSON.stringify(mockApiAccounts),
          });
        }, 0);
      });

      const result = await fetchAndCacheQuestradeAccounts();

      // Should return consolidated structure
      expect(result).toHaveLength(1);
      expect(result[0].questradeAccount.id).toBe('acc1');
      expect(result[0].questradeAccount.key).toBe('acc1');
      expect(result[0].questradeAccount.type).toBe('Margin');
      expect(result[0].monarchAccount).toBeNull();
      expect(result[0].syncEnabled).toBe(true);

      // Test getting account by ID (legacy getQuestradeAccount still uses cache)
      globalThis.GM_getValue.mockReturnValue(JSON.stringify(mockApiAccounts));
      const account = getQuestradeAccount('acc1');
      expect(account).toEqual(mockApiAccounts[0]);
    });

    test('should handle auth failure in workflow', async () => {
      authService.checkQuestradeAuth.mockReturnValue({
        authenticated: false,
        token: null,
      });

      await expect(fetchAndCacheQuestradeAccounts()).rejects.toThrow(
        'Questrade auth token not found',
      );
    });
  });

  describe('Default Export Structure', () => {
    test('should export API methods with correct names in default object', () => {
      const questradeApi = require('../../src/api/questrade').default;

      // Verify all expected methods exist on default export
      expect(questradeApi).toHaveProperty('makeApiCall');
      expect(questradeApi).toHaveProperty('fetchAccounts');
      expect(questradeApi).toHaveProperty('getAccount');
      expect(questradeApi).toHaveProperty('fetchPositions');
      expect(questradeApi).toHaveProperty('fetchOrders'); // Should be fetchOrders, not fetchAccountOrders
      expect(questradeApi).toHaveProperty('checkTokenStatus');
      expect(questradeApi).toHaveProperty('getToken');

      // Verify these methods are functions
      expect(typeof questradeApi.makeApiCall).toBe('function');
      expect(typeof questradeApi.fetchAccounts).toBe('function');
      expect(typeof questradeApi.getAccount).toBe('function');
      expect(typeof questradeApi.fetchPositions).toBe('function');
      expect(typeof questradeApi.fetchOrders).toBe('function');
      expect(typeof questradeApi.checkTokenStatus).toBe('function');
      expect(typeof questradeApi.getToken).toBe('function');
    });

    test('should not have fetchAccountOrders on default export', () => {
      const questradeApi = require('../../src/api/questrade').default;

      // This property should NOT exist on the default export
      expect(questradeApi).not.toHaveProperty('fetchAccountOrders');
    });

    test('default export fetchOrders should be the same function as named export fetchAccountOrders', () => {
      const questradeApi = require('../../src/api/questrade').default;
      const { fetchAccountOrders: namedExportFetchAccountOrders } = require('../../src/api/questrade');

      // The default export's fetchOrders should reference the same function as the named export
      expect(questradeApi.fetchOrders).toBe(namedExportFetchAccountOrders);
    });
  });

});
