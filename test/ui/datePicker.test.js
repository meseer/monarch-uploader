/**
 * Tests for Date Picker Component
 */

import { showDatePicker, showDatePickerPromise } from '../../src/ui/components/datePicker';

// Mock dependencies
jest.mock('../../src/core/utils', () => ({
  debugLog: jest.fn(),
}));

jest.mock('../../src/ui/keyboardNavigation', () => ({
  addModalKeyboardHandlers: jest.fn(() => jest.fn()), // Return cleanup function
  trapFocus: jest.fn(() => jest.fn()), // Return cleanup function
}));

jest.mock('../../src/ui/toast', () => ({
  __esModule: true,
  default: {
    show: jest.fn(),
  },
}));

describe('Date Picker Component', () => {
  let container;

  beforeEach(() => {
    // Create a container element for our tests
    container = document.createElement('div');
    document.body.appendChild(container);

    // Clear all mocks
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Clean up DOM after each test
    const modals = document.querySelectorAll('[style*="position: fixed"]');
    modals.forEach((modal) => modal.remove());

    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  describe('showDatePickerPromise', () => {
    test('should return a promise that resolves with selected date', async () => {
      const defaultDate = '2024-01-15';
      const promptText = 'Select a date';

      // Start the date picker
      const datePickerPromise = showDatePickerPromise(defaultDate, promptText);

      // Wait for DOM to be ready
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Find the modal and select button
      const modal = document.querySelector('[style*="position: fixed"]');
      expect(modal).toBeTruthy();

      const selectBtn = Array.from(modal.querySelectorAll('button')).find(
        (btn) => btn.textContent === 'Select',
      );
      expect(selectBtn).toBeTruthy();

      // Click select button
      selectBtn.click();

      // Should resolve with the default date
      const result = await datePickerPromise;
      expect(result).toBe(defaultDate);
    });

    test('should return a promise that resolves with null when cancelled', async () => {
      const defaultDate = '2024-01-15';
      const promptText = 'Select a date';

      // Start the date picker
      const datePickerPromise = showDatePickerPromise(defaultDate, promptText);

      // Wait for DOM to be ready
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Find the modal and cancel button
      const modal = document.querySelector('[style*="position: fixed"]');
      const cancelBtn = Array.from(modal.querySelectorAll('button')).find(
        (btn) => btn.textContent === 'Cancel',
      );

      // Click cancel button
      cancelBtn.click();

      // Should resolve with null
      const result = await datePickerPromise;
      expect(result).toBeNull();
    });

    test('should return a promise that resolves with null when clicking outside', async () => {
      const defaultDate = '2024-01-15';
      const promptText = 'Select a date';

      // Start the date picker
      const datePickerPromise = showDatePickerPromise(defaultDate, promptText);

      // Wait for DOM to be ready
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Find the overlay
      const overlay = document.querySelector('[style*="position: fixed"]');
      expect(overlay).toBeTruthy();

      // Click on the overlay (outside the modal)
      overlay.click();

      // Should resolve with null
      const result = await datePickerPromise;
      expect(result).toBeNull();
    });

    test('should return a promise that resolves with modified date', async () => {
      const defaultDate = '2024-01-15';
      const newDate = '2024-02-20';
      const promptText = 'Select a date';

      // Start the date picker
      const datePickerPromise = showDatePickerPromise(defaultDate, promptText);

      // Wait for DOM to be ready
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Find the modal and date input
      const modal = document.querySelector('[style*="position: fixed"]');
      const dateInput = modal.querySelector('input[type="date"]');
      const selectBtn = Array.from(modal.querySelectorAll('button')).find(
        (btn) => btn.textContent === 'Select',
      );

      // Change the date
      dateInput.value = newDate;

      // Click select button
      selectBtn.click();

      // Should resolve with the new date
      const result = await datePickerPromise;
      expect(result).toBe(newDate);
    });
  });

  describe('showDatePicker', () => {
    test('should create modal with correct structure', () => {
      const defaultDate = '2024-01-15';
      const promptText = 'Please select a start date';
      const callback = jest.fn();

      showDatePicker(defaultDate, promptText, callback);

      // Check overlay exists
      const overlay = document.querySelector('[style*="position: fixed"]');
      expect(overlay).toBeTruthy();
      expect(overlay.style.position).toBe('fixed');
      expect(overlay.style.zIndex).toBe('10000');

      // Check modal structure
      const modal = overlay.querySelector('div');
      expect(modal).toBeTruthy();

      // Check title
      const title = modal.querySelector('h2');
      expect(title).toBeTruthy();
      expect(title.textContent).toBe('Select Start Date');

      // Check description
      const description = modal.querySelector('p');
      expect(description).toBeTruthy();
      expect(description.textContent).toBe(promptText);

      // Check date input
      const dateInput = modal.querySelector('input[type="date"]');
      expect(dateInput).toBeTruthy();
      expect(dateInput.value).toBe(defaultDate);

      // Check buttons
      const buttons = modal.querySelectorAll('button');
      expect(buttons).toHaveLength(2);

      const cancelBtn = Array.from(buttons).find((btn) => btn.textContent === 'Cancel');
      const selectBtn = Array.from(buttons).find((btn) => btn.textContent === 'Select');

      expect(cancelBtn).toBeTruthy();
      expect(selectBtn).toBeTruthy();
    });

    test('should call callback with selected date when select button is clicked', () => {
      const defaultDate = '2024-01-15';
      const promptText = 'Select a date';
      const callback = jest.fn();

      showDatePicker(defaultDate, promptText, callback);

      const modal = document.querySelector('[style*="position: fixed"]');
      const selectBtn = Array.from(modal.querySelectorAll('button')).find(
        (btn) => btn.textContent === 'Select',
      );

      selectBtn.click();

      expect(callback).toHaveBeenCalledWith(defaultDate);
    });

    test('should call callback with null when cancel button is clicked', () => {
      const defaultDate = '2024-01-15';
      const promptText = 'Select a date';
      const callback = jest.fn();

      showDatePicker(defaultDate, promptText, callback);

      const modal = document.querySelector('[style*="position: fixed"]');
      const cancelBtn = Array.from(modal.querySelectorAll('button')).find(
        (btn) => btn.textContent === 'Cancel',
      );

      cancelBtn.click();

      expect(callback).toHaveBeenCalledWith(null);
    });

    test('should call callback with null when clicking outside modal', () => {
      const defaultDate = '2024-01-15';
      const promptText = 'Select a date';
      const callback = jest.fn();

      showDatePicker(defaultDate, promptText, callback);

      const overlay = document.querySelector('[style*="position: fixed"]');

      // Simulate click on overlay (not on modal)
      const clickEvent = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(clickEvent, 'target', { value: overlay, configurable: true });
      overlay.onclick(clickEvent);

      expect(callback).toHaveBeenCalledWith(null);
    });

    test('should not close when clicking on modal content', () => {
      const defaultDate = '2024-01-15';
      const promptText = 'Select a date';
      const callback = jest.fn();

      showDatePicker(defaultDate, promptText, callback);

      const overlay = document.querySelector('[style*="position: fixed"]');
      const modal = overlay.querySelector('div');

      // Simulate click on modal (not on overlay)
      const clickEvent = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(clickEvent, 'target', { value: modal, configurable: true });
      overlay.onclick(clickEvent);

      expect(callback).not.toHaveBeenCalled();
    });

    test('should update date input value and use it in callback', () => {
      const defaultDate = '2024-01-15';
      const newDate = '2024-03-10';
      const promptText = 'Select a date';
      const callback = jest.fn();

      showDatePicker(defaultDate, promptText, callback);

      const modal = document.querySelector('[style*="position: fixed"]');
      const dateInput = modal.querySelector('input[type="date"]');
      const selectBtn = Array.from(modal.querySelectorAll('button')).find(
        (btn) => btn.textContent === 'Select',
      );

      // Change the date input
      dateInput.value = newDate;
      selectBtn.click();

      expect(callback).toHaveBeenCalledWith(newDate);
    });

    test('should remove modal from DOM when cancelled', () => {
      const defaultDate = '2024-01-15';
      const promptText = 'Select a date';
      const callback = jest.fn();

      showDatePicker(defaultDate, promptText, callback);

      let modal = document.querySelector('[style*="position: fixed"]');
      expect(modal).toBeTruthy();

      const cancelBtn = Array.from(modal.querySelectorAll('button')).find(
        (btn) => btn.textContent === 'Cancel',
      );

      cancelBtn.click();

      // Modal should be removed from DOM
      modal = document.querySelector('[style*="position: fixed"]');
      expect(modal).toBeFalsy();
    });

    test('should remove modal from DOM when selected', () => {
      const defaultDate = '2024-01-15';
      const promptText = 'Select a date';
      const callback = jest.fn();

      showDatePicker(defaultDate, promptText, callback);

      let modal = document.querySelector('[style*="position: fixed"]');
      expect(modal).toBeTruthy();

      const selectBtn = Array.from(modal.querySelectorAll('button')).find(
        (btn) => btn.textContent === 'Select',
      );

      selectBtn.click();

      // Modal should be removed from DOM
      modal = document.querySelector('[style*="position: fixed"]');
      expect(modal).toBeFalsy();
    });
  });

  describe('Date validation', () => {
    test('should show error toast for invalid date format', () => {
      const toast = jest.requireMock('../../src/ui/toast').default;
      const defaultDate = '2024-01-15';
      const promptText = 'Select a date';
      const callback = jest.fn();

      showDatePicker(defaultDate, promptText, callback);

      const modal = document.querySelector('[style*="position: fixed"]');
      const dateInput = modal.querySelector('input[type="date"]');
      const selectBtn = Array.from(modal.querySelectorAll('button')).find(
        (btn) => btn.textContent === 'Select',
      );

      // Set invalid date
      dateInput.value = 'invalid-date';
      selectBtn.click();

      expect(toast.show).toHaveBeenCalledWith('Please select a valid date', 'error');
      expect(callback).not.toHaveBeenCalled();

      // Modal should still be open
      const stillOpenModal = document.querySelector('[style*="position: fixed"]');
      expect(stillOpenModal).toBeTruthy();
    });

    test('should show error toast for empty date', () => {
      const toast = jest.requireMock('../../src/ui/toast').default;
      const defaultDate = '2024-01-15';
      const promptText = 'Select a date';
      const callback = jest.fn();

      showDatePicker(defaultDate, promptText, callback);

      const modal = document.querySelector('[style*="position: fixed"]');
      const dateInput = modal.querySelector('input[type="date"]');
      const selectBtn = Array.from(modal.querySelectorAll('button')).find(
        (btn) => btn.textContent === 'Select',
      );

      // Clear date
      dateInput.value = '';
      selectBtn.click();

      expect(toast.show).toHaveBeenCalledWith('Please select a valid date', 'error');
      expect(callback).not.toHaveBeenCalled();
    });

    test('should accept valid date format', () => {
      const toast = jest.requireMock('../../src/ui/toast').default;
      const defaultDate = '2024-01-15';
      const validDate = '2024-12-25';
      const promptText = 'Select a date';
      const callback = jest.fn();

      showDatePicker(defaultDate, promptText, callback);

      const modal = document.querySelector('[style*="position: fixed"]');
      const dateInput = modal.querySelector('input[type="date"]');
      const selectBtn = Array.from(modal.querySelectorAll('button')).find(
        (btn) => btn.textContent === 'Select',
      );

      // Set valid date
      dateInput.value = validDate;
      selectBtn.click();

      expect(toast.show).not.toHaveBeenCalled();
      expect(callback).toHaveBeenCalledWith(validDate);
    });
  });

  describe('Keyboard navigation integration', () => {
    test('should set up keyboard handlers', () => {
      const { addModalKeyboardHandlers, trapFocus } = jest.requireMock('../../src/ui/keyboardNavigation');
      const defaultDate = '2024-01-15';
      const promptText = 'Select a date';
      const callback = jest.fn();

      showDatePicker(defaultDate, promptText, callback);

      expect(addModalKeyboardHandlers).toHaveBeenCalled();
      expect(trapFocus).toHaveBeenCalled();

      // Check that addModalKeyboardHandlers was called with correct parameters
      const callArgs = addModalKeyboardHandlers.mock.calls[0];
      expect(callArgs).toHaveLength(3); // overlay, onEscape, onEnter
      expect(callArgs[0]).toBeTruthy(); // overlay element
      expect(typeof callArgs[1]).toBe('function'); // onEscape callback
      expect(typeof callArgs[2]).toBe('function'); // onEnter callback
    });

    test('should set up focus trapping', () => {
      const { trapFocus } = jest.requireMock('../../src/ui/keyboardNavigation');
      const defaultDate = '2024-01-15';
      const promptText = 'Select a date';
      const callback = jest.fn();

      showDatePicker(defaultDate, promptText, callback);

      expect(trapFocus).toHaveBeenCalled();

      // Should be called with the modal element
      const callArgs = trapFocus.mock.calls[0];
      expect(callArgs).toHaveLength(1);
      expect(callArgs[0]).toBeTruthy(); // modal element
    });

    test('should handle Enter key on date input', () => {
      const defaultDate = '2024-01-15';
      const promptText = 'Select a date';
      const callback = jest.fn();

      showDatePicker(defaultDate, promptText, callback);

      const modal = document.querySelector('[style*="position: fixed"]');
      const dateInput = modal.querySelector('input[type="date"]');

      // Simulate Enter key press on date input
      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter' });
      enterEvent.preventDefault = jest.fn();
      dateInput.dispatchEvent(enterEvent);

      expect(enterEvent.preventDefault).toHaveBeenCalled();
      expect(callback).toHaveBeenCalledWith(defaultDate);
    });

    test('should focus date input initially', () => {
      const defaultDate = '2024-01-15';
      const promptText = 'Select a date';
      const callback = jest.fn();

      // Mock focus method
      const focusSpy = jest.fn();
      const originalCreateElement = document.createElement;
      document.createElement = jest.fn((tagName) => {
        const element = originalCreateElement.call(document, tagName);
        if (tagName === 'input') {
          element.focus = focusSpy;
        }
        return element;
      });

      showDatePicker(defaultDate, promptText, callback);

      expect(focusSpy).toHaveBeenCalled();

      // Restore original createElement
      document.createElement = originalCreateElement;
    });

    test('should cleanup keyboard handlers when modal is closed', () => {
      const { addModalKeyboardHandlers, trapFocus } = jest.requireMock('../../src/ui/keyboardNavigation');

      // Mock cleanup functions
      const mockModalCleanup = jest.fn();
      const mockTrapCleanup = jest.fn();
      addModalKeyboardHandlers.mockReturnValue(mockModalCleanup);
      trapFocus.mockReturnValue(mockTrapCleanup);

      const defaultDate = '2024-01-15';
      const promptText = 'Select a date';
      const callback = jest.fn();

      showDatePicker(defaultDate, promptText, callback);

      const modal = document.querySelector('[style*="position: fixed"]');
      const cancelBtn = Array.from(modal.querySelectorAll('button')).find(
        (btn) => btn.textContent === 'Cancel',
      );

      // Close the modal
      cancelBtn.click();

      // Cleanup functions should have been called
      expect(mockModalCleanup).toHaveBeenCalled();
      expect(mockTrapCleanup).toHaveBeenCalled();
    });
  });

  describe('Button styling and interaction', () => {
    test('should style cancel button correctly', () => {
      const defaultDate = '2024-01-15';
      const promptText = 'Select a date';
      const callback = jest.fn();

      showDatePicker(defaultDate, promptText, callback);

      const modal = document.querySelector('[style*="position: fixed"]');
      const cancelBtn = Array.from(modal.querySelectorAll('button')).find(
        (btn) => btn.textContent === 'Cancel',
      );

      expect(cancelBtn.style.background).toBe('white');
      expect(cancelBtn.style.border).toContain('1px solid');
      expect(cancelBtn.style.cursor).toBe('pointer');
    });

    test('should style select button correctly', () => {
      const defaultDate = '2024-01-15';
      const promptText = 'Select a date';
      const callback = jest.fn();

      showDatePicker(defaultDate, promptText, callback);

      const modal = document.querySelector('[style*="position: fixed"]');
      const selectBtn = Array.from(modal.querySelectorAll('button')).find(
        (btn) => btn.textContent === 'Select',
      );

      // Accept both hex and RGB color formats (JSDOM returns RGB)
      expect(selectBtn.style.background).toMatch(/#007bff|rgb\(0,\s*123,\s*255\)/);
      expect(selectBtn.style.color).toBe('white');
      expect(selectBtn.style.border).toMatch(/none|^$/); // Accept either "none" or empty string
      expect(selectBtn.style.cursor).toBe('pointer');
    });

    test('should style date input correctly', () => {
      const defaultDate = '2024-01-15';
      const promptText = 'Select a date';
      const callback = jest.fn();

      showDatePicker(defaultDate, promptText, callback);

      const modal = document.querySelector('[style*="position: fixed"]');
      const dateInput = modal.querySelector('input[type="date"]');

      expect(dateInput.style.width).toBe('100%');
      expect(dateInput.style.fontSize).toBe('16px');
      expect(dateInput.style.border).toContain('1px solid');
      expect(dateInput.style.boxSizing).toBe('border-box');
    });
  });

  describe('Modal layout and positioning', () => {
    test('should position overlay correctly', () => {
      const defaultDate = '2024-01-15';
      const promptText = 'Select a date';
      const callback = jest.fn();

      showDatePicker(defaultDate, promptText, callback);

      const overlay = document.querySelector('[style*="position: fixed"]');

      expect(overlay.style.position).toBe('fixed');
      expect(overlay.style.top).toMatch(/^0(px)?$/);
      expect(overlay.style.left).toMatch(/^0(px)?$/);
      expect(overlay.style.width).toBe('100%');
      expect(overlay.style.height).toBe('100%');
      expect(overlay.style.display).toBe('flex');
      expect(overlay.style.alignItems).toBe('center');
      expect(overlay.style.justifyContent).toBe('center');
    });

    test('should style modal content correctly', () => {
      const defaultDate = '2024-01-15';
      const promptText = 'Select a date';
      const callback = jest.fn();

      showDatePicker(defaultDate, promptText, callback);

      const overlay = document.querySelector('[style*="position: fixed"]');
      const modal = overlay.querySelector('div');

      expect(modal.style.background).toBe('white');
      expect(modal.style.padding).toBe('25px');
      expect(modal.style.borderRadius).toBe('8px');
      expect(modal.style.width).toBe('90%');
      expect(modal.style.maxWidth).toBe('400px');
    });

    test('should organize buttons in flex container', () => {
      const defaultDate = '2024-01-15';
      const promptText = 'Select a date';
      const callback = jest.fn();

      showDatePicker(defaultDate, promptText, callback);

      const modal = document.querySelector('[style*="position: fixed"]');
      const buttons = modal.querySelectorAll('button');
      const buttonContainer = buttons[0].parentElement;

      // Check that buttons exist
      expect(buttons).toHaveLength(2);

      // Check that the button container uses flex layout
      expect(buttonContainer.style.display).toBe('flex');
      expect(buttonContainer.style.justifyContent).toContain('flex-end');
    });
  });

  describe('Debug logging', () => {
    test('should log debug messages', () => {
      const { debugLog } = jest.requireMock('../../src/core/utils');
      const defaultDate = '2024-01-15';
      const promptText = 'Select a date';
      const callback = jest.fn();

      showDatePicker(defaultDate, promptText, callback);

      expect(debugLog).toHaveBeenCalledWith('Showing date picker with default date:', defaultDate);
      expect(debugLog).toHaveBeenCalledWith('Date picker modal displayed with keyboard navigation');
    });
  });

  describe('Edge cases and error handling', () => {
    test('should handle multiple modals gracefully', () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      // Create first modal
      showDatePicker('2024-01-15', 'First picker', callback1);

      // Create second modal
      showDatePicker('2024-02-20', 'Second picker', callback2);

      // Both modals should exist
      const modals = document.querySelectorAll('[style*="position: fixed"]');
      expect(modals).toHaveLength(2);

      // Cancel both
      modals[0].querySelector('button[style*="white"]').click();
      modals[1].querySelector('button[style*="white"]').click();

      expect(callback1).toHaveBeenCalledWith(null);
      expect(callback2).toHaveBeenCalledWith(null);
    });

    test('should handle missing callback gracefully', () => {
      const defaultDate = '2024-01-15';
      const promptText = 'Select a date';

      // Should not throw when callback is undefined
      expect(() => {
        showDatePicker(defaultDate, promptText, undefined);
      }).not.toThrow();

      // Should not throw when callback is null
      expect(() => {
        showDatePicker(defaultDate, promptText, null);
      }).not.toThrow();
    });

    test('should handle empty or invalid default date', () => {
      const promptText = 'Select a date';
      const callback = jest.fn();

      // Empty default date
      showDatePicker('', promptText, callback);

      let modal = document.querySelector('[style*="position: fixed"]');
      let dateInput = modal.querySelector('input[type="date"]');
      expect(dateInput.value).toBe('');

      // Clean up
      modal.remove();

      // Invalid default date
      showDatePicker('invalid-date', promptText, callback);

      modal = document.querySelector('[style*="position: fixed"]');
      dateInput = modal.querySelector('input[type="date"]');
      expect(dateInput.value).toBe(''); // Browser/JSDOM clears invalid date values
    });

    test('should handle very long prompt text', () => {
      const defaultDate = '2024-01-15';
      const longPromptText = 'A'.repeat(1000); // Very long text
      const callback = jest.fn();

      showDatePicker(defaultDate, longPromptText, callback);

      const modal = document.querySelector('[style*="position: fixed"]');
      const description = modal.querySelector('p');

      expect(description.textContent).toBe(longPromptText);
      expect(description.textContent.length).toBe(1000);
    });
  });
});
