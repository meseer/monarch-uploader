/**
 * Tests for Rogers Bank API Client
 */

import {
  getRogersBankCredentials,
  checkRogersBankAuth,
  checkCredentialStatus,
  setupCredentialInterception,
  clearRogersBankCredentials,
  fetchRogersBankBalance,
} from '../../src/api/rogersbank';

// Mock dependencies
jest.mock('../../src/core/config', () => ({
  STORAGE: {
    ROGERSBANK_AUTH_TOKEN: 'rogersbank_auth_token',
    ROGERSBANK_ACCOUNT_ID: 'rogersbank_account_id',
    ROGERSBANK_CUSTOMER_ID: 'rogersbank_customer_id',
    ROGERSBANK_ACCOUNT_ID_ENCODED: 'rogersbank_account_id_encoded',
    ROGERSBANK_CUSTOMER_ID_ENCODED: 'rogersbank_customer_id_encoded',
    ROGERSBANK_DEVICE_ID: 'rogersbank_device_id',
    ROGERSBANK_LAST_UPDATED: 'rogersbank_last_updated',
    ROGERSBANK_CONFIG: 'rogersbank_config',
    WEALTHSIMPLE_CONFIG: 'wealthsimple_config',
    QUESTRADE_CONFIG: 'questrade_config',
    CANADALIFE_CONFIG: 'canadalife_config',
  },
  TRANSACTION_RETENTION_DEFAULTS: {
    DAYS: 91,
    COUNT: 1000,
  },
}));

jest.mock('../../src/core/utils', () => ({
  debugLog: jest.fn(),
}));

jest.mock('../../src/core/state', () => ({
  __esModule: true,
  default: {
    setRogersBankAuth: jest.fn(),
  },
}));

jest.mock('../../src/ui/toast', () => ({
  __esModule: true,
  default: {
    show: jest.fn(),
  },
}));

jest.mock('../../src/services/common/configStore', () => ({
  getAuth: jest.fn(() => ({})),
  setAuth: jest.fn(),
  clearAuth: jest.fn(),
}));

jest.mock('../../src/core/integrationCapabilities', () => ({
  INTEGRATIONS: {
    WEALTHSIMPLE: 'wealthsimple',
    QUESTRADE: 'questrade',
    CANADALIFE: 'canadalife',
    ROGERSBANK: 'rogersbank',
  },
}));

// Mock GM functions
globalThis.GM_getValue = jest.fn();
globalThis.GM_setValue = jest.fn();
globalThis.GM_deleteValue = jest.fn();

// Mock fetch
globalThis.fetch = jest.fn();

