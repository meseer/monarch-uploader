/**
 * Wealthsimple Account Service
 * Handles Wealthsimple account mapping and synchronization
 */

import { debugLog, formatDate } from '../../core/utils';
import type { CurrentBalance, BalanceCheckpoint } from '../../types/monarch';
import { STORAGE, TRANSACTION_RETENTION_DEFAULTS, LOGO_CLOUDINARY_IDS, WEALTHSIMPLE_TRANSACTION_SUPPORTED_TYPES } from '../../core/config';
import stateManager from '../../core/state';
import monarchApi from '../../api/monarch';
import wealthsimpleApi from '../../api/wealthsimple';
import toast from '../../ui/toast';
import { showMonarchAccountSelectorWithCreate } from '../../ui/components/accountSelectorWithCreate';
import { getMonarchAccountTypeMapping } from '../../mappers/wealthsimple-account-types';
import {
  getDefaultDateRange,
  processAndUploadBalance,
  accountNeedsBalanceReconstruction,
  reconstructBalanceFromTransactions,
  reconstructBalanceFromCheckpoint,
  createCurrentBalanceOnly,
  processBalanceData,
  uploadBalanceToMonarch,
} from './balance';
import { fetchAndProcessTransactions } from './transactions';
import { type WealthsimpleTransaction } from './transactionRulesHelpers';
import { convertWealthsimpleTransactionsToMonarchCSV } from '../../utils/csv';
import {
  migrateLegacyTransactions,
  applyRetentionLimits,
  mergeAndRetainTransactions,
  getRetentionSettingsFromAccount,
  getTransactionIdsFromArray,
} from '../../utils/transactionStorage';

// ── Types ─────────────────────────────────────────────────────────────────────

interface WealthsimpleAccount {
  id: string;
  nickname?: string;
  type?: string;
  [key: string]: unknown;
}

interface MonarchAccount {
  id: string;
  displayName: string;
  skipped?: boolean;
  newlyCreated?: boolean;
  [key: string]: unknown;
}

interface StoredTransaction {
  id: string;
  date?: string;
}

export interface ConsolidatedAccount {
  wealthsimpleAccount: WealthsimpleAccount;
  monarchAccount?: MonarchAccount | null;
  syncEnabled?: boolean;
  lastSyncDate?: string;
  uploadedTransactions?: StoredTransaction[];
  storeTransactionDetailsInNotes?: boolean;
  stripStoreNumbers?: boolean;
  transactionRetentionDays?: number;
  transactionRetentionCount?: number;
  balanceCheckpoint?: BalanceCheckpoint;
  lastSyncedCreditLimit?: number | null;
  [key: string]: unknown;
}

interface UploadTransactionOptions {
  rawTransactions?: unknown[];
  onProgress?: (message: string) => void;
}

interface TransactionUploadResult {
  success: boolean;
  synced: number;
  skipped: number;
  total: number;
  unsupported?: boolean;
  error?: string;
}

interface DefaultAccountSettings {
  syncEnabled: boolean;
  storeTransactionDetailsInNotes: boolean;
  stripStoreNumbers: boolean;
  transactionRetentionDays: number;
  transactionRetentionCount: number;
}

interface ProcessedTransaction {
  id: string;
  date: string;
  [key: string]: unknown;
}

// ── Functions ─────────────────────────────────────────────────────────────────

/**
 * Resolve Monarch account mapping for a Wealthsimple account
 * Shows account selector with create option, with pre-filled values based on Wealthsimple account type
 */
