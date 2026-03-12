/**
 * Settings Modal - Account Card Components
 * Per-account settings, transaction management, holdings mappings, and debug sections
 */

import { debugLog, getLookbackForInstitution, validateLookbackVsRetention, getTodayLocal } from '../../core/utils';
import toast from '../toast';
import {
  ACCOUNT_SETTINGS,
  getCapabilities,
  getAccountKeyName,
  getDisplayName,
  getFaviconUrl,
  hasSetting,
  getSettingDefault,
  hasCapability,
} from '../../core/integrationCapabilities';
import accountService from '../../services/common/accountService';
import {
  showConfirmDialog,
  addAccountLogoFallback,
  formatLastUpdateDate,
  createToggleSwitch,
  renderDebugJsonSection,
} from './settingsModalHelpers';

declare function GM_addElement(parent: HTMLElement, tag: string, attrs: Record<string, string>): HTMLElement;

interface AccountEntry {
  storeTransactionDetailsInNotes?: boolean;
  stripStoreNumbers?: boolean;
  includePendingTransactions?: boolean;
  transactionRetentionDays?: number;
  transactionRetentionCount?: number;
  invertBalance?: boolean;
  skipCategorization?: boolean;
  syncEnabled?: boolean;
  lastSyncDate?: string;
  monarchAccount?: {
    displayName?: string;
    name?: string;
    [key: string]: unknown;
  } | null;
  uploadedTransactions?: TransactionRef[];
  holdingsMappings?: Record<string, HoldingMapping>;
  [key: string]: unknown;
}

interface TransactionRef {
  id: string;
  date?: string;
}

interface HoldingMapping {
  symbol?: string;
  securityId?: string;
  holdingId?: string;
  [key: string]: unknown;
}

interface SourceAccount {
  id?: string;
  nickname?: string;
  name?: string;
  type?: string;
  status?: string;
  [key: string]: unknown;
}

/**
 * Renders the account settings section based on integration capabilities
 */
