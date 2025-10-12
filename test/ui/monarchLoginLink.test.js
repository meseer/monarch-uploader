/**
 * Tests for Monarch Login Link Component
 */

import {
  createMonarchLoginLink,
  isMonarchConnected,
  ensureMonarchAuthentication,
} from '../../src/ui/components/monarchLoginLink';

// Mock dependencies
jest.mock('../../src/core/utils', () => ({
  debugLog: jest.fn(),
}));

jest.mock('../../src/core/config', () => ({
  STORAGE: {
    MONARCH_TOKEN: 'monarch_token',
  },
}));

jest.mock('../../src/core/state', () => ({
  notifyListeners: jest.fn(),
}));

jest.mock('../../src/ui/toast', () => ({
  __esModule: true,
  default: {
    show: jest.fn(),
  },
}));

// Mock global functions
global.GM_getValue = jest.fn();
global.window = Object.create(window);

describe('Monarch Login Link Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Mock window.open
    global.window.open = jest.fn();

    // Mock window.screen
    global.window.screen = {
      width: 1920,
      height: 1080,
    };

    // Reset GM_getValue mock
    global.GM_getValue.mockReturnValue(null);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('createMonarchLoginLink', () => {
    test('should create link element with default text', () => {
      const link = createMonarchLoginLink();

      expect(link.tagName).toBe('SPAN');
      expect(link.textContent).toBe('Monarch: Not connected');
      expect(link.style.color).toBe('rgb(220, 53, 69)');
      expect(link.style.cursor).toBe('pointer');
      expect(link.style.textDecoration).toBe('underline');
    });

    test('should create link element with custom text', () => {
      const customText = 'Connect to Monarch';
      const link = createMonarchLoginLink(customText);

      expect(link.textContent).toBe(customText);
    });

    test('should apply hover effects', () => {
      const link = createMonarchLoginLink();

      // Simulate mouseenter
      const mouseEnterEvent = new Event('mouseenter');
      link.dispatchEvent(mouseEnterEvent);
      expect(link.style.color).toBe('rgb(167, 30, 42)');

      // Simulate mouseleave
      const mouseLeaveEvent = new Event('mouseleave');
      link.dispatchEvent(mouseLeaveEvent);
      expect(link.style.color).toBe('rgb(220, 53, 69)');
    });

    test('should handle click events and open popup', () => {
      const mockPopup = {
        closed: false,
        close: jest.fn(),
      };
      global.window.open.mockReturnValue(mockPopup);

      const onSuccess = jest.fn();
      const link = createMonarchLoginLink('Test Link', onSuccess);

      const clickEvent = new Event('click');
      clickEvent.preventDefault = jest.fn();
      clickEvent.stopPropagation = jest.fn();

      link.dispatchEvent(clickEvent);

      expect(clickEvent.preventDefault).toHaveBeenCalled();
      expect(clickEvent.stopPropagation).toHaveBeenCalled();
      expect(global.window.open).toHaveBeenCalledWith(
        'https://app.monarchmoney.com/dashboard',
        'monarchLogin',
        expect.stringContaining('width=500,height=600'),
      );
    });

    test('should handle popup blocked scenario', () => {
      global.window.open.mockReturnValue(null);
      const toast = jest.requireMock('../../src/ui/toast').default;

      const link = createMonarchLoginLink();
      const clickEvent = new Event('click');
      clickEvent.preventDefault = jest.fn();
      clickEvent.stopPropagation = jest.fn();

      link.dispatchEvent(clickEvent);

      expect(toast.show).toHaveBeenCalledWith(
        'Popup blocked. Please allow popups for this site and try again.',
        'error',
        5000,
      );
    });

    test('should handle popup opening errors', () => {
      global.window.open.mockImplementation(() => {
        throw new Error('Popup error');
      });
      const toast = jest.requireMock('../../src/ui/toast').default;

      const link = createMonarchLoginLink();
      const clickEvent = new Event('click');
      clickEvent.preventDefault = jest.fn();
      clickEvent.stopPropagation = jest.fn();

      link.dispatchEvent(clickEvent);

      expect(toast.show).toHaveBeenCalledWith('Failed to open login popup', 'error');
    });

    test('should calculate popup position correctly', () => {
      const mockPopup = { closed: false, close: jest.fn() };
      global.window.open.mockReturnValue(mockPopup);

      const link = createMonarchLoginLink();
      const clickEvent = new Event('click');
      clickEvent.preventDefault = jest.fn();
      clickEvent.stopPropagation = jest.fn();

      link.dispatchEvent(clickEvent);

      // Expected left: (1920 - 500) / 2 = 710
      // Expected top: (1080 - 600) / 2 = 240
      const expectedFeatures = expect.stringContaining('left=710,top=240');
      expect(global.window.open).toHaveBeenCalledWith(
        'https://app.monarchmoney.com/dashboard',
        'monarchLogin',
        expectedFeatures,
      );
    });
  });

  describe('isMonarchConnected', () => {
    test('should return true when token exists', () => {
      global.GM_getValue.mockReturnValue('mock-token');

      const result = isMonarchConnected();

      expect(result).toBe(true);
      expect(global.GM_getValue).toHaveBeenCalledWith('monarch_token');
    });

    test('should return false when token is null', () => {
      global.GM_getValue.mockReturnValue(null);

      const result = isMonarchConnected();

      expect(result).toBe(false);
    });

    test('should return false when token is empty string', () => {
      global.GM_getValue.mockReturnValue('');

      const result = isMonarchConnected();

      expect(result).toBe(false);
    });

    test('should return false when token is undefined', () => {
      global.GM_getValue.mockReturnValue(undefined);

      const result = isMonarchConnected();

      expect(result).toBe(false);
    });
  });

  describe('ensureMonarchAuthentication', () => {
    test('should resolve immediately if already connected', async () => {
      global.GM_getValue.mockReturnValue('existing-token');
      const onSuccess = jest.fn();

      const result = await ensureMonarchAuthentication(onSuccess, 'test upload');

      expect(result).toBe(true);
      expect(onSuccess).toHaveBeenCalled();
    });

    test('should show toast and open popup if not connected', async () => {
      global.GM_getValue.mockReturnValue(null);
      const toast = jest.requireMock('../../src/ui/toast').default;
      const mockPopup = { closed: false, close: jest.fn() };
      global.window.open.mockReturnValue(mockPopup);

      ensureMonarchAuthentication(null, 'test upload');

      expect(toast.show).toHaveBeenCalledWith(
        'Please log in to Monarch Money to test upload',
        'info',
        3000,
      );
      expect(global.window.open).toHaveBeenCalled();

      // Don't await the promise as it's designed to wait for user interaction
    });

    test('should use default context message', async () => {
      global.GM_getValue.mockReturnValue(null);
      const toast = jest.requireMock('../../src/ui/toast').default;
      const mockPopup = { closed: false, close: jest.fn() };
      global.window.open.mockReturnValue(mockPopup);

      ensureMonarchAuthentication();

      expect(toast.show).toHaveBeenCalledWith(
        'Please log in to Monarch Money to upload data',
        'info',
        3000,
      );
    });
  });

  describe('popup monitoring', () => {
    test('should detect successful login when token becomes available', () => {
      const mockPopup = { closed: false, close: jest.fn() };
      global.window.open.mockReturnValue(mockPopup);
      const onSuccess = jest.fn();
      const toast = jest.requireMock('../../src/ui/toast').default;
      const stateManager = jest.requireMock('../../src/core/state');

      // Initially no token
      global.GM_getValue.mockReturnValue(null);

      const link = createMonarchLoginLink('Test', onSuccess);
      const clickEvent = new Event('click');
      clickEvent.preventDefault = jest.fn();
      clickEvent.stopPropagation = jest.fn();

      link.dispatchEvent(clickEvent);

      // Simulate token becoming available
      global.GM_getValue.mockReturnValue('new-token');

      // Advance timer to trigger interval check
      jest.advanceTimersByTime(1000);

      expect(mockPopup.close).toHaveBeenCalled();
      expect(toast.show).toHaveBeenCalledWith(
        'Successfully connected to Monarch Money!',
        'info',
        3000,
      );
      expect(stateManager.notifyListeners).toHaveBeenCalledWith('auth');
      expect(onSuccess).toHaveBeenCalled();
    });

    test('should handle popup closure without token', () => {
      const mockPopup = { closed: false, close: jest.fn() };
      global.window.open.mockReturnValue(mockPopup);
      const onSuccess = jest.fn();

      global.GM_getValue.mockReturnValue(null);

      const link = createMonarchLoginLink('Test', onSuccess);
      const clickEvent = new Event('click');
      clickEvent.preventDefault = jest.fn();
      clickEvent.stopPropagation = jest.fn();

      link.dispatchEvent(clickEvent);

      // Simulate popup being closed
      mockPopup.closed = true;

      // Advance timer to trigger interval check
      jest.advanceTimersByTime(1000);

      // Should check for token one final time when popup closes
      expect(global.GM_getValue).toHaveBeenCalled();
    });

    test('should handle popup closure with token detected', () => {
      const mockPopup = { closed: false, close: jest.fn() };
      global.window.open.mockReturnValue(mockPopup);
      const onSuccess = jest.fn();
      const toast = jest.requireMock('../../src/ui/toast').default;

      global.GM_getValue.mockReturnValue(null);

      const link = createMonarchLoginLink('Test', onSuccess);
      const clickEvent = new Event('click');
      clickEvent.preventDefault = jest.fn();
      clickEvent.stopPropagation = jest.fn();

      link.dispatchEvent(clickEvent);

      // Simulate popup being closed but token is now available
      mockPopup.closed = true;
      global.GM_getValue.mockReturnValue('final-token');

      // Advance timer to trigger interval check
      jest.advanceTimersByTime(1000);

      expect(toast.show).toHaveBeenCalledWith(
        'Successfully connected to Monarch Money!',
        'info',
        3000,
      );
      expect(onSuccess).toHaveBeenCalled();
    });

    test('should handle timeout after 10 minutes', () => {
      const mockPopup = { closed: false, close: jest.fn() };
      global.window.open.mockReturnValue(mockPopup);
      const toast = jest.requireMock('../../src/ui/toast').default;

      global.GM_getValue.mockReturnValue(null);

      const link = createMonarchLoginLink();
      const clickEvent = new Event('click');
      clickEvent.preventDefault = jest.fn();
      clickEvent.stopPropagation = jest.fn();

      link.dispatchEvent(clickEvent);

      // Advance timer to 10 minutes
      jest.advanceTimersByTime(600000);

      expect(mockPopup.close).toHaveBeenCalled();
      expect(toast.show).toHaveBeenCalledWith(
        'Login timeout. Please try again if needed.',
        'warning',
      );
    });

    test('should handle popup close error during timeout', () => {
      const mockPopup = { closed: false, close: jest.fn(() => { throw new Error('Close error'); }) };
      global.window.open.mockReturnValue(mockPopup);
      const toast = jest.requireMock('../../src/ui/toast').default;

      global.GM_getValue.mockReturnValue(null);

      const link = createMonarchLoginLink();
      const clickEvent = new Event('click');
      clickEvent.preventDefault = jest.fn();
      clickEvent.stopPropagation = jest.fn();

      link.dispatchEvent(clickEvent);

      // Should not throw when close fails
      expect(() => {
        jest.advanceTimersByTime(600000);
      }).not.toThrow();

      expect(toast.show).toHaveBeenCalledWith(
        'Login timeout. Please try again if needed.',
        'warning',
      );
    });

    test('should handle popup close error during success', () => {
      const mockPopup = { closed: false, close: jest.fn(() => { throw new Error('Close error'); }) };
      global.window.open.mockReturnValue(mockPopup);
      const onSuccess = jest.fn();
      const toast = jest.requireMock('../../src/ui/toast').default;

      global.GM_getValue.mockReturnValue(null);

      const link = createMonarchLoginLink('Test', onSuccess);
      const clickEvent = new Event('click');
      clickEvent.preventDefault = jest.fn();
      clickEvent.stopPropagation = jest.fn();

      link.dispatchEvent(clickEvent);

      // Simulate successful token detection
      global.GM_getValue.mockReturnValue('success-token');

      // Should not throw when close fails
      expect(() => {
        jest.advanceTimersByTime(1000);
      }).not.toThrow();

      expect(toast.show).toHaveBeenCalledWith(
        'Successfully connected to Monarch Money!',
        'info',
        3000,
      );
      expect(onSuccess).toHaveBeenCalled();
    });

    test('should handle monitoring errors gracefully', () => {
      const mockPopup = { closed: false, close: jest.fn() };
      global.window.open.mockReturnValue(mockPopup);

      // Mock GM_getValue to throw error
      global.GM_getValue.mockImplementation(() => {
        throw new Error('Storage error');
      });

      const link = createMonarchLoginLink();
      const clickEvent = new Event('click');
      clickEvent.preventDefault = jest.fn();
      clickEvent.stopPropagation = jest.fn();

      link.dispatchEvent(clickEvent);

      // Should not throw when GM_getValue fails
      expect(() => {
        jest.advanceTimersByTime(1000);
      }).not.toThrow();
    });
  });

  describe('success callback error handling', () => {
    test('should handle success callback errors gracefully', () => {
      const mockPopup = { closed: false, close: jest.fn() };
      global.window.open.mockReturnValue(mockPopup);
      const onSuccess = jest.fn(() => { throw new Error('Callback error'); });
      const toast = jest.requireMock('../../src/ui/toast').default;

      global.GM_getValue.mockReturnValue(null);

      const link = createMonarchLoginLink('Test', onSuccess);
      const clickEvent = new Event('click');
      clickEvent.preventDefault = jest.fn();
      clickEvent.stopPropagation = jest.fn();

      link.dispatchEvent(clickEvent);

      // Simulate successful login
      global.GM_getValue.mockReturnValue('success-token');

      // Should not throw when callback fails
      expect(() => {
        jest.advanceTimersByTime(1000);
      }).not.toThrow();

      expect(toast.show).toHaveBeenCalledWith(
        'Successfully connected to Monarch Money!',
        'info',
        3000,
      );
      expect(onSuccess).toHaveBeenCalled();
    });

    test('should handle missing onSuccess callback', () => {
      const mockPopup = { closed: false, close: jest.fn() };
      global.window.open.mockReturnValue(mockPopup);
      const toast = jest.requireMock('../../src/ui/toast').default;

      global.GM_getValue.mockReturnValue(null);

      const link = createMonarchLoginLink();
      const clickEvent = new Event('click');
      clickEvent.preventDefault = jest.fn();
      clickEvent.stopPropagation = jest.fn();

      link.dispatchEvent(clickEvent);

      // Simulate successful login with no callback
      global.GM_getValue.mockReturnValue('success-token');

      expect(() => {
        jest.advanceTimersByTime(1000);
      }).not.toThrow();

      expect(toast.show).toHaveBeenCalledWith(
        'Successfully connected to Monarch Money!',
        'info',
        3000,
      );
    });
  });

  describe('popup window features', () => {
    test('should include all required popup features', () => {
      const mockPopup = { closed: false, close: jest.fn() };
      global.window.open.mockReturnValue(mockPopup);

      const link = createMonarchLoginLink();
      const clickEvent = new Event('click');
      clickEvent.preventDefault = jest.fn();
      clickEvent.stopPropagation = jest.fn();

      link.dispatchEvent(clickEvent);

      const expectedFeatures = [
        'width=500',
        'height=600',
        'left=710',
        'top=240',
        'scrollbars=yes',
        'resizable=yes',
        'toolbar=no',
        'menubar=no',
        'location=no',
        'directories=no',
        'status=no',
      ].join(',');

      expect(global.window.open).toHaveBeenCalledWith(
        'https://app.monarchmoney.com/dashboard',
        'monarchLogin',
        expectedFeatures,
      );
    });
  });

  describe('toast notifications', () => {
    test('should show loading toast when opening popup', () => {
      const mockPopup = { closed: false, close: jest.fn() };
      global.window.open.mockReturnValue(mockPopup);
      const toast = jest.requireMock('../../src/ui/toast').default;

      const link = createMonarchLoginLink();
      const clickEvent = new Event('click');
      clickEvent.preventDefault = jest.fn();
      clickEvent.stopPropagation = jest.fn();

      link.dispatchEvent(clickEvent);

      expect(toast.show).toHaveBeenCalledWith(
        'Opening Monarch Money login...',
        'info',
        2000,
      );
    });
  });

  describe('default export', () => {
    test('should export default object with required methods', () => {
      const defaultExport = require('../../src/ui/components/monarchLoginLink').default;

      expect(defaultExport).toHaveProperty('createMonarchLoginLink');
      expect(defaultExport).toHaveProperty('isMonarchConnected');
      expect(defaultExport).toHaveProperty('ensureMonarchAuthentication');
    });
  });

  describe('edge cases', () => {
    test('should handle multiple popup monitoring sessions', () => {
      const mockPopup1 = { closed: false, close: jest.fn() };
      const mockPopup2 = { closed: false, close: jest.fn() };
      global.window.open.mockReturnValueOnce(mockPopup1).mockReturnValueOnce(mockPopup2);

      global.GM_getValue.mockReturnValue(null);

      // Create two links and click both
      const link1 = createMonarchLoginLink();
      const link2 = createMonarchLoginLink();

      const clickEvent1 = new Event('click');
      clickEvent1.preventDefault = jest.fn();
      clickEvent1.stopPropagation = jest.fn();

      const clickEvent2 = new Event('click');
      clickEvent2.preventDefault = jest.fn();
      clickEvent2.stopPropagation = jest.fn();

      link1.dispatchEvent(clickEvent1);
      link2.dispatchEvent(clickEvent2);

      expect(global.window.open).toHaveBeenCalledTimes(2);

      // Simulate token becoming available - should affect both
      global.GM_getValue.mockReturnValue('shared-token');
      jest.advanceTimersByTime(1000);

      expect(mockPopup1.close).toHaveBeenCalled();
      expect(mockPopup2.close).toHaveBeenCalled();
    });

    test('should handle screen size edge cases', () => {
      global.window.screen = { width: 400, height: 300 };
      const mockPopup = { closed: false, close: jest.fn() };
      global.window.open.mockReturnValue(mockPopup);

      const link = createMonarchLoginLink();
      const clickEvent = new Event('click');
      clickEvent.preventDefault = jest.fn();
      clickEvent.stopPropagation = jest.fn();

      link.dispatchEvent(clickEvent);

      // With small screen, popup should be positioned at 0,0 (or negative values)
      const call = global.window.open.mock.calls[0];
      const features = call[2];

      expect(features).toContain('width=500');
      expect(features).toContain('height=600');
    });
  });
});
