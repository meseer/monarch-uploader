/**
 * Date Picker Modal Component
 * Creates a modal date picker for selecting start dates
 * Based on the original script's showDatePicker functionality
 */

import { debugLog } from '../../core/utils';
import { addModalKeyboardHandlers, trapFocus } from '../keyboardNavigation';
import { validateDateFormat, clearFieldError } from './formValidation';

/**
 * Show a date picker modal and return a promise with the selected date
 * @param {string} defaultDate - Default date in YYYY-MM-DD format
 * @param {string} promptText - Text to display in the modal
 * @returns {Promise<string|null>} Promise that resolves to selected date or null if cancelled
 */
export function showDatePickerPromise(defaultDate, promptText) {
  return new Promise((resolve) => {
    showDatePicker(defaultDate, promptText, (selectedDate) => {
      resolve(selectedDate);
    });
  });
}

/**
 * Show a date picker modal with options and return a promise
 * @param {string} defaultDate - Default date in YYYY-MM-DD format
 * @param {string} promptText - Text to display in the modal
 * @param {Object} options - Additional options
 * @param {boolean} options.showReconstructCheckbox - Whether to show the balance reconstruction checkbox
 * @param {boolean} options.reconstructCheckedByDefault - Whether the checkbox is checked by default (default: true)
 * @returns {Promise<Object|null>} Promise that resolves to {date, reconstructBalance} or null if cancelled
 */
export function showDatePickerWithOptionsPromise(defaultDate, promptText, options = {}) {
  return new Promise((resolve) => {
    showDatePickerWithOptions(defaultDate, promptText, options, (result) => {
      resolve(result);
    });
  });
}

/**
 * Show date picker modal with callback
 * @param {string} defaultDate - Default date in YYYY-MM-DD format
 * @param {string} promptText - Text to display in the modal
 * @param {Function} callback - Callback function to receive selected date
 */
export function showDatePicker(defaultDate, promptText, callback) {
  debugLog('Showing date picker with default date:', defaultDate);

  // Create the overlay
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;

  // Handle click outside to close
  overlay.onclick = (e) => {
    if (e.target === overlay) {
      overlay.remove();
      callback(null);
    }
  };

  // Create the modal
  const modal = document.createElement('div');
  modal.style.cssText = `
    background: white;
    padding: 25px;
    border-radius: 8px;
    width: 90%;
    max-width: 400px;
  `;

  // Create the title
  const title = document.createElement('h2');
  title.style.cssText = `
    margin-top: 0;
    margin-bottom: 15px;
    font-size: 1.2em;
  `;
  title.textContent = 'Select Start Date';
  modal.appendChild(title);

  // Create the description
  const description = document.createElement('p');
  description.style.cssText = `
    margin-bottom: 20px;
    color: #555;
  `;
  description.textContent = promptText;
  modal.appendChild(description);

  // Create date input
  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.value = defaultDate;
  dateInput.style.cssText = `
    width: 100%;
    padding: 10px;
    border: 1px solid #ddd;
    border-radius: 4px;
    font-size: 16px;
    margin-bottom: 20px;
    box-sizing: border-box;
  `;
  modal.appendChild(dateInput);

  // Create button container
  const buttonContainer = document.createElement('div');
  buttonContainer.style.cssText = `
    display: flex;
    justify-content: flex-end;
    gap: 10px;
  `;

  // Set up keyboard navigation - declare cleanup function first
  let cleanupKeyboard = () => {};

  // Helper functions for actions
  const cancelAction = () => {
    cleanupKeyboard();
    overlay.remove();
    callback(null);
  };

  const selectAction = () => {
    if (!validateDateFormat(dateInput)) {
      return;
    }
    const selectedDate = dateInput.value;
    cleanupKeyboard();
    overlay.remove();
    callback(selectedDate);
  };

  // Cancel button
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = `
    padding: 8px 16px;
    border: 1px solid #ddd;
    border-radius: 4px;
    background: white;
    cursor: pointer;
  `;
  cancelBtn.onclick = cancelAction;
  buttonContainer.appendChild(cancelBtn);

  // Select button
  const selectBtn = document.createElement('button');
  selectBtn.textContent = 'Select';
  selectBtn.style.cssText = `
    padding: 8px 16px;
    border: none;
    border-radius: 4px;
    background: #007bff;
    color: white;
    cursor: pointer;
  `;
  selectBtn.onclick = selectAction;
  buttonContainer.appendChild(selectBtn);

  modal.appendChild(buttonContainer);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // Add keyboard handlers for the modal
  const cleanupModalHandlers = addModalKeyboardHandlers(
    overlay,
    cancelAction, // Escape key callback
    () => {
      // Enter key callback - only when not focused on date input
      if (document.activeElement !== dateInput) {
        selectAction();
      }
    },
  );

  // Add focus trapping
  const cleanupFocusTrap = trapFocus(modal);

  // Add Enter key handler specifically for date input
  const handleDateInputKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      selectAction();
    }
  };
  dateInput.addEventListener('keydown', handleDateInputKeyDown);

  // Clear validation error when user changes the date
  dateInput.addEventListener('input', () => {
    clearFieldError(dateInput);
  });

  // Combine cleanup functions
  cleanupKeyboard = () => {
    cleanupModalHandlers();
    cleanupFocusTrap();
    dateInput.removeEventListener('keydown', handleDateInputKeyDown);
  };

  // Focus the date input
  dateInput.focus();

  debugLog('Date picker modal displayed with keyboard navigation');
}

