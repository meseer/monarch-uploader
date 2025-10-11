/**
 * Balance Service
 * Handles fetching, processing, and uploading balance history data
 */

import {
  debugLog, formatDate, getLocalToday, getTodayLocal, formatDaysAgoLocal, parseLocalDate,
  getLastUpdateDate,
} from '../../core/utils';
import { STORAGE } from '../../core/config';
import stateManager from '../../core/state';
import questradeApi from '../../api/questrade';
import monarchApi from '../../api/monarch';
import toast from '../../ui/toast';
import { showProgressDialog } from '../../ui/components/progressDialog';
import { showDatePickerPromise } from '../../ui/components/datePicker';
import { showMonarchAccountSelector } from '../../ui/questrade/components/accountSelector';
import { ensureMonarchAuthentication } from '../../ui/components/monarchLoginLink';

/**
 * Custom balance error class
 */
export class BalanceError extends Error {
  constructor(message, accountId) {
    super(message);
    this.name = 'BalanceError';
    this.accountId = accountId;
  }
}

/**
 * Fetch balance history from Questrade
 * @param {string} accountId - Account ID to fetch balance for
 * @param {string} fromDate - Start date in YYYY-MM-DD format
 * @param {string} toDate - End date in YYYY-MM-DD format
 * @returns {Promise<Object>} Raw balance history data
 */
export async function fetchBalanceHistory(accountId, fromDate, toDate) {
  try {
    debugLog(`Fetching balance history for account ${accountId} from ${fromDate} to ${toDate}`);

    // Validate dates
    if (!fromDate || !toDate) {
      throw new BalanceError('Invalid date range provided', accountId);
    }

    // Convert to expected format if needed
    const formattedFromDate = formatDate(new Date(fromDate));
    const formattedToDate = formatDate(new Date(toDate));

    // Fetch current balance
    const balanceData = await questradeApi.makeApiCall(`/v2/brokerage-accounts-balances/${accountId}/balances?timeOfDay=current`);
    if (!balanceData) {
      throw new BalanceError('Failed to fetch current balance data', accountId);
    }

    // Fetch historical balance
    const historyData = await questradeApi.makeApiCall(`/v2/brokerage-accounts-balances/${accountId}/historical-balance?granularity=1d&to=${formattedToDate}&from=${formattedFromDate}`);
    if (!historyData) {
      throw new BalanceError('Failed to fetch historical balance data', accountId);
    }

    return {
      currentBalance: balanceData,
      history: historyData,
    };
  } catch (error) {
    debugLog(`Error fetching balance history for account ${accountId}:`, error);
    if (error instanceof BalanceError) {
      throw error;
    }
    throw new BalanceError(`Failed to fetch balance history: ${error.message}`, accountId);
  }
}

/**
 * Process balance data into CSV format
 * @param {Object} rawData - Raw balance data from API
 * @param {string} accountName - Account name for CSV output
 * @returns {string} CSV formatted data
 */
export function processBalanceData(rawData, accountName) {
  try {
    if (!rawData || !rawData.history) {
      throw new Error('Invalid balance data provided');
    }

    // Get the current balance (CAD only for now)
    const currentBalance = rawData.currentBalance?.totalEquity?.combined?.find((i) => i.currencyCode === 'CAD')?.amount;

    // Initialize CSV with header
    let csvContent = '"Date","Total Equity","Account Name"\n';

    // Add historical data
    if (rawData.history.data && Array.isArray(rawData.history.data)) {
      rawData.history.data.forEach((item) => {
        csvContent += `"${item.date}","${item.totalEquity}","${accountName}"\n`;
      });
    }

    // Add current balance if available
    if (currentBalance) {
      const todayFormatted = getTodayLocal();
      csvContent += `"${todayFormatted}","${currentBalance}","${accountName}"\n`;
    }

    return csvContent;
  } catch (error) {
    debugLog('Error processing balance data:', error);
    throw new Error(`Failed to process balance data: ${error.message}`);
  }
}

/**
 * Get the appropriate date range for balance history
 * @param {string} accountId - Account ID
 * @param {number} days - Number of days to look back (default: 90)
 * @returns {Object} Object with fromDate and toDate in YYYY-MM-DD format
 */
