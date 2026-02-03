/**
 * Form Validation Component
 * Provides inline form validation with error display below form fields
 */

/**
 * Error message container class name for identification
 */
const ERROR_CLASS = 'form-validation-error';

/**
 * Styles for the error message container
 */
const ERROR_STYLES = `
  color: #dc3545;
  font-size: 12px;
  margin-top: 4px;
  padding: 2px 0;
`;

/**
 * Styles for invalid input field border
 */
const INVALID_BORDER_STYLE = '1px solid #dc3545';

/**
 * Show validation error message below an input field
 * @param {HTMLElement} inputElement - The input element to show error for
 * @param {string} message - The error message to display
 */
export function showFieldError(inputElement, message) {
  if (!inputElement) return;

  // Store original border style if not already stored
  if (!inputElement.dataset.originalBorder) {
    inputElement.dataset.originalBorder = inputElement.style.border || '';
  }

  // Apply error border style
  inputElement.style.border = INVALID_BORDER_STYLE;

  // Check if error container already exists
  let errorContainer = inputElement.parentElement?.querySelector(`.${ERROR_CLASS}[data-for="${inputElement.id || 'input'}"]`);

  if (!errorContainer) {
    // Create new error container
    errorContainer = document.createElement('div');
    errorContainer.className = ERROR_CLASS;
    errorContainer.dataset.for = inputElement.id || 'input';
    errorContainer.style.cssText = ERROR_STYLES;

    // Insert error container after the input element
    if (inputElement.nextSibling) {
      inputElement.parentElement.insertBefore(errorContainer, inputElement.nextSibling);
    } else {
      inputElement.parentElement.appendChild(errorContainer);
    }
  }

  // Set error message
  errorContainer.textContent = message;
  errorContainer.id = `${inputElement.id || 'input'}-error`;

  // Set aria attributes for accessibility
  inputElement.setAttribute('aria-invalid', 'true');
  inputElement.setAttribute('aria-describedby', errorContainer.id);
}

/**
 * Clear validation error from an input field
 * @param {HTMLElement} inputElement - The input element to clear error from
 */
export function clearFieldError(inputElement) {
  if (!inputElement) return;

  // Restore original border style
  if (inputElement.dataset.originalBorder !== undefined) {
    inputElement.style.border = inputElement.dataset.originalBorder;
    delete inputElement.dataset.originalBorder;
  }

  // Remove error container
  const errorContainer = inputElement.parentElement?.querySelector(`.${ERROR_CLASS}[data-for="${inputElement.id || 'input'}"]`);
  if (errorContainer) {
    errorContainer.remove();
  }

  // Clear aria attributes
  inputElement.removeAttribute('aria-invalid');
  inputElement.removeAttribute('aria-describedby');
}

/**
 * Clear all validation errors within a container
 * @param {HTMLElement} container - The container element to clear errors from
 */
export function clearAllFieldErrors(container) {
  if (!container) return;

  // Find all error containers
  const errorContainers = container.querySelectorAll(`.${ERROR_CLASS}`);
  errorContainers.forEach((error) => error.remove());

  // Find all inputs with error styling and restore them
  const inputs = container.querySelectorAll('[aria-invalid="true"]');
  inputs.forEach((input) => {
    if (input.dataset.originalBorder !== undefined) {
      input.style.border = input.dataset.originalBorder;
      delete input.dataset.originalBorder;
    }
    input.removeAttribute('aria-invalid');
    input.removeAttribute('aria-describedby');
  });
}

/**
 * Validate that a field has a value (not empty)
 * @param {HTMLElement} inputElement - The input element to validate
 * @param {string} message - The error message to show if validation fails
 * @returns {boolean} True if valid, false if invalid
 */
export function validateRequired(inputElement, message = 'This field is required') {
  if (!inputElement) return false;

  const value = inputElement.value?.trim();
  if (!value) {
    showFieldError(inputElement, message);
    return false;
  }

  clearFieldError(inputElement);
  return true;
}