export async function resolveWealthsimpleAccountMapping(
  consolidatedAccount: ConsolidatedAccount,
  currentBalance: CurrentBalance | null = null,
): Promise<MonarchAccount | null> {
  try {
    const { id: accountId, nickname, type } = consolidatedAccount.wealthsimpleAccount;

    debugLog(`Resolving Monarch account mapping for Wealthsimple account ${accountId} (${nickname})`);

    // Set current account context
    stateManager.setAccount(accountId, nickname || accountId);

    // Check for existing mapping in consolidated structure
    const accountData = getAccountData(accountId);
    let warningMessage: string | null = null;

    if (accountData?.monarchAccount) {
      debugLog(`Found existing mapping: ${nickname} -> ${accountData.monarchAccount.displayName}`);

      // Validate that the Monarch account still exists
      try {
        const allAccounts = (await monarchApi.getFilteredAccounts({})) as unknown as MonarchAccount[];
        const freshMonarchAccount = allAccounts.find((acc) => acc.id === accountData.monarchAccount!.id);

        if (freshMonarchAccount) {
          // Account still exists - update with fresh data and return
          const updatedMonarchAccount: MonarchAccount = {
            ...accountData.monarchAccount,
            ...freshMonarchAccount,
          };

          // Save the refreshed data back to storage
          updateAccountInList(accountId, { monarchAccount: updatedMonarchAccount });
          debugLog(`Refreshed Monarch account data for mapping: ${updatedMonarchAccount.displayName}`);

          return updatedMonarchAccount;
        }

        // Account not found - clear the mapping and show selector with warning
        debugLog(`Monarch account ${accountData.monarchAccount.id} no longer exists, clearing mapping`);
        warningMessage = `The previously mapped account "${accountData.monarchAccount.displayName}" was not found in Monarch and may have been deleted. Please select or create a new account.`;
        updateAccountInList(accountId, { monarchAccount: null });
      } catch (validationError) {
        debugLog('Error validating Monarch account:', validationError);
        // On network error, trust the existing mapping
        return accountData.monarchAccount;
      }
    }

    debugLog('No existing mapping found, showing account selector with create option');

    // Get Monarch account type mapping for this Wealthsimple account type
    const typeMapping = getMonarchAccountTypeMapping(type as string);
    debugLog('Account type mapping:', { wealthsimpleType: type, monarchMapping: typeMapping });

    // Prepare defaults for account creation
    const createDefaults = {
      defaultName: nickname || accountId,
      defaultType: typeMapping?.type || 'brokerage',
      defaultSubtype: typeMapping?.subtype || 'brokerage',
      defaultBalance: currentBalance ? currentBalance.amount : 0,
      defaultIncludeInNetWorth: true,
      balanceOnlyTracking: false,
      currentBalance,
      accountType: type,
      warningMessage,
    };

    // Determine account type for filtering Monarch accounts
    const accountType = typeMapping?.type || 'brokerage';

    // Fetch Monarch accounts of the appropriate type
    const monarchAccounts = (await monarchApi.listAccounts(accountType)) as unknown as MonarchAccount[];
    if (!monarchAccounts || monarchAccounts.length === 0) {
      debugLog(`No ${accountType} accounts found in Monarch, showing create dialog directly`);
    }

    // Show enhanced account selector with create option
    const monarchAccount = await new Promise<MonarchAccount | null>((resolve) => {
      showMonarchAccountSelectorWithCreate(
        monarchAccounts,
        resolve as (result: unknown) => void,
        null,
        accountType,
        createDefaults,
      );
    });

    if (!monarchAccount) {
      // User cancelled selection
      debugLog('User cancelled account mapping selection');
      return null;
    }

    // Handle skip - update consolidated structure
    if (monarchAccount.skipped) {
      debugLog('Account skipped by user');
      updateAccountInList(accountId, {
        monarchAccount: null,
        syncEnabled: false,
      });
      return monarchAccount;
    }

    // If this is a newly created account, set the Wealthsimple logo
    if (monarchAccount.newlyCreated) {
      try {
        debugLog(`Setting Wealthsimple logo for newly created account ${monarchAccount.id}`);
        await monarchApi.setAccountLogo(monarchAccount.id, LOGO_CLOUDINARY_IDS.WEALTHSIMPLE);
        debugLog(`Successfully set Wealthsimple logo for account ${monarchAccount.displayName}`);
        toast.show(`Set Wealthsimple logo for ${monarchAccount.displayName}`, 'debug');
      } catch (logoError) {
        // Logo setting failed, but account creation succeeded - continue with warning
        debugLog('Failed to set Wealthsimple logo for account:', logoError);
        toast.show(`Warning: Failed to set logo for ${monarchAccount.displayName}`, 'warning');
      }
    }

    // Save the mapping in consolidated structure
    updateAccountInList(accountId, {
      monarchAccount,
      syncEnabled: true,
    });

    debugLog(`Saved account mapping: ${nickname} (${accountId}) -> ${monarchAccount.displayName} (${monarchAccount.id})`);

    toast.show(`Mapped ${nickname} to ${monarchAccount.displayName} in Monarch`, 'debug');

    return monarchAccount;
  } catch (error: unknown) {
    debugLog('Error resolving Wealthsimple account mapping:', error);
    toast.show(`Error mapping account: ${(error as Error).message}`, 'error');
    throw error;
  }
}