export function renderAccountSettingsSection(
  integrationId: string,
  accountEntry: AccountEntry,
  accountId: string,
  onUpdate: (() => void) | null,
): HTMLElement {
  const settingsSection = document.createElement('div');
  settingsSection.id = `account-settings-section-${accountId}`;
  settingsSection.style.cssText = 'margin-bottom: 15px;';

  const settingsTitle = document.createElement('h4');
  settingsTitle.textContent = 'Account Settings';
  settingsTitle.style.cssText = 'margin: 0 0 10px 0; font-size: 14px; color: var(--mu-text-primary, #333);';
  settingsSection.appendChild(settingsTitle);

  const capabilities = getCapabilities(integrationId);
  if (!capabilities || capabilities.settings.length === 0) {
    const noSettingsMsg = document.createElement('div');
    noSettingsMsg.style.cssText = 'font-size: 13px; color: var(--mu-text-secondary, #666); font-style: italic;';
    noSettingsMsg.textContent = 'No configurable settings for this integration.';
    settingsSection.appendChild(noSettingsMsg);
    return settingsSection;
  }

  if (hasSetting(integrationId, ACCOUNT_SETTINGS.STORE_TX_DETAILS_IN_NOTES)) {
    const setting = createBooleanSetting(
      `setting-tx-details-${accountId}`,
      'Store transaction details in notes',
      'When enabled, transaction details will be included in the Notes field',
      accountEntry.storeTransactionDetailsInNotes ?? Boolean(getSettingDefault(integrationId, ACCOUNT_SETTINGS.STORE_TX_DETAILS_IN_NOTES)),
      (isEnabled: boolean) => {
        const success = accountService.updateAccountInList(integrationId, accountId, { storeTransactionDetailsInNotes: isEnabled });
        if (success) {
          toast.show(`Transaction details in notes ${isEnabled ? 'enabled' : 'disabled'}`, 'info');
        } else {
          toast.show('Failed to update setting', 'error');
        }
      },
    );
    settingsSection.appendChild(setting);
  }

  if (hasSetting(integrationId, ACCOUNT_SETTINGS.STRIP_STORE_NUMBERS)) {
    const setting = createBooleanSetting(
      `setting-strip-store-${accountId}`,
      'Strip store numbers from merchants',
      'Remove store numbers from merchant names (e.g., "WALMART #1234" → "WALMART")',
      accountEntry.stripStoreNumbers ?? Boolean(getSettingDefault(integrationId, ACCOUNT_SETTINGS.STRIP_STORE_NUMBERS)),
      (isEnabled: boolean) => {
        const success = accountService.updateAccountInList(integrationId, accountId, { stripStoreNumbers: isEnabled });
        if (success) {
          toast.show(`Store number stripping ${isEnabled ? 'enabled' : 'disabled'}`, 'info');
        } else {
          toast.show('Failed to update setting', 'error');
        }
      },
    );
    settingsSection.appendChild(setting);
  }

  if (hasSetting(integrationId, ACCOUNT_SETTINGS.INCLUDE_PENDING_TRANSACTIONS)) {
    const setting = createBooleanSetting(
      `setting-pending-${accountId}`,
      'Include pending transactions',
      'When enabled, authorized (pending) transactions are included with a "Pending" tag',
      accountEntry.includePendingTransactions ?? Boolean(getSettingDefault(integrationId, ACCOUNT_SETTINGS.INCLUDE_PENDING_TRANSACTIONS)),
      (isEnabled: boolean) => {
        const success = accountService.updateAccountInList(integrationId, accountId, { includePendingTransactions: isEnabled });
        if (success) {
          toast.show(`Pending transactions ${isEnabled ? 'enabled' : 'disabled'}`, 'info');
        } else {
          toast.show('Failed to update setting', 'error');
        }
      },
    );
    settingsSection.appendChild(setting);
  }

  if (hasSetting(integrationId, ACCOUNT_SETTINGS.TRANSACTION_RETENTION_DAYS)) {
    const defaultRetentionDays = getSettingDefault(integrationId, ACCOUNT_SETTINGS.TRANSACTION_RETENTION_DAYS) as number;
    const currentRetentionDays = accountEntry.transactionRetentionDays ?? defaultRetentionDays;

    const retentionDaysSetting = document.createElement('div');
    retentionDaysSetting.id = `setting-retention-days-${accountId}`;
    retentionDaysSetting.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: var(--mu-bg-primary, white); border-radius: 6px; margin-bottom: 8px;';

    const retentionDaysLabel = document.createElement('div');
    retentionDaysLabel.innerHTML = `
      <div style="font-weight: 500; font-size: 13px;">Transaction retention days</div>
      <div style="font-size: 11px; color: var(--mu-text-secondary, #666);">Number of days to keep transaction IDs for deduplication (0 = unlimited)</div>
    `;

    const retentionDaysInputContainer = document.createElement('div');
    retentionDaysInputContainer.style.cssText = 'display: flex; align-items: center; gap: 4px;';

    const retentionDaysInput = document.createElement('input');
    retentionDaysInput.type = 'number';
    retentionDaysInput.min = '0';
    retentionDaysInput.max = '3650';
    retentionDaysInput.value = String(currentRetentionDays);
    retentionDaysInput.style.cssText = 'width: 70px; padding: 4px 8px; border: 1px solid var(--mu-input-border, #ccc); border-radius: 4px; font-size: 13px; background: var(--mu-input-bg, white); color: var(--mu-text-primary, #333);';

    retentionDaysInput.addEventListener('change', () => {
      const value = parseInt(retentionDaysInput.value, 10);
      const previousValue = accountEntry.transactionRetentionDays ?? defaultRetentionDays;
      if (Number.isNaN(value) || value < 0) {
        retentionDaysInput.value = String(previousValue);
        toast.show('Please enter a valid number (0 or greater)', 'error');
        return;
      }

      const currentLookback = getLookbackForInstitution(integrationId);
      const validation = validateLookbackVsRetention(currentLookback, value);
      if (!validation.valid) {
        retentionDaysInput.value = String(previousValue);
        toast.show(`Retention period (${value} days) must be greater than lookback period (${currentLookback} days)`, 'error');
        return;
      }

      const success = accountService.updateAccountInList(integrationId, accountId, { transactionRetentionDays: value });
      if (success) {
        toast.show(`Transaction retention days set to ${value === 0 ? 'unlimited' : value}`, 'info');
        if (onUpdate) onUpdate();
      } else {
        toast.show('Failed to update setting', 'error');
      }
    });

    const daysLabel = document.createElement('span');
    daysLabel.textContent = 'days';
    daysLabel.style.cssText = 'font-size: 12px; color: var(--mu-text-secondary, #666);';

    retentionDaysInputContainer.appendChild(retentionDaysInput);
    retentionDaysInputContainer.appendChild(daysLabel);

    retentionDaysSetting.appendChild(retentionDaysLabel);
    retentionDaysSetting.appendChild(retentionDaysInputContainer);
    retentionDaysSetting.addEventListener('click', (e: Event) => e.stopPropagation());
    settingsSection.appendChild(retentionDaysSetting);
  }

  if (hasSetting(integrationId, ACCOUNT_SETTINGS.INVERT_BALANCE)) {
    const setting = createBooleanSetting(
      `setting-invert-balance-${accountId}`,
      'Invert balance values',
      'Negate balance values before uploading. Enable for manually created accounts where the bank reports negative balances.',
      accountEntry.invertBalance ?? Boolean(getSettingDefault(integrationId, ACCOUNT_SETTINGS.INVERT_BALANCE)),
      (isEnabled: boolean) => {
        const success = accountService.updateAccountInList(integrationId, accountId, { invertBalance: isEnabled });
        if (success) {
          toast.show(`Balance inversion ${isEnabled ? 'enabled' : 'disabled'}`, 'info');
        } else {
          toast.show('Failed to update setting', 'error');
        }
      },
    );
    settingsSection.appendChild(setting);
  }

  if (hasSetting(integrationId, ACCOUNT_SETTINGS.SKIP_CATEGORIZATION)) {
    const setting = createBooleanSetting(
      `setting-skip-categorization-${accountId}`,
      'Skip manual categorization',
      'When enabled, transactions sync without category prompts. Monarch will apply its own categorization rules.',
      accountEntry.skipCategorization ?? Boolean(getSettingDefault(integrationId, ACCOUNT_SETTINGS.SKIP_CATEGORIZATION)),
      (isEnabled: boolean) => {
        const success = accountService.updateAccountInList(integrationId, accountId, { skipCategorization: isEnabled });
        if (success) {
          toast.show(`Manual categorization ${isEnabled ? 'disabled' : 'enabled'}`, 'info');
        } else {
          toast.show('Failed to update setting', 'error');
        }
      },
    );
    settingsSection.appendChild(setting);
  }

  if (hasSetting(integrationId, ACCOUNT_SETTINGS.TRANSACTION_RETENTION_COUNT)) {
    const defaultRetentionCount = getSettingDefault(integrationId, ACCOUNT_SETTINGS.TRANSACTION_RETENTION_COUNT) as number;
    const currentRetentionCount = accountEntry.transactionRetentionCount ?? defaultRetentionCount;

    const retentionCountSetting = document.createElement('div');
    retentionCountSetting.id = `setting-retention-count-${accountId}`;
    retentionCountSetting.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: var(--mu-bg-primary, white); border-radius: 6px; margin-bottom: 8px;';

    const retentionCountLabel = document.createElement('div');
    retentionCountLabel.innerHTML = `
      <div style="font-weight: 500; font-size: 13px;">Transaction retention count</div>
      <div style="font-size: 11px; color: var(--mu-text-secondary, #666);">Maximum number of transaction IDs to keep (0 = unlimited)</div>
    `;

    const retentionCountInputContainer = document.createElement('div');
    retentionCountInputContainer.style.cssText = 'display: flex; align-items: center; gap: 4px;';

    const retentionCountInput = document.createElement('input');
    retentionCountInput.type = 'number';
    retentionCountInput.min = '0';
    retentionCountInput.max = '100000';
    retentionCountInput.value = String(currentRetentionCount);
    retentionCountInput.style.cssText = 'width: 70px; padding: 4px 8px; border: 1px solid var(--mu-input-border, #ccc); border-radius: 4px; font-size: 13px; background: var(--mu-input-bg, white); color: var(--mu-text-primary, #333);';

    retentionCountInput.addEventListener('change', () => {
      const value = parseInt(retentionCountInput.value, 10);
      if (Number.isNaN(value) || value < 0) {
        retentionCountInput.value = String(currentRetentionCount);
        toast.show('Please enter a valid number (0 or greater)', 'error');
        return;
      }

      const success = accountService.updateAccountInList(integrationId, accountId, { transactionRetentionCount: value });
      if (success) {
        toast.show(`Transaction retention count set to ${value === 0 ? 'unlimited' : value}`, 'info');
        if (onUpdate) onUpdate();
      } else {
        toast.show('Failed to update setting', 'error');
      }
    });

    const countLabel = document.createElement('span');
    countLabel.textContent = 'IDs';
    countLabel.style.cssText = 'font-size: 12px; color: var(--mu-text-secondary, #666);';

    retentionCountInputContainer.appendChild(retentionCountInput);
    retentionCountInputContainer.appendChild(countLabel);

    retentionCountSetting.appendChild(retentionCountLabel);
    retentionCountSetting.appendChild(retentionCountInputContainer);
    retentionCountSetting.addEventListener('click', (e: Event) => e.stopPropagation());
    settingsSection.appendChild(retentionCountSetting);
  }

  return settingsSection;
}

