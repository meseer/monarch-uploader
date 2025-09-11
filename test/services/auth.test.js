/**
 * Auth Service Tests
 */

import authService, { 
  AuthError,
  getQuestradeToken,
  checkQuestradeAuth,
  getMonarchToken,
  checkMonarchAuth,
  isFullyAuthenticated
} from '../../src/services/auth';
import stateManager from '../../src/core/state';
import { STORAGE } from '../../src/core/config';

// Mock dependencies
jest.mock('../../src/core/state', () => ({
  setQuestradeAuth: jest.fn(),
  setMonarchAuth: jest.fn(),
  getState: jest.fn().mockReturnValue({})
}));

// Mock GM storage functions
global.GM_getValue = jest.fn();
global.GM_setValue = jest.fn();
global.sessionStorage = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  length: 0,
  key: jest.fn()
};

describe('Auth Service', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
    
    // Reset sessionStorage mock
    global.sessionStorage.length = 0;
    global.sessionStorage.getItem.mockClear();
    global.sessionStorage.key.mockClear();
    
    // Set up console mocks for debugLog
    global.console = { log: jest.fn() };
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
      // Mock sessionStorage with a valid token
      global.sessionStorage.length = 1;
      global.sessionStorage.key.mockReturnValueOnce('oidc.user:https://login.questrade.com/abcd');
      global.sessionStorage.getItem.mockReturnValueOnce(JSON.stringify({
        access_token: 'test_token',
        expires_at: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
        scope: 'brokerage.balances.all brokerage.account-transactions.read brokerage.accounts.read'
      }));
      
      const result = getQuestradeToken();
      
      expect(result).not.toBeNull();
      expect(result.token).toBe('Bearer test_token');
      expect(stateManager.setQuestradeAuth).toHaveBeenCalledWith(result);
    });

    test('checkQuestradeAuth should return status when authenticated', () => {
      // Mock getQuestradeToken to return a valid token
      jest.spyOn(authService, 'getQuestradeToken').mockReturnValueOnce({
        token: 'Bearer test_token',
        expires_at: Math.floor(Date.now() / 1000) + 3600 // 1 hour from now
      });
      
      const result = checkQuestradeAuth();
      
      expect(result.authenticated).toBe(true);
      expect(result.token).toBe('Bearer test_token');
      expect(result.expiresIn).toBeGreaterThan(0);
    });

    test('checkQuestradeAuth should return not authenticated when no token', () => {
      // Mock getQuestradeToken to return null
      jest.spyOn(authService, 'getQuestradeToken').mockReturnValueOnce(null);
      
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
      // Mock getMonarchToken to return a valid token
      jest.spyOn(authService, 'getMonarchToken').mockReturnValueOnce('monarch_test_token');
      
      const result = checkMonarchAuth();
      
      expect(result.authenticated).toBe(true);
      expect(result.token).toBe('monarch_test_token');
    });

    test('checkMonarchAuth should return not authenticated when no token', () => {
      // Mock getMonarchToken to return null
      jest.spyOn(authService, 'getMonarchToken').mockReturnValueOnce(null);
      
      const result = checkMonarchAuth();
      
      expect(result.authenticated).toBe(false);
      expect(result.message).toBe('Not authenticated with Monarch Money');
    });
  });

  describe('Combined Authentication', () => {
    test('isFullyAuthenticated should return true when both services are authenticated', () => {
      // Mock both auth checks to return authenticated
      jest.spyOn(authService, 'checkQuestradeAuth').mockReturnValueOnce({
        authenticated: true,
        token: 'Bearer test_token'
      });
      
      jest.spyOn(authService, 'checkMonarchAuth').mockReturnValueOnce({
        authenticated: true,
        token: 'monarch_test_token'
      });
      
      const result = isFullyAuthenticated();
      expect(result).toBe(true);
    });
    
    test('isFullyAuthenticated should return false when Questrade is not authenticated', () => {
      // Mock Questrade not authenticated
      jest.spyOn(authService, 'checkQuestradeAuth').mockReturnValueOnce({
        authenticated: false
      });
      
      // Mock Monarch authenticated
      jest.spyOn(authService, 'checkMonarchAuth').mockReturnValueOnce({
        authenticated: true,
        token: 'monarch_test_token'
      });
      
      const result = isFullyAuthenticated();
      expect(result).toBe(false);
    });
    
    test('isFullyAuthenticated should return false when Monarch is not authenticated', () => {
      // Mock Questrade authenticated
      jest.spyOn(authService, 'checkQuestradeAuth').mockReturnValueOnce({
        authenticated: true,
        token: 'Bearer test_token'
      });
      
      // Mock Monarch not authenticated
      jest.spyOn(authService, 'checkMonarchAuth').mockReturnValueOnce({
        authenticated: false
      });
      
      const result = isFullyAuthenticated();
      expect(result).toBe(false);
    });
  });

  describe('Token Management', () => {
    test('saveToken should store a Monarch token', () => {
      authService.saveToken('monarch', 'new_monarch_token');
      expect(GM_setValue).toHaveBeenCalledWith(STORAGE.MONARCH_TOKEN, 'new_monarch_token');
      expect(stateManager.setMonarchAuth).toHaveBeenCalledWith('new_monarch_token');
    });
    
    test('saveToken should update Questrade token cache', () => {
      const token = { token: 'Bearer new_questrade_token', expires_at: 12345 };
      authService.saveToken('questrade', token);
      expect(stateManager.setQuestradeAuth).toHaveBeenCalledWith(token);
    });
    
    test('saveToken should throw AuthError on error', () => {
      // Mock GM_setValue to throw an error
      global.GM_setValue.mockImplementationOnce(() => {
        throw new Error('Storage error');
      });
      
      expect(() => {
        authService.saveToken('monarch', 'new_token');
      }).toThrow(AuthError);
    });
  });
});
