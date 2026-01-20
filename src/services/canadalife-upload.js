/**
 * Canada Life Upload Service
 * Handles uploading Canada Life balance history to Monarch Money
 */

import {
  debugLog, formatDate, getTodayLocal, getYesterdayLocal, formatDaysAgoLocal, parseLocalDate,
  calculateFromDateWithLookback, saveLastUploadDate, getLastUpdateDate,
} from '../core/utils';
import { STORAGE, LOGO_CLOUDINARY_IDS } from '../core/config';
import stateManager from '../core/state';
import canadalife from '../api/canadalife';
import monarchApi from '../api/monarch';
import toast from '../ui/toast';
import { showProgressDialog } from '../ui/components/progressDialog';
import { showDatePickerPromise } from '../ui/components/datePicker';
import { showMonarchAccountSelectorWithCreate } from '../ui/components/accountSelectorWithCreate';
import { ensureMonarchAuthentication } from '../ui/components/monarchLoginLink';

/**
 * Custom Canada Life upload error class
 */
export class CanadaLifeUploadError extends Error {
  constructor(message, accountId) {
    super(message);
    this.name = 'CanadaLifeUploadError';
    this.accountId = accountId;
  }
}

/**
 * Convert Canada Life balance history data to Monarch CSV format
 * @param {Object} historicalData - Historical data from loadAccountBalanceHistory
 * @returns {string} CSV formatted data for Monarch
 */
export function convertCanadaLifeDataToCSV(historicalData) {
  try {
    if (!historicalData || !historicalData.data || !Array.isArray(historicalData.data)) {
      throw new Error('Invalid historical data format');
    }

    const { data } = historicalData;

    // Skip header row and process data rows
    const dataRows = data.slice(1);

    if (dataRows.length === 0) {
      throw new Error('No balance data to convert');
    }

    // Start CSV with Monarch expected header
    let csvContent = '"Date","Total Equity","Account Name"\n';

    // Add each balance record
    dataRows.forEach((row) => {
      const [date, balance, accountName] = row;
      csvContent += `"${date}","${balance}","${accountName}"\n`;
    });

    debugLog(`Converted ${dataRows.length} balance records to CSV format`);
    return csvContent;
  } catch (error) {
    debugLog('Error converting Canada Life data to CSV:', error);
    throw new Error(`Failed to convert balance data: ${error.message}`);
  }
}

/**
 * Get yesterday's date in YYYY-MM-DD format (for last upload date storage)
 * @returns {string} Yesterday's date in local timezone
 */
function getYesterdayDate() {
  return getYesterdayLocal();
}

/**
 * Get today's date in YYYY-MM-DD format (for upload end date)
 * @returns {string} Today's date in local timezone
 */
function getTodayDate() {
  return getTodayLocal();
}

/**
 * Parse date from multiple formats (YYYY-MM-DD, ISO format, etc.)
 * @param {string} dateString - Date string in various formats
 * @returns {Date} Date object in local timezone
 */
function parseFlexibleDate(dateString) {
  if (!dateString) {
    debugLog('Empty date string provided to parseFlexibleDate');
    return new Date();
  }

  // Handle ISO format dates (e.g., "2014-07-28T00:00:00")
  if (dateString.includes('T')) {
    const isoDate = new Date(dateString);
    if (!Number.isNaN(isoDate.getTime())) {
      debugLog(`Parsed ISO date: ${dateString} -> ${isoDate.toISOString()}`);
      return isoDate;
    }
  }

  // Handle YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    const [year, month, day] = dateString.split('-').map(Number);
    const localDate = new Date(year, month - 1, day);
    debugLog(`Parsed YYYY-MM-DD date: ${dateString} -> ${localDate.toISOString()}`);
    return localDate;
  }

  // Fallback to standard Date parsing
  const fallbackDate = new Date(dateString);
  if (!Number.isNaN(fallbackDate.getTime())) {
    debugLog(`Parsed date using fallback: ${dateString} -> ${fallbackDate.toISOString()}`);
    return fallbackDate;
  }

  debugLog(`Failed to parse date: ${dateString}, using current date as fallback`);
  return new Date();
}

/**
 * Format date to user-friendly YYYY-MM-DD format
 * @param {Date|string} date - Date object or string
 * @returns {string} Formatted date string in YYYY-MM-DD format
 */
