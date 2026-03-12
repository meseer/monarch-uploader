/**
 * Wealthsimple Upload Service
 * Handles uploading Wealthsimple account data to Monarch
 */

import { debugLog, getLookbackForInstitution, getTodayLocal } from '../core/utils';
import type { CurrentBalance } from '../types/monarch';
import { WEALTHSIMPLE_TRANSACTION_SUPPORTED_TYPES, WEALTHSIMPLE_PENDING_RECONCILIATION_TYPES } from '../core/config';
import toast from '../ui/toast';
import wealthsimpleApi from '../api/wealthsimple';
import {
  resolveWealthsimpleAccountMapping,
  uploadWealthsimpleBalance,
  uploadWealthsimpleTransactions,
  markAccountAsSkipped,
  syncAccountListWithAPI,
  getAccountData,
  updateAccountInList,
  applyTransactionRetentionEviction,
  syncCreditLimit,
  type ConsolidatedAccount,
} from './wealthsimple/account';
import {
  getDefaultDateRange,
  extractDateFromISO,
  accountNeedsBalanceReconstruction,
  calculateCheckpointDate,
  getBalanceAtDate,
  reconstructBalanceFromTransactions,
} from './wealthsimple/balance';
import { isInvestmentAccount, processAccountPositions, processCashPositions } from './wealthsimple/positions';
import { fetchAndProcessTransactions, reconcilePendingTransactions, formatReconciliationMessage } from './wealthsimple/transactions';
import { type ReconciliationResult } from './wealthsimple/transactionsReconciliation';
import { showDatePickerWithOptionsPromise } from '../ui/components/datePicker';
import { showProgressDialog } from '../ui/components/progressDialog';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SyncResult {
  success: boolean;
  skipped?: boolean;
  cancelled?: boolean;
}

export interface ProgressDialog {
  updateStepStatus: (accountId: string, step: string, status: string, message: string) => void;
  updateBalanceChange: (accountId: string, data: Record<string, unknown>) => void;
  initSteps: (accountId: string, steps: Array<{ key: string; name: string }>) => void;
  onCancel: (cb: () => void) => void;
  showSummary: (stats: { success: number; failed: number; skipped: number }) => void;
  hideCancel: () => void;
  close: () => void;
}

interface BalanceChangeResult {
  oldBalance: number;
  newBalance: number;
  lastUploadDate: string;
  changePercent: number;
  accountType?: string;
  transactionCount?: number;
  daysUploaded?: number;
}

// ── Private helpers ───────────────────────────────────────────────────────────

/**
 * Create a balance checkpoint after first sync with reconstruction
 */
async function createBalanceCheckpoint(accountId: string, fromDate: string, toDate: string): Promise<boolean> {
  try {
    const accountData = getAccountData(accountId);
    if (!accountData) {
      debugLog(`Cannot create checkpoint: account ${accountId} not found`);
      return false;
    }

    const account = accountData.wealthsimpleAccount;
    const lookbackDays = getLookbackForInstitution('wealthsimple') as number;

    const checkpointDate = calculateCheckpointDate(toDate, lookbackDays, account.createdAt as string | undefined) as string | null;

    if (!checkpointDate) {
      debugLog('Failed to calculate checkpoint date');
      return false;
    }

    const transactions = await fetchAndProcessTransactions(accountData, fromDate, toDate, { skipCategorization: true }) as Array<{ date: string; amount: number }> | null;

    const balanceHistory = reconstructBalanceFromTransactions(transactions || [], fromDate, toDate, 0) as Array<{ date: string; amount: number }>;

    const checkpointBalance = getBalanceAtDate(balanceHistory, checkpointDate) as number | null;

    if (checkpointBalance === null) {
      debugLog(`Could not find balance at checkpoint date ${checkpointDate}`);
      return false;
    }

    updateAccountInList(accountId, {
      balanceCheckpoint: {
        date: checkpointDate,
        amount: checkpointBalance,
      },
    });

    debugLog(`Created balance checkpoint for account ${accountId}: ${checkpointDate} = ${checkpointBalance}`);
    return true;
  } catch (error: unknown) {
    debugLog('Error creating balance checkpoint:', error);
    return false;
  }
}

/**
 * Update balance checkpoint after subsequent sync
 */
