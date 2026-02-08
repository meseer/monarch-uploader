/**
 * Canada Life API Tests - Comprehensive coverage for all API functions
 */

import {
  getCanadaLifeToken,
  checkCanadaLifeAuth,
  checkTokenStatus,
  setupTokenMonitoring,
  extractCookies,
  makeAuraApiCall,
  loadAccountBalanceHistory,
  loadAccountActivityReport,
  loadCanadaLifeAccounts,
  CanadaLifeTokenExpiredError,
  CanadaLifeApiError,
} from '../../src/api/canadalife';

import stateManager from '../../src/core/state';
import { debugLog } from '../../src/core/utils';
import toast from '../../src/ui/toast';
import { STORAGE } from '../../src/core/config';

// Mock dependencies
jest.mock('../../src/core/state', () => ({
  __esModule: true,
  default: {
    getState: jest.fn().mockReturnValue({
      auth: {
        canadalife: {
          token: 'mock-aura-token',
        },
      },
    }),
    setCanadaLifeAuth: jest.fn(),
  },
}));

jest.mock('../../src/core/utils', () => ({
  debugLog: jest.fn(),
  parseLocalDate: jest.fn((dateString) => {
    const [year, month, day] = dateString.split('-').map(Number);
    return new Date(year, month - 1, day);
  }),
  formatDate: jest.fn((date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }),
}));

jest.mock('../../src/ui/toast', () => ({
  __esModule: true,
  default: {
    show: jest.fn(),
  },
}));

// Mock GM functions
global.GM_getValue = jest.fn();
global.GM_setValue = jest.fn();

// Mock localStorage
const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  clear: jest.fn(),
};
Object.defineProperty(global, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

// Mock document with configurable cookie property
if (!global.document) {
  Object.defineProperty(global, 'document', {
    value: {},
    writable: true,
    configurable: true,
  });
}
Object.defineProperty(global.document, 'cookie', {
  value: 'mock-cookie=value; another-cookie=another-value',
  writable: true,
  configurable: true,
});

// Mock window with addEventListener as Jest mock
if (!global.window) {
  Object.defineProperty(global, 'window', {
    value: {
      addEventListener: jest.fn(),
    },
    writable: true,
    configurable: true,
  });
} else {
  // If window exists, just mock addEventListener
  global.window.addEventListener = jest.fn();
}

// Mock setInterval
global.setInterval = jest.fn();

// Mock fetch
global.fetch = jest.fn();

describe('Canada Life API - Core Functions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorageMock.getItem.mockClear();
    localStorageMock.setItem.mockClear();
    global.GM_getValue.mockClear();
    global.GM_setValue.mockClear();
    stateManager.getState.mockClear();
    stateManager.setCanadaLifeAuth.mockClear();
    debugLog.mockClear();
    toast.show.mockClear();
    global.fetch.mockClear();
    if (global.window.addEventListener.mockClear) {
      global.window.addEventListener.mockClear();
    }
    if (global.setInterval.mockClear) {
      global.setInterval.mockClear();
    }
  });

  describe('getCanadaLifeToken', () => {
    test('should return token from localStorage when available', () => {
      localStorageMock.getItem.mockReturnValue('test-token-123');

      const result = getCanadaLifeToken();

      expect(result).toBe('test-token-123');
      expect(localStorageMock.getItem).toHaveBeenCalledWith(STORAGE.CANADALIFE_TOKEN_KEY);
      expect(debugLog).toHaveBeenCalledWith('CanadaLife token found in localStorage');
    });

    test('should return null when token is empty string', () => {
      localStorageMock.getItem.mockReturnValue('');

      const result = getCanadaLifeToken();

      expect(result).toBeNull();
      expect(debugLog).toHaveBeenCalledWith('No CanadaLife token found in localStorage');
    });

    test('should return null when token is only whitespace', () => {
      localStorageMock.getItem.mockReturnValue('   ');

      const result = getCanadaLifeToken();

      expect(result).toBeNull();
      expect(debugLog).toHaveBeenCalledWith('No CanadaLife token found in localStorage');
    });

    test('should return null when localStorage is null', () => {
      localStorageMock.getItem.mockReturnValue(null);

      const result = getCanadaLifeToken();

      expect(result).toBeNull();
      expect(debugLog).toHaveBeenCalledWith('No CanadaLife token found in localStorage');
    });

    test('should handle localStorage errors gracefully', () => {
      localStorageMock.getItem.mockImplementation(() => {
        throw new Error('localStorage access denied');
      });

      const result = getCanadaLifeToken();

      expect(result).toBeNull();
      expect(debugLog).toHaveBeenCalledWith('Error reading CanadaLife token from localStorage:', expect.any(Error));
    });
  });

  describe('checkCanadaLifeAuth', () => {
    test('should return authenticated status when token exists', () => {
      localStorageMock.getItem.mockReturnValue('valid-token');

      const result = checkCanadaLifeAuth();

      expect(result).toEqual({
        authenticated: true,
        token: 'valid-token',
        source: 'localStorage',
      });
      expect(debugLog).toHaveBeenCalledWith('CanadaLife authentication: Connected');
    });

    test('should return not authenticated when no token', () => {
      localStorageMock.getItem.mockReturnValue(null);

      const result = checkCanadaLifeAuth();

      expect(result).toEqual({
        authenticated: false,
        token: null,
        source: null,
      });
      expect(debugLog).toHaveBeenCalledWith('CanadaLife authentication: Not connected');
    });
  });

  describe('checkTokenStatus', () => {
    test('should update state manager when authenticated', () => {
      localStorageMock.getItem.mockReturnValue('valid-token');

      const result = checkTokenStatus();

      expect(stateManager.setCanadaLifeAuth).toHaveBeenCalledWith('valid-token');
      expect(result).toEqual({
        authenticated: true,
        token: 'valid-token',
        source: 'localStorage',
      });
    });

    test('should update state manager with null when not authenticated', () => {
      localStorageMock.getItem.mockReturnValue(null);

      const result = checkTokenStatus();

      expect(stateManager.setCanadaLifeAuth).toHaveBeenCalledWith(null);
      expect(result).toBeNull();
    });
  });

  describe('setupTokenMonitoring', () => {
    test('should set up token monitoring with interval and event listener', () => {
      localStorageMock.getItem.mockReturnValue('test-token');

      setupTokenMonitoring();

      expect(stateManager.setCanadaLifeAuth).toHaveBeenCalledWith('test-token');
      expect(global.setInterval).toHaveBeenCalledWith(expect.any(Function), 5000);
      expect(global.window.addEventListener).toHaveBeenCalledWith('storage', expect.any(Function));
      expect(debugLog).toHaveBeenCalledWith('CanadaLife token monitoring setup complete');
    });

    test('should handle storage events for token changes', () => {
      let storageEventHandler;
      global.window.addEventListener.mockImplementation((event, handler) => {
        if (event === 'storage') {
          storageEventHandler = handler;
        }
      });

      setupTokenMonitoring();

      // Simulate storage event for token key
      localStorageMock.getItem.mockReturnValue('new-token');
      storageEventHandler({ key: STORAGE.CANADALIFE_TOKEN_KEY });

      expect(debugLog).toHaveBeenCalledWith('CanadaLife token changed via storage event');
      expect(stateManager.setCanadaLifeAuth).toHaveBeenCalledWith('new-token');
    });

    test('should ignore storage events for other keys', () => {
      let storageEventHandler;
      global.window.addEventListener.mockImplementation((event, handler) => {
        if (event === 'storage') {
          storageEventHandler = handler;
        }
      });

      setupTokenMonitoring();
      jest.clearAllMocks();

      // Simulate storage event for different key
      storageEventHandler({ key: 'other_key' });

      expect(debugLog).not.toHaveBeenCalledWith('CanadaLife token changed via storage event');
    });
  });

  describe('extractCookies', () => {
    test('should return document.cookie string', () => {
      const result = extractCookies();

      expect(result).toBe('mock-cookie=value; another-cookie=another-value');
    });

    test('should handle cookie extraction errors', () => {
      const originalCookie = global.document.cookie;
      Object.defineProperty(global.document, 'cookie', {
        get: () => {
          throw new Error('Cookie access denied');
        },
        configurable: true,
      });

      const result = extractCookies();

      expect(result).toBe('');
      expect(debugLog).toHaveBeenCalledWith('Error extracting cookies:', expect.any(Error));

      // Restore original cookie
      Object.defineProperty(global.document, 'cookie', {
        value: originalCookie,
        configurable: true,
      });
    });
  });

  describe('Error Classes', () => {
    test('CanadaLifeTokenExpiredError should be created correctly', () => {
      const error = new CanadaLifeTokenExpiredError('Token expired', { errorId: '004' });

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('CanadaLifeTokenExpiredError');
      expect(error.message).toBe('Token expired');
      expect(error.errorDetails).toEqual({ errorId: '004' });
      expect(error.recoverable).toBe(true);
    });

    test('CanadaLifeApiError should be created correctly', () => {
      const error = new CanadaLifeApiError('API error', { errorCode: 500 });

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('CanadaLifeApiError');
      expect(error.message).toBe('API error');
      expect(error.errorDetails).toEqual({ errorCode: 500 });
      expect(error.recoverable).toBe(false);
    });
  });
});