function formatUserFriendlyDate(date) {
  if (typeof date === 'string') {
    date = parseFlexibleDate(date);
  }

  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return 'Invalid Date';
  }

  return formatDate(date);
}

/**
 * Validate start date against account creation date
 * @param {string} startDate - Start date in YYYY-MM-DD format
 * @param {Object} account - Canada Life account object with EnrollmentDate
 * @throws {Error} If start date is before account creation date
 */
function validateStartDateAgainstAccountCreation(startDate, account) {
  if (!account.EnrollmentDate) {
    // If no enrollment date available, skip validation
    debugLog('No EnrollmentDate found for account, skipping validation');
    return;
  }

  debugLog(`Validating start date: ${startDate} against enrollment date: ${account.EnrollmentDate}`);

  const start = parseLocalDate(startDate);
  const enrollmentDate = parseFlexibleDate(account.EnrollmentDate);

  debugLog(`Parsed dates - Start: ${start.toISOString()}, Enrollment: ${enrollmentDate.toISOString()}`);

  if (start < enrollmentDate) {
    const formattedEnrollmentDate = formatUserFriendlyDate(account.EnrollmentDate);
    const accountName = account.LongNameEnglish || account.EnglishShortName || 'Account';

    throw new Error(
      `Start date ${startDate} is before ${accountName} creation date ${formattedEnrollmentDate}. `
      + `Please select a start date on or after ${formattedEnrollmentDate}.`,
    );
  }

  debugLog('Date validation passed');
}

/**
 * Validate date range for Canada Life uploads
 * @param {string} startDate - Start date in YYYY-MM-DD format
 * @param {string} endDate - End date in YYYY-MM-DD format
 * @param {boolean} allowToday - Whether to allow today as end date (default: false for custom uploads)
 * @param {Object} account - Optional account object for enrollment date validation
 * @throws {Error} If dates are invalid
 */
function validateDateRange(startDate, endDate, allowToday = false, account = null) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const today = new Date(getTodayDate());

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('Invalid date format. Use YYYY-MM-DD');
  }

  if (start > end) {
    throw new Error('Start date must be before or equal to end date');
  }

  // Validate against account creation date if account provided
  if (account) {
    validateStartDateAgainstAccountCreation(startDate, account);
  }

  // if (!allowToday && end > yesterday) {
  //   throw new Error('End date cannot be today or future for custom uploads. Maximum allowed: yesterday');
  // }

  if (allowToday && end > today) {
    throw new Error('End date cannot be in the future');
  }
}

/**
 * Get or prompt for start date for a Canada Life account
 * @param {string} accountId - Canada Life account ID (agreementId)
 * @returns {Promise<string|null>} Start date in YYYY-MM-DD format, or null if cancelled
 */
async function getStartDateForAccount(accountId) {
  // Use unified date calculation with configurable lookback
  const fromDate = calculateFromDateWithLookback('canadalife', accountId);
  if (fromDate) {
    return fromDate;
  }

  // No previous upload date - prompt user for initial start date
  const account = stateManager.getState().currentAccount;
  const accountName = account.nickname || account.name || 'Account';

  const defaultDate = formatDaysAgoLocal(90); // 90 days ago
  const selectedDate = await showDatePickerPromise(
    defaultDate,
    `Select initial start date for ${accountName} balance history upload`,
  );

  return selectedDate;
}

/**
 * Get or create Monarch account mapping for a Canada Life account
 * @param {Object} canadalifAccount - Canada Life account object
 * @returns {Promise<Object|null>} Monarch account object, or null if cancelled
 */