async function updateBalanceCheckpoint(accountId: string, toDate: string, _currentBalance: CurrentBalance | null): Promise<boolean> {
  try {
    const accountData = getAccountData(accountId);
    if (!accountData) {
      debugLog(`Cannot update checkpoint: account ${accountId} not found`);
      return false;
    }

    const account = accountData.wealthsimpleAccount;
    const existingCheckpoint = accountData.balanceCheckpoint;

    if (!existingCheckpoint) {
      debugLog(`No existing checkpoint for account ${accountId}, cannot update`);
      return false;
    }

    const lookbackDays = getLookbackForInstitution('wealthsimple') as number;

    const newCheckpointDate = calculateCheckpointDate(toDate, lookbackDays, account.createdAt as string | undefined) as string | null;

    if (!newCheckpointDate) {
      debugLog('Failed to calculate new checkpoint date');
      return false;
    }

    const transactions = await fetchAndProcessTransactions(accountData, existingCheckpoint.date, toDate, { skipCategorization: true }) as Array<{ date: string; amount: number }> | null;

    const balanceHistory = reconstructBalanceFromTransactions(
      transactions || [],
      existingCheckpoint.date,
      toDate,
      existingCheckpoint.amount,
    ) as Array<{ date: string; amount: number }>;

    let newCheckpointBalance = getBalanceAtDate(balanceHistory, newCheckpointDate) as number | null;

    if (newCheckpointBalance === null) {
      debugLog(`Could not find balance at new checkpoint date ${newCheckpointDate}, using last reconstructed value`);
      if (balanceHistory && balanceHistory.length > 0) {
        const closestEntry = balanceHistory.find((entry) => entry.date <= newCheckpointDate);
        if (closestEntry) {
          newCheckpointBalance = closestEntry.amount;
        }
      }
    }

    if (newCheckpointBalance === null) {
      debugLog('Failed to determine new checkpoint balance');
      return false;
    }

    updateAccountInList(accountId, {
      balanceCheckpoint: {
        date: newCheckpointDate,
        amount: newCheckpointBalance,
      },
    });

    debugLog(`Updated balance checkpoint for account ${accountId}: ${newCheckpointDate} = ${newCheckpointBalance}`);
    return true;
  } catch (error: unknown) {
    debugLog('Error updating balance checkpoint:', error);
    return false;
  }
}

/**
 * Check if this is the first sync for an account that needs balance reconstruction
 */
function isFirstSyncNonInvestment(consolidatedAccount: ConsolidatedAccount): boolean {
  const account = consolidatedAccount.wealthsimpleAccount;
  const accountType = account?.type || '';

  if (!accountNeedsBalanceReconstruction(accountType)) {
    return false;
  }

  const hasLastSyncDate = Boolean(consolidatedAccount.lastSyncDate);
  const hasUploadedTransactions = consolidatedAccount.uploadedTransactions && consolidatedAccount.uploadedTransactions.length > 0;

  return !hasLastSyncDate && !hasUploadedTransactions;
}

/**
 * Extract balance change information for a Wealthsimple account
 */
function extractWealthsimpleBalanceChange(
  consolidatedAccount: ConsolidatedAccount,
  currentBalance: CurrentBalance | null,
): BalanceChangeResult | null {
  try {
    if (!currentBalance || currentBalance.amount === undefined || currentBalance.amount === null) {
      debugLog(`No current balance found for Wealthsimple account ${consolidatedAccount.wealthsimpleAccount?.id}`);
      return null;
    }

    const checkpoint = consolidatedAccount.balanceCheckpoint;
    if (!checkpoint || checkpoint.amount === undefined || checkpoint.amount === null) {
      const lastSyncDate = consolidatedAccount.lastSyncDate;
      if (!lastSyncDate) {
        debugLog(`No balance checkpoint or lastSyncDate found for Wealthsimple account ${consolidatedAccount.wealthsimpleAccount?.id}`);
        return null;
      }
      return null;
    }

    const oldBalance = checkpoint.amount;
    const compareDate = checkpoint.date;
    const newBalance = currentBalance.amount;

    const changePercent = oldBalance !== 0
      ? ((newBalance - oldBalance) / Math.abs(oldBalance)) * 100
      : 0;

    debugLog(`Balance change for Wealthsimple account ${consolidatedAccount.wealthsimpleAccount?.id}: ${oldBalance} (${compareDate}) -> ${newBalance} (${changePercent.toFixed(2)}%)`);

    return {
      oldBalance,
      newBalance,
      lastUploadDate: compareDate,
      changePercent,
    };
  } catch (error: unknown) {
    debugLog('Error extracting balance change for Wealthsimple account:', error);
    return null;
  }
}