/**
 * Upload Wealthsimple account balance history to Monarch
 * Handles three scenarios:
 * 1. Investment accounts: Fetch balance history from API
 * 2. Credit/Cash accounts - first sync with reconstruction: Build balance from transactions
 * 3. Credit/Cash accounts - subsequent sync: Upload current balance for today only
 */
export async function uploadWealthsimpleBalance(
  wealthsimpleAccountId: string,
  monarchAccountId: string,
  fromDate: string,
  toDate: string,
  currentBalance: CurrentBalance | null = null,
  reconstructBalance: boolean = false,
): Promise<boolean> {
  try {
    debugLog('Starting Wealthsimple balance history upload', {
      wealthsimpleAccountId,
      monarchAccountId,
      fromDate,
      toDate,
      reconstructBalance,
    });

    // Get consolidated account data
    const accountData = getAccountData(wealthsimpleAccountId);
    if (!accountData) {
      throw new Error('Account data not found');
    }

    const account = accountData.wealthsimpleAccount;
    const accountType = account?.type || '';
    const wealthsimpleAccountName = account.nickname || wealthsimpleAccountId;
    const monarchAccountName = accountData.monarchAccount?.displayName || wealthsimpleAccountName;

    // If dates not provided, calculate them
    let actualFromDate = fromDate;
    let actualToDate = toDate;
    if (!fromDate || !toDate) {
      const dateRange = getDefaultDateRange(accountData);
      actualFromDate = dateRange.fromDate;
      actualToDate = dateRange.toDate;
    }

    // Check if this account type needs special handling (credit cards, cash accounts)
    const needsReconstruction = accountNeedsBalanceReconstruction(accountType);

    // Scenario 1: Investment accounts - use standard API-based balance fetch
    if (!needsReconstruction) {
      debugLog('Investment account - using standard balance history fetch');
      const success = await processAndUploadBalance(
        accountData,
        monarchAccountId,
        actualFromDate,
        actualToDate,
        currentBalance,
      );
      return success as boolean;
    }

    // Scenario 2: Credit/Cash accounts - first sync with reconstruction enabled
    if (reconstructBalance) {
      debugLog('First sync with reconstruction enabled - building balance from transactions');

      // Fetch and process transactions to use for balance reconstruction
      // Skip categorization since balance reconstruction only needs dates and amounts
      const processedTransactions = await fetchAndProcessTransactions(accountData, actualFromDate, actualToDate, { skipCategorization: true }) as Array<{ date: string; amount: number }> | null;

      const hasTransactions = processedTransactions && processedTransactions.length > 0;

      if (!hasTransactions) {
        debugLog('No transactions found - will reconstruct with zeros and add current balance for today');
      }

      // Calculate dates for reconstruction
      const todayDate = formatDate(new Date());
      const yesterdayObj = new Date();
      yesterdayObj.setDate(yesterdayObj.getDate() - 1);
      const yesterdayDate = formatDate(yesterdayObj);

      // Reconstruct balance history from transactions (zeros if none)
      // Only go up to yesterday - we'll add today's current balance separately
      const reconstructionEndDate = actualToDate <= yesterdayDate ? actualToDate : yesterdayDate;

      let balanceHistory: Array<{ date: string; amount: number }> = [];

      // Only reconstruct if there's at least one day before today to reconstruct
      if (actualFromDate <= reconstructionEndDate) {
        balanceHistory = reconstructBalanceFromTransactions(
          processedTransactions || [],
          actualFromDate,
          reconstructionEndDate,
        ) as Array<{ date: string; amount: number }>;
      }

      // Add today's current balance (if available and toDate includes today)
      if (actualToDate >= todayDate && currentBalance && currentBalance.amount !== undefined) {
        balanceHistory.push({
          date: todayDate,
          amount: currentBalance.amount,
        });
        debugLog(`Added current balance for today (${todayDate}): ${currentBalance.amount}`);
      }

      if (!balanceHistory || balanceHistory.length === 0) {
        debugLog('Failed to reconstruct balance history');
        toast.show(`Failed to reconstruct balance history for ${wealthsimpleAccountName}`, 'error');
        return false;
      }

      // Convert to CSV and upload
      const csvData = processBalanceData(balanceHistory, monarchAccountName);
      debugLog(`Generated reconstructed balance CSV for ${monarchAccountName} (${balanceHistory.length} days)`);

      const success = await uploadBalanceToMonarch(
        wealthsimpleAccountId,
        monarchAccountId,
        csvData,
        actualFromDate,
        actualToDate,
      );

      if (success) {
        const message = hasTransactions
          ? `Reconstructed and uploaded ${balanceHistory.length} days of balance history for ${wealthsimpleAccountName}`
          : `Uploaded ${balanceHistory.length} days of balance (zero history + current balance) for ${wealthsimpleAccountName}`;
        toast.show(message, 'debug');
      }

      return success as boolean;
    }

    // Scenario 3: Credit/Cash accounts - subsequent sync (has lastSyncDate)
    // Check if we have a balance checkpoint to use for reconstruction
    const checkpoint = accountData.balanceCheckpoint;

    if (!currentBalance) {
      debugLog('No current balance available for subsequent sync');
      toast.show(`No current balance available for ${wealthsimpleAccountName}`, 'warning');
      return false;
    }

    const todayDate = formatDate(new Date());

    // Scenario 3a: If checkpoint exists, reconstruct balance from checkpoint
    if (checkpoint && checkpoint.date && checkpoint.amount !== undefined) {
      debugLog('Subsequent sync with checkpoint - reconstructing balance from checkpoint');
      debugLog(`Checkpoint: ${checkpoint.date} = ${checkpoint.amount}`);

      // Fetch and process transactions from checkpoint date to today
      // Skip categorization since balance reconstruction only needs dates and amounts
      const processedTransactions = await fetchAndProcessTransactions(accountData, checkpoint.date, todayDate, { skipCategorization: true }) as Array<{ date: string; amount: number }> | null;

      // Reconstruct balance from checkpoint to today
      const balanceHistory = reconstructBalanceFromCheckpoint(
        processedTransactions || [],
        checkpoint,
        todayDate,
        currentBalance,
      ) as Array<{ date: string; amount: number }> | null;

      if (!balanceHistory || balanceHistory.length === 0) {
        debugLog('Failed to reconstruct balance from checkpoint, falling back to current balance only');
        // Fall through to current balance only logic below
      } else {
        // Convert to CSV and upload
        const csvData = processBalanceData(balanceHistory, monarchAccountName);
        debugLog(`Generated checkpoint-reconstructed balance CSV for ${monarchAccountName} (${balanceHistory.length} days)`);

        const success = await uploadBalanceToMonarch(
          wealthsimpleAccountId,
          monarchAccountId,
          csvData,
          checkpoint.date,
          todayDate,
        );

        if (success) {
          toast.show(`Reconstructed and uploaded ${balanceHistory.length} days of balance for ${wealthsimpleAccountName}`, 'debug');
        }

        return success as boolean;
      }
    } else {
      debugLog('No checkpoint available - uploading current balance only');
    }

    // Scenario 3b: No checkpoint - upload current balance only
    const balanceHistory = createCurrentBalanceOnly(currentBalance, todayDate) as Array<{ date: string; amount: number }> | null;

    if (!balanceHistory || balanceHistory.length === 0) {
      debugLog('Failed to create current balance entry');
      return false;
    }

    // Convert to CSV and upload
    const csvData = processBalanceData(balanceHistory, monarchAccountName);
    debugLog(`Generated current balance CSV for ${monarchAccountName}: ${currentBalance.amount}`);

    const success = await uploadBalanceToMonarch(
      wealthsimpleAccountId,
      monarchAccountId,
      csvData,
      todayDate,
      todayDate,
    );

    if (success) {
      toast.show(`Updated today's balance for ${wealthsimpleAccountName}`, 'debug');
    }

    return success as boolean;
  } catch (error: unknown) {
    debugLog('Error uploading Wealthsimple balance:', error);
    toast.show(`Balance upload failed: ${(error as Error).message}`, 'error');
    return false;
  }
}