async function getMonarchAccountMapping(canadalifAccount) {
  const accountId = canadalifAccount.agreementId;

  // Check for existing mapping
  const existingMapping = GM_getValue(`${STORAGE.CANADALIFE_ACCOUNT_MAPPING_PREFIX}${accountId}`, null);
  if (existingMapping) {
    try {
      return JSON.parse(existingMapping);
    } catch (error) {
      debugLog('Error parsing existing Canada Life account mapping:', error);
      // Fall through to create new mapping
    }
  }

  // No mapping exists - show account selector
  const investmentAccounts = await monarchApi.listAccounts();
  if (!investmentAccounts.length) {
    throw new Error('No investment accounts found in Monarch');
  }

  // Set account context for the selector
  const accountName = canadalifAccount.LongNameEnglish || canadalifAccount.EnglishShortName;
  stateManager.setAccount(accountId, accountName);

  // Prepare createDefaults with balance-only tracking
  // Canada Life only supports balance tracking (no holdings - private mutual funds)
  const createDefaults = {
    defaultName: accountName,
    defaultType: 'brokerage',
    defaultSubtype: 'brokerage',
    currentBalance: null, // Balance fetched later during sync
    accountType: 'Investment',
    balanceOnlyTracking: true, // Only show balance tracking option
  };

  // Show account selector with create option (balance-only for Canada Life)
  const monarchAccount = await new Promise((resolve) => {
    showMonarchAccountSelectorWithCreate(
      investmentAccounts,
      resolve,
      null,
      'brokerage',
      createDefaults,
    );
  });

  if (!monarchAccount) {
    return null; // User cancelled
  }

  // If this is a newly created account, set the Canada Life logo
  if (monarchAccount.newlyCreated) {
    try {
      debugLog(`Setting Canada Life logo for newly created account ${monarchAccount.id}`);
      await monarchApi.setAccountLogo(monarchAccount.id, LOGO_CLOUDINARY_IDS.CANADALIFE);
      debugLog(`Successfully set Canada Life logo for account ${monarchAccount.displayName}`);
      toast.show(`Set Canada Life logo for ${monarchAccount.displayName}`, 'debug');
    } catch (logoError) {
      // Logo setting failed, but account creation succeeded - continue with warning
      debugLog('Failed to set Canada Life logo for account:', logoError);
      toast.show(`Warning: Failed to set logo for ${monarchAccount.displayName}`, 'warning');
    }
  }

  // Save the mapping
  GM_setValue(`${STORAGE.CANADALIFE_ACCOUNT_MAPPING_PREFIX}${accountId}`, JSON.stringify(monarchAccount));

  debugLog(`Saved Canada Life account mapping: ${accountName} -> ${monarchAccount.displayName}`);
  toast.show(`Mapped ${accountName} to ${monarchAccount.displayName} in Monarch`, 'info');

  return monarchAccount;
}

/**
 * Extract balance change information for a Canada Life account
 * @param {string} accountId - Account ID
 * @param {Object} historicalData - Historical data from loadAccountBalanceHistory
 * @returns {Object|null} Balance change data or null if not available
 */
function extractCanadaLifeBalanceChange(accountId, historicalData) {
  try {
    if (!historicalData || !historicalData.data || !Array.isArray(historicalData.data)) {
      debugLog(`No historical data found for Canada Life account ${accountId}`);
      return null;
    }

    const dataRows = historicalData.data.slice(1); // Skip header row
    if (dataRows.length === 0) {
      debugLog(`No balance data rows found for Canada Life account ${accountId}`);
      return null;
    }

    // Today's balance is the last entry (most recent)
    const todayEntry = dataRows[dataRows.length - 1];
    const newBalance = parseFloat(todayEntry[1]);

    if (isNaN(newBalance)) {
      debugLog(`Invalid new balance for Canada Life account ${accountId}`);
      return null;
    }

    // Get last upload date
    const lastUploadDate = getLastUpdateDate(accountId, 'canadalife');
    if (!lastUploadDate) {
      debugLog(`No last upload date found for Canada Life account ${accountId}`);
      return null;
    }

    // Find old balance from last upload date
    const oldBalanceEntry = dataRows.find((row) => row[0] === lastUploadDate);
    if (!oldBalanceEntry) {
      debugLog(`No balance found for last upload date ${lastUploadDate} for Canada Life account ${accountId}`);
      return null;
    }

    const oldBalance = parseFloat(oldBalanceEntry[1]);
    if (isNaN(oldBalance)) {
      debugLog(`Invalid old balance for Canada Life account ${accountId}`);
      return null;
    }

    // Calculate percentage change
    const changePercent = oldBalance !== 0
      ? ((newBalance - oldBalance) / Math.abs(oldBalance)) * 100
      : 0;

    debugLog(`Balance change for Canada Life account ${accountId}: ${oldBalance} -> ${newBalance} (${changePercent.toFixed(2)}%)`);

    return {
      oldBalance,
      newBalance,
      lastUploadDate,
      changePercent,
    };
  } catch (error) {
    debugLog(`Error extracting balance change for Canada Life account ${accountId}:`, error);
    return null;
  }
}

/**
 * Build the list of sync steps for a Canada Life account
 * @returns {Array} Array of step definitions [{key, name}]
 */
