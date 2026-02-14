/**
 * Settings Modal - Shared Helper Functions
 * Common UI components and utilities used across settings modal tabs
 */

import { debugLog, getDefaultLookbackDays, validateLookbackVsRetention, getMinRetentionForInstitution, getLookbackForInstitution } from '../../core/utils';
import { STORAGE } from '../../core/config';
import { INTEGRATIONS, getCategoryMappingsConfig } from '../../core/integrationCapabilities';
import { getAuth, setSetting } from '../../services/common/configStore';
import { checkMonarchAuth } from '../../services/auth';
import { checkQuestradeAuth } from '../../services/questrade/auth';
import toast from '../toast';
import accountService from '../../services/common/accountService';
import { getMonarchAccountTypeMapping } from '../../mappers/wealthsimple-account-types';

/**
 * Checks connection status for an institution
 * @param {string} institutionId - Institution identifier
 * @returns {boolean} True if connected
 */
export function checkInstitutionConnection(institutionId) {
  switch (institutionId) {
  case 'questrade':
    return checkQuestradeAuth().authenticated;
  case 'canadalife':
    // Check for CanadaLife token in localStorage
    try {
      const token = localStorage.getItem(STORAGE.CANADALIFE_TOKEN_KEY);
      return Boolean(token);
    } catch (error) {
      return false;
    }
  case 'rogersbank': {
    // Check configStore first, then legacy key
    const rbAuth = getAuth(INTEGRATIONS.ROGERSBANK);
    if (rbAuth.authToken) return true;
    return Boolean(GM_getValue(STORAGE.ROGERSBANK_AUTH_TOKEN));
  }
  case 'wealthsimple': {
    // Check configStore first, then legacy key
    const wsAuth = getAuth(INTEGRATIONS.WEALTHSIMPLE);
    if (wsAuth.accessToken) return true;
    return Boolean(GM_getValue(STORAGE.WEALTHSIMPLE_ACCESS_TOKEN));
  }
  case 'monarch':
    return checkMonarchAuth().authenticated;
  default:
    return false;
  }
}

/**
 * Creates a lookback period configuration section for an institution
 * @param {string} institutionType - Type of institution ('questrade', 'canadalife', 'rogersbank')
 * @returns {HTMLElement} Lookback period section element
 */