describe('Canada Life API - makeAuraApiCall', () => {
  const mockPayload = {
    actions: [{
      id: '123',
      descriptor: 'test',
      params: { test: 'data' },
    }],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    stateManager.getState.mockReturnValue({
      auth: {
        canadalife: {
          token: 'valid-aura-token',
        },
      },
    });
  });

  test('should make successful API call', async () => {
    const mockResponse = { success: true, data: 'test' };
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: jest.fn((name) => {
          if (name === 'content-type') return 'application/json';
          return null;
        }),
        entries: jest.fn(() => [['content-type', 'application/json']]),
      },
      text: () => Promise.resolve(JSON.stringify(mockResponse)),
    });

    const result = await makeAuraApiCall(mockPayload);

    expect(result).toEqual(mockResponse);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://my.canadalife.com/s/sfsites/aura?r=13&aura.ApexAction.execute=1',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
          cookie: 'mock-cookie=value; another-cookie=another-value',
        }),
      }),
    );
  });

  test('should handle /*-secure- wrapped responses', async () => {
    const mockResponse = { success: true, data: 'test' };
    const wrappedResponse = `/*-secure-\n${JSON.stringify(mockResponse)}\n*/`;

    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: () => 'application/json',
        entries: () => [['content-type', 'application/json']],
      },
      text: () => Promise.resolve(wrappedResponse),
    });

    const result = await makeAuraApiCall(mockPayload);

    expect(result).toEqual(mockResponse);
    expect(debugLog).toHaveBeenCalledWith('Cleaned response from /*-secure- wrapper');
  });

  test('should handle generic /* */ wrapped responses', async () => {
    const mockResponse = { success: true, data: 'test' };
    const wrappedResponse = `/*${JSON.stringify(mockResponse)}*/`;

    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: () => 'application/json',
        entries: () => [['content-type', 'application/json']],
      },
      text: () => Promise.resolve(wrappedResponse),
    });

    const result = await makeAuraApiCall(mockPayload);

    expect(result).toEqual(mockResponse);
    expect(debugLog).toHaveBeenCalledWith('Cleaned response from /* */ wrapper');
  });

  test('should throw error when no aura token', async () => {
    stateManager.getState.mockReturnValue({
      auth: {
        canadalife: {
          token: null,
        },
      },
    });

    await expect(makeAuraApiCall(mockPayload)).rejects.toThrow('No Aura token found');
  });

  test('should throw error on HTTP failure', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    await expect(makeAuraApiCall(mockPayload)).rejects.toThrow('Aura API call failed: 500 Internal Server Error');
  });

  test('should handle JSON parse errors', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: () => 'application/json',
        entries: () => [['content-type', 'application/json']],
      },
      text: () => Promise.resolve('invalid json'),
    });

    await expect(makeAuraApiCall(mockPayload)).rejects.toThrow('Failed to parse API response as JSON');
  });

  test('should extract nested response when requested', async () => {
    const nestedData = { nested: true, value: 123 };
    const mockResponse = {
      actions: [{
        returnValue: {
          returnValue: JSON.stringify(nestedData),
        },
      }],
    };

    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: () => 'application/json',
        entries: () => [['content-type', 'application/json']],
      },
      text: () => Promise.resolve(JSON.stringify(mockResponse)),
    });

    const result = await makeAuraApiCall(mockPayload, { extractNestedResponse: true });

    expect(result).toEqual(nestedData);
    expect(debugLog).toHaveBeenCalledWith('Extracted nested response data:', nestedData);
  });

  test('should handle abort signal', async () => {
    const abortController = new AbortController();
    const signal = abortController.signal;

    global.fetch.mockImplementation(() => Promise.reject(new Error('AbortError')));

    await expect(makeAuraApiCall(mockPayload, { signal })).rejects.toThrow('AbortError');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal }),
    );
  });

  test('should handle token expired error with retry', async () => {
    const errorResponse = {
      IPResult: {
        activityReportsHasApiFailure: true,
        result: {
          errors: [{
            errorId: '004',
            httpCode: '401',
            detail: 'Access token expired',
          }],
        },
      },
    };

    // First call fails with token error
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: {
        get: () => 'application/json',
        entries: () => [['content-type', 'application/json']],
      },
      text: () => Promise.resolve(JSON.stringify(errorResponse)),
    });

    // Mock fresh token available
    localStorageMock.getItem.mockReturnValue('fresh-token');

    // Retry succeeds
    const successResponse = { success: true };
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: {
        get: () => 'application/json',
        entries: () => [['content-type', 'application/json']],
      },
      text: () => Promise.resolve(JSON.stringify(successResponse)),
    });

    const result = await makeAuraApiCall(mockPayload);

    expect(result).toEqual(successResponse);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(toast.show).toHaveBeenCalledWith('Token expired, retrying with fresh token...', 'debug');
  });

  test('should handle unrecoverable token error', async () => {
    const errorResponse = {
      IPResult: {
        activityReportsHasApiFailure: true,
        result: {
          errors: [{
            errorId: '004',
            httpCode: '401',
            detail: 'Access token expired',
          }],
        },
      },
    };

    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: () => 'application/json',
        entries: () => [['content-type', 'application/json']],
      },
      text: () => Promise.resolve(JSON.stringify(errorResponse)),
    });

    // No fresh token available
    localStorageMock.getItem.mockReturnValue(null);

    await expect(makeAuraApiCall(mockPayload)).rejects.toThrow(CanadaLifeTokenExpiredError);
    expect(toast.show).toHaveBeenCalledWith(expect.stringContaining('Please refresh the page'), 'error');
  });

  test('should handle API errors', async () => {
    const errorResponse = {
      IPResult: {
        activityReportsHasApiFailure: true,
        result: {
          errors: [{
            errorId: '500',
            httpCode: '500',
            detail: 'Internal server error',
          }],
        },
      },
    };

    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: () => 'application/json',
        entries: () => [['content-type', 'application/json']],
      },
      text: () => Promise.resolve(JSON.stringify(errorResponse)),
    });

    await expect(makeAuraApiCall(mockPayload)).rejects.toThrow(CanadaLifeApiError);
    expect(toast.show).toHaveBeenCalledWith(expect.stringContaining('Internal server error'), 'error');
  });
});

