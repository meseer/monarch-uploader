/**
 * Wealthsimple Balance Service
 * Handles fetching, processing, and uploading balance history data
 */

import { debugLog, formatDate, parseLocalDate, getLookbackForInstitution } from '../../core/utils';
import { WEALTHSIMPLE_BALANCE_RECONSTRUCTION_TYPES } from '../../core/config';
import type { CurrentBalance, BalanceCheckpoint } from '../../types/monarch';
import type { ConsolidatedAccountBase } from '../../types/wealthsimple';
import stateManager from '../../core/state';
import wealthsimpleApi from '../../api/wealthsimple';
import monarchApi from '../../api/monarch';
import toast from '../../ui/toast';

export type { CurrentBalance, BalanceCheckpoint };

/**
 * Alias for the shared ConsolidatedAccountBase type.
 * balance.ts uses the base type from src/types/wealthsimple.ts,
 * breaking the former circular dependency with account.ts.
 */
type ConsolidatedAccount = ConsolidatedAccountBase;

export interface BalanceHistory {
  date: string;
  amount: number;
}

interface ProcessedTransactionForBalance {
  date?: string;
  amount?: number | null;
}

/**
 * Custom balance error class
 */
export class BalanceError extends Error {
  accountId: string | undefined;

  constructor(message: string, accountId?: string) {
    super(message);
    this.name = 'BalanceError';
    this.accountId = accountId;
  }
}

/**
 * Check if an account type requires balance reconstruction instead of API fetch
 * These account types don't support the FetchIdentityHistoricalFinancials API
 * Note: CASH accounts support transactions but get balance from API (no reconstruction needed)
 * @param accountType - Wealthsimple account type
 * @returns True if account needs balance reconstruction
 */
export function accountNeedsBalanceReconstruction(accountType: string): boolean {
  if (!accountType) return false;
  return WEALTHSIMPLE_BALANCE_RECONSTRUCTION_TYPES.has(accountType);
}

/**
 * Reconstruct balance history from transactions
 * Calculates daily ending balance by accumulating transaction amounts
 * Starting with specified balance (default 0) on fromDate
 *
 * @param transactions - Array of processed transactions with date and amount
 * @param fromDate - Start date in YYYY-MM-DD format
 * @param toDate - End date in YYYY-MM-DD format
 * @param startingBalance - Initial balance to start reconstruction from (default 0)
 * @returns Array of balance history objects {date, amount}
 */
export function reconstructBalanceFromTransactions(
  transactions: ProcessedTransactionForBalance[],
  fromDate: string,
  toDate: string,
  startingBalance = 0,
): BalanceHistory[] {
  if (!transactions || !Array.isArray(transactions)) {
    debugLog('No transactions provided for balance reconstruction');
    return [];
  }

  if (!fromDate || !toDate) {
    debugLog('Invalid date range for balance reconstruction');
    return [];
  }

  debugLog(`Reconstructing balance from ${transactions.length} transactions (${fromDate} to ${toDate}), starting balance: ${startingBalance}`);

  // Group transactions by date
  const transactionsByDate = new Map<string, ProcessedTransactionForBalance[]>();
  transactions.forEach((tx) => {
    if (!tx.date || tx.amount === undefined || tx.amount === null) return;

    const dateKey = tx.date;
    if (!transactionsByDate.has(dateKey)) {
      transactionsByDate.set(dateKey, []);
    }
    transactionsByDate.get(dateKey)!.push(tx);
  });

  debugLog(`Transactions grouped into ${transactionsByDate.size} unique dates`);

  // Generate all dates from fromDate to toDate
  const balanceHistory: BalanceHistory[] = [];
  let runningBalance = startingBalance;

  const fromDateObj = parseLocalDate(fromDate);
  const toDateObj = parseLocalDate(toDate);
  const currentDateObj = new Date(fromDateObj);

  while (currentDateObj <= toDateObj) {
    const dateStr = formatDate(currentDateObj);

    // Add all transactions for this date to the balance
    const dayTransactions = transactionsByDate.get(dateStr) || [];
    const dayTotal = dayTransactions.reduce((sum, tx) => sum + (tx.amount ?? 0), 0);
    runningBalance += dayTotal;

    // Record the end-of-day balance
    balanceHistory.push({
      date: dateStr,
      amount: Math.round(runningBalance * 100) / 100, // Round to 2 decimal places
    });

    // Move to next day
    currentDateObj.setDate(currentDateObj.getDate() + 1);
  }

  debugLog(`Reconstructed ${balanceHistory.length} daily balance records`);

  // Log first and last few records for debugging
  if (balanceHistory.length > 0) {
    debugLog('First balance record:', balanceHistory[0]);
    debugLog('Last balance record:', balanceHistory[balanceHistory.length - 1]);
  }

  return balanceHistory;
}