export function getDefaultDateRange(accountId, days = 90) {
  // Get today's date in local timezone
  const toDate = getLocalToday();

  // Check if we have a last used date for this account
  let fromDate;
  const lastUsedDate = GM_getValue(`${STORAGE.QUESTRADE_LAST_UPLOAD_DATE_PREFIX}${accountId}`);

  if (lastUsedDate) {
    // Parse the saved date in local timezone
    fromDate = parseLocalDate(lastUsedDate);

    // Safety check - if saved date is invalid or future, use default
    if (Number.isNaN(fromDate.getTime()) || fromDate > toDate) {
      fromDate = formatDaysAgoLocal(days);
      return {
        fromDate,
        toDate: getTodayLocal(),
      };
    }
  } else {
    // Default to looking back specified days
    fromDate = formatDaysAgoLocal(days);
    return {
      fromDate,
      toDate: getTodayLocal(),
    };
  }

  return {
    fromDate: formatDate(fromDate),
    toDate: getTodayLocal(),
  };
}

/**
 * Store the last used date for an account
 * @param {string} accountId - Account ID
 * @param {string} toDate - End date in YYYY-MM-DD format
 */
export function storeDateRange(accountId, toDate) {
  if (!accountId || !toDate) return;

  try {
    GM_setValue(`${STORAGE.QUESTRADE_LAST_UPLOAD_DATE_PREFIX}${accountId}`, toDate);
    debugLog(`Stored last used date ${toDate} for account ${accountId}`);
  } catch (error) {
    debugLog('Error storing date range:', error);
  }
}

/**
 * Upload balance data to Monarch Money
 * @param {string} accountId - Questrade account ID
 * @param {string} csvData - CSV data to upload
 * @param {string} fromDate - Start date in YYYY-MM-DD format
 * @param {string} toDate - End date in YYYY-MM-DD format
 * @returns {Promise<boolean>} Success status
 */
export async function uploadBalanceToMonarch(accountId, csvData, fromDate, toDate) {
  try {
    debugLog(`Uploading balance for account ${accountId} from ${fromDate} to ${toDate}`);

    if (!csvData) {
      throw new BalanceError('No CSV data to upload', accountId);
    }

    // Get account name from state
    const accountName = stateManager.getState().currentAccount.nickname || 'Unknown Account';

    // Resolve Monarch account mapping for this Questrade account
    const monarchAccount = await monarchApi.resolveAccountMapping(
      accountId,
      STORAGE.QUESTRADE_ACCOUNT_MAPPING_PREFIX,
      'brokerage',
    );

    if (!monarchAccount) {
      throw new BalanceError('Account mapping cancelled by user', accountId);
    }

    // Upload using Monarch API with resolved account ID
    const success = await monarchApi.uploadBalance(monarchAccount.id, csvData, fromDate, toDate);

    // Store the date for next time if successful
    if (success) {
      storeDateRange(accountId, toDate);
      debugLog(`Successfully uploaded ${accountName} balance history to Monarch`);
    }

    return success;
  } catch (error) {
    debugLog(`Error uploading balance for account ${accountId}:`, error);
    if (error instanceof BalanceError) {
      throw error;
    }
    throw new BalanceError(`Failed to upload balance: ${error.message}`, accountId);
  }
}

/**
 * Complete process to fetch, process and upload balance history for an account
 * @param {string} accountId - Account ID to process
 * @param {string} accountName - Account name
 * @param {string} fromDate - Start date in YYYY-MM-DD format
 * @param {string} toDate - End date in YYYY-MM-DD format
 * @returns {Promise<boolean>} Success status
 */
export async function processAndUploadBalance(accountId, accountName, fromDate, toDate) {
  try {
    if (!accountId || !accountName) {
      throw new BalanceError('Account information missing', accountId);
    }

    // Set current account in state
    stateManager.setAccount(accountId, accountName);

    // Step 1: Fetch balance history
    toast.show(`Downloading ${accountName} balance history...`, 'trace');
    const balanceData = await fetchBalanceHistory(accountId, fromDate, toDate);

    // Step 2: Process the data
    const csvData = processBalanceData(balanceData, accountName);

    // Step 3: Upload to Monarch
    toast.show(`Uploading ${accountName} balance history to Monarch (may take up to 2 minutes for large files)...`, 'trace');
    const success = await uploadBalanceToMonarch(accountId, csvData, fromDate, toDate);

    // Step 4: Show result notification
    if (success) {
      toast.show(`Successfully uploaded ${accountName} balance history to Monarch`, 'info');
      return true;
    }
    toast.show(`Failed to upload ${accountName} balance history to Monarch`, 'error');
    return false;
  } catch (error) {
    const errorMessage = error instanceof BalanceError ? error.message : `Error processing account: ${error.message}`;
    toast.show(errorMessage, 'error');
    debugLog(`Error in processAndUploadBalance for ${accountId}:`, error);
    return false;
  }
}