function buildCanadaLifeSteps() {
  return [
    { key: 'fetchHistory', name: 'Fetch balance history' },
    { key: 'upload', name: 'Upload to Monarch' },
  ];
}

/**
 * Calculate number of days between two dates
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @returns {number} Number of days
 */
function calculateDaysBetween(startDate, endDate) {
  const from = new Date(startDate);
  const to = new Date(endDate);
  const diffTime = Math.abs(to - from);
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
}

/**
 * Upload balance history for a single Canada Life account
 * @param {Object} canadalifAccount - Canada Life account object
 * @param {string} startDate - Start date in YYYY-MM-DD format
 * @param {string} endDate - End date in YYYY-MM-DD format
 * @param {Object} progressDialog - Optional progress dialog for updates
 * @param {boolean} isAutoUpload - Whether this is an auto upload (allows today, stores yesterday as last upload)
 * @param {AbortSignal} signal - Optional abort signal for cancellation support
 * @returns {Promise<boolean>} Success status
 */
async function uploadSingleAccount(canadalifAccount, startDate, endDate, progressDialog = null, isAutoUpload = false, signal = null) {
  const accountId = canadalifAccount.agreementId;
  const accountName = canadalifAccount.LongNameEnglish || canadalifAccount.EnglishShortName;

  try {
    // Set current account context
    stateManager.setAccount(accountId, accountName);

    // Initialize steps if progress dialog is available
    if (progressDialog) {
      progressDialog.initSteps(accountId, buildCanadaLifeSteps());
      progressDialog.updateStepStatus(accountId, 'fetchHistory', 'processing', 'Getting account mapping...');
    }

    // Get Monarch account mapping
    const monarchAccount = await getMonarchAccountMapping(canadalifAccount);
    if (!monarchAccount) {
      if (progressDialog) {
        progressDialog.updateStepStatus(accountId, 'fetchHistory', 'error', 'Mapping cancelled');
      }
      throw new CanadaLifeUploadError('Account mapping cancelled by user', accountId);
    }

    // Validate date range including account creation date (allow today for auto uploads)
    validateDateRange(startDate, endDate, isAutoUpload, canadalifAccount);

    // Update progress - fetching
    if (progressDialog) {
      const businessDays = calculateBusinessDays(startDate, endDate);
      progressDialog.updateStepStatus(
        accountId,
        'fetchHistory',
        'processing',
        `Fetching ${businessDays} business days...`,
      );
    }

    // Create progress callback for historical data loading
    const historyProgressCallback = progressDialog ? (current, total, percentage) => {
      progressDialog.updateStepStatus(
        accountId,
        'fetchHistory',
        'processing',
        `${current}/${total} days (${percentage}%)`,
      );
    } : null;

    // Load balance history from Canada Life with progress tracking and cancellation support
    const historicalData = await canadalife.loadAccountBalanceHistory(
      canadalifAccount,
      startDate,
      endDate,
      historyProgressCallback,
      signal,
    );

    // Mark fetch step as complete
    const recordCount = historicalData.data.length - 1; // Exclude header
    const daysCount = calculateDaysBetween(startDate, endDate);
    if (progressDialog) {
      progressDialog.updateStepStatus(accountId, 'fetchHistory', 'success', `${recordCount} records`);
      progressDialog.updateStepStatus(accountId, 'upload', 'processing', 'Converting...');
    }

    // Convert to CSV format
    const csvData = convertCanadaLifeDataToCSV(historicalData);

    // Update progress - uploading
    if (progressDialog) {
      progressDialog.updateStepStatus(accountId, 'upload', 'processing', 'Uploading balance');
    }

    // Upload to Monarch
    const success = await monarchApi.uploadBalance(monarchAccount.id, csvData, startDate, endDate);

    if (!success) {
      if (progressDialog) {
        progressDialog.updateStepStatus(accountId, 'upload', 'error', 'Upload failed');
      }
      throw new CanadaLifeUploadError('Failed to upload to Monarch', accountId);
    }

    // Mark upload step as complete and extract balance change BEFORE saving last upload date
    // This ensures balance change calculation uses the previous upload date, not the one we're about to save
    if (progressDialog) {
      const uploadMessage = daysCount > 1 ? `${daysCount} days uploaded` : 'Uploaded';
      progressDialog.updateStepStatus(accountId, 'upload', 'success', uploadMessage);

      // Extract and display balance change information (must happen before saveLastUploadDate)
      const balanceChange = extractCanadaLifeBalanceChange(accountId, historicalData);
      if (balanceChange) {
        progressDialog.updateBalanceChange(accountId, balanceChange);
      }
    }

    // Store last upload date for auto uploads only AFTER balance change extraction
    // Store the actual end date that was uploaded to ensure proper continuity
    if (isAutoUpload) {
      saveLastUploadDate(accountId, endDate, 'canadalife');
    }

    debugLog(`Successfully uploaded ${accountName} balance history to Monarch`);
    return true;
  } catch (error) {
    debugLog(`Error uploading ${accountName} balance history:`, error);

    if (progressDialog) {
      // Update the appropriate step based on error context
      progressDialog.updateStepStatus(accountId, 'fetchHistory', 'error', error.message);
    }

    if (error instanceof CanadaLifeUploadError) {
      throw error;
    }
    throw new CanadaLifeUploadError(`Failed to upload ${accountName}: ${error.message}`, accountId);
  }
}