/**
 * Reconstruct balance history from a checkpoint
 * Uses checkpoint as starting point, applies transactions, and uses current balance for today
 *
 * @param transactions - Array of processed transactions with date and amount
 * @param checkpoint - Balance checkpoint {date, amount}
 * @param toDate - End date in YYYY-MM-DD format (today)
 * @param currentBalance - Current balance object {amount} for today
 * @returns Array of balance history objects {date, amount}
 */
export function reconstructBalanceFromCheckpoint(
  transactions: ProcessedTransactionForBalance[],
  checkpoint: BalanceCheckpoint,
  toDate: string,
  currentBalance: CurrentBalance | null | undefined,
): BalanceHistory[] {
  if (!checkpoint || !checkpoint.date || checkpoint.amount === undefined) {
    debugLog('Invalid checkpoint provided for balance reconstruction');
    return [];
  }

  if (!toDate) {
    debugLog('Invalid toDate for checkpoint reconstruction');
    return [];
  }

  debugLog(`Reconstructing balance from checkpoint: ${checkpoint.date} (${checkpoint.amount}) to ${toDate}`);

  // Special case: checkpoint date equals today (same-day re-sync)
  // Only return today's current balance to avoid duplicate dates
  if (checkpoint.date === toDate) {
    debugLog('Checkpoint date equals today, returning only current balance (same-day re-sync)');
    if (currentBalance && currentBalance.amount !== undefined) {
      return [{
        date: toDate,
        amount: currentBalance.amount,
      }];
    }
    return [];
  }

  // Reconstruct balance from checkpoint date to the day before today
  const yesterdayObj = parseLocalDate(toDate);
  yesterdayObj.setDate(yesterdayObj.getDate() - 1);
  const yesterday = formatDate(yesterdayObj);

  // If checkpoint date is yesterday, we only need checkpoint and today's balance
  if (checkpoint.date === yesterday) {
    debugLog('Checkpoint is from yesterday, returning checkpoint and current balance');
    const result: BalanceHistory[] = [];

    // Include checkpoint date balance
    result.push({
      date: checkpoint.date,
      amount: Math.round(checkpoint.amount * 100) / 100,
    });

    // Add today's current balance
    if (currentBalance && currentBalance.amount !== undefined) {
      result.push({
        date: toDate,
        amount: currentBalance.amount,
      });
    }

    return result;
  }

  // Reconstruct balance from checkpoint.date to yesterday
  const reconstructed = reconstructBalanceFromTransactions(
    transactions,
    checkpoint.date,
    yesterday,
    checkpoint.amount,
  );

  // Replace the first entry (checkpoint date) with the exact checkpoint amount
  // This ensures we don't double-count transactions on checkpoint day
  if (reconstructed.length > 0 && reconstructed[0].date === checkpoint.date) {
    reconstructed[0].amount = Math.round(checkpoint.amount * 100) / 100;
  }

  // Add today's current balance (not reconstructed, actual from API)
  if (currentBalance && currentBalance.amount !== undefined) {
    reconstructed.push({
      date: toDate,
      amount: currentBalance.amount,
    });
  }

  debugLog(`Checkpoint reconstruction completed: ${reconstructed.length} records`);
  return reconstructed;
}

/**
 * Calculate the checkpoint date based on lastSyncDate and lookback days
 * Ensures the date is not before account creation
 *
 * @param lastSyncDate - Last sync date in YYYY-MM-DD format
 * @param lookbackDays - Number of days to look back
 * @param accountCreatedAt - Account creation date (ISO timestamp or YYYY-MM-DD)
 * @returns Checkpoint date in YYYY-MM-DD format, or null
 */
