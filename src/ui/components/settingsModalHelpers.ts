/**
 * Settings Modal - Shared Helper Functions
 * Common UI components and utilities used across settings modal tabs
 */

import { debugLog, getDefaultLookbackDays, validateLookbackVsRetention, getMinRetentionForInstitution, getLookbackForInstitution } from '../../core/utils';
import { STORAGE } from '../../core/config';
import { INTEGRATIONS, getCategoryMappingsConfig, getDisplayName } from '../../core/integrationCapabilities';
import { getIntegration } from '../../core/integrationRegistry';
import { getAuth, setSetting, getCategoryMappings, saveCategoryMappings } from '../../services/common/configStore';
import { checkMonarchAuth } from '../../services/auth';
import { checkQuestradeAuth } from '../../services/questrade/auth';
import toast from '../toast';
import accountService from '../../services/common/accountService';
import { getMonarchAccountTypeMapping } from '../../mappers/wealthsimple-account-types';

interface WealthsimpleAccountEntry {
  syncEnabled: boolean;
  wealthsimpleAccount: {
    type: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface LookbackValidation {
  valid: boolean;
  error?: string;
}

/**
 * Checks connection status for an institution
 */
export function checkInstitutionConnection(institutionId: string): boolean {
  switch (institutionId) {
  case 'questrade':
    return checkQuestradeAuth().authenticated;
  case 'canadalife':
    try {
      const token = localStorage.getItem(STORAGE.CANADALIFE_TOKEN_KEY);
      return Boolean(token);
    } catch {
      return false;
    }
  case 'rogersbank': {
    const rbAuth = getAuth(INTEGRATIONS.ROGERSBANK);
    return Boolean(rbAuth.authToken);
  }
  case 'wealthsimple': {
    const wsAuth = getAuth(INTEGRATIONS.WEALTHSIMPLE);
    return Boolean(wsAuth.accessToken);
  }
  case 'monarch':
    return checkMonarchAuth().authenticated;
  default: {
    const registeredIntegration = getIntegration(institutionId);
    if (registeredIntegration && registeredIntegration.auth) {
      try {
        const status = registeredIntegration.auth.checkStatus();
        return Boolean(status && status.authenticated);
      } catch (error) {
        debugLog(`[settingsModalHelpers] Error checking auth for ${institutionId}:`, error);
        return false;
      }
    }
    return false;
  }
  }
}

/**
 * Creates a lookback period configuration section for an institution
 */
export function createLookbackPeriodSection(institutionType: string): HTMLElement {
  const section = createSection('Lookback Period', '⏰', 'Configure how many days to look back from the last upload date for subsequent uploads');

  const configContainer = document.createElement('div');
  configContainer.style.cssText = 'margin: 15px 0;';

  const label = document.createElement('label');
  label.textContent = 'Lookback Days:';
  label.style.cssText = 'display: block; margin-bottom: 8px; font-weight: bold;';

  const inputContainer = document.createElement('div');
  inputContainer.style.cssText = 'display: flex; align-items: center; gap: 10px; margin-bottom: 10px;';

  const input = document.createElement('input');
  input.type = 'number';
  input.min = '0';
  input.max = '30';
  input.step = '1';
  input.style.cssText = `
    padding: 8px 12px;
    border: 1px solid var(--mu-input-border, #ccc);
    border-radius: 4px;
    font-size: 14px;
    width: 80px;
    background: var(--mu-input-bg, white);
    color: var(--mu-text-primary, #333);
  `;

  const institutionName = getDisplayName(institutionType);

  const defaultLookback = getDefaultLookbackDays(institutionType);
  const currentValue = getLookbackForInstitution(institutionType);
  input.value = String(currentValue);

  const daysLabel = document.createElement('span');
  daysLabel.textContent = 'days';
  daysLabel.style.cssText = 'color: var(--mu-text-secondary, #666); font-size: 14px;';

  const resetButton = document.createElement('button');
  resetButton.textContent = 'Reset to Default';
  resetButton.style.cssText = `
    padding: 6px 12px;
    border: 1px solid var(--mu-input-border, #ccc);
    border-radius: 4px;
    background: var(--mu-bg-primary, white);
    color: var(--mu-text-primary, #333);
    cursor: pointer;
    font-size: 12px;
    margin-left: 10px;
  `;

  inputContainer.appendChild(input);
  inputContainer.appendChild(daysLabel);
  inputContainer.appendChild(resetButton);

  const description = document.createElement('div');
  description.style.cssText = 'font-size: 13px; color: var(--mu-text-secondary, #666); margin-top: 8px; line-height: 1.4;';
  description.innerHTML = `
    <strong>How it works:</strong><br>
    • When uploading transactions after a previous upload exists, the system calculates the "from date" as: <code>Last Upload Date - Lookback Days</code><br>
    • This ensures no transactions are missed due to delayed processing or date discrepancies<br>
    • Default for ${institutionName}: <strong>${defaultLookback} day${defaultLookback !== 1 ? 's' : ''}</strong><br>
    • Range: 0-30 days (0 means start exactly from the last upload date)
  `;

  const saveLookbackValue = (value: number): void => {
    setSetting(institutionType, 'lookbackDays', value);
  };

  const saveChanges = (): void => {
    const value = parseInt(input.value, 10);
    if (Number.isNaN(value) || value < 0 || value > 30) {
      input.value = String(currentValue);
      toast.show('Please enter a valid number between 0 and 30', 'error');
      return;
    }

    const minRetention = getMinRetentionForInstitution(institutionType);
    const validation = validateLookbackVsRetention(value, minRetention) as LookbackValidation;
    if (!validation.valid) {
      input.value = String(currentValue);
      toast.show(validation.error || 'Validation failed', 'error');
      return;
    }

    saveLookbackValue(value);
    toast.show(`${institutionName} lookback period set to ${value} day${value !== 1 ? 's' : ''}`, 'info');
    debugLog(`${institutionName} lookback period updated to: ${value} days`);
  };

  resetButton.addEventListener('click', () => {
    const minRetention = getMinRetentionForInstitution(institutionType);
    const validation = validateLookbackVsRetention(defaultLookback, minRetention) as LookbackValidation;
    if (!validation.valid) {
      toast.show(`Cannot reset: ${validation.error}`, 'error');
      return;
    }

    input.value = String(defaultLookback);
    saveLookbackValue(defaultLookback);
    toast.show(`${institutionName} lookback period reset to default (${defaultLookback} day${defaultLookback !== 1 ? 's' : ''})`, 'info');
  });

  let saveTimeout: ReturnType<typeof setTimeout>;
  input.addEventListener('input', () => {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveChanges, 500);
  });
  input.addEventListener('blur', () => {
    clearTimeout(saveTimeout);
    saveChanges();
  });
  input.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      clearTimeout(saveTimeout);
      saveChanges();
      input.blur();
    }
  });

  resetButton.addEventListener('mouseover', () => {
    resetButton.style.backgroundColor = 'var(--mu-bg-secondary, #f8f9fa)';
  });
  resetButton.addEventListener('mouseout', () => {
    resetButton.style.backgroundColor = 'var(--mu-bg-primary, white)';
  });

  configContainer.appendChild(label);
  configContainer.appendChild(inputContainer);
  configContainer.appendChild(description);
  section.appendChild(configContainer);

  return section;
}

