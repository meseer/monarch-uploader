/**
 * Canada Life Closed Accounts Service
 * Handles detecting, prompting for, and closing orphaned/transferred Canada Life accounts
 */

import { ACCOUNT_STATUS } from '../../core/config';
import { INTEGRATIONS } from '../../core/integrationCapabilities';
import { debugLog, getTodayLocal } from '../../core/utils';
import stateManager from '../../core/state';
import type { CanadaLifeConsolidatedAccount, SponsorInfo } from '../../api/canadalife';
import monarchApi from '../../api/monarch';
import accountService from '../common/accountService';
import toast from '../../ui/toast';
import { showClosedAccountsDialog, type ClosedAccountCandidate } from '../../ui/components/closedAccountsDialog';

export interface CloseSingleAccountResult {
  accountId: string;
  accountName: string;
  closedInUploader: boolean;
  closedInMonarch: boolean;
  monarchNotFound: boolean;
  monarchError?: string;
}

export interface ClosedAccountsActionPlan {
  prompted: boolean;
  accountsToClose: CanadaLifeConsolidatedAccount[];
  closeInMonarch: boolean;
  closedDate: string;
  skippedOrphanIds: Set<string>;
}

export interface ProgressReporter {
  initSteps: (accountId: string, steps: Array<{ key: string; name: string }>) => void;
  updateStepStatus: (
    accountId: string,
    stepKey: string,
    status: 'pending' | 'processing' | 'success' | 'error' | 'skipped',
    message?: string,
  ) => void;
}

function getConsolidatedAccountId(account: CanadaLifeConsolidatedAccount): string {
  return account.canadalifeAccount?.agreementId || account.canadalifeAccount?.id || '';
}

function getConsolidatedAccountName(account: CanadaLifeConsolidatedAccount): string {
  return account.canadalifeAccount?.LongNameEnglish
    || account.canadalifeAccount?.EnglishShortName
    || getConsolidatedAccountId(account)
    || 'Account';
}