/**
 * Validate that a field contains a valid date in YYYY-MM-DD format
 * @param {HTMLElement} inputElement - The input element to validate
 * @param {string} message - The error message to show if validation fails
 * @returns {boolean} True if valid, false if invalid
 */
export function validateDateFormat(inputElement, message = 'Please select a valid date') {
  if (!inputElement) return false;

  const value = inputElement.value;
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    showFieldError(inputElement, message);
    return false;
  }

  // Also check that it's a valid date (not something like 2024-13-45)
  const date = new Date(value);
  if (isNaN(date.getTime())) {
    showFieldError(inputElement, message);
    return false;
  }

  clearFieldError(inputElement);
  return true;
}

/**
 * Validate that a field contains a number within a specified range
 * @param {HTMLElement} inputElement - The input element to validate
 * @param {number} min - Minimum allowed value (inclusive)
 * @param {number} max - Maximum allowed value (inclusive)
 * @param {string} message - The error message to show if validation fails
 * @returns {boolean} True if valid, false if invalid
 */
export function validateNumberRange(inputElement, min, max, message) {
  if (!inputElement) return false;

  const value = inputElement.value?.trim();
  const num = parseInt(value, 10);

  if (value === '' || isNaN(num)) {
    showFieldError(inputElement, message || 'Please enter a valid number');
    return false;
  }

  if (num < min || num > max) {
    showFieldError(inputElement, message || `Please enter a number between ${min} and ${max}`);
    return false;
  }

  clearFieldError(inputElement);
  return true;
}

/**
 * Validate that a field contains a number greater than or equal to a minimum
 * @param {HTMLElement} inputElement - The input element to validate
 * @param {number} min - Minimum allowed value (inclusive)
 * @param {string} message - The error message to show if validation fails
 * @returns {boolean} True if valid, false if invalid
 */
export function validateMinNumber(inputElement, min = 0, message) {
  if (!inputElement) return false;

  const value = inputElement.value?.trim();
  const num = parseInt(value, 10);

  if (value === '' || isNaN(num)) {
    showFieldError(inputElement, message || 'Please enter a valid number');
    return false;
  }

  if (num < min) {
    showFieldError(inputElement, message || `Please enter a number ${min} or greater`);
    return false;
  }

  clearFieldError(inputElement);
  return true;
}

/**
 * Validate that a select element has a selected value
 * @param {HTMLElement} selectElement - The select element to validate
 * @param {string} message - The error message to show if validation fails
 * @returns {boolean} True if valid, false if invalid
 */
export function validateSelection(selectElement, message = 'Please select an option') {
  if (!selectElement) return false;

  const value = selectElement.value;
  if (!value || value === '' || value === 'null' || value === 'undefined') {
    showFieldError(selectElement, message);
    return false;
  }

  clearFieldError(selectElement);
  return true;
}

/**
 * Validate that end date is after start date
 * @param {HTMLElement} startDateInput - The start date input element
 * @param {HTMLElement} endDateInput - The end date input element
 * @param {string} message - The error message to show if validation fails
 * @returns {boolean} True if valid, false if invalid
 */
export function validateDateRange(startDateInput, endDateInput, message = 'End date must be after start date') {
  if (!startDateInput || !endDateInput) return false;

  const startDate = new Date(startDateInput.value);
  const endDate = new Date(endDateInput.value);

  if (startDate > endDate) {
    showFieldError(endDateInput, message);
    return false;
  }

  clearFieldError(endDateInput);
  return true;
}

/**
 * Add real-time validation on blur (when user leaves field)
 * @param {HTMLElement} inputElement - The input element to add validation to
 * @param {Function} validationFn - The validation function to call
 */
export function addBlurValidation(inputElement, validationFn) {
  if (!inputElement || !validationFn) return;

  inputElement.addEventListener('blur', () => {
    validationFn();
  });

  // Clear error when user starts typing
  inputElement.addEventListener('input', () => {
    clearFieldError(inputElement);
  });
}

export default {
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
};