/**
 * Helper to create a boolean toggle setting row
 */
function createBooleanSetting(
  id: string,
  title: string,
  description: string,
  currentValue: boolean,
  onChange: (isEnabled: boolean) => void,
): HTMLElement {
  const setting = document.createElement('div');
  setting.id = id;
  setting.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: var(--mu-bg-primary, white); border-radius: 6px; margin-bottom: 8px;';

  const labelDiv = document.createElement('div');
  labelDiv.innerHTML = `
    <div style="font-weight: 500; font-size: 13px;">${title}</div>
    <div style="font-size: 11px; color: var(--mu-text-secondary, #666);">${description}</div>
  `;

  const toggle = createToggleSwitch(currentValue, onChange, false);

  setting.appendChild(labelDiv);
  setting.appendChild(toggle);
  setting.addEventListener('click', (e: Event) => e.stopPropagation());
  return setting;
}

/**
 * Renders the transactions management section for deduplication
 */
export function renderTransactionsManagementSection(
  integrationId: string,
  accountEntry: AccountEntry,
  accountId: string,
  onRefresh: (() => void) | null,
): HTMLElement {
  const capabilities = getCapabilities(integrationId);

  if (!capabilities || !capabilities.hasDeduplication) {
    return document.createElement('div');
  }

  const sectionContainer = document.createElement('div');
  sectionContainer.id = `transactions-section-${integrationId}-${accountId}`;
  sectionContainer.style.cssText = 'margin-bottom: 15px;';

  const uploadedTransactions: TransactionRef[] = (accountEntry.uploadedTransactions || []) as TransactionRef[];

  const sectionHeader = createCollapsibleHeader(
    `transactions-${integrationId}-${accountId}`,
    'Uploaded Transactions',
    `(${uploadedTransactions.length} stored)`,
  );
  sectionContainer.appendChild(sectionHeader.header);

  const expandableContent = document.createElement('div');
  expandableContent.id = `transactions-content-${integrationId}-${accountId}`;
  expandableContent.style.cssText = `
    display: none;
    padding: 12px;
    border: 1px solid var(--mu-border, #e0e0e0);
    border-top: none;
    border-radius: 0 0 6px 6px;
    background-color: var(--mu-bg-primary, #fff);
  `;

  if (uploadedTransactions.length === 0) {
    const emptyMessage = document.createElement('p');
    emptyMessage.textContent = 'No uploaded transaction IDs stored. Transactions will appear here after syncing.';
    emptyMessage.style.cssText = 'color: var(--mu-text-secondary, #666); font-style: italic; margin: 0; font-size: 13px;';
    expandableContent.appendChild(emptyMessage);
  } else {
    buildTransactionsContent(expandableContent, integrationId, accountId, uploadedTransactions, onRefresh);
  }

  sectionContainer.appendChild(expandableContent);
  setupCollapsible(sectionHeader, expandableContent);

  return sectionContainer;
}

/**
 * Build the transactions management content (bulk actions, list, etc.)
 */