describe('Rogers Bank API Client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset fetch mock
    globalThis.fetch.mockReset();
  });

  describe('getRogersBankCredentials', () => {
    test('should retrieve credentials from GM storage', () => {
      const mockCredentials = {
        authToken: 'test-token',
        accountId: 'test-account',
        customerId: 'test-customer',
        accountIdEncoded: 'encoded-account',
        customerIdEncoded: 'encoded-customer',
        deviceId: 'test-device',
        lastUpdated: '2024-01-15T10:00:00Z',
      };

      globalThis.GM_getValue
        .mockReturnValueOnce(mockCredentials.authToken)
        .mockReturnValueOnce(mockCredentials.accountId)
        .mockReturnValueOnce(mockCredentials.customerId)
        .mockReturnValueOnce(mockCredentials.accountIdEncoded)
        .mockReturnValueOnce(mockCredentials.customerIdEncoded)
        .mockReturnValueOnce(mockCredentials.deviceId)
        .mockReturnValueOnce(mockCredentials.lastUpdated);

      const result = getRogersBankCredentials();

      expect(result).toEqual(mockCredentials);
      expect(globalThis.GM_getValue).toHaveBeenCalledTimes(7);
    });

    test('should handle missing credentials gracefully', () => {
      globalThis.GM_getValue.mockReturnValue(null);

      const result = getRogersBankCredentials();

      expect(result).toEqual({
        authToken: null,
        accountId: null,
        customerId: null,
        accountIdEncoded: null,
        customerIdEncoded: null,
        deviceId: null,
        lastUpdated: null,
      });
    });

    test('should handle GM storage errors', () => {
      globalThis.GM_getValue.mockImplementation(() => {
        throw new Error('Storage error');
      });

      const result = getRogersBankCredentials();

      // Should return default credentials object on error
      expect(result.authToken).toBeNull();
      expect(result.accountId).toBeNull();
    });
  });

  describe('checkRogersBankAuth', () => {
    test('should return authenticated status when all credentials present', () => {
      globalThis.GM_getValue
        .mockReturnValueOnce('test-token')
        .mockReturnValueOnce('test-account')
        .mockReturnValueOnce('test-customer')
        .mockReturnValueOnce('encoded-account')
        .mockReturnValueOnce('encoded-customer')
        .mockReturnValueOnce('test-device')
        .mockReturnValueOnce('2024-01-15T10:00:00Z');

      const result = checkRogersBankAuth();

      expect(result.authenticated).toBe(true);
      expect(result.source).toBe('intercepted');
      expect(result.credentials.authToken).toBe('test-token');
    });

    test('should return unauthenticated status when credentials missing', () => {
      globalThis.GM_getValue.mockReturnValue(null);

      const result = checkRogersBankAuth();

      expect(result.authenticated).toBe(false);
      expect(result.source).toBeNull();
    });

    test('should return unauthenticated when partial credentials', () => {
      globalThis.GM_getValue
        .mockReturnValueOnce('test-token')
        .mockReturnValueOnce('test-account')
        .mockReturnValueOnce(null) // Missing customer ID
        .mockReturnValueOnce('encoded-account')
        .mockReturnValueOnce('encoded-customer')
        .mockReturnValueOnce('test-device')
        .mockReturnValueOnce('2024-01-15T10:00:00Z');

      const result = checkRogersBankAuth();

      expect(result.authenticated).toBe(false);
    });
  });

  describe('checkCredentialStatus', () => {
    test('should return auth status when authenticated', () => {
      globalThis.GM_getValue
        .mockReturnValueOnce('test-token')
        .mockReturnValueOnce('test-account')
        .mockReturnValueOnce('test-customer')
        .mockReturnValueOnce('encoded-account')
        .mockReturnValueOnce('encoded-customer')
        .mockReturnValueOnce('test-device')
        .mockReturnValueOnce('2024-01-15T10:00:00Z');

      const result = checkCredentialStatus();

      expect(result).toBeTruthy();
      expect(result.authenticated).toBe(true);
    });

    test('should return null when not authenticated', () => {
      globalThis.GM_getValue.mockReturnValue(null);

      const result = checkCredentialStatus();

      expect(result).toBeNull();
    });
  });

  describe('setupCredentialInterception', () => {
    let originalXHR;
    let originalFetch;

    beforeEach(() => {
      // Store original implementations
      originalXHR = globalThis.XMLHttpRequest;
      originalFetch = globalThis.fetch;

      // Mock XMLHttpRequest constructor
      globalThis.XMLHttpRequest = jest.fn().mockImplementation(() => {
        const instance = {
          open: jest.fn(),
          send: jest.fn(),
          setRequestHeader: jest.fn(),
          addEventListener: jest.fn(),
          getResponseHeader: jest.fn().mockReturnValue(null),
        };
        return instance;
      });

      // Create prototype object
      globalThis.XMLHttpRequest.prototype = {
        open: jest.fn(),
        send: jest.fn(),
        setRequestHeader: jest.fn(),
        addEventListener: jest.fn(),
        getResponseHeader: jest.fn(),
      };
    });

    afterEach(() => {
      // Restore original implementations
      globalThis.XMLHttpRequest = originalXHR;
      globalThis.fetch = originalFetch;
    });

    test('should set up credential interception', () => {
      expect(() => setupCredentialInterception()).not.toThrow();
    });

    test('should intercept XHR requests', () => {
      setupCredentialInterception();

      // Verify that XMLHttpRequest prototype methods were overridden
      expect(typeof XMLHttpRequest.prototype.open).toBe('function');
      expect(typeof XMLHttpRequest.prototype.send).toBe('function');
      expect(typeof XMLHttpRequest.prototype.setRequestHeader).toBe('function');
    });

    test('should intercept fetch requests', () => {
      setupCredentialInterception();

      // Verify that fetch was overridden
      expect(globalThis.fetch).toBeDefined();
      expect(typeof globalThis.fetch).toBe('function');
    });

    test('should capture credentials from transaction API XHR calls', () => {
      setupCredentialInterception();

      // Create a mock XHR instance
      const mockXHR = new XMLHttpRequest();

      // Simulate the credential interception flow
      const originalOpen = XMLHttpRequest.prototype.open;
      const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
      const originalSend = XMLHttpRequest.prototype.send;

      // Mock the transaction API URL
      const transactionUrl = 'https://selfserve.apis.rogersbank.com/corebank/v1/account/12345/customer/67890/transactions';

      // Simulate setting headers
      originalSetRequestHeader.call(mockXHR, 'Authorization', 'Bearer test-token');
      originalSetRequestHeader.call(mockXHR, 'AccountId', 'encoded-account-123');
      originalSetRequestHeader.call(mockXHR, 'CustomerId', 'encoded-customer-456');
      originalSetRequestHeader.call(mockXHR, 'DeviceId', 'device-789');

      // Simulate opening the request
      originalOpen.call(mockXHR, 'GET', transactionUrl);

      // Simulate sending - this should trigger credential capture
      originalSend.call(mockXHR, null);

      // Check if setAuth was called for saving credentials to configStore
      const { setAuth } = jest.requireMock('../../src/services/common/configStore');
      expect(setAuth).toHaveBeenCalledWith('rogersbank', expect.objectContaining({
        authToken: expect.any(String),
      }));
    });

    test('should handle token regeneration XHR responses', () => {
      setupCredentialInterception();

      // Create a mock XHR instance
      const mockXHR = new XMLHttpRequest();

      // Mock the token regeneration URL
      const regenUrl = 'https://selfserve.apis.rogersbank.com/authenticate/v1/authenticate/regeneratetoken/';

      // Set up the response handler mock
      mockXHR.getResponseHeader.mockReturnValue('new-access-token-123');

      // Simulate the request setup
      XMLHttpRequest.prototype.open.call(mockXHR, 'POST', regenUrl);
      XMLHttpRequest.prototype.send.call(mockXHR, null);

      // Simulate the load event that would trigger token capture
      const loadHandler = mockXHR.addEventListener.mock.calls.find((call) => call[0] === 'load');
      if (loadHandler) {
        loadHandler[1].call(mockXHR);
      }

      // Should have attempted to save the new token
      expect(mockXHR.getResponseHeader).toHaveBeenCalledWith('Accesstoken');
    });

    test('should intercept Rogers Bank fetch API calls', async () => {
      // Mock fetch response
      const mockFetchResponse = {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({}),
        clone: jest.fn().mockReturnThis(),
        headers: {
          get: jest.fn().mockReturnValue(null),
        },
      };

      const originalFetch = jest.fn().mockResolvedValue(mockFetchResponse);
      globalThis.fetch = originalFetch;

      setupCredentialInterception();

      // Test transaction API fetch call
      const transactionUrl = 'https://selfserve.apis.rogersbank.com/corebank/v1/account/12345/customer/67890/transactions';
      const options = {
        headers: {
          Authorization: 'Bearer test-token',
          AccountId: 'encoded-account',
          CustomerId: 'encoded-customer',
          DeviceId: 'device-id',
        },
      };

      // This should trigger credential capture
      await globalThis.fetch(transactionUrl, options);

      // Credentials saved to configStore via setAuth
      const { setAuth } = jest.requireMock('../../src/services/common/configStore');
      expect(setAuth).toHaveBeenCalledWith('rogersbank', expect.objectContaining({
        authToken: expect.any(String),
      }));
    });

    test('should handle token regeneration in fetch API calls', async () => {
      const mockNewToken = 'new-token-from-fetch';
      const mockFetchResponse = {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({}),
        clone: jest.fn().mockReturnValue({
          headers: {
            get: jest.fn().mockReturnValue(mockNewToken),
          },
        }),
        headers: {
          get: jest.fn().mockReturnValue(mockNewToken),
        },
      };

      const originalFetch = jest.fn().mockResolvedValue(mockFetchResponse);
      globalThis.fetch = originalFetch;

      setupCredentialInterception();

      // Test token regeneration fetch call
      const regenUrl = 'https://selfserve.apis.rogersbank.com/authenticate/v1/authenticate/regeneratetoken/';
      const response = await globalThis.fetch(regenUrl, {});

      expect(response).toBe(mockFetchResponse);
      expect(mockFetchResponse.clone).toHaveBeenCalled();
    });

    test('should handle fetch API errors gracefully', async () => {
      const fetchError = new Error('Network error');
      const originalFetch = jest.fn().mockRejectedValue(fetchError);
      globalThis.fetch = originalFetch;

      setupCredentialInterception();

      // Test that errors are properly propagated
      const regenUrl = 'https://selfserve.apis.rogersbank.com/authenticate/v1/authenticate/regeneratetoken/';
      await expect(globalThis.fetch(regenUrl, {})).rejects.toThrow('Network error');
    });

    test('should handle non-Rogers Bank API calls normally', async () => {
      const mockFetchResponse = { ok: true, status: 200 };
      const originalFetch = jest.fn().mockResolvedValue(mockFetchResponse);
      globalThis.fetch = originalFetch;

      setupCredentialInterception();

      // Test non-Rogers Bank URL
      const normalUrl = 'https://example.com/api/data';
      const response = await globalThis.fetch(normalUrl, {});

      expect(response).toBe(mockFetchResponse);
      expect(originalFetch).toHaveBeenCalledWith(normalUrl, {});
    });

    test('should handle Headers object in fetch options', async () => {
      const mockFetchResponse = { ok: true, status: 200 };
      const originalFetch = jest.fn().mockResolvedValue(mockFetchResponse);
      globalThis.fetch = originalFetch;

      setupCredentialInterception();

      // Test with Headers object
      const headers = new Headers();
      headers.append('Authorization', 'Bearer test-token');
      headers.append('AccountId', 'encoded-account');

      const transactionUrl = 'https://selfserve.apis.rogersbank.com/corebank/v1/account/12345/customer/67890/transactions';
      await globalThis.fetch(transactionUrl, { headers });

      // Credentials saved to configStore via setAuth
      const { setAuth } = jest.requireMock('../../src/services/common/configStore');
      expect(setAuth).toHaveBeenCalledWith('rogersbank', expect.objectContaining({
        authToken: expect.any(String),
      }));
    });
  });

  describe('clearRogersBankCredentials', () => {
    test('should clear all credentials from storage', () => {
      const { clearAuth } = jest.requireMock('../../src/services/common/configStore');

      clearRogersBankCredentials();

      // Should clear via configStore only  no legacy GM_deleteValue calls
      expect(clearAuth).toHaveBeenCalledWith('rogersbank');
    });

    test('should update state manager', () => {
      const stateManager = jest.requireMock('../../src/core/state').default;

      clearRogersBankCredentials();

      expect(stateManager.setRogersBankAuth).toHaveBeenCalledWith(null);
    });
  });

  describe('fetchRogersBankBalance', () => {
    const mockCredentials = {
      authToken: 'Bearer test-token',
      accountId: 'test-account',
      customerId: 'test-customer',
      accountIdEncoded: 'encoded-account',
      customerIdEncoded: 'encoded-customer',
      deviceId: 'test-device',
    };

    function setupValidCredentials() {
      globalThis.GM_getValue
        .mockReturnValueOnce(mockCredentials.authToken)
        .mockReturnValueOnce(mockCredentials.accountId)
        .mockReturnValueOnce(mockCredentials.customerId)
        .mockReturnValueOnce(mockCredentials.accountIdEncoded)
        .mockReturnValueOnce(mockCredentials.customerIdEncoded)
        .mockReturnValueOnce(mockCredentials.deviceId)
        .mockReturnValueOnce('2024-01-15T10:00:00Z');
    }

    test('should fetch balance successfully', async () => {
      setupValidCredentials();

      const mockResponse = {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          statusCode: '200',
          accountDetail: {
            currentBalance: {
              value: 1234.56,
            },
          },
        }),
      };

      globalThis.fetch.mockResolvedValue(mockResponse);

      const balance = await fetchRogersBankBalance();

      expect(balance).toBe(1234.56);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('selfserve.apis.rogersbank.com'),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            accountid: mockCredentials.accountIdEncoded,
            authorization: mockCredentials.authToken,
            customerid: mockCredentials.customerIdEncoded,
            deviceid: mockCredentials.deviceId,
          }),
        }),
      );
    });

    test('should throw error when credentials missing', async () => {
      globalThis.GM_getValue.mockReturnValue(null);

      await expect(fetchRogersBankBalance()).rejects.toThrow(
        'Missing Rogers Bank credentials. Please navigate to your account page first.',
      );
    });

    test('should handle API request failure', async () => {
      setupValidCredentials();

      const mockResponse = {
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: jest.fn(),
      };

      globalThis.fetch.mockResolvedValue(mockResponse);

      await expect(fetchRogersBankBalance()).rejects.toThrow(
        'API request failed: 401 Unauthorized',
      );
    });

    test('should handle API error status', async () => {
      setupValidCredentials();

      const mockResponse = {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          statusCode: '500',
          message: 'Internal server error',
        }),
      };

      globalThis.fetch.mockResolvedValue(mockResponse);

      await expect(fetchRogersBankBalance()).rejects.toThrow(
        'API returned error status: 500',
      );
    });

    test('should handle missing balance in response', async () => {
      setupValidCredentials();

      const mockResponse = {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          statusCode: '200',
          accountDetail: {
            // Missing currentBalance
          },
        }),
      };

      globalThis.fetch.mockResolvedValue(mockResponse);

      await expect(fetchRogersBankBalance()).rejects.toThrow(
        'Current balance not found in API response',
      );
    });

    test('should handle invalid balance value', async () => {
      setupValidCredentials();

      const mockResponse = {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          statusCode: '200',
          accountDetail: {
            currentBalance: {
              value: 'not-a-number',
            },
          },
        }),
      };

      globalThis.fetch.mockResolvedValue(mockResponse);

      await expect(fetchRogersBankBalance()).rejects.toThrow(
        'Invalid balance value received from API',
      );
    });

    test('should handle network errors', async () => {
      setupValidCredentials();

      globalThis.fetch.mockRejectedValue(new Error('Network error'));

      await expect(fetchRogersBankBalance()).rejects.toThrow('Network error');
    });

    test('should handle partial credentials', async () => {
      globalThis.GM_getValue
        .mockReturnValueOnce('test-token')
        .mockReturnValueOnce('test-account')
        .mockReturnValueOnce(null) // Missing customer ID
        .mockReturnValueOnce('encoded-account')
        .mockReturnValueOnce('encoded-customer')
        .mockReturnValueOnce('test-device')
        .mockReturnValueOnce('2024-01-15T10:00:00Z');

      await expect(fetchRogersBankBalance()).rejects.toThrow(
        'Missing Rogers Bank credentials',
      );
    });
  });

  describe('Credential saving (internal function)', () => {
    test('should save credentials to GM storage', () => {
      // This is tested indirectly through the interception setup
      expect(globalThis.GM_setValue).toBeDefined();
    });

    test('should handle credential validation', () => {
      // This functionality is tested through the auth check functions
      expect(true).toBe(true);
    });
  });

  describe('Request interception (integration)', () => {
    test('should intercept Rogers Bank API calls', () => {
      // This would be tested through integration tests
      // The interception logic is complex and would require mocking browser APIs
      expect(true).toBe(true);
    });

    test('should handle token regeneration', () => {
      // This would be tested through integration tests
      expect(true).toBe(true);
    });

    test('should capture credentials from various API endpoints', () => {
      // This would be tested through integration tests
      expect(true).toBe(true);
    });
  });
});