/**
 * Upload Wealthsimple account transactions to Monarch
 * For first sync, prompts user for start date with account creation date as default
 *
 * Optimized: Accepts pre-fetched raw transactions to avoid duplicate API calls,
 * and passes uploadedTransactionIds to processing for early filtering.
 */
export async function uploadWealthsimpleTransactions(
  wealthsimpleAccountId: string,
  monarchAccountId: string,
  fromDate: string,
  toDate: string,
  options: UploadTransactionOptions = {},
): Promise<TransactionUploadResult> {
  try {
    const { rawTransactions, onProgress } = options;

    debugLog('Starting Wealthsimple transaction upload', {
      wealthsimpleAccountId,
      monarchAccountId,
      fromDate,
      toDate,
      hasRawTransactions: Boolean(rawTransactions),
    });

    // Get consolidated account data
    const accountData = getAccountData(wealthsimpleAccountId);
    if (!accountData) {
      throw new Error('Account data not found');
    }

    const accountName = accountData.wealthsimpleAccount.nickname;
    const accountType = accountData.wealthsimpleAccount.type;

    // Check if this account type supports transactions
    if (!WEALTHSIMPLE_TRANSACTION_SUPPORTED_TYPES.has(accountType as string)) {
      debugLog(`Transaction upload not supported for account type: ${accountType}`);
      return { success: false, synced: 0, skipped: 0, total: 0, unsupported: true };
    }

    // Get existing uploaded transactions and migrate if needed
    // Build the Set BEFORE processing so we can pass it for early filtering
    const existingTransactions = migrateLegacyTransactions(accountData.uploadedTransactions || []) as StoredTransaction[];
    const uploadedTransactionIds = getTransactionIdsFromArray(existingTransactions) as Set<string>;

    debugLog(`Account has ${uploadedTransactionIds.size} previously uploaded transaction IDs`);

    // Fetch and process transactions with early duplicate filtering
    // Pass raw transactions if provided, uploadedTransactionIds for early filtering, and onProgress for UI updates
    const processedTransactions = await fetchAndProcessTransactions(accountData, fromDate, toDate, {
      rawTransactions: rawTransactions as WealthsimpleTransaction[] | undefined,
      uploadedTransactionIds,
      onProgress,
    }) as unknown as ProcessedTransaction[] | null;

    if (!processedTransactions || processedTransactions.length === 0) {
      debugLog('No transactions to upload');
      return { success: true, synced: 0, skipped: 0, total: 0 };
    }

    debugLog(`Found ${processedTransactions.length} processed transactions (after early filtering)`);

    // Final duplicate check (belt-and-suspenders, should be few/none after early filtering)
    const newTransactions = processedTransactions.filter(
      (transaction) => !uploadedTransactionIds.has(transaction.id),
    );

    const duplicateCount = processedTransactions.length - newTransactions.length;

    if (duplicateCount > 0) {
      debugLog(`Final filter removed ${duplicateCount} additional duplicate transactions`);
    }

    if (newTransactions.length === 0) {
      debugLog('No new transactions to upload after final filtering');
      return { success: true, synced: 0, skipped: duplicateCount, total: processedTransactions.length };
    }

    debugLog(`Uploading ${newTransactions.length} new transactions`);

    // Report progress: uploading to Monarch
    if (onProgress) {
      onProgress(`Uploading ${newTransactions.length}...`);
    }

    // Convert to Monarch CSV format with account-specific options
    const csvOptions = {
      storeTransactionDetailsInNotes: accountData.storeTransactionDetailsInNotes ?? false,
    };
    const csvData = convertWealthsimpleTransactionsToMonarchCSV(newTransactions as unknown as WealthsimpleTransaction[], accountName as string, csvOptions);

    if (!csvData) {
      throw new Error('Failed to convert transactions to CSV');
    }

    // Upload to Monarch
    const filename = `wealthsimple_transactions_${wealthsimpleAccountId}_${fromDate}_to_${toDate}.csv`;
    const uploadSuccess = await monarchApi.uploadTransactions(
      monarchAccountId,
      csvData,
      filename,
      false, // shouldUpdateBalance = false (balance is uploaded separately)
      false, // skipCheckForDuplicates = false
    );

    if (uploadSuccess) {
      // Prepare new transactions with their dates for storage
      const transactionsToStore = newTransactions
        .filter((transaction) => transaction.id)
        .map((transaction) => ({
          id: transaction.id,
          date: transaction.date,
        }));

      if (transactionsToStore.length > 0) {
        // Get retention settings from account
        const retentionSettings = getRetentionSettingsFromAccount(accountData);

        // Merge new transactions with existing and apply retention
        const updatedUploadedTransactions = mergeAndRetainTransactions(
          existingTransactions,
          transactionsToStore,
          retentionSettings,
        ) as StoredTransaction[];

        // Update account with new uploaded transactions
        // Note: lastSyncDate is NOT updated here - it's only updated when BOTH balance and transactions succeed
        updateAccountInList(wealthsimpleAccountId, {
          uploadedTransactions: updatedUploadedTransactions,
        });

        debugLog(`Stored ${transactionsToStore.length} new transaction IDs, total after retention: ${updatedUploadedTransactions.length}`);
      }

      const totalProcessed = processedTransactions.length;
      const successMessage = duplicateCount > 0
        ? `Successfully uploaded ${newTransactions.length} new transactions (${duplicateCount} duplicates skipped)`
        : `Successfully uploaded ${newTransactions.length} transactions`;

      debugLog(successMessage);
      toast.show(successMessage, 'debug');

      return { success: true, synced: newTransactions.length, skipped: duplicateCount, total: totalProcessed };
    }

    throw new Error('Transaction upload failed');
  } catch (error: unknown) {
    debugLog('Error uploading Wealthsimple transactions:', error);
    toast.show(`Transaction upload failed: ${(error as Error).message}`, 'error');
    return { success: false, synced: 0, skipped: 0, total: 0, error: (error as Error).message };
  }
}