function buildTransactionsContent(
  container: HTMLElement,
  integrationId: string,
  accountId: string,
  uploadedTransactions: TransactionRef[],
  onRefresh: (() => void) | null,
): void {
  const bulkActions = document.createElement('div');
  bulkActions.id = `transactions-bulk-actions-${integrationId}-${accountId}`;
  bulkActions.style.cssText = 'margin-bottom: 12px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap;';

  const addBtn = createSmallButton(`transactions-add-btn-${integrationId}-${accountId}`, 'Add', '#28a745', true);
  const selectAllBtn = createSmallButton(`transactions-select-all-btn-${integrationId}-${accountId}`, 'Select All');
  const selectNoneBtn = createSmallButton(`transactions-select-none-btn-${integrationId}-${accountId}`, 'Select None');
  const deleteSelectedBtn = createSmallButton(`transactions-delete-selected-btn-${integrationId}-${accountId}`, 'Delete Selected', '#dc3545');
  const deleteAllBtn = createSmallButton(`transactions-delete-all-btn-${integrationId}-${accountId}`, 'Delete All', '#dc3545');
  deleteAllBtn.style.marginLeft = 'auto';

  bulkActions.appendChild(addBtn);
  bulkActions.appendChild(selectAllBtn);
  bulkActions.appendChild(selectNoneBtn);
  bulkActions.appendChild(deleteSelectedBtn);
  bulkActions.appendChild(deleteAllBtn);
  container.appendChild(bulkActions);

  // Add input area
  const addInputArea = document.createElement('div');
  addInputArea.id = `transactions-add-input-${integrationId}-${accountId}`;
  addInputArea.style.cssText = 'display: none; margin-bottom: 12px; padding: 12px; background-color: var(--mu-bg-secondary, #f8f9fa); border: 1px solid var(--mu-border, #e0e0e0); border-radius: 4px;';

  const inputLabel = document.createElement('label');
  inputLabel.textContent = 'Add Transaction IDs:';
  inputLabel.style.cssText = 'display: block; margin-bottom: 8px; font-weight: bold; font-size: 13px;';
  addInputArea.appendChild(inputLabel);

  const textarea = document.createElement('textarea');
  textarea.id = `transactions-textarea-${integrationId}-${accountId}`;
  textarea.placeholder = 'Enter transaction IDs (one per line or comma-separated)';
  textarea.style.cssText = 'width: 100%; min-height: 80px; padding: 8px; border: 1px solid var(--mu-input-border, #ccc); border-radius: 4px; font-family: monospace; font-size: 13px; resize: vertical; box-sizing: border-box; background: var(--mu-input-bg, white); color: var(--mu-text-primary, #333);';
  addInputArea.appendChild(textarea);

  const inputButtonContainer = document.createElement('div');
  inputButtonContainer.style.cssText = 'margin-top: 10px; display: flex; gap: 8px;';
  const saveBtn = createSmallButton(`transactions-save-btn-${integrationId}-${accountId}`, 'Save', '#28a745');
  const cancelInputBtn = createSmallButton(`transactions-cancel-input-btn-${integrationId}-${accountId}`, 'Cancel');
  inputButtonContainer.appendChild(saveBtn);
  inputButtonContainer.appendChild(cancelInputBtn);
  addInputArea.appendChild(inputButtonContainer);
  container.appendChild(addInputArea);

  // Transaction list
  const transactionsList = document.createElement('div');
  transactionsList.id = `transactions-list-${integrationId}-${accountId}`;
  transactionsList.style.cssText = 'max-height: 250px; overflow-y: auto; border: 1px solid var(--mu-border, #e0e0e0); border-radius: 4px;';

  uploadedTransactions.forEach((tx, txIndex) => {
    const txRow = document.createElement('div');
    txRow.id = `transaction-row-${integrationId}-${accountId}-${txIndex}`;
    txRow.style.cssText = `display: flex; align-items: center; padding: 8px 10px; border-bottom: 1px solid var(--mu-border, #f0f0f0); background: ${txIndex % 2 === 0 ? 'var(--mu-bg-primary, #fff)' : 'var(--mu-bg-secondary, #fafafa)'};`;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.style.cssText = 'margin-right: 10px;';
    checkbox.dataset.txIndex = String(txIndex);
    checkbox.dataset.txId = typeof tx === 'object' ? tx.id : String(tx);

    const txDisplay = document.createElement('div');
    txDisplay.style.cssText = 'display: flex; align-items: center; gap: 8px;';

    if (typeof tx === 'object' && tx !== null && tx.id) {
      if (tx.date) {
        const dateBadge = document.createElement('span');
        dateBadge.textContent = tx.date;
        dateBadge.style.cssText = 'background-color: var(--mu-badge-bg, #e3f2fd); color: var(--mu-badge-text, #1565c0); padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 500;';
        txDisplay.appendChild(dateBadge);
      }
      const idText = document.createElement('span');
      idText.textContent = tx.id;
      idText.style.cssText = 'font-family: monospace; font-size: 13px; color: var(--mu-text-primary, #333);';
      txDisplay.appendChild(idText);
    } else {
      const txText = document.createElement('span');
      txText.textContent = typeof tx === 'object' ? JSON.stringify(tx) : String(tx);
      txText.style.cssText = 'font-family: monospace; font-size: 13px;';
      txDisplay.appendChild(txText);
    }

    txRow.appendChild(checkbox);
    txRow.appendChild(txDisplay);
    transactionsList.appendChild(txRow);
  });

  container.appendChild(transactionsList);

  // Event handlers
  let isAddingMode = false;

  addBtn.addEventListener('click', (e: Event) => {
    e.stopPropagation();
    isAddingMode = !isAddingMode;
    addInputArea.style.display = isAddingMode ? 'block' : 'none';
    addBtn.textContent = isAddingMode ? 'Cancel' : 'Add';
    addBtn.style.borderColor = isAddingMode ? '#dc3545' : '#28a745';
    addBtn.style.color = isAddingMode ? '#dc3545' : '#28a745';
    if (!isAddingMode) textarea.value = '';
  });

  saveBtn.addEventListener('click', (e: Event) => {
    e.stopPropagation();
    const inputValue = textarea.value.trim();
    if (!inputValue) {
      toast.show('Please enter at least one transaction ID', 'warning');
      return;
    }

    const newIds = inputValue.split(/[\n,]/).map((id) => id.trim()).filter((id) => id.length > 0);
    if (newIds.length === 0) {
      toast.show('No valid transaction IDs found', 'warning');
      return;
    }

    const existingIds = new Set(uploadedTransactions.map((tx) => (typeof tx === 'object' ? tx.id : String(tx))));
    const duplicates: string[] = [];
    const uniqueNewIds: string[] = [];

    newIds.forEach((id) => {
      if (existingIds.has(id)) {
        duplicates.push(id);
      } else if (!uniqueNewIds.includes(id)) {
        uniqueNewIds.push(id);
      }
    });

    if (uniqueNewIds.length === 0) {
      toast.show('All transaction IDs already exist', 'warning');
      return;
    }

    const today = getTodayLocal();
    const newTransactions = uniqueNewIds.map((id) => ({ id, date: today }));
    const updatedTransactions = [...uploadedTransactions, ...newTransactions];

    const success = accountService.updateAccountInList(integrationId, accountId, { uploadedTransactions: updatedTransactions });
    if (success) {
      let message = `Added ${uniqueNewIds.length} transaction ID(s)`;
      if (duplicates.length > 0) message += ` (${duplicates.length} duplicate(s) skipped)`;
      toast.show(message, 'info');
      debugLog(`Added ${uniqueNewIds.length} transaction IDs to ${accountId}`);
      textarea.value = '';
      isAddingMode = false;
      addInputArea.style.display = 'none';
      addBtn.textContent = 'Add';
      addBtn.style.borderColor = '#28a745';
      addBtn.style.color = '#28a745';
      if (onRefresh) setTimeout(onRefresh, 300);
    } else {
      toast.show('Error adding transaction IDs', 'error');
    }
  });

  cancelInputBtn.addEventListener('click', (e: Event) => {
    e.stopPropagation();
    textarea.value = '';
    isAddingMode = false;
    addInputArea.style.display = 'none';
    addBtn.textContent = 'Add';
    addBtn.style.borderColor = '#28a745';
    addBtn.style.color = '#28a745';
  });

  selectAllBtn.addEventListener('click', (e: Event) => {
    e.stopPropagation();
    const checkboxes = transactionsList.querySelectorAll('input[type="checkbox"]') as NodeListOf<HTMLInputElement>;
    checkboxes.forEach((cb) => { cb.checked = true; });
  });

  selectNoneBtn.addEventListener('click', (e: Event) => {
    e.stopPropagation();
    const checkboxes = transactionsList.querySelectorAll('input[type="checkbox"]') as NodeListOf<HTMLInputElement>;
    checkboxes.forEach((cb) => { cb.checked = false; });
  });

  deleteSelectedBtn.addEventListener('click', async (e: Event) => {
    e.stopPropagation();
    const selectedCheckboxes = Array.from(transactionsList.querySelectorAll('input[type="checkbox"]:checked')) as HTMLInputElement[];
    if (selectedCheckboxes.length === 0) {
      toast.show('No transactions selected', 'warning');
      return;
    }

    const confirmed = await showConfirmDialog(`Are you sure you want to delete ${selectedCheckboxes.length} selected transaction reference(s)?`);
    if (confirmed) {
      const indicesToRemove = selectedCheckboxes
        .map((cb) => parseInt(cb.dataset.txIndex || '0', 10))
        .sort((a, b) => b - a);

      const updatedTransactions = [...uploadedTransactions];
      indicesToRemove.forEach((idx) => {
        if (idx >= 0 && idx < updatedTransactions.length) {
          updatedTransactions.splice(idx, 1);
        }
      });

      const success = accountService.updateAccountInList(integrationId, accountId, { uploadedTransactions: updatedTransactions });
      if (success) {
        toast.show(`Deleted ${selectedCheckboxes.length} transaction reference(s)`, 'info');
        if (onRefresh) setTimeout(onRefresh, 300);
      } else {
        toast.show('Error deleting transactions', 'error');
      }
    }
  });

  deleteAllBtn.addEventListener('click', async (e: Event) => {
    e.stopPropagation();
    const confirmed = await showConfirmDialog(`Are you sure you want to delete ALL ${uploadedTransactions.length} transaction references?\n\nThis will allow all transactions to be re-uploaded.`);
    if (confirmed) {
      const success = accountService.updateAccountInList(integrationId, accountId, { uploadedTransactions: [] });
      if (success) {
        toast.show('All transaction references cleared', 'info');
        if (onRefresh) setTimeout(onRefresh, 300);
      } else {
        toast.show('Error clearing transactions', 'error');
      }
    }
  });
}