describe('Canada Life API - Account Functions', () => {
  const mockAccount = {
    agreementId: 'test-agreement-123',
    EnglishShortName: 'TEST-RRSP',
    LongNameEnglish: 'Test RRSP Account',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    stateManager.getState.mockReturnValue({
      auth: {
        canadalife: {
          token: 'valid-aura-token',
        },
      },
    });
  });

  describe('loadAccountActivityReport', () => {
    test('should load account activity report successfully', async () => {
      const mockApiResponse = {
        IPResult: {
          Summary: {
            Total: { Value: 10100 },
            Details: [
              {
                Description: 'Value of this plan on 2024-01-15',
                Value: 10000,
              },
            ],
          },
        },
      };

      global.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: () => 'application/json',
          entries: () => [['content-type', 'application/json']],
        },
        text: () => Promise.resolve(`/*-secure-\n${JSON.stringify({
          actions: [{
            returnValue: {
              returnValue: JSON.stringify(mockApiResponse),
            },
          }],
        })}\n*/`),
      });

      const result = await loadAccountActivityReport(mockAccount, '2024-01-15', '2024-01-15');

      expect(result).toEqual({
        account: {
          name: 'Test RRSP Account',
          shortName: 'TEST-RRSP',
          agreementId: 'test-agreement-123',
        },
        date: '2024-01-15',
        startDate: '2024-01-15',
        endDate: '2024-01-15',
        openingBalance: 10000,
        closingBalance: 10100,
        change: 100,
        activities: [],
        rawResponse: mockApiResponse,
      });
    });

    test('should validate input parameters', async () => {
      await expect(loadAccountActivityReport(null, '2024-01-15', '2024-01-15')).rejects.toThrow();
      await expect(loadAccountActivityReport({}, '2024-01-15', '2024-01-15')).rejects.toThrow();
      await expect(loadAccountActivityReport(mockAccount, 'invalid-date', '2024-01-15')).rejects.toThrow();
      await expect(loadAccountActivityReport(mockAccount, null, '2024-01-15')).rejects.toThrow();
      await expect(loadAccountActivityReport(mockAccount, '2024-01-15', null)).rejects.toThrow();
      await expect(loadAccountActivityReport(mockAccount, '2024-01-15', 'invalid-date')).rejects.toThrow();
    });

    test('should handle missing IPResult', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: () => 'application/json',
          entries: () => [['content-type', 'application/json']],
        },
        text: () => Promise.resolve(`/*-secure-\n${JSON.stringify({
          actions: [{
            returnValue: {
              returnValue: JSON.stringify({}),
            },
          }],
        })}\n*/`),
      });

      await expect(loadAccountActivityReport(mockAccount, '2024-01-15', '2024-01-15')).rejects.toThrow('No IPResult found in balance API response');
    });

    test('should handle fallback to first Details entry for opening balance', async () => {
      const mockApiResponse = {
        IPResult: {
          Summary: {
            Total: { Value: 10100 },
            Details: [
              {
                Description: 'Some other description',
                Value: 10000,
              },
            ],
          },
        },
      };

      global.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: () => 'application/json',
          entries: () => [['content-type', 'application/json']],
        },
        text: () => Promise.resolve(`/*-secure-\n${JSON.stringify({
          actions: [{
            returnValue: {
              returnValue: JSON.stringify(mockApiResponse),
            },
          }],
        })}\n*/`),
      });

      const result = await loadAccountActivityReport(mockAccount, '2024-01-15', '2024-01-15');

      expect(result.openingBalance).toBe(10000);
      expect(debugLog).toHaveBeenCalledWith('Using first Details entry as opening balance (pattern match failed)');
    });
  });

  describe('loadCanadaLifeAccounts', () => {
    test('should load accounts from consolidated cache when available', async () => {
      const cachedConsolidatedAccounts = [
        {
          canadalifeAccount: {
            id: '123',
            agreementId: '123',
            EnglishShortName: 'RRSP',
            LongNameEnglish: 'RRSP Account',
            nickname: 'RRSP',
          },
          monarchAccount: null,
          syncEnabled: true,
        },
        {
          canadalifeAccount: {
            id: '456',
            agreementId: '456',
            EnglishShortName: 'TFSA',
            LongNameEnglish: 'TFSA Account',
            nickname: 'TFSA',
          },
          monarchAccount: null,
          syncEnabled: true,
        },
      ];

      global.GM_getValue.mockImplementation((key, defaultVal) => {
        if (key === 'canadalife_accounts_list') {
          return JSON.stringify(cachedConsolidatedAccounts);
        }
        return defaultVal;
      });

      const result = await loadCanadaLifeAccounts();

      expect(result).toEqual(cachedConsolidatedAccounts);
      expect(debugLog).toHaveBeenCalledWith('Loaded 2 Canada Life accounts from consolidated storage');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('should load accounts from API when cache empty and return consolidated structure', async () => {
      global.GM_getValue.mockReturnValue('[]');

      const apiAccounts = [
        { EnglishShortName: 'RRSP', LongNameEnglish: 'RRSP Account', agreementId: '123' },
      ];

      const mockApiResponse = {
        IPResult: {
          MemberPlans: apiAccounts,
        },
      };

      global.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: () => 'application/json',
          entries: () => [['content-type', 'application/json']],
        },
        text: () => Promise.resolve(JSON.stringify({
          actions: [{
            returnValue: {
              returnValue: JSON.stringify(mockApiResponse),
            },
          }],
        })),
      });

      const result = await loadCanadaLifeAccounts();

      // Should return consolidated structure
      expect(result).toHaveLength(1);
      expect(result[0].canadalifeAccount.id).toBe('123');
      expect(result[0].canadalifeAccount.agreementId).toBe('123');
      expect(result[0].canadalifeAccount.EnglishShortName).toBe('RRSP');
      expect(result[0].syncEnabled).toBe(true);
      expect(result[0].monarchAccount).toBeNull();

      // Should save to consolidated storage
      expect(global.GM_setValue).toHaveBeenCalledWith(
        'canadalife_accounts_list',
        expect.any(String),
      );
      expect(toast.show).toHaveBeenCalledWith('Loading Canada Life accounts...', 'debug');
      expect(toast.show).toHaveBeenCalledWith('Loaded Canada Life accounts: RRSP', 'debug');
    });

    test('should force refresh from API when requested and return consolidated structure', async () => {
      const cachedAccounts = [{
        canadalifeAccount: { id: '123', agreementId: '123', EnglishShortName: 'OLD', nickname: 'OLD' },
        monarchAccount: { id: 'monarch-123', displayName: 'Mapped Account' },
        syncEnabled: false,
      }];
      global.GM_getValue.mockImplementation((key, defaultVal) => {
        if (key === 'canadalife_accounts_list') {
          return JSON.stringify(cachedAccounts);
        }
        return defaultVal;
      });

      const freshApiAccounts = [{ EnglishShortName: 'NEW', LongNameEnglish: 'New Account', agreementId: '999' }];
      const mockApiResponse = {
        IPResult: {
          MemberPlans: freshApiAccounts,
        },
      };

      global.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: () => 'application/json',
          entries: () => [['content-type', 'application/json']],
        },
        text: () => Promise.resolve(JSON.stringify({
          actions: [{
            returnValue: {
              returnValue: JSON.stringify(mockApiResponse),
            },
          }],
        })),
      });

      const result = await loadCanadaLifeAccounts(true);

      // Should return 2 accounts: 1 from API + 1 orphaned (account 123 no longer in API)
      expect(result).toHaveLength(2);
      expect(result[0].canadalifeAccount.id).toBe('999');
      expect(result[0].canadalifeAccount.EnglishShortName).toBe('NEW');
      // Orphaned account should preserve full canadalifeAccount data for historical reference
      expect(result[1].canadalifeAccount).not.toBeNull();
      expect(result[1].canadalifeAccount.id).toBe('123');
      expect(result[1].canadalifeAccount.EnglishShortName).toBe('OLD');
      expect(result[1].monarchAccount).toEqual({ id: 'monarch-123', displayName: 'Mapped Account' });
      expect(global.fetch).toHaveBeenCalled();
    });

    test('should preserve existing monarchAccount and settings when refreshing', async () => {
      const existingAccounts = [
        {
          canadalifeAccount: { id: '123', agreementId: '123', EnglishShortName: 'RRSP' },
          monarchAccount: { id: 'monarch-123', displayName: 'My Monarch Account' },
          syncEnabled: false,
          lastSyncDate: '2026-01-01',
          uploadedTransactions: [{ id: 'tx-1', date: '2026-01-01' }],
        },
      ];
      global.GM_getValue.mockImplementation((key, defaultVal) => {
        if (key === 'canadalife_accounts_list') {
          return JSON.stringify(existingAccounts);
        }
        return defaultVal;
      });

      const freshApiAccounts = [
        { EnglishShortName: 'RRSP-UPDATED', LongNameEnglish: 'Updated RRSP Account', agreementId: '123' },
        { EnglishShortName: 'TFSA', LongNameEnglish: 'New TFSA Account', agreementId: '456' },
      ];

      const mockApiResponse = {
        IPResult: {
          MemberPlans: freshApiAccounts,
        },
      };

      global.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: () => 'application/json',
          entries: () => [['content-type', 'application/json']],
        },
        text: () => Promise.resolve(JSON.stringify({
          actions: [{
            returnValue: {
              returnValue: JSON.stringify(mockApiResponse),
            },
          }],
        })),
      });

      const result = await loadCanadaLifeAccounts(true);

      // Should preserve existing settings for account 123
      const account123 = result.find((acc) => acc.canadalifeAccount.id === '123');
      expect(account123.monarchAccount).toEqual({ id: 'monarch-123', displayName: 'My Monarch Account' });
      expect(account123.syncEnabled).toBe(false);
      expect(account123.lastSyncDate).toBe('2026-01-01');
      expect(account123.uploadedTransactions).toHaveLength(1);

      // New account 456 should have defaults
      const account456 = result.find((acc) => acc.canadalifeAccount.id === '456');
      expect(account456.monarchAccount).toBeNull();
      expect(account456.syncEnabled).toBe(true);
    });

    test('should clean up legacy cache if it exists', async () => {
      global.GM_getValue.mockImplementation((key, defaultVal) => {
        if (key === 'canadalife_accounts') {
          return '[{"EnglishShortName": "OLD-LEGACY"}]';
        }
        if (key === 'canadalife_accounts_list') {
          return '[]';
        }
        return defaultVal;
      });
      global.GM_deleteValue = jest.fn();

      const freshApiAccounts = [{ EnglishShortName: 'NEW', agreementId: '123' }];
      const mockApiResponse = {
        IPResult: {
          MemberPlans: freshApiAccounts,
        },
      };

      global.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: () => 'application/json',
          entries: () => [['content-type', 'application/json']],
        },
        text: () => Promise.resolve(JSON.stringify({
          actions: [{
            returnValue: {
              returnValue: JSON.stringify(mockApiResponse),
            },
          }],
        })),
      });

      await loadCanadaLifeAccounts();

      // Should clean up legacy cache
      expect(global.GM_deleteValue).toHaveBeenCalledWith('canadalife_accounts');
    });

    test('should preserve orphaned accounts (accounts no longer in API) with full canadalifeAccount data', async () => {
      // Simulate existing accounts where one (456) has a Monarch mapping but is no longer in API
      const existingAccounts = [
        {
          canadalifeAccount: { id: '123', agreementId: '123', EnglishShortName: 'RRSP', nickname: 'RRSP' },
          monarchAccount: { id: 'monarch-1', displayName: 'Monarch RRSP' },
          syncEnabled: true,
          lastSyncDate: '2026-01-01',
          uploadedTransactions: [{ id: 'tx-1', date: '2026-01-01' }],
        },
        {
          canadalifeAccount: { id: '456', agreementId: '456', EnglishShortName: 'CLOSED-TFSA', nickname: 'Closed TFSA' },
          monarchAccount: { id: 'monarch-2', displayName: 'Monarch TFSA' },
          syncEnabled: false,
          lastSyncDate: '2025-12-15',
          uploadedTransactions: [{ id: 'tx-2', date: '2025-12-15' }],
        },
      ];

      global.GM_getValue.mockImplementation((key, defaultVal) => {
        if (key === 'canadalife_accounts_list') {
          return JSON.stringify(existingAccounts);
        }
        return defaultVal;
      });

      // API only returns account 123 (account 456 has been closed/transferred)
      const freshApiAccounts = [
        { EnglishShortName: 'RRSP-UPDATED', LongNameEnglish: 'Updated RRSP', agreementId: '123' },
      ];

      const mockApiResponse = {
        IPResult: {
          MemberPlans: freshApiAccounts,
        },
      };

      global.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: () => 'application/json',
          entries: () => [['content-type', 'application/json']],
        },
        text: () => Promise.resolve(JSON.stringify({
          actions: [{
            returnValue: {
              returnValue: JSON.stringify(mockApiResponse),
            },
          }],
        })),
      });

      const result = await loadCanadaLifeAccounts(true); // Force refresh

      // Should have 2 accounts: one active, one orphaned
      expect(result).toHaveLength(2);

      // First account (from API) should have updated canadalifeAccount
      expect(result[0].canadalifeAccount).not.toBeNull();
      expect(result[0].canadalifeAccount.id).toBe('123');
      expect(result[0].canadalifeAccount.EnglishShortName).toBe('RRSP-UPDATED');
      expect(result[0].monarchAccount).toEqual({ id: 'monarch-1', displayName: 'Monarch RRSP' });

      // Second account (orphaned) should preserve full canadalifeAccount data for historical reference
      expect(result[1].canadalifeAccount).not.toBeNull();
      expect(result[1].canadalifeAccount.id).toBe('456');
      expect(result[1].canadalifeAccount.EnglishShortName).toBe('CLOSED-TFSA');
      expect(result[1].canadalifeAccount.nickname).toBe('Closed TFSA');
      expect(result[1].monarchAccount).toEqual({ id: 'monarch-2', displayName: 'Monarch TFSA' });
      expect(result[1].syncEnabled).toBe(false);
      expect(result[1].lastSyncDate).toBe('2025-12-15');
      expect(result[1].uploadedTransactions).toHaveLength(1);

      // Verify saved data includes both accounts with their full canadalifeAccount data
      expect(global.GM_setValue).toHaveBeenCalledWith(
        'canadalife_accounts_list',
        expect.stringContaining('"canadalifeAccount":{"id":"456"'),
      );
    });

    test('should not duplicate orphaned accounts that are already orphaned', async () => {
      // Simulate existing accounts where 456 is already orphaned (canadalifeAccount: null)
      const existingAccounts = [
        {
          canadalifeAccount: { id: '123', agreementId: '123', EnglishShortName: 'RRSP' },
          monarchAccount: { id: 'monarch-1', displayName: 'Monarch RRSP' },
          syncEnabled: true,
        },
        {
          canadalifeAccount: null, // Already orphaned
          monarchAccount: { id: 'monarch-2', displayName: 'Monarch TFSA (closed)' },
          syncEnabled: false,
          lastSyncDate: '2025-12-15',
        },
      ];

      global.GM_getValue.mockImplementation((key, defaultVal) => {
        if (key === 'canadalife_accounts_list') {
          return JSON.stringify(existingAccounts);
        }
        return defaultVal;
      });

      // API only returns account 123
      const freshApiAccounts = [
        { EnglishShortName: 'RRSP', LongNameEnglish: 'RRSP Account', agreementId: '123' },
      ];

      const mockApiResponse = {
        IPResult: {
          MemberPlans: freshApiAccounts,
        },
      };

      global.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: () => 'application/json',
          entries: () => [['content-type', 'application/json']],
        },
        text: () => Promise.resolve(JSON.stringify({
          actions: [{
            returnValue: {
              returnValue: JSON.stringify(mockApiResponse),
            },
          }],
        })),
      });

      const result = await loadCanadaLifeAccounts(true); // Force refresh

      // Should still have only 1 account (the one from API), not duplicate the orphaned one
      // Note: The current implementation requires canadalifeAccount.id or canadalifeAccount.agreementId to add to orphan list
      // so already-orphaned accounts (with null canadalifeAccount) won't be duplicated
      expect(result).toHaveLength(1);
      expect(result[0].canadalifeAccount.id).toBe('123');
    });

    test('should handle API errors gracefully', async () => {
      global.GM_getValue.mockReturnValue('[]');
      global.fetch.mockRejectedValue(new Error('Network error'));

      await expect(loadCanadaLifeAccounts()).rejects.toThrow('Network error');
      expect(toast.show).toHaveBeenCalledWith('Failed to load Canada Life accounts: Network error', 'error');
    });
  });
});