/**
 * Apply transaction retention eviction for an account
 * Should be called after each successful sync to clean up old transaction IDs
 */
export function applyTransactionRetentionEviction(accountId: string): boolean {
  try {
    const accountData = getAccountData(accountId);
    if (!accountData) {
      debugLog(`Cannot apply retention eviction: account ${accountId} not found`);
      return false;
    }

    const existingTransactions = accountData.uploadedTransactions || [];
    if (existingTransactions.length === 0) {
      return true; // Nothing to evict
    }

    // Migrate legacy format if needed
    const migrated = migrateLegacyTransactions(existingTransactions) as StoredTransaction[];

    // Get retention settings from account
    const retentionSettings = getRetentionSettingsFromAccount(accountData);

    // Apply retention limits
    const retained = applyRetentionLimits(migrated as import('../../utils/transactionStorage').StoredTransaction[], retentionSettings) as StoredTransaction[];

    // Only update if something changed
    if (retained.length !== migrated.length) {
      updateAccountInList(accountId, {
        uploadedTransactions: retained,
      });
      debugLog(`Transaction retention eviction: ${migrated.length} -> ${retained.length} for account ${accountId}`);
    }

    return true;
  } catch (error: unknown) {
    debugLog('Error applying transaction retention eviction:', error);
    return false;
  }
}