/**
 * Helper to create a collapsible section header
 */
function createCollapsibleHeader(
  idPrefix: string,
  title: string,
  countText: string,
): { header: HTMLElement; expandIcon: HTMLSpanElement } {
  const sectionHeader = document.createElement('div');
  sectionHeader.id = `${idPrefix}-header`;
  sectionHeader.style.cssText = `
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 12px; background-color: var(--mu-bg-primary, #fff);
    border: 1px solid var(--mu-border, #e0e0e0); border-radius: 6px;
    cursor: pointer; transition: background-color 0.2s;
  `;

  const headerLeft = document.createElement('div');
  headerLeft.style.cssText = 'display: flex; align-items: center; gap: 8px;';

  const expandIcon = document.createElement('span');
  expandIcon.id = `${idPrefix}-expand-icon`;
  expandIcon.textContent = '▼';
  expandIcon.style.cssText = 'transition: transform 0.2s; font-size: 12px; transform: rotate(270deg);';
  headerLeft.appendChild(expandIcon);

  const headerTitle = document.createElement('h4');
  headerTitle.textContent = title;
  headerTitle.style.cssText = 'margin: 0; font-size: 14px; color: var(--mu-text-primary, #333);';
  headerLeft.appendChild(headerTitle);

  const countSpan = document.createElement('span');
  countSpan.style.cssText = 'font-size: 12px; color: var(--mu-text-secondary, #666);';
  countSpan.textContent = countText;
  headerLeft.appendChild(countSpan);

  sectionHeader.appendChild(headerLeft);

  return { header: sectionHeader, expandIcon };
}

/**
 * Helper to setup collapsible behavior
 */