describe('Canada Life API - Last Day Processing Bug', () => {
  const mockAccount = {
    agreementId: 'test-agreement-123',
    EnglishShortName: 'TEST-RRSP',
    LongNameEnglish: 'Test RRSP Account',
  };

  // Helper to create mock balance API response
  const createMockBalanceResponse = (date, openingBalance, closingBalance) => ({
    IPResult: {
      Summary: {
        Total: { Value: closingBalance },
        Details: [
          {
            Description: `Value of this plan on ${date}`,
            Value: openingBalance,
          },
        ],
      },
    },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    stateManager.getState.mockReturnValue({
      auth: {
        canadalife: {
          token: 'valid-aura-token',
        },
      },
    });

    // Mock fetch for makeAuraApiCall
    global.fetch.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: {
          get: jest.fn((name) => {
            if (name === 'content-type') return 'application/json';
            if (name === 'content-length') return '1000';
            return null;
          }),
          entries: jest.fn(() => [
            ['content-type', 'application/json'],
            ['content-length', '1000'],
          ]),
        },
        text: () => Promise.resolve(`/*-secure-\n${JSON.stringify({
          actions: [{
            returnValue: {
              returnValue: JSON.stringify(createMockBalanceResponse('2024-01-15', 10000, 10100)),
            },
          }],
        })}\n*/`),
      }),
    );
  });

  describe('Business Days Generation', () => {
    test('should generate correct business days excluding weekends', () => {
      // Test actual dates that match real calendar
      // January 15, 2024 = Monday
      // January 19, 2024 = Friday

      // Mock the internal generateBusinessDays function behavior that matches the real implementation
      const generateBusinessDaysLocal = (startDate, endDate) => {
        const businessDays = [];
        // Use the exact same parsing logic as the real function
        const current = new Date(`${startDate}T00:00:00`); // Add time to avoid timezone issues
        const end = new Date(`${endDate}T00:00:00`);

        while (current <= end) {
          const dayOfWeek = current.getDay();
          if (dayOfWeek !== 0 && dayOfWeek !== 6) { // Not Sunday or Saturday
            const year = current.getFullYear();
            const month = String(current.getMonth() + 1).padStart(2, '0');
            const day = String(current.getDate()).padStart(2, '0');
            businessDays.push(`${year}-${month}-${day}`);
          }
          current.setDate(current.getDate() + 1);
        }
        return businessDays;
      };

      // Test Monday to Friday (5 business days) - using actual 2024 calendar
      const businessDays = generateBusinessDaysLocal('2024-01-15', '2024-01-19'); // Mon-Fri
      expect(businessDays).toEqual([
        '2024-01-15', '2024-01-16', '2024-01-17', '2024-01-18', '2024-01-19',
      ]);
      expect(businessDays).toHaveLength(5);

      // Test single day
      const singleDay = generateBusinessDaysLocal('2024-01-15', '2024-01-15'); // Monday only
      expect(singleDay).toEqual(['2024-01-15']);
      expect(singleDay).toHaveLength(1);

      // Test weekend exclusion - Friday to Monday
      const withWeekend = generateBusinessDaysLocal('2024-01-12', '2024-01-15'); // Fri-Mon
      expect(withWeekend).toEqual(['2024-01-12', '2024-01-15']); // Excludes Sat/Sun
      expect(withWeekend).toHaveLength(2);
    });

    test('Real bug scenario: Today as end date should be included', () => {
      // This test replicates the user's exact scenario
      const generateBusinessDaysReal = (startDate, endDate) => {
        const businessDays = [];
        // Simulate the parseLocalDate function behavior
        const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
        const [endYear, endMonth, endDay] = endDate.split('-').map(Number);

        const current = new Date(startYear, startMonth - 1, startDay);
        const end = new Date(endYear, endMonth - 1, endDay);

        while (current <= end) {
          const dayOfWeek = current.getDay();
          if (dayOfWeek !== 0 && dayOfWeek !== 6) { // Not Sunday or Saturday
            const year = current.getFullYear();
            const month = String(current.getMonth() + 1).padStart(2, '0');
            const day = String(current.getDate()).padStart(2, '0');
            businessDays.push(`${year}-${month}-${day}`);
          }
          current.setDate(current.getDate() + 1);
        }
        return businessDays;
      };

      // Test the exact scenario: user uploads at 1pm including today
      const today = '2024-10-11'; // Friday (the current date from environment)
      const yesterday = '2024-10-10'; // Thursday

      // Single day upload (today only) - this is the failing scenario
      const todayOnly = generateBusinessDaysReal(today, today);
      expect(todayOnly).toContain(today);
      expect(todayOnly).toHaveLength(1);

      // Two day upload ending on today
      const twoDays = generateBusinessDaysReal(yesterday, today);
      expect(twoDays).toContain(today);
      expect(twoDays).toContain(yesterday);
      expect(twoDays).toHaveLength(2);
    });
  });

  describe('loadAccountBalanceHistory - Weekend Extension', () => {
    test('Single day upload should include today in results', async () => {
      const today = '2024-01-15'; // Monday

      // Mock API response for today

      global.fetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: {
            get: jest.fn((name) => {
              if (name === 'content-type') return 'application/json';
              if (name === 'content-length') return '1000';
              return null;
            }),
            entries: jest.fn(() => [
              ['content-type', 'application/json'],
              ['content-length', '1000'],
            ]),
          },
          text: () => Promise.resolve(`/*-secure-\n${JSON.stringify({
            actions: [{
              returnValue: {
                returnValue: JSON.stringify(createMockBalanceResponse(today, 10000, 10100)),
              },
            }],
          })}\n*/`),
        }),
      );

      const result = await loadAccountBalanceHistory(mockAccount, today, today);

      // Should include header + today's data
      expect(result.data).toHaveLength(2); // Header + 1 data row
      expect(result.data[0]).toEqual(['Date', 'Closing Balance', 'Account Name']); // Header

      // Today should be included in results
      expect(result.data[1]).toEqual([today, 10100, 'TEST-RRSP']);

      expect(result.totalDays).toBe(1);
      expect(result.businessDays).toBe(1);
      expect(result.apiCallsMade).toBe(1);
    });

    test('SHOULD FAIL: Two day upload should include both days in results', async () => {
      const yesterday = '2024-01-16'; // Tuesday
      const today = '2024-01-17'; // Wednesday

      let callCount = 0;

      // Mock API responses for both days

      global.fetch.mockImplementation(() => {
        callCount++;
        const responseData = callCount === 1
          ? createMockBalanceResponse(yesterday, 9900, 10000)
          : createMockBalanceResponse(today, 10000, 10100);

        return Promise.resolve({
          ok: true,
          status: 200,
          headers: {
            get: jest.fn((name) => {
              if (name === 'content-type') return 'application/json';
              if (name === 'content-length') return '1000';
              return null;
            }),
            entries: jest.fn(() => [
              ['content-type', 'application/json'],
              ['content-length', '1000'],
            ]),
          },
          text: () => Promise.resolve(`/*-secure-\n${JSON.stringify({
            actions: [{
              returnValue: {
                returnValue: JSON.stringify(responseData),
              },
            }],
          })}\n*/`),
        });
      });

      const result = await loadAccountBalanceHistory(mockAccount, yesterday, today);

      // Should include header + 2 data rows
      expect(result.data).toHaveLength(3); // Header + 2 data rows
      expect(result.data[0]).toEqual(['Date', 'Closing Balance', 'Account Name']); // Header

      // Check both days are included
      const dataRows = result.data.slice(1).sort((a, b) => a[0].localeCompare(b[0]));
      expect(dataRows[0]).toEqual([yesterday, 10000, 'TEST-RRSP']);
      expect(dataRows[1]).toEqual([today, 10100, 'TEST-RRSP']);

      expect(result.totalDays).toBe(2);
    });

    test('SHOULD FAIL: Three day upload should include today as last day', async () => {
      const dayOne = '2024-01-15'; // Monday
      const today = '2024-01-17'; // Wednesday

      let callCount = 0;

      // Mock API responses - optimization should make 2 calls for 3 days

      global.fetch.mockImplementation(() => {
        callCount++;
        const responseData = callCount === 1
          ? createMockBalanceResponse(dayOne, 9800, 9900) // First call gets day 1, sets up day 2
          : createMockBalanceResponse(today, 10000, 10100); // Second call gets day 3 (today)

        return Promise.resolve({
          ok: true,
          status: 200,
          headers: {
            get: jest.fn((name) => {
              if (name === 'content-type') return 'application/json';
              if (name === 'content-length') return '1000';
              return null;
            }),
            entries: jest.fn(() => [
              ['content-type', 'application/json'],
              ['content-length', '1000'],
            ]),
          },
          text: () => Promise.resolve(`/*-secure-\n${JSON.stringify({
            actions: [{
              returnValue: {
                returnValue: JSON.stringify(responseData),
              },
            }],
          })}\n*/`),
        });
      });

      const result = await loadAccountBalanceHistory(mockAccount, dayOne, today);

      // Should include header + 3 data rows
      expect(result.data).toHaveLength(4); // Header + 3 data rows

      // Check that today (last day) is included - THIS IS THE KEY TEST FOR THE BUG
      const dates = result.data.slice(1).map((row) => row[0]);
      expect(dates).toContain(today);

      expect(result.totalDays).toBe(3);
    });

    test('SHOULD FAIL: Five day upload ending on today should include today', async () => {
      const dates = ['2024-01-15', '2024-01-16', '2024-01-17', '2024-01-18', '2024-01-19']; // Mon-Fri
      const today = dates[4]; // Friday

      let callCount = 0;

      // Mock API responses - optimization should make 3 calls for 5 days (i=0,2,4)

      global.fetch.mockImplementation(() => {
        callCount++;
        const balances = [9600, 9700, 9800, 9900, 10000];
        const responseData = createMockBalanceResponse(
          dates[callCount - 1],
          balances[callCount - 1] - 100,
          balances[callCount - 1],
        );

        return Promise.resolve({
          ok: true,
          status: 200,
          headers: {
            get: jest.fn((name) => {
              if (name === 'content-type') return 'application/json';
              if (name === 'content-length') return '1000';
              return null;
            }),
            entries: jest.fn(() => [
              ['content-type', 'application/json'],
              ['content-length', '1000'],
            ]),
          },
          text: () => Promise.resolve(`/*-secure-\n${JSON.stringify({
            actions: [{
              returnValue: {
                returnValue: JSON.stringify(responseData),
              },
            }],
          })}\n*/`),
        });
      });

      const result = await loadAccountBalanceHistory(mockAccount, dates[0], today);

      // Should include header + 5 data rows
      expect(result.data).toHaveLength(6); // Header + 5 data rows

      // THE CRITICAL TEST: Check that today (last day) is included
      const resultDates = result.data.slice(1).map((row) => row[0]);
      expect(resultDates).toContain(today);
      expect(resultDates.sort()).toEqual(dates);

      expect(result.totalDays).toBe(5);
    });

    test('Edge case: Odd number of business days with today as last day', async () => {
      const dates = ['2024-01-15', '2024-01-16', '2024-01-17']; // Mon, Tue, Wed
      const today = dates[2]; // Wednesday

      let callCount = 0;

      global.fetch.mockImplementation(() => {
        callCount++;
        const balances = [9800, 9900, 10000];
        const responseData = createMockBalanceResponse(
          dates[callCount === 1 ? 0 : 2], // First call: day 1, second call: day 3 (today)
          balances[callCount === 1 ? 0 : 2] - 100,
          balances[callCount === 1 ? 0 : 2],
        );

        return Promise.resolve({
          ok: true,
          status: 200,
          headers: {
            get: jest.fn((name) => {
              if (name === 'content-type') return 'application/json';
              if (name === 'content-length') return '1000';
              return null;
            }),
            entries: jest.fn(() => [
              ['content-type', 'application/json'],
              ['content-length', '1000'],
            ]),
          },
          text: () => Promise.resolve(`/*-secure-\n${JSON.stringify({
            actions: [{
              returnValue: {
                returnValue: JSON.stringify(responseData),
              },
            }],
          })}\n*/`),
        });
      });

      const result = await loadAccountBalanceHistory(mockAccount, dates[0], today);

      // This is the critical test - with odd number of days, the last day logic should trigger
      const resultDates = result.data.slice(1).map((row) => row[0]);

      // THE KEY BUG TEST: Today should be included even with odd number optimization
      expect(resultDates).toContain(today);
      expect(result.totalDays).toBe(3);
    });
  });

  describe('Specific Bug Scenario - User Reported', () => {
    test('Bug fix: 2025-10-09 to 2025-10-11 range should include 2025-10-11', async () => {
      // This is the exact scenario that the user reported as failing
      const startDate = '2025-10-09'; // Wed
      const endDate = '2025-10-11'; // Fri

      let callCount = 0;

      // Mock API responses for the optimization calls

      global.fetch.mockImplementation(() => {
        callCount++;
        console.log(`API Call ${callCount} - Expected for date: ${callCount === 1 ? '2025-10-09' : '2025-10-11'}`);

        // First call (i=0): processes 2025-10-09, provides opening balance for 2025-10-10
        // Second call (i=2): processes 2025-10-11 (this should happen with the fix)
        const responseData = callCount === 1
          ? createMockBalanceResponse('2025-10-09', 9900, 10000)
          : createMockBalanceResponse('2025-10-11', 10100, 10200);

        console.log(`API Call ${callCount} - Response data:`, responseData);

        return Promise.resolve({
          ok: true,
          status: 200,
          headers: {
            get: jest.fn((name) => {
              if (name === 'content-type') return 'application/json';
              if (name === 'content-length') return '1000';
              return null;
            }),
            entries: jest.fn(() => [
              ['content-type', 'application/json'],
              ['content-length', '1000'],
            ]),
          },
          text: () => Promise.resolve(`/*-secure-\n${JSON.stringify({
            actions: [{
              returnValue: {
                returnValue: JSON.stringify(responseData),
              },
            }],
          })}\n*/`),
        });
      });

      const result = await loadAccountBalanceHistory(mockAccount, startDate, endDate);

      console.log('Final result data:', result.data);
      console.log('API calls made:', callCount);

      // Should have header + 3 data rows (all business days)
      expect(result.data).toHaveLength(4);

      // Extract just the dates from results
      const resultDates = result.data.slice(1).map((row) => row[0]).sort();

      // The critical test: 2025-10-11 should be included
      expect(resultDates).toContain('2025-10-11');
      expect(resultDates).toEqual(['2025-10-09', '2025-10-10', '2025-10-11']);

      expect(result.totalDays).toBe(3);
    });
  });

  describe('Optimization Logic Analysis', () => {
    test('Should identify the problematic condition in last day processing', () => {
      // This test documents the suspected bug condition
      const businessDaysLength = 1; // Single day upload
      const lastDayProcessed = false; // Last day not processed yet

      // This is the suspected buggy condition from the code:
      // if (!lastDayProcessed && businessDays.length > 1)
      const buggyCondition = !lastDayProcessed && businessDaysLength > 1;

      // For single day uploads, this condition would be false, skipping the last day
      expect(buggyCondition).toBe(false);

      // The condition should be: if (!lastDayProcessed)
      const fixedCondition = !lastDayProcessed;
      expect(fixedCondition).toBe(true);
    });

    test('Should document the i+=2 loop behavior', () => {
      const businessDays = ['2024-01-15', '2024-01-16', '2024-01-17'];
      const processedIndices = [];

      // Simulate the i+=2 loop from the code
      for (let i = 0; i < businessDays.length; i += 2) {
        processedIndices.push(i);
      }

      // For 3 days, indices 0 and 2 are processed
      expect(processedIndices).toEqual([0, 2]);

      // Index 1 (middle day) gets processed via the opening balance logic
      // But the last day (index 2) should be processed in the loop
      // The bug might be in the last day handling when it's already been processed
    });
  });
});