/**
 * Bulk process multiple accounts
 * @param {Array<Object>} accounts - Array of account objects with id and name
 * @param {string} fromDate - Start date in YYYY-MM-DD format
 * @param {string} toDate - End date in YYYY-MM-DD format
 * @returns {Promise<Object>} Results with success and fail counts
 */
export async function bulkProcessAccounts(accounts, fromDate, toDate) {
  if (!accounts || accounts.length === 0) {
    debugLog('No accounts provided for bulk processing');
    toast.show('No accounts to process', 'warning');
    return { success: 0, failed: 0 };
  }

  const results = { success: 0, failed: 0 };

  // Show initial progress
  toast.show(`Processing ${accounts.length} accounts...`, 'trace');

  // Process accounts sequentially
  for (let i = 0; i < accounts.length; i += 1) {
    const account = accounts[i];
    const accountDisplayName = account.nickname || account.name || 'Account';
    const progressMessage = `Processing account ${i + 1} of ${accounts.length}: ${accountDisplayName}`;
    debugLog(progressMessage);
    toast.show(progressMessage, 'info');

    const success = await processAndUploadBalance(
      account.id,
      accountDisplayName,
      fromDate,
      toDate,
    );

    if (success) {
      results.success += 1;
    } else {
      results.failed += 1;
    }
  }

  // Show final summary
  const summaryMessage = `Completed: ${results.success} successful, ${results.failed} failed`;
  debugLog('Bulk processing complete:', results);
  toast.show(summaryMessage, results.failed === 0 ? 'info' : 'warning');

  return results;
}

/**
 * Extract balance change information for an account
 * @param {string} accountId - Account ID
 * @param {Object} balanceData - Balance data from fetchBalanceHistory
 * @returns {Object|null} Balance change data or null if not available
 */
function extractBalanceChange(accountId, balanceData) {
  try {
    // Get today's balance (CAD)
    const currentBalance = balanceData.currentBalance?.totalEquity?.combined?.find((i) => i.currencyCode === 'CAD')?.amount;
    if (!currentBalance) {
      debugLog(`No current CAD balance found for account ${accountId}`);
      return null;
    }

    // Get last upload date
    const lastUploadDate = getLastUpdateDate(accountId, 'questrade');
    if (!lastUploadDate) {
      debugLog(`No last upload date found for account ${accountId}`);
      return null;
    }

    // Find old balance from last upload date in history data
    if (!balanceData.history?.data || !Array.isArray(balanceData.history.data)) {
      debugLog(`No historical data found for account ${accountId}`);
      return null;
    }

    const oldBalanceEntry = balanceData.history.data.find((item) => item.date === lastUploadDate);
    if (!oldBalanceEntry) {
      debugLog(`No balance found for last upload date ${lastUploadDate} for account ${accountId}`);
      return null;
    }

    const oldBalance = oldBalanceEntry.totalEquity;
    if (oldBalance === undefined || oldBalance === null) {
      debugLog(`Invalid old balance for account ${accountId}`);
      return null;
    }

    // Calculate percentage change
    const changePercent = oldBalance !== 0
      ? ((currentBalance - oldBalance) / Math.abs(oldBalance)) * 100
      : 0;

    debugLog(`Balance change for account ${accountId}: ${oldBalance} -> ${currentBalance} (${changePercent.toFixed(2)}%)`);

    return {
      oldBalance,
      newBalance: currentBalance,
      lastUploadDate,
      changePercent,
    };
  } catch (error) {
    debugLog(`Error extracting balance change for account ${accountId}:`, error);
    return null;
  }
}

/**
 * Comprehensive function to upload all Questrade accounts to Monarch
 * Based on the original script's uploadAllAccountsToMonarch functionality
 * @returns {Promise<void>}
 */