/**
 * Get default account settings for new accounts
 */
export function getDefaultAccountSettings(): DefaultAccountSettings {
  return {
    syncEnabled: true,
    storeTransactionDetailsInNotes: false,
    stripStoreNumbers: true,
    transactionRetentionDays: TRANSACTION_RETENTION_DEFAULTS.DAYS,
    transactionRetentionCount: TRANSACTION_RETENTION_DEFAULTS.COUNT,
  };
}

/**
 * Get cached Wealthsimple accounts list (consolidated structure)
 */
export function getWealthsimpleAccounts(): ConsolidatedAccount[] {
  try {
    const accounts = JSON.parse(GM_getValue(STORAGE.WEALTHSIMPLE_ACCOUNTS_LIST, '[]'));
    return accounts;
  } catch (error: unknown) {
    debugLog('Error getting Wealthsimple accounts list:', error);
    return [];
  }
}

/**
 * Save Wealthsimple accounts list
 */
function saveWealthsimpleAccounts(accounts: ConsolidatedAccount[]): void {
  GM_setValue(STORAGE.WEALTHSIMPLE_ACCOUNTS_LIST, JSON.stringify(accounts));
}

/**
 * Get single account data from consolidated list
 */
export function getAccountData(accountId: string): ConsolidatedAccount | null {
  const accounts = getWealthsimpleAccounts();
  return accounts.find((acc) => acc.wealthsimpleAccount?.id === accountId) || null;
}