export function calculateCheckpointDate(
  lastSyncDate: string,
  lookbackDays: number,
  accountCreatedAt?: string | null,
): string | null {
  if (!lastSyncDate) {
    debugLog('No lastSyncDate provided for checkpoint calculation');
    return null;
  }

  // Calculate checkpoint date: lastSyncDate - lookbackDays
  const checkpointDateObj = parseLocalDate(lastSyncDate);
  checkpointDateObj.setDate(checkpointDateObj.getDate() - lookbackDays);
  let checkpointDate = formatDate(checkpointDateObj);

  debugLog(`Calculated checkpoint date: ${checkpointDate} (${lastSyncDate} - ${lookbackDays} days)`);

  // Ensure checkpoint date is not before account creation
  if (accountCreatedAt) {
    const createdDateStr = extractDateFromISO(accountCreatedAt);
    if (createdDateStr) {
      const createdDateObj = parseLocalDate(createdDateStr);
      if (checkpointDateObj < createdDateObj) {
        checkpointDate = createdDateStr;
        debugLog(`Adjusted checkpoint date to account creation: ${checkpointDate}`);
      }
    }
  }

  return checkpointDate;
}

/**
 * Extract balance at a specific date from balance history array
 *
 * @param balanceHistory - Array of balance history objects {date, amount}
 * @param targetDate - Date to find balance for (YYYY-MM-DD)
 * @returns Balance amount at target date, or null if not found
 */
export function getBalanceAtDate(
  balanceHistory: BalanceHistory[],
  targetDate: string,
): number | null {
  if (!balanceHistory || !Array.isArray(balanceHistory) || !targetDate) {
    return null;
  }

  const entry = balanceHistory.find((item) => item.date === targetDate);
  return entry ? entry.amount : null;
}

/**
 * Create a single balance entry for the current day only
 * Used for subsequent syncs of credit card/cash accounts
 *
 * @param currentBalance - Current balance object {amount, currency}
 * @param toDate - Date in YYYY-MM-DD format
 * @returns Array with single balance history object {date, amount}
 */
export function createCurrentBalanceOnly(
  currentBalance: CurrentBalance | null | undefined,
  toDate: string,
): BalanceHistory[] {
  if (!currentBalance || currentBalance.amount === undefined) {
    debugLog('No current balance provided for single-day balance');
    return [];
  }

  if (!toDate) {
    debugLog('No date provided for single-day balance');
    return [];
  }

  const balanceHistory: BalanceHistory[] = [{
    date: toDate,
    amount: currentBalance.amount,
  }];

  debugLog(`Created single-day balance for ${toDate}: ${currentBalance.amount}`);
  return balanceHistory;
}

/**
 * Get default lookback days from settings
 * Reads from configStore first, falls back to legacy storage key
 */
function getLookbackDays(): number {
  return getLookbackForInstitution('wealthsimple');
}

/**
 * Extract YYYY-MM-DD date from ISO timestamp or date string
 * @param dateString - ISO timestamp or YYYY-MM-DD string
 * @returns YYYY-MM-DD formatted date, or null
 */
export function extractDateFromISO(dateString: string | null | undefined): string | null {
  if (!dateString) return null;

  // If already in YYYY-MM-DD format, return as-is
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    return dateString;
  }

  // Extract date part from ISO timestamp (e.g., "2025-02-18T21:16:55.685561Z" -> "2025-02-18")
  const match = dateString.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

/**
 * Get the appropriate date range for balance history
 * @param accountData - Consolidated account data
 * @returns Object with fromDate and toDate in YYYY-MM-DD format
 */
