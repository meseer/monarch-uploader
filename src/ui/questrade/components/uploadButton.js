/**
 * Upload Button Component
 * Creates buttons for uploading balance history
 */

import { debugLog } from '../../../core/utils';
import stateManager from '../../../core/state';
import toast from '../../toast';
import { getDateRange, processAccountBalanceHistory } from '../../../services/questrade/account';
import { ensureMonarchAuthentication } from '../../components/monarchLoginLink';

/**
 * Creates a styled button
 * @param {string} text - Button text
 * @param {Function} onClick - Click handler
 * @param {Object} options - Button options
 * @returns {HTMLButtonElement} The created button
 */
export function createButton(text, onClick, options = {}) {
  const button = document.createElement('button');
  button.textContent = text;
  button.style.cssText = `
    background-color: ${options.color || '#0073b1'};
    color: white;
    border: none;
    border-radius: 4px;
    padding: 8px 16px;
    margin: 5px;
    font-size: 14px;
    cursor: pointer;
    transition: background-color 0.2s;
    ${options.disabled ? 'opacity: 0.6; cursor: not-allowed;' : ''}
  `;

  if (options.id) {
    button.id = options.id;
  }

  if (options.className) {
    button.className = options.className;
  }

  button.disabled = Boolean(options.disabled);

  // Add hover effect
  button.addEventListener('mouseover', () => {
    if (!button.disabled) {
      button.style.backgroundColor = options.hoverColor || '#005d8f';
    }
  });

  button.addEventListener('mouseout', () => {
    if (!button.disabled) {
      button.style.backgroundColor = options.color || '#0073b1';
    }
  });

  // Add click handler
  if (onClick && !options.disabled) {
    button.addEventListener('click', onClick);
  }

  return button;
}

/**
 * Creates a date picker with label
 * @param {string} id - Input ID
 * @param {string} label - Label text
 * @param {string} value - Default value
 * @returns {HTMLElement} Container with label and date picker
 */
export function createDatePicker(id, label, value) {
  const container = document.createElement('div');
  container.style.cssText = 'margin: 10px 0; display: flex; flex-direction: column; gap: 5px;';

  const labelElement = document.createElement('label');
  labelElement.textContent = label;
  labelElement.htmlFor = id;
  labelElement.style.cssText = 'font-weight: bold; font-size: 14px;';
  container.appendChild(labelElement);

  const input = document.createElement('input');
  input.type = 'date';
  input.id = id;
  input.value = value;
  input.style.cssText = 'padding: 8px; border-radius: 4px; border: 1px solid #ccc; font-size: 14px;';
  container.appendChild(input);

  return container;
}

/**
 * Creates a button group container
 * @returns {HTMLElement} Button group container
 */
export function createButtonGroup() {
  const container = document.createElement('div');
  container.className = 'balance-uploader-button-group';
  container.style.cssText = 'margin: 10px 0; display: flex; flex-wrap: wrap; gap: 5px;';
  return container;
}

/**
 * Creates a single-account upload button that responds to state changes
 * @param {string} fallbackAccountId - Fallback account ID if state is not available
 * @param {string} fallbackAccountName - Fallback account name if state is not available
 * @returns {HTMLElement} Upload button element
 */
export function createSingleAccountUploadButton(fallbackAccountId, fallbackAccountName) {
  // Create button with initial text
  const button = createButton(`Upload ${fallbackAccountName} to Monarch`, async () => {
    // Check Monarch authentication before proceeding
    const authenticated = await ensureMonarchAuthentication(null, 'upload balance history');
    if (!authenticated) {
      return; // User cancelled authentication
    }

    // Always get current state when button is clicked
    const currentState = stateManager.getState();
    const currentAccountId = currentState.currentAccount.id || fallbackAccountId;
    const currentAccountName = currentState.currentAccount.nickname !== 'unknown'
      ? currentState.currentAccount.nickname
      : fallbackAccountName;

    // Get date range for current account
    const { fromDate, toDate } = getDateRange(currentAccountId);
    try {
      // Create modal form
      const modal = document.createElement('div');
      modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.5);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 10000;
      `;

      // Create form
      const form = document.createElement('form');
      form.style.cssText = `
        background-color: white;
        padding: 20px;
        border-radius: 8px;
        width: 400px;
        max-width: 90%;
      `;

      // Add title
      const title = document.createElement('h3');
      title.textContent = `Upload ${currentAccountName} Balance History`;
      title.style.cssText = 'margin-top: 0; margin-bottom: 15px;';
      form.appendChild(title);

      // Add date pickers
      const fromDatePicker = createDatePicker('fromDate', 'From Date:', fromDate);
      form.appendChild(fromDatePicker);

      const toDatePicker = createDatePicker('toDate', 'To Date:', toDate);
      form.appendChild(toDatePicker);

      // Add buttons
      const buttonGroup = createButtonGroup();

      const cancelButton = createButton('Cancel', () => {
        modal.remove();
      }, { color: '#6c757d' });
      buttonGroup.appendChild(cancelButton);

      const uploadButton = createButton('Upload', async () => {
        const selectedFromDate = document.getElementById('fromDate').value;
        const selectedToDate = document.getElementById('toDate').value;

        // Remove modal
        modal.remove();

        // Process upload
        await processAccountBalanceHistory(
          currentAccountId,
          currentAccountName,
          selectedFromDate,
          selectedToDate,
        );
      }, { color: '#28a745' });
      buttonGroup.appendChild(uploadButton);

      form.appendChild(buttonGroup);
      modal.appendChild(form);
      document.body.appendChild(modal);
    } catch (error) {
      toast.show(`Error: ${error.message}`, 'error');
      debugLog('Error creating upload form:', error);
    }
  });

  return button;
}

/**
 * Creates a bulk upload button for processing multiple accounts
 * @param {Array<Object>} accounts - List of accounts to process
 * @returns {HTMLElement} Bulk upload button
 */
export function createBulkUploadButton(accounts) {
  if (!accounts || accounts.length === 0) {
    return createButton('No Accounts Available', null, { disabled: true });
  }

  return createButton(`Sync All ${accounts.length} Accounts`, async () => {
    // Check Monarch authentication before proceeding
    const authenticated = await ensureMonarchAuthentication(null, 'sync all accounts');
    if (!authenticated) {
      return; // User cancelled authentication
    }

    // Import sync service dynamically to avoid circular imports
    const { syncAllAccountsToMonarch } = await import('../../../services/questrade/sync');

    try {
      // Call the comprehensive sync function (balance + positions)
      await syncAllAccountsToMonarch();
    } catch (error) {
      toast.show(`Error: ${error.message}`, 'error');
      debugLog('Error in bulk sync:', error);
    }
  }, { color: '#17a2b8' });
}

export default {
  createButton,
  createDatePicker,
  createButtonGroup,
  createSingleAccountUploadButton,
  createBulkUploadButton,
};
