/**
 * Questrade Auth Service Tests
 */

import {
  getQuestradeToken,
  checkQuestradeAuth,
  questradeTokenNeedsRefresh,
  saveQuestradeToken,
  clearQuestradeTokenCache,
} from '../../../src/services/questrade/auth';
import stateManager from '../../../src/core/state';

// Mock stateManager
jest.mock('../../../src/core/state', () => ({
  setQuestradeAuth: jest.fn(),
}));

// Mock debugLog
jest.mock('../../../src/core/utils', () => ({
  debugLog: jest.fn(),
}));

describe('Questrade Auth Service', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();

    // Clear token cache to ensure clean state for each test
    clearQuestradeTokenCache();

    // Mock sessionStorage
    Object.defineProperty(window, 'sessionStorage', {
      value: {
        length: 0,
        key: jest.fn(),
        getItem: jest.fn(),
        setItem: jest.fn(),
        removeItem: jest.fn(),
        clear: jest.fn(),
      },
      writable: true,
    });
  });

  describe('getQuestradeToken', () => {
    test('should return token when valid session exists', () => {
      const mockSessionData = {
        access_token: 'test-token-123',
        expires_at: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
        scope: 'brokerage.balances.all brokerage.account-transactions.read brokerage.accounts.read',
      };

      // Mock sessionStorage
      window.sessionStorage.length = 1;
      window.sessionStorage.key.mockReturnValueOnce('oidc.user:https://login.questrade.com/:qtweb');
      window.sessionStorage.getItem.mockReturnValueOnce(JSON.stringify(mockSessionData));

      const result = getQuestradeToken();

      expect(result).toBeDefined();
      expect(result.token).toBe('Bearer test-token-123');
      expect(result.expires_at).toBe(mockSessionData.expires_at);
    });

    test('should return null when no valid session exists', () => {
      window.sessionStorage.length = 0;

      const result = getQuestradeToken();

      expect(result).toBeNull();
    });

    test('should return null when token is expired', () => {
      const mockSessionData = {
        access_token: 'expired-token',
        expires_at: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago (expired)
        scope: 'brokerage.balances.all brokerage.account-transactions.read brokerage.accounts.read',
      };

      window.sessionStorage.length = 1;
      window.sessionStorage.key.mockReturnValueOnce('oidc.user:https://login.questrade.com/:qtweb');
      window.sessionStorage.getItem.mockReturnValueOnce(JSON.stringify(mockSessionData));

      const result = getQuestradeToken();

      expect(result).toBeNull();
    });

    test('should return null when token lacks required permissions', () => {
      const mockSessionData = {
        access_token: 'limited-token',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        scope: 'limited.scope', // Missing required permissions
      };

      window.sessionStorage.length = 1;
      window.sessionStorage.key.mockReturnValueOnce('oidc.user:https://login.questrade.com/:qtweb');
      window.sessionStorage.getItem.mockReturnValueOnce(JSON.stringify(mockSessionData));

      const result = getQuestradeToken();

      expect(result).toBeNull();
    });
  });

  describe('questradeTokenNeedsRefresh', () => {
    test('should return true when no auth available', () => {
      // Mock no token available
      window.sessionStorage.length = 0;

      const result = questradeTokenNeedsRefresh();

      expect(result).toBe(true);
    });

    test('should return true when token expires soon (within 5 minutes)', () => {
      const mockSessionData = {
        access_token: 'soon-expired-token',
        expires_at: Math.floor(Date.now() / 1000) + 240, // 4 minutes from now
        scope: 'brokerage.balances.all brokerage.account-transactions.read brokerage.accounts.read',
      };

      window.sessionStorage.length = 1;
      window.sessionStorage.key.mockReturnValueOnce('oidc.user:https://login.questrade.com/:qtweb');
      window.sessionStorage.getItem.mockReturnValueOnce(JSON.stringify(mockSessionData));

      const result = questradeTokenNeedsRefresh();

      expect(result).toBe(true);
    });

    test('should return false when token is valid and not expiring soon', () => {
      const mockSessionData = {
        access_token: 'valid-token',
        expires_at: Math.floor(Date.now() / 1000) + 1800, // 30 minutes from now
        scope: 'brokerage.balances.all brokerage.account-transactions.read brokerage.accounts.read',
      };

      window.sessionStorage.length = 1;
      window.sessionStorage.key.mockReturnValueOnce('oidc.user:https://login.questrade.com/:qtweb');
      window.sessionStorage.getItem.mockReturnValueOnce(JSON.stringify(mockSessionData));

      const result = questradeTokenNeedsRefresh();

      expect(result).toBe(false);
    });
  });

  describe('saveQuestradeToken', () => {
    test('should save token to cache', () => {
      const tokenData = {
        token: 'Bearer new-token-123',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      };

      saveQuestradeToken(tokenData);

      // Should update cache and call state manager
      expect(stateManager.setQuestradeAuth).toHaveBeenCalledWith(tokenData);
    });

    test('should handle null token gracefully', () => {
      saveQuestradeToken(null);

      // Should still call state manager
      expect(stateManager.setQuestradeAuth).toHaveBeenCalledWith(null);
    });
  });

  describe('checkQuestradeAuth', () => {
    test('should return authenticated when valid token exists', () => {
      const mockSessionData = {
        access_token: 'valid-token',
        expires_at: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
        scope: 'brokerage.balances.all brokerage.account-transactions.read brokerage.accounts.read',
      };

      window.sessionStorage.length = 1;
      window.sessionStorage.key.mockReturnValueOnce('oidc.user:https://login.questrade.com/:qtweb');
      window.sessionStorage.getItem.mockReturnValueOnce(JSON.stringify(mockSessionData));

      const result = checkQuestradeAuth();

      expect(result.authenticated).toBe(true);
      expect(result.message).toBe('Authenticated with Questrade');
      expect(result.token).toBe('Bearer valid-token');
      expect(result.expiresIn).toBeGreaterThan(3500); // Should be close to 3600
    });

    test('should return not authenticated when no token available', () => {
      window.sessionStorage.length = 0;

      const result = checkQuestradeAuth();

      expect(result.authenticated).toBe(false);
      expect(result.message).toBe('Not authenticated with Questrade');
      expect(result.expiresIn).toBe(0);
    });

    test('should return not authenticated when token is expired', () => {
      const mockSessionData = {
        access_token: 'expired-token',
        expires_at: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago (expired)
        scope: 'brokerage.balances.all brokerage.account-transactions.read brokerage.accounts.read',
      };

      window.sessionStorage.length = 1;
      window.sessionStorage.key.mockReturnValueOnce('oidc.user:https://login.questrade.com/:qtweb');
      window.sessionStorage.getItem.mockReturnValueOnce(JSON.stringify(mockSessionData));

      const result = checkQuestradeAuth();

      expect(result.authenticated).toBe(false);
      expect(result.message).toBe('Not authenticated with Questrade');
    });
  });
});