function extractEnrollmentDateYmd(enrollmentDate?: string): string | null {
  if (!enrollmentDate) return null;
  const match = enrollmentDate.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

/**
 * Return stored accounts that disappeared from the API response, are not yet
 * marked closed, and still have sync enabled.
 */
export function findPotentialClosedAccounts(
  consolidatedAccounts: CanadaLifeConsolidatedAccount[],
): CanadaLifeConsolidatedAccount[] {
  return consolidatedAccounts.filter((account) => (
    account.isOrphanedFromApi === true
    && account.status !== ACCOUNT_STATUS.CLOSED
    && account.syncEnabled !== false
    && Boolean(getConsolidatedAccountId(account))
  ));
}

/**
 * Infer a default closure date from any newly opened active account (e.g., NextSteps RRSP2),
 * falling back to today's date, along with a hint asking the user to confirm.
 */
export function inferDefaultClosureDate(
  consolidatedAccounts: CanadaLifeConsolidatedAccount[],
  sponsorInfo: SponsorInfo | null,
): { date: string; hint: string } {
  const activeWithDates = consolidatedAccounts
    .filter((acc) => acc.isOrphanedFromApi !== true && acc.status !== ACCOUNT_STATUS.CLOSED)
    .map((acc) => ({
      account: acc,
      date: extractEnrollmentDateYmd(acc.canadalifeAccount?.EnrollmentDate),
    }))
    .filter((entry): entry is { account: CanadaLifeConsolidatedAccount; date: string } => entry.date !== null);

  const newlyOpened = activeWithDates.filter(
    ({ account }) => !account.monarchAccount || !account.lastSyncDate,
  );
  const candidates = newlyOpened.length > 0
    ? newlyOpened
    : (sponsorInfo?.sponsorName?.toUpperCase().includes('NEXTSTEP') ? activeWithDates : []);

  if (candidates.length > 0) {
    candidates.sort((a, b) => b.date.localeCompare(a.date));
    const chosen = candidates[0];
    const label = chosen.account.canadalifeAccount?.EnglishShortName
      || getConsolidatedAccountName(chosen.account);
    return {
      date: chosen.date,
      hint: `Pre-filled from ${label}'s opening date (${chosen.date}) — please confirm or adjust.`,
    };
  }

  return {
    date: getTodayLocal(),
    hint: 'Please confirm or adjust the closure date (for a NextSteps transfer, use the date the new NextSteps account opened).',
  };
}

/**
 * Build contextual dialog copy based on Canada Life sponsor state.
 */
export function buildClosedAccountsPromptText(
  sponsorInfo: SponsorInfo | null,
): { title: string; description: string; note?: string } {
  const title = 'Closed or Transferred Canada Life Accounts Detected';
  let description: string;

  if (sponsorInfo && !sponsorInfo.hasSavingsPlans) {
    const sponsorLabel = sponsorInfo.sponsorName || 'your current Canada Life sponsor';
    description = `No active savings plans were found under ${sponsorLabel}. `
      + 'These accounts may have been closed or transferred (for example, to a NextSteps plan).';
  } else if (sponsorInfo?.sponsorName?.toUpperCase().includes('NEXTSTEP')) {
    description = `The following previously synced accounts were not found under ${sponsorInfo.sponsorName}. `
      + 'They may have been closed when transferred to your NextSteps plan.';
  } else {
    description = 'The following previously synced accounts were not returned by Canada Life and may have been closed.';
  }

  const note = sponsorInfo?.isMultiSponsor
    ? 'Note: Your Canada Life login has multiple sponsors. Uncheck any account that is still active under another sponsor, or click "Skip for Now".'
    : undefined;

  return { title, description, note };
}

function buildZeroBalanceCsv(accountName: string, date: string): string {
  const escapedName = accountName.replace(/"/g, '""');
  return `"Date","Total Equity","Account Name"\n"${date}","0","${escapedName}"\n`;
}

function markClosedInUploaderStorage(
  accountId: string,
  closedDate: string,
  extraFields: Record<string, unknown> = {},
): void {
  accountService.updateAccountInList(INTEGRATIONS.CANADALIFE, accountId, {
    status: ACCOUNT_STATUS.CLOSED,
    closedDate,
    syncEnabled: false,
    ...extraFields,
  });
}

async function uploadZeroBalanceBestEffort(
  accountId: string,
  accountName: string,
  monarchAccountId: string,
  closedDate: string,
): Promise<void> {
  try {
    stateManager.setAccount(accountId, accountName);
    const csvData = buildZeroBalanceCsv(accountName, closedDate);
    await monarchApi.uploadBalance(monarchAccountId, csvData, closedDate, closedDate);
  } catch (balanceError) {
    debugLog(`Best-effort $0 balance upload failed for ${accountName}; continuing to close account:`, balanceError);
  }
}

/**
 * Close a single Canada Life account in Monarch (optional) and uploader storage.
 * If Monarch close fails with a transient error, local storage is left open so
 * the user can retry on the next sync.
 */
export async function closeCanadaLifeAccount(
  consolidatedAccount: CanadaLifeConsolidatedAccount,
  options: { closeInMonarch: boolean; closedDate?: string },
): Promise<CloseSingleAccountResult> {
  const accountId = getConsolidatedAccountId(consolidatedAccount);
  const accountName = getConsolidatedAccountName(consolidatedAccount);
  const closedDate = options.closedDate || getTodayLocal();
  const monarchAccountId = (consolidatedAccount.monarchAccount as Record<string, unknown> | null)?.id as string | undefined;

  if (!options.closeInMonarch || !monarchAccountId) {
    markClosedInUploaderStorage(accountId, closedDate);
    return {
      accountId, accountName, closedInUploader: true, closedInMonarch: false, monarchNotFound: false,
    };
  }

  await uploadZeroBalanceBestEffort(accountId, accountName, monarchAccountId, closedDate);

  try {
    const updatedMonarch = await monarchApi.closeAccount(monarchAccountId, closedDate);
    markClosedInUploaderStorage(accountId, closedDate, {
      lastSyncBalance: 0,
      monarchAccount: {
        ...(consolidatedAccount.monarchAccount || {}),
        currentBalance: 0,
        deactivatedAt: updatedMonarch.deactivatedAt,
      },
    });
    return {
      accountId, accountName, closedInUploader: true, closedInMonarch: true, monarchNotFound: false,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    debugLog(`Failed to close Monarch account for ${accountName}:`, error);

    if (/not found|does not exist/i.test(errorMsg)) {
      markClosedInUploaderStorage(accountId, closedDate);
      return {
        accountId, accountName, closedInUploader: true, closedInMonarch: false, monarchNotFound: true, monarchError: errorMsg,
      };
    }

    return {
      accountId, accountName, closedInUploader: false, closedInMonarch: false, monarchNotFound: false, monarchError: errorMsg,
    };
  }
}

export function reportClosedAccountOutcomes(results: CloseSingleAccountResult[], closeInMonarch: boolean): void {
  const closedInUploader = results.filter((r) => r.closedInUploader);
  const failed = results.filter((r) => !r.closedInUploader);
  const notFound = results.filter((r) => r.monarchNotFound);

  if (failed.length > 0 && closedInUploader.length === 0) {
    toast.show(`Failed to close selected account(s) in Monarch: ${failed[0].monarchError}`, 'error');
    return;
  }

  if (failed.length > 0 || notFound.length > 0) {
    const parts: string[] = [];
    if (closedInUploader.length > 0) parts.push(`Closed ${closedInUploader.length} account(s) in uploader`);
    if (notFound.length > 0) parts.push(`${notFound.length} already missing from Monarch`);
    if (failed.length > 0) parts.push(`${failed.length} failed in Monarch (kept open to retry)`);
    toast.show(parts.join('; '), 'warning');
    return;
  }

  if (closeInMonarch && results.some((r) => r.closedInMonarch)) {
    toast.show(`Closed ${closedInUploader.length} account(s) in Monarch ($0 balance) and uploader`, 'info');
    return;
  }

  toast.show(`Marked ${closedInUploader.length} account(s) as closed in uploader`, 'info');
}

function toDialogCandidates(accounts: CanadaLifeConsolidatedAccount[]): ClosedAccountCandidate[] {
  return accounts.map((acc) => ({
    id: getConsolidatedAccountId(acc),
    name: getConsolidatedAccountName(acc),
    shortName: acc.canadalifeAccount?.EnglishShortName,
    monarchAccountName: (acc.monarchAccount as Record<string, unknown> | null)?.displayName as string | undefined ?? null,
    lastSyncDate: acc.lastSyncDate,
  }));
}

/**
 * Prompt the user about orphaned Canada Life accounts and return the closure action plan.
 */
export async function promptForClosedAccounts(
  consolidatedAccounts: CanadaLifeConsolidatedAccount[],
  sponsorInfo: SponsorInfo | null,
): Promise<ClosedAccountsActionPlan> {
  const candidates = findPotentialClosedAccounts(consolidatedAccounts);
  if (candidates.length === 0) {
    return {
      prompted: false,
      accountsToClose: [],
      closeInMonarch: false,
      closedDate: '',
      skippedOrphanIds: new Set(),
    };
  }

  const allCandidateIds = candidates.map(getConsolidatedAccountId);
  const promptText = buildClosedAccountsPromptText(sponsorInfo);
  const defaultClosure = inferDefaultClosureDate(consolidatedAccounts, sponsorInfo);
  const dialogResult = await showClosedAccountsDialog({
    ...promptText,
    accounts: toDialogCandidates(candidates),
    defaultClosedDate: defaultClosure.date,
    closedDateHint: defaultClosure.hint,
    defaultCloseInMonarch: true,
  });

  if (!dialogResult.confirmed || dialogResult.selectedAccountIds.length === 0) {
    return {
      prompted: true,
      accountsToClose: [],
      closeInMonarch: false,
      closedDate: '',
      skippedOrphanIds: new Set(allCandidateIds),
    };
  }

  const selectedSet = new Set(dialogResult.selectedAccountIds);
  const accountsToClose = candidates.filter((acc) => selectedSet.has(getConsolidatedAccountId(acc)));
  const skippedOrphanIds = new Set(allCandidateIds.filter((id) => !selectedSet.has(id)));

  return {
    prompted: true,
    accountsToClose,
    closeInMonarch: dialogResult.closeInMonarch,
    closedDate: dialogResult.closedDate,
    skippedOrphanIds,
  };
}

/**
 * Close a single Canada Life account while updating a single `closeAccount` step
 * in the progress dialog.
 */
export async function closeAccountWithProgress(
  consolidatedAccount: CanadaLifeConsolidatedAccount,
  options: { closeInMonarch: boolean; closedDate: string },
  progressDialog: ProgressReporter | null,
): Promise<CloseSingleAccountResult> {
  const accountId = getConsolidatedAccountId(consolidatedAccount);

  progressDialog?.initSteps(accountId, [{ key: 'closeAccount', name: 'Close account' }]);
  progressDialog?.updateStepStatus(
    accountId,
    'closeAccount',
    'processing',
    options.closeInMonarch ? 'Closing in Monarch...' : 'Marking closed...',
  );

  const result = await closeCanadaLifeAccount(consolidatedAccount, options);

  if (result.closedInUploader && result.closedInMonarch) {
    progressDialog?.updateStepStatus(accountId, 'closeAccount', 'success', `Closed (${options.closedDate})`);
  } else if (result.closedInUploader && result.monarchNotFound) {
    progressDialog?.updateStepStatus(accountId, 'closeAccount', 'success', 'Closed in uploader (not in Monarch)');
  } else if (result.closedInUploader) {
    progressDialog?.updateStepStatus(accountId, 'closeAccount', 'success', `Closed in uploader (${options.closedDate})`);
  } else {
    progressDialog?.updateStepStatus(accountId, 'closeAccount', 'error', result.monarchError || 'Failed to close');
  }

  return result;
}
