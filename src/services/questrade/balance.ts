/**
 * Balance Service
 * Handles fetching, processing, and uploading balance history data
 */

import {
  debugLog, formatDate, getLocalToday, getTodayLocal, formatDaysAgoLocal, parseLocalDate,
  getLastUpdateDate, saveLastUploadDate,
} from '../../core/utils';
import { ACCOUNT_STATUS } from '../../core/config';
import stateManager from '../../core/state';
import questradeApi from '../../api/questrade';
import monarchApi from '../../api/monarch';
import accountService from '../common/accountService';
import { INTEGRATIONS } from '../../core/integrationCapabilities';
import toast from '../../ui/toast';
import { showProgressDialog } from '../../ui/components/progressDialog';
import { showDatePickerPromise } from '../../ui/components/datePicker';
import { ensureMonarchAuthentication } from '../../ui/components/monarchLoginLink';
import { ensureAccountMapping, ensureAllAccountMappings as ensureQuestradeAccountMappings } from './accountMapping';

// Use the shared account mapping module
const ensureAllAccountMappings = ensureQuestradeAccountMappings;

/**
 * Custom balance error class
 */
export class BalanceError extends Error {
  accountId: string | null;

  constructor(message: string, accountId: string | null = null) {
    super(message);
    this.name = 'BalanceError';
    this.accountId = accountId;
  }
}

/**
 * Get accounts for sync by merging API accounts with consolidated storage accounts.
 * This handles closed accounts that are no longer returned by the API but exist in storage.
 *
 * Behavior for accounts "in storage but not in API":
 * - If already marked as status='closed' in storage: excluded from regular sync, included for full history
 * - If NOT yet marked as closed: included in regular sync (will be marked closed after successful sync)
 *
 * @param {Object} options - Options for account retrieval
 * @param {boolean} options.includeClosed - Whether to include accounts already marked as 'closed' (for full history sync)
 * @returns {Promise<Array>} Array of account objects with status field:
 *   - account: The account object (from API or storage)
 *   - status: 'active' | 'closed' | 'pending_close' (not yet marked closed but not in API)
 *   - source: 'api' | 'storage' (where the account came from)
 */
