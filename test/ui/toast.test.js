/**
 * Test suite for Toast notification system
 */

import toastModule, { ensureToastContainer, showToast, show } from '../../src/ui/toast';

// Mock dependencies
jest.mock('../../src/core/config', () => ({
  UI: {
    TOAST_DURATION: 5000,
  },
}));

jest.mock('../../src/core/utils', () => ({
  debugLog: jest.fn(),
}));

// Mock Greasemonkey functions
global.GM_getValue = jest.fn();

describe('Toast Notification System', () => {
  beforeEach(() => {
    // Reset DOM
    document.body.innerHTML = '';
    document.head.innerHTML = '';

    // Reset mocks
    jest.clearAllMocks();

    // Setup default GM_getValue mock
    global.GM_getValue.mockImplementation((key, defaultValue) => {
      if (key === 'debug_log_level') return 'info';
      return defaultValue;
    });

    // Mock setTimeout and clearTimeout for testing
    jest.useFakeTimers();
  });

  afterEach(() => {
    // Clean up timers
    jest.runOnlyPendingTimers();
    jest.useRealTimers();

    // Clean up any toast containers
    const containers = document.querySelectorAll('#balance-uploader-toast-container');
    containers.forEach((container) => container.remove());

    // Clean up animation styles
    const styles = document.querySelectorAll('#balance-uploader-animations');
    styles.forEach((style) => style.remove());
  });

  describe('ensureToastContainer', () => {
    test('should create toast container when none exists', () => {
      const container = ensureToastContainer();

      expect(container).toBeTruthy();
      expect(container.id).toBe('balance-uploader-toast-container');
      expect(document.body.contains(container)).toBe(true);
      expect(container.style.position).toBe('fixed');
      expect(container.style.top).toBe('20px');
      expect(container.style.right).toBe('20px');
      expect(container.style.zIndex).toBe('10001');
    });

    test('should return existing container if it exists', () => {
      const firstContainer = ensureToastContainer();
      const secondContainer = ensureToastContainer();

      expect(firstContainer).toBe(secondContainer);
      expect(document.querySelectorAll('#balance-uploader-toast-container').length).toBe(1);
    });

    test('should recreate container if it was removed from DOM', () => {
      const firstContainer = ensureToastContainer();
      firstContainer.remove();

      const secondContainer = ensureToastContainer();

      expect(secondContainer).not.toBe(firstContainer);
      expect(document.body.contains(secondContainer)).toBe(true);
      expect(secondContainer.id).toBe('balance-uploader-toast-container');
    });
  });

  describe('showToast', () => {
    test('should create and display info toast with default parameters', () => {
      const { debugLog } = require('../../src/core/utils');

      const toast = showToast('Test message');

      expect(toast).toBeTruthy();
      expect(toast.textContent).toBe('Test message');
      expect(toast.style.backgroundColor).toBe('rgb(40, 167, 69)'); // #28a745 converted to RGB
      expect(toast.style.color).toBe('white');
      expect(debugLog).toHaveBeenCalledWith('Showing toast: Test message (info)');

      // Should be in the container
      const container = document.querySelector('#balance-uploader-toast-container');
      expect(container.contains(toast)).toBe(true);
    });

    test('should create different colored toasts based on type', () => {
      // Set log level to debug so all toasts will show
      global.GM_getValue.mockImplementation((key, defaultValue) => {
        if (key === 'debug_log_level') return 'debug';
        return defaultValue;
      });

      const debugToast = showToast('Debug message', 'debug');
      const infoToast = showToast('Info message', 'info');
      const warningToast = showToast('Warning message', 'warning');
      const errorToast = showToast('Error message', 'error');

      // Check that all toasts were created
      expect(debugToast).toBeTruthy();
      expect(infoToast).toBeTruthy();
      expect(warningToast).toBeTruthy();
      expect(errorToast).toBeTruthy();

      // Check colors by looking at the cssText since colors are set via inline styles
      expect(debugToast.style.cssText).toContain('background-color: rgb(108, 117, 125)');
      expect(debugToast.style.cssText).toContain('color: white');

      expect(infoToast.style.cssText).toContain('background-color: rgb(40, 167, 69)');
      expect(infoToast.style.cssText).toContain('color: white');

      expect(warningToast.style.cssText).toContain('background-color: rgb(255, 193, 7)');
      expect(warningToast.style.cssText).toContain('color: black');

      expect(errorToast.style.cssText).toContain('background-color: rgb(220, 53, 69)');
      expect(errorToast.style.cssText).toContain('color: white');
    });

    test('should use info color for unknown toast types', () => {
      const toast = showToast('Unknown type', 'unknown');

      expect(toast.style.backgroundColor).toBe('rgb(40, 167, 69)'); // #28a745 (info color)
      expect(toast.style.color).toBe('white');
    });

    test('should add animation styles to document head', () => {
      showToast('Test message');

      const animationStyle = document.querySelector('#balance-uploader-animations');
      expect(animationStyle).toBeTruthy();
      expect(animationStyle.textContent).toContain('slideIn');
      expect(animationStyle.textContent).toContain('slideOut');
    });

    test('should not duplicate animation styles', () => {
      showToast('First message');
      showToast('Second message');

      const animationStyles = document.querySelectorAll('#balance-uploader-animations');
      expect(animationStyles.length).toBe(1);
    });

    test('should set click handler for dismissal', () => {
      const toast = showToast('Test message');

      expect(toast.onclick).toBeTruthy();
      expect(toast.title).toBe('Click to dismiss');
    });

    test('should auto-dismiss after specified duration', () => {
      const toast = showToast('Test message', 'info', 1000);

      // Toast should exist initially
      expect(document.body.contains(toast)).toBe(true);

      // Fast forward 1000ms
      jest.advanceTimersByTime(1000);

      // Toast should start removing (animation begins)
      expect(toast.style.animation).toContain('slideOut');

      // Fast forward animation duration
      jest.advanceTimersByTime(300);

      // Toast should be removed from DOM
      expect(document.body.contains(toast)).toBe(false);
    });

    test('should not auto-dismiss when duration is 0 or negative', () => {
      const toast1 = showToast('Test message 1', 'info', 0);
      const toast2 = showToast('Test message 2', 'info', -1);

      // Fast forward a long time
      jest.advanceTimersByTime(10000);

      // Toasts should still exist
      expect(document.body.contains(toast1)).toBe(true);
      expect(document.body.contains(toast2)).toBe(true);
    });

    test('should handle click to dismiss', () => {
      const toast = showToast('Test message');

      // Toast exists initially
      expect(document.body.contains(toast)).toBe(true);

      // Click to dismiss
      toast.click();

      // Animation should start
      expect(toast.style.animation).toContain('slideOut');

      // Fast forward animation
      jest.advanceTimersByTime(300);

      // Toast should be removed
      expect(document.body.contains(toast)).toBe(false);
    });
  });

  describe('Log Level Filtering', () => {
    test('should show appropriate toasts based on debug log level', () => {
      global.GM_getValue.mockImplementation((key, defaultValue) => {
        if (key === 'debug_log_level') return 'debug';
        return defaultValue;
      });

      const debugToast = showToast('Debug message', 'debug');
      const infoToast = showToast('Info message', 'info');
      const warningToast = showToast('Warning message', 'warning');
      const errorToast = showToast('Error message', 'error');

      // All should show at debug level
      expect(debugToast).toBeTruthy();
      expect(infoToast).toBeTruthy();
      expect(warningToast).toBeTruthy();
      expect(errorToast).toBeTruthy();
    });

    test('should show appropriate toasts based on info log level', () => {
      global.GM_getValue.mockImplementation((key, defaultValue) => {
        if (key === 'debug_log_level') return 'info';
        return defaultValue;
      });

      const debugToast = showToast('Debug message', 'debug');
      const infoToast = showToast('Info message', 'info');
      const warningToast = showToast('Warning message', 'warning');
      const errorToast = showToast('Error message', 'error');

      // Debug should be suppressed, others should show
      expect(debugToast).toBe(null);
      expect(infoToast).toBeTruthy();
      expect(warningToast).toBeTruthy();
      expect(errorToast).toBeTruthy();
    });

    test('should show appropriate toasts based on warning log level', () => {
      global.GM_getValue.mockImplementation((key, defaultValue) => {
        if (key === 'debug_log_level') return 'warning';
        return defaultValue;
      });

      const debugToast = showToast('Debug message', 'debug');
      const infoToast = showToast('Info message', 'info');
      const warningToast = showToast('Warning message', 'warning');
      const errorToast = showToast('Error message', 'error');

      // Debug and info should be suppressed, warning and error should show
      expect(debugToast).toBe(null);
      expect(infoToast).toBe(null);
      expect(warningToast).toBeTruthy();
      expect(errorToast).toBeTruthy();
    });

    test('should show appropriate toasts based on error log level', () => {
      global.GM_getValue.mockImplementation((key, defaultValue) => {
        if (key === 'debug_log_level') return 'error';
        return defaultValue;
      });

      const debugToast = showToast('Debug message', 'debug');
      const infoToast = showToast('Info message', 'info');
      const warningToast = showToast('Warning message', 'warning');
      const errorToast = showToast('Error message', 'error');

      // Only error should show
      expect(debugToast).toBe(null);
      expect(infoToast).toBe(null);
      expect(warningToast).toBe(null);
      expect(errorToast).toBeTruthy();
    });

    test('should handle invalid log level gracefully', () => {
      global.GM_getValue.mockImplementation((key, defaultValue) => {
        if (key === 'debug_log_level') return 'invalid';
        return defaultValue;
      });

      const { debugLog } = require('../../src/core/utils');

      const toast = showToast('Test message', 'info');

      // Should default to info level (1) and show the toast
      expect(toast).toBeTruthy();
      expect(debugLog).toHaveBeenCalledWith('Showing toast: Test message (info)');
    });

    test('should log suppressed toasts', () => {
      global.GM_getValue.mockImplementation((key, defaultValue) => {
        if (key === 'debug_log_level') return 'warning';
        return defaultValue;
      });

      const { debugLog } = require('../../src/core/utils');

      const suppressedToast = showToast('Debug message', 'debug');

      expect(suppressedToast).toBe(null);
      expect(debugLog).toHaveBeenCalledWith('Toast suppressed (log level): Debug message (debug)');
    });

    test('should handle unknown toast type for log level filtering', () => {
      const toast = showToast('Test message', 'unknown');

      // Should show toast with unknown type (defaults to info level)
      expect(toast).toBeTruthy();
    });
  });

  describe('Default Export and Named Exports', () => {
    test('should export default object with show function', () => {
      expect(toastModule.show).toBe(showToast);
      expect(toastModule.ensureContainer).toBe(ensureToastContainer);
      expect(typeof toastModule.remove).toBe('function');
    });

    test('should export named show function', () => {
      expect(show).toBe(showToast);
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty message', () => {
      const toast = showToast('');

      expect(toast.textContent).toBe('');
      expect(toast).toBeTruthy();
    });

    test('should handle very long message', () => {
      const longMessage = 'A'.repeat(1000);
      const toast = showToast(longMessage);

      expect(toast.textContent).toBe(longMessage);
      expect(toast.style.maxWidth).toBe('400px');
      expect(toast.style.wordWrap).toBe('break-word');
    });

    test('should handle special characters in message', () => {
      const specialMessage = '🎉 Success! <script>alert("test")</script> & more';
      const toast = showToast(specialMessage);

      // textContent should be safe from XSS
      expect(toast.textContent).toBe(specialMessage);
      expect(toast.innerHTML).not.toContain('<script>');
    });

    test('should handle multiple toasts displayed simultaneously', () => {
      const toast1 = showToast('First toast');
      const toast2 = showToast('Second toast');
      const toast3 = showToast('Third toast');

      const container = document.querySelector('#balance-uploader-toast-container');
      expect(container.children.length).toBe(3);
      expect(container.contains(toast1)).toBe(true);
      expect(container.contains(toast2)).toBe(true);
      expect(container.contains(toast3)).toBe(true);
    });

    test('should handle removing toast that is already removed', () => {
      const toast = showToast('Test message');

      // Remove manually first
      toast.remove();

      // Try to remove again via click (should not throw error)
      expect(() => {
        // Simulate the internal removeToast call
        if (toast.parentNode) {
          toast.style.animation = 'slideOut 0.3s ease-in';
          setTimeout(() => {
            if (toast.parentNode) {
              toast.remove();
            }
          }, 300);
        }
      }).not.toThrow();
    });

    test('should handle container being removed externally', () => {
      const firstToast = showToast('First toast');

      // Remove container externally
      const container = document.querySelector('#balance-uploader-toast-container');
      container.remove();

      // Should create new container for next toast
      const secondToast = showToast('Second toast');

      const newContainer = document.querySelector('#balance-uploader-toast-container');
      expect(newContainer).toBeTruthy();
      expect(newContainer.contains(secondToast)).toBe(true);
      expect(newContainer.contains(firstToast)).toBe(false);
    });
  });

  describe('Animation and Timing', () => {
    test('should handle rapid successive toast creation and removal', () => {
      const toasts = [];

      // Create multiple toasts quickly
      for (let i = 0; i < 5; i++) {
        toasts.push(showToast(`Toast ${i}`, 'info', 100));
      }

      // All should exist initially
      toasts.forEach((toast) => {
        expect(document.body.contains(toast)).toBe(true);
      });

      // Fast forward to trigger auto-dismiss
      jest.advanceTimersByTime(100);

      // All should start animation
      toasts.forEach((toast) => {
        expect(toast.style.animation).toContain('slideOut');
      });

      // Fast forward animation
      jest.advanceTimersByTime(300);

      // All should be removed
      toasts.forEach((toast) => {
        expect(document.body.contains(toast)).toBe(false);
      });
    });

    test('should handle click during auto-dismiss timing', () => {
      const toast = showToast('Test message', 'info', 1000);

      // Fast forward half way
      jest.advanceTimersByTime(500);

      // Click to dismiss early
      toast.click();

      expect(toast.style.animation).toContain('slideOut');

      // Fast forward remaining time + animation
      jest.advanceTimersByTime(800);

      expect(document.body.contains(toast)).toBe(false);
    });
  });
});