/**
 * Sort Wealthsimple accounts by sync status and account type
 * Priority: Enabled first, then by type (credit > cash > investment)
 */
export function sortWealthsimpleAccounts(accounts: unknown[]): WealthsimpleAccountEntry[] {
  const typedAccounts = accounts as WealthsimpleAccountEntry[];
  return typedAccounts.sort((a, b) => {
    // First: Sort by enabled status (enabled first)
    if (a.syncEnabled !== b.syncEnabled) {
      return (b.syncEnabled ? 1 : 0) - (a.syncEnabled ? 1 : 0);
    }

    // Second: Sort by account type priority
    const getTypePriority = (account: WealthsimpleAccountEntry): number => {
      const accountType = account.wealthsimpleAccount.type;
      const mapping = getMonarchAccountTypeMapping(accountType as string);

      if (!mapping) return 999;

      switch (mapping.type) {
      case 'credit': return 1;
      case 'depository': return 2;
      case 'brokerage': return 3;
      default: return 4;
      }
    };

    return getTypePriority(a) - getTypePriority(b);
  });
}

/**
 * Creates a section with title and description
 */
export function createSection(title: string, icon: string, description: string): HTMLElement {
  const section = document.createElement('div');
  section.style.cssText = 'margin-bottom: 30px;';

  const header = document.createElement('div');
  header.style.cssText = 'margin-bottom: 15px;';

  const titleElement = document.createElement('h3');
  titleElement.innerHTML = `${icon} ${title}`;
  titleElement.style.cssText = 'margin: 0 0 5px 0; font-size: 16px; font-weight: bold; color: var(--mu-text-primary, #333);';

  const descElement = document.createElement('p');
  descElement.textContent = description;
  descElement.style.cssText = 'margin: 0; font-size: 14px; color: var(--mu-text-secondary, #666);';

  header.appendChild(titleElement);
  header.appendChild(descElement);
  section.appendChild(header);

  return section;
}

/**
 * Creates a confirmation dialog
 */