export function createLookbackPeriodSection(institutionType) {
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

  // Get storage key based on institution type
  let storageKey;
  let institutionName;
  switch (institutionType) {
  case 'questrade':
    storageKey = STORAGE.QUESTRADE_LOOKBACK_DAYS;
    institutionName = 'Questrade';
    break;
  case 'canadalife':
    storageKey = STORAGE.CANADALIFE_LOOKBACK_DAYS;
    institutionName = 'CanadaLife';
    break;
  case 'rogersbank':
    storageKey = STORAGE.ROGERSBANK_LOOKBACK_DAYS;
    institutionName = 'Rogers Bank';
    break;
  case 'wealthsimple':
    storageKey = STORAGE.WEALTHSIMPLE_LOOKBACK_DAYS;
    institutionName = 'Wealthsimple';
    break;
  default:
    console.error('Unknown institution type:', institutionType);
    return section;
  }

  // Load current value or default (uses configStore for Wealthsimple)
  const defaultLookback = getDefaultLookbackDays(institutionType);
  const currentValue = getLookbackForInstitution(institutionType);
  input.value = currentValue;

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

  // Description
  const description = document.createElement('div');
  description.style.cssText = 'font-size: 13px; color: var(--mu-text-secondary, #666); margin-top: 8px; line-height: 1.4;';
  description.innerHTML = `
    <strong>How it works:</strong><br>
    • When uploading transactions after a previous upload exists, the system calculates the "from date" as: <code>Last Upload Date - Lookback Days</code><br>
    • This ensures no transactions are missed due to delayed processing or date discrepancies<br>
    • Default for ${institutionName}: <strong>${defaultLookback} day${defaultLookback !== 1 ? 's' : ''}</strong><br>
    • Range: 0-30 days (0 means start exactly from the last upload date)
  `;

  /**
   * Save lookback value to storage (configStore for Wealthsimple, legacy key for others)
   * @param {number} value - Lookback days value
   */
  const saveLookbackValue = (value) => {
    if (institutionType === 'wealthsimple') {
      setSetting(INTEGRATIONS.WEALTHSIMPLE, 'lookbackDays', value);
    } else if (institutionType === 'rogersbank') {
      setSetting(INTEGRATIONS.ROGERSBANK, 'lookbackDays', value);
    } else if (institutionType === 'questrade') {
      setSetting(INTEGRATIONS.QUESTRADE, 'lookbackDays', value);
    } else if (institutionType === 'canadalife') {
      setSetting(INTEGRATIONS.CANADALIFE, 'lookbackDays', value);
    }
    // Write to legacy key (all integrations for backward compat)
    GM_setValue(storageKey, value);
  };

  // Save changes
  const saveChanges = () => {
    const value = parseInt(input.value, 10);
    if (Number.isNaN(value) || value < 0 || value > 30) {
      input.value = currentValue; // Reset to previous valid value
      toast.show('Please enter a valid number between 0 and 30', 'error');
      return;
    }

    // Validate lookback vs retention
    const minRetention = getMinRetentionForInstitution(institutionType);
    const validation = validateLookbackVsRetention(value, minRetention);
    if (!validation.valid) {
      input.value = currentValue; // Reset to previous valid value
      toast.show(validation.error, 'error');
      return;
    }

    saveLookbackValue(value);
    toast.show(`${institutionName} lookback period set to ${value} day${value !== 1 ? 's' : ''}`, 'info');
    debugLog(`${institutionName} lookback period updated to: ${value} days`);
  };

  // Reset to default
  resetButton.addEventListener('click', () => {
    // Validate default lookback vs retention
    const minRetention = getMinRetentionForInstitution(institutionType);
    const validation = validateLookbackVsRetention(defaultLookback, minRetention);
    if (!validation.valid) {
      toast.show(`Cannot reset: ${validation.error}`, 'error');
      return;
    }

    input.value = defaultLookback;
    saveLookbackValue(defaultLookback);
    toast.show(`${institutionName} lookback period reset to default (${defaultLookback} day${defaultLookback !== 1 ? 's' : ''})`, 'info');
  });

  // Save on blur or enter
  input.addEventListener('blur', saveChanges);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
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
 * @param {Array} accounts - Array of consolidated account objects
 * @returns {Array} Sorted array of accounts
 */
export function sortWealthsimpleAccounts(accounts) {
  return accounts.sort((a, b) => {
    // First: Sort by enabled status (enabled first)
    if (a.syncEnabled !== b.syncEnabled) {
      return b.syncEnabled - a.syncEnabled; // true before false
    }

    // Second: Sort by account type priority
    const getTypePriority = (account) => {
      const accountType = account.wealthsimpleAccount.type;
      const mapping = getMonarchAccountTypeMapping(accountType);

      if (!mapping) return 999; // Unknown types last

      switch (mapping.type) {
      case 'credit': return 1; // Credit cards
      case 'depository': return 2; // Cash accounts
      case 'brokerage': return 3; // Investment accounts
      default: return 4; // Other types
      }
    };

    return getTypePriority(a) - getTypePriority(b);
  });
}

/**
 * Creates a section with title and description
 * @param {string} title - Section title
 * @param {string} icon - Section icon
 * @param {string} description - Section description
 * @returns {HTMLElement} Section element
 */
export function createSection(title, icon, description) {
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
 * @param {string} message - Confirmation message
 * @returns {Promise<boolean>} Promise that resolves to true if confirmed
 */
export function showConfirmDialog(message) {
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
 * @param {HTMLElement} container - Container to add logo to
 * @param {string} institutionName - Institution name for fallback
 */
export function addAccountLogoFallback(container, institutionName) {
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
 * @param {string} dateValue - Date value to format
 * @returns {string} Formatted date string
 */
export function formatLastUpdateDate(dateValue) {
  if (!dateValue) return 'Never';

  try {
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return 'Invalid date';

    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch (error) {
    return 'Invalid date';
  }
}

/**
 * Creates a styled toggle switch component (AirBnB/iOS style)
 * @param {boolean} isEnabled - Initial state (true = enabled/on, false = disabled/off)
 * @param {Function} onChange - Callback when toggle changes
 * @param {boolean} showLabel - Whether to show the Enabled/Disabled label (default: true)
 * @returns {HTMLElement} Toggle switch element
 */
export function createToggleSwitch(isEnabled, onChange, showLabel = true) {
  const container = document.createElement('label');
  container.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    user-select: none;
  `;

  let label = null;
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

  checkbox.addEventListener('change', (e) => {
    const newState = e.target.checked;
    switchContainer.style.backgroundColor = newState ? 'var(--mu-toggle-active-bg, #2196F3)' : 'var(--mu-toggle-bg, #ccc)';
    switchSlider.style.left = newState ? '22px' : '2px';
    // Update label text if it exists
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

  // Make the container clickable
  container.addEventListener('click', (e) => {
    e.preventDefault(); // Prevent default label behavior to avoid double-toggle
    checkbox.checked = !checkbox.checked;
    checkbox.dispatchEvent(new Event('change'));
  });

  return container;
}

/**
 * Renders category mappings section if the integration supports categorization
 * This is the capability-driven entry point - checks capabilities and renders appropriately
 * @param {string} integrationId - Integration identifier
 * @param {Function} onRefresh - Callback to refresh the tab after changes
 * @returns {HTMLElement} Category section element (or empty div if not supported)
 */
export function renderCategoryMappingsSectionIfEnabled(integrationId, onRefresh) {
  const categoryConfig = getCategoryMappingsConfig(integrationId);

  // If integration doesn't support categorization, return empty element
  if (!categoryConfig || !categoryConfig.storageKey) {
    return document.createElement('div');
  }

  // Create section wrapper
  const sectionWrapper = createSection('Category Mappings', '🏷️', `${categoryConfig.sourceLabel} to Monarch category mappings`);

  // Render the collapsible category mappings section
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
 * @param {string} integrationId - Integration identifier (rogersbank or wealthsimple)
 * @param {string} storageKey - Storage key for category mappings
 * @param {string} sourceColumnLabel - Label for the source column (e.g., "Bank Category" or "Merchant Name")
 * @param {Function} onRefresh - Callback to refresh the tab after changes
 * @returns {HTMLElement} Category mappings section element
 */
export function renderCategoryMappingsSection(integrationId, storageKey, sourceColumnLabel, onRefresh) {
  const sectionContainer = document.createElement('div');
  sectionContainer.id = `category-mappings-section-${integrationId}`;
  sectionContainer.style.cssText = 'margin-bottom: 15px;';

  // Get category mappings
  const categoryMappingsStr = GM_getValue(storageKey, '{}');
  let categoryData = [];
  const allCategories = new Set();

  try {
    const mappings = JSON.parse(categoryMappingsStr);
    categoryData = Object.entries(mappings).map(([sourceKey, monarchCategory]) => ({
      key: `${storageKey}.${sourceKey}`,
      sourceKey,
      monarchCategory,
    }));

    // Collect unique Monarch categories for dropdown
    categoryData.forEach((item) => {
      if (item.monarchCategory) {
        allCategories.add(item.monarchCategory);
      }
    });
  } catch (error) {
    debugLog(`Error parsing ${integrationId} category mappings:`, error);
  }

  // Section header with expand/collapse
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

  // Expandable content
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
    // Filter controls container
    const filterContainer = document.createElement('div');
    filterContainer.id = `category-mappings-filters-${integrationId}`;
    filterContainer.style.cssText = 'display: flex; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; align-items: flex-end;';

    // Source name filter (freetext)
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

    // Category filter (dropdown with search)
    const categoryFilterWrapper = document.createElement('div');
    categoryFilterWrapper.style.cssText = 'flex: 1; min-width: 200px; position: relative;';

    const categoryFilterLabel = document.createElement('label');
    categoryFilterLabel.textContent = 'Monarch Category';
    categoryFilterLabel.style.cssText = 'display: block; font-size: 12px; color: var(--mu-text-secondary, #666); margin-bottom: 4px; font-weight: 500;';
    categoryFilterWrapper.appendChild(categoryFilterLabel);

    // Searchable dropdown container
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

    // Dropdown arrow
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

    // Dropdown list
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

    // Define applyFilters early (referenced in event handlers below)
    // This will be properly initialized after table elements are created
    let applyFiltersCallback = () => {};

    // Add "All Categories" option
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

    // Add category options
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

    // Toggle dropdown on input click
    categoryInput.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = dropdownList.style.display === 'block';
      dropdownList.style.display = isVisible ? 'none' : 'block';
    });

    // Filter dropdown options as user types
    categoryInput.addEventListener('input', () => {
      const searchTerm = categoryInput.value.toLowerCase();
      const options = dropdownList.querySelectorAll('div[data-category]');
      options.forEach((option) => {
        const categoryName = option.dataset.category.toLowerCase();
        option.style.display = categoryName.includes(searchTerm) ? 'block' : 'none';
      });
      // Always show "All Categories" option
      allOption.style.display = 'block';
      dropdownList.style.display = 'block';
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!dropdownContainer.contains(e.target)) {
        dropdownList.style.display = 'none';
      }
    });

    dropdownContainer.appendChild(categoryInput);
    dropdownContainer.appendChild(dropdownArrow);
    dropdownContainer.appendChild(dropdownList);
    categoryFilterWrapper.appendChild(dropdownContainer);
    filterContainer.appendChild(categoryFilterWrapper);

    // Clear filters button
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
    clearFiltersBtn.addEventListener('click', (e) => {
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

    // Table container
    const tableContainer = document.createElement('div');
    tableContainer.id = `category-mappings-table-container-${integrationId}`;
    tableContainer.style.cssText = 'max-height: 300px; overflow-y: auto;';

    // Create table
    const table = document.createElement('table');
    table.id = `category-mappings-table-${integrationId}`;
    table.style.cssText = `
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    `;

    // Table header
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

    // Table body
    const tbody = document.createElement('tbody');
    tbody.id = `category-mappings-tbody-${integrationId}`;

    categoryData.forEach((item, index) => {
      const row = document.createElement('tr');
      row.id = `category-mapping-row-${integrationId}-${index}`;
      row.dataset.sourceKey = item.sourceKey.toLowerCase();
      row.dataset.category = item.monarchCategory.toLowerCase();

      // Source key cell
      const sourceCell = document.createElement('td');
      sourceCell.textContent = item.sourceKey;
      sourceCell.style.cssText = 'padding: 10px; border: 1px solid var(--mu-border, #e0e0e0);';
      row.appendChild(sourceCell);

      // Monarch category cell
      const categoryCell = document.createElement('td');
      categoryCell.textContent = item.monarchCategory;
      categoryCell.style.cssText = 'padding: 10px; border: 1px solid var(--mu-border, #e0e0e0);';
      row.appendChild(categoryCell);

      // Actions cell
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
      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const confirmed = await showConfirmDialog(
          `Delete mapping for "${item.sourceKey}"?\n\nMonarch Category: ${item.monarchCategory}`,
        );
        if (confirmed) {
          try {
            const currentMappings = JSON.parse(GM_getValue(storageKey, '{}'));
            delete currentMappings[item.sourceKey];
            GM_setValue(storageKey, JSON.stringify(currentMappings));
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
    // Filter results count
    const resultsCount = document.createElement('div');
    resultsCount.id = `category-mappings-results-count-${integrationId}`;
    resultsCount.style.cssText = 'margin-top: 8px; font-size: 12px; color: var(--mu-text-secondary, #666);';
    resultsCount.textContent = `Showing ${categoryData.length} of ${categoryData.length} mappings`;

    // Now define the actual applyFilters implementation and assign to callback
    applyFiltersCallback = () => {
      const sourceFilter = sourceFilterInput.value.toLowerCase();
      const categoryFilter = (categoryInput.dataset.selectedCategory || '').toLowerCase();

      const rows = tbody.querySelectorAll('tr');
      let visibleCount = 0;

      rows.forEach((row) => {
        const sourceKey = row.dataset.sourceKey;
        const category = row.dataset.category;

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

    // Attach filter event listeners
    sourceFilterInput.addEventListener('input', () => applyFiltersCallback());

    expandableContent.appendChild(filterContainer);
    expandableContent.appendChild(tableContainer);
    expandableContent.appendChild(resultsCount);

    // Delete All button
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
    deleteAllBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const confirmed = await showConfirmDialog(
        `Are you sure you want to delete ALL ${categoryData.length} category mapping(s)?\n\nThis action cannot be undone.`,
      );
      if (confirmed) {
        GM_setValue(storageKey, '{}');
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

  // Toggle expand/collapse
  let isExpanded = false;
  sectionHeader.addEventListener('click', (e) => {
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
 * @param {string} integrationId - Integration identifier
 * @param {Object} accountEntry - Consolidated account data object
 * @param {string} accountId - Account ID for updates
 * @param {Function} onSave - Callback after successful save
 * @returns {HTMLElement} Debug section element
 */
export function renderDebugJsonSection(integrationId, accountEntry, accountId, onSave) {
  const sectionContainer = document.createElement('div');
  sectionContainer.id = `debug-section-${integrationId}-${accountId}`;
  sectionContainer.style.cssText = 'margin-bottom: 15px;';

  // Section header with expand/collapse
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

  // Expandable content
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

  // Button container for Edit/Save/Cancel
  const buttonContainer = document.createElement('div');
  buttonContainer.id = `debug-buttons-${integrationId}-${accountId}`;
  buttonContainer.style.cssText = 'display: flex; gap: 8px; margin-bottom: 10px;';

  // Edit button (visible in view mode)
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

  // Save button (hidden in view mode)
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

  // Cancel button (hidden in view mode)
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

  // JSON container (view mode)
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

  // JSON textarea (edit mode - hidden by default)
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

  // Store original JSON for cancel functionality
  let originalJson = JSON.stringify(accountEntry, null, 2);

  // Toggle expand/collapse
  let isExpanded = false;
  sectionHeader.addEventListener('click', (e) => {
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

  // Edit button click handler
  editButton.addEventListener('click', (e) => {
    e.stopPropagation();
    jsonContainer.style.display = 'none';
    jsonTextarea.style.display = 'block';
    editButton.style.display = 'none';
    saveButton.style.display = 'flex';
    cancelButton.style.display = 'flex';
    originalJson = jsonTextarea.value;
  });

  // Save button click handler
  saveButton.addEventListener('click', (e) => {
    e.stopPropagation();
    const newJsonValue = jsonTextarea.value;

    // Validate JSON
    let parsedJson;
    try {
      parsedJson = JSON.parse(newJsonValue);
    } catch (error) {
      toast.show('Invalid JSON format. Please fix the syntax and try again.', 'error');
      return;
    }

    // Update the account in storage
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

  // Cancel button click handler
  cancelButton.addEventListener('click', (e) => {
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