function setupCollapsible(
  headerResult: { header: HTMLElement; expandIcon: HTMLSpanElement },
  expandableContent: HTMLElement,
): void {
  let isExpanded = false;
  headerResult.header.addEventListener('click', (e: Event) => {
    e.stopPropagation();
    isExpanded = !isExpanded;
    expandableContent.style.display = isExpanded ? 'block' : 'none';
    headerResult.expandIcon.style.transform = isExpanded ? 'rotate(0deg)' : 'rotate(270deg)';
  });

  headerResult.header.addEventListener('mouseover', () => {
    headerResult.header.style.backgroundColor = 'var(--mu-bg-secondary, #f8f9fa)';
  });
  headerResult.header.addEventListener('mouseout', () => {
    headerResult.header.style.backgroundColor = 'var(--mu-bg-primary, #fff)';
  });
}

/**
 * Helper to create a small styled button
 */
function createSmallButton(
  id: string,
  text: string,
  color?: string,
  isOutline?: boolean,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.id = id;
  btn.textContent = text;

  if (color && !isOutline) {
    btn.style.cssText = `padding: 5px 10px; border: none; border-radius: 4px; background: ${color}; color: white; cursor: pointer; font-size: 12px;`;
  } else if (color && isOutline) {
    btn.style.cssText = `padding: 5px 10px; border: 1px solid ${color}; border-radius: 4px; background: var(--mu-bg-primary, white); color: ${color}; cursor: pointer; font-size: 12px;`;
  } else {
    btn.style.cssText = 'padding: 5px 10px; border: 1px solid var(--mu-input-border, #ccc); border-radius: 4px; background: var(--mu-bg-primary, white); color: var(--mu-text-primary, #333); cursor: pointer; font-size: 12px;';
  }

  return btn;
}

/**
 * Renders the holdings mappings management section
 */
export function renderHoldingsMappingsSection(
  integrationId: string,
  accountEntry: AccountEntry,
  accountId: string,
  onRefresh: (() => void) | null,
): HTMLElement {
  if (!hasCapability(integrationId, 'hasHoldings')) {
    return document.createElement('div');
  }

  const sectionContainer = document.createElement('div');
  sectionContainer.id = `holdings-section-${integrationId}-${accountId}`;
  sectionContainer.style.cssText = 'margin-bottom: 15px;';

  const holdingsMappings = accountEntry.holdingsMappings || {};
  const holdingsCount = Object.keys(holdingsMappings).length;

  const sectionHeader = createCollapsibleHeader(
    `holdings-${integrationId}-${accountId}`,
    'Holdings Mappings',
    `(${holdingsCount} mapping${holdingsCount !== 1 ? 's' : ''})`,
  );
  sectionContainer.appendChild(sectionHeader.header);

  const expandableContent = document.createElement('div');
  expandableContent.id = `holdings-content-${integrationId}-${accountId}`;
  expandableContent.style.cssText = `
    display: none; padding: 12px;
    border: 1px solid var(--mu-border, #e0e0e0); border-top: none;
    border-radius: 0 0 6px 6px; background-color: var(--mu-bg-primary, #fff);
  `;

  if (holdingsCount === 0) {
    const emptyMessage = document.createElement('p');
    emptyMessage.textContent = 'No holdings mappings stored. Mappings will appear here after syncing positions.';
    emptyMessage.style.cssText = 'color: var(--mu-text-secondary, #666); font-style: italic; margin: 0; font-size: 13px;';
    expandableContent.appendChild(emptyMessage);
  } else {
    const holdingsList = document.createElement('div');
    holdingsList.id = `holdings-list-${integrationId}-${accountId}`;
    holdingsList.style.cssText = 'max-height: 250px; overflow-y: auto; border: 1px solid var(--mu-border, #e0e0e0); border-radius: 4px;';

    Object.entries(holdingsMappings).forEach(([securityUuid, mappingData], index) => {
      const holdingRow = document.createElement('div');
      holdingRow.id = `holding-row-${integrationId}-${accountId}-${index}`;
      holdingRow.style.cssText = `display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; border-bottom: 1px solid var(--mu-border, #f0f0f0); background: ${index % 2 === 0 ? 'var(--mu-bg-primary, #fff)' : 'var(--mu-bg-secondary, #fafafa)'};`;

      const holdingInfo = document.createElement('div');
      holdingInfo.style.cssText = 'display: flex; flex-direction: column; gap: 2px; flex: 1;';

      const symbolDiv = document.createElement('div');
      symbolDiv.style.cssText = 'font-weight: 600; font-size: 14px; color: var(--mu-text-primary, #333);';
      symbolDiv.textContent = mappingData.symbol || 'Unknown Symbol';
      holdingInfo.appendChild(symbolDiv);

      const idsDiv = document.createElement('div');
      idsDiv.style.cssText = 'font-size: 11px; color: var(--mu-text-secondary, #666); font-family: monospace;';
      idsDiv.textContent = `Security: ${mappingData.securityId || 'N/A'} | Holding: ${mappingData.holdingId || 'N/A'}`;
      holdingInfo.appendChild(idsDiv);

      holdingRow.appendChild(holdingInfo);

      const deleteBtn = document.createElement('button');
      deleteBtn.id = `holding-delete-${integrationId}-${accountId}-${index}`;
      deleteBtn.textContent = '🗑️';
      deleteBtn.title = 'Delete this mapping (will prompt for re-selection on next sync)';
      deleteBtn.style.cssText = 'background: transparent; border: none; cursor: pointer; font-size: 16px; padding: 4px 8px; border-radius: 4px; transition: background-color 0.2s;';
      deleteBtn.addEventListener('click', async (e: Event) => {
        e.stopPropagation();
        const confirmed = await showConfirmDialog(`Delete mapping for "${mappingData.symbol}"?\n\nYou will be prompted to select the Monarch security again on the next sync.`);
        if (confirmed) {
          const updatedMappings = { ...holdingsMappings };
          delete updatedMappings[securityUuid];
          const success = accountService.updateAccountInList(integrationId, accountId, { holdingsMappings: updatedMappings });
          if (success) {
            toast.show(`Deleted mapping for ${mappingData.symbol}`, 'info');
            if (onRefresh) setTimeout(onRefresh, 300);
          } else {
            toast.show('Error deleting mapping', 'error');
          }
        }
      });
      deleteBtn.addEventListener('mouseover', () => { deleteBtn.style.backgroundColor = '#f8d7da'; });
      deleteBtn.addEventListener('mouseout', () => { deleteBtn.style.backgroundColor = 'transparent'; });

      holdingRow.appendChild(deleteBtn);
      holdingsList.appendChild(holdingRow);
    });

    expandableContent.appendChild(holdingsList);

    const deleteAllContainer = document.createElement('div');
    deleteAllContainer.style.cssText = 'margin-top: 12px;';

    const deleteAllBtn = document.createElement('button');
    deleteAllBtn.id = `holdings-delete-all-${integrationId}-${accountId}`;
    deleteAllBtn.textContent = 'Delete All Mappings';
    deleteAllBtn.style.cssText = 'padding: 6px 12px; border: none; border-radius: 4px; background: #dc3545; color: white; cursor: pointer; font-size: 12px; font-weight: 500; transition: background-color 0.2s;';
    deleteAllBtn.addEventListener('click', async (e: Event) => {
      e.stopPropagation();
      const confirmed = await showConfirmDialog(`Are you sure you want to delete ALL ${holdingsCount} holdings mapping(s)?\n\nYou will be prompted to re-select Monarch securities on the next sync.`);
      if (confirmed) {
        const success = accountService.updateAccountInList(integrationId, accountId, { holdingsMappings: {} });
        if (success) {
          toast.show(`Deleted ${holdingsCount} holdings mapping(s)`, 'info');
          if (onRefresh) setTimeout(onRefresh, 300);
        } else {
          toast.show('Error clearing mappings', 'error');
        }
      }
    });
    deleteAllBtn.addEventListener('mouseover', () => { deleteAllBtn.style.backgroundColor = '#c82333'; });
    deleteAllBtn.addEventListener('mouseout', () => { deleteAllBtn.style.backgroundColor = '#dc3545'; });

    deleteAllContainer.appendChild(deleteAllBtn);
    expandableContent.appendChild(deleteAllContainer);
  }

  sectionContainer.appendChild(expandableContent);
  setupCollapsible(sectionHeader, expandableContent);

  return sectionContainer;
}

