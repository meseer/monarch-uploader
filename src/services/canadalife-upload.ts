/**
 * Canada Life Upload Service
 * Handles uploading Canada Life balance history to Monarch Money
 */

import {
  debugLog, formatDate, getTodayLocal, getYesterdayLocal, formatDaysAgoLocal, parseLocalDate,
  calculateFromDateWithLookback, saveLastUploadDate, getLookbackForInstitution,
} from '../core/utils';
import { LOGO_CLOUDINARY_IDS } from '../core/config';
import stateManager from '../core/state';
import canadalife from '../api/canadalife';
import monarchApi from '../api/monarch';
import toast from '../ui/toast';
import { showProgressDialog } from '../ui/components/progressDialog';
import { showDatePickerPromise } from '../ui/components/datePicker';
import { showMonarchAccountSelectorWithCreate } from '../ui/components/accountSelectorWithCreate';
import { ensureMonarchAuthentication } from '../ui/components/monarchLoginLink';
import accountService from './common/accountService';
import { INTEGRATIONS, ACCOUNT_SETTINGS } from '../core/integrationCapabilities';
import {
  fetchActivitiesForDateRange,
  processActivities,
  fetchAndProcessTransactions,
} from './canadalife/transactions';
import { convertCanadaLifeTransactionsToMonarchCSV } from './canadalife/csvFormatter';
import {
  reconcileCanadaLifePendingTransactions,
  formatReconciliationMessage,
} from './canadalife/pendingReconciliation';

/**
 * Custom Canada Life upload error class
 */
export class CanadaLifeUploadError extends Error {
  accountId: string;

