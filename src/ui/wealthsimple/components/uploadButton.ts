/**
 * Wealthsimple Upload Button Component
 * Creates upload button styled for Wealthsimple branding with context-aware labels
 */

import { debugLog } from '../../../core/utils';
import { COLORS } from '../../../core/config';
import type { CurrentBalance } from '../../../types/monarch';
import wealthsimpleApi from '../../../api/wealthsimple';
import toast from '../../toast';
import {
  uploadAllWealthsimpleAccountsToMonarch,
  uploadWealthsimpleAccountToMonarchWithSteps,
  buildSyncStepsForAccount,
  type SyncResult,
} from '../../../services/wealthsimple-upload';
import { ensureMonarchAuthentication } from '../../components/monarchLoginLink';
import { syncAccountListWithAPI, type ConsolidatedAccount } from '../../../services/wealthsimple/account';
import { getDefaultDateRange } from '../../../services/wealthsimple/balance';
import { WEALTHSIMPLE_SYNC_GROUP_LABELS, type WealthsimpleSyncGroup } from '../../../mappers/wealthsimple-account-types';
import { showProgressDialog } from '../../components/progressDialog';
import { createSyncGroupMenu, type SyncGroupMenu } from './syncGroupMenu';

interface ButtonOptions {
  color?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}

interface BalanceResult {
  success: boolean;
  balances: Map<string, CurrentBalance | null>;
  [key: string]: unknown;
}

/**
 * Determine button label based on current page
 */
function getButtonLabel(): string {
  const pathname = window.location.pathname;

  // Check if on account detail page
  if (pathname.includes('/app/account-details/')) {
    return 'Sync to Monarch'; // Single account
  }

  // Default for home page and other pages
  return 'Sync All to Monarch'; // All accounts
}

/**
 * Get current account ID from URL if on account detail page
 */
function getCurrentAccountId(): string | null {
  const pathname = window.location.pathname;
  const match = pathname.match(/\/app\/account-details\/([^/]+)/);
  return match ? match[1] : null;
}

/**
 * Creates a styled button for Wealthsimple
 */