/**
 * Update specific account properties in the consolidated list
 */
export function updateAccountInList(accountId: string, updates: Partial<ConsolidatedAccount>): boolean {
  try {
    const accounts = getWealthsimpleAccounts();
    const accountIndex = accounts.findIndex((acc) => acc.wealthsimpleAccount?.id === accountId);

    if (accountIndex === -1) {
      debugLog(`Account ${accountId} not found in list`);
      return false;
    }

    // Update the account
    accounts[accountIndex] = {
      ...accounts[accountIndex],
      ...updates,
    };

    // Save updated list
    saveWealthsimpleAccounts(accounts);
    debugLog(`Updated account ${accountId} in list`, updates);
    return true;
  } catch (error: unknown) {
    debugLog('Error updating account in list:', error);
    return false;
  }
}

/**
 * Mark account as skipped or unskip it (updates syncEnabled flag)
 */
export function markAccountAsSkipped(accountId: string, skipped: boolean = true): boolean {
  const success = updateAccountInList(accountId, { syncEnabled: !skipped });
  if (success) {
    const action = skipped ? 'disabled' : 'enabled';
    debugLog(`Account ${accountId} sync ${action}`);
  }
  return success;
}

/**
 * Check if an account is marked as skipped (checks syncEnabled flag)
 */
export function isAccountSkipped(accountId: string): boolean {
  const accountData = getAccountData(accountId);
  return accountData ? !accountData.syncEnabled : false;
}

/**
 * Sync account list with API data
 * Fetches fresh accounts from API and merges with cached settings
 */
export async function syncAccountListWithAPI(): Promise<ConsolidatedAccount[]> {
  try {
    return await wealthsimpleApi.fetchAndCacheAccounts() as unknown as ConsolidatedAccount[];
  } catch (error: unknown) {
    debugLog('Error syncing account list with API:', error);
    // Return cached list if API fails
    return getWealthsimpleAccounts();
  }
}

/**
 * Sync credit limit from Wealthsimple to Monarch for credit card accounts
 */