/**
 * Show date picker modal with options (including reconstruction checkbox)
 * @param {string} defaultDate - Default date in YYYY-MM-DD format
 * @param {string} promptText - Text to display in the modal
 * @param {Object} options - Additional options
 * @param {boolean} options.showReconstructCheckbox - Whether to show the balance reconstruction checkbox
 * @param {boolean} options.reconstructCheckedByDefault - Whether the checkbox is checked by default (default: true)
 * @param {Function} callback - Callback function to receive result {date, reconstructBalance} or null
 */
export function showDatePickerWithOptions(defaultDate, promptText, options = {}, callback) {
  const { showReconstructCheckbox = false, reconstructCheckedByDefault = true } = options;

  debugLog('Showing date picker with options:', { defaultDate, showReconstructCheckbox, reconstructCheckedByDefault });

  // Create the overlay
  const overlay = document.createElement('div');
  overlay.id = 'date-picker-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;

  // Handle click outside to close
  overlay.onclick = (e) => {
    if (e.target === overlay) {
      overlay.remove();
      callback(null);
    }
  };

  // Create the modal
  const modal = document.createElement('div');
  modal.id = 'date-picker-modal';
  modal.style.cssText = `
    background: white;
    padding: 25px;
    border-radius: 8px;
    width: 90%;
    max-width: 400px;
  `;

  // Create the title
  const title = document.createElement('h2');
  title.id = 'date-picker-title';
  title.style.cssText = `
    margin-top: 0;
    margin-bottom: 15px;
    font-size: 1.2em;
  `;
  title.textContent = 'Select Start Date';
  modal.appendChild(title);

  // Create the description
  const description = document.createElement('p');
  description.id = 'date-picker-description';
  description.style.cssText = `
    margin-bottom: 20px;
    color: #555;
  `;
  description.textContent = promptText;
  modal.appendChild(description);

  // Create date input
  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.id = 'date-picker-input';
  dateInput.value = defaultDate;
  dateInput.style.cssText = `
    width: 100%;
    padding: 10px;
    border: 1px solid #ddd;
    border-radius: 4px;
    font-size: 16px;
    margin-bottom: 20px;
    box-sizing: border-box;
  `;
  modal.appendChild(dateInput);

  // Create reconstruction checkbox if requested
  let reconstructCheckbox = null;
  if (showReconstructCheckbox) {
    const checkboxContainer = document.createElement('div');
    checkboxContainer.id = 'date-picker-checkbox-container';
    checkboxContainer.style.cssText = `
      display: flex;
      align-items: flex-start;
      gap: 10px;
      margin-bottom: 20px;
      padding: 12px;
      background: #f8f9fa;
      border-radius: 4px;
      border: 1px solid #e9ecef;
    `;

    reconstructCheckbox = document.createElement('input');
    reconstructCheckbox.type = 'checkbox';
    reconstructCheckbox.id = 'date-picker-reconstruct-checkbox';
    reconstructCheckbox.checked = reconstructCheckedByDefault;
    reconstructCheckbox.style.cssText = `
      margin-top: 3px;
      cursor: pointer;
    `;

    const checkboxLabel = document.createElement('label');
    checkboxLabel.id = 'date-picker-reconstruct-label';
    checkboxLabel.htmlFor = 'date-picker-reconstruct-checkbox';
    checkboxLabel.style.cssText = `
      cursor: pointer;
      font-size: 14px;
      color: #333;
      line-height: 1.4;
    `;
    checkboxLabel.innerHTML = `
      <strong>Reconstruct balance from transactions</strong><br>
      <span style="color: #666; font-size: 12px;">
        Build historical balance by calculating daily balances from your transaction history.
        Recommended for first-time sync.
      </span>
    `;

    checkboxContainer.appendChild(reconstructCheckbox);
    checkboxContainer.appendChild(checkboxLabel);
    modal.appendChild(checkboxContainer);
  }

  // Create button container
  const buttonContainer = document.createElement('div');
  buttonContainer.id = 'date-picker-buttons';
  buttonContainer.style.cssText = `
    display: flex;
    justify-content: flex-end;
    gap: 10px;
  `;

  // Set up keyboard navigation - declare cleanup function first
  let cleanupKeyboard = () => {};

  // Helper functions for actions
  const cancelAction = () => {
    cleanupKeyboard();
    overlay.remove();
    callback(null);
  };

  const selectAction = () => {
    if (!validateDateFormat(dateInput)) {
      return;
    }
    const selectedDate = dateInput.value;
    cleanupKeyboard();
    overlay.remove();

    // Return result object with date and reconstruction flag
    const result = {
      date: selectedDate,
      reconstructBalance: reconstructCheckbox ? reconstructCheckbox.checked : false,
    };
    callback(result);
  };

  // Cancel button
  const cancelBtn = document.createElement('button');
  cancelBtn.id = 'date-picker-cancel';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = `
    padding: 8px 16px;
    border: 1px solid #ddd;
    border-radius: 4px;
    background: white;
    cursor: pointer;
  `;
  cancelBtn.onclick = cancelAction;
  buttonContainer.appendChild(cancelBtn);

  // Select button
  const selectBtn = document.createElement('button');
  selectBtn.id = 'date-picker-select';
  selectBtn.textContent = 'Select';
  selectBtn.style.cssText = `
    padding: 8px 16px;
    border: none;
    border-radius: 4px;
    background: #007bff;
    color: white;
    cursor: pointer;
  `;
  selectBtn.onclick = selectAction;
  buttonContainer.appendChild(selectBtn);

  modal.appendChild(buttonContainer);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // Add keyboard handlers for the modal
  const cleanupModalHandlers = addModalKeyboardHandlers(
    overlay,
    cancelAction, // Escape key callback
    () => {
      // Enter key callback - only when not focused on date input or checkbox
      if (document.activeElement !== dateInput && document.activeElement !== reconstructCheckbox) {
        selectAction();
      }
    },
  );

  // Add focus trapping
  const cleanupFocusTrap = trapFocus(modal);

  // Add Enter key handler specifically for date input
  const handleDateInputKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      selectAction();
    }
  };
  dateInput.addEventListener('keydown', handleDateInputKeyDown);

  // Clear validation error when user changes the date
  dateInput.addEventListener('input', () => {
    clearFieldError(dateInput);
  });

  // Combine cleanup functions
  cleanupKeyboard = () => {
    cleanupModalHandlers();
    cleanupFocusTrap();
    dateInput.removeEventListener('keydown', handleDateInputKeyDown);
  };

  // Focus the date input
  dateInput.focus();

  debugLog('Date picker modal with options displayed');
}

export default {
  showDatePicker,
  showDatePickerPromise,
  showDatePickerWithOptions,
  showDatePickerWithOptionsPromise,
};