/**
 * Calculate number of business days between two dates
 * @param {string} startDate - Start date in YYYY-MM-DD format
 * @param {string} endDate - End date in YYYY-MM-DD format
 * @returns {number} Number of business days
 */
function calculateBusinessDays(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  let count = 0;
  const current = new Date(start);

  while (current <= end) {
    const dayOfWeek = current.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) { // Skip weekends
      count += 1;
    }
    current.setDate(current.getDate() + 1);
  }

  return count;
}

/**
 * Upload all Canada Life accounts to Monarch (one-click option)
 * @returns {Promise<void>}
 */
export async function uploadAllCanadaLifeAccountsToMonarch() {
  try {
    // Check Monarch authentication before proceeding
    const authenticated = await ensureMonarchAuthentication(null, 'upload all Canada Life accounts');
    if (!authenticated) {
      return; // User cancelled authentication
    }

    // Load Canada Life accounts
    toast.show('Loading Canada Life accounts...', 'info');
    const accounts = await canadalife.loadCanadaLifeAccounts();

    if (!accounts || accounts.length === 0) {
      toast.show('No Canada Life accounts found', 'error');
      return;
    }

    debugLog(`Found ${accounts.length} Canada Life accounts for upload`);

    // Create progress dialog
    const accountsForDialog = accounts.map((acc) => ({
      key: acc.agreementId,
      nickname: acc.LongNameEnglish || acc.EnglishShortName,
      name: acc.EnglishShortName,
    }));

    const progressDialog = showProgressDialog(
      accountsForDialog,
      'Uploading Canada Life Balance History to Monarch',
    );

    // Initialize stats and cancellation support
    const stats = { success: 0, failed: 0, total: accounts.length };
    const endDate = getTodayDate(); // Include today's balance in auto uploads
    const abortController = new AbortController();

    // Set up cancellation callback
    progressDialog.onCancel(() => {
      debugLog('Upload cancellation requested by user');
      toast.show('Cancelling upload...', 'warning');
      abortController.abort();
    });

    // Process each account
    for (const account of accounts) {
      // Check for cancellation before processing each account
      if (abortController.signal.aborted) {
        debugLog('Upload cancelled, stopping account processing');
        break;
      }
      const accountId = account.agreementId;

      try {
        // Update progress
        progressDialog.updateProgress(accountId, 'processing', 'Getting start date...');

        // Get start date (either from last upload or prompt user)
        const startDate = await getStartDateForAccount(accountId);
        if (!startDate) {
          // User cancelled date selection
          progressDialog.updateProgress(accountId, 'error', 'Date selection cancelled');
          stats.failed += 1;
          break;
        }

        // Upload the account (auto upload allows today and stores yesterday as last upload)
        await uploadSingleAccount(account, startDate, endDate, progressDialog, true, abortController.signal);
        stats.success += 1;
      } catch (error) {
        stats.failed += 1;

        // Check if this is a cancellation error
        if (error.message === 'Operation cancelled by user') {
          progressDialog.updateProgress(accountId, 'error', 'Cancelled');
          debugLog('Upload cancelled during account processing');
          break;
        }

        // Show error and wait for user acknowledgment
        await progressDialog.showError(accountId, error);

        // Stop processing remaining accounts after error
        break;
      }
    }

    // Always hide cancel button and show close button when upload processing is done
    progressDialog.hideCancel();

    // Show final summary
    progressDialog.showSummary(stats);

    // Show appropriate completion message
    if (abortController.signal.aborted) {
      toast.show(`Upload cancelled. ${stats.success} accounts uploaded successfully before cancellation.`, 'warning');
    } else if (stats.success === stats.total) {
      toast.show(`Successfully uploaded balance history for all ${stats.total} Canada Life accounts!`, 'info');
    } else if (stats.success > 0) {
      toast.show(`Uploaded ${stats.success} of ${stats.total} accounts successfully`, 'warning');
    }
  } catch (error) {
    debugLog('Error in uploadAllCanadaLifeAccountsToMonarch:', error);
    toast.show(`Failed to start upload process: ${error.message}`, 'error');
  }
}

