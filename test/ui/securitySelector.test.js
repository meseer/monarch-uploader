/**
 * Test suite for Security Selector Component
 */

import { jest } from '@jest/globals';

// Import after mocks
import { showMonarchSecuritySelector } from '../../src/ui/components/securitySelector';
import monarchApi from '../../src/api/monarch';

// Mock dependencies
jest.mock('../../src/core/utils', () => ({
  debugLog: jest.fn(),
}));

jest.mock('../../src/api/monarch', () => ({
  __esModule: true,
  default: {
    searchSecurities: jest.fn(),
  },
}));

jest.mock('../../src/ui/keyboardNavigation', () => ({
  addModalKeyboardHandlers: jest.fn(() => jest.fn()),
  makeItemsKeyboardNavigable: jest.fn(() => jest.fn()),
}));

describe('Security Selector Component', () => {
  let mockCallback;

  beforeEach(() => {
    // Clear mocks
    jest.clearAllMocks();

    // Set up DOM
    document.body.innerHTML = '';

    // Mock callback
    mockCallback = jest.fn();

    // Mock setTimeout to execute immediately for testing
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('showMonarchSecuritySelector', () => {
    test('should create modal with security details', async () => {
      const position = {
        security: {
          symbol: 'AAPL',
          listingMarket: 'NASDAQ',
          description: 'APPLE INC',
        },
      };

      monarchApi.searchSecurities.mockResolvedValue([]);

      showMonarchSecuritySelector(position, mockCallback);

      // Fast-forward timers
      jest.advanceTimersByTime(100);

      // Check modal was created
      const overlay = document.getElementById('security-selector-overlay');
      expect(overlay).toBeTruthy();

      const modal = document.getElementById('security-selector-modal');
      expect(modal).toBeTruthy();

      const header = document.getElementById('security-selector-header');
      expect(header).toBeTruthy();
      expect(header.textContent).toBe('Select Monarch Security');

      // Check security details are displayed
      const details = document.getElementById('security-selector-details');
      expect(details).toBeTruthy();
      expect(details.innerHTML).toContain('AAPL');
      expect(details.innerHTML).toContain('NASDAQ');
      expect(details.innerHTML).toContain('Apple Inc'); // Should be camel cased
    });

    test('should handle symbol with dot notation', async () => {
      const position = {
        security: {
          symbol: 'BRK.B',
        },
      };

      monarchApi.searchSecurities.mockResolvedValue([]);

      showMonarchSecuritySelector(position, mockCallback);
      jest.advanceTimersByTime(100);

      const searchInput = document.getElementById('security-selector-search-input');
      expect(searchInput.value).toBe('BRK'); // Should use part before dot
    });

    test('should perform initial search with symbol', async () => {
      const position = {
        security: {
          symbol: 'GOOGL',
        },
      };

      const mockSecurities = [
        {
          id: 'sec1',
          name: 'Alphabet Inc',
          ticker: 'GOOGL',
          currentPrice: 150.5,
        },
      ];

      monarchApi.searchSecurities.mockResolvedValue(mockSecurities);

      showMonarchSecuritySelector(position, mockCallback);
      jest.advanceTimersByTime(100);

      // Wait for async operations
      await Promise.resolve();
      jest.runAllTimers();

      expect(monarchApi.searchSecurities).toHaveBeenCalledWith('GOOGL', { limit: 5 });
    });

    test('should display search results', async () => {
      const position = {
        security: {
          symbol: 'TSLA',
        },
      };

      const mockSecurities = [
        {
          id: 'sec1',
          name: 'Tesla Inc',
          ticker: 'TSLA',
          currentPrice: 250.0,
          oneDayChangePercent: 2.5,
        },
      ];

      monarchApi.searchSecurities.mockResolvedValue(mockSecurities);

      showMonarchSecuritySelector(position, mockCallback);
      jest.advanceTimersByTime(100);

      await Promise.resolve();
      jest.runAllTimers();

      const securityItem = document.getElementById('security-item-sec1');
      expect(securityItem).toBeTruthy();

      const name = document.getElementById('security-name-sec1');
      expect(name.textContent).toBe('Tesla Inc');

      const details = document.getElementById('security-details-sec1');
      expect(details.textContent).toContain('TSLA');
    });

    test('should handle security selection', async () => {
      const position = {
        security: {
          symbol: 'MSFT',
        },
      };

      const mockSecurities = [
        {
          id: 'sec1',
          name: 'Microsoft',
          ticker: 'MSFT',
        },
      ];

      monarchApi.searchSecurities.mockResolvedValue(mockSecurities);

      showMonarchSecuritySelector(position, mockCallback);
      jest.advanceTimersByTime(100);

      await Promise.resolve();
      jest.runAllTimers();

      const securityItem = document.getElementById('security-item-sec1');
      securityItem.click();

      expect(mockCallback).toHaveBeenCalledWith(mockSecurities[0]);
    });

    test('should handle cancel button', async () => {
      const position = {
        security: {
          symbol: 'TEST',
        },
      };

      monarchApi.searchSecurities.mockResolvedValue([]);

      showMonarchSecuritySelector(position, mockCallback);
      jest.advanceTimersByTime(100);

      const cancelBtn = document.getElementById('security-selector-cancel');
      expect(cancelBtn).toBeTruthy();

      cancelBtn.click();

      expect(mockCallback).toHaveBeenCalledWith(null);
      expect(document.getElementById('security-selector-overlay')).toBeFalsy();
    });

    test('should handle search input with debouncing', async () => {
      const position = {
        security: {
          symbol: 'TEST',
        },
      };

      monarchApi.searchSecurities.mockResolvedValue([]);

      showMonarchSecuritySelector(position, mockCallback);
      jest.advanceTimersByTime(100);

      const searchInput = document.getElementById('security-selector-search-input');

      // Simulate typing
      searchInput.value = 'AAPL';
      searchInput.dispatchEvent(new Event('input'));

      // Should not search immediately (debouncing)
      expect(monarchApi.searchSecurities).toHaveBeenCalledTimes(1); // Only initial search

      // Fast-forward debounce timer
      jest.advanceTimersByTime(300);
      await Promise.resolve();

      expect(monarchApi.searchSecurities).toHaveBeenCalledWith('AAPL', { limit: 5 });
    });

    test('should handle empty search results', async () => {
      const position = {
        security: {
          symbol: 'NOTFOUND',
        },
      };

      monarchApi.searchSecurities.mockResolvedValue([]);

      showMonarchSecuritySelector(position, mockCallback);
      jest.advanceTimersByTime(100);

      await Promise.resolve();
      jest.runAllTimers();

      const results = document.getElementById('security-selector-results');
      expect(results.innerHTML).toContain('No securities found');
    });

    test('should handle search API errors', async () => {
      const position = {
        security: {
          symbol: 'ERROR',
        },
      };

      monarchApi.searchSecurities.mockRejectedValue(new Error('API Error'));

      showMonarchSecuritySelector(position, mockCallback);
      jest.advanceTimersByTime(100);

      await Promise.resolve();
      jest.runAllTimers();

      const results = document.getElementById('security-selector-results');
      expect(results.innerHTML).toContain('Error searching securities');
    });

    test('should display security with logo', async () => {
      const position = {
        security: {
          symbol: 'AAPL',
        },
      };

      const mockSecurities = [
        {
          id: 'sec1',
          name: 'Apple Inc',
          ticker: 'AAPL',
          logo: 'data:image/png;base64,abc123',
        },
      ];

      monarchApi.searchSecurities.mockResolvedValue(mockSecurities);

      showMonarchSecuritySelector(position, mockCallback);
      jest.advanceTimersByTime(100);

      await Promise.resolve();
      jest.runAllTimers();

      const logoImg = document.getElementById('security-logo-img-sec1');
      expect(logoImg).toBeTruthy();
      expect(logoImg.src).toContain('data:image/png;base64');
    });

    test('should display fallback logo when no logo provided', async () => {
      const position = {
        security: {
          symbol: 'TEST',
        },
      };

      const mockSecurities = [
        {
          id: 'sec1',
          name: 'Test Company',
          ticker: 'TEST',
          // No logo
        },
      ];

      monarchApi.searchSecurities.mockResolvedValue(mockSecurities);

      showMonarchSecuritySelector(position, mockCallback);
      jest.advanceTimersByTime(100);

      await Promise.resolve();
      jest.runAllTimers();

      const fallback = document.getElementById('security-logo-fallback-sec1');
      expect(fallback).toBeTruthy();
      expect(fallback.textContent).toBe('TEST');
    });

    test('should display price information', async () => {
      const position = {
        security: {
          symbol: 'NVDA',
        },
      };

      const mockSecurities = [
        {
          id: 'sec1',
          name: 'NVIDIA',
          ticker: 'NVDA',
          currentPrice: 500.25,
          oneDayChangePercent: 3.5,
        },
      ];

      monarchApi.searchSecurities.mockResolvedValue(mockSecurities);

      showMonarchSecuritySelector(position, mockCallback);
      jest.advanceTimersByTime(100);

      await Promise.resolve();
      jest.runAllTimers();

      const price = document.getElementById('security-price-sec1');
      expect(price).toBeTruthy();
      expect(price.textContent).toBe('$500.25');

      const change = document.getElementById('security-price-change-sec1');
      expect(change).toBeTruthy();
      expect(change.textContent).toBe('+3.50%');
    });

    test('should display negative price change', async () => {
      const position = {
        security: {
          symbol: 'TEST',
        },
      };

      const mockSecurities = [
        {
          id: 'sec1',
          name: 'Test Co',
          ticker: 'TEST',
          currentPrice: 100.0,
          oneDayChangePercent: -2.5,
        },
      ];

      monarchApi.searchSecurities.mockResolvedValue(mockSecurities);

      showMonarchSecuritySelector(position, mockCallback);
      jest.advanceTimersByTime(100);

      await Promise.resolve();
      jest.runAllTimers();

      const change = document.getElementById('security-price-change-sec1');
      expect(change.textContent).toBe('-2.50%');
    });

    test('should handle clicking overlay to cancel', async () => {
      const position = {
        security: {
          symbol: 'TEST',
        },
      };

      monarchApi.searchSecurities.mockResolvedValue([]);

      showMonarchSecuritySelector(position, mockCallback);
      jest.advanceTimersByTime(100);

      const overlay = document.getElementById('security-selector-overlay');

      // Simulate clicking the overlay itself (not a child)
      const event = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(event, 'target', { value: overlay, enumerable: true });
      overlay.dispatchEvent(event);

      expect(mockCallback).toHaveBeenCalledWith(null);
    });

    test('should handle missing security details gracefully', async () => {
      const position = {
        // No security object
      };

      monarchApi.searchSecurities.mockResolvedValue([]);

      showMonarchSecuritySelector(position, mockCallback);
      jest.advanceTimersByTime(100);

      const details = document.getElementById('security-selector-details');
      expect(details).toBeTruthy();
    });

    test('should show loading indicator during search', async () => {
      const position = {
        security: {
          symbol: 'TEST',
        },
      };

      // Make API call hang
      let resolveSearch;
      const searchPromise = new Promise((resolve) => {
        resolveSearch = resolve;
      });
      monarchApi.searchSecurities.mockReturnValue(searchPromise);

      showMonarchSecuritySelector(position, mockCallback);
      jest.advanceTimersByTime(100);

      await Promise.resolve();

      const loading = document.getElementById('security-selector-loading');
      expect(loading.style.display).toBe('block');

      // Resolve and check loading is hidden
      resolveSearch([]);
      await Promise.resolve();
      jest.runAllTimers();

      expect(loading.style.display).toBe('none');
    });

    test('should handle typeDisplay in security details', async () => {
      const position = {
        security: {
          symbol: 'VTI',
        },
      };

      const mockSecurities = [
        {
          id: 'sec1',
          name: 'Vanguard Total Stock Market ETF',
          ticker: 'VTI',
          typeDisplay: 'ETF',
        },
      ];

      monarchApi.searchSecurities.mockResolvedValue(mockSecurities);

      showMonarchSecuritySelector(position, mockCallback);
      jest.advanceTimersByTime(100);

      await Promise.resolve();
      jest.runAllTimers();

      const details = document.getElementById('security-details-sec1');
      expect(details.textContent).toContain('ETF');
    });

    test('should handle long ticker symbols in fallback', async () => {
      const position = {
        security: {
          symbol: 'TEST',
        },
      };

      const mockSecurities = [
        {
          id: 'sec1',
          name: 'Test Company',
          ticker: 'TESTLONG',
        },
      ];

      monarchApi.searchSecurities.mockResolvedValue(mockSecurities);

      showMonarchSecuritySelector(position, mockCallback);
      jest.advanceTimersByTime(100);

      await Promise.resolve();
      jest.runAllTimers();

      const fallback = document.getElementById('security-logo-fallback-sec1');
      expect(fallback).toBeTruthy();
      expect(fallback.textContent).toBe('TEST'); // Should truncate to 4 chars
    });
  });
});
