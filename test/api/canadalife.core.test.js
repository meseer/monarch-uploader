/**
 * Canada Life API Tests - Comprehensive coverage for all API functions
 */

import {
  getCanadaLifeToken,
  checkCanadaLifeAuth,
  checkTokenStatus,
  setupTokenMonitoring,
  extractCookies,
  getAuraContext,
  getSponsorInfo,
  clearSponsorInfoCache,
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

// Mock crypto.randomUUID
global.crypto = {
  ...global.crypto,
  randomUUID: jest.fn().mockReturnValue('mock-uuid-1234-5678-abcd-efghijklmnop'),
};

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

// Helper: builds a mock fetch response for getSponsorInfo API
function buildSponsorInfoFetchResponse(adminSystemId = 'ENC_TEST_ADMIN_SYSTEM_ID') {
  const sponsorInfoResult = {
    getSponsorInfo: {
      attributes: { type: 'User_Sponsor_Session__c' },
      GRS_ParticId__c: adminSystemId,
      User_Sponsor_Name__c: 'TEST SPONSOR',
      SponsorId__c: 'ENC_TestSponsor',
    },
    error: 'OK',
  };
  return {
    ok: true,
    status: 200,
    headers: {
      get: () => 'application/json',
      entries: () => [['content-type', 'application/json']],
    },
    text: () => Promise.resolve(JSON.stringify({
      actions: [{
        returnValue: {
          returnValue: JSON.stringify(sponsorInfoResult),
        },
      }],
    })),
  };
}

describe('Canada Life API - getSponsorInfo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearSponsorInfoCache();
    stateManager.getState.mockReturnValue({
      auth: { canadalife: { token: 'valid-aura-token' } },
    });
  });

  test('should fetch sponsor info and return adminSystemId', async () => {
    global.fetch.mockResolvedValueOnce(buildSponsorInfoFetchResponse('ENC_MY_ADMIN_ID'));

    const result = await getSponsorInfo();

    expect(result.adminSystemId).toBe('ENC_MY_ADMIN_ID');
    expect(result.sponsorName).toBe('TEST SPONSOR');
    expect(result.sponsorId).toBe('ENC_TestSponsor');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('should cache result and not call API again', async () => {
    global.fetch.mockResolvedValueOnce(buildSponsorInfoFetchResponse('ENC_CACHED'));

    const result1 = await getSponsorInfo();
    const result2 = await getSponsorInfo();

    expect(result1.adminSystemId).toBe('ENC_CACHED');
    expect(result2.adminSystemId).toBe('ENC_CACHED');
    expect(global.fetch).toHaveBeenCalledTimes(1); // Only one API call
    expect(debugLog).toHaveBeenCalledWith('Using cached sponsor info', expect.any(Object));
  });

  test('should throw CanadaLifeApiError when GRS_ParticId__c is missing', async () => {
    const badResponse = {
      getSponsorInfo: {
        attributes: { type: 'User_Sponsor_Session__c' },
        // No GRS_ParticId__c
        User_Sponsor_Name__c: 'TEST',
      },
      error: 'OK',
    };
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: {
        get: () => 'application/json',
        entries: () => [['content-type', 'application/json']],
      },
      text: () => Promise.resolve(JSON.stringify({
        actions: [{
          returnValue: {
            returnValue: JSON.stringify(badResponse),
          },
        }],
      })),
    });

    await expect(getSponsorInfo()).rejects.toThrow(CanadaLifeApiError);
  });

  test('should throw when getSponsorInfo key is missing from response', async () => {
    const noSponsorResponse = { someOtherData: true, error: 'OK' };
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: {
        get: () => 'application/json',
        entries: () => [['content-type', 'application/json']],
      },
      text: () => Promise.resolve(JSON.stringify({
        actions: [{
          returnValue: {
            returnValue: JSON.stringify(noSponsorResponse),
          },
        }],
      })),
    });

    await expect(getSponsorInfo()).rejects.toThrow(CanadaLifeApiError);
  });

  test('clearSponsorInfoCache should allow fresh fetch', async () => {
    global.fetch.mockResolvedValueOnce(buildSponsorInfoFetchResponse('ENC_FIRST'));
    await getSponsorInfo();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    clearSponsorInfoCache();

    global.fetch.mockResolvedValueOnce(buildSponsorInfoFetchResponse('ENC_SECOND'));
    const result = await getSponsorInfo();
    expect(result.adminSystemId).toBe('ENC_SECOND');
    expect(global.fetch).toHaveBeenCalledTimes(2);
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
    clearSponsorInfoCache();
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

    // Helper to build a member plans fetch response
    function buildMemberPlansFetchResponse(apiAccounts) {
      const mockApiResponse = { IPResult: { MemberPlans: apiAccounts } };
      return {
        ok: true,
        status: 200,
        headers: {
          get: () => 'application/json',
          entries: () => [['content-type', 'application/json']],
        },
        text: () => Promise.resolve(JSON.stringify({
          actions: [{ returnValue: { returnValue: JSON.stringify(mockApiResponse) } }],
        })),
      };
    }

    // Helper to set up both getSponsorInfo + getMemberPlans fetch mocks
    function mockAccountsApiFetch(apiAccounts) {
      global.fetch
        .mockResolvedValueOnce(buildSponsorInfoFetchResponse())
        .mockResolvedValueOnce(buildMemberPlansFetchResponse(apiAccounts));
    }

    test('should load accounts from API when cache empty and return consolidated structure', async () => {
      global.GM_getValue.mockReturnValue('[]');

      const apiAccounts = [
        { EnglishShortName: 'RRSP', LongNameEnglish: 'RRSP Account', agreementId: '123' },
      ];

      mockAccountsApiFetch(apiAccounts);

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
      mockAccountsApiFetch(freshApiAccounts);

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

      mockAccountsApiFetch(freshApiAccounts);

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

      mockAccountsApiFetch([{ EnglishShortName: 'NEW', agreementId: '123' }]);

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
      mockAccountsApiFetch([
        { EnglishShortName: 'RRSP-UPDATED', LongNameEnglish: 'Updated RRSP', agreementId: '123' },
      ]);

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
      mockAccountsApiFetch([
        { EnglishShortName: 'RRSP', LongNameEnglish: 'RRSP Account', agreementId: '123' },
      ]);

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

    test('should suppress toasts when silent option is true', async () => {
      global.GM_getValue.mockReturnValue('[]');
      global.fetch.mockRejectedValue(new Error('Network error'));

      await expect(loadCanadaLifeAccounts({ forceRefresh: false, silent: true })).rejects.toThrow('Network error');
      expect(toast.show).not.toHaveBeenCalled();
    });

    test('should suppress loading and success toasts when silent is true', async () => {
      global.GM_getValue.mockReturnValue('[]');

      mockAccountsApiFetch([
        { EnglishShortName: 'RRSP', LongNameEnglish: 'RRSP Account', agreementId: '123' },
      ]);

      await loadCanadaLifeAccounts({ forceRefresh: false, silent: true });

      // No loading or success toasts
      expect(toast.show).not.toHaveBeenCalled();
    });

    test('should show toasts when silent is false (explicit)', async () => {
      global.GM_getValue.mockReturnValue('[]');

      mockAccountsApiFetch([
        { EnglishShortName: 'RRSP', LongNameEnglish: 'RRSP Account', agreementId: '123' },
      ]);

      await loadCanadaLifeAccounts({ forceRefresh: false, silent: false });

      expect(toast.show).toHaveBeenCalledWith('Loading Canada Life accounts...', 'debug');
      expect(toast.show).toHaveBeenCalledWith('Loaded Canada Life accounts: RRSP', 'debug');
    });

    test('should accept options object with forceRefresh', async () => {
      const cachedAccounts = [{
        canadalifeAccount: { id: '123', agreementId: '123', EnglishShortName: 'RRSP', nickname: 'RRSP' },
        monarchAccount: null,
        syncEnabled: true,
      }];
      global.GM_getValue.mockImplementation((key, defaultVal) => {
        if (key === 'canadalife_accounts_list') {
          return JSON.stringify(cachedAccounts);
        }
        return defaultVal;
      });

      mockAccountsApiFetch([{ EnglishShortName: 'NEW', LongNameEnglish: 'New Account', agreementId: '999' }]);

      const result = await loadCanadaLifeAccounts({ forceRefresh: true, silent: true });

      // Should have called API (force refresh) but no toasts (silent)
      expect(global.fetch).toHaveBeenCalled();
      expect(toast.show).not.toHaveBeenCalled();
      expect(result.some((a) => a.canadalifeAccount.id === '999')).toBe(true);
    });

    test('should default silent to false when using boolean signature', async () => {
      global.GM_getValue.mockReturnValue('[]');
      global.fetch.mockRejectedValue(new Error('Network error'));

      await expect(loadCanadaLifeAccounts(false)).rejects.toThrow('Network error');
      expect(toast.show).toHaveBeenCalledWith('Failed to load Canada Life accounts: Network error', 'error');
    });
  });
});

