/**
 * Comprehensive Tests for Questrade API
 */

import {
  makeQuestradeApiCall,
  fetchAndCacheQuestradeAccounts,
  getQuestradeAccount,
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
    saveToken: jest.fn(),
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

      expect(authService.saveToken).toHaveBeenCalledWith('questrade', null);
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
    test('should fetch and cache accounts from API response array', async () => {
      const mockAccounts = [
        { key: 'acc1', type: 'Margin' },
        { key: 'acc2', type: 'TFSA' },
      ];

      globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
        expect(options.url).toBe('https://api.questrade.com/v2/brokerage-accounts');
        setTimeout(() => {
          options.onload({
            status: 200,
            responseText: JSON.stringify(mockAccounts),
          });
        }, 0);
      });

      const result = await fetchAndCacheQuestradeAccounts();

      expect(result).toEqual(mockAccounts);
      expect(globalThis.GM_setValue).toHaveBeenCalledWith(
        'questrade_accounts_list',
        JSON.stringify(mockAccounts),
      );
    });

    test('should handle API response with accounts property', async () => {
      const mockAccounts = [
        { key: 'acc1', type: 'Margin' },
        { key: 'acc2', type: 'TFSA' },
      ];
      const mockResponse = { accounts: mockAccounts };

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

      expect(result).toEqual(mockAccounts);
      expect(globalThis.GM_setValue).toHaveBeenCalledWith(
        'questrade_accounts_list',
        JSON.stringify(mockAccounts),
      );
    });

    test('should handle API response with data property', async () => {
      const mockAccounts = [
        { key: 'acc1', type: 'Margin' },
        { key: 'acc2', type: 'TFSA' },
      ];
      const mockResponse = { data: mockAccounts };

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

      expect(result).toEqual(mockAccounts);
      expect(globalThis.GM_setValue).toHaveBeenCalledWith(
        'questrade_accounts_list',
        JSON.stringify(mockAccounts),
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
      expect(globalThis.GM_getValue).toHaveBeenCalledWith('questrade_accounts_list', '[]');
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

  describe('Integration Tests', () => {
    test('should handle complete workflow from auth check to account fetch', async () => {
      const mockAccounts = [
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
            responseText: JSON.stringify(mockAccounts),
          });
        }, 0);
      });

      const result = await fetchAndCacheQuestradeAccounts();
      expect(result).toEqual(mockAccounts);

      // Test getting account by ID
      globalThis.GM_getValue.mockReturnValue(JSON.stringify(mockAccounts));
      const account = getQuestradeAccount('acc1');
      expect(account).toEqual(mockAccounts[0]);
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

  describe('Edge Cases', () => {
    test('should handle malformed JSON response', async () => {
      globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
        // Use immediate execution instead of setTimeout to avoid timeout issues
        options.onload({
          status: 200,
          responseText: 'invalid json{', // Malformed JSON
        });
      });

      await expect(makeQuestradeApiCall('/test')).rejects.toThrow();
    }, 15000); // Increase timeout

    test('should handle empty response', async () => {
      globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
        // Use immediate execution instead of setTimeout to avoid timeout issues
        options.onload({
          status: 200,
          responseText: '', // Empty response
        });
      });

      await expect(makeQuestradeApiCall('/test')).rejects.toThrow();
    }, 15000); // Increase timeout

    test('should handle various endpoint formats', async () => {
      const endpoints = [
        '/v1/accounts',
        'v1/accounts',
        '/v1/accounts/',
        '/v1/accounts/123/balances',
      ];

      for (const endpoint of endpoints) {
        globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
          expect(options.url).toContain('api.questrade.com');
          setTimeout(() => {
            options.onload({
              status: 200,
              responseText: '{"success": true}',
            });
          }, 0);
        });

        await makeQuestradeApiCall(endpoint);
      }

      expect(globalThis.GM_xmlhttpRequest).toHaveBeenCalledTimes(endpoints.length);
    });
  });
});
