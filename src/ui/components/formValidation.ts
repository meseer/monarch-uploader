/**
 * Form Validation Component
 * Provides inline form validation with error display below form fields
 */

const ERROR_CLASS = 'form-validation-error';

const ERROR_STYLES = `
  color: #dc3545;
  font-size: 12px;
  margin-top: 4px;
  padding: 2px 0;
`;

const INVALID_BORDER_STYLE = '1px solid #dc3545';

/**
 * Show validation error message below an input field
 * @param inputElement - The input element to show error for
 * @param message - The error message to display
 */
export function showFieldError(inputElement: HTMLElement | null, message: string): void {
  if (!inputElement) return;

  const el = inputElement as HTMLInputElement;

  // Store original border style if not already stored
  if (!el.dataset.originalBorder) {
    el.dataset.originalBorder = inputElement.style.border || '';
  }

  // Apply error border style
  inputElement.style.border = INVALID_BORDER_STYLE;

  const inputId = el.id || 'input';

  // Check if error container already exists
  let errorContainer = inputElement.parentElement?.querySelector<HTMLElement>(
    `.${ERROR_CLASS}[data-for="${inputId}"]`,
  );

  if (!errorContainer) {
    // Create new error container
    errorContainer = document.createElement('div');
    errorContainer.className = ERROR_CLASS;
    errorContainer.dataset.for = inputId;
    errorContainer.style.cssText = ERROR_STYLES;

    // Insert error container after the input element
    if (inputElement.nextSibling) {
      inputElement.parentElement!.insertBefore(errorContainer, inputElement.nextSibling);
    } else {
      inputElement.parentElement!.appendChild(errorContainer);
    }
  }

  // Set error message
  errorContainer.textContent = message;
  errorContainer.id = `${inputId}-error`;

  // Set aria attributes for accessibility
  inputElement.setAttribute('aria-invalid', 'true');
  inputElement.setAttribute('aria-describedby', errorContainer.id);
}

/**
 * Clear validation error from an input field
 * @param inputElement - The input element to clear error from
 */
export function clearFieldError(inputElement: HTMLElement | null): void {
  if (!inputElement) return;

  const el = inputElement as HTMLInputElement;
  const inputId = el.id || 'input';

  // Restore original border style
  if (el.dataset.originalBorder !== undefined) {
    inputElement.style.border = el.dataset.originalBorder;
    delete el.dataset.originalBorder;
  }

  // Remove error container
  const errorContainer = inputElement.parentElement?.querySelector(
    `.${ERROR_CLASS}[data-for="${inputId}"]`,
  );
  if (errorContainer) {
    errorContainer.remove();
  }

  // Clear aria attributes
  inputElement.removeAttribute('aria-invalid');
  inputElement.removeAttribute('aria-describedby');
}

/**
 * Clear all validation errors within a container
 * @param container - The container element to clear errors from
 */
export function clearAllFieldErrors(container: HTMLElement | null): void {
  if (!container) return;

  // Find all error containers
  const errorContainers = container.querySelectorAll(`.${ERROR_CLASS}`);
  errorContainers.forEach((error) => error.remove());

  // Find all inputs with error styling and restore them
  const inputs = container.querySelectorAll<HTMLInputElement>('[aria-invalid="true"]');
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
 * @param inputElement - The input element to validate
 * @param message - The error message to show if validation fails
 * @returns True if valid, false if invalid
 */
export function validateRequired(
  inputElement: HTMLInputElement | null,
  message = 'This field is required',
): boolean {
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
 * @param inputElement - The input element to validate
 * @param message - The error message to show if validation fails
 * @returns True if valid, false if invalid
 */
export function validateDateFormat(
  inputElement: HTMLInputElement | null,
  message = 'Please select a valid date',
): boolean {
  if (!inputElement) return false;

  const value = inputElement.value;
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    showFieldError(inputElement, message);
    return false;
  }

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
 * @param inputElement - The input element to validate
 * @param min - Minimum allowed value (inclusive)
 * @param max - Maximum allowed value (inclusive)
 * @param message - The error message to show if validation fails
 * @returns True if valid, false if invalid
 */
export function validateNumberRange(
  inputElement: HTMLInputElement | null,
  min: number,
  max: number,
  message?: string,
): boolean {
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
 * @param inputElement - The input element to validate
 * @param min - Minimum allowed value (inclusive)
 * @param message - The error message to show if validation fails
 * @returns True if valid, false if invalid
 */
export function validateMinNumber(
  inputElement: HTMLInputElement | null,
  min = 0,
  message?: string,
): boolean {
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
 * @param selectElement - The select element to validate
 * @param message - The error message to show if validation fails
 * @returns True if valid, false if invalid
 */
export function validateSelection(
  selectElement: HTMLSelectElement | null,
  message = 'Please select an option',
): boolean {
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
 * @param startDateInput - The start date input element
 * @param endDateInput - The end date input element
 * @param message - The error message to show if validation fails
 * @returns True if valid, false if invalid
 */
export function validateDateRange(
  startDateInput: HTMLInputElement | null,
  endDateInput: HTMLInputElement | null,
  message = 'End date must be after start date',
): boolean {
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
 * @param inputElement - The input element to add validation to
 * @param validationFn - The validation function to call
 */
export function addBlurValidation(
  inputElement: HTMLElement | null,
  validationFn: () => void,
): void {
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