export function showConfirmDialog(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-color: var(--mu-overlay-bg, rgba(0, 0, 0, 0.5));
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 10001;
    `;

    const dialog = document.createElement('div');
    dialog.style.cssText = `
      background-color: var(--mu-bg-primary, white);
      color: var(--mu-text-primary, #333);
      padding: 20px;
      border-radius: 8px;
      max-width: 400px;
      text-align: center;
    `;

    const messageEl = document.createElement('p');
    messageEl.textContent = message;
    messageEl.style.cssText = 'margin: 0 0 20px 0; white-space: pre-line;';

    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = 'display: flex; gap: 10px; justify-content: center;';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = `
      padding: 8px 16px;
      border: 1px solid var(--mu-input-border, #ccc);
      border-radius: 4px;
      background: var(--mu-cancel-btn-bg, white);
      color: var(--mu-cancel-btn-text, #333);
      cursor: pointer;
    `;

    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = 'Delete';
    confirmBtn.style.cssText = `
      padding: 8px 16px;
      border: none;
      border-radius: 4px;
      background: #dc3545;
      color: white;
      cursor: pointer;
    `;

    cancelBtn.addEventListener('click', () => {
      modal.remove();
      resolve(false);
    });

    confirmBtn.addEventListener('click', () => {
      modal.remove();
      resolve(true);
    });

    buttonContainer.appendChild(cancelBtn);
    buttonContainer.appendChild(confirmBtn);
    dialog.appendChild(messageEl);
    dialog.appendChild(buttonContainer);
    modal.appendChild(dialog);

    document.body.appendChild(modal);
  });
}

/**
 * Adds a logo fallback (first letter) to a container for account cards
 */
export function addAccountLogoFallback(container: HTMLElement, institutionName: string): void {
  const logoFallback = document.createElement('div');
  logoFallback.style.cssText = `
    width: 40px;
    height: 40px;
    border-radius: 5px;
    background-color: var(--mu-bg-tertiary, #e0e0e0);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    color: var(--mu-text-secondary, #666);
    font-weight: bold;
  `;
  const firstChar = institutionName ? institutionName.charAt(0).toUpperCase() : '?';
  logoFallback.textContent = firstChar;
  container.appendChild(logoFallback);
}

/**
 * Formats a date for display
 */
export function formatLastUpdateDate(dateValue: string | null | undefined): string {
  if (!dateValue) return 'Never';

  try {
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return 'Invalid date';

    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return 'Invalid date';
  }
}

/**
 * Creates a styled toggle switch component (AirBnB/iOS style)
 */
export function createToggleSwitch(isEnabled: boolean, onChange: (state: boolean) => void, showLabel = true): HTMLElement {
  const container = document.createElement('label');
  container.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    user-select: none;
  `;

  let label: HTMLSpanElement | null = null;
  if (showLabel) {
    label = document.createElement('span');
    label.textContent = isEnabled ? 'Enabled' : 'Disabled';
    label.style.cssText = 'font-size: 13px; color: var(--mu-text-secondary, #666);';
  }

  const switchContainer = document.createElement('div');
  switchContainer.style.cssText = `
    position: relative;
    width: 44px;
    height: 24px;
    background-color: ${isEnabled ? 'var(--mu-toggle-active-bg, #2196F3)' : 'var(--mu-toggle-bg, #ccc)'};
    border-radius: 12px;
    transition: background-color 0.3s;
  `;

  const switchSlider = document.createElement('div');
  switchSlider.style.cssText = `
    position: absolute;
    top: 2px;
    left: ${isEnabled ? '22px' : '2px'};
    width: 20px;
    height: 20px;
    background-color: white;
    border-radius: 50%;
    transition: left 0.3s;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  `;

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = isEnabled;
  checkbox.style.cssText = 'display: none;';

  checkbox.addEventListener('change', (e: Event) => {
    const newState = (e.target as HTMLInputElement).checked;
    switchContainer.style.backgroundColor = newState ? 'var(--mu-toggle-active-bg, #2196F3)' : 'var(--mu-toggle-bg, #ccc)';
    switchSlider.style.left = newState ? '22px' : '2px';
    if (label) {
      label.textContent = newState ? 'Enabled' : 'Disabled';
    }
    onChange(newState);
  });

  switchContainer.appendChild(switchSlider);
  if (label) {
    container.appendChild(label);
  }
  container.appendChild(switchContainer);
  container.appendChild(checkbox);

  container.addEventListener('click', (e: Event) => {
    e.preventDefault();
    checkbox.checked = !checkbox.checked;
    checkbox.dispatchEvent(new Event('change'));
  });

  return container;
}

/**
 * Renders category mappings section if the integration supports categorization
 */
export function renderCategoryMappingsSectionIfEnabled(integrationId: string, onRefresh: () => void): HTMLElement {
  const categoryConfig = getCategoryMappingsConfig(integrationId);

  if (!categoryConfig || !categoryConfig.storageKey) {
    return document.createElement('div');
  }

  const sectionWrapper = createSection('Category Mappings', '🏷️', `${categoryConfig.sourceLabel} to Monarch category mappings`);

  const categorySection = renderCategoryMappingsSection(
    integrationId,
    categoryConfig.storageKey,
    categoryConfig.sourceLabel,
    onRefresh,
  );

  sectionWrapper.appendChild(categorySection);
  return sectionWrapper;
}

/**
 * Creates a collapsible category mappings section with filters
 */
export function renderCategoryMappingsSection(
  integrationId: string,
  storageKey: string,
  sourceColumnLabel: string,
  onRefresh: () => void,
): HTMLElement {
  const sectionContainer = document.createElement('div');
  sectionContainer.id = `category-mappings-section-${integrationId}`;
  sectionContainer.style.cssText = 'margin-bottom: 15px;';

  interface CategoryItem {
    key: string;
    sourceKey: string;
    monarchCategory: string;
  }

  let categoryData: CategoryItem[] = [];
  const allCategories = new Set<string>();

  try {
    const mappings = getCategoryMappings(integrationId) as Record<string, string>;
    categoryData = Object.entries(mappings).map(([sourceKey, monarchCategory]) => ({
      key: `${integrationId}.${sourceKey}`,
      sourceKey,
      monarchCategory,
    }));

    categoryData.forEach((item) => {
      if (item.monarchCategory) {
        allCategories.add(item.monarchCategory);
      }
    });
  } catch (error) {
    debugLog(`Error parsing ${integrationId} category mappings:`, error);
  }

  const sectionHeader = document.createElement('div');
  sectionHeader.id = `category-mappings-header-${integrationId}`;
  sectionHeader.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    background-color: var(--mu-bg-primary, #fff);
    border: 1px solid var(--mu-border, #e0e0e0);
    border-radius: 6px;
    cursor: pointer;
    transition: background-color 0.2s;
  `;

  const headerLeft = document.createElement('div');
  headerLeft.style.cssText = 'display: flex; align-items: center; gap: 8px;';

  const expandIcon = document.createElement('span');
  expandIcon.id = `category-mappings-expand-icon-${integrationId}`;
  expandIcon.textContent = '▼';
  expandIcon.style.cssText = 'transition: transform 0.2s; font-size: 12px; transform: rotate(270deg);';
  headerLeft.appendChild(expandIcon);

  const headerTitle = document.createElement('h4');
  headerTitle.textContent = 'Category Mappings';
  headerTitle.style.cssText = 'margin: 0; font-size: 14px; color: var(--mu-text-primary, #333);';
  headerLeft.appendChild(headerTitle);

  const mappingCount = document.createElement('span');
  mappingCount.style.cssText = 'font-size: 12px; color: var(--mu-text-secondary, #666);';
  mappingCount.textContent = `(${categoryData.length} mapping${categoryData.length !== 1 ? 's' : ''})`;
  headerLeft.appendChild(mappingCount);

  sectionHeader.appendChild(headerLeft);
  sectionContainer.appendChild(sectionHeader);

  const expandableContent = document.createElement('div');
  expandableContent.id = `category-mappings-content-${integrationId}`;
  expandableContent.style.cssText = `
    display: none;
    padding: 12px;
    border: 1px solid var(--mu-border, #e0e0e0);
    border-top: none;
    border-radius: 0 0 6px 6px;
    background-color: var(--mu-bg-primary, #fff);
  `;

  if (categoryData.length === 0) {
    const emptyMessage = document.createElement('p');
    emptyMessage.textContent = 'No category mappings found. Mappings will appear here after you categorize transactions.';
    emptyMessage.style.cssText = 'color: var(--mu-text-secondary, #666); font-style: italic; margin: 0; font-size: 13px;';
    expandableContent.appendChild(emptyMessage);
  } else {
    const filterContainer = document.createElement('div');
    filterContainer.id = `category-mappings-filters-${integrationId}`;
    filterContainer.style.cssText = 'display: flex; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; align-items: flex-end;';

    const sourceFilterWrapper = document.createElement('div');
    sourceFilterWrapper.style.cssText = 'flex: 1; min-width: 200px;';

    const sourceFilterLabel = document.createElement('label');
    sourceFilterLabel.textContent = sourceColumnLabel;
    sourceFilterLabel.style.cssText = 'display: block; font-size: 12px; color: var(--mu-text-secondary, #666); margin-bottom: 4px; font-weight: 500;';
    sourceFilterWrapper.appendChild(sourceFilterLabel);

    const sourceFilterInput = document.createElement('input');
    sourceFilterInput.id = `category-mappings-source-filter-${integrationId}`;
    sourceFilterInput.type = 'text';
    sourceFilterInput.placeholder = `Filter by ${sourceColumnLabel.toLowerCase()}...`;
    sourceFilterInput.style.cssText = `
      width: 100%;
      padding: 8px 12px;
      border: 1px solid var(--mu-input-border, #ccc);
      border-radius: 4px;
      font-size: 13px;
      box-sizing: border-box;
      background: var(--mu-input-bg, white);
      color: var(--mu-text-primary, #333);
    `;
    sourceFilterWrapper.appendChild(sourceFilterInput);
    filterContainer.appendChild(sourceFilterWrapper);

    const categoryFilterWrapper = document.createElement('div');
    categoryFilterWrapper.style.cssText = 'flex: 1; min-width: 200px; position: relative;';

    const categoryFilterLabel = document.createElement('label');
    categoryFilterLabel.textContent = 'Monarch Category';
    categoryFilterLabel.style.cssText = 'display: block; font-size: 12px; color: var(--mu-text-secondary, #666); margin-bottom: 4px; font-weight: 500;';
    categoryFilterWrapper.appendChild(categoryFilterLabel);

    const dropdownContainer = document.createElement('div');
    dropdownContainer.id = `category-mappings-category-dropdown-${integrationId}`;
    dropdownContainer.style.cssText = 'position: relative;';

    const categoryInput = document.createElement('input');
    categoryInput.id = `category-mappings-category-filter-${integrationId}`;
    categoryInput.type = 'text';
    categoryInput.placeholder = 'All Categories';
    categoryInput.style.cssText = `
      width: 100%;
      padding: 8px 12px;
      padding-right: 30px;
      border: 1px solid var(--mu-input-border, #ccc);
      border-radius: 4px;
      font-size: 13px;
      box-sizing: border-box;
      cursor: pointer;
      background: var(--mu-input-bg, white);
      color: var(--mu-text-primary, #333);
    `;

    const dropdownArrow = document.createElement('span');
    dropdownArrow.textContent = '▼';
    dropdownArrow.style.cssText = `
      position: absolute;
      right: 10px;
      top: 50%;
      transform: translateY(-50%);
      font-size: 10px;
      color: var(--mu-text-secondary, #666);
      pointer-events: none;
    `;

    const dropdownList = document.createElement('div');
    dropdownList.id = `category-mappings-dropdown-list-${integrationId}`;
    dropdownList.style.cssText = `
      display: none;
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      max-height: 200px;
      overflow-y: auto;
      background: var(--mu-bg-primary, white);
      border: 1px solid var(--mu-input-border, #ccc);
      border-top: none;
      border-radius: 0 0 4px 4px;
      z-index: 100;
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
    `;

    let applyFiltersCallback = (): void => {};

    const allOption = document.createElement('div');
    allOption.textContent = 'All Categories';
    allOption.style.cssText = `
      padding: 8px 12px;
      cursor: pointer;
      font-size: 13px;
      font-style: italic;
      color: var(--mu-text-secondary, #666);
      transition: background-color 0.1s;
    `;
    allOption.addEventListener('mouseover', () => {
      allOption.style.backgroundColor = 'var(--mu-hover-bg, #f0f0f0)';
    });
    allOption.addEventListener('mouseout', () => {
      allOption.style.backgroundColor = 'var(--mu-bg-primary, white)';
    });
    allOption.addEventListener('click', () => {
      categoryInput.value = '';
      categoryInput.dataset.selectedCategory = '';
      dropdownList.style.display = 'none';
      applyFiltersCallback();
    });
    dropdownList.appendChild(allOption);

    const sortedCategories = Array.from(allCategories).sort();
    sortedCategories.forEach((category) => {
      const option = document.createElement('div');
      option.textContent = category;
      option.dataset.category = category;
      option.style.cssText = `
        padding: 8px 12px;
        cursor: pointer;
        font-size: 13px;
        transition: background-color 0.1s;
      `;
      option.addEventListener('mouseover', () => {
        option.style.backgroundColor = 'var(--mu-hover-bg, #f0f0f0)';
      });
      option.addEventListener('mouseout', () => {
        option.style.backgroundColor = 'var(--mu-bg-primary, white)';
      });
      option.addEventListener('click', () => {
        categoryInput.value = category;
        categoryInput.dataset.selectedCategory = category;
        dropdownList.style.display = 'none';
        applyFiltersCallback();
      });
      dropdownList.appendChild(option);
    });

    categoryInput.addEventListener('click', (e: Event) => {
      e.stopPropagation();
      const isVisible = dropdownList.style.display === 'block';
      dropdownList.style.display = isVisible ? 'none' : 'block';
    });

    categoryInput.addEventListener('input', () => {
      const searchTerm = categoryInput.value.toLowerCase();
      const options = dropdownList.querySelectorAll('div[data-category]') as NodeListOf<HTMLElement>;
      options.forEach((option) => {
        const categoryName = (option.dataset.category || '').toLowerCase();
        option.style.display = categoryName.includes(searchTerm) ? 'block' : 'none';
      });
      allOption.style.display = 'block';
      dropdownList.style.display = 'block';
    });

    document.addEventListener('click', (e: Event) => {
      if (!dropdownContainer.contains(e.target as Node)) {
        dropdownList.style.display = 'none';
      }
    });

    dropdownContainer.appendChild(categoryInput);
    dropdownContainer.appendChild(dropdownArrow);
    dropdownContainer.appendChild(dropdownList);
    categoryFilterWrapper.appendChild(dropdownContainer);
    filterContainer.appendChild(categoryFilterWrapper);

    const clearFiltersBtn = document.createElement('button');
    clearFiltersBtn.id = `category-mappings-clear-filters-${integrationId}`;
    clearFiltersBtn.textContent = 'Clear Filters';
    clearFiltersBtn.style.cssText = `
      padding: 8px 12px;
      border: 1px solid var(--mu-input-border, #ccc);
      border-radius: 4px;
      background: var(--mu-bg-primary, white);
      color: var(--mu-text-primary, #333);
      cursor: pointer;
      font-size: 12px;
      white-space: nowrap;
      transition: background-color 0.2s;
    `;
    clearFiltersBtn.addEventListener('click', (e: Event) => {
      e.stopPropagation();
      sourceFilterInput.value = '';
      categoryInput.value = '';
      categoryInput.dataset.selectedCategory = '';
      applyFiltersCallback();
    });
    clearFiltersBtn.addEventListener('mouseover', () => {
      clearFiltersBtn.style.backgroundColor = 'var(--mu-bg-secondary, #f8f9fa)';
    });
    clearFiltersBtn.addEventListener('mouseout', () => {
      clearFiltersBtn.style.backgroundColor = 'var(--mu-bg-primary, white)';
    });
    filterContainer.appendChild(clearFiltersBtn);

    const tableContainer = document.createElement('div');
    tableContainer.id = `category-mappings-table-container-${integrationId}`;
    tableContainer.style.cssText = 'max-height: 300px; overflow-y: auto;';

    const table = document.createElement('table');
    table.id = `category-mappings-table-${integrationId}`;
    table.style.cssText = `
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    `;

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    [sourceColumnLabel, 'Monarch Category', 'Actions'].forEach((headerText) => {
      const th = document.createElement('th');
      th.textContent = headerText;
      th.style.cssText = `
        background-color: var(--mu-bg-secondary, #f8f9fa);
        padding: 10px;
        text-align: left;
        border: 1px solid var(--mu-border, #e0e0e0);
        font-weight: bold;
        position: sticky;
        top: 0;
        z-index: 1;
      `;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    tbody.id = `category-mappings-tbody-${integrationId}`;

    categoryData.forEach((item, index) => {
      const row = document.createElement('tr');
      row.id = `category-mapping-row-${integrationId}-${index}`;
      row.dataset.sourceKey = item.sourceKey.toLowerCase();
      row.dataset.category = item.monarchCategory.toLowerCase();

      const sourceCell = document.createElement('td');
      sourceCell.textContent = item.sourceKey;
      sourceCell.style.cssText = 'padding: 10px; border: 1px solid var(--mu-border, #e0e0e0);';
      row.appendChild(sourceCell);

      const categoryCell = document.createElement('td');
      categoryCell.textContent = item.monarchCategory;
      categoryCell.style.cssText = 'padding: 10px; border: 1px solid var(--mu-border, #e0e0e0);';
      row.appendChild(categoryCell);

      const actionsCell = document.createElement('td');
      actionsCell.style.cssText = 'padding: 10px; border: 1px solid var(--mu-border, #e0e0e0);';

      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = 'Delete';
      deleteBtn.style.cssText = `
        background-color: #dc3545;
        color: white;
        border: none;
        border-radius: 4px;
        padding: 5px 10px;
        cursor: pointer;
        font-size: 12px;
        transition: background-color 0.2s;
      `;
      deleteBtn.addEventListener('click', async (e: Event) => {
        e.stopPropagation();
        const confirmed = await showConfirmDialog(
          `Delete mapping for "${item.sourceKey}"?\n\nMonarch Category: ${item.monarchCategory}`,
        );
        if (confirmed) {
          try {
            const currentMappings = getCategoryMappings(integrationId) as Record<string, string>;
            delete currentMappings[item.sourceKey];
            saveCategoryMappings(integrationId, currentMappings);
            toast.show('Category mapping deleted', 'info');
            onRefresh();
          } catch (error) {
            toast.show('Error deleting category mapping', 'error');
            debugLog('Error deleting category mapping:', error);
          }
        }
      });
      deleteBtn.addEventListener('mouseover', () => {
        deleteBtn.style.backgroundColor = '#c82333';
      });
      deleteBtn.addEventListener('mouseout', () => {
        deleteBtn.style.backgroundColor = '#dc3545';
      });

      actionsCell.appendChild(deleteBtn);
      row.appendChild(actionsCell);
      tbody.appendChild(row);
    });

    table.appendChild(tbody);
    tableContainer.appendChild(table);

    const resultsCount = document.createElement('div');
    resultsCount.id = `category-mappings-results-count-${integrationId}`;
    resultsCount.style.cssText = 'margin-top: 8px; font-size: 12px; color: var(--mu-text-secondary, #666);';
    resultsCount.textContent = `Showing ${categoryData.length} of ${categoryData.length} mappings`;

    applyFiltersCallback = () => {
      const sourceFilter = sourceFilterInput.value.toLowerCase();
      const categoryFilter = (categoryInput.dataset.selectedCategory || '').toLowerCase();

      const rows = tbody.querySelectorAll('tr') as NodeListOf<HTMLTableRowElement>;
      let visibleCount = 0;

      rows.forEach((row) => {
        const sourceKey = row.dataset.sourceKey || '';
        const category = row.dataset.category || '';

        const sourceMatch = !sourceFilter || sourceKey.includes(sourceFilter);
        const categoryMatch = !categoryFilter || category === categoryFilter;

        if (sourceMatch && categoryMatch) {
          row.style.display = '';
          visibleCount++;
        } else {
          row.style.display = 'none';
        }
      });

      resultsCount.textContent = `Showing ${visibleCount} of ${categoryData.length} mappings`;
    };

    sourceFilterInput.addEventListener('input', () => applyFiltersCallback());

    expandableContent.appendChild(filterContainer);
    expandableContent.appendChild(tableContainer);
    expandableContent.appendChild(resultsCount);

    const deleteAllContainer = document.createElement('div');
    deleteAllContainer.style.cssText = 'margin-top: 12px; display: flex; gap: 8px;';

    const deleteAllBtn = document.createElement('button');
    deleteAllBtn.id = `category-mappings-delete-all-${integrationId}`;
    deleteAllBtn.textContent = 'Delete All';
    deleteAllBtn.style.cssText = `
      padding: 6px 12px;
      border: none;
      border-radius: 4px;
      background: #dc3545;
      color: white;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      transition: background-color 0.2s;
    `;
    deleteAllBtn.addEventListener('click', async (e: Event) => {
      e.stopPropagation();
      const confirmed = await showConfirmDialog(
        `Are you sure you want to delete ALL ${categoryData.length} category mapping(s)?\n\nThis action cannot be undone.`,
      );
      if (confirmed) {
        saveCategoryMappings(integrationId, {});
        toast.show(`Deleted ${categoryData.length} category mapping(s)`, 'info');
        debugLog(`Deleted all ${integrationId} category mappings (${categoryData.length} total)`);
        onRefresh();
      }
    });
    deleteAllBtn.addEventListener('mouseover', () => {
      deleteAllBtn.style.backgroundColor = '#c82333';
    });
    deleteAllBtn.addEventListener('mouseout', () => {
      deleteAllBtn.style.backgroundColor = '#dc3545';
    });
    deleteAllContainer.appendChild(deleteAllBtn);
    expandableContent.appendChild(deleteAllContainer);
  }

  sectionContainer.appendChild(expandableContent);

  let isExpanded = false;
  sectionHeader.addEventListener('click', (e: Event) => {
    e.stopPropagation();
    isExpanded = !isExpanded;
    expandableContent.style.display = isExpanded ? 'block' : 'none';
    expandIcon.style.transform = isExpanded ? 'rotate(0deg)' : 'rotate(270deg)';
  });

  sectionHeader.addEventListener('mouseover', () => {
    sectionHeader.style.backgroundColor = 'var(--mu-bg-secondary, #f8f9fa)';
  });
  sectionHeader.addEventListener('mouseout', () => {
    sectionHeader.style.backgroundColor = 'var(--mu-bg-primary, #fff)';
  });

  return sectionContainer;
}

/**
 * Renders the debug JSON section with editable functionality (collapsible)
 */
export function renderDebugJsonSection(
  integrationId: string,
  accountEntry: Record<string, unknown>,
  accountId: string,
  onSave: (() => void) | null,
): HTMLElement {
  const sectionContainer = document.createElement('div');
  sectionContainer.id = `debug-section-${integrationId}-${accountId}`;
  sectionContainer.style.cssText = 'margin-bottom: 15px;';

  const sectionHeader = document.createElement('div');
  sectionHeader.id = `debug-header-${integrationId}-${accountId}`;
  sectionHeader.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    background-color: var(--mu-bg-primary, #fff);
    border: 1px solid var(--mu-border, #e0e0e0);
    border-radius: 6px;
    cursor: pointer;
    transition: background-color 0.2s;
  `;

  const headerLeft = document.createElement('div');
  headerLeft.style.cssText = 'display: flex; align-items: center; gap: 8px;';

  const expandIcon = document.createElement('span');
  expandIcon.id = `debug-expand-icon-${integrationId}-${accountId}`;
  expandIcon.textContent = '▼';
  expandIcon.style.cssText = 'transition: transform 0.2s; font-size: 12px; transform: rotate(270deg);';
  headerLeft.appendChild(expandIcon);

  const headerTitle = document.createElement('h4');
  headerTitle.textContent = 'Debug Information';
  headerTitle.style.cssText = 'margin: 0; font-size: 14px; color: var(--mu-text-primary, #333);';
  headerLeft.appendChild(headerTitle);

  sectionHeader.appendChild(headerLeft);
  sectionContainer.appendChild(sectionHeader);

  const expandableContent = document.createElement('div');
  expandableContent.id = `debug-content-${integrationId}-${accountId}`;
  expandableContent.style.cssText = `
    display: none;
    padding: 12px;
    border: 1px solid var(--mu-border, #e0e0e0);
    border-top: none;
    border-radius: 0 0 6px 6px;
    background-color: var(--mu-bg-primary, #fff);
  `;

  const buttonContainer = document.createElement('div');
  buttonContainer.id = `debug-buttons-${integrationId}-${accountId}`;
  buttonContainer.style.cssText = 'display: flex; gap: 8px; margin-bottom: 10px;';

  const editButton = document.createElement('button');
  editButton.id = `debug-edit-btn-${integrationId}-${accountId}`;
  editButton.textContent = '✍️ Edit';
  editButton.style.cssText = `
    padding: 4px 10px;
    border: 1px solid #6c757d;
    border-radius: 4px;
    background: var(--mu-bg-primary, white);
    color: #6c757d;
    cursor: pointer;
    font-size: 12px;
    display: flex;
    align-items: center;
    gap: 4px;
    transition: all 0.2s;
  `;
  editButton.addEventListener('mouseover', () => {
    editButton.style.backgroundColor = 'var(--mu-bg-secondary, #f8f9fa)';
    editButton.style.borderColor = '#5a6268';
  });
  editButton.addEventListener('mouseout', () => {
    editButton.style.backgroundColor = 'var(--mu-bg-primary, white)';
    editButton.style.borderColor = '#6c757d';
  });

  const saveButton = document.createElement('button');
  saveButton.id = `debug-save-btn-${integrationId}-${accountId}`;
  saveButton.textContent = '✔ Save';
  saveButton.style.cssText = `
    padding: 4px 10px;
    border: none;
    border-radius: 4px;
    background: #28a745;
    color: white;
    cursor: pointer;
    font-size: 12px;
    display: none;
    align-items: center;
    gap: 4px;
    transition: all 0.2s;
  `;
  saveButton.addEventListener('mouseover', () => {
    saveButton.style.backgroundColor = '#218838';
  });
  saveButton.addEventListener('mouseout', () => {
    saveButton.style.backgroundColor = '#28a745';
  });

  const cancelButton = document.createElement('button');
  cancelButton.id = `debug-cancel-btn-${integrationId}-${accountId}`;
  cancelButton.textContent = '✘ Cancel';
  cancelButton.style.cssText = `
    padding: 4px 10px;
    border: 1px solid #dc3545;
    border-radius: 4px;
    background: var(--mu-bg-primary, white);
    color: #dc3545;
    cursor: pointer;
    font-size: 12px;
    display: none;
    align-items: center;
    gap: 4px;
    transition: all 0.2s;
  `;
  cancelButton.addEventListener('mouseover', () => {
    cancelButton.style.backgroundColor = '#f8d7da';
  });
  cancelButton.addEventListener('mouseout', () => {
    cancelButton.style.backgroundColor = 'var(--mu-bg-primary, white)';
  });

  buttonContainer.appendChild(editButton);
  buttonContainer.appendChild(saveButton);
  buttonContainer.appendChild(cancelButton);
  expandableContent.appendChild(buttonContainer);

  const jsonContainer = document.createElement('pre');
  jsonContainer.id = `debug-json-view-${integrationId}-${accountId}`;
  jsonContainer.style.cssText = `
    background-color: #2d3748;
    color: #e2e8f0;
    padding: 12px;
    border-radius: 4px;
    font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
    font-size: 12px;
    line-height: 1.4;
    overflow-x: auto;
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
  `;
  jsonContainer.textContent = JSON.stringify(accountEntry, null, 2);
  expandableContent.appendChild(jsonContainer);

  const jsonTextarea = document.createElement('textarea');
  jsonTextarea.id = `debug-json-edit-${integrationId}-${accountId}`;
  jsonTextarea.style.cssText = `
    width: 100%;
    min-height: 300px;
    padding: 12px;
    border: 2px solid #0073b1;
    border-radius: 4px;
    font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
    font-size: 12px;
    line-height: 1.4;
    resize: vertical;
    display: none;
    box-sizing: border-box;
    background-color: #2d3748;
    color: #e2e8f0;
  `;
  jsonTextarea.value = JSON.stringify(accountEntry, null, 2);
  expandableContent.appendChild(jsonTextarea);

  sectionContainer.appendChild(expandableContent);

  let originalJson = JSON.stringify(accountEntry, null, 2);

  let isExpanded = false;
  sectionHeader.addEventListener('click', (e: Event) => {
    e.stopPropagation();
    isExpanded = !isExpanded;
    expandableContent.style.display = isExpanded ? 'block' : 'none';
    expandIcon.style.transform = isExpanded ? 'rotate(0deg)' : 'rotate(270deg)';
  });

  sectionHeader.addEventListener('mouseover', () => {
    sectionHeader.style.backgroundColor = 'var(--mu-bg-secondary, #f8f9fa)';
  });
  sectionHeader.addEventListener('mouseout', () => {
    sectionHeader.style.backgroundColor = 'var(--mu-bg-primary, #fff)';
  });

  editButton.addEventListener('click', (e: Event) => {
    e.stopPropagation();
    jsonContainer.style.display = 'none';
    jsonTextarea.style.display = 'block';
    editButton.style.display = 'none';
    saveButton.style.display = 'flex';
    cancelButton.style.display = 'flex';
    originalJson = jsonTextarea.value;
  });

  saveButton.addEventListener('click', (e: Event) => {
    e.stopPropagation();
    const newJsonValue = jsonTextarea.value;

    let parsedJson: Record<string, unknown>;
    try {
      parsedJson = JSON.parse(newJsonValue);
    } catch {
      toast.show('Invalid JSON format. Please fix the syntax and try again.', 'error');
      return;
    }

    const success = accountService.updateAccountInList(integrationId, accountId, parsedJson);

    if (success) {
      toast.show('Debug information saved successfully', 'info');
      jsonContainer.textContent = JSON.stringify(parsedJson, null, 2);
      originalJson = newJsonValue;
      jsonContainer.style.display = 'block';
      jsonTextarea.style.display = 'none';
      editButton.style.display = 'flex';
      saveButton.style.display = 'none';
      cancelButton.style.display = 'none';
      if (onSave) setTimeout(onSave, 500);
    } else {
      toast.show('Failed to save debug information', 'error');
    }
  });

  cancelButton.addEventListener('click', (e: Event) => {
    e.stopPropagation();
    jsonTextarea.value = originalJson;
    jsonContainer.style.display = 'block';
    jsonTextarea.style.display = 'none';
    editButton.style.display = 'flex';
    saveButton.style.display = 'none';
    cancelButton.style.display = 'none';
  });

  return sectionContainer;
}