export async function getAccountsForSync(options = { includeClosed: false }) {
  const { includeClosed } = options;

  try {
    // Get accounts from Questrade API (these are active accounts in consolidated structure)
    let apiAccounts = [];
    try {
      apiAccounts = await questradeApi.fetchAccounts();
    } catch (error) {
      debugLog('Error fetching accounts from API:', error);
      // If API fails, we can still work with storage accounts for closed accounts
    }

    // Create a set of API account IDs for quick lookup
    // Note: fetchAccounts returns consolidated structure with questradeAccount nested object
    // IMPORTANT: Exclude accounts marked as isOrphanedFromApi (these are preserved from storage, not from API)
    const apiAccountIds = new Set(
      apiAccounts
        .filter((acc) => !acc.isOrphanedFromApi) // Exclude orphaned accounts
        .map((acc) => acc.questradeAccount?.id || acc.questradeAccount?.key),
    );

    // Get accounts from consolidated storage (same structure as apiAccounts)
    const storedAccounts = accountService.getAccounts(INTEGRATIONS.QUESTRADE);

    // Build the merged account list
    // Note: apiAccounts already contains merged data from fetchAccounts(), which
    // preserves orphaned accounts from storage. So we just need to add status/source.
    const mergedAccounts = [];

    // Add all API accounts (which already includes preserved orphans from fetchAccounts)
    for (const apiAccount of apiAccounts) {
      const accountId = apiAccount.questradeAccount?.id || apiAccount.questradeAccount?.key;
      const accountNickname = apiAccount.questradeAccount?.nickname || apiAccount.questradeAccount?.name || accountId;

      // Check if this account was orphaned (preserved from storage, not actually from API)
      // We can detect this by checking if the account exists in storage but has orphan markers
      // For now, mark all as active since fetchAccounts already handles the merge
      mergedAccounts.push({
        key: accountId,
        nickname: accountNickname,
        name: apiAccount.questradeAccount?.name || accountNickname,
        ...apiAccount.questradeAccount,
        status: ACCOUNT_STATUS.ACTIVE,
        source: 'api',
        syncEnabled: apiAccount.syncEnabled ?? true,
      });
    }

    // Then, check storage accounts for accounts not in API
    // This handles accounts that weren't returned by the API but exist in storage
    for (const storedAccount of storedAccounts) {
      const qa = storedAccount.questradeAccount as Record<string, unknown> | undefined;
      const accountId = qa?.id || qa?.key;
      if (!accountId) continue;

      // If account is already in merged list (from API response), skip
      if (apiAccountIds.has(accountId)) {
        continue;
      }

      // Account is in storage but not in API
      // Check if it's ALREADY marked as closed in storage
      const isAlreadyMarkedClosed = storedAccount.status === ACCOUNT_STATUS.CLOSED;

      // Build account object from storage data
      const storageAccount = {
        key: accountId,
        nickname: qa?.nickname || accountId,
        name: qa?.name || qa?.nickname || accountId,
        // Copy other fields from stored questradeAccount if available
        ...(qa as object),
        status: isAlreadyMarkedClosed ? ACCOUNT_STATUS.CLOSED : 'pending_close',
        source: 'storage',
        closedDate: storedAccount.closedDate || null,
        syncEnabled: storedAccount.syncEnabled ?? true,
      };

      if (isAlreadyMarkedClosed) {
        // Account was previously marked as closed
        // Only include if includeClosed is true (for full history sync)
        if (includeClosed) {
          mergedAccounts.push(storageAccount);
          debugLog(`Including already-closed account: ${accountId} (${storageAccount.nickname})`);
        } else {
          debugLog(`Skipping already-closed account: ${accountId} (${storageAccount.nickname})`);
        }
      } else {
        // Account is in storage but not in API, and NOT yet marked as closed
        // Include it for one more sync - it will be marked closed after successful sync
        mergedAccounts.push(storageAccount);
        debugLog(`Including pending-close account (needs final sync): ${accountId} (${storageAccount.nickname})`);
      }
    }

    const pendingCloseCount = mergedAccounts.filter((a) => a.status === 'pending_close').length;
    const closedCount = mergedAccounts.filter((a) => a.status === ACCOUNT_STATUS.CLOSED).length;
    debugLog(`getAccountsForSync: ${mergedAccounts.length} total (API: ${apiAccounts.length}, pending_close: ${pendingCloseCount}, closed: ${closedCount})`);

    return mergedAccounts;
  } catch (error) {
    debugLog('Error in getAccountsForSync:', error);
    throw error;
  }
}

/**
 * Mark an account as closed in consolidated storage
 * @param {string} accountId - Account ID to mark as closed
 * @returns {boolean} Success status
 */
export function markAccountAsClosed(accountId) {
  const today = getTodayLocal();

  const success = accountService.updateAccountInList(INTEGRATIONS.QUESTRADE, accountId, {
    status: ACCOUNT_STATUS.CLOSED,
    closedDate: today,
  });

  if (success) {
    debugLog(`Marked account ${accountId} as closed on ${today}`);
  } else {
    debugLog(`Failed to mark account ${accountId} as closed`);
  }

  return success;
}

/**
 * Get count of active accounts for sync (excludes closed accounts)
 * @returns {Promise<number>} Count of active accounts
 */
export async function getActiveAccountCount() {
  const accounts = await getAccountsForSync({ includeClosed: false });
  return accounts.length;
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
 * @returns {string|null} CSV formatted data, or null if no data available
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
    let dataRowCount = 0;

    // Add historical data
    if (rawData.history.data && Array.isArray(rawData.history.data)) {
      rawData.history.data.forEach((item) => {
        const date = item.date ?? '';
        const totalEquity = item.totalEquity ?? '';
        csvContent += `"${date}","${totalEquity}","${accountName}"\n`;
        dataRowCount += 1;
      });
    }

    // Add current balance if available
    if (currentBalance) {
      const todayFormatted = getTodayLocal();
      csvContent += `"${todayFormatted}","${currentBalance}","${accountName}"\n`;
      dataRowCount += 1;
    }

    // Return null if no data rows (only header) - prevents uploading empty files
    if (dataRowCount === 0) {
      debugLog(`No balance data to upload for ${accountName} - empty result`);
      return null;
    }

    return csvContent;
  } catch (error) {
    debugLog('Error processing balance data:', error);
    throw new Error(`Failed to process balance data: ${error.message}`, { cause: error });
  }
}