describe('Canada Life API - getAuraContext', () => {
  const savedWindow = {};

  beforeEach(() => {
    jest.clearAllMocks();
    // Save and clear $A from window
    savedWindow.$A = global.window.$A;
    delete global.window.$A;
  });

  afterEach(() => {
    // Restore $A
    if (savedWindow.$A !== undefined) {
      global.window.$A = savedWindow.$A;
    } else {
      delete global.window.$A;
    }
  });

  test('should use encodeForServer when $A.getContext().encodeForServer() returns a string', () => {
    global.window.$A = {
      getContext: jest.fn().mockReturnValue({
        encodeForServer: jest.fn().mockReturnValue('{"mode":"PROD","fwuid":"dynamic-fwuid-123"}'),
      }),
    };

    const result = getAuraContext();

    expect(result).toBe('{"mode":"PROD","fwuid":"dynamic-fwuid-123"}');
    expect(debugLog).toHaveBeenCalledWith('Extracted aura.context via $A.getContext().encodeForServer()');
  });

  test('should use encodeForServer when it returns an object', () => {
    global.window.$A = {
      getContext: jest.fn().mockReturnValue({
        encodeForServer: jest.fn().mockReturnValue({ mode: 'PROD', fwuid: 'obj-fwuid' }),
      }),
    };

    const result = getAuraContext();
    const parsed = JSON.parse(result);

    expect(parsed.fwuid).toBe('obj-fwuid');
    expect(parsed.mode).toBe('PROD');
    expect(debugLog).toHaveBeenCalledWith('Extracted aura.context via $A.getContext().encodeForServer()');
  });

  test('should build manually from context.fwuid when encodeForServer is unavailable', () => {
    global.window.$A = {
      getContext: jest.fn().mockReturnValue({
        fwuid: 'manual-fwuid-456',
        mode: 'PROD',
        loaded: { 'APPLICATION@markup://siteforce:communityApp': 'test-hash' },
      }),
    };

    const result = getAuraContext();
    const parsed = JSON.parse(result);

    expect(parsed.fwuid).toBe('manual-fwuid-456');
    expect(parsed.mode).toBe('PROD');
    expect(parsed.app).toBe('siteforce:communityApp');
    expect(parsed.loaded).toEqual({ 'APPLICATION@markup://siteforce:communityApp': 'test-hash' });
    expect(debugLog).toHaveBeenCalledWith(
      'Built aura.context manually from $A.getContext() properties',
      { fwuid: 'manual-fwuid-456' },
    );
  });

  test('should use getEncodedFwuid() when fwuid property is missing', () => {
    global.window.$A = {
      getContext: jest.fn().mockReturnValue({
        getEncodedFwuid: jest.fn().mockReturnValue('encoded-fwuid-789'),
        mode: 'PROD',
        loaded: {},
      }),
    };

    const result = getAuraContext();
    const parsed = JSON.parse(result);

    expect(parsed.fwuid).toBe('encoded-fwuid-789');
  });

  test('should fall back to hardcoded constant when $A is unavailable', () => {
    // $A is already deleted in beforeEach

    const result = getAuraContext();
    const parsed = JSON.parse(result);

    expect(parsed.mode).toBe('PROD');
    expect(parsed.fwuid).toBeTruthy();
    expect(parsed.app).toBe('siteforce:communityApp');
    expect(debugLog).toHaveBeenCalledWith('WARNING: Using hardcoded fallback aura.context — this may become stale');
  });

  test('should fall back gracefully when $A.getContext throws', () => {
    global.window.$A = {
      getContext: jest.fn().mockImplementation(() => {
        throw new Error('Aura framework not initialized');
      }),
    };

    const result = getAuraContext();
    const parsed = JSON.parse(result);

    expect(parsed.mode).toBe('PROD');
    expect(parsed.fwuid).toBeTruthy();
    expect(debugLog).toHaveBeenCalledWith('Error extracting dynamic aura.context, using fallback:', expect.any(Error));
  });

  test('should fall back when encodeForServer returns null', () => {
    global.window.$A = {
      getContext: jest.fn().mockReturnValue({
        encodeForServer: jest.fn().mockReturnValue(null),
        // No fwuid either
      }),
    };

    const result = getAuraContext();
    const parsed = JSON.parse(result);

    // Should use fallback
    expect(parsed.fwuid).toBeTruthy();
    expect(debugLog).toHaveBeenCalledWith('WARNING: Using hardcoded fallback aura.context — this may become stale');
  });
});