  constructor(message: string, accountId: string) {
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
    throw new Error(`Failed to convert balance data: ${error.message}`, { cause: error });
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
 * Get the start date for a Canada Life account
 * For initial sync, automatically uses the account's EnrollmentDate
 * @param {string} accountId - Canada Life account ID (agreementId)
 * @param {Object} account - Canada Life account object with EnrollmentDate
 * @returns {Promise<string|null>} Start date in YYYY-MM-DD format, or null if cancelled
 */
async function getStartDateForAccount(accountId, account = null) {
  // Use unified date calculation with configurable lookback
  const fromDate = calculateFromDateWithLookback('canadalife', accountId);
  if (fromDate) {
    return fromDate;
  }

  // No previous upload date - this is initial sync
  // Use the account's EnrollmentDate (account creation date) for full history upload
  if (account && account.EnrollmentDate) {
    const enrollmentDate = parseFlexibleDate(account.EnrollmentDate);
    if (!Number.isNaN(enrollmentDate.getTime())) {
      const formattedDate = formatDate(enrollmentDate);
      const accountName = account.LongNameEnglish || account.EnglishShortName || 'Account';
      debugLog(`Initial sync for ${accountName}: Using EnrollmentDate ${formattedDate}`);
      return formattedDate;
    }
  }

  // Fallback: If no EnrollmentDate available, prompt user for initial start date
  const stateAccount = stateManager.getState().currentAccount;
  const accountName = stateAccount?.nickname || account?.EnglishShortName || 'Account';

  const defaultDate = formatDaysAgoLocal(90); // 90 days ago
  const selectedDate = await showDatePickerPromise(
    defaultDate,
    `Select initial start date for ${accountName} balance history upload`,
  );

  return selectedDate;
}

/**
 * Get or create Monarch account mapping for a Canada Life account
 * Uses unified accountService for storage (with backward compatibility)
 * @param {Object} canadalifeAccount - Canada Life account object
 * @returns {Promise<Object|null>} Monarch account object, or null if cancelled
 */
async function getOrCreateMonarchAccountMapping(canadalifeAccount) {
  const accountId = canadalifeAccount.agreementId;
  const accountName = canadalifeAccount.LongNameEnglish || canadalifeAccount.EnglishShortName;
  let accountWarningMessage = null;

  // Check consolidated storage first, then fall back to legacy (migration path)
  const existingMapping = accountService.getMonarchAccountMapping(INTEGRATIONS.CANADALIFE, accountId);
  if (existingMapping) {
    // Validate and refresh the stored account mapping
    const validation = await monarchApi.validateAndRefreshAccountMapping(
      existingMapping.id as string,
      null, // No storage key needed - we'll update via accountService
      existingMapping.displayName as string,
    );

    if (validation.valid) {
      // Update the account entry with refreshed Monarch data if needed
      if (validation.account.id !== existingMapping.id) {
        accountService.updateAccountInList(INTEGRATIONS.CANADALIFE, accountId, {
          monarchAccount: validation.account,
        });
      }
      return validation.account;
    }
    // Account was deleted - show warning in account selector
    accountWarningMessage = validation.warningMessage;
    // Fall through to create new mapping
  }

  // No mapping exists - show account selector
  const investmentAccounts = await monarchApi.listAccounts();
  if (!investmentAccounts.length) {
    throw new Error('No investment accounts found in Monarch');
  }

  // Set account context for the selector
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
    warningMessage: accountWarningMessage, // Show warning if previous account was deleted
  };

  // Show account selector with create option (balance-only for Canada Life)
  const monarchAccount = await new Promise((resolve) => {
    showMonarchAccountSelectorWithCreate(
      investmentAccounts as unknown as Parameters<typeof showMonarchAccountSelectorWithCreate>[0],
      resolve,
      null,
      'brokerage',
      createDefaults,
    );
  });

  if (!monarchAccount) {
    return null; // User cancelled
  }

  const monarchAccountObj = monarchAccount as Record<string, unknown>;
  // If this is a newly created account, set the Canada Life logo
  if (monarchAccountObj.newlyCreated) {
    try {
      debugLog(`Setting Canada Life logo for newly created account ${monarchAccountObj.id}`);
      await monarchApi.setAccountLogo(monarchAccountObj.id as string, LOGO_CLOUDINARY_IDS.CANADALIFE);
      debugLog(`Successfully set Canada Life logo for account ${monarchAccountObj.displayName}`);
      toast.show(`Set Canada Life logo for ${monarchAccountObj.displayName}`, 'debug');
    } catch (logoError) {
      // Logo setting failed, but account creation succeeded - continue with warning
      debugLog('Failed to set Canada Life logo for account:', logoError);
      toast.show(`Warning: Failed to set logo for ${monarchAccountObj.displayName}`, 'warning');
    }
  }

  // Save the mapping using unified accountService (upsert creates or updates)
  accountService.upsertAccount(INTEGRATIONS.CANADALIFE, {
    canadalifeAccount: {
      id: accountId,
      nickname: accountName,
      agreementId: canadalifeAccount.agreementId,
      EnglishShortName: canadalifeAccount.EnglishShortName,
      LongNameEnglish: canadalifeAccount.LongNameEnglish,
      EnrollmentDate: canadalifeAccount.EnrollmentDate,
    },
    monarchAccount: monarchAccountObj,
    syncEnabled: true,
  });

  debugLog(`Saved Canada Life account mapping: ${accountName} -> ${monarchAccountObj.displayName}`);
  toast.show(`Mapped ${accountName} to ${monarchAccountObj.displayName} in Monarch`, 'info');

  return monarchAccountObj;
}

/**
 * Extract balance change information for a Canada Life account.
 * Compares the stored lastSyncBalance (from previous sync) against the current balance,
 * matching the pattern used by other integrations in balanceUpload.ts.
 * @param {string} accountId - Account ID
 * @param {number} newBalance - Current balance (most recent entry from historical data)
 * @returns {Object|null} Balance change data or null if not available
 */
function extractCanadaLifeBalanceChange(accountId: string, newBalance: number) {
  try {
    if (isNaN(newBalance)) {
      debugLog(`Invalid new balance for Canada Life account ${accountId}`);
      return null;
    }

    // Read previously-stored balance from consolidated account data
    const acctData = accountService.getAccountData(INTEGRATIONS.CANADALIFE, accountId);
    const lastSyncBalance = acctData?.lastSyncBalance as number | undefined | null;
    const lastSyncDate = acctData?.lastSyncDate as string | undefined | null;

    if (lastSyncBalance === undefined || lastSyncBalance === null || !lastSyncDate) {
      debugLog(`No previous sync balance found for Canada Life account ${accountId}`);
      return null;
    }

    // Calculate percentage change
    const changePercent = lastSyncBalance !== 0
      ? ((newBalance - lastSyncBalance) / Math.abs(lastSyncBalance)) * 100
      : 0;

    debugLog(`Balance change for Canada Life account ${accountId}: ${lastSyncBalance} -> ${newBalance} (${changePercent.toFixed(2)}%)`);

    return {
      oldBalance: lastSyncBalance,
      newBalance,
      lastUploadDate: lastSyncDate,
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
    { key: 'uploadBalance', name: 'Upload balance to Monarch' },
    { key: 'pendingReconciliation', name: 'Pending reconciliation' },
    { key: 'uploadTransactions', name: 'Upload transactions' },
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
  const diffTime = Math.abs(to.getTime() - from.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
}

/**
 * Get uploaded transaction IDs from consolidated account storage
 * @param {string} accountId - Account ID
 * @returns {Set<string>} Set of uploaded transaction IDs
 */
function getUploadedTransactionIds(accountId: string): Set<string> {
  const accountData = accountService.getAccountData(INTEGRATIONS.CANADALIFE, accountId);
  const uploadedTransactions = (accountData?.uploadedTransactions || []) as Array<{ id: string; date: string }>;
  return new Set(uploadedTransactions.map((tx) => tx.id));
}

/**
 * Save uploaded transaction IDs to consolidated account storage
 * @param {string} accountId - Account ID
 * @param {Array<Object>} transactions - Array of transaction objects with id and date
 */
function saveUploadedTransactionIds(accountId: string, transactions: Array<{ id: string; date: string }>) {
  const accountData = accountService.getAccountData(INTEGRATIONS.CANADALIFE, accountId);
  const existingTransactions = (accountData?.uploadedTransactions || []) as Array<{ id: string; date: string }>;

  // Add new transaction IDs with their actual transaction dates (not sync date)
  const newEntries = transactions.map((tx) => ({ id: tx.id, date: tx.date }));
  const updatedTransactions = [...existingTransactions, ...newEntries];

  accountService.updateAccountInList(INTEGRATIONS.CANADALIFE, accountId, {
    uploadedTransactions: updatedTransactions,
  });

  debugLog(`Saved ${newEntries.length} new transaction IDs for account ${accountId}`);
}

/**
 * Upload balance history and transactions for a single Canada Life account
 * @param {Object} canadalifeAccount - Canada Life account object
 * @param {string} startDate - Start date in YYYY-MM-DD format
 * @param {string} endDate - End date in YYYY-MM-DD format
 * @param {Object} progressDialog - Optional progress dialog for updates
 * @param {boolean} isAutoUpload - Whether this is an auto upload (allows today, stores yesterday as last upload)
 * @param {AbortSignal} signal - Optional abort signal for cancellation support
 * @returns {Promise<Object>} Result with success status and transaction counts
 */
async function uploadSingleAccount(canadalifeAccount, startDate, endDate, progressDialog = null, isAutoUpload = false, signal = null) {
  const accountId = canadalifeAccount.agreementId;
  const accountName = canadalifeAccount.LongNameEnglish || canadalifeAccount.EnglishShortName;
  const result = {
    success: false,
    transactionsUploaded: 0,
    transactionsSkipped: 0,
  };

  try {
    // Set current account context
    stateManager.setAccount(accountId, accountName);

    // Initialize steps if progress dialog is available
    if (progressDialog) {
      progressDialog.initSteps(accountId, buildCanadaLifeSteps());
      progressDialog.updateStepStatus(accountId, 'fetchHistory', 'processing', 'Getting account mapping...');
    }

    // Get Monarch account mapping
    const monarchAccount = await getOrCreateMonarchAccountMapping(canadalifeAccount);
    if (!monarchAccount) {
      if (progressDialog) {
        progressDialog.updateStepStatus(accountId, 'fetchHistory', 'error', 'Mapping cancelled');
      }
      throw new CanadaLifeUploadError('Account mapping cancelled by user', accountId);
    }

    // Validate date range including account creation date (allow today for auto uploads)
    validateDateRange(startDate, endDate, isAutoUpload, canadalifeAccount);

    // Check for cancellation
    if (signal?.aborted) {
      throw new Error('Operation cancelled by user');
    }

    // ===== STEP 1: Fetch Balance History =====
    const businessDaysCount = calculateBusinessDays(startDate, endDate);
    if (progressDialog) {
      progressDialog.updateStepStatus(
        accountId,
        'fetchHistory',
        'processing',
        `Fetching ${businessDaysCount} business days...`,
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
      canadalifeAccount,
      startDate,
      endDate,
      historyProgressCallback,
      signal,
    );

    // Mark fetch step as complete
    const recordCount = historicalData.data.length - 1; // Exclude header
    const daysCount = calculateDaysBetween(startDate, endDate);

    // Check for cancellation
    if (signal?.aborted) {
      throw new Error('Operation cancelled by user');
    }

    // ===== STEP 2: Upload Balance to Monarch =====
    // Only upload balance if there are actual records (not just the header)
    // This handles the weekend-only date range case where no business days exist
    if (recordCount > 0) {
      if (progressDialog) {
        progressDialog.updateStepStatus(accountId, 'fetchHistory', 'success', `${recordCount} records`);
        progressDialog.updateStepStatus(accountId, 'uploadBalance', 'processing', 'Converting...');
      }

      // Convert to CSV format
      const csvData = convertCanadaLifeDataToCSV(historicalData);

      // Update progress - uploading
      if (progressDialog) {
        progressDialog.updateStepStatus(accountId, 'uploadBalance', 'processing', 'Uploading balance');
      }

      // Upload to Monarch
      const monarchAccountObj2 = monarchAccount as Record<string, unknown>;
      const balanceSuccess = await monarchApi.uploadBalance(monarchAccountObj2.id as string, csvData, startDate, endDate);

      if (!balanceSuccess) {
        if (progressDialog) {
          progressDialog.updateStepStatus(accountId, 'uploadBalance', 'error', 'Upload failed');
        }
        throw new CanadaLifeUploadError('Failed to upload balance to Monarch', accountId);
      }

      // Extract the latest balance from historical data for change detection and persistence
      const dataRows = historicalData.data.slice(1); // Skip header row
      const latestEntry = dataRows[dataRows.length - 1];
      const latestBalance = parseFloat(String(latestEntry[1]));

      // Mark upload step as complete and extract balance change BEFORE saving last upload date
      // This ensures balance change calculation uses the previous sync balance, not the one we're about to save
      if (progressDialog) {
        const uploadMessage = daysCount > 1 ? `${daysCount} days uploaded` : 'Uploaded';
        progressDialog.updateStepStatus(accountId, 'uploadBalance', 'success', uploadMessage);

        // Extract and display balance change information (must happen before saving lastSyncBalance)
        const balanceChange = extractCanadaLifeBalanceChange(accountId, latestBalance);
        if (balanceChange) {
          progressDialog.updateBalanceChange(accountId, { ...balanceChange, accountType: 'investment' });
        }
      }

      // Persist current balance for next sync's diff display
      if (!isNaN(latestBalance)) {
        accountService.updateAccountInList(INTEGRATIONS.CANADALIFE, accountId, {
          lastSyncBalance: latestBalance,
        });
      }
    } else {
      // No business days in date range (e.g., weekend-only sync)
      // Skip balance upload but continue with transaction sync
      debugLog(`No business days in date range ${startDate} to ${endDate}, skipping balance upload`);
      if (progressDialog) {
        progressDialog.updateStepStatus(accountId, 'fetchHistory', 'skipped', 'No business days');
        progressDialog.updateStepStatus(accountId, 'uploadBalance', 'skipped', 'No balance data');
      }
    }

    // Check for cancellation
    if (signal?.aborted) {
      throw new Error('Operation cancelled by user');
    }

    // ===== STEP 3: Fetch activities (shared between reconciliation and transaction upload) =====
    if (progressDialog) {
      progressDialog.updateStepStatus(accountId, 'pendingReconciliation', 'processing', 'Fetching activities...');
    }

    const rawActivities = await fetchActivitiesForDateRange(canadalifeAccount, startDate, endDate, {
      onProgress: (chunk, total, count) => {
        if (progressDialog) {
          progressDialog.updateStepStatus(
            accountId,
            'pendingReconciliation',
            'processing',
            `Fetching (${chunk}/${total}): ${count} found`,
          );
        }
      },
      signal,
    });

    // Check for cancellation
    if (signal?.aborted) {
      throw new Error('Operation cancelled by user');
    }

    // ===== STEP 3a: Pending reconciliation =====
    // Runs before transaction upload so removed pending entries don't affect dedup store
    try {
      progressDialog?.updateStepStatus(accountId, 'pendingReconciliation', 'processing', 'Reconciling...');
      const lookbackDays = getLookbackForInstitution('canadalife');
      const monarchAccountObj3 = monarchAccount as Record<string, unknown>;
      const reconciliationResult = await reconcileCanadaLifePendingTransactions(
        monarchAccountObj3.id as string,
        rawActivities,
        lookbackDays,
      );
      const reconciliationMsg = formatReconciliationMessage(reconciliationResult);
      const reconciliationStatus = reconciliationResult.success !== false ? 'success' : 'error';
      progressDialog?.updateStepStatus(accountId, 'pendingReconciliation', reconciliationStatus, reconciliationMsg);
      debugLog('Canada Life pending reconciliation result:', reconciliationResult);
    } catch (reconciliationError) {
      debugLog('Error during Canada Life pending reconciliation:', reconciliationError);
      progressDialog?.updateStepStatus(accountId, 'pendingReconciliation', 'error', reconciliationError.message);
    }

    // Check for cancellation
    if (signal?.aborted) {
      throw new Error('Operation cancelled by user');
    }

    // ===== STEP 3b: Process and upload transactions =====
    if (progressDialog) {
      progressDialog.updateStepStatus(accountId, 'uploadTransactions', 'processing', 'Processing...');
    }

    // Read includePendingTransactions account setting (default: true)
    const accountDataForPending = accountService.getAccountData(INTEGRATIONS.CANADALIFE, accountId);
    const includePendingTransactions = accountDataForPending?.[ACCOUNT_SETTINGS.INCLUDE_PENDING_TRANSACTIONS] !== false;

    // Get previously uploaded transaction IDs for deduplication
    const uploadedTransactionIds = getUploadedTransactionIds(accountId);

    // Process raw activities into transactions (already fetched above)
    const transactions = await processActivities(rawActivities, accountName, {
      uploadedTransactionIds,
      includePendingTransactions,
    });

    // Calculate how many were skipped
    result.transactionsSkipped = uploadedTransactionIds.size > 0 ? uploadedTransactionIds.size : 0;

    // Check for cancellation
    if (signal?.aborted) {
      throw new Error('Operation cancelled by user');
    }

    // Upload transactions if any found
    if (transactions.length > 0) {
      if (progressDialog) {
        progressDialog.updateStepStatus(accountId, 'uploadTransactions', 'processing', `Uploading ${transactions.length}...`);
      }

      // Convert to CSV format
      const transactionCsvData = convertCanadaLifeTransactionsToMonarchCSV(transactions, accountName);

      // Upload to Monarch
      const txSuccess = await monarchApi.uploadTransactions((monarchAccount as Record<string, unknown>).id as string, transactionCsvData);

      if (!txSuccess) {
        if (progressDialog) {
          progressDialog.updateStepStatus(accountId, 'uploadTransactions', 'error', 'Upload failed');
        }
        // Don't throw - balance upload succeeded, just log the transaction failure
        debugLog(`Failed to upload transactions for ${accountName}, but balance upload succeeded`);
      } else {
        // Save uploaded transaction IDs for future deduplication
        // For pending transactions, save the pendingId (cl-tx:{hash}); for settled, save the id
        saveUploadedTransactionIds(accountId, transactions);
        result.transactionsUploaded = transactions.length;

        if (progressDialog) {
          progressDialog.updateStepStatus(accountId, 'uploadTransactions', 'success', `${transactions.length} uploaded`);
        }
      }
    } else {
      // No new transactions to upload
      if (progressDialog) {
        progressDialog.updateStepStatus(accountId, 'uploadTransactions', 'skipped', 'No new transactions');
      }
    }

    // Store last upload date for auto uploads only AFTER balance change extraction
    // Store the actual end date that was uploaded to ensure proper continuity
    if (isAutoUpload) {
      saveLastUploadDate(accountId, endDate, 'canadalife');
    }

    // Clean up legacy storage keys after successful sync using new unified storage
    // This is idempotent - it only deletes keys that exist and is safe to call multiple times
    const cleanupResult = accountService.cleanupLegacyStorage(INTEGRATIONS.CANADALIFE, accountId);
    if (cleanupResult.keysDeleted > 0) {
      debugLog(`Cleaned up ${cleanupResult.keysDeleted} legacy storage keys for ${accountName}:`, cleanupResult.keys);
    }

    result.success = true;
    debugLog(`Successfully uploaded ${accountName} balance history and ${result.transactionsUploaded} transactions to Monarch`);
    return result;
  } catch (error) {
    debugLog(`Error uploading ${accountName}:`, error);

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
 * Upload all Canada Life accounts to Monarch (one-click option)
 * Uploads both balance history and transactions for each account
 * @returns {Promise<void>}
 */
export async function uploadAllCanadaLifeAccountsToMonarch() {
  try {
    // Check Monarch authentication before proceeding
    const authenticated = await ensureMonarchAuthentication(null, 'upload all Canada Life accounts');
    if (!authenticated) {
      return; // User cancelled authentication
    }

    // Load Canada Life accounts (returns consolidated structure)
    toast.show('Loading Canada Life accounts...', 'info');
    const consolidatedAccounts = await canadalife.loadCanadaLifeAccounts();

    if (!consolidatedAccounts || consolidatedAccounts.length === 0) {
      toast.show('No Canada Life accounts found', 'error');
      return;
    }

    debugLog(`Found ${consolidatedAccounts.length} Canada Life accounts for upload`);

    // Create progress dialog - extract source account for display
    const accountsForDialog = consolidatedAccounts.map((consolidated) => {
      const sourceAccount = extractSourceAccount(consolidated);
      return {
        key: sourceAccount.agreementId,
        nickname: sourceAccount.LongNameEnglish || sourceAccount.EnglishShortName,
        name: sourceAccount.EnglishShortName,
      };
    });

    const progressDialog = showProgressDialog(
      accountsForDialog,
      'Uploading Canada Life Balance & Transactions to Monarch',
    );

    // Initialize stats and cancellation support
    const stats = {
      success: 0,
      failed: 0,
      total: consolidatedAccounts.length,
      transactionsUploaded: 0,
      transactionsSkipped: 0,
    };
    const endDate = getTodayDate(); // Include today's balance in auto uploads
    const abortController = new AbortController();

    // Set up cancellation callback
    progressDialog.onCancel(() => {
      debugLog('Upload cancellation requested by user');
      toast.show('Cancelling upload...', 'info');
      abortController.abort();
    });

    // Process each consolidated account
    for (const consolidated of consolidatedAccounts) {
      // Check for cancellation before processing each account
      if (abortController.signal.aborted) {
        debugLog('Upload cancelled, stopping account processing');
        break;
      }

      // Extract the source Canada Life account for processing
      const sourceAccount = extractSourceAccount(consolidated);
      const accountId = sourceAccount.agreementId;

      // Skip accounts where sync has been disabled by the user
      if (consolidated.syncEnabled === false) {
        stats.success += 0; // no change to success
        stats.total -= 1; // exclude from total so summary is accurate
        progressDialog.updateProgress(accountId, 'skipped', 'Sync disabled');
        debugLog(`Skipped Canada Life account ${accountId} - sync disabled by user`);
        continue;
      }

      try {
        // Update progress
        progressDialog.updateProgress(accountId, 'processing', 'Getting start date...');

        // Get start date (either from last upload or use EnrollmentDate for initial sync)
        const startDate = await getStartDateForAccount(accountId, sourceAccount);
        if (!startDate) {
          // User cancelled date selection
          progressDialog.updateProgress(accountId, 'error', 'Date selection cancelled');
          stats.failed += 1;
          break;
        }

        // Upload the account (auto upload allows today and stores yesterday as last upload)
        const result = await uploadSingleAccount(sourceAccount, startDate, endDate, progressDialog, true, abortController.signal);
        stats.success += 1;

        // Aggregate transaction statistics
        stats.transactionsUploaded += result.transactionsUploaded || 0;
        stats.transactionsSkipped += result.transactionsSkipped || 0;
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

    // Show final summary with transaction counts
    progressDialog.showSummary(stats);

    // Build completion message including transaction stats
    const txSummary = stats.transactionsUploaded > 0
      ? ` ${stats.transactionsUploaded} transactions uploaded.`
      : '';

    // Show appropriate completion message
    if (abortController.signal.aborted) {
      toast.show(`Upload cancelled. ${stats.success} accounts uploaded successfully.${txSummary}`, 'info');
    } else if (stats.success === stats.total) {
      toast.show(`Successfully uploaded all ${stats.total} Canada Life accounts!${txSummary}`, 'info');
    } else if (stats.success > 0) {
      toast.show(`Uploaded ${stats.success} of ${stats.total} accounts.${txSummary}`, 'warning');
    }
  } catch (error) {
    debugLog('Error in uploadAllCanadaLifeAccountsToMonarch:', error);
    toast.show(`Failed to start upload process: ${error.message}`, 'error');
  }
}

/**
 * Upload Canada Life account with custom date range
 * Uploads both balance history and transactions for the selected account
 * @returns {Promise<void>}
 */
export async function uploadCanadaLifeAccountWithDateRange() {
  try {
    // Check Monarch authentication before proceeding
    const authenticated = await ensureMonarchAuthentication(null, 'upload Canada Life account with custom date range');
    if (!authenticated) {
      return; // User cancelled authentication
    }

    // Load Canada Life accounts (returns consolidated structure)
    toast.show('Loading Canada Life accounts...', 'info');
    const consolidatedAccounts = await canadalife.loadCanadaLifeAccounts();

    if (!consolidatedAccounts || consolidatedAccounts.length === 0) {
      toast.show('No Canada Life accounts found', 'error');
      return;
    }

    // Show account selector - pass consolidated accounts, selector will handle extraction
    const selectedConsolidated = await selectCanadaLifeAccount(consolidatedAccounts);
    if (!selectedConsolidated) {
      toast.show('Account selection cancelled', 'info');
      return;
    }

    // Extract the source Canada Life account
    const selectedAccount = extractSourceAccount(selectedConsolidated);

    // Show date range picker
    const dateRange = await selectDateRange();
    if (!dateRange) {
      toast.show('Date selection cancelled', 'info');
      return;
    }

    // Validate date range, allow today
    const dateRangeObj = dateRange as { startDate: string; endDate: string };
    validateDateRange(dateRangeObj.startDate, dateRangeObj.endDate, true);

    // Create progress dialog for single account
    const accountForDialog = {
      key: selectedAccount.agreementId,
      nickname: selectedAccount.LongNameEnglish || selectedAccount.EnglishShortName,
      name: selectedAccount.EnglishShortName,
    };

    const progressDialog = showProgressDialog(
      [accountForDialog],
      `Uploading ${selectedAccount.EnglishShortName} Balance & Transactions to Monarch`,
    );

    try {
      // Upload the account with progress tracking (not auto upload, so no today allowance)
      const result = await uploadSingleAccount(selectedAccount, dateRangeObj.startDate, dateRangeObj.endDate, progressDialog, false);

      // Hide cancel button and show close button when upload completes
      progressDialog.hideCancel();

      // Show success summary with transaction counts
      const stats = {
        success: 1,
        failed: 0,
        total: 1,
        transactionsUploaded: result.transactionsUploaded || 0,
        transactionsSkipped: result.transactionsSkipped || 0,
      };
      progressDialog.showSummary(stats);

      // Build completion message including transaction stats
      const txSummary = result.transactionsUploaded > 0
        ? ` ${result.transactionsUploaded} transactions uploaded.`
        : '';
      toast.show(`Successfully uploaded ${selectedAccount.EnglishShortName}!${txSummary}`, 'info');
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
 * @param {Array} consolidatedAccounts - Array of consolidated Canada Life accounts
 * @returns {Promise<Object|null>} Selected consolidated account or null if cancelled
 */
async function selectCanadaLifeAccount(consolidatedAccounts) {
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
    consolidatedAccounts.forEach((consolidated) => {
      // Extract source account for display
      const account = extractSourceAccount(consolidated);

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
        resolve(consolidated); // Return the full consolidated account
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

/**
 * Upload transaction history for a Canada Life account
 * This is a testing/development feature for uploading historical transactions
 * @param {Object} canadalifeAccount - Canada Life account object
 * @param {string} startDate - Start date in YYYY-MM-DD format
 * @param {string} endDate - End date in YYYY-MM-DD format
 * @param {Object} options - Upload options
 * @param {Function} options.onProgress - Progress callback
 * @param {AbortSignal} options.signal - Abort signal
 * @returns {Promise<Object>} Upload result with transaction count
 */
interface UploadTransactionHistoryOptions {
  onProgress?: (message: string) => void;
  signal?: AbortSignal;
}

export async function uploadTransactionHistory(canadalifeAccount, startDate: string, endDate: string, options: UploadTransactionHistoryOptions = {}) {
  const { onProgress, signal } = options;
  const accountId = canadalifeAccount.agreementId;
  const accountName = canadalifeAccount.LongNameEnglish || canadalifeAccount.EnglishShortName;

  try {
    debugLog(`Uploading transaction history for ${accountName} from ${startDate} to ${endDate}`);

    // Set current account context
    stateManager.setAccount(accountId, accountName);

    // Get or create Monarch account mapping
    if (onProgress) onProgress('Getting account mapping...');
    const monarchAccount = await getOrCreateMonarchAccountMapping(canadalifeAccount);
    if (!monarchAccount) {
      throw new CanadaLifeUploadError('Account mapping cancelled by user', accountId);
    }

    // Validate date range
    validateDateRange(startDate, endDate, true, canadalifeAccount);

    // Fetch and process transactions
    if (onProgress) onProgress('Fetching transactions...');
    const transactions = await fetchAndProcessTransactions(canadalifeAccount, startDate, endDate, {
      onProgress,
      signal,
      uploadedTransactionIds: new Set(), // No deduplication for historical upload
    });

    if (transactions.length === 0) {
      toast.show(`No transactions found for ${accountName} in the date range`, 'info');
      return { success: true, transactionCount: 0 };
    }

    // Convert to CSV format
    if (onProgress) onProgress(`Converting ${transactions.length} transactions...`);
    const csvData = convertCanadaLifeTransactionsToMonarchCSV(transactions, accountName);

    // Upload to Monarch
    if (onProgress) onProgress(`Uploading ${transactions.length} transactions...`);
    const success = await monarchApi.uploadTransactions((monarchAccount as Record<string, unknown>).id as string, csvData);

    if (!success) {
      throw new CanadaLifeUploadError('Failed to upload transactions to Monarch', accountId);
    }

    debugLog(`Successfully uploaded ${transactions.length} transactions for ${accountName}`);
    toast.show(`Uploaded ${transactions.length} transactions for ${accountName}`, 'info');

    return { success: true, transactionCount: transactions.length };
  } catch (error) {
    debugLog(`Error uploading transaction history for ${accountName}:`, error);

    if (error instanceof CanadaLifeUploadError) {
      throw error;
    }
    throw new CanadaLifeUploadError(`Failed to upload transactions: ${error.message}`, accountId);
  }
}