/**
 * Calculate number of days between two dates
 */
function calculateDaysBetween(fromDate: string, toDate: string): number {
  const from = new Date(fromDate);
  const to = new Date(toDate);
  const diffTime = Math.abs(to.getTime() - from.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
}

/**
 * Format transaction count message for display in step status
 */
function formatTransactionCountMessage(synced: number, skipped: number): string {
  const parts: string[] = [];

  if (synced > 0) {
    parts.push(`${synced} synced`);
  }

  if (skipped > 0) {
    parts.push(`${skipped} skipped`);
  }

  if (parts.length === 0) {
    return 'No transactions';
  }

  return parts.join(', ');
}

/**
 * Format balance message for display in step status
 */
function formatBalanceMessage(balance: number | undefined | null, daysUploaded: number): string {
  const parts: string[] = [];

  if (balance !== undefined && balance !== null) {
    const formattedBalance = `$${Math.abs(balance).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    parts.push(formattedBalance);
  }

  if (daysUploaded && daysUploaded > 1) {
    parts.push(`${daysUploaded} days`);
  }

  return parts.length > 0 ? parts.join(' | ') : 'Uploaded';
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Upload a single Wealthsimple account to Monarch
 */
export async function uploadWealthsimpleAccountToMonarch(
  consolidatedAccount: ConsolidatedAccount,
  fromDate: string,
  toDate: string,
  currentBalance: CurrentBalance | null = null,
): Promise<SyncResult | boolean> {
  try {
    const account = consolidatedAccount.wealthsimpleAccount;
    debugLog(`Uploading Wealthsimple account ${account.id} to Monarch...`);

    const result = await resolveWealthsimpleAccountMapping(consolidatedAccount, currentBalance);

    if (result && (result as { skipped?: boolean }).skipped) {
      debugLog(`User skipped account ${account.id}`);
      markAccountAsSkipped(account.id, true);
      toast.show(`Skipped ${account.nickname || account.id}`, 'debug');
      return { success: false, skipped: true };
    }

    if (result && (result as { cancelled?: boolean }).cancelled) {
      debugLog('User cancelled sync');
      return { success: false, cancelled: true };
    }

    if (!result) {
      debugLog('Account mapping cancelled by user');
      return { success: false, cancelled: true };
    }

    const monarchAccount = result as { id: string; displayName: string; [key: string]: unknown };

    let actualFromDate = fromDate;
    let reconstructBalance = false;

    if (isFirstSyncNonInvestment(consolidatedAccount)) {
      debugLog('First sync for non-investment account detected, showing date picker with reconstruction option');

      const accountCreatedAt = account.createdAt as string | undefined;
      let defaultDate = fromDate;

      if (accountCreatedAt) {
        const createdDateStr = extractDateFromISO(accountCreatedAt) as string | null;
        if (createdDateStr) {
          defaultDate = createdDateStr;
          debugLog(`Using account creation date as default: ${defaultDate} (from ${accountCreatedAt})`);
        }
      }

      const datePickerResult = await showDatePickerWithOptionsPromise(
        defaultDate,
        `Select the start date for syncing "${account.nickname || account.id}". Default is the account creation date.`,
        {
          showReconstructCheckbox: true,
          reconstructCheckedByDefault: true,
        },
      ) as { date: string; reconstructBalance: boolean } | null;

      if (!datePickerResult) {
        debugLog('User cancelled date selection');
        toast.show('Sync cancelled', 'info');
        return { success: false, cancelled: true };
      }

      actualFromDate = datePickerResult.date;
      reconstructBalance = datePickerResult.reconstructBalance;
      debugLog(`User selected start date: ${actualFromDate}, reconstruct balance: ${reconstructBalance}`);
    }

    const balanceSuccess = await uploadWealthsimpleBalance(
      account.id,
      monarchAccount.id,
      actualFromDate,
      toDate,
      currentBalance,
      reconstructBalance,
    );

    const transactionsSuccess = await uploadWealthsimpleTransactions(
      account.id,
      monarchAccount.id,
      actualFromDate,
      toDate,
    );

    const success = balanceSuccess || (transactionsSuccess as { success?: boolean })?.success;

    if (success) {
      if (balanceSuccess && (transactionsSuccess as { success?: boolean })?.success) {
        updateAccountInList(account.id, { lastSyncDate: toDate });
        debugLog(`Updated lastSyncDate for account ${account.id} to ${toDate}`);

        if (accountNeedsBalanceReconstruction(account.type as string) && reconstructBalance) {
          await createBalanceCheckpoint(account.id, actualFromDate, toDate);
        } else if (accountNeedsBalanceReconstruction(account.type as string) && consolidatedAccount.balanceCheckpoint) {
          await updateBalanceCheckpoint(account.id, toDate, currentBalance);
        }
      }

      const updatedConsolidatedAccount = getAccountData(account.id);
      if (updatedConsolidatedAccount) {
        await syncCreditLimit(updatedConsolidatedAccount, monarchAccount.id);
      }

      applyTransactionRetentionEviction(account.id);

      toast.show(`Processed ${account.nickname || account.id}`, 'debug');
    }

    return success ? true : false;
  } catch (error: unknown) {
    const account = consolidatedAccount.wealthsimpleAccount;
    debugLog(`Error uploading Wealthsimple account ${account.id}:`, error);
    toast.show(`Error uploading account: ${(error as Error).message}`, 'error');
    return false;
  }
}

/**
 * Build the list of sync steps for a Wealthsimple account
 */
export function buildSyncStepsForAccount(consolidatedAccount: ConsolidatedAccount): Array<{ key: string; name: string }> {
  const steps: Array<{ key: string; name: string }> = [];
  const accountType = consolidatedAccount.wealthsimpleAccount?.type || '';

  if (WEALTHSIMPLE_TRANSACTION_SUPPORTED_TYPES.has(accountType)) {
    steps.push({ key: 'transactions', name: 'Transaction sync' });
  }

  if (WEALTHSIMPLE_PENDING_RECONCILIATION_TYPES.has(accountType)) {
    steps.push({ key: 'pendingReconciliation', name: 'Pending reconciliation' });
  }

  if (accountType === 'CREDIT_CARD') {
    steps.push({ key: 'creditLimit', name: 'Credit limit sync' });
  }

  steps.push({ key: 'balance', name: 'Balance upload' });

  if (isInvestmentAccount(accountType)) {
    steps.push({ key: 'positions', name: 'Position sync' });
  }

  if (isInvestmentAccount(accountType)) {
    steps.push({ key: 'cashSync', name: 'Cash sync' });
  }

  return steps;
}

/**
 * Upload all Wealthsimple accounts to Monarch
 */
export async function uploadAllWealthsimpleAccountsToMonarch(): Promise<void> {
  let progressDialog: ProgressDialog | null = null;
  let isCancelled = false;

  try {
    debugLog('Starting fetch of all Wealthsimple accounts...');

    const accounts = await syncAccountListWithAPI();

    if (!accounts || accounts.length === 0) {
      toast.show('No Wealthsimple accounts found', 'debug');
      return;
    }

    const accountsToSync = accounts.filter((acc) => acc.syncEnabled !== false);
    const skippedCount = accounts.length - accountsToSync.length;

    if (skippedCount > 0) {
      debugLog(`Skipping ${skippedCount} account(s) marked as skipped`);
    }

    if (accountsToSync.length === 0) {
      toast.show('All accounts are marked as skipped', 'debug');
      return;
    }

    debugLog(`Processing ${accountsToSync.length} Wealthsimple account(s):`, accountsToSync);

    const accountsForDialog = accountsToSync.map((acc) => ({
      key: acc.wealthsimpleAccount.id,
      nickname: acc.wealthsimpleAccount.nickname,
      name: acc.wealthsimpleAccount.nickname || acc.wealthsimpleAccount.id,
    }));

    progressDialog = showProgressDialog(accountsForDialog, 'Uploading Wealthsimple Accounts to Monarch') as ProgressDialog;

    progressDialog.onCancel(() => {
      debugLog('Upload cancellation requested');
      isCancelled = true;
      toast.show('Upload cancelled by user', 'info');
    });

    const accountsForBalanceFetch = accountsToSync.map((acc) => ({
      id: acc.wealthsimpleAccount.id,
      type: acc.wealthsimpleAccount.type,
      currency: (acc.wealthsimpleAccount as { currency?: string }).currency,
    }));
    debugLog('Fetching balances for all accounts...');
    const balanceResult = (await wealthsimpleApi.fetchAccountBalances(accountsForBalanceFetch)) as {
      success: boolean;
      error?: string;
      balances: Map<string, CurrentBalance | null>;
    };

    if (!balanceResult.success) {
      debugLog('Failed to fetch account balances:', balanceResult.error);
      toast.show('Failed to fetch account balances. Please try again.', 'error');
      progressDialog.hideCancel();
      progressDialog.close();
      return;
    }

    const stats = { success: 0, failed: 0, total: accountsToSync.length };
    let skippedDuringSync = 0;
    let balanceUnavailableCount = 0;

    for (const consolidatedAccount of accountsToSync) {
      if (isCancelled) {
        debugLog('Upload cancelled, stopping account processing');
        break;
      }

      const account = consolidatedAccount.wealthsimpleAccount;

      const steps = buildSyncStepsForAccount(consolidatedAccount);
      progressDialog.initSteps(account.id, steps);

      const currentBalance = balanceResult.balances.get(account.id);

      if (currentBalance === null || currentBalance === undefined) {
        debugLog(`Skipping account ${account.id} (${account.nickname}) - balance unavailable`);
        progressDialog.updateStepStatus(account.id, 'balance', 'error', 'Balance unavailable');
        balanceUnavailableCount += 1;
        continue;
      }

      const { fromDate, toDate } = getDefaultDateRange(consolidatedAccount) as { fromDate: string; toDate: string };
      debugLog(`Using date range for ${account.nickname}: ${fromDate} to ${toDate}`);

      if (isCancelled) break;

      const result = await uploadWealthsimpleAccountToMonarchWithSteps(
        consolidatedAccount,
        fromDate,
        toDate,
        currentBalance,
        progressDialog,
      );

      if (result && result.cancelled) {
        debugLog('Sync cancelled by user, stopping processing');
        isCancelled = true;
        break;
      }

      if (result && result.skipped) {
        skippedDuringSync += 1;
        continue;
      }

      if (result && result.success) {
        stats.success += 1;
      } else {
        stats.failed += 1;
      }
    }

    const totalSkipped = skippedCount + skippedDuringSync;
    const totalFailed = stats.failed + balanceUnavailableCount;
    progressDialog.showSummary({
      success: stats.success,
      failed: totalFailed,
      skipped: totalSkipped,
    });
    progressDialog.hideCancel();

    if (isCancelled) {
      toast.show('Upload process was cancelled', 'info');
    } else if (totalFailed === 0 && totalSkipped === 0) {
      toast.show(`Successfully uploaded all ${stats.success} Wealthsimple account(s)`, 'info');
    } else if (stats.success > 0) {
      const parts: string[] = [];
      if (stats.success > 0) parts.push(`${stats.success} uploaded`);
      if (stats.failed > 0) parts.push(`${stats.failed} failed`);
      if (balanceUnavailableCount > 0) parts.push(`${balanceUnavailableCount} balance unavailable`);
      if (totalSkipped > 0) parts.push(`${totalSkipped} skipped`);
      toast.show(parts.join(', '), totalFailed > 0 ? 'warning' : 'info');
    }
  } catch (error: unknown) {
    debugLog('Error fetching Wealthsimple accounts:', error);
    toast.show(`Error fetching accounts: ${(error as Error).message}`, 'error');

    if (progressDialog) {
      progressDialog.hideCancel();
    }
  }
}

/**
 * Upload a single Wealthsimple account to Monarch with step-by-step progress tracking
 */
export async function uploadWealthsimpleAccountToMonarchWithSteps(
  consolidatedAccount: ConsolidatedAccount,
  fromDate: string,
  toDate: string,
  currentBalance: CurrentBalance,
  progressDialog: ProgressDialog,
): Promise<SyncResult> {
  const account = consolidatedAccount.wealthsimpleAccount;
  const accountType = account?.type || '';

  try {
    debugLog(`Uploading Wealthsimple account ${account.id} to Monarch with step tracking...`);

    const mappingResult = await resolveWealthsimpleAccountMapping(consolidatedAccount, currentBalance);

    if (mappingResult && (mappingResult as { skipped?: boolean }).skipped) {
      debugLog(`User skipped account ${account.id}`);
      markAccountAsSkipped(account.id, true);
      const firstStep = WEALTHSIMPLE_TRANSACTION_SUPPORTED_TYPES.has(accountType) ? 'transactions' : 'balance';
      progressDialog.updateStepStatus(account.id, firstStep, 'skipped', 'Skipped by user');
      return { success: false, skipped: true };
    }

    if (mappingResult && (mappingResult as { cancelled?: boolean }).cancelled) {
      debugLog('User cancelled sync');
      const firstStep = WEALTHSIMPLE_TRANSACTION_SUPPORTED_TYPES.has(accountType) ? 'transactions' : 'balance';
      progressDialog.updateStepStatus(account.id, firstStep, 'error', 'Cancelled');
      return { success: false, cancelled: true };
    }

    if (!mappingResult) {
      debugLog('Account mapping cancelled by user');
      const firstStep = WEALTHSIMPLE_TRANSACTION_SUPPORTED_TYPES.has(accountType) ? 'transactions' : 'balance';
      progressDialog.updateStepStatus(account.id, firstStep, 'error', 'Cancelled');
      return { success: false, cancelled: true };
    }

    const monarchAccount = mappingResult as { id: string; displayName: string; isManual?: boolean; manualInvestmentsTrackingMethod?: string; [key: string]: unknown };

    let actualFromDate = fromDate;
    let reconstructBalance = false;

    if (isFirstSyncNonInvestment(consolidatedAccount)) {
      debugLog('First sync for non-investment account detected, showing date picker with reconstruction option');

      const accountCreatedAt = account.createdAt as string | undefined;
      let defaultDate = fromDate;

      if (accountCreatedAt) {
        const createdDateStr = extractDateFromISO(accountCreatedAt) as string | null;
        if (createdDateStr) {
          defaultDate = createdDateStr;
        }
      }

      const datePickerResult = await showDatePickerWithOptionsPromise(
        defaultDate,
        `Select the start date for syncing "${account.nickname || account.id}". Default is the account creation date.`,
        {
          showReconstructCheckbox: true,
          reconstructCheckedByDefault: true,
        },
      ) as { date: string; reconstructBalance: boolean } | null;

      if (!datePickerResult) {
        debugLog('User cancelled date selection');
        const firstStep = WEALTHSIMPLE_TRANSACTION_SUPPORTED_TYPES.has(accountType) ? 'transactions' : 'balance';
        progressDialog.updateStepStatus(account.id, firstStep, 'error', 'Date selection cancelled');
        return { success: false, cancelled: true };
      }

      actualFromDate = datePickerResult.date;
      reconstructBalance = datePickerResult.reconstructBalance;
    }

    // Step 1: Transaction sync
    let rawWealthsimpleTransactions: unknown[] | null = null;
    let transactionsSyncedCount = 0;

    if (WEALTHSIMPLE_TRANSACTION_SUPPORTED_TYPES.has(accountType)) {
      progressDialog.updateStepStatus(account.id, 'transactions', 'processing', 'Fetching from WS...');

      try {
        rawWealthsimpleTransactions = (await wealthsimpleApi.fetchTransactions(account.id, actualFromDate)) as unknown[];
        const fetchedCount = rawWealthsimpleTransactions?.length || 0;
        debugLog(`Fetched ${fetchedCount} raw transactions for account ${account.id}`);
        progressDialog.updateStepStatus(account.id, 'transactions', 'processing', `Fetched ${fetchedCount}`);
      } catch (fetchError: unknown) {
        debugLog('Error fetching raw transactions:', fetchError);
        rawWealthsimpleTransactions = [];
      }

      const onTransactionProgress = (stage: string) => {
        progressDialog.updateStepStatus(account.id, 'transactions', 'processing', stage);
      };

      const transactionsResult = await uploadWealthsimpleTransactions(
        account.id,
        monarchAccount.id,
        actualFromDate,
        toDate,
        { rawTransactions: rawWealthsimpleTransactions, onProgress: onTransactionProgress },
      );

      if (transactionsResult && transactionsResult.success) {
        transactionsSyncedCount = transactionsResult.synced || 0;
        const txMessage = formatTransactionCountMessage(transactionsResult.synced, transactionsResult.skipped);
        progressDialog.updateStepStatus(account.id, 'transactions', 'success', txMessage);
      } else if (transactionsResult && transactionsResult.unsupported) {
        progressDialog.updateStepStatus(account.id, 'transactions', 'skipped', 'Not supported');
      } else {
        const errorMsg = transactionsResult?.error || 'Sync failed';
        progressDialog.updateStepStatus(account.id, 'transactions', 'error', errorMsg);
      }
    }

    // Step 2: Pending transaction reconciliation
    if (WEALTHSIMPLE_PENDING_RECONCILIATION_TYPES.has(accountType)) {
      progressDialog.updateStepStatus(account.id, 'pendingReconciliation', 'processing', 'Reconciling pending');

      try {
        const lookbackDays = getLookbackForInstitution('wealthsimple') as number;

        const reconciliationResult = await reconcilePendingTransactions(
          monarchAccount.id,
          (rawWealthsimpleTransactions || []) as Record<string, unknown>[],
          lookbackDays,
          accountType,
        );

        const reconciliationMessage = formatReconciliationMessage(reconciliationResult as ReconciliationResult) as string;
        const reconciliationStatus = reconciliationResult.success ? 'success' : 'error';

        progressDialog.updateStepStatus(account.id, 'pendingReconciliation', reconciliationStatus, reconciliationMessage);
        debugLog(`Pending reconciliation completed for ${account.id}:`, reconciliationResult);
      } catch (reconciliationError: unknown) {
        debugLog('Error during pending transaction reconciliation:', reconciliationError);
        progressDialog.updateStepStatus(account.id, 'pendingReconciliation', 'error', (reconciliationError as Error).message);
      }
    }

    // Step 3: Credit limit sync
    if (accountType === 'CREDIT_CARD') {
      progressDialog.updateStepStatus(account.id, 'creditLimit', 'processing', 'Syncing credit limit');

      const updatedConsolidatedAccount = getAccountData(account.id);
      if (updatedConsolidatedAccount) {
        const creditLimitSuccess = await syncCreditLimit(updatedConsolidatedAccount, monarchAccount.id);
        if (creditLimitSuccess) {
          const refreshedAccount = getAccountData(account.id);
          const creditLimit = refreshedAccount?.lastSyncedCreditLimit;
          const message = creditLimit ? `$${(creditLimit as number).toLocaleString()}` : 'Synced';
          progressDialog.updateStepStatus(account.id, 'creditLimit', 'success', message);
        } else {
          progressDialog.updateStepStatus(account.id, 'creditLimit', 'error', 'Sync failed');
        }
      } else {
        progressDialog.updateStepStatus(account.id, 'creditLimit', 'skipped', 'Account data unavailable');
      }
    }

    // Step 4: Balance upload
    progressDialog.updateStepStatus(account.id, 'balance', 'processing', 'Uploading balance');

    const balanceSuccess = await uploadWealthsimpleBalance(
      account.id,
      monarchAccount.id,
      actualFromDate,
      toDate,
      currentBalance,
      reconstructBalance,
    );

    if (balanceSuccess) {
      const daysUploaded = calculateDaysBetween(actualFromDate, toDate);
      const balanceMessage = formatBalanceMessage(currentBalance?.amount, daysUploaded);
      progressDialog.updateStepStatus(account.id, 'balance', 'success', balanceMessage);

      const isInvestment = isInvestmentAccount(accountType);
      const summaryAccountType = isInvestment ? 'investment' : (accountType === 'CREDIT_CARD' ? 'credit' : 'cash');

      const transactionCount = transactionsSyncedCount;

      const balanceChange = extractWealthsimpleBalanceChange(consolidatedAccount, currentBalance);
      if (balanceChange) {
        progressDialog.updateBalanceChange(account.id, {
          ...balanceChange,
          accountType: summaryAccountType,
          transactionCount,
        });
      } else {
        progressDialog.updateBalanceChange(account.id, {
          newBalance: currentBalance?.amount,
          daysUploaded,
          accountType: summaryAccountType,
          transactionCount,
        });
      }
    } else {
      progressDialog.updateStepStatus(account.id, 'balance', 'error', 'Upload failed');
      return { success: false };
    }

    // Step 5: Position sync (for investment accounts only)
    if (isInvestmentAccount(accountType)) {
      if (monarchAccount.isManual && monarchAccount.manualInvestmentsTrackingMethod !== 'holdings') {
        progressDialog.updateStepStatus(account.id, 'positions', 'skipped', 'Manual accounts without holdings tracking');
        debugLog(`Skipping position sync for ${account.id} - Monarch account is manual without holdings tracking`);
      } else {
        progressDialog.updateStepStatus(account.id, 'positions', 'processing', 'Syncing positions...');

        try {
          const positionsResult = await processAccountPositions(
            account.id,
            account.nickname || account.id,
            monarchAccount.id,
            progressDialog,
            accountType,
          );

          if (positionsResult.success) {
            let statusMsg = `${positionsResult.positionsProcessed} synced`;
            if (positionsResult.mappingsAutoRepaired > 0) statusMsg += `, ${positionsResult.mappingsAutoRepaired} repaired`;
            if (positionsResult.holdingsRemoved > 0) statusMsg += `, ${positionsResult.holdingsRemoved} deleted`;
            progressDialog.updateStepStatus(account.id, 'positions', 'success', statusMsg);
          } else {
            const errorMsg = positionsResult.error || 'Sync failed';
            progressDialog.updateStepStatus(account.id, 'positions', 'error', errorMsg);
          }
        } catch (positionsError: unknown) {
          debugLog('Error during position sync:', positionsError);
          progressDialog.updateStepStatus(account.id, 'positions', 'error', (positionsError as Error).message);
        }
      }
    }

    // Step 6: Cash sync (for investment accounts only)
    if (isInvestmentAccount(accountType)) {
      if (monarchAccount.isManual && monarchAccount.manualInvestmentsTrackingMethod !== 'holdings') {
        progressDialog.updateStepStatus(account.id, 'cashSync', 'skipped', 'Manual accounts without holdings tracking');
        debugLog(`Skipping cash sync for ${account.id} - Monarch account is manual without holdings tracking`);
      } else {
        progressDialog.updateStepStatus(account.id, 'cashSync', 'processing', 'Syncing cash balances...');

        try {
          const cashResult = await processCashPositions(
            account.id,
            account.nickname || account.id,
            monarchAccount.id,
            progressDialog,
          );

          if (cashResult.success) {
            let statusMsg: string;
            if (cashResult.cashSynced === 0 && cashResult.cashSkipped === 0) statusMsg = 'No cash balances';
            else if (cashResult.cashSkipped === 0) statusMsg = `${cashResult.cashSynced} currency synced`;
            else statusMsg = `${cashResult.cashSynced} synced, ${cashResult.cashSkipped} skipped`;
            progressDialog.updateStepStatus(account.id, 'cashSync', 'success', statusMsg);
          } else {
            const errorMsg = cashResult.error || 'Sync failed';
            progressDialog.updateStepStatus(account.id, 'cashSync', 'error', errorMsg);
          }
        } catch (cashError: unknown) {
          debugLog('Error during cash sync:', cashError);
          progressDialog.updateStepStatus(account.id, 'cashSync', 'error', (cashError as Error).message);
        }
      }
    }

    // Update lastSyncDate after successful sync
    if (balanceSuccess) {
      const todayDate = getTodayLocal() as string;

      updateAccountInList(account.id, {
        lastSyncDate: toDate,
        balanceCheckpoint: {
          date: todayDate,
          amount: currentBalance?.amount,
        },
      });
      debugLog(`Updated lastSyncDate and balance checkpoint for account ${account.id} to ${toDate}`);

      if (accountNeedsBalanceReconstruction(accountType) && reconstructBalance) {
        await createBalanceCheckpoint(account.id, actualFromDate, toDate);
      } else if (accountNeedsBalanceReconstruction(accountType) && consolidatedAccount.balanceCheckpoint) {
        await updateBalanceCheckpoint(account.id, toDate, currentBalance);
      }

      applyTransactionRetentionEviction(account.id);
    }

    return { success: true };
  } catch (error: unknown) {
    debugLog(`Error uploading Wealthsimple account ${account.id}:`, error);
    const errorSupportedTypes = ['CREDIT_CARD', 'PORTFOLIO_LINE_OF_CREDIT', 'CASH', 'CASH_USD'];
    const firstStep = errorSupportedTypes.includes(accountType) ? 'transactions' : 'balance';
    progressDialog.updateStepStatus(account.id, firstStep, 'error', (error as Error).message);
    return { success: false };
  }
}

/**
 * Get the last upload date for an account
 */
export function getLastUploadDate(accountId: string): string | null {
  const accountData = getAccountData(accountId);
  return accountData?.lastSyncDate || null;
}

/**
 * Clear last upload date for an account
 */
export function clearLastUploadDate(accountId: string): void {
  updateAccountInList(accountId, { lastSyncDate: null });
}

export default {
  uploadWealthsimpleAccountToMonarch,
  uploadAllWealthsimpleAccountsToMonarch,
  getLastUploadDate,
  clearLastUploadDate,
};
