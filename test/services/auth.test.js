/**
 * Auth Service Tests
 */

import authService, {
  AuthError,
  getMonarchToken,
  checkMonarchAuth,
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

  describe('Monarch Authentication', () => {
    test('getMonarchToken should return null when no token exists', () => {
      // Mock GM_getValue to return null
      global.GM_getValue.mockReturnValueOnce(null);

      const result = getMonarchToken();
      expect(result).toBeNull();
      expect(stateManager.setMonarchAuth).toHaveBeenCalledWith(null);
    });

    test('getMonarchToken should return token when it exists', () => {
      // Mock GM_getValue to return a token
      global.GM_getValue.mockReturnValueOnce('monarch_test_token');

      const result = getMonarchToken();
      expect(result).toBe('monarch_test_token');
      expect(stateManager.setMonarchAuth).toHaveBeenCalledWith('monarch_test_token');
    });

    test('checkMonarchAuth should return status when authenticated', () => {
      // Mock GM_getValue to return a valid token
      global.GM_getValue.mockReturnValueOnce('monarch_test_token');

      const result = checkMonarchAuth();

      expect(result.authenticated).toBe(true);
      expect(result.token).toBe('monarch_test_token');
    });

    test('checkMonarchAuth should return not authenticated when no token', () => {
      // Mock GM_getValue to return null
      global.GM_getValue.mockReturnValueOnce(null);

      const result = checkMonarchAuth();

      expect(result.authenticated).toBe(false);
      expect(result.message).toBe('Not authenticated with Monarch Money');
    });
  });

  describe('Token Management', () => {
    test('saveMonarchToken should store a Monarch token', () => {
      authService.saveMonarchToken('new_monarch_token');
      expect(GM_setValue).toHaveBeenCalledWith(STORAGE.MONARCH_TOKEN, 'new_monarch_token');
      expect(stateManager.setMonarchAuth).toHaveBeenCalledWith('new_monarch_token');
    });

    test('saveMonarchToken should throw AuthError on error', () => {
      // Mock GM_setValue to throw an error
      global.GM_setValue.mockImplementationOnce(() => {
        throw new Error('Storage error');
      });

      expect(() => {
        authService.saveMonarchToken('new_token');
      }).toThrow(AuthError);
    });
  });
});