export function getDefaultDateRange(accountData: ConsolidatedAccount): { fromDate: string; toDate: string } {
  const today = new Date();
  const toDate = formatDate(today);

  const accountCreatedAt = accountData.wealthsimpleAccount?.createdAt;
  const lastSyncDate = accountData.lastSyncDate;

  // Determine start date
  let fromDate: string;

  if (lastSyncDate) {
    // Subsequent sync: use last sync date minus lookback days
    const lookbackDays = getLookbackDays();
    const startDate = parseLocalDate(lastSyncDate);
    startDate.setDate(startDate.getDate() - lookbackDays);
    fromDate = formatDate(startDate);

    // Ensure start date is not before account creation
    if (accountCreatedAt) {
      const createdDateStr = extractDateFromISO(accountCreatedAt);
      if (createdDateStr) {
        const createdDate = parseLocalDate(createdDateStr);
        const fromDateObj = parseLocalDate(fromDate);
        if (fromDateObj < createdDate) {
          fromDate = createdDateStr;
          debugLog(`Adjusted start date to account creation date: ${fromDate}`);
        }
      }
    }
  } else {
    // First sync: use account creation date to get complete history
    if (accountCreatedAt) {
      const createdDateStr = extractDateFromISO(accountCreatedAt);
      if (createdDateStr) {
        fromDate = createdDateStr;
        debugLog(`First sync: using account creation date ${fromDate} (extracted from ${accountCreatedAt})`);
      } else {
        // Fallback if date extraction fails
        const oneYearAgo = new Date(today);
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        fromDate = formatDate(oneYearAgo);
        debugLog(`Could not extract date from createdAt, defaulting to 1 year ago: ${fromDate}`);
      }
    } else {
      // Fallback if createdAt not available: use 1 year ago
      const oneYearAgo = new Date(today);
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      fromDate = formatDate(oneYearAgo);
      debugLog(`Account creation date not available, defaulting to 1 year ago: ${fromDate}`);
    }
  }

  return { fromDate, toDate };
}

/**
 * Merge balance history arrays, with newer data taking precedence
 * @param olderData - Array of balance history from older period (weekly data)
 * @param newerData - Array of balance history from recent period (daily data)
 * @returns Merged and sorted balance history
 */
function mergeBalanceData(olderData: BalanceHistory[], newerData: BalanceHistory[]): BalanceHistory[] {
  debugLog(`Merging balance data: ${olderData.length} older records + ${newerData.length} newer records`);

  // Use Map for O(1) lookup and automatic deduplication
  const balanceMap = new Map<string, BalanceHistory>();

  // Add older data first (weekly granularity)
  olderData.forEach((item) => {
    balanceMap.set(item.date, item);
  });

  // Add newer data (daily granularity) - overwrites any overlapping dates
  newerData.forEach((item) => {
    balanceMap.set(item.date, item);
  });

  // Convert back to sorted array
  const merged = Array.from(balanceMap.values())
    .sort((a, b) => a.date.localeCompare(b.date));

  debugLog(`Merged result: ${merged.length} total balance records`);
  return merged;
}

/**
 * Fetch balance history from Wealthsimple
 * Uses two-step strategy for accounts older than 1 year:
 * 1. Fetch all history (returns weekly data for periods > 1 year ago)
 * 2. Fetch recent year (returns daily data)
 * 3. Merge with daily data taking precedence
 *
 * @param accountId - Account ID to fetch balance for
 * @param currency - Currency code (e.g., 'CAD')
 * @param fromDate - Start date in YYYY-MM-DD format
 * @param toDate - End date in YYYY-MM-DD format
 * @returns Array of balance history objects
 */