describe('Canada Life API - Generalized Error Detection', () => {
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

  const mockPayload = {
    actions: [{
      id: '123',
      descriptor: 'test',
      params: { test: 'data' },
    }],
  };

  test('should detect memberPlansHasAPIFailure flag', async () => {
    const errorResponse = {
      IPResult: {
        memberPlansHasAPIFailure: true,
        error: 'OK',
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
    await expect(makeAuraApiCall(mockPayload)).rejects.toThrow(/memberPlansHasAPIFailure/);
  });

  test('should detect activityReportsHasApiFailure flag (backward compat)', async () => {
    const errorResponse = {
      IPResult: {
        activityReportsHasApiFailure: true,
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
  });

  test('should detect multiple failure flags simultaneously', async () => {
    const errorResponse = {
      IPResult: {
        activityReportsHasApiFailure: true,
        memberPlansHasAPIFailure: true,
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
    expect(debugLog).toHaveBeenCalledWith(
      expect.stringContaining('API failure flag(s) detected'),
      expect.any(Object),
    );
  });

  test('should not trigger on HasApiFailure flags set to false', async () => {
    const response = {
      IPResult: {
        activityReportsHasApiFailure: false,
        memberPlansHasAPIFailure: false,
        MemberPlans: [{ agreementId: '123' }],
      },
    };

    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: () => 'application/json',
        entries: () => [['content-type', 'application/json']],
      },
      text: () => Promise.resolve(JSON.stringify(response)),
    });

    // Should not throw — failure flags are false
    const result = await makeAuraApiCall(mockPayload);
    expect(result.IPResult.MemberPlans).toBeDefined();
  });

  test('should log COOSE warning when detected in response', async () => {
    const responseWithCoose = {
      actions: [
        {
          id: '164;a',
          state: 'SUCCESS',
          returnValue: { returnValue: '{"IPResult":{"memberPlansHasAPIFailure":true}}' },
        },
        {
          id: 'COOSE',
          state: 'warning',
          returnValue: 'This page has changes since the last refresh.',
        },
      ],
    };

    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: () => 'application/json',
        entries: () => [['content-type', 'application/json']],
      },
      text: () => Promise.resolve(JSON.stringify(responseWithCoose)),
    });

    // Should throw because of memberPlansHasAPIFailure, but also log COOSE
    await expect(makeAuraApiCall(mockPayload)).rejects.toThrow(CanadaLifeApiError);
    expect(debugLog).toHaveBeenCalledWith(
      'COOSE (Client Out Of Sync Error) detected in response:',
      expect.objectContaining({ id: 'COOSE' }),
    );
  });

  test('should include failure flag names in error details', async () => {
    const errorResponse = {
      IPResult: {
        memberPlansHasAPIFailure: true,
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

    try {
      await makeAuraApiCall(mockPayload);
      // Should not reach here
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(CanadaLifeApiError);
      expect(error.errorDetails).toEqual({ memberPlansHasAPIFailure: true });
    }
  });
});