function createWealthsimpleButton(text: string, onClick: (() => void) | null, options: ButtonOptions = {}): HTMLButtonElement {
  const button = document.createElement('button');
  button.textContent = text;
  button.style.cssText = `
    background-color: ${options.color || `var(--mu-ws-button-bg, ${COLORS.WEALTHSIMPLE_BRAND})`};
    color: ${options.color ? 'white' : 'var(--mu-ws-button-text, white)'};
    border: none;
    border-radius: 12px;
    padding: 10px 16px;
    margin: 5px 0;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
    font-family: "Wealthsimple Sans", sans-serif;
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
      button.style.opacity = '0.85';
    }
  });

  button.addEventListener('mouseout', () => {
    if (!button.disabled) {
      button.style.opacity = '1';
    }
  });

  // Add click handler
  if (onClick && !options.disabled) {
    button.addEventListener('click', onClick);
  }

  return button;
}

/**
 * Upload a single Wealthsimple account with progress dialog
 */
async function uploadSingleAccountWithProgress(accountId: string): Promise<void> {
  let progressDialog: ReturnType<typeof showProgressDialog> | null = null;
  let isCancelled = false;

  try {
    // Sync account list with API to get consolidated account data
    const consolidatedAccounts: ConsolidatedAccount[] = await syncAccountListWithAPI() as unknown as ConsolidatedAccount[];
    const consolidatedAccount = consolidatedAccounts.find(
      (acc) => acc.wealthsimpleAccount.id === accountId,
    );

    if (!consolidatedAccount) {
      throw new Error('Account not found');
    }

    const account = consolidatedAccount.wealthsimpleAccount;

    // Prepare account for progress dialog
    const accountsForDialog = [{
      key: account.id,
      nickname: account.nickname,
      name: account.nickname || account.id,
    }];

    // Create progress dialog for single account
    progressDialog = showProgressDialog(accountsForDialog, `Syncing ${account.nickname || 'Account'} to Monarch`);

    // Set up cancel callback
    progressDialog.onCancel(() => {
      debugLog('Upload cancellation requested');
      isCancelled = true;
      toast.show('Upload cancelled by user', 'info');
    });

    // Fetch balance for this specific account
    const balanceResult: BalanceResult = await wealthsimpleApi.fetchAccountBalances([account]) as unknown as BalanceResult;
    if (!balanceResult.success) {
      throw new Error('Failed to fetch account balance');
    }

    const currentBalance = balanceResult.balances.get(accountId);

    // Check if balance is unavailable
    if (currentBalance === null || currentBalance === undefined) {
      debugLog(`Account ${accountId} (${account.nickname}) - balance unavailable`);
      progressDialog.updateProgress(accountId, 'error', 'Balance unavailable');
      progressDialog.hideCancel();
      return;
    }

    // Initialize steps for this account
    const steps = buildSyncStepsForAccount(consolidatedAccount);
    progressDialog.initSteps(accountId, steps);

    // Check for cancellation before upload
    if (isCancelled) {
      progressDialog.hideCancel();
      return;
    }

    // Use the same date range logic as the home page upload
    const { fromDate, toDate } = getDefaultDateRange(consolidatedAccount);
    debugLog(`Account page upload using date range: ${fromDate} to ${toDate}`);

    // Process the account with step-by-step progress tracking
    const result: SyncResult = await uploadWealthsimpleAccountToMonarchWithSteps(
      consolidatedAccount,
      fromDate,
      toDate,
      currentBalance,
      progressDialog,
    ) as unknown as SyncResult;

    // Show summary
    if (result && result.cancelled) {
      progressDialog.showSummary({ success: 0, failed: 0, skipped: 1 });
    } else if (result && result.skipped) {
      progressDialog.showSummary({ success: 0, failed: 0, skipped: 1 });
    } else if (result && result.success) {
      progressDialog.showSummary({ success: 1, failed: 0, skipped: 0 });
      toast.show(`Successfully synced ${account.nickname || 'account'}`, 'info');
    } else {
      progressDialog.showSummary({ success: 0, failed: 1, skipped: 0 });
    }

    progressDialog.hideCancel();
  } catch (error) {
    debugLog('Error in single account sync:', error);
    toast.show(`Sync failed: ${(error as Error).message}`, 'error');

    // Clean up progress dialog on error
    if (progressDialog) {
      progressDialog.hideCancel();
    }
  }
}

/**
 * Run a bulk sync (every account, or one group) while the split button shows
 * it is busy. The sync dialog takes a moment to appear, so the label changes
 * first.
 */
async function runBulkSync(
  uploadButton: HTMLButtonElement,
  groupMenu: SyncGroupMenu | null,
  group: WealthsimpleSyncGroup | null,
): Promise<void> {
  uploadButton.disabled = true;
  groupMenu?.setDisabled(true);
  uploadButton.textContent = group ? `Syncing ${WEALTHSIMPLE_SYNC_GROUP_LABELS[group]}...` : 'Syncing all...';
  try {
    await uploadAllWealthsimpleAccountsToMonarch(group);
  } finally {
    // Re-enable after the sync, relabelled for wherever we are now
    uploadButton.disabled = false;
    groupMenu?.setDisabled(false);
    uploadButton.textContent = getButtonLabel();
  }
}

/**
 * Turn the main button and the chevron toggle into one split button: the
 * touching corners are squared off and a 2px gap separates the halves, which
 * reads as a divider in both themes without drawing a line.
 */
function styleAsSplitButton(uploadButton: HTMLButtonElement, toggle: HTMLButtonElement): void {
  toggle.style.cssText = uploadButton.style.cssText;
  uploadButton.style.borderRadius = '12px 4px 4px 12px';
  toggle.style.borderRadius = '4px 12px 12px 4px';
  // Centre the icon in a near-square half instead of padding around text
  toggle.style.display = 'inline-flex';
  toggle.style.alignItems = 'center';
  toggle.style.justifyContent = 'center';
  toggle.style.padding = '0';
  toggle.style.width = '40px';
  toggle.addEventListener('mouseover', () => { if (!toggle.disabled) toggle.style.opacity = '0.85'; });
  toggle.addEventListener('mouseout', () => { toggle.style.opacity = '1'; });
}

/**
 * Fixed height for upload button container to prevent UI jumps
 */
const UPLOAD_BUTTON_CONTAINER_HEIGHT = '42px';

/**
 * Creates the main upload button for Wealthsimple
 */
export function createWealthsimpleUploadButton(): HTMLElement {
  const container = document.createElement('div');
  container.id = 'wealthsimple-upload-button-container';
  container.className = 'wealthsimple-upload-button-container';
  container.style.cssText = `margin: 8px 0; min-height: ${UPLOAD_BUTTON_CONTAINER_HEIGHT};`;

  // Check authentication status
  const authStatus = wealthsimpleApi.checkAuth();

  if (!authStatus.authenticated) {
    // Show message if not authenticated
    const message = document.createElement('div');
    message.id = 'wealthsimple-auth-message';
    message.textContent = 'Please log in to Wealthsimple to enable sync functionality';
    message.style.cssText = `
      padding: 10px 12px;
      background-color: var(--mu-warning-bg, #fff3cd);
      color: var(--mu-warning-text, #856404);
      border: 1px solid var(--mu-warning-border, #ffeaa7);
      border-radius: 4px;
      font-size: 13px;
      margin: 5px 0;
      font-family: "Wealthsimple Sans", sans-serif;
      min-height: 20px;
      box-sizing: border-box;
    `;
    container.appendChild(message);
    return container;
  }

  // Get context-aware button label
  const buttonLabel = getButtonLabel();

  // Set once the button exists; only bulk-sync pages get the group menu
  let groupMenu: SyncGroupMenu | null = null;

  // Create upload button
  const uploadButton = createWealthsimpleButton(buttonLabel, async () => {
    // Check Monarch authentication before proceeding
    const authenticated = await ensureMonarchAuthentication(null, 'sync Wealthsimple accounts');
    if (!authenticated) {
      return; // User cancelled authentication
    }

    // Resolve the sync target at click time, not at creation time. Wealthsimple
    // can navigate account -> account without this button being recreated, and a
    // captured id would sync the balance into whichever account was open when
    // the button was built.
    const accountId = getCurrentAccountId();

    try {
      debugLog(`Starting Wealthsimple sync... (account detail page: ${Boolean(accountId)}, accountId: ${accountId ?? 'none'})`);

      if (accountId) {
        // Sync single account with progress dialog
        await uploadSingleAccountWithProgress(accountId);
      } else {
        await runBulkSync(uploadButton, groupMenu, null);
      }
    } catch (error) {
      debugLog('Error in Wealthsimple sync:', error);
      toast.show(`Sync failed: ${(error as Error).message}`, 'error');
    }
  }, { id: 'wealthsimple-upload-button' });

  // Account pages sync one account, so only the bulk-sync button splits.
  // The uiManager rebuilds this button whenever the path changes.
  if (getCurrentAccountId()) {
    container.appendChild(uploadButton);
    return container;
  }

  groupMenu = createSyncGroupMenu({
    onSelect: async (group) => {
      const authenticated = await ensureMonarchAuthentication(null, 'sync Wealthsimple accounts');
      if (!authenticated) return;
      try {
        debugLog(`Starting Wealthsimple group sync (group: ${group})`);
        await runBulkSync(uploadButton, groupMenu, group);
      } catch (error) {
        debugLog(`Error in Wealthsimple group sync (group: ${group}):`, error);
        toast.show(`Sync failed: ${(error as Error).message}`, 'error');
      }
    },
  });
  styleAsSplitButton(uploadButton, groupMenu.toggle);

  const splitButton = document.createElement('div');
  splitButton.id = 'wealthsimple-upload-split-button';
  splitButton.style.cssText = 'display: inline-flex; align-items: stretch; gap: 2px;';
  splitButton.append(uploadButton, groupMenu.toggle);
  container.appendChild(splitButton);

  return container;
}

