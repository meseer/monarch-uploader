/**
 * Upload Button Component
 * Creates buttons for uploading balance history
 */

import { debugLog } from '../../../core/utils';
import { STORAGE } from '../../../core/config';
import stateManager from '../../../core/state';
import toast from '../../toast';
import { getDateRange, processAccountBalanceHistory } from '../../../services/questrade/account';
import { ensureMonarchAuthentication } from '../../components/monarchLoginLink';
import { syncAllAccountsToMonarch } from '../../../services/questrade/sync';
import { uploadAllAccountsActivityToMonarch, uploadSingleAccountActivityToMonarch } from '../../../services/questrade/transactions';
import {
  getAccountCreationDate,
  uploadFullBalanceHistoryForAccount,
  uploadFullBalanceHistoryForAllAccounts,
} from '../../../services/questrade/balance';
import { showDatePickerPromise } from '../../components/datePicker';

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

    try {
      // Call the comprehensive sync function (balance + positions)
      await syncAllAccountsToMonarch();
    } catch (error) {
      toast.show(`Error: ${error.message}`, 'error');
      debugLog('Error in bulk sync:', error);
    }
  }, { color: '#17a2b8' });
}

/**
 * Creates a testing section with development-only features
 * Only visible when Development Mode is enabled
 * @param {Object|null} accountContext - Optional account context for single account page
 * @param {string} accountContext.accountId - The account ID
 * @param {string} accountContext.accountName - The account name
 * @returns {HTMLElement|null} Testing section container or null if not in development mode
 */
