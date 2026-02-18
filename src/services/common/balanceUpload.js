/**
 * Balance Upload Service
 *
 * Generic balance CSV generation and upload logic for any integration.
 * Handles single-day balance uploads, balance history CSV generation,
 * and the common invertBalance pattern used by credit card integrations.
 *
 * @module services/common/balanceUpload
 */

import { debugLog, getTodayLocal, saveLastUploadDate } from '../../core/utils';
import monarchApi from '../../api/monarch';

/**
 * Generate CSV content for a single-day balance upload.
 *
 * @param {number} balance - Balance value (already adjusted for Monarch sign convention)
 * @param {string} accountName - Account display name for the CSV
 * @param {string} [date] - Date in YYYY-MM-DD format (defaults to today)
 * @returns {string} CSV content ready for Monarch upload
 */
export function generateBalanceCSV(balance, accountName, date) {
  const dateStr = date || getTodayLocal();
  let csvContent = '"Date","Total Equity","Account Name"\n';
  csvContent += `"${dateStr}","${balance}","${accountName}"\n`;
  return csvContent;
}

/**
 * Generate CSV content for a multi-day balance history upload.
 *
 * @param {Array<{date: string, amount: number}>} balanceHistory - Array of daily balance entries
 * @param {string} accountName - Account display name for the CSV
 * @returns {string} CSV content ready for Monarch upload
 */
export function generateBalanceHistoryCSV(balanceHistory, accountName) {
  let csvContent = '"Date","Total Equity","Account Name"\n';
  balanceHistory.forEach((entry) => {
    csvContent += `"${entry.date}","${entry.amount}","${accountName}"\n`;
  });
  return csvContent;
}

/**
 * Apply the invertBalance transformation to a raw balance value.
 *
 * Credit card integrations typically report balance as positive (amount owed),
 * but Monarch expects negative for liabilities. The default behavior negates the
 * balance. When invertBalance is enabled (for manual accounts), an additional
 * negation cancels the default, resulting in the original positive value.
 *
 * @param {number} rawBalance - Raw balance from the source institution
 * @param {boolean} invertBalance - Whether the invertBalance setting is enabled
 * @returns {number} Balance adjusted for Monarch's sign convention
 */
export function applyBalanceSign(rawBalance, invertBalance = false) {
  if (rawBalance === null || rawBalance === undefined) return null;
  // Default: negate (positive owed → Monarch negative liability)
  // invertBalance=true: additional negate cancels default → stays positive
  return invertBalance ? rawBalance : -rawBalance;
}

/**
 * Upload a single-day balance to Monarch.
 *
 * @param {Object} params - Upload parameters
 * @param {string} params.monarchAccountId - Monarch account ID
 * @param {number} params.balance - Balance value (already Monarch-adjusted)
 * @param {string} params.accountName - Account display name for CSV
 * @param {string} [params.date] - Date in YYYY-MM-DD format (defaults to today)
 * @returns {Promise<boolean>} True if upload succeeded
 */
export async function uploadSingleDayBalance({ monarchAccountId, balance, accountName, date }) {
  const dateStr = date || getTodayLocal();
  const balanceCSV = generateBalanceCSV(balance, accountName, dateStr);
  return monarchApi.uploadBalance(monarchAccountId, balanceCSV, dateStr, dateStr);
}

/**
 * Upload a multi-day balance history to Monarch.
 *
 * @param {Object} params - Upload parameters
 * @param {string} params.monarchAccountId - Monarch account ID
 * @param {Array<{date: string, amount: number}>} params.balanceHistory - Daily balance entries
 * @param {string} params.accountName - Account display name for CSV
 * @param {string} params.fromDate - Start date for the upload range
 * @param {string} params.toDate - End date for the upload range
 * @returns {Promise<boolean>} True if upload succeeded
 */
export async function uploadBalanceHistory({ monarchAccountId, balanceHistory, accountName, fromDate, toDate }) {
  const balanceCSV = generateBalanceHistoryCSV(balanceHistory, accountName);
  return monarchApi.uploadBalance(monarchAccountId, balanceCSV, fromDate, toDate);
}