export async function uploadAllAccountsToMonarch() {
  try {
    // Check Monarch authentication before proceeding
    const authenticated = await ensureMonarchAuthentication(null, 'upload all Questrade accounts');
    if (!authenticated) {
      return; // User cancelled authentication
    }

    // Get all Questrade accounts
    const accounts = await questradeApi.fetchAccounts();
    if (!accounts || !accounts.length) {
      toast.show('No Questrade accounts found.', 'error');
      return;
    }

    // Create progress dialog
    const progressDialog = showProgressDialog(accounts);

    // Initialize stats and cancellation state
    const stats = { success: 0, failed: 0, total: accounts.length };
    let isCancelled = false;
    let isUploadComplete = false;

    // Set up cancel callback
    progressDialog.onCancel(() => {
      debugLog('Upload cancellation requested');
      isCancelled = true;
      toast.show('Upload cancelled by user', 'warning');
    });

    // Ensure progress dialog shows close button when upload completes
    const completeUpload = () => {
      if (!isUploadComplete) {
        isUploadComplete = true;
        progressDialog.hideCancel();
        debugLog('Upload process completed, showing close button');
      }
    };

    try {
      // Ensure all account mappings before starting
      const mappingSuccess = await ensureAllAccountMappings(accounts, progressDialog);
      if (!mappingSuccess || isCancelled) {
        progressDialog.close();
        toast.show('Upload cancelled: Account mapping incomplete.', 'warning');
        return;
      }

      // Get start dates for all accounts
      const startDates = await getStartDatesForAllAccounts(accounts);
      if (!startDates || isCancelled) {
        progressDialog.close();
        toast.show('Upload cancelled: Date selection cancelled.', 'warning');
        return;
      }

      // Process each account
      const processedAccounts = [];
      for (const account of accounts) {
        // Check for cancellation before processing each account
        if (isCancelled) {
          debugLog('Upload cancelled, stopping account processing');
          break;
        }

        // Skip accounts we've already processed (prevent duplicates)
        if (processedAccounts.includes(account.key)) {
          continue;
        }
        processedAccounts.push(account.key);

        try {
          // Update progress
          progressDialog.updateProgress(account.key, 'processing', 'Fetching balance history...');

          // Set current account for UI updates
          const accountName = account.nickname || account.name || 'Account';
          stateManager.setAccount(account.key, accountName);

          const fromDate = startDates[account.key];
          const toDate = getTodayLocal();

          // Check cancellation before fetch
          if (isCancelled) break;

          // Fetch balance history
          progressDialog.updateProgress(account.key, 'processing', 'Fetching balance data...');
          const balanceData = await fetchBalanceHistory(account.key, fromDate, toDate);

          if (!balanceData) {
            throw new Error('Failed to fetch balance history.');
          }

          // Extract and display balance change information
          const balanceChange = extractBalanceChange(account.key, balanceData);
          if (balanceChange) {
            progressDialog.updateBalanceChange(account.key, balanceChange);
          }

          // Process balance data to CSV
          const csvData = processBalanceData(balanceData, accountName);

          // Check cancellation before upload
          if (isCancelled) break;

          // Upload to Monarch
          progressDialog.updateProgress(account.key, 'processing', 'Uploading to Monarch...');
          const uploadSuccess = await uploadBalanceToMonarch(account.key, csvData, fromDate, toDate);

          if (uploadSuccess) {
            // Update success stats and progress
            stats.success += 1;
            progressDialog.updateProgress(account.key, 'success', 'Upload complete');
          } else {
            throw new Error('Upload failed without specific error message');
          }
        } catch (error) {
          // Update failed stats and progress
          stats.failed += 1;
          progressDialog.updateProgress(account.key, 'error', error.message);

          // Show error and wait for acknowledgment
          await progressDialog.showError(account.key, error);

          // Stop processing remaining accounts
          break;
        }
      }

      // Show final summary
      progressDialog.showSummary(stats);

      // Complete the upload process
      completeUpload();

      // Show appropriate completion message
      if (isCancelled) {
        toast.show('Upload process was cancelled', 'warning');
      } else if (stats.success === stats.total) {
        toast.show(`Successfully uploaded balance history for all ${stats.total} accounts!`, 'info');
      } else if (stats.success > 0) {
        toast.show(`Upload completed: ${stats.success} successful, ${stats.failed} failed`, 'warning');
      }
    } catch (error) {
      // Ensure we complete the upload process even on error
      completeUpload();
      throw error;
    }
  } catch (error) {
    toast.show(`Failed to start upload process: ${error.message}`, 'error');
  }
}