/**
 * Creates generic account cards for any integration using the unified account service
 */
export function createGenericAccountCards(
  integrationId: string,
  accounts: AccountEntry[],
  onRefresh: () => void,
): HTMLElement {
  const container = document.createElement('div');
  container.id = `${integrationId}-account-cards-container`;
  container.style.cssText = 'margin: 10px 0;';

  if (!accounts || accounts.length === 0) {
    const emptyMessage = document.createElement('p');
    emptyMessage.textContent = `No accounts found. Accounts will appear here after syncing with ${getDisplayName(integrationId)}.`;
    emptyMessage.style.cssText = 'color: #666; font-style: italic; margin: 10px 0;';
    return emptyMessage;
  }

  const accountKeyName = getAccountKeyName(integrationId);
  const faviconUrl = getFaviconUrl(integrationId);

  accounts.forEach((accountEntry) => {
    const sourceAccount = (accountEntry[accountKeyName] || {}) as SourceAccount;
    const monarchAccount = accountEntry.monarchAccount;
    const syncEnabled = accountEntry.syncEnabled !== false;
    const lastSyncDate = accountEntry.lastSyncDate;
    const accountId = sourceAccount.id || 'unknown';

    const card = document.createElement('div');
    card.id = `${integrationId}-account-card-${accountId}`;
    card.style.cssText = 'border: 1px solid var(--mu-border, #e0e0e0); border-radius: 8px; margin-bottom: 15px; overflow: hidden; transition: all 0.2s;';

    const cardHeader = document.createElement('div');
    cardHeader.id = `${integrationId}-account-header-${accountId}`;
    cardHeader.style.cssText = `display: flex; align-items: center; padding: 15px; background-color: ${!syncEnabled ? 'var(--mu-bg-tertiary, #fafafa)' : 'var(--mu-bg-primary, #fff)'}; cursor: pointer; transition: background-color 0.2s;`;

    const expandIcon = document.createElement('div');
    expandIcon.id = `${integrationId}-expand-icon-${accountId}`;
    expandIcon.style.cssText = `margin-right: 10px; font-size: 1.2em; color: ${!syncEnabled ? 'var(--mu-text-muted, #999)' : 'var(--mu-text-secondary, #666)'}; transition: transform 0.2s; cursor: pointer; flex-shrink: 0; transform: rotate(270deg);`;
    expandIcon.textContent = '▼';
    cardHeader.appendChild(expandIcon);

    const logoContainer = document.createElement('div');
    logoContainer.id = `${integrationId}-logo-${accountId}`;
    logoContainer.style.cssText = `margin-right: 15px; flex-shrink: 0; ${!syncEnabled ? 'opacity: 0.5;' : ''}`;
    if (faviconUrl) {
      try {
        GM_addElement(logoContainer, 'img', {
          src: faviconUrl,
          style: 'width: 40px; height: 40px; border-radius: 5px; object-fit: contain;',
        });
      } catch {
        addAccountLogoFallback(logoContainer, getDisplayName(integrationId));
      }
    } else {
      addAccountLogoFallback(logoContainer, getDisplayName(integrationId));
    }
    cardHeader.appendChild(logoContainer);

    const infoContainer = document.createElement('div');
    infoContainer.id = `${integrationId}-info-${accountId}`;
    infoContainer.style.cssText = 'flex-grow: 1;';

    const nameDiv = document.createElement('div');
    nameDiv.id = `${integrationId}-name-${accountId}`;
    nameDiv.style.cssText = `font-weight: bold; font-size: 1.1em; margin-bottom: 2px; color: ${!syncEnabled ? 'var(--mu-text-muted, #999)' : 'var(--mu-text-primary, #333)'};`;
    nameDiv.textContent = sourceAccount.nickname || sourceAccount.name || 'Unknown Account';
    infoContainer.appendChild(nameDiv);

    if (sourceAccount.type) {
      const typeDiv = document.createElement('div');
      typeDiv.id = `${integrationId}-type-${accountId}`;
      typeDiv.style.cssText = 'font-size: 0.9em; color: var(--mu-text-secondary, #666); margin-bottom: 2px;';
      typeDiv.textContent = sourceAccount.type;
      infoContainer.appendChild(typeDiv);
    }

    const mappingDiv = document.createElement('div');
    mappingDiv.id = `${integrationId}-mapping-${accountId}`;
    mappingDiv.style.cssText = 'font-size: 0.8em; margin-top: 5px;';
    if (monarchAccount) {
      mappingDiv.innerHTML = `<span style="color: var(--mu-status-success-text, #28a745);">✓ Mapped to:</span> <span style="color: var(--mu-text-secondary, #666);">${monarchAccount.displayName || monarchAccount.name || 'Monarch Account'}</span>`;
    } else {
      mappingDiv.innerHTML = '<span style="color: var(--mu-status-error-text, #dc3545);">✗ Not mapped</span>';
    }
    infoContainer.appendChild(mappingDiv);

    if (lastSyncDate) {
      const syncDiv = document.createElement('div');
      syncDiv.id = `${integrationId}-sync-date-${accountId}`;
      syncDiv.style.cssText = 'font-size: 0.8em; color: var(--mu-text-secondary, #555); margin-top: 2px;';
      syncDiv.textContent = `Last synced: ${formatLastUpdateDate(lastSyncDate)}`;
      infoContainer.appendChild(syncDiv);
    }

    cardHeader.appendChild(infoContainer);

    const toggleContainer = document.createElement('div');
    toggleContainer.id = `${integrationId}-toggle-container-${accountId}`;
    toggleContainer.style.cssText = 'margin-left: auto; margin-right: 10px; flex-shrink: 0;';
    const toggle = createToggleSwitch(syncEnabled, (isEnabled: boolean) => {
      const success = accountService.markAccountAsSkipped(integrationId, accountId, !isEnabled);
      if (success) {
        toast.show(`Account ${sourceAccount.nickname || sourceAccount.name} ${isEnabled ? 'enabled' : 'disabled'}`, 'info');
        setTimeout(onRefresh, 500);
      } else {
        toast.show('Failed to update account status', 'error');
        setTimeout(onRefresh, 100);
      }
    });
    toggleContainer.appendChild(toggle);
    cardHeader.appendChild(toggleContainer);
    toggleContainer.addEventListener('click', (e: Event) => e.stopPropagation());

    const deleteButton = document.createElement('button');
    deleteButton.id = `${integrationId}-delete-btn-${accountId}`;
    deleteButton.textContent = '🗑️';
    deleteButton.style.cssText = 'margin-left: 10px; background: transparent; color: #dc3545; border: none; border-radius: 50%; width: 24px; height: 24px; cursor: pointer; font-size: 24px; display: flex; align-items: center; justify-content: center; transition: all 0.2s;';
    deleteButton.addEventListener('click', async (e: Event) => {
      e.stopPropagation();
      const accountName = sourceAccount.nickname || sourceAccount.name || accountId;
      const confirmed = await showConfirmDialog(`Are you sure you want to delete the account "${accountName}"?\n\nThis will remove all mappings and settings for this account.`);
      if (confirmed) {
        const success = accountService.removeAccount(integrationId, accountId);
        if (success) {
          toast.show('Account deleted', 'info');
          onRefresh();
        } else {
          toast.show('Failed to delete account', 'error');
        }
      }
    });
    deleteButton.addEventListener('mouseover', () => { deleteButton.style.backgroundColor = '#f8d7da'; });
    deleteButton.addEventListener('mouseout', () => { deleteButton.style.backgroundColor = 'transparent'; });
    cardHeader.appendChild(deleteButton);

    const expandableContent = document.createElement('div');
    expandableContent.id = `${integrationId}-expandable-${accountId}`;
    expandableContent.style.cssText = 'display: none; padding: 15px; background-color: var(--mu-bg-secondary, #f8f9fa); border-top: 1px solid var(--mu-border, #e0e0e0);';

    expandableContent.appendChild(renderAccountSettingsSection(integrationId, accountEntry, accountId, onRefresh));
    expandableContent.appendChild(renderTransactionsManagementSection(integrationId, accountEntry, accountId, onRefresh));
    expandableContent.appendChild(renderHoldingsMappingsSection(integrationId, accountEntry, accountId, onRefresh));
    expandableContent.appendChild(renderDebugJsonSection(integrationId, accountEntry as Record<string, unknown>, accountId, onRefresh));

    card.appendChild(cardHeader);
    card.appendChild(expandableContent);

    let isExpanded = false;
    cardHeader.addEventListener('click', (e: Event) => {
      if ((e.target as HTMLElement) === deleteButton || (e.target as HTMLElement).closest('[id*="toggle-container"]')) return;
      isExpanded = !isExpanded;
      expandableContent.style.display = isExpanded ? 'block' : 'none';
      expandIcon.style.transform = isExpanded ? 'rotate(0deg)' : 'rotate(270deg)';
    });

    cardHeader.addEventListener('mouseover', () => {
      if (!isExpanded) {
        cardHeader.style.backgroundColor = !syncEnabled ? 'var(--mu-hover-bg, #f0f0f0)' : 'var(--mu-bg-secondary, #f8f9fa)';
      }
    });
    cardHeader.addEventListener('mouseout', () => {
      if (!isExpanded) {
        cardHeader.style.backgroundColor = !syncEnabled ? 'var(--mu-bg-tertiary, #fafafa)' : 'var(--mu-bg-primary, #fff)';
      }
    });

    container.appendChild(card);
  });

  return container;
}