/**
 * Execute the full balance upload step for a credit-card-style integration.
 *
 * Handles both first-sync (with optional balance reconstruction) and
 * subsequent single-day uploads. Manages invertBalance, progress updates,
 * and lastUploadDate persistence.
 *
 * @param {Object} params - Upload parameters
 * @param {string} params.integrationId - Integration identifier
 * @param {string} params.sourceAccountId - Source institution account ID
 * @param {string} params.monarchAccountId - Monarch account ID
 * @param {string} params.accountName - Display name for CSV
 * @param {number|null} params.currentBalance - Current raw balance from source
 * @param {boolean} params.invertBalance - Whether invertBalance setting is on
 * @param {boolean} params.isFirstSync - Whether this is the first sync
 * @param {boolean} params.reconstructBalance - Whether to reconstruct balance history
 * @param {Array<{date: string, amount: number}>|null} params.balanceHistory - Pre-built history (if reconstructing)
 * @param {string} params.fromDate - Start date for reconstruction range
 * @param {Object} [params.progressDialog] - Optional progress dialog
 * @returns {Promise<{success: boolean, message: string, monarchBalance: number|null}>} Upload result
 */
export async function executeBalanceUploadStep({
  integrationId,
  sourceAccountId,
  monarchAccountId,
  accountName,
  currentBalance,
  invertBalance = false,
  isFirstSync = false,
  reconstructBalance = false,
  balanceHistory = null,
  fromDate,
  progressDialog,
}) {
  const todayFormatted = getTodayLocal();
  const monarchBalance = applyBalanceSign(currentBalance, invertBalance);

  if (currentBalance === null || currentBalance === undefined) {
    if (progressDialog) {
      progressDialog.updateStepStatus(sourceAccountId, 'balance', 'skipped', 'Not available');
    }
    return { success: true, message: 'Not available', monarchBalance: null };
  }

  if (invertBalance) {
    debugLog(`[${integrationId}] Inverting balance (invertBalance setting enabled)`);
  }

  // First sync with balance reconstruction
  if (isFirstSync && reconstructBalance && balanceHistory && balanceHistory.length > 0) {
    if (progressDialog) {
      progressDialog.updateStepStatus(sourceAccountId, 'balance', 'processing', 'Uploading...');
    }

    const success = await uploadBalanceHistory({
      monarchAccountId,
      balanceHistory,
      accountName,
      fromDate: fromDate || balanceHistory[0].date,
      toDate: todayFormatted,
    });

    if (success) {
      saveLastUploadDate(sourceAccountId, todayFormatted, integrationId);
      if (progressDialog) {
        progressDialog.updateStepStatus(sourceAccountId, 'balance', 'success', `${balanceHistory.length} days`);
        progressDialog.updateBalanceChange(sourceAccountId, { newBalance: monarchBalance });
      }
      return { success: true, message: `${balanceHistory.length} days`, monarchBalance };
    }

    if (progressDialog) {
      progressDialog.updateStepStatus(sourceAccountId, 'balance', 'error', 'Upload failed');
    }
    return { success: false, message: 'Upload failed', monarchBalance };
  }

  // Empty balance history for first sync reconstruction
  if (isFirstSync && reconstructBalance && (!balanceHistory || balanceHistory.length === 0)) {
    if (progressDialog) {
      progressDialog.updateStepStatus(sourceAccountId, 'balance', 'skipped', 'No history data');
    }
    return { success: true, message: 'No history data', monarchBalance };
  }

  // Regular single-day balance upload
  const success = await uploadSingleDayBalance({
    monarchAccountId,
    balance: monarchBalance,
    accountName,
    date: todayFormatted,
  });

  if (success) {
    const formatted = `$${Math.abs(currentBalance).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    saveLastUploadDate(sourceAccountId, todayFormatted, integrationId);
    if (progressDialog) {
      progressDialog.updateStepStatus(sourceAccountId, 'balance', 'success', formatted);
      progressDialog.updateBalanceChange(sourceAccountId, { newBalance: monarchBalance });
    }
    return { success: true, message: formatted, monarchBalance };
  }

  if (progressDialog) {
    progressDialog.updateStepStatus(sourceAccountId, 'balance', 'error', 'Upload failed');
  }
  return { success: false, message: 'Upload failed', monarchBalance };
}

export default {
  generateBalanceCSV,
  generateBalanceHistoryCSV,
  applyBalanceSign,
  uploadSingleDayBalance,
  uploadBalanceHistory,
  executeBalanceUploadStep,
};