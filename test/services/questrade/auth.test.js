/**
 * Questrade Auth Service Tests
 */

import {
  getQuestradeToken,
  checkQuestradeAuth,
  questradeTokenNeedsRefresh,
  waitForQuestradeToken,
  saveQuestradeToken,
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

    test('should accept custom required permissions', () => {
      const mockSessionData = {
        access_token: 'positions-token',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        scope: 'brokerage.positions.read',
      };

      window.sessionStorage.length = 1;
      window.sessionStorage.key.mockReturnValueOnce('oidc.user:https://login.questrade.com/:qtweb');
      window.sessionStorage.getItem.mockReturnValueOnce(JSON.stringify(mockSessionData));

      const result = getQuestradeToken(['brokerage.positions.read']);

      expect(result).toBeDefined();
      expect(result.token).toBe('Bearer positions-token');
    });

    test('should return null when custom permissions not met', () => {
      const mockSessionData = {
        access_token: 'balance-token',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        scope: 'brokerage.balances.all',
      };

      window.sessionStorage.length = 1;
      window.sessionStorage.key.mockReturnValueOnce('oidc.user:https://login.questrade.com/:qtweb');
      window.sessionStorage.getItem.mockReturnValueOnce(JSON.stringify(mockSessionData));

      // Request positions permission but token only has balances
      const result = getQuestradeToken(['brokerage.positions.read']);

      expect(result).toBeNull();
    });

    test('should select token with latest expiry when multiple valid tokens exist', () => {
      const oldTokenData = {
        access_token: 'old-token',
        expires_at: Math.floor(Date.now() / 1000) + 1800, // 30 minutes from now
        scope: 'brokerage.positions.read',
      };

      const newTokenData = {
        access_token: 'new-token',
        expires_at: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
        scope: 'brokerage.positions.read',
      };

      window.sessionStorage.length = 2;
      window.sessionStorage.key
        .mockReturnValueOnce('oidc.user:https://login.questrade.com/:old')
        .mockReturnValueOnce('oidc.user:https://login.questrade.com/:new');
      window.sessionStorage.getItem
        .mockReturnValueOnce(JSON.stringify(oldTokenData))
        .mockReturnValueOnce(JSON.stringify(newTokenData));

      const result = getQuestradeToken(['brokerage.positions.read']);

      expect(result).toBeDefined();
      expect(result.token).toBe('Bearer new-token');
      expect(result.expires_at).toBe(newTokenData.expires_at);
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
    test('should save token to state manager', () => {
      const tokenData = {
        token: 'Bearer new-token-123',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      };

      saveQuestradeToken(tokenData);

      // Should call state manager
      expect(stateManager.setQuestradeAuth).toHaveBeenCalledWith(tokenData);
    });

    test('should handle null token gracefully', () => {
      saveQuestradeToken(null);

      // Should still call state manager
      expect(stateManager.setQuestradeAuth).toHaveBeenCalledWith(null);
    });
  });

  describe('waitForQuestradeToken', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('should return token immediately if available on first check', async () => {
      const mockSessionData = {
        access_token: 'immediate-token',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        scope: 'brokerage.balances.all brokerage.account-transactions.read brokerage.accounts.read',
      };

      window.sessionStorage.length = 1;
      window.sessionStorage.key.mockReturnValue('oidc.user:https://login.questrade.com/:qtweb');
      window.sessionStorage.getItem.mockReturnValue(JSON.stringify(mockSessionData));

      const result = await waitForQuestradeToken();

      expect(result).toBeDefined();
      expect(result.token).toBe('Bearer immediate-token');
    });

    test('should retry and find token after delay', async () => {
      const mockSessionData = {
        access_token: 'delayed-token',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        scope: 'brokerage.balances.all brokerage.account-transactions.read brokerage.accounts.read',
      };

      // First attempt: no token
      window.sessionStorage.length = 0;

      const promise = waitForQuestradeToken(undefined, { retryDelays: [100, 200] });

      // After first delay (100ms), still no token
      await jest.advanceTimersByTimeAsync(100);

      // After second delay (200ms), token appears
      window.sessionStorage.length = 1;
      window.sessionStorage.key.mockReturnValue('oidc.user:https://login.questrade.com/:qtweb');
      window.sessionStorage.getItem.mockReturnValue(JSON.stringify(mockSessionData));

      await jest.advanceTimersByTimeAsync(200);

      const result = await promise;

      expect(result).toBeDefined();
      expect(result.token).toBe('Bearer delayed-token');
    });

    test('should return null after all retries exhausted', async () => {
      // No token available at any point
      window.sessionStorage.length = 0;

      const promise = waitForQuestradeToken(undefined, { retryDelays: [50, 50] });

      // Advance through all delays
      await jest.advanceTimersByTimeAsync(50);
      await jest.advanceTimersByTimeAsync(50);

      const result = await promise;

      expect(result).toBeNull();
    });

    test('should accept custom permissions', async () => {
      const mockSessionData = {
        access_token: 'positions-token',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        scope: 'brokerage.positions.read',
      };

      window.sessionStorage.length = 1;
      window.sessionStorage.key.mockReturnValue('oidc.user:https://login.questrade.com/:qtweb');
      window.sessionStorage.getItem.mockReturnValue(JSON.stringify(mockSessionData));

      const result = await waitForQuestradeToken(['brokerage.positions.read']);

      expect(result).toBeDefined();
      expect(result.token).toBe('Bearer positions-token');
    });

    test('should use custom retry delays', async () => {
      window.sessionStorage.length = 0;

      const promise = waitForQuestradeToken(undefined, { retryDelays: [10] });

      await jest.advanceTimersByTimeAsync(10);

      const result = await promise;

      expect(result).toBeNull();
    });
  });

  describe('checkQuestradeAuth', () => {
    test('should accept custom required permissions', () => {
      const mockSessionData = {
        access_token: 'positions-token',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        scope: 'brokerage.positions.read',
      };

      window.sessionStorage.length = 1;
      window.sessionStorage.key.mockReturnValueOnce('oidc.user:https://login.questrade.com/:qtweb');
      window.sessionStorage.getItem.mockReturnValueOnce(JSON.stringify(mockSessionData));

      const result = checkQuestradeAuth(['brokerage.positions.read']);

      expect(result.authenticated).toBe(true);
      expect(result.token).toBe('Bearer positions-token');
    });

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