export async function fetchBalanceHistory(
  accountId: string,
  currency: string,
  fromDate: string,
  toDate: string,
): Promise<BalanceHistory[]> {
  try {
    debugLog(`Fetching balance history for account ${accountId} from ${fromDate} to ${toDate}`);

    // Validate inputs
    if (!accountId) {
      throw new BalanceError('Account ID is required', accountId);
    }

    if (!currency) {
      throw new BalanceError('Currency is required', accountId);
    }

    if (!fromDate || !toDate) {
      throw new BalanceError('Invalid date range provided', accountId);
    }

    // Calculate date range span in days
    const fromDateObj = parseLocalDate(fromDate);
    const toDateObj = parseLocalDate(toDate);
    const daysDifference = Math.floor((toDateObj.getTime() - fromDateObj.getTime()) / (1000 * 60 * 60 * 24));

    debugLog(`Date range span: ${daysDifference} days`);

    // If range is > 1 year, use two-step fetch strategy
    if (daysDifference > 365) {
      debugLog('Range > 1 year detected, using two-step fetch strategy');

      // Calculate boundary date (1 year ago from toDate)
      const oneYearAgo = new Date(toDateObj);
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      const oneYearAgoDate = formatDate(oneYearAgo);

      debugLog(`Step 1: Fetching older data (weekly) from ${fromDate} to ${oneYearAgoDate}`);
      const olderData: BalanceHistory[] = await wealthsimpleApi.fetchBalanceHistory(
        [accountId],
        currency,
        fromDate,
        oneYearAgoDate,
      );
      debugLog(`Received ${olderData.length} older balance records (weekly granularity)`);

      debugLog(`Step 2: Fetching recent data (daily) from ${oneYearAgoDate} to ${toDate}`);
      const recentData: BalanceHistory[] = await wealthsimpleApi.fetchBalanceHistory(
        [accountId],
        currency,
        oneYearAgoDate,
        toDate,
      );
      debugLog(`Received ${recentData.length} recent balance records (daily granularity)`);

      // Merge the two datasets
      const mergedData = mergeBalanceData(olderData, recentData);

      if (!mergedData || mergedData.length === 0) {
        debugLog('No balance history data after merge');
        return [];
      }

      debugLog(`Final merged balance history: ${mergedData.length} records`);
      return mergedData;
    }

    // For ranges <= 1 year, use single fetch (daily data)
    debugLog('Range <= 1 year, using single fetch (daily data)');
    const balanceHistory: BalanceHistory[] = await wealthsimpleApi.fetchBalanceHistory(
      [accountId],
      currency,
      fromDate,
      toDate,
    );

    if (!balanceHistory || balanceHistory.length === 0) {
      debugLog('No balance history data returned from API');
      return [];
    }

    debugLog(`Received ${balanceHistory.length} balance history records`);
    return balanceHistory;
  } catch (error: unknown) {
    debugLog(`Error fetching balance history for account ${accountId}:`, error);
    if (error instanceof BalanceError) {
      throw error;
    }
    const msg = error instanceof Error ? error.message : String(error);
    throw new BalanceError(`Failed to fetch balance history: ${msg}`, accountId);
  }
}

/**
 * Process balance data into CSV format for Monarch
 * @param balanceHistory - Array of balance history objects
 * @param accountName - Account name for CSV output
 * @returns CSV formatted data
 */
