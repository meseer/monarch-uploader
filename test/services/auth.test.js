/**
 * Auth Service Tests
 *
 * Tests for Monarch session-based authentication (csrf token + session cookies)
 * and Questrade token-based authentication.
 */

import authService, {
  AuthError,
  getMonarchCredentials,
  checkMonarchAuth,
  isSessionExpired,
  clearMonarchCredentials,
} from '../../src/services/auth';
import {
  getQuestradeToken,
  checkQuestradeAuth,
} from '../../src/services/questrade/auth';
import stateManager from '../../src/core/state';
import { STORAGE } from '../../src/core/config';

// Mock dependencies
jest.mock('../../src/core/state', () => ({
  setQuestradeAuth: jest.fn(),
  setMonarchAuth: jest.fn(),
  getState: jest.fn().mockReturnValue({}),
}));

// Mock GM storage functions
global.GM_getValue = jest.fn();
global.GM_setValue = jest.fn();

// Mock sessionStorage will be set up in beforeEach using the global setup

describe('Auth Service', () => {
  beforeEach(() => {
    // Clear mocks except sessionStorage (which is fresh from setup.js)
    global.GM_getValue.mockClear();
    global.GM_setValue.mockClear();
    stateManager.setQuestradeAuth.mockClear();
    stateManager.setMonarchAuth.mockClear();

    // Set up console mocks for debugLog
    global.console = { log: jest.fn() };

    // Invalidate any token cache by mocking Date.now to be far in future
    // This ensures each test starts with a fresh cache lookup
    const mockNow = Date.now() + 10000; // 10 seconds in future
    jest.spyOn(Date, 'now').mockReturnValue(mockNow);
  });

  afterEach(() => {
    // Restore Date.now mock after each test
    jest.restoreAllMocks();
  });

  describe('Questrade Authentication', () => {
    test('getQuestradeToken should return null when no token exists', () => {
      // Mock empty sessionStorage
      global.sessionStorage.length = 0;

      const result = getQuestradeToken();
      expect(result).toBeNull();
      expect(stateManager.setQuestradeAuth).toHaveBeenCalledWith(null);
    });

    test('getQuestradeToken should find and format a valid token', () => {
      // Use a specific time for this test
      const mockNow = 1640995200000; // 2022-01-01 00:00:00
      jest.spyOn(Date, 'now').mockReturnValue(mockNow);

      // Mock sessionStorage with valid token data
      const mockTokenData = {
        access_token: 'test_access_token_123',
        expires_at: Math.floor(mockNow / 1000) + 3600, // Expires in 1 hour
        scope: 'brokerage.balances.all brokerage.account-transactions.read brokerage.accounts.read',
      };

      // Setup sessionStorage mock
      const mockSessionStorage = {
        length: 1,
        key: jest.fn((index) => {
          if (index === 0) {
            return 'oidc.user:https://login.questrade.com/user123';
          }
          return null;
        }),
        getItem: jest.fn((key) => {
          if (key === 'oidc.user:https://login.questrade.com/user123') {
            return JSON.stringify(mockTokenData);
          }
          return null;
        }),
      };

      Object.defineProperty(global, 'sessionStorage', {
        value: mockSessionStorage,
        writable: true,
      });

      const result = getQuestradeToken();

      expect(result).not.toBeNull();
      expect(result.token).toBe('Bearer test_access_token_123');
      expect(result.expires_at).toBe(mockTokenData.expires_at);
      expect(stateManager.setQuestradeAuth).toHaveBeenCalledWith(result);
    });

    test('checkQuestradeAuth should return status when authenticated', () => {
      // Use a different time for this test to invalidate any previous cache
      const mockNow = 1641081600000; // 2022-01-02 00:00:00 (24 hours later)
      jest.spyOn(Date, 'now').mockReturnValue(mockNow);

      // Mock sessionStorage with valid token data
      const mockTokenData = {
        access_token: 'Bearer valid_token_456',
        expires_at: Math.floor(mockNow / 1000) + 1800, // Expires in 30 minutes
        scope: 'brokerage.balances.all brokerage.account-transactions.read brokerage.accounts.read',
      };

      // Setup sessionStorage mock
      const mockSessionStorage = {
        length: 1,
        key: jest.fn((index) => {
          if (index === 0) {
            return 'oidc.user:https://login.questrade.com/active123';
          }
          return null;
        }),
        getItem: jest.fn((key) => {
          if (key === 'oidc.user:https://login.questrade.com/active123') {
            return JSON.stringify(mockTokenData);
          }
          return null;
        }),
      };

      Object.defineProperty(global, 'sessionStorage', {
        value: mockSessionStorage,
        writable: true,
      });

      const result = checkQuestradeAuth();

      expect(result.authenticated).toBe(true);
      expect(result.message).toBe('Authenticated with Questrade');
      expect(result.token).toBe('Bearer valid_token_456');
      expect(result.expiresIn).toBe(1800); // 30 minutes in seconds
      expect(result.expiryTime).toBe(mockTokenData.expires_at * 1000);
    });

    test('checkQuestradeAuth should return not authenticated when no token', () => {
      // Mock empty sessionStorage
      global.sessionStorage.length = 0;

      const result = checkQuestradeAuth();

      expect(result.authenticated).toBe(false);
      expect(result.message).toBe('Not authenticated with Questrade');
    });
  });

  describe('Monarch Authentication (Session-based)', () => {
    describe('getMonarchCredentials', () => {
      test('should return null when no csrf token is stored', () => {
        global.GM_getValue.mockReturnValue(undefined);

        const result = getMonarchCredentials();
        expect(result).toBeNull();
      });

      test('should return credentials when csrf token exists', () => {
        global.GM_getValue.mockImplementation((key) => {
          if (key === STORAGE.MONARCH_CSRF_TOKEN) return 'test_csrf_token';
          if (key === STORAGE.MONARCH_SESSION_EXPIRES_AT) return '2099-12-31T23:59:59Z';
          return undefined;
        });

        const result = getMonarchCredentials();
        expect(result).toEqual({
          csrfToken: 'test_csrf_token',
          sessionExpiresAt: '2099-12-31T23:59:59Z',
        });
      });

      test('should return credentials with null sessionExpiresAt when only csrf token exists', () => {
        global.GM_getValue.mockImplementation((key) => {
          if (key === STORAGE.MONARCH_CSRF_TOKEN) return 'test_csrf_token';
          return undefined;
        });

        const result = getMonarchCredentials();
        expect(result).toEqual({
          csrfToken: 'test_csrf_token',
          sessionExpiresAt: null,
        });
      });
    });

    describe('isSessionExpired', () => {
      test('should return true when expiresAt is null', () => {
        expect(isSessionExpired(null)).toBe(true);
      });

      test('should return true when session is expired', () => {
        const pastDate = '2020-01-01T00:00:00Z';
        expect(isSessionExpired(pastDate)).toBe(true);
      });

      test('should return false when session is valid (far future)', () => {
        const futureDate = '2099-12-31T23:59:59Z';
        expect(isSessionExpired(futureDate)).toBe(false);
      });

      test('should return true when session expires within 60-second buffer', () => {
        // Set Date.now to a known time
        const mockNow = 1700000000000;
        jest.spyOn(Date, 'now').mockReturnValue(mockNow);

        // Session expires in 30 seconds (within 60-second buffer)
        const nearExpiry = new Date(mockNow + 30000).toISOString();
        expect(isSessionExpired(nearExpiry)).toBe(true);
      });

      test('should return false when session expires beyond 60-second buffer', () => {
        const mockNow = 1700000000000;
        jest.spyOn(Date, 'now').mockReturnValue(mockNow);

        // Session expires in 120 seconds (beyond 60-second buffer)
        const safeExpiry = new Date(mockNow + 120000).toISOString();
        expect(isSessionExpired(safeExpiry)).toBe(false);
      });

      test('should return true for invalid date strings', () => {
        expect(isSessionExpired('not-a-date')).toBe(true);
      });
    });

    describe('checkMonarchAuth', () => {
      test('should return authenticated when valid credentials exist with future expiry', () => {
        global.GM_getValue.mockImplementation((key) => {
          if (key === STORAGE.MONARCH_CSRF_TOKEN) return 'valid_csrf_token';
          if (key === STORAGE.MONARCH_SESSION_EXPIRES_AT) return '2099-12-31T23:59:59Z';
          return undefined;
        });

        const result = checkMonarchAuth();

        expect(result.authenticated).toBe(true);
        expect(result.message).toBe('Authenticated with Monarch Money');
        expect(result.credentials).toEqual({
          csrfToken: 'valid_csrf_token',
          sessionExpiresAt: '2099-12-31T23:59:59Z',
        });
        expect(stateManager.setMonarchAuth).toHaveBeenCalledWith({
          csrfToken: 'valid_csrf_token',
          sessionExpiresAt: '2099-12-31T23:59:59Z',
        });
      });

      test('should return not authenticated when no credentials exist', () => {
        global.GM_getValue.mockReturnValue(undefined);

        const result = checkMonarchAuth();

        expect(result.authenticated).toBe(false);
        expect(result.message).toContain('Not authenticated');
        expect(result.credentials).toBeUndefined();
        expect(stateManager.setMonarchAuth).toHaveBeenCalledWith(null);
      });

      test('should return not authenticated when session is expired', () => {
        global.GM_getValue.mockImplementation((key) => {
          if (key === STORAGE.MONARCH_CSRF_TOKEN) return 'expired_csrf_token';
          if (key === STORAGE.MONARCH_SESSION_EXPIRES_AT) return '2020-01-01T00:00:00Z';
          return undefined;
        });

        const result = checkMonarchAuth();

        expect(result.authenticated).toBe(false);
        expect(result.message).toContain('expired');
      });
    });

    describe('clearMonarchCredentials', () => {
      test('should clear stored credentials and update state', () => {
        clearMonarchCredentials();

        expect(global.GM_setValue).toHaveBeenCalledWith(STORAGE.MONARCH_CSRF_TOKEN, '');
        expect(global.GM_setValue).toHaveBeenCalledWith(STORAGE.MONARCH_SESSION_EXPIRES_AT, '');
        expect(stateManager.setMonarchAuth).toHaveBeenCalledWith(null);
      });
    });

    describe('saveMonarchCredentials', () => {
      test('should store csrf token and session expiry', () => {
        authService.saveMonarchCredentials('new_csrf_token', '2099-12-31T23:59:59Z');

        expect(global.GM_setValue).toHaveBeenCalledWith(STORAGE.MONARCH_CSRF_TOKEN, 'new_csrf_token');
        expect(global.GM_setValue).toHaveBeenCalledWith(STORAGE.MONARCH_SESSION_EXPIRES_AT, '2099-12-31T23:59:59Z');
        expect(stateManager.setMonarchAuth).toHaveBeenCalledWith({
          csrfToken: 'new_csrf_token',
          sessionExpiresAt: '2099-12-31T23:59:59Z',
        });
      });

      test('should store only csrf token when no expiry provided', () => {
        authService.saveMonarchCredentials('csrf_only');

        expect(global.GM_setValue).toHaveBeenCalledWith(STORAGE.MONARCH_CSRF_TOKEN, 'csrf_only');
        expect(stateManager.setMonarchAuth).toHaveBeenCalledWith({
          csrfToken: 'csrf_only',
          sessionExpiresAt: null,
        });
      });

      test('should throw AuthError on storage failure', () => {
        global.GM_setValue.mockImplementationOnce(() => {
          throw new Error('Storage error');
        });

        expect(() => {
          authService.saveMonarchCredentials('test_token');
        }).toThrow(AuthError);
      });

      test('should not save when csrf token is empty', () => {
        authService.saveMonarchCredentials('');

        expect(global.GM_setValue).not.toHaveBeenCalled();
      });
    });
  });
});