/**
 * Upload Canada Life account with custom date range
 * @returns {Promise<void>}
 */
export async function uploadCanadaLifeAccountWithDateRange() {
  try {
    // Check Monarch authentication before proceeding
    const authenticated = await ensureMonarchAuthentication(null, 'upload Canada Life account with custom date range');
    if (!authenticated) {
      return; // User cancelled authentication
    }

    // Load Canada Life accounts
    toast.show('Loading Canada Life accounts...', 'info');
    const accounts = await canadalife.loadCanadaLifeAccounts();

    if (!accounts || accounts.length === 0) {
      toast.show('No Canada Life accounts found', 'error');
      return;
    }

    // Show account selector
    const selectedAccount = await selectCanadaLifeAccount(accounts);
    if (!selectedAccount) {
      toast.show('Account selection cancelled', 'warning');
      return;
    }

    // Show date range picker
    const dateRange = await selectDateRange();
    if (!dateRange) {
      toast.show('Date selection cancelled', 'warning');
      return;
    }

    // Validate date range, allow today
    validateDateRange(dateRange.startDate, dateRange.endDate, true);

    // Create progress dialog for single account
    const accountForDialog = {
      key: selectedAccount.agreementId,
      nickname: selectedAccount.LongNameEnglish || selectedAccount.EnglishShortName,
      name: selectedAccount.EnglishShortName,
    };

    const progressDialog = showProgressDialog(
      [accountForDialog],
      `Uploading ${selectedAccount.EnglishShortName} Balance History to Monarch`,
    );

    try {
      // Upload the account with progress tracking (not auto upload, so no today allowance)
      await uploadSingleAccount(selectedAccount, dateRange.startDate, dateRange.endDate, progressDialog, false);

      // Hide cancel button and show close button when upload completes
      progressDialog.hideCancel();

      // Show success summary
      progressDialog.showSummary({ success: 1, failed: 0, total: 1 });

      toast.show(`Successfully uploaded ${selectedAccount.EnglishShortName} balance history to Monarch`, 'info');
    } catch (error) {
      // Hide cancel button and show close button when upload fails
      progressDialog.hideCancel();

      // Show error in progress dialog
      const stats = { success: 0, failed: 1, total: 1 };
      progressDialog.updateProgress(selectedAccount.agreementId, 'error', error.message);
      progressDialog.showSummary(stats);
      throw error;
    }
  } catch (error) {
    debugLog('Error in uploadCanadaLifeAccountWithDateRange:', error);
    toast.show(`Upload failed: ${error.message}`, 'error');
  }
}

/**
 * Show account selector for Canada Life accounts
 * @param {Array} accounts - Array of Canada Life accounts
 * @returns {Promise<Object|null>} Selected account or null if cancelled
 */
