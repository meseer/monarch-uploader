/**
 * Settings Modal - Account Card Components
 * Per-account settings, holdings mappings, and debug sections
 *
 * The uploaded transactions section lives in `settingsModalTransactions` and is
 * re-exported here for backward compatibility.
 */

import { getLookbackForInstitution, validateLookbackVsRetention } from '../../core/utils';
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
import { renderCardholderMappingsSection } from './settingsModalCardholders';
import { createCollapsibleHeader, setupCollapsible } from './settingsModalCollapsible';
import { renderTransactionsManagementSection } from './settingsModalTransactions';

export { renderTransactionsManagementSection };

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
  uploadedTransactions?: unknown[];
  holdingsMappings?: Record<string, HoldingMapping>;
  [key: string]: unknown;
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
    expandableContent.appendChild(renderCardholderMappingsSection(integrationId, accountEntry, accountId, onRefresh));
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