export function processBalanceData(balanceHistory: BalanceHistory[], accountName: string): string {
  try {
    if (!balanceHistory || !Array.isArray(balanceHistory)) {
      throw new Error('Invalid balance history data provided');
    }

    if (!accountName) {
      throw new Error('Account name is required');
    }

    // Initialize CSV with header
    let csvContent = '"Date","Total Equity","Account Name"\n';

    // Add historical data
    balanceHistory.forEach((item) => {
      const date = item.date || '';
      // Use explicit check for undefined to handle zero amounts correctly
      const amount = item.amount !== undefined ? item.amount : '';
      csvContent += `"${date}","${amount}","${accountName}"\n`;
    });

    return csvContent;
  } catch (error: unknown) {
    debugLog('Error processing balance data:', error);
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to process balance data: ${msg}`);
  }
}

/**
 * Upload balance history to Monarch
 * Note: lastSyncDate is NOT updated here - it's only updated in wealthsimple-upload.js
 * when BOTH balance and transactions succeed.
 * @param accountId - Wealthsimple account ID
 * @param monarchAccountId - Monarch account ID
 * @param csvData - CSV data to upload
 * @param fromDate - Start date in YYYY-MM-DD format
 * @param toDate - End date in YYYY-MM-DD format
 * @returns Success status
 */
export async function uploadBalanceToMonarch(
  accountId: string,
  monarchAccountId: string,
  csvData: string,
  fromDate: string,
  toDate: string,
): Promise<boolean> {
  try {
    debugLog(`Uploading balance for account ${accountId} from ${fromDate} to ${toDate}`);

    if (!csvData) {
      throw new BalanceError('No CSV data to upload', accountId);
    }

    // Get account name from state
    const accountName = stateManager.getState().currentAccount?.nickname || 'Unknown Account';

    // Upload using Monarch API
    const success = await monarchApi.uploadBalance(monarchAccountId, csvData, fromDate, toDate);

    if (success) {
      debugLog(`Successfully uploaded ${accountName} balance history to Monarch`);
    }

    return success;
  } catch (error: unknown) {
    debugLog(`Error uploading balance for account ${accountId}:`, error);
    if (error instanceof BalanceError) {
      throw error;
    }
    const msg = error instanceof Error ? error.message : String(error);
    throw new BalanceError(`Failed to upload balance: ${msg}`, accountId);
  }
}

/**
 * Account types where balance can never be negative
 * These accounts will have negative balance entries filtered out
 */
const NON_NEGATIVE_BALANCE_ACCOUNT_TYPES = new Set(['CASH', 'CASH_USD']);

/**
 * Filter out invalid balance entries for account types that cannot have negative balances
 * Also ensures today's balance uses the actual current balance from API
 * @param balanceHistory - Array of balance history objects {date, amount}
 * @param accountType - Account type (e.g., 'CASH', 'CASH_USD')
 * @param currentBalance - Current balance object {amount, currency} for today
 * @param toDate - End date (today) in YYYY-MM-DD format
 * @returns Filtered balance history
 */
export function filterInvalidBalanceEntries(
  balanceHistory: BalanceHistory[],
  accountType: string,
  currentBalance: CurrentBalance | null | undefined,
  toDate: string,
): BalanceHistory[] {
  if (!balanceHistory || !Array.isArray(balanceHistory)) {
    return [];
  }

  // Only filter for account types that cannot have negative balances
  if (!NON_NEGATIVE_BALANCE_ACCOUNT_TYPES.has(accountType)) {
    // For other account types, just ensure today's balance is correct
    if (currentBalance && currentBalance.amount !== undefined && toDate) {
      return ensureTodayBalance(balanceHistory, currentBalance, toDate);
    }
    return balanceHistory;
  }

  debugLog(`Filtering invalid balance entries for ${accountType} account`);

  // Filter out negative balance entries (invalid for CASH accounts)
  let filtered = balanceHistory.filter((entry) => {
    if (entry.amount < 0) {
      debugLog(`Removing invalid negative balance entry: ${entry.date} = ${entry.amount}`);
      return false;
    }
    return true;
  });

  // Ensure today's balance uses the current balance from API
  if (currentBalance && currentBalance.amount !== undefined && toDate) {
    filtered = ensureTodayBalance(filtered, currentBalance, toDate);
  }

  debugLog(`Filtered balance history: ${balanceHistory.length} -> ${filtered.length} entries`);
  return filtered;
}

/**
 * Ensure today's balance entry uses the correct current balance from API
 * @param balanceHistory - Array of balance history objects
 * @param currentBalance - Current balance object {amount, currency}
 * @param toDate - Today's date in YYYY-MM-DD format
 * @returns Balance history with correct today's balance
 */
function ensureTodayBalance(
  balanceHistory: BalanceHistory[],
  currentBalance: CurrentBalance,
  toDate: string,
): BalanceHistory[] {
  if (!balanceHistory || !currentBalance || currentBalance.amount === undefined || !toDate) {
    return balanceHistory || [];
  }

  // Find if today's entry exists
  const todayIndex = balanceHistory.findIndex((entry) => entry.date === toDate);

  if (todayIndex >= 0) {
    // Update existing entry with correct balance
    const existingAmount = balanceHistory[todayIndex].amount;
    if (existingAmount !== currentBalance.amount) {
      debugLog(`Correcting today's balance: ${existingAmount} -> ${currentBalance.amount}`);
      balanceHistory[todayIndex] = {
        ...balanceHistory[todayIndex],
        amount: currentBalance.amount,
      };
    }
  } else {
    // Add today's entry
    debugLog(`Adding today's balance entry: ${toDate} = ${currentBalance.amount}`);
    balanceHistory.push({
      date: toDate,
      amount: currentBalance.amount,
    });
    // Sort by date to maintain order
    balanceHistory.sort((a, b) => a.date.localeCompare(b.date));
  }

  return balanceHistory;
}

