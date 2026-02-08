/**
 * CanadaLife Upload Button Component
 * Creates upload button styled for CanadaLife branding
 */

import { debugLog, getTodayLocal, formatDaysAgoLocal } from '../../../core/utils';
import { COLORS, STORAGE } from '../../../core/config';
import canadalife from '../../../api/canadalife';
import toast from '../../toast';
import { uploadAllCanadaLifeAccountsToMonarch, uploadCanadaLifeAccountWithDateRange, uploadTransactionHistory } from '../../../services/canadalife-upload';
import { ensureMonarchAuthentication } from '../../components/monarchLoginLink';
import { validateSelection, validateDateFormat, validateDateRange } from '../../components/formValidation';

/**
 * Creates a styled button for CanadaLife
 * @param {string} text - Button text
 * @param {Function} onClick - Click handler
 * @param {Object} options - Button options
 * @returns {HTMLButtonElement} The created button
 */
function createCanadaLifeButton(text, onClick, options = {}) {
  const button = document.createElement('button');
  button.textContent = text;
  button.style.cssText = `
    background-color: ${options.color || COLORS.CANADALIFE_BRAND};
    color: white;
    border: none;
    border-radius: 4px;
    padding: 10px 16px;
    margin: 5px 0;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
    box-shadow: 0 2px 4px rgba(162, 10, 41, 0.2);
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
      button.style.backgroundColor = options.hoverColor || '#8a0922';
      button.style.transform = 'translateY(-1px)';
      button.style.boxShadow = '0 4px 8px rgba(162, 10, 41, 0.3)';
    }
  });

  button.addEventListener('mouseout', () => {
    if (!button.disabled) {
      button.style.backgroundColor = options.color || COLORS.CANADALIFE_BRAND;
      button.style.transform = 'translateY(0)';
      button.style.boxShadow = '0 2px 4px rgba(162, 10, 41, 0.2)';
    }
  });

  // Add click handler
  if (onClick && !options.disabled) {
    button.addEventListener('click', onClick);
  }

  return button;
}

// Global variables to store UI state
let cachedAccounts = [];
let accountSelectorElement = null;
let dateSelectorElement = null;
let startDateSelectorElement = null;
let endDateSelectorElement = null;
let txStartDateSelectorElement = null;
let txEndDateSelectorElement = null;
let balanceResultElement = null;
let historicalBalanceResultElement = null;
let transactionResultElement = null;
let accountsLoadingState = 'idle'; // 'idle', 'loading', 'loaded', 'error'
let loadAccountsRetryCount = 0;
const MAX_RETRY_COUNT = 3;

/**
 * Creates an account selector dropdown with account list display
 * @returns {HTMLElement} Account selector container
 */
function createAccountSelector() {
  const container = document.createElement('div');
  container.style.cssText = 'margin: 8px 0;';

  const label = document.createElement('label');
  label.textContent = 'Select Account:';
  label.style.cssText = `
    display: block;
    font-size: 13px;
    font-weight: 500;
    margin-bottom: 4px;
    color: #333;
  `;

  const select = document.createElement('select');
  select.id = 'canadalife-account-selector';
  select.style.cssText = `
    width: 100%;
    padding: 8px;
    border: 1px solid #ddd;
    border-radius: 4px;
    font-size: 14px;
    background-color: white;
  `;

  // Add initial loading option
  const loadingOption = document.createElement('option');
  loadingOption.value = '';
  loadingOption.textContent = 'Loading accounts...';
  loadingOption.disabled = true;
  loadingOption.selected = true;
  select.appendChild(loadingOption);

  container.appendChild(label);
  container.appendChild(select);

  // Store reference for later updates
  accountSelectorElement = select;

  // Auto-load accounts when selector is created
  autoLoadAccounts();

  return container;
}

/**
 * Creates a date selector input
 * @returns {HTMLElement} Date selector container
 */
function createDateSelector() {
  const container = document.createElement('div');
  container.style.cssText = 'margin: 8px 0;';

  const label = document.createElement('label');
  label.textContent = 'Select Date:';
  label.style.cssText = `
    display: block;
    font-size: 13px;
    font-weight: 500;
    margin-bottom: 4px;
    color: #333;
  `;

  const input = document.createElement('input');
  input.type = 'date';
  input.id = 'canadalife-date-selector';
  input.style.cssText = `
    width: 100%;
    padding: 8px;
    border: 1px solid #ddd;
    border-radius: 4px;
    font-size: 14px;
  `;

  // Set default to today
  input.value = getTodayLocal();

  container.appendChild(label);
  container.appendChild(input);

  // Store reference for later use
  dateSelectorElement = input;

  return container;
}

/**
 * Creates a date range selector for historical balance
 * @returns {HTMLElement} Date range selector container
 */
function createDateRangeSelector() {
  const container = document.createElement('div');
  container.style.cssText = 'margin: 8px 0;';

  const label = document.createElement('label');
  label.textContent = 'Historical Date Range:';
  label.style.cssText = `
    display: block;
    font-size: 13px;
    font-weight: 500;
    margin-bottom: 4px;
    color: #333;
  `;

  const dateContainer = document.createElement('div');
  dateContainer.style.cssText = 'display: grid; grid-template-columns: 1fr auto 1fr; gap: 8px; align-items: center;';

  // Start date input
  const startDateInput = document.createElement('input');
  startDateInput.type = 'date';
  startDateInput.id = 'canadalife-start-date-selector';
  startDateInput.style.cssText = `
    padding: 8px;
    border: 1px solid #ddd;
    border-radius: 4px;
    font-size: 14px;
  `;

  // Set default to 7 days ago
  startDateInput.value = formatDaysAgoLocal(7);

  // "to" text
  const toText = document.createElement('span');
  toText.textContent = 'to';
  toText.style.cssText = 'font-size: 13px; color: #666; text-align: center;';

  // End date input
  const endDateInput = document.createElement('input');
  endDateInput.type = 'date';
  endDateInput.id = 'canadalife-end-date-selector';
  endDateInput.style.cssText = `
    padding: 8px;
    border: 1px solid #ddd;
    border-radius: 4px;
    font-size: 14px;
  `;

  // Set default to today
  endDateInput.value = getTodayLocal();

  dateContainer.appendChild(startDateInput);
  dateContainer.appendChild(toText);
  dateContainer.appendChild(endDateInput);

  container.appendChild(label);
  container.appendChild(dateContainer);

  // Store references for later use
  startDateSelectorElement = startDateInput;
  endDateSelectorElement = endDateInput;

  return container;
}

/**
 * Creates a date range selector for transaction history upload
 * @returns {HTMLElement} Transaction date range selector container
 */
function createTransactionDateRangeSelector() {
  const container = document.createElement('div');
  container.id = 'canadalife-tx-date-range-container';
  container.style.cssText = 'margin: 8px 0;';

  const label = document.createElement('label');
  label.id = 'canadalife-tx-date-range-label';
  label.textContent = 'Transaction Date Range:';
  label.style.cssText = `
    display: block;
    font-size: 13px;
    font-weight: 500;
    margin-bottom: 4px;
    color: #333;
  `;

  const dateContainer = document.createElement('div');
  dateContainer.id = 'canadalife-tx-date-inputs-container';
  dateContainer.style.cssText = 'display: grid; grid-template-columns: 1fr auto 1fr; gap: 8px; align-items: center;';

  // Start date input
  const startDateInput = document.createElement('input');
  startDateInput.type = 'date';
  startDateInput.id = 'canadalife-tx-start-date-selector';
  startDateInput.style.cssText = `
    padding: 8px;
    border: 1px solid #ddd;
    border-radius: 4px;
    font-size: 14px;
  `;

  // Default to 365 days ago (API limit is 1 year)
  startDateInput.value = formatDaysAgoLocal(365);

  // "to" text
  const toText = document.createElement('span');
  toText.id = 'canadalife-tx-date-to-text';
  toText.textContent = 'to';
  toText.style.cssText = 'font-size: 13px; color: #666; text-align: center;';

  // End date input
  const endDateInput = document.createElement('input');
  endDateInput.type = 'date';
  endDateInput.id = 'canadalife-tx-end-date-selector';
  endDateInput.style.cssText = `
    padding: 8px;
    border: 1px solid #ddd;
    border-radius: 4px;
    font-size: 14px;
  `;

  // Default to today
  endDateInput.value = getTodayLocal();

  dateContainer.appendChild(startDateInput);
  dateContainer.appendChild(toText);
  dateContainer.appendChild(endDateInput);

  container.appendChild(label);
  container.appendChild(dateContainer);

  // Store references for later use
  txStartDateSelectorElement = startDateInput;
  txEndDateSelectorElement = endDateInput;

  return container;
}

/**
 * Creates a transaction result display area
 * @returns {HTMLElement} Transaction result container
 */
function createTransactionResultDisplay() {
  const container = document.createElement('div');
  container.id = 'canadalife-transaction-result';
  container.style.cssText = `
    margin: 8px 0;
    padding: 12px;
    background-color: #f8f9fa;
    border: 1px solid #e9ecef;
    border-radius: 4px;
    display: none;
  `;

  // Store reference for later updates
  transactionResultElement = container;

  return container;
}

/**
 * Gets the transaction date range
 * @returns {Object|null} Object with startDate and endDate or null
 */
function getTransactionDateRange() {
  if (!txStartDateSelectorElement || !txEndDateSelectorElement) return null;

  const startDate = txStartDateSelectorElement.value;
  const endDate = txEndDateSelectorElement.value;

  if (!startDate || !endDate) return null;

  return { startDate, endDate };
}

/**
 * Updates the transaction date range start date based on selected account's enrollment date
 * @param {Object} account - Selected Canada Life account
 */
function updateTransactionStartDateFromAccount(account) {
  if (!txStartDateSelectorElement || !account) return;

  if (account.EnrollmentDate) {
    // Parse the enrollment date and format to YYYY-MM-DD
    const enrollmentDate = new Date(account.EnrollmentDate);
    if (!Number.isNaN(enrollmentDate.getTime())) {
      const year = enrollmentDate.getFullYear();
      const month = String(enrollmentDate.getMonth() + 1).padStart(2, '0');
      const day = String(enrollmentDate.getDate()).padStart(2, '0');
      txStartDateSelectorElement.value = `${year}-${month}-${day}`;
      debugLog(`Set transaction start date to enrollment date: ${txStartDateSelectorElement.value}`);
    }
  }
}

/**
 * Displays the transaction upload result
 * @param {Object} result - Transaction upload result
 */
function displayTransactionResult(result) {
  if (!transactionResultElement) return;

  const { transactionCount, accountName, dateRange } = result;

  transactionResultElement.innerHTML = `
    <h4 style="margin: 0 0 8px 0; color: #333;">Transaction Upload Result</h4>
    <div style="margin-bottom: 8px;">
      <strong>Account:</strong> ${accountName}
    </div>
    <div style="margin-bottom: 8px;">
      <strong>Date Range:</strong> ${dateRange.startDate} to ${dateRange.endDate}
    </div>
    <div style="padding: 8px; background-color: #d4edda; border-radius: 4px;">
      <div style="font-size: 13px; color: #666;">Transactions Uploaded</div>
      <div style="font-size: 18px; font-weight: 600; color: #28a745;">${transactionCount}</div>
    </div>
  `;

  transactionResultElement.style.display = 'block';
}

/**
 * Creates a historical balance result display area
 * @returns {HTMLElement} Historical balance result container
 */
function createHistoricalBalanceResultDisplay() {
  const container = document.createElement('div');
  container.id = 'canadalife-historical-balance-result';
  container.style.cssText = `
    margin: 8px 0;
    padding: 12px;
    background-color: #f8f9fa;
    border: 1px solid #e9ecef;
    border-radius: 4px;
    display: none;
    max-height: 400px;
    overflow-y: auto;
  `;

  // Store reference for later updates
  historicalBalanceResultElement = container;

  return container;
}

/**
 * Creates a balance result display area
 * @returns {HTMLElement} Balance result container
 */
function createBalanceResultDisplay() {
  const container = document.createElement('div');
  container.id = 'canadalife-balance-result';
  container.style.cssText = `
    margin: 8px 0;
    padding: 12px;
    background-color: #f8f9fa;
    border: 1px solid #e9ecef;
    border-radius: 4px;
    display: none;
  `;

  // Store reference for later updates
  balanceResultElement = container;

  return container;
}

/**
 * Extract the source Canada Life account from consolidated or raw account object
 * Handles both consolidated structure (with .canadalifeAccount) and raw API response
 * @param {Object} account - Account object (consolidated or raw)
 * @returns {Object} Source Canada Life account object
 */
function extractSourceAccount(account) {
  // If this is a consolidated account with canadalifeAccount property, extract it
  if (account.canadalifeAccount) {
    return account.canadalifeAccount;
  }
  // Otherwise, assume it's already a raw API account
  return account;
}

/**
 * Updates the account selector with loaded accounts
 * Handles both consolidated and raw account formats
 * @param {Array} accounts - Array of CanadaLife accounts (consolidated or raw)
 */
function updateAccountSelector(accounts) {
  if (!accountSelectorElement) return;

  // Store accounts for later use
  cachedAccounts = accounts;

  // Clear existing options
  accountSelectorElement.innerHTML = '';

  // Add default option
  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = 'Select an account...';
  defaultOption.selected = true;
  accountSelectorElement.appendChild(defaultOption);

  // Add account options - extract source account from consolidated structure
  accounts.forEach((account, index) => {
    const sourceAccount = extractSourceAccount(account);
    const option = document.createElement('option');
    option.value = index.toString();
    option.textContent = `${sourceAccount.EnglishShortName} - ${sourceAccount.LongNameEnglish}`;
    accountSelectorElement.appendChild(option);
  });

  accountsLoadingState = 'loaded';

  toast.show(`Loaded ${accounts.length} Canada Life accounts`, 'debug');
}

/**
 * Updates the account selector loading state
 * @param {string} state - Loading state: 'loading', 'error'
 * @param {string} message - Optional message to display
 */
function updateAccountSelectorLoadingState(state, message = '') {
  if (!accountSelectorElement) return;

  accountsLoadingState = state;
  accountSelectorElement.innerHTML = '';

  const option = document.createElement('option');
  option.value = '';
  option.disabled = true;
  option.selected = true;

  if (state === 'loading') {
    option.textContent = 'Loading accounts...';
  } else if (state === 'error') {
    option.textContent = message || 'Failed to load accounts';
  }

  accountSelectorElement.appendChild(option);
}

/**
 * Auto-load Canada Life accounts with retry logic
 * @returns {Promise<Array|null>} Loaded accounts or null if failed
 */
async function autoLoadAccounts() {
  if (accountsLoadingState === 'loaded') {
    return cachedAccounts;
  }

  try {
    updateAccountSelectorLoadingState('loading');

    debugLog('Auto-loading Canada Life accounts...');
    const accounts = await canadalife.loadCanadaLifeAccounts();

    updateAccountSelector(accounts);
    loadAccountsRetryCount = 0; // Reset retry count on success

    return accounts;
  } catch (error) {
    debugLog('Error auto-loading Canada Life accounts:', error);

    loadAccountsRetryCount += 1;

    if (loadAccountsRetryCount < MAX_RETRY_COUNT) {
      updateAccountSelectorLoadingState('loading', `Retrying... (${loadAccountsRetryCount}/${MAX_RETRY_COUNT})`);

      // Retry with exponential backoff
      const delay = 2 ** loadAccountsRetryCount * 1000; // 2s, 4s, 8s
      setTimeout(() => autoLoadAccounts(), delay);
    } else {
      updateAccountSelectorLoadingState('error', 'Failed to load accounts. Please refresh page.');
      toast.show(`Failed to load accounts after ${MAX_RETRY_COUNT} attempts: ${error.message}`, 'error');
    }

    return null;
  }
}

/**
 * Gets the currently selected account (source Canada Life account)
 * Returns the extracted source account, not the consolidated object
 * @returns {Object|null} Selected source Canada Life account object or null
 */
function getSelectedAccount() {
  if (!accountSelectorElement || !cachedAccounts.length) return null;

  const selectedIndex = accountSelectorElement.value;
  if (!selectedIndex || selectedIndex === '') return null;

  const consolidated = cachedAccounts[parseInt(selectedIndex, 10)];
  return extractSourceAccount(consolidated);
}

/**
 * Gets the currently selected date
 * @returns {string|null} Selected date in YYYY-MM-DD format or null
 */
function getSelectedDate() {
  if (!dateSelectorElement) return null;

  const date = dateSelectorElement.value;
  return date || null;
}

/**
 * Gets the currently selected date range
 * @returns {Object|null} Object with startDate and endDate or null
 */
function getSelectedDateRange() {
  if (!startDateSelectorElement || !endDateSelectorElement) return null;

  const startDate = startDateSelectorElement.value;
  const endDate = endDateSelectorElement.value;

  if (!startDate || !endDate) return null;

  return { startDate, endDate };
}

/**
 * Displays the historical balance result data
 * @param {Object} historicalData - Historical balance data from API
 */
function displayHistoricalBalanceResult(historicalData) {
  if (!historicalBalanceResultElement) return;

  const {
    data, account, dateRange, totalDays, apiCallsMade,
  } = historicalData;

  // Calculate optimization stats
  const optimizationRatio = Math.round((1 - apiCallsMade / totalDays) * 100);

  // Create table
  let tableHTML = `
    <div style="margin-bottom: 12px;">
      <h4 style="margin: 0 0 8px 0; color: #333;">${account.name} - Historical Balance</h4>
      <div style="font-size: 13px; color: #666; margin-bottom: 8px;">
        <strong>Date Range:</strong> ${dateRange.startDate} to ${dateRange.endDate}<br>
        <strong>Business Days:</strong> ${totalDays} | <strong>API Calls:</strong> ${apiCallsMade} | <strong>Optimization:</strong> ${optimizationRatio}% fewer calls
      </div>
    </div>
    <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
  `;

  // Add table headers and rows
  data.forEach((row, index) => {
    const isHeader = index === 0;
    let rowStyle;
    if (isHeader) {
      rowStyle = 'background-color: #e9ecef; font-weight: 600;';
    } else if (index % 2 === 1) {
      rowStyle = 'background-color: #f8f9fa;';
    } else {
      rowStyle = '';
    }

    tableHTML += `<tr style="${rowStyle}">`;

    row.forEach((cell, cellIndex) => {
      const cellTag = isHeader ? 'th' : 'td';
      const cellStyle = 'padding: 8px; border: 1px solid #dee2e6; text-align: left;';

      let cellContent = cell;

      // Format currency values (balance column)
      if (!isHeader && cellIndex === 1 && typeof cell === 'number') {
        cellContent = new Intl.NumberFormat('en-CA', {
          style: 'currency',
          currency: 'CAD',
        }).format(cell);
      }

      tableHTML += `<${cellTag} style="${cellStyle}">${cellContent}</${cellTag}>`;
    });

    tableHTML += '</tr>';
  });

  tableHTML += `
    </table>
    <div style="margin-top: 8px; font-size: 12px; color: #666;">
      <em>Historical balance data loaded successfully. Business days only (weekends skipped).</em>
    </div>
  `;

  historicalBalanceResultElement.innerHTML = tableHTML;
  historicalBalanceResultElement.style.display = 'block';

  toast.show(`Historical balance loaded for ${account.shortName}: ${totalDays} days, ${apiCallsMade} API calls`, 'debug');
}

/**
 * Displays the balance result data
 * @param {Object} balanceData - Balance data from API
 */
function displayBalanceResult(balanceData) {
  if (!balanceResultElement) return;

  const formattedOpeningBalance = new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
  }).format(balanceData.openingBalance);

  const formattedClosingBalance = new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
  }).format(balanceData.closingBalance);

  const formattedChange = new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    signDisplay: 'always',
  }).format(balanceData.change);

  const changeColor = balanceData.change >= 0 ? '#28a745' : '#dc3545';

  balanceResultElement.innerHTML = `
    <h4 style="margin: 0 0 8px 0; color: #333;">${balanceData.account.name}</h4>
    <div style="margin-bottom: 8px;">
      <strong>Date:</strong> ${balanceData.date}
    </div>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 8px;">
      <div>
        <div style="font-size: 13px; color: #666;">Opening Balance</div>
        <div style="font-size: 16px; font-weight: 500;">${formattedOpeningBalance}</div>
      </div>
      <div>
        <div style="font-size: 13px; color: #666;">Closing Balance</div>
        <div style="font-size: 16px; font-weight: 500;">${formattedClosingBalance}</div>
      </div>
    </div>
    <div style="padding: 8px; background-color: ${balanceData.change >= 0 ? '#d4edda' : '#f8d7da'}; border-radius: 4px;">
      <div style="font-size: 13px; color: #666;">Daily Change</div>
      <div style="font-size: 16px; font-weight: 600; color: ${changeColor};">${formattedChange}</div>
    </div>
  `;

  balanceResultElement.style.display = 'block';

  toast.show(`Balance loaded for ${balanceData.account.shortName}: ${formattedClosingBalance}`, 'debug');
}

/**
 * Creates the main upload button for CanadaLife
 * @returns {HTMLElement} Upload button container
 */
export function createCanadaLifeUploadButton() {
  const container = document.createElement('div');
  container.className = 'canadalife-upload-button-container';
  container.style.cssText = 'margin: 8px 0;';

  // Check authentication status
  const authStatus = canadalife.checkAuth();

  if (!authStatus.authenticated) {
    // Show message if not authenticated
    const message = document.createElement('div');
    message.textContent = 'Please log in to CanadaLife to enable upload functionality';
    message.style.cssText = `
      padding: 8px 12px;
      background-color: #fff3cd;
      color: #856404;
      border: 1px solid #ffeaa7;
      border-radius: 4px;
      font-size: 13px;
      margin: 5px 0;
    `;
    container.appendChild(message);
    return container;
  }

  // Create upload all to Monarch button (PRIMARY - moved to top)
  const uploadAllButton = createCanadaLifeButton('Upload All to Monarch', async () => {
    // Check Monarch authentication before proceeding
    const authenticated = await ensureMonarchAuthentication(null, 'upload Canada Life accounts');
    if (!authenticated) {
      return; // User cancelled authentication
    }

    try {
      // Disable button while uploading
      uploadAllButton.disabled = true;
      uploadAllButton.textContent = 'Uploading...';

      debugLog('Starting upload all Canada Life accounts to Monarch...');

      // Call the comprehensive upload function
      await uploadAllCanadaLifeAccountsToMonarch();
    } catch (error) {
      debugLog('Error in upload all Canada Life accounts:', error);
      toast.show(`Upload failed: ${error.message}`, 'error');
    } finally {
      // Re-enable button
      uploadAllButton.disabled = false;
      uploadAllButton.textContent = 'Upload All to Monarch';
    }
  }, { color: '#28a745' }); // Green color for primary upload action

  // Create upload custom range button (SECONDARY - moved to top)
  const uploadCustomRangeButton = createCanadaLifeButton('Upload Custom Range', async () => {
    // Check Monarch authentication before proceeding
    const authenticated = await ensureMonarchAuthentication(null, 'upload Canada Life account with custom range');
    if (!authenticated) {
      return; // User cancelled authentication
    }

    try {
      // Disable button while uploading
      uploadCustomRangeButton.disabled = true;
      uploadCustomRangeButton.textContent = 'Uploading...';

      debugLog('Starting custom range upload for Canada Life account...');

      // Call the custom range upload function
      await uploadCanadaLifeAccountWithDateRange();
    } catch (error) {
      debugLog('Error in custom range upload:', error);
      toast.show(`Upload failed: ${error.message}`, 'error');
    } finally {
      // Re-enable button
      uploadCustomRangeButton.disabled = false;
      uploadCustomRangeButton.textContent = 'Upload Custom Range';
    }
  }, { color: '#17a2b8' }); // Blue color for secondary upload action

  // Main upload buttons container (at the top)
  const mainUploadContainer = document.createElement('div');
  mainUploadContainer.style.cssText = 'display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px;';
  mainUploadContainer.appendChild(uploadAllButton);
  mainUploadContainer.appendChild(uploadCustomRangeButton);
  container.appendChild(mainUploadContainer);

  // Only show testing section when Development Mode is enabled
  const isDevelopmentMode = GM_getValue(STORAGE.DEVELOPMENT_MODE, false);
  if (!isDevelopmentMode) {
    return container;
  }

  // Create collapsible testing section (only visible in Development Mode)
  const testingSection = document.createElement('div');
  testingSection.style.cssText = `
    border: 1px solid #ddd;
    border-radius: 4px;
    margin: 8px 0;
    background-color: #fafafa;
  `;

  // Create toggle header for testing section
  const testingHeader = document.createElement('div');
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
  testingTitle.textContent = '🧪 Testing (for development only)';

  const testingToggle = document.createElement('span');
  testingToggle.textContent = '▼';
  testingToggle.style.cssText = 'transition: transform 0.2s ease; font-size: 12px; transform: rotate(-90deg);';

  testingHeader.appendChild(testingTitle);
  testingHeader.appendChild(testingToggle);

  // Create collapsible content container
  const testingContent = document.createElement('div');
  testingContent.style.cssText = `
    padding: 12px;
    display: none;
  `;

  // Create load balance button for testing
  const loadBalanceButton = createCanadaLifeButton('Load Balance', async () => {
    try {
      // Validate account selection
      if (!validateSelection(accountSelectorElement, 'Please select an account')) {
        return;
      }

      // Validate date selection
      if (!validateDateFormat(dateSelectorElement, 'Please select a date')) {
        return;
      }

      // Get selected account and date
      const selectedAccount = getSelectedAccount();
      const selectedDate = getSelectedDate();

      // Disable button while loading
      loadBalanceButton.disabled = true;
      loadBalanceButton.textContent = 'Loading...';

      debugLog('Loading account balance...', { account: selectedAccount.EnglishShortName, date: selectedDate });

      // Load balance from Canada Life API (use same date for both start and end for single-day query)
      const balanceData = await canadalife.loadAccountActivityReport(selectedAccount, selectedDate, selectedDate);

      // Display the balance result
      displayBalanceResult(balanceData);
    } catch (error) {
      debugLog('Error loading account balance:', error);
      toast.show(`Failed to load balance: ${error.message}`, 'error');
    } finally {
      // Re-enable button
      loadBalanceButton.disabled = false;
      loadBalanceButton.textContent = 'Load Balance';
    }
  });

  // Create upload transaction history button for testing
  const uploadTransactionHistoryButton = createCanadaLifeButton('Upload Transaction History', async () => {
    try {
      // Validate account selection
      if (!validateSelection(accountSelectorElement, 'Please select an account')) {
        return;
      }

      // Validate start date
      if (!validateDateFormat(txStartDateSelectorElement, 'Please select a start date')) {
        return;
      }

      // Validate end date
      if (!validateDateFormat(txEndDateSelectorElement, 'Please select an end date')) {
        return;
      }

      // Validate date range (start before end)
      if (!validateDateRange(txStartDateSelectorElement, txEndDateSelectorElement, 'Start date must be before end date')) {
        return;
      }

      // Check Monarch authentication before proceeding
      const authenticated = await ensureMonarchAuthentication(null, 'upload Canada Life transactions');
      if (!authenticated) {
        return; // User cancelled authentication
      }

      // Get selected account and date range
      const selectedAccount = getSelectedAccount();
      const txDateRange = getTransactionDateRange();

      // Disable button while uploading
      uploadTransactionHistoryButton.disabled = true;
      uploadTransactionHistoryButton.textContent = 'Uploading...';

      debugLog('Uploading transaction history...', {
        account: selectedAccount.EnglishShortName,
        startDate: txDateRange.startDate,
        endDate: txDateRange.endDate,
      });

      // Create progress callback
      const progressCallback = (message) => {
        uploadTransactionHistoryButton.textContent = message;
      };

      // Upload transaction history
      const result = await uploadTransactionHistory(
        selectedAccount,
        txDateRange.startDate,
        txDateRange.endDate,
        { onProgress: progressCallback },
      );

      // Display the result
      displayTransactionResult({
        ...result,
        accountName: selectedAccount.LongNameEnglish || selectedAccount.EnglishShortName,
        dateRange: txDateRange,
      });
    } catch (error) {
      debugLog('Error uploading transaction history:', error);
      toast.show(`Failed to upload transactions: ${error.message}`, 'error');
    } finally {
      // Re-enable button
      uploadTransactionHistoryButton.disabled = false;
      uploadTransactionHistoryButton.textContent = 'Upload Transaction History';
    }
  }, { color: '#6c757d' }); // Gray color to distinguish from balance operations

  // Create load historical balance button for testing
  const loadHistoricalBalanceButton = createCanadaLifeButton('Load Historical Balance', async () => {
    try {
      // Validate account selection
      if (!validateSelection(accountSelectorElement, 'Please select an account')) {
        return;
      }

      // Validate start date
      if (!validateDateFormat(startDateSelectorElement, 'Please select a start date')) {
        return;
      }

      // Validate end date
      if (!validateDateFormat(endDateSelectorElement, 'Please select an end date')) {
        return;
      }

      // Validate date range (start before end)
      if (!validateDateRange(startDateSelectorElement, endDateSelectorElement, 'Start date must be before end date')) {
        return;
      }

      // Get selected account and date range
      const selectedAccount = getSelectedAccount();
      const selectedDateRange = getSelectedDateRange();

      // Disable button while loading
      loadHistoricalBalanceButton.disabled = true;
      loadHistoricalBalanceButton.textContent = 'Loading...';

      debugLog('Loading historical account balance...', {
        account: selectedAccount.EnglishShortName,
        startDate: selectedDateRange.startDate,
        endDate: selectedDateRange.endDate,
      });

      // Create progress callback for historical balance load
      const progressCallback = (current, total, percentage) => {
        loadHistoricalBalanceButton.textContent = `Loaded ${current}/${total} (${percentage}%)`;
      };

      // Load historical balance from Canada Life API with progress tracking
      const historicalData = await canadalife.loadAccountBalanceHistory(
        selectedAccount,
        selectedDateRange.startDate,
        selectedDateRange.endDate,
        progressCallback,
      );

      // Display the historical balance result
      displayHistoricalBalanceResult(historicalData);
    } catch (error) {
      debugLog('Error loading historical account balance:', error);
      toast.show(`Failed to load historical balance: ${error.message}`, 'error');
    } finally {
      // Re-enable button
      loadHistoricalBalanceButton.disabled = false;
      loadHistoricalBalanceButton.textContent = 'Load Historical Balance';
    }
  });

  // Create account selector for testing
  const accountSelector = createAccountSelector();

  // Add change listener to update transaction start date when account is selected
  if (accountSelectorElement) {
    accountSelectorElement.addEventListener('change', () => {
      const selectedAccount = getSelectedAccount();
      if (selectedAccount) {
        updateTransactionStartDateFromAccount(selectedAccount);
      }
    });
  }

  testingContent.appendChild(accountSelector);

  // Create date selector with load balance button for testing
  const dateSelector = createDateSelector();
  dateSelector.appendChild(loadBalanceButton);
  testingContent.appendChild(dateSelector);

  // Create date range selector with load historical balance button for testing
  const dateRangeSelector = createDateRangeSelector();
  dateRangeSelector.appendChild(loadHistoricalBalanceButton);
  testingContent.appendChild(dateRangeSelector);

  // Create balance result display area inside testing section
  const balanceResult = createBalanceResultDisplay();
  testingContent.appendChild(balanceResult);

  // Create historical balance result display area inside testing section
  const historicalBalanceResult = createHistoricalBalanceResultDisplay();
  testingContent.appendChild(historicalBalanceResult);

  // Create transaction date range selector with upload button for testing
  const txDateRangeSelector = createTransactionDateRangeSelector();
  txDateRangeSelector.appendChild(uploadTransactionHistoryButton);
  testingContent.appendChild(txDateRangeSelector);

  // Create transaction result display area inside testing section
  const transactionResult = createTransactionResultDisplay();
  testingContent.appendChild(transactionResult);

  // Add toggle functionality
  testingHeader.addEventListener('click', () => {
    const isCollapsed = testingContent.style.display === 'none';
    testingContent.style.display = isCollapsed ? 'block' : 'none';
    testingToggle.style.transform = isCollapsed ? 'rotate(0deg)' : 'rotate(-90deg)';
  });

  // Assemble testing section
  testingSection.appendChild(testingHeader);
  testingSection.appendChild(testingContent);
  container.appendChild(testingSection);

  return container;
}

export default {
  createCanadaLifeButton,
  createCanadaLifeUploadButton,
};
