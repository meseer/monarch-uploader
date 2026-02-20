/**
 * Tests for state management
 */

import stateManager, { StateManager } from '../../src/core/state';

// Mock the utils module
jest.mock('../../src/core/utils', () => ({
  debugLog: jest.fn(),
}));

describe('StateManager', () => {
  let testStateManager;

  beforeEach(() => {
    // Create fresh instance for each test
    testStateManager = new StateManager();
    // Clear all mocks
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default state', () => {
      const state = testStateManager.getState();

      expect(state.currentAccount).toEqual({
        id: null,
        nickname: 'unknown',
      });

      expect(state.ui).toEqual({
        buttonContainer: null,
        indicators: {
          questrade: null,
          questradeExpiry: null,
          monarch: null,
          lastDownloadedNote: null,
        },
      });

      expect(state.auth).toEqual({
        questrade: {
          token: null,
          expiresAt: 0,
        },
        monarch: {
          token: null,
        },
        canadalife: {
          token: null,
        },
        rogersbank: {
          credentials: null,
        },
        wealthsimple: {
          authenticated: false,
          identityId: null,
          expiresAt: null,
        },
      });
    });

    it('should initialize empty listeners object', () => {
      expect(testStateManager.listeners).toEqual({});
    });
  });

  describe('getState', () => {
    it('should return a copy of the current state', () => {
      const state1 = testStateManager.getState();
      const state2 = testStateManager.getState();

      // Should be equal but not the same reference
      expect(state1).toEqual(state2);
      expect(state1).not.toBe(state2);
    });

    it('should return shallow copy (nested objects are still references)', () => {
      const state = testStateManager.getState();
      state.currentAccount.id = 'modified';

      const internalState = testStateManager.getState();
      // This shows current behavior - shallow copy means nested objects are still references
      expect(internalState.currentAccount.id).toBe('modified');
    });
  });

  describe('setAccount', () => {
    it('should update account information', () => {
      testStateManager.setAccount('account123', 'Test Account');

      const state = testStateManager.getState();
      expect(state.currentAccount).toEqual({
        id: 'account123',
        nickname: 'Test Account',
      });
    });

    it('should sync with global variables', () => {
      testStateManager.setAccount('account456', 'Another Account');

      expect(window.currentAccountId).toBe('account456');
      expect(window.currentAccountName).toBe('Another Account');
    });

    it('should notify listeners', () => {
      const listener = jest.fn();
      testStateManager.addListener('account', listener);

      testStateManager.setAccount('account789', 'Listener Test');

      expect(listener).toHaveBeenCalledTimes(1);
      const [newState, prevState] = listener.mock.calls[0];
      expect(newState.currentAccount.id).toBe('account789');
      expect(prevState.currentAccount.id).toBeNull();
    });
  });

  describe('setUiElement', () => {
    it('should set button container element', () => {
      const mockElement = document.createElement('div');
      testStateManager.setUiElement('buttonContainer', mockElement);

      const state = testStateManager.getState();
      expect(state.ui.buttonContainer).toBe(mockElement);
    });

    it('should set indicator elements', () => {
      const mockElement = document.createElement('span');
      testStateManager.setUiElement('questrade', mockElement);

      const state = testStateManager.getState();
      expect(state.ui.indicators.questrade).toBe(mockElement);
    });

    it('should handle all indicator types', () => {
      const indicators = ['questrade', 'questradeExpiry', 'monarch', 'lastDownloadedNote'];

      indicators.forEach((indicator, index) => {
        const mockElement = document.createElement('div');
        mockElement.id = `test-${index}`;
        testStateManager.setUiElement(indicator, mockElement);

        const state = testStateManager.getState();
        expect(state.ui.indicators[indicator]).toBe(mockElement);
      });
    });

    it('should warn about unknown UI elements', () => {
      const mockElement = document.createElement('div');
      const mockDebugLog = require('../../src/core/utils').debugLog;

      testStateManager.setUiElement('unknownElement', mockElement);

      expect(mockDebugLog).toHaveBeenCalledWith('Warning: Unknown UI element "unknownElement"');
    });

    it('should notify UI listeners', () => {
      const listener = jest.fn();
      testStateManager.addListener('ui', listener);

      const mockElement = document.createElement('div');
      testStateManager.setUiElement('buttonContainer', mockElement);

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('setQuestradeAuth', () => {
    it('should update Questrade auth token', () => {
      const tokenInfo = {
        token: 'test-token-123',
        expires_at: 1640995200, // Unix timestamp
      };

      testStateManager.setQuestradeAuth(tokenInfo);

      const state = testStateManager.getState();
      expect(state.auth.questrade).toEqual({
        token: 'test-token-123',
        expiresAt: 1640995200000, // Should be converted to milliseconds
      });
    });

    it('should handle null token info', () => {
      testStateManager.setQuestradeAuth(null);

      const state = testStateManager.getState();
      expect(state.auth.questrade).toEqual({
        token: null,
        expiresAt: 0,
      });
    });

    it('should notify auth listeners', () => {
      const listener = jest.fn();
      testStateManager.addListener('auth', listener);

      const tokenInfo = { token: 'test-token', expires_at: 1640995200 };
      testStateManager.setQuestradeAuth(tokenInfo);

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('setMonarchAuth', () => {
    it('should update Monarch auth token', () => {
      testStateManager.setMonarchAuth('monarch-token-456');

      const state = testStateManager.getState();
      expect(state.auth.monarch).toEqual({
        token: 'monarch-token-456',
      });
    });

    it('should handle null token', () => {
      testStateManager.setMonarchAuth(null);

      const state = testStateManager.getState();
      expect(state.auth.monarch).toEqual({
        token: null,
      });
    });

    it('should notify auth listeners', () => {
      const listener = jest.fn();
      testStateManager.addListener('auth', listener);

      testStateManager.setMonarchAuth('monarch-token-test');

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('setCanadaLifeAuth', () => {
    it('should update CanadaLife auth token', () => {
      testStateManager.setCanadaLifeAuth('canadalife-token-789');

      const state = testStateManager.getState();
      expect(state.auth.canadalife).toEqual({
        token: 'canadalife-token-789',
      });
    });

    it('should handle null token', () => {
      testStateManager.setCanadaLifeAuth(null);

      const state = testStateManager.getState();
      expect(state.auth.canadalife).toEqual({
        token: null,
      });
    });

    it('should notify auth listeners', () => {
      const listener = jest.fn();
      testStateManager.addListener('auth', listener);

      testStateManager.setCanadaLifeAuth('canadalife-token-test');

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('setRogersBankAuth', () => {
    it('should update Rogers Bank credentials', () => {
      const credentials = {
        username: 'testuser',
        password: 'testpass',
        deviceId: 'device123',
      };

      testStateManager.setRogersBankAuth(credentials);

      const state = testStateManager.getState();
      expect(state.auth.rogersbank).toEqual({
        credentials,
      });
    });

    it('should handle null credentials', () => {
      testStateManager.setRogersBankAuth(null);

      const state = testStateManager.getState();
      expect(state.auth.rogersbank).toEqual({
        credentials: null,
      });
    });

    it('should notify auth listeners', () => {
      const listener = jest.fn();
      testStateManager.addListener('auth', listener);

      const credentials = { username: 'test', password: 'test' };
      testStateManager.setRogersBankAuth(credentials);

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('setWealthsimpleAuth', () => {
    it('should update Wealthsimple auth information', () => {
      const authInfo = {
        authenticated: true,
        identityId: 'identity-123',
        expiresAt: '2026-01-02T22:00:00.000Z',
      };

      testStateManager.setWealthsimpleAuth(authInfo);

      const state = testStateManager.getState();
      expect(state.auth.wealthsimple).toEqual(authInfo);
    });

    it('should handle null auth info', () => {
      testStateManager.setWealthsimpleAuth(null);

      const state = testStateManager.getState();
      expect(state.auth.wealthsimple).toEqual({
        authenticated: false,
        identityId: null,
        expiresAt: null,
      });
    });

    it('should handle partial auth info', () => {
      const authInfo = {
        authenticated: true,
        identityId: 'identity-456',
      };

      testStateManager.setWealthsimpleAuth(authInfo);

      const state = testStateManager.getState();
      expect(state.auth.wealthsimple).toEqual(authInfo);
    });

    it('should notify auth listeners', () => {
      const listener = jest.fn();
      testStateManager.addListener('auth', listener);

      const authInfo = {
        authenticated: true,
        identityId: 'identity-789',
        expiresAt: '2026-01-02T22:00:00.000Z',
      };

      testStateManager.setWealthsimpleAuth(authInfo);

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('should handle clearing auth', () => {
      // First set auth
      testStateManager.setWealthsimpleAuth({
        authenticated: true,
        identityId: 'identity-999',
        expiresAt: '2026-01-02T22:00:00.000Z',
      });

      // Then clear it
      testStateManager.setWealthsimpleAuth(null);

      const state = testStateManager.getState();
      expect(state.auth.wealthsimple.authenticated).toBe(false);
      expect(state.auth.wealthsimple.identityId).toBeNull();
      expect(state.auth.wealthsimple.expiresAt).toBeNull();
    });
  });

  describe('addListener', () => {
    it('should add listener for specific event type', () => {
      const listener = jest.fn();
      const removeListener = testStateManager.addListener('account', listener);

      expect(typeof removeListener).toBe('function');
      expect(testStateManager.listeners.account).toContain(listener);
    });

    it('should add multiple listeners for same event type', () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      testStateManager.addListener('account', listener1);
      testStateManager.addListener('account', listener2);

      expect(testStateManager.listeners.account).toHaveLength(2);
      expect(testStateManager.listeners.account).toContain(listener1);
      expect(testStateManager.listeners.account).toContain(listener2);
    });

    it('should add wildcard listeners', () => {
      const listener = jest.fn();
      testStateManager.addListener('*', listener);

      expect(testStateManager.listeners['*']).toContain(listener);
    });

    it('should return function that removes the listener', () => {
      const listener = jest.fn();
      const removeListener = testStateManager.addListener('account', listener);

      expect(testStateManager.listeners.account).toContain(listener);

      removeListener();

      expect(testStateManager.listeners.account).not.toContain(listener);
    });
  });

  describe('notifyListeners', () => {
    it('should call specific listeners', () => {
      const accountListener = jest.fn();
      const authListener = jest.fn();

      testStateManager.addListener('account', accountListener);
      testStateManager.addListener('auth', authListener);

      testStateManager.setAccount('test-account', 'Test Account');

      expect(accountListener).toHaveBeenCalledTimes(1);
      expect(authListener).not.toHaveBeenCalled();
    });

    it('should call wildcard listeners for any event', () => {
      const wildcardListener = jest.fn();
      testStateManager.addListener('*', wildcardListener);

      testStateManager.setAccount('test-account', 'Test Account');
      testStateManager.setMonarchAuth('test-token');

      expect(wildcardListener).toHaveBeenCalledTimes(2);
    });

    it('should call both specific and wildcard listeners', () => {
      const specificListener = jest.fn();
      const wildcardListener = jest.fn();

      testStateManager.addListener('account', specificListener);
      testStateManager.addListener('*', wildcardListener);

      testStateManager.setAccount('test-account', 'Test Account');

      expect(specificListener).toHaveBeenCalledTimes(1);
      expect(wildcardListener).toHaveBeenCalledTimes(1);
    });

    it('should pass correct arguments to listeners', () => {
      const listener = jest.fn();
      testStateManager.addListener('account', listener);

      testStateManager.setAccount('test-account', 'Test Account');

      expect(listener).toHaveBeenCalledTimes(1);
      const [newState, prevState] = listener.mock.calls[0];

      expect(newState.currentAccount.id).toBe('test-account');
      expect(newState.currentAccount.nickname).toBe('Test Account');
      expect(prevState.currentAccount.id).toBeNull();
      expect(prevState.currentAccount.nickname).toBe('unknown');
    });
  });

  describe('integration tests', () => {
    it('should handle complex state changes with multiple listeners', () => {
      const accountListener = jest.fn();
      const authListener = jest.fn();
      const wildcardListener = jest.fn();

      testStateManager.addListener('account', accountListener);
      testStateManager.addListener('auth', authListener);
      testStateManager.addListener('*', wildcardListener);

      // Perform various state changes
      testStateManager.setAccount('account1', 'Account 1');
      testStateManager.setQuestradeAuth({ token: 'token1', expires_at: 1640995200 });
      testStateManager.setMonarchAuth('monarch-token');

      expect(accountListener).toHaveBeenCalledTimes(1);
      expect(authListener).toHaveBeenCalledTimes(2);
      expect(wildcardListener).toHaveBeenCalledTimes(3);
    });

    it('should maintain state consistency across multiple changes', () => {
      // Make multiple changes
      testStateManager.setAccount('final-account', 'Final Account');
      testStateManager.setQuestradeAuth({ token: 'final-token', expires_at: 1640995200 });
      testStateManager.setMonarchAuth('final-monarch-token');
      testStateManager.setCanadaLifeAuth('final-canadalife-token');
      testStateManager.setRogersBankAuth({ username: 'final-user' });

      const state = testStateManager.getState();

      expect(state.currentAccount.id).toBe('final-account');
      expect(state.auth.questrade.token).toBe('final-token');
      expect(state.auth.monarch.token).toBe('final-monarch-token');
      expect(state.auth.canadalife.token).toBe('final-canadalife-token');
      expect(state.auth.rogersbank.credentials.username).toBe('final-user');
    });
  });

  describe('singleton instance', () => {
    it('should export the same singleton instance', () => {
      // Import again to get the same singleton
      const stateManager2 = require('../../src/core/state').default;

      expect(stateManager).toBe(stateManager2);
    });

    it('should maintain state across imports', () => {
      stateManager.setAccount('singleton-test', 'Singleton Test');

      // Import again to get the same singleton
      const stateManager2 = require('../../src/core/state').default;
      const state = stateManager2.getState();

      expect(state.currentAccount.id).toBe('singleton-test');
    });
  });
});