/**
 * Complete process to fetch, process and upload balance history for an account
 * @param consolidatedAccount - Consolidated account object
 * @param monarchAccountId - Monarch account ID
 * @param fromDate - Start date in YYYY-MM-DD format
 * @param toDate - End date in YYYY-MM-DD format
 * @param currentBalance - Current balance from FetchAccountCombinedFinancialsPreload (optional)
 * @returns Success status
 */
export async function processAndUploadBalance(
  consolidatedAccount: ConsolidatedAccount,
  monarchAccountId: string,
  fromDate: string,
  toDate: string,
  currentBalance: CurrentBalance | null = null,
): Promise<boolean> {
  try {
    const account = consolidatedAccount.wealthsimpleAccount;
    const accountId = account.id;
    const wealthsimpleAccountName = account.nickname || accountId;

    // Use Monarch account name for CSV, fallback to Wealthsimple name if Monarch account not mapped
    const monarchAccountName = consolidatedAccount.monarchAccount?.displayName || wealthsimpleAccountName;

    if (!accountId) {
      throw new BalanceError('Account information missing', accountId);
    }

    // Set current account in state (using Wealthsimple name for logging)
    stateManager.setAccount(accountId, wealthsimpleAccountName);

    // Step 1: Fetch balance history
    debugLog(`Fetching balance history for ${wealthsimpleAccountName} (Monarch: ${monarchAccountName})...`);
    let balanceHistory = await fetchBalanceHistory(
      accountId,
      account.currency!,
      fromDate,
      toDate,
    );

    if (!balanceHistory || balanceHistory.length === 0) {
      debugLog('No balance history data available');
      toast.show(`No balance history data available for ${wealthsimpleAccountName}`, 'warning');
      return false;
    }

    // Step 1.5: Filter invalid balance entries and ensure today's balance is correct
    // For CASH/CASH_USD accounts, this removes negative balances (impossible for these account types)
    // and ensures today's balance uses the accurate current balance from FetchAccountCombinedFinancialsPreload
    const accountType = account.type || '';
    balanceHistory = filterInvalidBalanceEntries(balanceHistory, accountType, currentBalance, toDate);

    if (!balanceHistory || balanceHistory.length === 0) {
      debugLog('No valid balance history data after filtering');
      toast.show(`No valid balance history data for ${wealthsimpleAccountName}`, 'warning');
      return false;
    }

    // Step 2: Process the data - use Monarch account name in CSV
    const csvData = processBalanceData(balanceHistory, monarchAccountName);

    // Log the CSV content for debugging
    debugLog(`Generated CSV for ${monarchAccountName} (${csvData.split('\n').length - 1} lines including header):`);
    debugLog(csvData);

    // Step 3: Upload to Monarch
    debugLog(`Uploading ${monarchAccountName} balance history to Monarch...`);
    const success = await uploadBalanceToMonarch(
      accountId,
      monarchAccountId,
      csvData,
      fromDate,
      toDate,
    );

    // Step 4: Show result notification
    if (success) {
      toast.show(`Successfully uploaded ${wealthsimpleAccountName} balance history to Monarch`, 'info');
      return true;
    }

    toast.show(`Failed to upload ${wealthsimpleAccountName} balance history to Monarch`, 'error');
    return false;
  } catch (error: unknown) {
    const account = consolidatedAccount.wealthsimpleAccount;
    const errorMessage = error instanceof BalanceError
      ? error.message
      : `Error processing account: ${error instanceof Error ? error.message : String(error)}`;
    toast.show(errorMessage, 'error');
    debugLog(`Error in processAndUploadBalance for ${account.id}:`, error);
    return false;
  }
}

export default {
  fetchBalanceHistory,
  processBalanceData,
  getDefaultDateRange,
  uploadBalanceToMonarch,
  processAndUploadBalance,
  accountNeedsBalanceReconstruction,
  reconstructBalanceFromTransactions,
  reconstructBalanceFromCheckpoint,
  calculateCheckpointDate,
  getBalanceAtDate,
  createCurrentBalanceOnly,
  BalanceError,
};