export function createTestingSection(accountContext = null) {
  // Only show testing section when Development Mode is enabled
  const isDevelopmentMode = GM_getValue(STORAGE.DEVELOPMENT_MODE, false);
  if (!isDevelopmentMode) {
    return null;
  }

  // Create collapsible testing section
  const testingSection = document.createElement('div');
  testingSection.id = 'questrade-testing-section';
  testingSection.style.cssText = `
    border: 1px solid #ddd;
    border-radius: 4px;
    margin: 10px 0;
    background-color: #fafafa;
  `;

  // Create toggle header for testing section
  const testingHeader = document.createElement('div');
  testingHeader.id = 'questrade-testing-header';
  testingHeader.style.cssText = `
    padding: 8px 12px;
    background-color: #f0f0f0;
    border-bottom: 1px solid #ddd;
    cursor: pointer;
    user-select: none;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 13px;
    font-weight: 500;
    color: #666;
  `;

  const testingTitle = document.createElement('span');
  testingTitle.id = 'questrade-testing-title';
  testingTitle.textContent = '🧪 Testing (for development only)';

  const testingToggle = document.createElement('span');
  testingToggle.id = 'questrade-testing-toggle';
  testingToggle.textContent = '▼';
  testingToggle.style.cssText = 'transition: transform 0.2s ease; font-size: 12px; transform: rotate(-90deg);';

  testingHeader.appendChild(testingTitle);
  testingHeader.appendChild(testingToggle);

  // Create collapsible content container
  const testingContent = document.createElement('div');
  testingContent.id = 'questrade-testing-content';
  testingContent.style.cssText = `
    padding: 12px;
    display: none;
  `;

  // Create description based on context (single account vs all accounts)
  const description = document.createElement('div');
  description.id = 'questrade-testing-description';
  description.style.cssText = `
    font-size: 12px;
    color: #666;
    margin-bottom: 12px;
    padding: 8px;
    background-color: #fff3cd;
    border: 1px solid #ffeaa7;
    border-radius: 4px;
  `;

  if (accountContext) {
    // Single account page - show single account buttons
    description.textContent = 'Development testing options for this account. Upload complete balance history or activity transactions.';
    testingContent.appendChild(description);

    // Create button container for better layout
    const buttonContainer = document.createElement('div');
    buttonContainer.id = 'questrade-testing-button-container';
    buttonContainer.style.cssText = 'display: flex; flex-wrap: wrap; gap: 8px;';

    // Create Upload All Balance History button for single account
    const uploadFullBalanceButton = createButton('Upload All Balance History', async () => {
      // Check Monarch authentication before proceeding
      const authenticated = await ensureMonarchAuthentication(null, 'upload full balance history');
      if (!authenticated) {
        return; // User cancelled authentication
      }

      // Get current account info from state (may have been updated since page load)
      const currentState = stateManager.getState();
      const currentAccountId = currentState.currentAccount.id || accountContext.accountId;
      const currentAccountName = currentState.currentAccount.nickname !== 'unknown'
        ? currentState.currentAccount.nickname
        : accountContext.accountName;

      try {
        // Get account creation date for default
        const creationDate = getAccountCreationDate(currentAccountId);
        const defaultDate = creationDate || '2020-01-01';

        // Show date picker with creation date as default
        const selectedDate = await showDatePickerPromise(
          defaultDate,
          `Select start date for ${currentAccountName} balance history`,
        );

        if (!selectedDate) {
          toast.show('Upload cancelled.', 'info');
          return;
        }

        // Disable button while uploading
        uploadFullBalanceButton.disabled = true;
        uploadFullBalanceButton.textContent = 'Uploading...';
        uploadFullBalanceButton.style.opacity = '0.6';
        uploadFullBalanceButton.style.cursor = 'not-allowed';

        debugLog(`Starting full balance history upload for ${currentAccountName} from ${selectedDate}...`);

        // Call the single account upload function
        await uploadFullBalanceHistoryForAccount(currentAccountId, currentAccountName, selectedDate);
      } catch (error) {
        debugLog('Error in upload full balance history:', error);
        toast.show(`Upload failed: ${error.message}`, 'error');
      } finally {
        // Re-enable button
        uploadFullBalanceButton.disabled = false;
        uploadFullBalanceButton.textContent = 'Upload All Balance History';
        uploadFullBalanceButton.style.opacity = '1';
        uploadFullBalanceButton.style.cursor = 'pointer';
      }
    }, { color: '#5a6268', id: 'questrade-upload-full-balance-btn' });

    buttonContainer.appendChild(uploadFullBalanceButton);

    // Create Upload Activity button for single account
    const uploadActivityButton = createButton('Upload Activity', async () => {
      // Check Monarch authentication before proceeding
      const authenticated = await ensureMonarchAuthentication(null, 'upload activity');
      if (!authenticated) {
        return; // User cancelled authentication
      }

      // Get current account info from state (may have been updated since page load)
      const currentState = stateManager.getState();
      const currentAccountId = currentState.currentAccount.id || accountContext.accountId;
      const currentAccountName = currentState.currentAccount.nickname !== 'unknown'
        ? currentState.currentAccount.nickname
        : accountContext.accountName;

      try {
        // Disable button while uploading
        uploadActivityButton.disabled = true;
        uploadActivityButton.textContent = 'Uploading...';
        uploadActivityButton.style.opacity = '0.6';
        uploadActivityButton.style.cursor = 'not-allowed';

        debugLog(`Starting upload activity for account ${currentAccountName} (${currentAccountId})...`);

        // Call the single account upload function
        await uploadSingleAccountActivityToMonarch(currentAccountId, currentAccountName);
      } catch (error) {
        debugLog('Error in upload activity:', error);
        toast.show(`Upload failed: ${error.message}`, 'error');
      } finally {
        // Re-enable button
        uploadActivityButton.disabled = false;
        uploadActivityButton.textContent = 'Upload Activity';
        uploadActivityButton.style.opacity = '1';
        uploadActivityButton.style.cursor = 'pointer';
      }
    }, { color: '#6c757d', id: 'questrade-upload-activity-btn' });

    buttonContainer.appendChild(uploadActivityButton);
    testingContent.appendChild(buttonContainer);
  } else {
    // All accounts page - show all accounts buttons
    description.textContent = 'Development testing options for all accounts. Upload complete balance history or activity transactions.';
    testingContent.appendChild(description);

    // Create button container for better layout
    const buttonContainer = document.createElement('div');
    buttonContainer.id = 'questrade-testing-all-button-container';
    buttonContainer.style.cssText = 'display: flex; flex-wrap: wrap; gap: 8px;';

    // Create Upload All Balance History button for all accounts
    const uploadAllFullBalanceButton = createButton('Upload All Balance History', async () => {
      // Check Monarch authentication before proceeding
      const authenticated = await ensureMonarchAuthentication(null, 'upload full balance history');
      if (!authenticated) {
        return; // User cancelled authentication
      }

      try {
        // Disable button while uploading
        uploadAllFullBalanceButton.disabled = true;
        uploadAllFullBalanceButton.textContent = 'Uploading...';
        uploadAllFullBalanceButton.style.opacity = '0.6';
        uploadAllFullBalanceButton.style.cursor = 'not-allowed';

        debugLog('Starting full balance history upload for all Questrade accounts...');

        // Call the all accounts upload function (it handles date picker internally)
        await uploadFullBalanceHistoryForAllAccounts();
      } catch (error) {
        debugLog('Error in upload all full balance history:', error);
        toast.show(`Upload failed: ${error.message}`, 'error');
      } finally {
        // Re-enable button
        uploadAllFullBalanceButton.disabled = false;
        uploadAllFullBalanceButton.textContent = 'Upload All Balance History';
        uploadAllFullBalanceButton.style.opacity = '1';
        uploadAllFullBalanceButton.style.cursor = 'pointer';
      }
    }, { color: '#5a6268', id: 'questrade-upload-all-full-balance-btn' });

    buttonContainer.appendChild(uploadAllFullBalanceButton);

    // Create Upload All Activity button
    const uploadAllActivityButton = createButton('Upload All Activity', async () => {
      // Check Monarch authentication before proceeding
      const authenticated = await ensureMonarchAuthentication(null, 'upload all activity');
      if (!authenticated) {
        return; // User cancelled authentication
      }

      try {
        // Disable button while uploading
        uploadAllActivityButton.disabled = true;
        uploadAllActivityButton.textContent = 'Uploading...';
        uploadAllActivityButton.style.opacity = '0.6';
        uploadAllActivityButton.style.cursor = 'not-allowed';

        debugLog('Starting upload all activity for all Questrade accounts...');

        // Call the comprehensive upload function
        await uploadAllAccountsActivityToMonarch();
      } catch (error) {
        debugLog('Error in upload all activity:', error);
        toast.show(`Upload failed: ${error.message}`, 'error');
      } finally {
        // Re-enable button
        uploadAllActivityButton.disabled = false;
        uploadAllActivityButton.textContent = 'Upload All Activity';
        uploadAllActivityButton.style.opacity = '1';
        uploadAllActivityButton.style.cursor = 'pointer';
      }
    }, { color: '#6c757d', id: 'questrade-upload-all-activity-btn' });

    buttonContainer.appendChild(uploadAllActivityButton);
    testingContent.appendChild(buttonContainer);
  }

  // Add toggle functionality
  testingHeader.addEventListener('click', () => {
    const isCollapsed = testingContent.style.display === 'none';
    testingContent.style.display = isCollapsed ? 'block' : 'none';
    testingToggle.style.transform = isCollapsed ? 'rotate(0deg)' : 'rotate(-90deg)';
  });

  // Assemble testing section
  testingSection.appendChild(testingHeader);
  testingSection.appendChild(testingContent);

  return testingSection;
}

export default {
  createButton,
  createDatePicker,
  createButtonGroup,
  createSingleAccountUploadButton,
  createBulkUploadButton,
  createTestingSection,
};
