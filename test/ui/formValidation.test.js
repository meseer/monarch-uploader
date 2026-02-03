/**
 * @jest-environment jsdom
 */

import {
  showFieldError,
  clearFieldError,
  clearAllFieldErrors,
  validateRequired,
  validateDateFormat,
  validateNumberRange,
  validateMinNumber,
  validateSelection,
  validateDateRange,
  addBlurValidation,
} from '../../src/ui/components/formValidation';

describe('formValidation', () => {
  let container;
  let inputElement;

  beforeEach(() => {
    container = document.createElement('div');
    container.id = 'test-container';
    document.body.appendChild(container);

    inputElement = document.createElement('input');
    inputElement.id = 'test-input';
    inputElement.type = 'text';
    container.appendChild(inputElement);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('showFieldError', () => {
    test('displays error message below input', () => {
      showFieldError(inputElement, 'Test error message');

      const errorContainer = container.querySelector('.form-validation-error');
      expect(errorContainer).not.toBeNull();
      expect(errorContainer.textContent).toBe('Test error message');
    });

    test('applies red border to input', () => {
      showFieldError(inputElement, 'Test error');

      // Browser normalizes hex color to rgb
      expect(inputElement.style.border).toBe('1px solid rgb(220, 53, 69)');
    });

    test('sets aria-invalid attribute', () => {
      showFieldError(inputElement, 'Test error');

      expect(inputElement.getAttribute('aria-invalid')).toBe('true');
    });

    test('sets aria-describedby to error container id', () => {
      showFieldError(inputElement, 'Test error');

      expect(inputElement.getAttribute('aria-describedby')).toBe('test-input-error');
    });

    test('stores original border style', () => {
      inputElement.style.border = '2px solid blue';
      showFieldError(inputElement, 'Test error');

      expect(inputElement.dataset.originalBorder).toBe('2px solid blue');
    });

    test('updates existing error message', () => {
      showFieldError(inputElement, 'First error');
      showFieldError(inputElement, 'Second error');

      const errorContainers = container.querySelectorAll('.form-validation-error');
      expect(errorContainers.length).toBe(1);
      expect(errorContainers[0].textContent).toBe('Second error');
    });

    test('handles null input gracefully', () => {
      expect(() => showFieldError(null, 'Test error')).not.toThrow();
    });

    test('handles input without id', () => {
      const noIdInput = document.createElement('input');
      container.appendChild(noIdInput);

      showFieldError(noIdInput, 'Test error');

      const errorContainer = container.querySelector('.form-validation-error[data-for="input"]');
      expect(errorContainer).not.toBeNull();
    });
  });

  describe('clearFieldError', () => {
    test('removes error message container', () => {
      showFieldError(inputElement, 'Test error');
      clearFieldError(inputElement);

      const errorContainer = container.querySelector('.form-validation-error');
      expect(errorContainer).toBeNull();
    });

    test('restores original border style', () => {
      inputElement.style.border = '2px solid blue';
      showFieldError(inputElement, 'Test error');
      clearFieldError(inputElement);

      expect(inputElement.style.border).toBe('2px solid blue');
    });

    test('removes aria-invalid attribute', () => {
      showFieldError(inputElement, 'Test error');
      clearFieldError(inputElement);

      expect(inputElement.hasAttribute('aria-invalid')).toBe(false);
    });

    test('removes aria-describedby attribute', () => {
      showFieldError(inputElement, 'Test error');
      clearFieldError(inputElement);

      expect(inputElement.hasAttribute('aria-describedby')).toBe(false);
    });

    test('handles null input gracefully', () => {
      expect(() => clearFieldError(null)).not.toThrow();
    });

    test('handles input without existing error', () => {
      expect(() => clearFieldError(inputElement)).not.toThrow();
    });
  });

  describe('clearAllFieldErrors', () => {
    test('removes all error containers in container', () => {
      const input2 = document.createElement('input');
      input2.id = 'test-input-2';
      container.appendChild(input2);

      showFieldError(inputElement, 'Error 1');
      showFieldError(input2, 'Error 2');

      clearAllFieldErrors(container);

      const errorContainers = container.querySelectorAll('.form-validation-error');
      expect(errorContainers.length).toBe(0);
    });

    test('restores all input borders', () => {
      const input2 = document.createElement('input');
      input2.id = 'test-input-2';
      input2.style.border = '1px solid green';
      container.appendChild(input2);

      inputElement.style.border = '1px solid black';

      showFieldError(inputElement, 'Error 1');
      showFieldError(input2, 'Error 2');

      clearAllFieldErrors(container);

      expect(inputElement.style.border).toBe('1px solid black');
      expect(input2.style.border).toBe('1px solid green');
    });

    test('removes aria attributes from all inputs', () => {
      const input2 = document.createElement('input');
      input2.id = 'test-input-2';
      container.appendChild(input2);

      showFieldError(inputElement, 'Error 1');
      showFieldError(input2, 'Error 2');

      clearAllFieldErrors(container);

      expect(inputElement.hasAttribute('aria-invalid')).toBe(false);
      expect(input2.hasAttribute('aria-invalid')).toBe(false);
    });

    test('handles null container gracefully', () => {
      expect(() => clearAllFieldErrors(null)).not.toThrow();
    });

    test('handles empty container', () => {
      const emptyContainer = document.createElement('div');
      expect(() => clearAllFieldErrors(emptyContainer)).not.toThrow();
    });
  });

  describe('validateRequired', () => {
    test('returns true for non-empty value', () => {
      inputElement.value = 'test value';
      expect(validateRequired(inputElement)).toBe(true);
    });

    test('returns false for empty value', () => {
      inputElement.value = '';
      expect(validateRequired(inputElement)).toBe(false);
    });

    test('returns false for whitespace-only value', () => {
      inputElement.value = '   ';
      expect(validateRequired(inputElement)).toBe(false);
    });

    test('shows default error message', () => {
      inputElement.value = '';
      validateRequired(inputElement);

      const errorContainer = container.querySelector('.form-validation-error');
      expect(errorContainer.textContent).toBe('This field is required');
    });

    test('shows custom error message', () => {
      inputElement.value = '';
      validateRequired(inputElement, 'Please fill this field');

      const errorContainer = container.querySelector('.form-validation-error');
      expect(errorContainer.textContent).toBe('Please fill this field');
    });

    test('clears error when valid', () => {
      inputElement.value = '';
      validateRequired(inputElement);
      inputElement.value = 'test';
      validateRequired(inputElement);

      const errorContainer = container.querySelector('.form-validation-error');
      expect(errorContainer).toBeNull();
    });

    test('handles null input', () => {
      expect(validateRequired(null)).toBe(false);
    });
  });

  describe('validateDateFormat', () => {
    test('returns true for valid YYYY-MM-DD date', () => {
      inputElement.value = '2024-01-15';
      expect(validateDateFormat(inputElement)).toBe(true);
    });

    test('returns false for empty value', () => {
      inputElement.value = '';
      expect(validateDateFormat(inputElement)).toBe(false);
    });

    test('returns false for invalid format', () => {
      inputElement.value = '01-15-2024';
      expect(validateDateFormat(inputElement)).toBe(false);
    });

    test('returns false for invalid date values', () => {
      inputElement.value = '2024-13-45';
      expect(validateDateFormat(inputElement)).toBe(false);
    });

    test('shows default error message', () => {
      inputElement.value = 'invalid';
      validateDateFormat(inputElement);

      const errorContainer = container.querySelector('.form-validation-error');
      expect(errorContainer.textContent).toBe('Please select a valid date');
    });

    test('shows custom error message', () => {
      inputElement.value = '';
      validateDateFormat(inputElement, 'Date is required');

      const errorContainer = container.querySelector('.form-validation-error');
      expect(errorContainer.textContent).toBe('Date is required');
    });

    test('clears error when valid', () => {
      inputElement.value = 'invalid';
      validateDateFormat(inputElement);
      inputElement.value = '2024-01-15';
      validateDateFormat(inputElement);

      const errorContainer = container.querySelector('.form-validation-error');
      expect(errorContainer).toBeNull();
    });

    test('handles null input', () => {
      expect(validateDateFormat(null)).toBe(false);
    });
  });

  describe('validateNumberRange', () => {
    test('returns true for number within range', () => {
      inputElement.value = '50';
      expect(validateNumberRange(inputElement, 0, 100)).toBe(true);
    });

    test('returns true for number at minimum', () => {
      inputElement.value = '0';
      expect(validateNumberRange(inputElement, 0, 100)).toBe(true);
    });

    test('returns true for number at maximum', () => {
      inputElement.value = '100';
      expect(validateNumberRange(inputElement, 0, 100)).toBe(true);
    });

    test('returns false for number below minimum', () => {
      inputElement.value = '-1';
      expect(validateNumberRange(inputElement, 0, 100)).toBe(false);
    });

    test('returns false for number above maximum', () => {
      inputElement.value = '101';
      expect(validateNumberRange(inputElement, 0, 100)).toBe(false);
    });

    test('returns false for non-numeric value', () => {
      inputElement.value = 'abc';
      expect(validateNumberRange(inputElement, 0, 100)).toBe(false);
    });

    test('returns false for empty value', () => {
      inputElement.value = '';
      expect(validateNumberRange(inputElement, 0, 100)).toBe(false);
    });

    test('shows custom error message', () => {
      inputElement.value = '150';
      validateNumberRange(inputElement, 0, 100, 'Must be between 0 and 100');

      const errorContainer = container.querySelector('.form-validation-error');
      expect(errorContainer.textContent).toBe('Must be between 0 and 100');
    });

    test('shows default range message', () => {
      inputElement.value = '150';
      validateNumberRange(inputElement, 0, 100);

      const errorContainer = container.querySelector('.form-validation-error');
      expect(errorContainer.textContent).toBe('Please enter a number between 0 and 100');
    });

    test('handles null input', () => {
      expect(validateNumberRange(null, 0, 100)).toBe(false);
    });
  });

  describe('validateMinNumber', () => {
    test('returns true for number at minimum', () => {
      inputElement.value = '5';
      expect(validateMinNumber(inputElement, 5)).toBe(true);
    });

    test('returns true for number above minimum', () => {
      inputElement.value = '10';
      expect(validateMinNumber(inputElement, 5)).toBe(true);
    });

    test('returns false for number below minimum', () => {
      inputElement.value = '4';
      expect(validateMinNumber(inputElement, 5)).toBe(false);
    });

    test('returns false for non-numeric value', () => {
      inputElement.value = 'abc';
      expect(validateMinNumber(inputElement, 0)).toBe(false);
    });

    test('returns false for empty value', () => {
      inputElement.value = '';
      expect(validateMinNumber(inputElement, 0)).toBe(false);
    });

    test('uses default minimum of 0', () => {
      inputElement.value = '-1';
      expect(validateMinNumber(inputElement)).toBe(false);

      inputElement.value = '0';
      expect(validateMinNumber(inputElement)).toBe(true);
    });

    test('shows custom error message', () => {
      inputElement.value = '2';
      validateMinNumber(inputElement, 5, 'Must be at least 5');

      const errorContainer = container.querySelector('.form-validation-error');
      expect(errorContainer.textContent).toBe('Must be at least 5');
    });

    test('handles null input', () => {
      expect(validateMinNumber(null, 0)).toBe(false);
    });
  });

  describe('validateSelection', () => {
    let selectElement;

    beforeEach(() => {
      selectElement = document.createElement('select');
      selectElement.id = 'test-select';

      const defaultOption = document.createElement('option');
      defaultOption.value = '';
      defaultOption.textContent = 'Select an option';

      const option1 = document.createElement('option');
      option1.value = 'option1';
      option1.textContent = 'Option 1';

      selectElement.appendChild(defaultOption);
      selectElement.appendChild(option1);
      container.appendChild(selectElement);
    });

    test('returns true for selected value', () => {
      selectElement.value = 'option1';
      expect(validateSelection(selectElement)).toBe(true);
    });

    test('returns false for empty value', () => {
      selectElement.value = '';
      expect(validateSelection(selectElement)).toBe(false);
    });

    test('returns false for "null" string value', () => {
      const nullOption = document.createElement('option');
      nullOption.value = 'null';
      selectElement.appendChild(nullOption);
      selectElement.value = 'null';

      expect(validateSelection(selectElement)).toBe(false);
    });

    test('returns false for "undefined" string value', () => {
      const undefinedOption = document.createElement('option');
      undefinedOption.value = 'undefined';
      selectElement.appendChild(undefinedOption);
      selectElement.value = 'undefined';

      expect(validateSelection(selectElement)).toBe(false);
    });

    test('shows default error message', () => {
      selectElement.value = '';
      validateSelection(selectElement);

      const errorContainer = container.querySelector('.form-validation-error');
      expect(errorContainer.textContent).toBe('Please select an option');
    });

    test('shows custom error message', () => {
      selectElement.value = '';
      validateSelection(selectElement, 'Please select an account');

      const errorContainer = container.querySelector('.form-validation-error');
      expect(errorContainer.textContent).toBe('Please select an account');
    });

    test('clears error when valid', () => {
      selectElement.value = '';
      validateSelection(selectElement);
      selectElement.value = 'option1';
      validateSelection(selectElement);

      const errorContainer = container.querySelector('.form-validation-error');
      expect(errorContainer).toBeNull();
    });

    test('handles null input', () => {
      expect(validateSelection(null)).toBe(false);
    });
  });

  describe('validateDateRange', () => {
    let startDateInput;
    let endDateInput;

    beforeEach(() => {
      startDateInput = document.createElement('input');
      startDateInput.id = 'start-date';
      startDateInput.type = 'date';
      container.appendChild(startDateInput);

      endDateInput = document.createElement('input');
      endDateInput.id = 'end-date';
      endDateInput.type = 'date';
      container.appendChild(endDateInput);
    });

    test('returns true when end date is after start date', () => {
      startDateInput.value = '2024-01-01';
      endDateInput.value = '2024-01-15';

      expect(validateDateRange(startDateInput, endDateInput)).toBe(true);
    });

    test('returns true when dates are equal', () => {
      startDateInput.value = '2024-01-15';
      endDateInput.value = '2024-01-15';

      expect(validateDateRange(startDateInput, endDateInput)).toBe(true);
    });

    test('returns false when end date is before start date', () => {
      startDateInput.value = '2024-01-15';
      endDateInput.value = '2024-01-01';

      expect(validateDateRange(startDateInput, endDateInput)).toBe(false);
    });

    test('shows error on end date input', () => {
      startDateInput.value = '2024-01-15';
      endDateInput.value = '2024-01-01';
      validateDateRange(startDateInput, endDateInput);

      const errorContainer = container.querySelector('.form-validation-error[data-for="end-date"]');
      expect(errorContainer).not.toBeNull();
    });

    test('shows default error message', () => {
      startDateInput.value = '2024-01-15';
      endDateInput.value = '2024-01-01';
      validateDateRange(startDateInput, endDateInput);

      const errorContainer = container.querySelector('.form-validation-error');
      expect(errorContainer.textContent).toBe('End date must be after start date');
    });

    test('shows custom error message', () => {
      startDateInput.value = '2024-01-15';
      endDateInput.value = '2024-01-01';
      validateDateRange(startDateInput, endDateInput, 'Start date must be before end date');

      const errorContainer = container.querySelector('.form-validation-error');
      expect(errorContainer.textContent).toBe('Start date must be before end date');
    });

    test('handles null start date input', () => {
      expect(validateDateRange(null, endDateInput)).toBe(false);
    });

    test('handles null end date input', () => {
      expect(validateDateRange(startDateInput, null)).toBe(false);
    });
  });

  describe('addBlurValidation', () => {
    test('calls validation function on blur', () => {
      const validationFn = jest.fn();
      addBlurValidation(inputElement, validationFn);

      inputElement.dispatchEvent(new Event('blur'));

      expect(validationFn).toHaveBeenCalledTimes(1);
    });

    test('clears error on input event', () => {
      showFieldError(inputElement, 'Test error');
      addBlurValidation(inputElement, () => {});

      inputElement.dispatchEvent(new Event('input'));

      const errorContainer = container.querySelector('.form-validation-error');
      expect(errorContainer).toBeNull();
    });

    test('handles null input gracefully', () => {
      expect(() => addBlurValidation(null, () => {})).not.toThrow();
    });

    test('handles null validation function gracefully', () => {
      expect(() => addBlurValidation(inputElement, null)).not.toThrow();
    });
  });

  describe('default export', () => {
    test('exports all functions', () => {
      const formValidation = require('../../src/ui/components/formValidation').default;

      expect(formValidation.showFieldError).toBeDefined();
      expect(formValidation.clearFieldError).toBeDefined();
      expect(formValidation.clearAllFieldErrors).toBeDefined();
      expect(formValidation.validateRequired).toBeDefined();
      expect(formValidation.validateDateFormat).toBeDefined();
      expect(formValidation.validateNumberRange).toBeDefined();
      expect(formValidation.validateMinNumber).toBeDefined();
      expect(formValidation.validateSelection).toBeDefined();
      expect(formValidation.validateDateRange).toBeDefined();
      expect(formValidation.addBlurValidation).toBeDefined();
    });
  });
});
