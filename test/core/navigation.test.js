/**
 * Navigation Manager Tests
 */

import { NavigationManager } from '../../src/core/navigation';
import stateManager from '../../src/core/state';
import accountService from '../../src/services/account';
import uiManager from '../../src/ui/uiManager';

// Mock dependencies
jest.mock('../../src/core/utils', () => ({
  debugLog: jest.fn(),
}));

jest.mock('../../src/core/state', () => ({
  setAccount: jest.fn(),
}));

jest.mock('../../src/services/account', () => ({
  loadCurrentAccountInfo: jest.fn(),
}));

jest.mock('../../src/ui/uiManager', () => ({
  initSingleAccountUI: jest.fn(),
}));

describe('NavigationManager', () => {
  let navigationManager;

  beforeEach(() => {
    jest.clearAllMocks();
    navigationManager = new NavigationManager();
    
    // Set up default location mock for each test
    delete window.location;
    window.location = {
      href: 'https://questrade.com/accounts/12345',
      pathname: '/accounts/12345',
      hostname: 'questrade.com',
      origin: 'https://questrade.com'
    };
    
    // Mock setInterval/clearInterval
    global.setInterval = jest.fn((fn, delay) => {
      return setTimeout(fn, delay);
    });
    global.clearInterval = jest.fn();
    
    // Mock addEventListener
    global.addEventListener = jest.fn();
    window.addEventListener = jest.fn();
    
    // Mock getElementById
    document.getElementById = jest.fn();
  });

  afterEach(() => {
    navigationManager.stopMonitoring();
  });

  describe('URL extraction', () => {
    it('should extract account ID from valid account URL', () => {
      window.location.pathname = '/accounts/12345';
      const accountId = navigationManager.extractAccountIdFromUrl();
      expect(accountId).toBe('12345');
    });

    it('should return null for non-account URLs', () => {
      window.location.pathname = '/dashboard';
      const accountId = navigationManager.extractAccountIdFromUrl();
      expect(accountId).toBeNull();
    });

    it('should handle complex account IDs', () => {
      window.location.pathname = '/accounts/ABC-123-XYZ';
      const accountId = navigationManager.extractAccountIdFromUrl();
      expect(accountId).toBe('ABC-123-XYZ');
    });
  });

  describe('monitoring', () => {
    it('should start monitoring and set initial account ID', () => {
      window.location.pathname = '/accounts/54321';
      
      navigationManager.startMonitoring();
      
      expect(navigationManager.getCurrentAccountId()).toBe('54321');
      expect(window.addEventListener).toHaveBeenCalledWith('popstate', expect.any(Function));
      expect(global.setInterval).toHaveBeenCalledWith(expect.any(Function), 500);
    });

    it('should not start monitoring twice', () => {
      navigationManager.startMonitoring();
      navigationManager.startMonitoring();
      
      expect(global.setInterval).toHaveBeenCalledTimes(1);
    });

    it('should stop monitoring correctly', () => {
      navigationManager.startMonitoring();
      navigationManager.stopMonitoring();
      
      expect(global.clearInterval).toHaveBeenCalled();
    });
  });

  describe('account change handling', () => {
    it('should handle account change correctly', async () => {
      const mockAccount = { id: '67890', name: 'Test Account' };
      accountService.loadCurrentAccountInfo.mockResolvedValue(mockAccount);
      uiManager.initSingleAccountUI.mockResolvedValue();
      
      await navigationManager.handleAccountChange('67890');
      
      expect(navigationManager.getCurrentAccountId()).toBe('67890');
      expect(accountService.loadCurrentAccountInfo).toHaveBeenCalled();
      expect(uiManager.initSingleAccountUI).toHaveBeenCalled();
    });

    it('should handle navigation away from account page', () => {
      navigationManager.currentAccountId = '12345';
      
      navigationManager.handleNavigateAwayFromAccount();
      
      expect(navigationManager.getCurrentAccountId()).toBeNull();
      expect(stateManager.setAccount).toHaveBeenCalledWith(null, 'unknown');
    });
  });

  describe('URL change detection', () => {
    it('should detect URL changes and handle them', () => {
      const handleUrlChangeSpy = jest.spyOn(navigationManager, 'handleUrlChange');
      
      navigationManager.currentUrl = 'https://questrade.com/accounts/12345';
      window.location.href = 'https://questrade.com/accounts/67890';
      
      navigationManager.checkUrlChange();
      
      expect(handleUrlChangeSpy).toHaveBeenCalled();
    });

    it('should not trigger change handler for same URL', () => {
      const handleUrlChangeSpy = jest.spyOn(navigationManager, 'handleUrlChange');
      
      navigationManager.currentUrl = 'https://questrade.com/accounts/12345';
      window.location.href = 'https://questrade.com/accounts/12345';
      
      navigationManager.checkUrlChange();
      
      expect(handleUrlChangeSpy).not.toHaveBeenCalled();
    });
  });

  describe('UI reinitialization', () => {
    it('should update existing UI without removing container', async () => {
      uiManager.initSingleAccountUI.mockResolvedValue();
      
      await navigationManager.reinitializeAccountUI();
      
      expect(uiManager.initSingleAccountUI).toHaveBeenCalled();
    });

    it('should handle UI update gracefully', async () => {
      uiManager.initSingleAccountUI.mockResolvedValue();
      
      await navigationManager.reinitializeAccountUI();
      
      expect(uiManager.initSingleAccountUI).toHaveBeenCalled();
    });
  });

  describe('force refresh', () => {
    it('should force refresh current account context', async () => {
      window.location.pathname = '/accounts/99999';
      const handleAccountChangeSpy = jest.spyOn(navigationManager, 'handleAccountChange');
      
      await navigationManager.forceRefresh();
      
      expect(handleAccountChangeSpy).toHaveBeenCalledWith('99999');
    });

    it('should not refresh if not on account page', async () => {
      window.location.pathname = '/dashboard';
      const handleAccountChangeSpy = jest.spyOn(navigationManager, 'handleAccountChange');
      
      await navigationManager.forceRefresh();
      
      expect(handleAccountChangeSpy).not.toHaveBeenCalled();
    });
  });
});