/**
 * Get the appropriate date range for balance history
 * Uses consolidated storage first, then falls back to legacy storage
 * @param {string} accountId - Account ID
 * @param {number} days - Number of days to look back (default: 90)
 * @returns {Object} Object with fromDate and toDate in YYYY-MM-DD format
 */
export function getDefaultDateRange(accountId, days = 90) {
  // Get today's date in local timezone
  const toDate = getLocalToday();

  // Check if we have a last used date for this account
  // getLastUpdateDate handles both consolidated and legacy storage
  let fromDate;
  const lastUsedDate = getLastUpdateDate(accountId, 'questrade');

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
 * Saves to both consolidated storage and legacy storage for backward compatibility
 * @param {string} accountId - Account ID
 * @param {string} toDate - End date in YYYY-MM-DD format
 */
export function storeDateRange(accountId, toDate) {
  if (!accountId || !toDate) return;

  try {
    // Use the unified saveLastUploadDate function which handles both storages
    saveLastUploadDate(accountId, toDate, 'questrade');
    debugLog(`Stored last used date ${toDate} for Questrade account ${accountId}`);
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

    // Check for existing mapping, or prompt for mapping if not found
    let monarchAccount = accountService.getMonarchAccountMapping(INTEGRATIONS.QUESTRADE, accountId);

    // If no mapping found, use the shared mapping module to resolve it
    if (!monarchAccount) {
      debugLog(`No mapping found for account ${accountId}, using shared mapping resolver`);

      const result = await ensureAccountMapping(accountId, accountName);

      if (!result) {
        throw new BalanceError('Account mapping cancelled by user', accountId);
      }

      if (result.skipped) {
        throw new BalanceError('Account skipped by user', accountId);
      }

      monarchAccount = result.monarchAccount;
    }

    // Upload using Monarch API with resolved account ID
    const success = await monarchApi.uploadBalance((monarchAccount as Record<string, unknown>).id as string, csvData, fromDate, toDate);

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
    toast.show(`Downloading ${accountName} balance history...`, 'debug');
    const balanceData = await fetchBalanceHistory(accountId, fromDate, toDate);

    // Step 2: Process the data
    const csvData = processBalanceData(balanceData, accountName);

    // Check if we have data to upload
    if (!csvData) {
      debugLog(`No balance data available for ${accountName}, skipping upload`);
      toast.show(`No new balance data to upload for ${accountName}`, 'debug');
      return true; // Return success - nothing to upload is not an error
    }

    // Step 3: Upload to Monarch
    toast.show(`Uploading ${accountName} balance history to Monarch (may take up to 2 minutes for large files)...`, 'debug');
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
    toast.show('No accounts to process', 'debug');
    return { success: 0, failed: 0 };
  }

  const results = { success: 0, failed: 0 };

  // Show initial progress
  toast.show(`Processing ${accounts.length} accounts...`, 'debug');

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
export function extractBalanceChange(accountId, balanceData) {
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

    // Check if we have historical data
    if (!balanceData.history?.data || !Array.isArray(balanceData.history.data)) {
      debugLog(`No historical data found for account ${accountId}`);
      return null;
    }

    let oldBalance;
    let compareDate = lastUploadDate;
    const todayDate = getTodayLocal();

    // If last upload was today, use yesterday's balance as the comparison point
    // (yesterday's closing balance = today's opening balance)
    if (lastUploadDate === todayDate) {
      debugLog('Last upload was today, using yesterday\'s balance for comparison');

      // Get yesterday's date
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayDate = formatDate(yesterday);

      // Find yesterday's balance
      const yesterdayEntry = balanceData.history.data.find((item) => item.date === yesterdayDate);
      if (yesterdayEntry) {
        oldBalance = yesterdayEntry.totalEquity;
        compareDate = yesterdayDate;
      } else {
        // If yesterday's balance not found (weekend), find most recent
        const sortedData = [...balanceData.history.data].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        if (sortedData.length > 0) {
          oldBalance = sortedData[0].totalEquity;
          compareDate = sortedData[0].date;
          debugLog(`Yesterday not found, using most recent balance from ${compareDate}`);
        } else {
          debugLog('No historical data available for comparison');
          return null;
        }
      }
    } else {
      // Last upload was in the past, find that date's balance
      const oldBalanceEntry = balanceData.history.data.find((item) => item.date === lastUploadDate);

      if (oldBalanceEntry) {
        oldBalance = oldBalanceEntry.totalEquity;
      } else {
        // Date not found (weekend/holiday), find nearest previous date
        debugLog(`Exact date ${lastUploadDate} not found, searching for nearest previous date`);

        const sortedData = [...balanceData.history.data]
          .filter((item) => item.date < lastUploadDate)
          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        if (sortedData.length > 0) {
          oldBalance = sortedData[0].totalEquity;
          compareDate = sortedData[0].date;
          debugLog(`Using nearest previous date ${compareDate} for comparison`);
        } else {
          debugLog('No suitable historical balance found for comparison');
          return null;
        }
      }
    }

    // Validate old balance
    if (oldBalance === undefined || oldBalance === null) {
      debugLog(`Invalid old balance for account ${accountId}`);
      return null;
    }

    // Calculate percentage change
    const changePercent = oldBalance !== 0
      ? ((currentBalance - oldBalance) / Math.abs(oldBalance)) * 100
      : 0;

    debugLog(`Balance change for account ${accountId}: ${oldBalance} (${compareDate}) -> ${currentBalance} (today) (${changePercent.toFixed(2)}%)`);

    return {
      oldBalance,
      newBalance: currentBalance,
      lastUploadDate: compareDate, // Use the actual date we're comparing from
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

    // Get all Questrade accounts (merged API + storage for closed accounts)
    // Excludes accounts already marked as 'closed', includes 'pending_close' accounts
    const accounts = await getAccountsForSync({ includeClosed: false });
    if (!accounts || !accounts.length) {
      toast.show('No Questrade accounts found.', 'error');
      return;
    }

    // Create progress dialog
    const progressDialog = showProgressDialog(accounts);

    // Initialize stats and cancellation state
    const stats = { success: 0, failed: 0, skipped: 0, total: accounts.length };
    let isCancelled = false;
    let isUploadComplete = false;

    // Set up cancel callback
    progressDialog.onCancel(() => {
      debugLog('Upload cancellation requested');
      isCancelled = true;
      toast.show('Upload cancelled by user', 'info');
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
        toast.show('Upload cancelled: Account mapping incomplete.', 'info');
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

        // Skip accounts where sync has been disabled by the user
        if (account.syncEnabled === false) {
          stats.skipped += 1;
          progressDialog.updateProgress(account.key, 'skipped', 'Sync disabled');
          debugLog(`Skipped account ${account.key} - sync disabled by user`);
          continue;
        }

        try {
          // Set current account for UI updates
          const accountName = account.nickname || account.name || 'Account';
          stateManager.setAccount(account.key, accountName);

          // Get start date for this account - ask user if not stored
          let fromDate = getLastUpdateDate(account.key, 'questrade');
          if (!fromDate) {
            // Show date picker for this specific account with "Skip" button
            progressDialog.updateProgress(account.key, 'processing', 'Waiting for date selection...');
            const defaultDate = formatDaysAgoLocal(14); // 2 weeks ago as default
            fromDate = await showDatePickerPromise(
              defaultDate,
              `Select start date for ${accountName}`,
              { cancelButtonText: 'Skip' },
            );

            if (!fromDate) {
              // User clicked Skip - skip this account and continue with others
              stats.skipped += 1;
              progressDialog.updateProgress(account.key, 'skipped', 'Skipped by user');
              debugLog(`Skipped account ${account.key} - user clicked Skip on date picker`);
              continue;
            }
          }

          const toDate = getTodayLocal();

          // Update progress
          progressDialog.updateProgress(account.key, 'processing', 'Fetching balance history...');

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

          // Check if we have any data to upload
          if (!csvData) {
            // No balance data available (likely closed account with no recent history)
            stats.skipped += 1;
            progressDialog.updateProgress(account.key, 'skipped', 'No balance data available');
            debugLog(`Skipped account ${account.key} - no balance data available`);

            // Still mark pending_close accounts as closed even without data
            if (account.status === 'pending_close') {
              markAccountAsClosed(account.key);
              debugLog(`Marked pending_close account ${account.key} as closed (no data to upload)`);
            }
            continue;
          }

          // Check cancellation before upload
          if (isCancelled) break;

          // Upload to Monarch
          progressDialog.updateProgress(account.key, 'processing', 'Uploading to Monarch...');
          const uploadSuccess = await uploadBalanceToMonarch(account.key, csvData, fromDate, toDate);

          if (uploadSuccess) {
            // Update success stats and progress
            stats.success += 1;
            progressDialog.updateProgress(account.key, 'success', 'Upload complete');

            // If this was a pending_close account (in storage but not in API, not yet marked closed),
            // mark it as closed after successful sync - this is the final sync for this account
            if (account.status === 'pending_close') {
              markAccountAsClosed(account.key);
              debugLog(`Marked pending_close account ${account.key} as closed after successful sync`);
            }
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
        toast.show('Upload process was cancelled', 'info');
      } else if (stats.success === stats.total) {
        toast.show(`Successfully uploaded balance history for all ${stats.total} accounts!`, 'info');
      } else if (stats.success > 0) {
        const parts = [`${stats.success} successful`];
        if (stats.skipped > 0) parts.push(`${stats.skipped} skipped`);
        if (stats.failed > 0) parts.push(`${stats.failed} failed`);
        toast.show(`Upload completed: ${parts.join(', ')}`, stats.failed > 0 ? 'warning' : 'info');
      } else if (stats.skipped === stats.total) {
        toast.show('All accounts were skipped', 'info');
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
 * Get account creation date from cached account data
 * @param {string} accountId - Account ID
 * @returns {string|null} Creation date in YYYY-MM-DD format or null
 */
export function getAccountCreationDate(accountId) {
  const account = questradeApi.getAccount(accountId) as Record<string, unknown> | null;
  if (!account || !account.createdOn) {
    debugLog(`No createdOn found for account ${accountId}`);
    return null;
  }

  // createdOn is in ISO format, extract just the date part
  const createdOnDate = (account.createdOn as string).split('T')[0];
  debugLog(`Account ${accountId} was created on ${createdOnDate}`);
  return createdOnDate;
}

/**
 * Upload full balance history for a single account from a specified date
 * @param {string} accountId - Account ID
 * @param {string} accountName - Account name
 * @param {string} fromDate - Start date (typically account creation date)
 * @returns {Promise<boolean>} Success status
 */
export async function uploadFullBalanceHistoryForAccount(accountId, accountName, fromDate) {
  const toDate = getTodayLocal();
  debugLog(`Uploading full balance history for ${accountName} from ${fromDate} to ${toDate}`);

  return processAndUploadBalance(accountId, accountName, fromDate, toDate);
}

/**
 * Upload full balance history for all Questrade accounts from their creation dates
 * Shows a progress dialog and handles the bulk upload process
 * Includes closed accounts (accounts in storage but not in API)
 * Each account is prompted for its start date individually
 * @returns {Promise<void>}
 */
export async function uploadFullBalanceHistoryForAllAccounts() {
  try {
    // Check Monarch authentication before proceeding
    const authenticated = await ensureMonarchAuthentication(null, 'upload full balance history');
    if (!authenticated) {
      return; // User cancelled authentication
    }

    // Get all Questrade accounts including closed ones (for full history sync)
    const accounts = await getAccountsForSync({ includeClosed: true });
    if (!accounts || !accounts.length) {
      toast.show('No Questrade accounts found.', 'error');
      return;
    }

    // Create progress dialog (pass account status for closed account styling)
    const progressDialog = showProgressDialog(accounts, 'Uploading Full Balance History');

    // Initialize stats and cancellation state
    const stats = { success: 0, failed: 0, skipped: 0, total: accounts.length };
    let isCancelled = false;
    let isUploadComplete = false;

    // Set up cancel callback
    progressDialog.onCancel(() => {
      debugLog('Full balance upload cancellation requested');
      isCancelled = true;
      toast.show('Upload cancelled by user', 'info');
    });

    // Ensure progress dialog shows close button when upload completes
    const completeUpload = () => {
      if (!isUploadComplete) {
        isUploadComplete = true;
        progressDialog.hideCancel();
        debugLog('Full balance upload process completed, showing close button');
      }
    };

    try {
      // Ensure all account mappings before starting
      const mappingSuccess = await ensureAllAccountMappings(accounts, progressDialog);
      if (!mappingSuccess || isCancelled) {
        progressDialog.close();
        toast.show('Upload cancelled: Account mapping incomplete.', 'info');
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
          // Set current account for UI updates
          const accountName = account.nickname || account.name || 'Account';
          stateManager.setAccount(account.key, accountName);

          // Determine default start date for this account
          // Use account creation date if available, otherwise 1 year ago
          let defaultFromDate;
          const createdOn = account.createdOn ? account.createdOn.split('T')[0] : null;
          if (createdOn) {
            defaultFromDate = createdOn;
          } else {
            const oneYearAgo = new Date();
            oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
            defaultFromDate = formatDate(oneYearAgo);
          }

          // Show date picker for this specific account with "Skip" button
          progressDialog.updateProgress(account.key, 'processing', 'Waiting for date selection...');
          const fromDate = await showDatePickerPromise(
            defaultFromDate,
            `Select start date for ${accountName} (full history)`,
            { cancelButtonText: 'Skip' },
          );

          if (!fromDate) {
            // User clicked Skip - skip this account and continue with others
            stats.skipped += 1;
            progressDialog.updateProgress(account.key, 'skipped', 'Skipped by user');
            debugLog(`Skipped account ${account.key} - user clicked Skip on date picker`);
            continue;
          }

          const toDate = getTodayLocal();

          // Update progress
          progressDialog.updateProgress(account.key, 'processing', 'Fetching balance history...');

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

          // Check if we have any data to upload
          if (!csvData) {
            // No balance data available (likely closed account with no recent history)
            stats.skipped += 1;
            progressDialog.updateProgress(account.key, 'skipped', 'No balance data available');
            debugLog(`Skipped account ${account.key} - no balance data available`);

            // Still mark pending_close accounts as closed even without data
            if (account.status === 'pending_close') {
              markAccountAsClosed(account.key);
              debugLog(`Marked pending_close account ${account.key} as closed (no data to upload)`);
            }
            continue;
          }

          // Check cancellation before upload
          if (isCancelled) break;

          // Upload to Monarch
          progressDialog.updateProgress(account.key, 'processing', 'Uploading to Monarch...');
          const uploadSuccess = await uploadBalanceToMonarch(account.key, csvData, fromDate, toDate);

          if (uploadSuccess) {
            // Update success stats and progress
            stats.success += 1;
            progressDialog.updateProgress(account.key, 'success', 'Upload complete');

            // If this was a pending_close account (in storage but not in API, not yet marked closed),
            // mark it as closed after successful full sync - this is the final sync for this account
            // Note: Already-closed accounts don't need to be re-marked
            if (account.status === 'pending_close') {
              markAccountAsClosed(account.key);
              debugLog(`Marked pending_close account ${account.key} as closed after successful full sync`);
            }
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
        toast.show('Upload process was cancelled', 'info');
      } else if (stats.success === stats.total) {
        toast.show(`Successfully uploaded full balance history for all ${stats.total} accounts!`, 'info');
      } else if (stats.success > 0) {
        const parts = [`${stats.success} successful`];
        if (stats.skipped > 0) parts.push(`${stats.skipped} skipped`);
        if (stats.failed > 0) parts.push(`${stats.failed} failed`);
        toast.show(`Upload completed: ${parts.join(', ')}`, stats.failed > 0 ? 'warning' : 'info');
      } else if (stats.skipped === stats.total) {
        toast.show('All accounts were skipped', 'info');
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
  extractBalanceChange,
  getAccountCreationDate,
  uploadFullBalanceHistoryForAccount,
  uploadFullBalanceHistoryForAllAccounts,
  getAccountsForSync,
  getActiveAccountCount,
  markAccountAsClosed,
  BalanceError,
};