/**
 * Ensure all accounts have Monarch account mappings
 * @param {Array} accounts - List of Questrade accounts
 * @param {Object} progressDialog - Progress dialog instance
 * @returns {Promise<boolean>} True if all accounts are mapped, false if cancelled
 */
async function ensureAllAccountMappings(accounts, progressDialog) {
  const unmappedAccounts = [];

  // Check each account for mapping
  for (let i = 0; i < accounts.length; i += 1) {
    const account = accounts[i];
    const monarchAccount = JSON.parse(GM_getValue(`${STORAGE.QUESTRADE_ACCOUNT_MAPPING_PREFIX}${account.key}`, null));
    if (!monarchAccount) {
      unmappedAccounts.push(account);
    }
  }

  // Return early if all accounts are mapped
  if (unmappedAccounts.length === 0) {
    return true;
  }

  // Show message about missing mappings
  toast.show(`${unmappedAccounts.length} accounts need to be mapped to Monarch`, 'info');

  // Get Monarch accounts for mapping
  const investmentAccounts = await monarchApi.listAccounts();

  if (!investmentAccounts.length) {
    toast.show('No investment accounts found in Monarch.', 'error');
    return false;
  }

  // Map each unmapped account
  for (let i = 0; i < unmappedAccounts.length; i += 1) {
    const account = unmappedAccounts[i];
    // Update progress if dialog exists
    if (progressDialog) {
      progressDialog.updateProgress(account.key, 'processing', 'Mapping account...');
    }

    // Set current account context for the selector
    const accountName = account.nickname || account.name || 'Account';
    stateManager.setAccount(account.key, accountName);

    // Show account selector for this Questrade account
    const monarchAccount = await new Promise((resolve) => showMonarchAccountSelector(investmentAccounts, resolve));

    if (!monarchAccount) {
      // User cancelled
      return false;
    }

    // Save the mapping
    GM_setValue(`${STORAGE.QUESTRADE_ACCOUNT_MAPPING_PREFIX}${account.key}`, JSON.stringify(monarchAccount));

    // Update progress if dialog exists
    if (progressDialog) {
      progressDialog.updateProgress(account.key, 'success', 'Mapping complete');
    }
  }

  return true;
}

/**
 * Get start dates for all accounts
 * @param {Array} accounts - List of accounts
 * @returns {Promise<Object|null>} Object mapping account keys to start dates, or null if cancelled
 */
async function getStartDatesForAllAccounts(accounts) {
  const startDates = {};
  let needsDatePicker = false;
  let oldestDate = null;

  // Check each account for lastUsedDate
  for (const account of accounts) {
    const lastDate = GM_getValue(`${STORAGE.QUESTRADE_LAST_UPLOAD_DATE_PREFIX}${account.key}`, null);
    if (lastDate && /^\d{4}-\d{2}-\d{2}$/.test(lastDate)) {
      startDates[account.key] = lastDate;
      // Track oldest date among accounts that have one
      if (!oldestDate || lastDate < oldestDate) {
        oldestDate = lastDate;
      }
    } else {
      needsDatePicker = true;
    }
  }

  // If any account is missing lastUsedDate, show date picker once
  if (needsDatePicker) {
    const defaultDate = oldestDate || formatDate(new Date(Date.now() - 12096e5)); // 2 weeks ago
    const selectedDate = await showDatePickerPromise(
      defaultDate,
      'Select start date for accounts without history',
    );

    if (!selectedDate) return null; // User cancelled

    // Use selected date for accounts without lastUsedDate
    for (const account of accounts) {
      if (!startDates[account.key]) {
        startDates[account.key] = selectedDate;
      }
    }
  }

  return startDates;
}

// Default export with all methods
export default {
  fetchBalanceHistory,
  processBalanceData,
  getDefaultDateRange,
  storeDateRange,
  uploadBalanceToMonarch,
  processAndUploadBalance,
  bulkProcessAccounts,
  uploadAllAccountsToMonarch,
  BalanceError,
};