async function selectCanadaLifeAccount(accounts) {
  return new Promise((resolve) => {
    // Create modal overlay
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

    // Create modal
    const modal = document.createElement('div');
    modal.style.cssText = `
      background: white;
      padding: 25px;
      border-radius: 8px;
      width: 90%;
      max-width: 500px;
      max-height: 80vh;
      overflow-y: auto;
    `;

    // Add title
    const title = document.createElement('h2');
    title.textContent = 'Select Canada Life Account';
    title.style.cssText = 'margin-top: 0; margin-bottom: 20px; font-size: 1.2em;';
    modal.appendChild(title);

    // Add account list
    accounts.forEach((account) => {
      const item = document.createElement('div');
      item.style.cssText = `
        padding: 15px;
        border: 1px solid #eee;
        border-radius: 8px;
        margin-bottom: 10px;
        cursor: pointer;
        transition: background-color 0.2s;
      `;

      const name = document.createElement('div');
      name.textContent = account.LongNameEnglish || account.EnglishShortName;
      name.style.cssText = 'font-weight: bold; margin-bottom: 5px;';
      item.appendChild(name);

      const shortName = document.createElement('div');
      shortName.textContent = account.EnglishShortName;
      shortName.style.cssText = 'font-size: 0.9em; color: #666;';
      item.appendChild(shortName);

      item.addEventListener('mouseover', () => {
        item.style.backgroundColor = '#f5f5f5';
      });

      item.addEventListener('mouseout', () => {
        item.style.backgroundColor = '';
      });

      item.addEventListener('click', () => {
        overlay.remove();
        resolve(account);
      });

      modal.appendChild(item);
    });

    // Add cancel button
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = `
      padding: 8px 16px;
      background-color: #f5f5f5;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      margin-top: 10px;
    `;
    cancelBtn.addEventListener('click', () => {
      overlay.remove();
      resolve(null);
    });
    modal.appendChild(cancelBtn);

    // Handle click outside to close
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve(null);
      }
    });

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  });
}

/**
 * Show date range picker
 * @returns {Promise<Object|null>} Date range object or null if cancelled
 */
async function selectDateRange() {
  return new Promise((resolve) => {
    // Create modal overlay
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

    // Create modal
    const modal = document.createElement('div');
    modal.style.cssText = `
      background: white;
      padding: 25px;
      border-radius: 8px;
      width: 90%;
      max-width: 400px;
    `;

    // Add title
    const title = document.createElement('h2');
    title.textContent = 'Select Date Range';
    title.style.cssText = 'margin-top: 0; margin-bottom: 20px; font-size: 1.2em;';
    modal.appendChild(title);

    // Add start date input
    const startLabel = document.createElement('label');
    startLabel.textContent = 'Start Date:';
    startLabel.style.cssText = 'display: block; font-weight: bold; margin-bottom: 5px;';
    modal.appendChild(startLabel);

    const startInput = document.createElement('input');
    startInput.type = 'date';
    startInput.style.cssText = 'width: 100%; padding: 8px; margin-bottom: 15px; border: 1px solid #ddd; border-radius: 4px;';

    // Default to 30 days ago
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    startInput.value = formatDate(thirtyDaysAgo);
    modal.appendChild(startInput);

    // Add end date input
    const endLabel = document.createElement('label');
    endLabel.textContent = 'End Date:';
    endLabel.style.cssText = 'display: block; font-weight: bold; margin-bottom: 5px;';
    modal.appendChild(endLabel);

    const endInput = document.createElement('input');
    endInput.type = 'date';
    endInput.style.cssText = 'width: 100%; padding: 8px; margin-bottom: 20px; border: 1px solid #ddd; border-radius: 4px;';
    endInput.value = getYesterdayDate(); // Max allowed date
    endInput.max = getYesterdayDate(); // Prevent future dates
    modal.appendChild(endInput);

    // Add buttons
    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = 'display: flex; justify-content: flex-end; gap: 10px;';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = `
      padding: 8px 16px;
      background-color: #f5f5f5;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    `;
    cancelBtn.addEventListener('click', () => {
      overlay.remove();
      resolve(null);
    });
    buttonContainer.appendChild(cancelBtn);

    const selectBtn = document.createElement('button');
    selectBtn.textContent = 'Select';
    selectBtn.style.cssText = `
      padding: 8px 16px;
      background-color: #A20A29;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    `;
    selectBtn.addEventListener('click', () => {
      const startDate = startInput.value;
      const endDate = endInput.value;

      if (!startDate || !endDate) {
        toast.show('Please select both start and end dates', 'error');
        return;
      }

      try {
        validateDateRange(startDate, endDate);
        overlay.remove();
        resolve({ startDate, endDate });
      } catch (error) {
        toast.show(error.message, 'error');
      }
    });
    buttonContainer.appendChild(selectBtn);

    modal.appendChild(buttonContainer);

    // Handle click outside to close
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve(null);
      }
    });

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Focus on start date input
    startInput.focus();
  });
}

export default {
  uploadAllCanadaLifeAccountsToMonarch,
  uploadCanadaLifeAccountWithDateRange,
  convertCanadaLifeDataToCSV,
  CanadaLifeUploadError,
};