export async function syncCreditLimit(
  consolidatedAccount: ConsolidatedAccount,
  monarchAccountId: string,
): Promise<boolean> {
  try {
    const account = consolidatedAccount.wealthsimpleAccount;
    const accountType = account?.type || '';

    // Only process credit card accounts
    if (accountType !== 'CREDIT_CARD') {
      debugLog(`Skipping credit limit sync for non-credit card account: ${accountType}`);
      return true;
    }

    debugLog(`Starting credit limit sync for account ${account.id} (${account.nickname})`);

    // Step 1: Fetch credit limit from Wealthsimple
    let wsCreditLimit: number | null = null;
    try {
      const creditCardSummary = (await wealthsimpleApi.fetchCreditCardAccountSummary(account.id)) as { creditLimit?: number | null };
      wsCreditLimit = creditCardSummary.creditLimit ?? null;

      if (wsCreditLimit === null || wsCreditLimit === undefined) {
        debugLog(`No credit limit found in Wealthsimple for account ${account.id}`);
        return true; // Not an error, just no limit to sync
      }

      debugLog(`Wealthsimple credit limit for ${account.nickname}: ${wsCreditLimit}`);
    } catch (error: unknown) {
      debugLog(`Failed to fetch Wealthsimple credit card summary for ${account.id}:`, error);
      toast.show('Warning: Could not fetch credit limit from Wealthsimple', 'warning');
      return false;
    }

    // Step 2: Determine the comparison limit (stored or from Monarch)
    let comparisonLimit: number | null = consolidatedAccount.lastSyncedCreditLimit ?? null;
    const needsMonarchFetch = comparisonLimit === null || comparisonLimit === undefined;

    if (needsMonarchFetch) {
      // First sync or no stored limit - fetch from Monarch
      debugLog(`No stored credit limit, fetching from Monarch for account ${monarchAccountId}`);
      try {
        comparisonLimit = (await monarchApi.getCreditLimit(monarchAccountId)) as number | null;
        debugLog(`Monarch credit limit: ${comparisonLimit}`);
      } catch (error: unknown) {
        debugLog(`Failed to fetch Monarch credit limit for ${monarchAccountId}:`, error);
        // Continue with null - we'll update Monarch with WS limit
        comparisonLimit = null;
      }
    } else {
      debugLog(`Using stored credit limit for comparison: ${comparisonLimit}`);
    }

    // Step 3: Compare and update if needed
    if (comparisonLimit !== wsCreditLimit) {
      debugLog(`Credit limits differ - WS: ${wsCreditLimit}, Comparison: ${comparisonLimit}. Updating Monarch...`);

      try {
        await monarchApi.setCreditLimit(monarchAccountId, wsCreditLimit);
        debugLog(`Successfully updated Monarch credit limit to ${wsCreditLimit}`);
        toast.show(`Updated credit limit for ${account.nickname} to $${wsCreditLimit}`, 'debug');
      } catch (error: unknown) {
        debugLog('Failed to update Monarch credit limit:', error);
        toast.show('Warning: Could not update credit limit in Monarch', 'warning');
        return false;
      }
    } else {
      debugLog(`Credit limits match (${wsCreditLimit}), no update needed`);
    }

    // Step 4: Store the synced credit limit for future comparisons
    updateAccountInList(account.id, {
      lastSyncedCreditLimit: wsCreditLimit,
    });

    debugLog(`Credit limit sync completed for ${account.nickname}`);
    return true;
  } catch (error: unknown) {
    debugLog('Error during credit limit sync:', error);
    // Don't show error toast here - credit limit sync is not critical
    return false;
  }
}

export default {
  resolveWealthsimpleAccountMapping,
  uploadWealthsimpleBalance,
  uploadWealthsimpleTransactions,
  getWealthsimpleAccounts,
  updateAccountInList,
  markAccountAsSkipped,
  isAccountSkipped,
  syncAccountListWithAPI,
  syncCreditLimit,
};
