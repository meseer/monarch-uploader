/**
 * Canada Life API — authentication and token monitoring
 */

import {
  getCanadaLifeToken,
  checkCanadaLifeAuth,
  checkTokenStatus,
  setupTokenMonitoring,
  extractCookies,
  attemptTokenRefresh,
  CanadaLifeTokenExpiredError,
  CanadaLifeApiError,
} from '../../../src/api/canadalife';

import stateManager from '../../../src/core/state';
import { debugLog } from '../../../src/core/utils';
import { STORAGE } from '../../../src/core/config';
import { installCanadaLifeTestGlobals } from './harness';

jest.mock('../../../src/core/state', () => {
  const { buildStateMock: build } = jest.requireActual('./harness');
  return build();
});
jest.mock('../../../src/core/utils', () => {
  const { buildUtilsMock: build } = jest.requireActual('./harness');
  return build();
});
jest.mock('../../../src/ui/toast', () => {
  const { buildToastMock: build } = jest.requireActual('./harness');
  return build();
});

const { localStorageMock } = installCanadaLifeTestGlobals();

describe('Canada Life API - getCanadaLifeToken', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns the token from localStorage when available', () => {
    localStorageMock.getItem.mockReturnValue('test-token-123');

    expect(getCanadaLifeToken()).toBe('test-token-123');
    expect(localStorageMock.getItem).toHaveBeenCalledWith(STORAGE.CANADALIFE_TOKEN_KEY);
    expect(debugLog).toHaveBeenCalledWith('CanadaLife token found in localStorage');
  });

  test.each([
    ['empty string', ''],
    ['whitespace only', '   '],
    ['null', null],
  ])('returns null when the stored token is %s', (_label, stored) => {
    localStorageMock.getItem.mockReturnValue(stored);

    expect(getCanadaLifeToken()).toBeNull();
    expect(debugLog).toHaveBeenCalledWith('No CanadaLife token found in localStorage');
  });

  test('returns null and logs when localStorage throws', () => {
    localStorageMock.getItem.mockImplementation(() => {
      throw new Error('localStorage access denied');
    });

    expect(getCanadaLifeToken()).toBeNull();
    expect(debugLog).toHaveBeenCalledWith(
      'Error reading CanadaLife token from localStorage:',
      expect.any(Error),
    );
  });
});

describe('Canada Life API - checkCanadaLifeAuth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('reports connected when a token exists', () => {
    localStorageMock.getItem.mockReturnValue('valid-token');

    expect(checkCanadaLifeAuth()).toEqual({
      authenticated: true,
      token: 'valid-token',
      source: 'localStorage',
    });
    expect(debugLog).toHaveBeenCalledWith('CanadaLife authentication: Connected');
  });

  test('reports not connected when no token exists', () => {
    localStorageMock.getItem.mockReturnValue(null);

    expect(checkCanadaLifeAuth()).toEqual({
      authenticated: false,
      token: null,
      source: null,
    });
    expect(debugLog).toHaveBeenCalledWith('CanadaLife authentication: Not connected');
  });
});

describe('Canada Life API - checkTokenStatus', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('pushes the token into state and returns the status', () => {
    localStorageMock.getItem.mockReturnValue('valid-token');

    const result = checkTokenStatus();

    expect(stateManager.setCanadaLifeAuth).toHaveBeenCalledWith('valid-token');
    expect(result).toEqual({
      authenticated: true,
      token: 'valid-token',
      source: 'localStorage',
    });
  });

  test('clears state and returns null when unauthenticated', () => {
    localStorageMock.getItem.mockReturnValue(null);

    expect(checkTokenStatus()).toBeNull();
    expect(stateManager.setCanadaLifeAuth).toHaveBeenCalledWith(null);
  });
});

describe('Canada Life API - setupTokenMonitoring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('registers a polling interval and a storage listener', () => {
    localStorageMock.getItem.mockReturnValue('test-token');

    setupTokenMonitoring();

    expect(stateManager.setCanadaLifeAuth).toHaveBeenCalledWith('test-token');
    expect(global.setInterval).toHaveBeenCalledWith(expect.any(Function), 5000);
    expect(global.window.addEventListener).toHaveBeenCalledWith('storage', expect.any(Function));
    expect(debugLog).toHaveBeenCalledWith('CanadaLife token monitoring setup complete');
  });

  test('reacts to storage events for the token key', () => {
    let storageEventHandler;
    global.window.addEventListener.mockImplementation((event, handler) => {
      if (event === 'storage') {
        storageEventHandler = handler;
      }
    });

    setupTokenMonitoring();

    localStorageMock.getItem.mockReturnValue('new-token');
    storageEventHandler({ key: STORAGE.CANADALIFE_TOKEN_KEY });

    expect(debugLog).toHaveBeenCalledWith('CanadaLife token changed via storage event');
    expect(stateManager.setCanadaLifeAuth).toHaveBeenCalledWith('new-token');
  });

  test('ignores storage events for unrelated keys', () => {
    let storageEventHandler;
    global.window.addEventListener.mockImplementation((event, handler) => {
      if (event === 'storage') {
        storageEventHandler = handler;
      }
    });

    setupTokenMonitoring();
    jest.clearAllMocks();

    storageEventHandler({ key: 'other_key' });

    expect(debugLog).not.toHaveBeenCalledWith('CanadaLife token changed via storage event');
  });
});

describe('Canada Life API - extractCookies', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns document.cookie', () => {
    expect(extractCookies()).toBe('mock-cookie=value; another-cookie=another-value');
  });

  test('returns an empty string when cookie access throws', () => {
    const originalCookie = global.document.cookie;
    Object.defineProperty(global.document, 'cookie', {
      get: () => {
        throw new Error('Cookie access denied');
      },
      configurable: true,
    });

    expect(extractCookies()).toBe('');
    expect(debugLog).toHaveBeenCalledWith('Error extracting cookies:', expect.any(Error));

    Object.defineProperty(global.document, 'cookie', {
      value: originalCookie,
      writable: true,
      configurable: true,
    });
  });
});

describe('Canada Life API - attemptTokenRefresh', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns and stores the new token when it differs', () => {
    localStorageMock.getItem.mockReturnValue('fresh-token');

    expect(attemptTokenRefresh('stale-token')).toBe('fresh-token');
    expect(stateManager.setCanadaLifeAuth).toHaveBeenCalledWith('fresh-token');
  });

  test('returns null when the stored token is unchanged', () => {
    localStorageMock.getItem.mockReturnValue('same-token');

    expect(attemptTokenRefresh('same-token')).toBeNull();
    expect(debugLog).toHaveBeenCalledWith('Token refresh: No new token available or same as current');
  });

  test('returns null when no token is stored', () => {
    localStorageMock.getItem.mockReturnValue(null);

    expect(attemptTokenRefresh('stale-token')).toBeNull();
  });
});

describe('Canada Life API - Error Classes', () => {
  test('CanadaLifeTokenExpiredError defaults to recoverable', () => {
    const error = new CanadaLifeTokenExpiredError('Token expired', { errorId: '004' });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('CanadaLifeTokenExpiredError');
    expect(error.message).toBe('Token expired');
    expect(error.errorDetails).toEqual({ errorId: '004' });
    expect(error.recoverable).toBe(true);
  });

  test('CanadaLifeApiError is never recoverable', () => {
    const error = new CanadaLifeApiError('API error', { errorCode: 500 });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('CanadaLifeApiError');
    expect(error.message).toBe('API error');
    expect(error.errorDetails).toEqual({ errorCode: 500 });
    expect(error.recoverable).toBe(false);
  });
});