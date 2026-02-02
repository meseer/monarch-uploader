/**
 * Settings Modal Component
 * Provides a unified interface for managing application settings and stored data
 */

import { debugLog, getDefaultLookbackDays, validateLookbackVsRetention, getMinRetentionForInstitution, getLookbackForInstitution, getCurrentInstitution } from '../../core/utils';
import { STORAGE, API, TRANSACTION_RETENTION_DEFAULTS } from '../../core/config';
import { checkMonarchAuth } from '../../services/auth';
import { checkQuestradeAuth } from '../../services/questrade/auth';
import { isAccountSkipped, markAccountAsSkipped, getWealthsimpleAccounts } from '../../services/wealthsimple/account';
import toast from '../toast';
import { createMonarchLoginLink } from './monarchLoginLink';
import { getMonarchAccountTypeMapping } from '../../mappers/wealthsimple-account-types';
import {
  INTEGRATIONS,
  ACCOUNT_SETTINGS,
  getCapabilities,
  getAccountKeyName,
  getDisplayName,
  getFaviconUrl,
  hasSetting,
  getSettingDefault,
  getCategoryMappingsConfig,
} from '../../core/integrationCapabilities';
import accountService from '../../services/common/accountService';
import scriptInfo from '../../scriptInfo.json';

/**
 * Checks connection status for an institution
 * @param {string} institutionId - Institution identifier
 * @returns {boolean} True if connected
 */
function checkInstitutionConnection(institutionId) {
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
  case 'rogersbank':
    // Check for Rogers Bank auth token
    return Boolean(GM_getValue(STORAGE.ROGERSBANK_AUTH_TOKEN));
  case 'wealthsimple':
    // Check for Wealthsimple auth token
    return Boolean(GM_getValue(STORAGE.WEALTHSIMPLE_ACCESS_TOKEN));
  case 'monarch':
    return checkMonarchAuth().authenticated;
  default:
    return false;
  }
}

/**
 * Creates the settings modal
 * @returns {HTMLElement} Modal element
 */
export function createSettingsModal() {
  // Create modal backdrop
  const modal = document.createElement('div');
  modal.className = 'settings-modal-backdrop';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.5);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 10000;
  `;

  // Create modal content
  const modalContent = document.createElement('div');
  modalContent.className = 'settings-modal-content';
  modalContent.style.cssText = `
    background-color: white;
    border-radius: 8px;
    width: 900px;
    max-width: 95%;
    max-height: 90%;
    overflow: hidden;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  `;

  // Create header
  const header = document.createElement('div');
  header.style.cssText = `
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px;
    border-bottom: 1px solid #e0e0e0;
    background-color: #f8f9fa;
  `;

  const title = document.createElement('h2');
  title.textContent = 'Settings';
  title.style.cssText = 'margin: 0; font-size: 20px; font-weight: bold; color: #333;';
  header.appendChild(title);

  const closeButton = document.createElement('button');
  closeButton.innerHTML = '×';
  closeButton.style.cssText = `
    background: none;
    border: none;
    font-size: 24px;
    cursor: pointer;
    padding: 0;
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    color: #666;
  `;
  closeButton.addEventListener('click', () => modal.remove());
  closeButton.addEventListener('mouseover', () => {
    closeButton.style.backgroundColor = '#f0f0f0';
  });
  closeButton.addEventListener('mouseout', () => {
    closeButton.style.backgroundColor = 'transparent';
  });
  header.appendChild(closeButton);

  modalContent.appendChild(header);

  // Create main container with two columns
  const mainContainer = document.createElement('div');
  mainContainer.style.cssText = `
    display: flex;
    height: 550px;
  `;

  // Create tab navigation (left column)
  const tabNav = document.createElement('div');
  tabNav.className = 'settings-tab-nav';
  tabNav.style.cssText = `
    display: flex;
    flex-direction: column;
    width: 250px;
    background-color: #f8f9fa;
    border-right: 1px solid #e0e0e0;
    padding: 10px 0;
  `;

  // Create tab content container (right column)
  const tabContent = document.createElement('div');
  tabContent.className = 'settings-tab-content';
  tabContent.style.cssText = `
    flex: 1;
    padding: 20px;
    overflow-y: auto;
  `;

  // Define tabs with institution mapping for dynamic logos
  const tabs = [
    {
      id: 'general',
      label: 'General',
      fallbackIcon: '⚙️',
      storagePrefix: null,
      institutionName: null,
    },
    {
      id: 'questrade',
      label: 'Questrade',
      fallbackIcon: '💼',
      storagePrefix: STORAGE.QUESTRADE_ACCOUNT_MAPPING_PREFIX,
      institutionName: 'Questrade',
    },
    {
      id: 'canadalife',
      label: 'CanadaLife',
      fallbackIcon: '🏛️',
      storagePrefix: STORAGE.CANADALIFE_ACCOUNT_MAPPING_PREFIX,
      institutionName: 'Canada Life',
    },
    {
      id: 'rogersbank',
      label: 'Rogers Bank',
      fallbackIcon: '🏦',
      storagePrefix: STORAGE.ROGERSBANK_ACCOUNT_MAPPING_PREFIX,
      institutionName: 'Rogers Bank',
    },
    {
      id: 'wealthsimple',
      label: 'Wealthsimple',
      fallbackIcon: '💰',
      storagePrefix: STORAGE.WEALTHSIMPLE_ACCOUNT_MAPPING_PREFIX,
      institutionName: 'Wealthsimple',
    },
    {
      id: 'monarch',
      label: 'Monarch',
      fallbackIcon: '👑',
      storagePrefix: null,
      institutionName: 'Monarch Money',
    },
  ];

  let activeTab = 'general';

  // Create tab buttons
  tabs.forEach((tab) => {
    const tabButton = document.createElement('button');
    tabButton.className = `settings-tab-button ${tab.id === activeTab ? 'active' : ''}`;

    // Create button content with dynamic logo or fallback icon
    const buttonContent = document.createElement('div');
    buttonContent.style.cssText = 'display: flex; align-items: center;';

    if (tab.id === 'monarch') {
      // Use Google Favicon API for Monarch tab
      const logoContainer = document.createElement('div');
      logoContainer.style.cssText = 'display: inline-flex; margin-right: 6px;';

      GM_addElement(logoContainer, 'img', {
        src: 'https://www.google.com/s2/favicons?domain=monarchmoney.com&sz=128',
        style: 'width: 16px; height: 16px; border-radius: 3px; object-fit: contain;',
      });

      buttonContent.appendChild(logoContainer);
    } else if (tab.id === 'wealthsimple') {
      // Use Google Favicon API for Wealthsimple tab
      const logoContainer = document.createElement('div');
      logoContainer.style.cssText = 'display: inline-flex; margin-right: 6px;';

      GM_addElement(logoContainer, 'img', {
        src: 'https://www.google.com/s2/favicons?domain=wealthsimple.com&sz=128',
        style: 'width: 16px; height: 16px; border-radius: 3px; object-fit: contain;',
      });

      buttonContent.appendChild(logoContainer);
    } else if (tab.id === 'questrade') {
      // Use Google Favicon API for Questrade tab
      const logoContainer = document.createElement('div');
      logoContainer.style.cssText = 'display: inline-flex; margin-right: 6px;';

      GM_addElement(logoContainer, 'img', {
        src: 'https://www.google.com/s2/favicons?domain=questrade.com&sz=128',
        style: 'width: 16px; height: 16px; border-radius: 3px; object-fit: contain;',
      });

      buttonContent.appendChild(logoContainer);
    } else if (tab.id === 'canadalife') {
      // Use Google Favicon API for CanadaLife tab
      const logoContainer = document.createElement('div');
      logoContainer.style.cssText = 'display: inline-flex; margin-right: 6px;';

      GM_addElement(logoContainer, 'img', {
        src: 'https://www.google.com/s2/favicons?domain=canadalife.com&sz=128',
        style: 'width: 16px; height: 16px; border-radius: 3px; object-fit: contain;',
      });

      buttonContent.appendChild(logoContainer);
    } else if (tab.id === 'rogersbank') {
      // Use Google Favicon API for Rogers Bank tab
      const logoContainer = document.createElement('div');
      logoContainer.style.cssText = 'display: inline-flex; margin-right: 6px;';

      GM_addElement(logoContainer, 'img', {
        src: 'https://www.google.com/s2/favicons?domain=rogersbank.com&sz=128',
        style: 'width: 16px; height: 16px; border-radius: 3px; object-fit: contain;',
      });

      buttonContent.appendChild(logoContainer);
    } else {
      // Use fallback emoji for general tab
      const iconSpan = document.createElement('span');
      iconSpan.textContent = tab.fallbackIcon;
      iconSpan.style.cssText = 'margin-right: 6px;';
      buttonContent.appendChild(iconSpan);
    }

    // Add label text
    const labelSpan = document.createElement('span');
    labelSpan.textContent = tab.label;
    labelSpan.style.cssText = 'flex: 1;';
    buttonContent.appendChild(labelSpan);

    // Add connection indicator (except for General tab)
    if (tab.id !== 'general') {
      const isConnected = checkInstitutionConnection(tab.id);
      const connectionDot = document.createElement('span');
      connectionDot.style.cssText = `
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background-color: ${isConnected ? '#28a745' : '#dc3545'};
        margin-left: auto;
        flex-shrink: 0;
      `;
      connectionDot.title = isConnected ? 'Connected' : 'Not connected';
      buttonContent.appendChild(connectionDot);
    }

    tabButton.appendChild(buttonContent);
    tabButton.style.cssText = `
      background: none;
      border: none;
      padding: 15px 20px;
      cursor: pointer;
      font-size: 14px;
      border-left: 3px solid transparent;
      transition: all 0.2s;
      width: 100%;
      text-align: left;
      display: block;
    `;

    if (tab.id === activeTab) {
      tabButton.style.borderLeftColor = '#0073b1';
      tabButton.style.backgroundColor = 'white';
      tabButton.style.fontWeight = 'bold';
    }

    tabButton.addEventListener('click', () => {
      // Update active tab
      activeTab = tab.id;

      // Update tab button styles
      tabNav.querySelectorAll('.settings-tab-button').forEach((btn) => {
        btn.style.borderLeftColor = 'transparent';
        btn.style.backgroundColor = 'transparent';
        btn.style.fontWeight = 'normal';
      });

      tabButton.style.borderLeftColor = '#0073b1';
      tabButton.style.backgroundColor = 'white';
      tabButton.style.fontWeight = 'bold';

      // Update tab content
      renderTabContent(tabContent, activeTab);
    });

    tabButton.addEventListener('mouseover', () => {
      if (tab.id !== activeTab) {
        tabButton.style.backgroundColor = '#f0f0f0';
      }
    });

    tabButton.addEventListener('mouseout', () => {
      if (tab.id !== activeTab) {
        tabButton.style.backgroundColor = 'transparent';
      }
    });

    tabNav.appendChild(tabButton);
  });

  // Add version link at the bottom of tab navigation
  const versionContainer = document.createElement('div');
  versionContainer.id = 'settings-version-container';
  versionContainer.style.cssText = `
    margin-top: auto;
    padding: 15px 20px;
    border-top: 1px solid #e0e0e0;
  `;

  const versionLink = document.createElement('a');
  versionLink.id = 'settings-version-link';
  versionLink.href = scriptInfo.gistUrl;
  versionLink.target = '_blank';
  versionLink.rel = 'noopener noreferrer';
  versionLink.textContent = `v${scriptInfo.version}`;
  versionLink.style.cssText = `
    font-size: 12px;
    color: #666;
    text-decoration: none;
    display: inline-block;
    transition: color 0.2s;
  `;
  versionLink.addEventListener('mouseover', () => {
    versionLink.style.color = '#0073b1';
    versionLink.style.textDecoration = 'underline';
  });
  versionLink.addEventListener('mouseout', () => {
    versionLink.style.color = '#666';
    versionLink.style.textDecoration = 'none';
  });

  versionContainer.appendChild(versionLink);
  tabNav.appendChild(versionContainer);

  mainContainer.appendChild(tabNav);
  mainContainer.appendChild(tabContent);
  modalContent.appendChild(mainContainer);

  // Initial tab content render
  renderTabContent(tabContent, activeTab);

  modal.appendChild(modalContent);

  // Close modal when clicking backdrop
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });

  // Close modal with Escape key
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      modal.remove();
      document.removeEventListener('keydown', handleKeyDown);
    }
  };
  document.addEventListener('keydown', handleKeyDown);

  return modal;
}

/**
 * Renders content for the active tab
 * @param {HTMLElement} container - Tab content container
 * @param {string} tabId - Active tab ID
 */
function renderTabContent(container, tabId) {
  container.innerHTML = '';

  switch (tabId) {
  case 'general':
    renderGeneralTab(container);
    break;
  case 'questrade':
    renderQuestradeTab(container);
    break;
  case 'canadalife':
    renderCanadaLifeTab(container);
    break;
  case 'rogersbank':
    renderRogersBankTab(container);
    break;
  case 'wealthsimple':
    renderWealthsimpleTab(container);
    break;
  case 'monarch':
    renderMonarchTab(container);
    break;
  default:
    container.innerHTML = '<p>Tab content not found.</p>';
  }
}

/**
 * Renders the General settings tab
 * @param {HTMLElement} container - Container element
 */
function renderGeneralTab(container) {
  // Log Level Section
  const logLevelSection = createSection('Log Level', '🔍', 'Configure application logging level');

  const logLevelContainer = document.createElement('div');
  logLevelContainer.style.cssText = 'margin: 15px 0;';

  const label = document.createElement('label');
  label.textContent = 'Log Level:';
  label.style.cssText = 'display: block; margin-bottom: 8px; font-weight: bold;';

  const select = document.createElement('select');
  select.id = 'settings-log-level-select';
  select.style.cssText = `
    padding: 8px 12px;
    border: 1px solid #ccc;
    border-radius: 4px;
    font-size: 14px;
    min-width: 150px;
  `;

  const logLevels = [
    { value: 'debug', label: 'Debug (Show all logs)' },
    { value: 'info', label: 'Info (Show info, warnings, errors)' },
    { value: 'warning', label: 'Warning (Show warnings and errors)' },
    { value: 'error', label: 'Error (Show only errors)' },
  ];

  const currentLogLevel = GM_getValue('debug_log_level', 'info');

  logLevels.forEach((level) => {
    const option = document.createElement('option');
    option.value = level.value;
    option.textContent = level.label;
    option.selected = level.value === currentLogLevel;
    select.appendChild(option);
  });

  select.addEventListener('change', () => {
    GM_setValue('debug_log_level', select.value);
    toast.show(`Log level set to: ${select.options[select.selectedIndex].text}`, 'info');
    debugLog(`Log level changed to: ${select.value}`);
  });

  logLevelContainer.appendChild(label);
  logLevelContainer.appendChild(select);
  logLevelSection.appendChild(logLevelContainer);

  container.appendChild(logLevelSection);

  // Development Mode Section
  const devModeSection = createSection('Development Mode', '🔧', 'Enable development features and testing tools');

  const devModeContainer = document.createElement('div');
  devModeContainer.id = 'settings-dev-mode-container';
  devModeContainer.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 12px 15px; background: #f8f9fa; border-radius: 8px; border: 1px solid #e0e0e0;';

  const devModeLabel = document.createElement('div');
  devModeLabel.innerHTML = `
    <div style="font-weight: 500; font-size: 14px; margin-bottom: 4px;">Enable Development Mode</div>
    <div style="font-size: 12px; color: #666;">When enabled, shows development-only UI elements like testing sections in Canada Life</div>
  `;

  const currentDevMode = GM_getValue(STORAGE.DEVELOPMENT_MODE, false);
  const devModeToggle = createToggleSwitch(
    currentDevMode,
    (isEnabled) => {
      GM_setValue(STORAGE.DEVELOPMENT_MODE, isEnabled);

      // If on Canada Life, refresh UI immediately
      const currentInstitution = getCurrentInstitution();
      if (currentInstitution === 'canadalife') {
        // Dynamically import to avoid circular dependencies
        import('../canadalife/uiManager').then((module) => {
          const refreshed = module.refreshCanadaLifeUI();
          if (refreshed) {
            toast.show(`Development mode ${isEnabled ? 'enabled' : 'disabled'}`, 'info');
          } else {
            toast.show(`Development mode ${isEnabled ? 'enabled' : 'disabled'}. Refresh the page to see changes.`, 'info');
          }
        }).catch((error) => {
          debugLog('Error refreshing Canada Life UI:', error);
          toast.show(`Development mode ${isEnabled ? 'enabled' : 'disabled'}. Refresh the page to see changes.`, 'info');
        });
      } else {
        toast.show(`Development mode ${isEnabled ? 'enabled' : 'disabled'}. Refresh the page to see changes.`, 'info');
      }

      debugLog(`Development mode changed to: ${isEnabled}`);
    },
    false, // Don't show Enabled/Disabled label
  );

  devModeContainer.appendChild(devModeLabel);
  devModeContainer.appendChild(devModeToggle);
  devModeSection.appendChild(devModeContainer);

  container.appendChild(devModeSection);
}

/**
 * Creates a lookback period configuration section for an institution
 * @param {string} institutionType - Type of institution ('questrade', 'canadalife', 'rogersbank')
 * @returns {HTMLElement} Lookback period section element
 */
function createLookbackPeriodSection(institutionType) {
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
    border: 1px solid #ccc;
    border-radius: 4px;
    font-size: 14px;
    width: 80px;
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

  // Load current value or default
  const defaultLookback = getDefaultLookbackDays(institutionType);
  const currentValue = GM_getValue(storageKey, defaultLookback);
  input.value = currentValue;

  const daysLabel = document.createElement('span');
  daysLabel.textContent = 'days';
  daysLabel.style.cssText = 'color: #666; font-size: 14px;';

  const resetButton = document.createElement('button');
  resetButton.textContent = 'Reset to Default';
  resetButton.style.cssText = `
    padding: 6px 12px;
    border: 1px solid #ccc;
    border-radius: 4px;
    background: white;
    cursor: pointer;
    font-size: 12px;
    margin-left: 10px;
  `;

  inputContainer.appendChild(input);
  inputContainer.appendChild(daysLabel);
  inputContainer.appendChild(resetButton);

  // Description
  const description = document.createElement('div');
  description.style.cssText = 'font-size: 13px; color: #666; margin-top: 8px; line-height: 1.4;';
  description.innerHTML = `
    <strong>How it works:</strong><br>
    • When uploading transactions after a previous upload exists, the system calculates the "from date" as: <code>Last Upload Date - Lookback Days</code><br>
    • This ensures no transactions are missed due to delayed processing or date discrepancies<br>
    • Default for ${institutionName}: <strong>${defaultLookback} day${defaultLookback !== 1 ? 's' : ''}</strong><br>
    • Range: 0-30 days (0 means start exactly from the last upload date)
  `;

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

    GM_setValue(storageKey, value);
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
    GM_setValue(storageKey, defaultLookback);
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
    resetButton.style.backgroundColor = '#f8f9fa';
  });
  resetButton.addEventListener('mouseout', () => {
    resetButton.style.backgroundColor = 'white';
  });

  configContainer.appendChild(label);
  configContainer.appendChild(inputContainer);
  configContainer.appendChild(description);
  section.appendChild(configContainer);

  return section;
}

/**
 * Renders the Questrade settings tab
 * @param {HTMLElement} container - Container element
 */
function renderQuestradeTab(container) {
  // Lookback Period Section
  const lookbackSection = createLookbackPeriodSection('questrade');
  container.appendChild(lookbackSection);

  // Account Mappings Section using generic account cards
  const mappingsSection = createSection('Account Mappings', '🔗', 'Questrade to Monarch account mappings');

  // Get accounts from unified account service (handles migration from legacy storage)
  const accounts = accountService.getAccounts(INTEGRATIONS.QUESTRADE);

  const accountCards = createGenericAccountCards(INTEGRATIONS.QUESTRADE, accounts, () => {
    // Refresh callback
    renderTabContent(container, 'questrade');
  });
  mappingsSection.appendChild(accountCards);

  container.appendChild(mappingsSection);
}

/**
 * Renders the CanadaLife settings tab
 * @param {HTMLElement} container - Container element
 */
function renderCanadaLifeTab(container) {
  // Lookback Period Section
  const lookbackSection = createLookbackPeriodSection('canadalife');
  container.appendChild(lookbackSection);

  // Account Mappings Section using generic account cards
  const mappingsSection = createSection('Account Mappings', '🔗', 'CanadaLife to Monarch account mappings');

  // Get accounts from unified account service (handles migration from legacy storage)
  const accounts = accountService.getAccounts(INTEGRATIONS.CANADALIFE);

  const accountCards = createGenericAccountCards(INTEGRATIONS.CANADALIFE, accounts, () => {
    // Refresh callback
    renderTabContent(container, 'canadalife');
  });
  mappingsSection.appendChild(accountCards);

  container.appendChild(mappingsSection);
}

/**
 * Renders the Rogers Bank settings tab
 * @param {HTMLElement} container - Container element
 */
function renderRogersBankTab(container) {
  // Lookback Period Section
  const lookbackSection = createLookbackPeriodSection('rogersbank');
  container.appendChild(lookbackSection);

  // Account Mappings Section using generic account cards
  const mappingsSection = createSection('Account Mappings', '🔗', 'Rogers Bank to Monarch account mappings');

  // Get accounts from unified account service (handles migration from legacy storage)
  const accounts = accountService.getAccounts(INTEGRATIONS.ROGERSBANK);

  const accountCards = createGenericAccountCards(INTEGRATIONS.ROGERSBANK, accounts, () => {
    // Refresh callback
    renderTabContent(container, 'rogersbank');
  });
  mappingsSection.appendChild(accountCards);

  container.appendChild(mappingsSection);

  // Category Mappings Section (capability-driven)
  const categorySection = renderCategoryMappingsSectionIfEnabled(INTEGRATIONS.ROGERSBANK, () => {
    renderTabContent(container, 'rogersbank');
  });
  container.appendChild(categorySection);
}

/**
 * Sort Wealthsimple accounts by sync status and account type
 * Priority: Enabled first, then by type (credit > cash > investment)
 * @param {Array} accounts - Array of consolidated account objects
 * @returns {Array} Sorted array of accounts
 */
function sortWealthsimpleAccounts(accounts) {
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
 * Renders the Wealthsimple settings tab
 * @param {HTMLElement} container - Container element
 */
function renderWealthsimpleTab(container) {
  // Lookback Period Section
  const lookbackSection = createLookbackPeriodSection('wealthsimple');
  container.appendChild(lookbackSection);

  // Account Mappings Section using generic account cards
  const mappingsSection = createSection('Account Mappings', '🔗', 'Wealthsimple to Monarch account mappings');

  // Get accounts from unified account service (handles migration from legacy storage)
  const accounts = accountService.getAccounts(INTEGRATIONS.WEALTHSIMPLE);

  // Sort accounts before rendering (enabled first, then by type)
  const sortedAccounts = sortWealthsimpleAccounts(accounts);

  const accountCards = createGenericAccountCards(INTEGRATIONS.WEALTHSIMPLE, sortedAccounts, () => {
    // Refresh callback
    renderTabContent(container, 'wealthsimple');
  });
  mappingsSection.appendChild(accountCards);

  container.appendChild(mappingsSection);

  // Category Mappings Section (capability-driven)
  const categorySection = renderCategoryMappingsSectionIfEnabled(INTEGRATIONS.WEALTHSIMPLE, () => {
    renderTabContent(container, 'wealthsimple');
  });
  container.appendChild(categorySection);
}

/**
 * Renders the Monarch settings tab
 * @param {HTMLElement} container - Container element
 */
function renderMonarchTab(container) {
  // Connection Status Section
  const statusSection = createSection('Connection Status', '🔗', 'Current Monarch Money authentication status');

  const statusContainer = document.createElement('div');
  statusContainer.style.cssText = 'margin: 15px 0;';

  // Get current authentication status
  const authStatus = checkMonarchAuth();

  // Status indicator
  const statusIndicator = document.createElement('div');
  statusIndicator.style.cssText = `
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 15px;
    padding: 12px;
    border-radius: 6px;
    ${authStatus.authenticated
    ? 'background-color: #d4edda; border: 1px solid #c3e6cb; color: #155724;'
    : 'background-color: #f8d7da; border: 1px solid #f5c6cb; color: #721c24;'
}
  `;

  // Status icon
  const statusIcon = document.createElement('span');
  statusIcon.textContent = authStatus.authenticated ? '✅' : '❌';
  statusIcon.style.cssText = 'font-size: 18px;';
  statusIndicator.appendChild(statusIcon);

  // Status text
  const statusText = document.createElement('div');
  statusText.style.cssText = 'font-weight: 500;';

  if (authStatus.authenticated) {
    statusText.textContent = 'Connected to Monarch Money';
  } else {
    // Create clickable login link for non-authenticated state
    const loginLink = createMonarchLoginLink('Not connected to Monarch Money', () => {
      // Callback to refresh the tab after successful login using proper tab rendering
      const tabContainer = document.querySelector('.settings-tab-content');
      if (tabContainer) {
        renderTabContent(tabContainer, 'monarch');
      }
    });
    statusText.appendChild(loginLink);
  }

  statusIndicator.appendChild(statusText);

  statusContainer.appendChild(statusIndicator);

  // Status details
  const statusDetails = document.createElement('div');
  statusDetails.style.cssText = 'font-size: 13px; color: #666; margin-bottom: 15px; line-height: 1.4;';

  if (authStatus.authenticated) {
    statusDetails.innerHTML = `
      <strong>Status:</strong> Your authentication token is stored and ready to use.<br>
      <strong>Usage:</strong> This token is used to authenticate with Monarch Money's API for transaction uploads.
    `;
  } else {
    // MIGRATION: Use dynamic Monarch app URL
    statusDetails.innerHTML = `
      <strong>Status:</strong> No authentication token found.<br>
      <strong>To connect:</strong> Visit <a href="${API.MONARCH_APP_URL}" target="_blank" style="color: #0073b1; text-decoration: none;">Monarch Money</a> and log in. The token will be automatically captured.
    `;
  }

  statusContainer.appendChild(statusDetails);
  statusSection.appendChild(statusContainer);

  // Token Management Section (only show if authenticated)
  if (authStatus.authenticated) {
    const tokenSection = createSection('Token Management', '🔑', 'Manage your stored authentication token');

    const tokenContainer = document.createElement('div');
    tokenContainer.style.cssText = 'margin: 15px 0;';

    // Token info
    const tokenInfo = document.createElement('div');
    tokenInfo.style.cssText = 'margin-bottom: 15px; font-size: 14px; color: #666;';
    tokenInfo.textContent = 'Your authentication token is securely stored locally and is used to access Monarch Money\'s API.';
    tokenContainer.appendChild(tokenInfo);

    // Remove token button
    const removeButton = document.createElement('button');
    removeButton.textContent = 'Remove Authentication Token';
    removeButton.style.cssText = `
      padding: 10px 16px;
      border: none;
      border-radius: 4px;
      background: #dc3545;
      color: white;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      transition: background-color 0.2s;
    `;

    removeButton.addEventListener('click', async () => {
      // MIGRATION: Use dynamic domain in message
      const monarchDomain = API.MONARCH_APP_URL.replace('https://app.', '');
      const confirmed = await showConfirmDialog(
        `Are you sure you want to remove your Monarch Money authentication token?\n\nThis will disconnect the application from your Monarch Money account. You will need to log in again at ${monarchDomain} to reconnect.`,
      );

      if (confirmed) {
        // Remove the token
        GM_deleteValue(STORAGE.MONARCH_TOKEN);
        toast.show('Monarch Money authentication token removed', 'info');
        debugLog('Monarch token removed by user');

        // Refresh the tab to show updated status using proper tab rendering
        const tabContainer = document.querySelector('.settings-tab-content');
        if (tabContainer) {
          renderTabContent(tabContainer, 'monarch');
        }
      }
    });

    removeButton.addEventListener('mouseover', () => {
      removeButton.style.backgroundColor = '#c82333';
    });

    removeButton.addEventListener('mouseout', () => {
      removeButton.style.backgroundColor = '#dc3545';
    });

    tokenContainer.appendChild(removeButton);
    tokenSection.appendChild(tokenContainer);

    container.appendChild(statusSection);
    container.appendChild(tokenSection);
  } else {
    container.appendChild(statusSection);
  }
}

/**
 * Creates a section with title and description
 * @param {string} title - Section title
 * @param {string} icon - Section icon
 * @param {string} description - Section description
 * @returns {HTMLElement} Section element
 */
function createSection(title, icon, description) {
  const section = document.createElement('div');
  section.style.cssText = 'margin-bottom: 30px;';

  const header = document.createElement('div');
  header.style.cssText = 'margin-bottom: 15px;';

  const titleElement = document.createElement('h3');
  titleElement.innerHTML = `${icon} ${title}`;
  titleElement.style.cssText = 'margin: 0 0 5px 0; font-size: 16px; font-weight: bold; color: #333;';

  const descElement = document.createElement('p');
  descElement.textContent = description;
  descElement.style.cssText = 'margin: 0; font-size: 14px; color: #666;';

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
function showConfirmDialog(message) {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(0, 0, 0, 0.5);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 10001;
    `;

    const dialog = document.createElement('div');
    dialog.style.cssText = `
      background-color: white;
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
      border: 1px solid #ccc;
      border-radius: 4px;
      background: white;
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
function addAccountLogoFallback(container, institutionName) {
  const logoFallback = document.createElement('div');
  logoFallback.style.cssText = `
    width: 40px;
    height: 40px;
    border-radius: 5px;
    background-color: #e0e0e0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    color: #666;
    font-weight: bold;
  `;
  const firstChar = institutionName ? institutionName.charAt(0).toUpperCase() : '?';
  logoFallback.textContent = firstChar;
  container.appendChild(logoFallback);
}

/**
 * Gets the last update date for an account based on institution type
 * @param {string} displayKey - Account display key (without prefix)
 * @param {string} institutionType - Type of institution ('questrade', 'canadalife', 'rogersbank')
 * @returns {string|null} Last update date or null if not found
 */
function getLastUpdateDate(displayKey, institutionType) {
  let storageKey;

  switch (institutionType) {
  case 'questrade':
    storageKey = STORAGE.QUESTRADE_LAST_UPLOAD_DATE_PREFIX + displayKey;
    break;
  case 'canadalife':
    storageKey = STORAGE.CANADALIFE_LAST_UPLOAD_DATE_PREFIX + displayKey;
    break;
  case 'rogersbank':
    storageKey = STORAGE.ROGERSBANK_LAST_UPLOAD_DATE_PREFIX + displayKey;
    break;
  default:
    return null;
  }

  return GM_getValue(storageKey, null);
}

/**
 * Clears the last update date for an account based on institution type
 * @param {string} displayKey - Account display key (without prefix)
 * @param {string} institutionType - Type of institution ('questrade', 'canadalife', 'rogersbank')
 * @param {Function} onClear - Callback function to execute after clearing
 */
function clearLastUpdateDate(displayKey, institutionType, onClear) {
  let storageKey;

  switch (institutionType) {
  case 'questrade':
    storageKey = STORAGE.QUESTRADE_LAST_UPLOAD_DATE_PREFIX + displayKey;
    break;
  case 'canadalife':
    storageKey = STORAGE.CANADALIFE_LAST_UPLOAD_DATE_PREFIX + displayKey;
    break;
  case 'rogersbank':
    storageKey = STORAGE.ROGERSBANK_LAST_UPLOAD_DATE_PREFIX + displayKey;
    break;
  default:
    return;
  }

  GM_deleteValue(storageKey);
  toast.show('Last update date cleared', 'info');
  if (onClear) onClear();
}

/**
 * Formats a date for display
 * @param {string} dateValue - Date value to format
 * @returns {string} Formatted date string
 */
function formatLastUpdateDate(dateValue) {
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
function createToggleSwitch(isEnabled, onChange, showLabel = true) {
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
    label.style.cssText = 'font-size: 13px; color: #666;';
  }

  const switchContainer = document.createElement('div');
  switchContainer.style.cssText = `
    position: relative;
    width: 44px;
    height: 24px;
    background-color: ${isEnabled ? '#2196F3' : '#ccc'};
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
    switchContainer.style.backgroundColor = newState ? '#2196F3' : '#ccc';
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
 * Creates account mapping cards (for Monarch account mappings)
 * @deprecated Will be removed in Phase 7 cleanup - use createGenericAccountCards instead
 * @param {Array} data - Array of [key, displayKey, value] tuples
 * @param {Function} onDelete - Delete handler
 * @param {string} institutionName - Institution name for logo fallback
 * @param {string} institutionType - Type of institution for last update date lookup
 * @returns {HTMLElement} Cards container element
 */
// eslint-disable-next-line no-unused-vars
function createAccountMappingCards(data, onDelete, institutionName, institutionType) {
  if (data.length === 0) {
    const emptyMessage = document.createElement('p');
    emptyMessage.textContent = 'No account mappings found.';
    emptyMessage.style.cssText = 'color: #666; font-style: italic; margin: 10px 0;';
    return emptyMessage;
  }

  const container = document.createElement('div');
  container.style.cssText = 'margin: 10px 0;';

  data.forEach(([key, displayKey, value]) => {
    let accountData = null;
    try {
      accountData = JSON.parse(value);
    } catch (error) {
      debugLog('Error parsing account data:', error);
      return; // Skip invalid entries
    }

    // Create card container
    const card = document.createElement('div');
    card.style.cssText = `
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      margin-bottom: 15px;
      overflow: hidden;
      transition: all 0.2s;
    `;

    // Check if account is skipped (from accounts list)
    const accountId = displayKey;
    const isSkipped = institutionType === 'wealthsimple' && isAccountSkipped(accountId);

    // Create card header (always visible)
    const cardHeader = document.createElement('div');
    cardHeader.style.cssText = `
      display: flex;
      align-items: center;
      padding: 15px;
      background-color: ${isSkipped ? '#fafafa' : '#fff'};
      cursor: pointer;
      transition: background-color 0.2s;
    `;

    // Expand/collapse icon (moved to be first, before logo)
    const expandIcon = document.createElement('div');
    expandIcon.style.cssText = `
      margin-right: 10px;
      font-size: 1.2em;
      color: ${isSkipped ? '#999' : '#666'};
      transition: transform 0.2s;
      cursor: pointer;
      flex-shrink: 0;
      transform: rotate(270deg);
    `;
    expandIcon.textContent = '▼';
    cardHeader.appendChild(expandIcon);

    // Logo container
    const logoContainer = document.createElement('div');
    logoContainer.style.cssText = `margin-right: 15px; flex-shrink: 0; ${isSkipped ? 'opacity: 0.5;' : ''}`;

    // Use account logo or fallback
    if (accountData.logoUrl) {
      try {
        GM_addElement(logoContainer, 'img', {
          src: accountData.logoUrl,
          style: 'width: 40px; height: 40px; border-radius: 5px; object-fit: contain;',
        });
      } catch (error) {
        // Add letter fallback if logo fails
        addAccountLogoFallback(logoContainer, institutionName);
      }
    } else if (institutionType === 'wealthsimple') {
      // Use Google Favicon API for Wealthsimple accounts as fallback
      try {
        GM_addElement(logoContainer, 'img', {
          src: 'https://www.google.com/s2/favicons?domain=wealthsimple.com&sz=128',
          style: 'width: 40px; height: 40px; border-radius: 5px; object-fit: contain;',
        });
      } catch (error) {
        // Add letter fallback if favicon fails
        addAccountLogoFallback(logoContainer, institutionName);
      }
    } else if (institutionType === 'rogersbank') {
      // Use Google Favicon API for Rogers Bank accounts as fallback
      try {
        GM_addElement(logoContainer, 'img', {
          src: 'https://www.google.com/s2/favicons?domain=rogersbank.com&sz=128',
          style: 'width: 40px; height: 40px; border-radius: 5px; object-fit: contain;',
        });
      } catch (error) {
        // Add letter fallback if favicon fails
        addAccountLogoFallback(logoContainer, institutionName);
      }
    } else {
      // Add letter fallback for other institutions
      addAccountLogoFallback(logoContainer, institutionName);
    }
    cardHeader.appendChild(logoContainer);

    // Account info section
    const infoContainer = document.createElement('div');
    infoContainer.style.cssText = 'flex-grow: 1;';

    // Account name
    const nameDiv = document.createElement('div');
    nameDiv.className = 'account-name';
    nameDiv.style.cssText = `font-weight: bold; font-size: 1.1em; margin-bottom: 2px; color: ${isSkipped ? '#999' : '#333'};`;
    nameDiv.textContent = accountData.displayName || 'Unknown Account';
    infoContainer.appendChild(nameDiv);

    // Account subtype
    if (accountData.subtype?.display) {
      const subtypeDiv = document.createElement('div');
      subtypeDiv.style.cssText = 'font-size: 0.9em; color: #666; margin-bottom: 2px;';
      subtypeDiv.textContent = accountData.subtype.display;
      infoContainer.appendChild(subtypeDiv);
    }

    // Account balance (if available)
    if (accountData.currentBalance !== undefined) {
      const balanceDiv = document.createElement('div');
      balanceDiv.style.cssText = 'font-size: 0.85em; color: #555;';
      balanceDiv.textContent = `Balance: ${new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
      }).format(accountData.currentBalance)}`;
      infoContainer.appendChild(balanceDiv);
    }

    // Last update date (if available and institution type provided)
    if (institutionType) {
      const lastUpdateDate = getLastUpdateDate(displayKey, institutionType);
      const lastUpdateDiv = document.createElement('div');
      lastUpdateDiv.style.cssText = 'font-size: 0.8em; color: #555; margin-bottom: 2px; display: flex; align-items: center; gap: 8px;';

      const dateText = document.createElement('span');
      dateText.textContent = `Last Updated: ${formatLastUpdateDate(lastUpdateDate)}`;
      lastUpdateDiv.appendChild(dateText);

      // Add clear button if date exists
      if (lastUpdateDate) {
        const clearButton = document.createElement('button');
        clearButton.textContent = 'Clear';
        clearButton.style.cssText = `
          background: #6c757d;
          color: white;
          border: none;
          border-radius: 3px;
          padding: 2px 6px;
          font-size: 10px;
          cursor: pointer;
          transition: background-color 0.2s;
        `;
        clearButton.addEventListener('click', (e) => {
          e.stopPropagation(); // Prevent card toggle
          clearLastUpdateDate(displayKey, institutionType, () => {
            // Refresh the current tab
            const tabContainer = document.querySelector('.settings-tab-content');
            if (tabContainer) {
              renderTabContent(tabContainer, institutionType);
            }
          });
        });
        clearButton.addEventListener('mouseover', () => {
          clearButton.style.backgroundColor = '#5a6268';
        });
        clearButton.addEventListener('mouseout', () => {
          clearButton.style.backgroundColor = '#6c757d';
        });
        lastUpdateDiv.appendChild(clearButton);
      }

      infoContainer.appendChild(lastUpdateDiv);
    }

    // Mapping info (institution account name)
    const mappingDiv = document.createElement('div');
    mappingDiv.style.cssText = 'font-size: 0.8em; color: #888; margin-top: 5px;';
    mappingDiv.textContent = `Mapped from: ${displayKey}`;
    infoContainer.appendChild(mappingDiv);

    cardHeader.appendChild(infoContainer);

    // Add toggle switch for Wealthsimple accounts only (to enable/disable skip)
    if (institutionType === 'wealthsimple') {
      const toggleContainer = document.createElement('div');
      toggleContainer.style.cssText = 'margin-left: auto; margin-right: 10px; flex-shrink: 0;';

      const toggle = createToggleSwitch(!isSkipped, (isEnabled) => {
        // Update skip status (inverted: enabled = not skipped)
        const shouldSkip = !isEnabled;
        const success = markAccountAsSkipped(accountId, shouldSkip);

        if (success) {
          // Update visual styling immediately
          cardHeader.style.backgroundColor = shouldSkip ? '#fafafa' : '#fff';
          nameDiv.style.color = shouldSkip ? '#999' : '#333';
          expandIcon.style.color = shouldSkip ? '#999' : '#666';
          logoContainer.style.opacity = shouldSkip ? '0.5' : '1';

          // Show confirmation
          const status = shouldSkip ? 'disabled' : 'enabled';
          toast.show(`Account ${accountData.displayName} ${status}`, 'info');

          // Optionally refresh the tab to ensure consistency
          setTimeout(() => {
            const tabContainer = document.querySelector('.settings-tab-content');
            if (tabContainer) {
              renderTabContent(tabContainer, institutionType);
            }
          }, 1500);
        } else {
          toast.show('Failed to update account status', 'error');
        }
      });

      toggleContainer.appendChild(toggle);
      cardHeader.appendChild(toggleContainer);

      // Stop propagation on toggle clicks to prevent card expansion
      toggleContainer.addEventListener('click', (e) => {
        e.stopPropagation();
      });
    }

    // Delete button (changed from ✕ to trash icon 🗑️)
    const deleteButton = document.createElement('button');
    deleteButton.textContent = '🗑️';
    deleteButton.style.cssText = `
      margin-left: 10px;
      background: transparent;
      color: #dc3545;
      border: none;
      border-radius: 50%;
      width: 24px;
      height: 24px;
      cursor: pointer;
      font-size: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    `;
    deleteButton.addEventListener('click', async (e) => {
      e.stopPropagation(); // Prevent card toggle
      const confirmed = await showConfirmDialog(
        `Are you sure you want to delete the mapping for "${displayKey}"?\n\nThis will unlink the account from Monarch.`,
      );
      if (confirmed) {
        onDelete(key);
      }
    });
    deleteButton.addEventListener('mouseover', () => {
      deleteButton.style.backgroundColor = '#f8d7da';
    });
    deleteButton.addEventListener('mouseout', () => {
      deleteButton.style.backgroundColor = 'transparent';
    });
    cardHeader.appendChild(deleteButton);

    // Expandable content (JSON display)
    const expandableContent = document.createElement('div');
    expandableContent.style.cssText = 'display: none; padding: 15px; background-color: #f8f9fa; border-top: 1px solid #e0e0e0;';

    const jsonContainer = document.createElement('pre');
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
    jsonContainer.textContent = JSON.stringify(accountData, null, 2);
    expandableContent.appendChild(jsonContainer);

    card.appendChild(cardHeader);
    card.appendChild(expandableContent);

    // Toggle functionality
    let isExpanded = false;
    const toggleCard = () => {
      isExpanded = !isExpanded;
      expandableContent.style.display = isExpanded ? 'block' : 'none';
      expandIcon.style.transform = isExpanded ? 'rotate(0deg)' : 'rotate(270deg)';
    };

    cardHeader.addEventListener('click', (e) => {
      // Don't toggle if delete button was clicked
      if (e.target === deleteButton) return;
      toggleCard();
    });

    // Hover effects
    cardHeader.addEventListener('mouseover', () => {
      cardHeader.style.backgroundColor = '#f8f9fa';
    });
    cardHeader.addEventListener('mouseout', () => {
      cardHeader.style.backgroundColor = '#fff';
    });

    container.appendChild(card);
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
function renderCategoryMappingsSectionIfEnabled(integrationId, onRefresh) {
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
function renderCategoryMappingsSection(integrationId, storageKey, sourceColumnLabel, onRefresh) {
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
    background-color: #fff;
    border: 1px solid #e0e0e0;
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
  headerTitle.style.cssText = 'margin: 0; font-size: 14px; color: #333;';
  headerLeft.appendChild(headerTitle);

  const mappingCount = document.createElement('span');
  mappingCount.style.cssText = 'font-size: 12px; color: #666;';
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
    border: 1px solid #e0e0e0;
    border-top: none;
    border-radius: 0 0 6px 6px;
    background-color: #fff;
  `;

  if (categoryData.length === 0) {
    const emptyMessage = document.createElement('p');
    emptyMessage.textContent = 'No category mappings found. Mappings will appear here after you categorize transactions.';
    emptyMessage.style.cssText = 'color: #666; font-style: italic; margin: 0; font-size: 13px;';
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
    sourceFilterLabel.style.cssText = 'display: block; font-size: 12px; color: #666; margin-bottom: 4px; font-weight: 500;';
    sourceFilterWrapper.appendChild(sourceFilterLabel);

    const sourceFilterInput = document.createElement('input');
    sourceFilterInput.id = `category-mappings-source-filter-${integrationId}`;
    sourceFilterInput.type = 'text';
    sourceFilterInput.placeholder = `Filter by ${sourceColumnLabel.toLowerCase()}...`;
    sourceFilterInput.style.cssText = `
      width: 100%;
      padding: 8px 12px;
      border: 1px solid #ccc;
      border-radius: 4px;
      font-size: 13px;
      box-sizing: border-box;
    `;
    sourceFilterWrapper.appendChild(sourceFilterInput);
    filterContainer.appendChild(sourceFilterWrapper);

    // Category filter (dropdown with search)
    const categoryFilterWrapper = document.createElement('div');
    categoryFilterWrapper.style.cssText = 'flex: 1; min-width: 200px; position: relative;';

    const categoryFilterLabel = document.createElement('label');
    categoryFilterLabel.textContent = 'Monarch Category';
    categoryFilterLabel.style.cssText = 'display: block; font-size: 12px; color: #666; margin-bottom: 4px; font-weight: 500;';
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
      border: 1px solid #ccc;
      border-radius: 4px;
      font-size: 13px;
      box-sizing: border-box;
      cursor: pointer;
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
      color: #666;
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
      background: white;
      border: 1px solid #ccc;
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
      color: #666;
      transition: background-color 0.1s;
    `;
    allOption.addEventListener('mouseover', () => {
      allOption.style.backgroundColor = '#f0f0f0';
    });
    allOption.addEventListener('mouseout', () => {
      allOption.style.backgroundColor = 'white';
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
        option.style.backgroundColor = '#f0f0f0';
      });
      option.addEventListener('mouseout', () => {
        option.style.backgroundColor = 'white';
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
      border: 1px solid #ccc;
      border-radius: 4px;
      background: white;
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
      clearFiltersBtn.style.backgroundColor = '#f8f9fa';
    });
    clearFiltersBtn.addEventListener('mouseout', () => {
      clearFiltersBtn.style.backgroundColor = 'white';
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
        background-color: #f8f9fa;
        padding: 10px;
        text-align: left;
        border: 1px solid #e0e0e0;
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
      sourceCell.style.cssText = 'padding: 10px; border: 1px solid #e0e0e0;';
      row.appendChild(sourceCell);

      // Monarch category cell
      const categoryCell = document.createElement('td');
      categoryCell.textContent = item.monarchCategory;
      categoryCell.style.cssText = 'padding: 10px; border: 1px solid #e0e0e0;';
      row.appendChild(categoryCell);

      // Actions cell
      const actionsCell = document.createElement('td');
      actionsCell.style.cssText = 'padding: 10px; border: 1px solid #e0e0e0;';

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
    resultsCount.style.cssText = 'margin-top: 8px; font-size: 12px; color: #666;';
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
    sectionHeader.style.backgroundColor = '#f8f9fa';
  });
  sectionHeader.addEventListener('mouseout', () => {
    sectionHeader.style.backgroundColor = '#fff';
  });

  return sectionContainer;
}

/**
 * Creates a data table
 * @deprecated Will be removed in Phase 7 cleanup - replaced by renderCategoryMappingsSection
 * @param {Array} headers - Table headers
 * @param {Array} data - Table data
 * @param {Function} onDelete - Delete handler
 * @param {boolean} isJsonValue - Whether to parse value as JSON
 * @returns {HTMLElement} Table element
 */
// eslint-disable-next-line no-unused-vars
function createDataTable(headers, data, onDelete, isJsonValue = false) {
  if (data.length === 0) {
    const emptyMessage = document.createElement('p');
    emptyMessage.textContent = 'No data found.';
    emptyMessage.style.cssText = 'color: #666; font-style: italic; margin: 10px 0;';
    return emptyMessage;
  }

  const table = document.createElement('table');
  table.style.cssText = `
    width: 100%;
    border-collapse: collapse;
    margin: 10px 0;
    font-size: 14px;
  `;

  // Create header
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');

  headers.forEach((header) => {
    const th = document.createElement('th');
    th.textContent = header;
    th.style.cssText = `
      background-color: #f8f9fa;
      padding: 10px;
      text-align: left;
      border: 1px solid #e0e0e0;
      font-weight: bold;
    `;
    headerRow.appendChild(th);
  });

  thead.appendChild(headerRow);
  table.appendChild(thead);

  // Create body
  const tbody = document.createElement('tbody');

  data.forEach(([key, displayKey, value]) => {
    const row = document.createElement('tr');

    // Display key cell
    const keyCell = document.createElement('td');
    keyCell.textContent = displayKey;
    keyCell.style.cssText = 'padding: 10px; border: 1px solid #e0e0e0;';
    row.appendChild(keyCell);

    // Value cell
    const valueCell = document.createElement('td');
    let displayValue = value;

    if (isJsonValue) {
      try {
        const jsonValue = JSON.parse(value);
        if (Array.isArray(jsonValue)) {
          displayValue = `${jsonValue.length} references`;
        } else {
          displayValue = JSON.stringify(jsonValue, null, 2);
        }
      } catch (error) {
        displayValue = value;
      }
    }

    valueCell.textContent = displayValue;
    valueCell.style.cssText = `
      padding: 10px;
      border: 1px solid #e0e0e0;
      max-width: 300px;
      word-wrap: break-word;
    `;
    row.appendChild(valueCell);

    // Actions cell
    const actionsCell = document.createElement('td');
    actionsCell.style.cssText = 'padding: 10px; border: 1px solid #e0e0e0;';

    const deleteButton = document.createElement('button');
    deleteButton.textContent = 'Delete';
    deleteButton.style.cssText = `
      background-color: #dc3545;
      color: white;
      border: none;
      border-radius: 4px;
      padding: 5px 10px;
      cursor: pointer;
      font-size: 12px;
    `;

    deleteButton.addEventListener('click', async () => {
      const confirmed = await showConfirmDialog(`Are you sure you want to delete this entry?\n\nKey: ${displayKey}\nValue: ${displayValue}`);
      if (confirmed) {
        onDelete(key);
      }
    });

    deleteButton.addEventListener('mouseover', () => {
      deleteButton.style.backgroundColor = '#c82333';
    });

    deleteButton.addEventListener('mouseout', () => {
      deleteButton.style.backgroundColor = '#dc3545';
    });

    actionsCell.appendChild(deleteButton);
    row.appendChild(actionsCell);

    tbody.appendChild(row);
  });

  table.appendChild(tbody);
  return table;
}

/**
 * Creates an enhanced table for managing individual transaction references
 * @deprecated Will be removed in Phase 7 cleanup - use renderTransactionsManagementSection instead
 * @returns {HTMLElement} Transaction management table element
 */
// eslint-disable-next-line no-unused-vars
function createTransactionsManagementTable() {
  const container = document.createElement('div');
  container.style.cssText = 'margin: 10px 0;';

  // Get all Rogers Bank uploaded reference data
  const allKeys = GM_listValues();
  const transactionAccounts = [];

  allKeys.forEach((key) => {
    if (key.startsWith(STORAGE.ROGERSBANK_UPLOADED_REFS_PREFIX)) {
      const accountId = key.replace(STORAGE.ROGERSBANK_UPLOADED_REFS_PREFIX, '');
      const refs = GM_getValue(key, []);

      try {
        const parsedRefs = Array.isArray(refs) ? refs : JSON.parse(refs);
        if (parsedRefs.length > 0) {
          transactionAccounts.push({
            key,
            accountId,
            references: parsedRefs,
          });
        }
      } catch (error) {
        debugLog('Error parsing transaction references:', error);
      }
    }
  });

  if (transactionAccounts.length === 0) {
    const emptyMessage = document.createElement('p');
    emptyMessage.textContent = 'No uploaded transaction references found.';
    emptyMessage.style.cssText = 'color: #666; font-style: italic; margin: 10px 0;';
    return emptyMessage;
  }

  // Create accordion-style display for each account
  transactionAccounts.forEach((account) => {
    const accountSection = document.createElement('div');
    accountSection.style.cssText = `
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      margin-bottom: 15px;
      overflow: hidden;
    `;

    // Account header with expand/collapse functionality
    const accountHeader = document.createElement('div');
    accountHeader.style.cssText = `
      background-color: #f8f9fa;
      padding: 12px 15px;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid #e0e0e0;
      transition: background-color 0.2s;
    `;

    const accountInfo = document.createElement('div');
    accountInfo.innerHTML = `
      <strong>${account.accountId}</strong>
      <span style="color: #666; margin-left: 10px;">${account.references.length} transaction references</span>
    `;

    const expandIcon = document.createElement('span');
    expandIcon.textContent = '▼';
    expandIcon.style.cssText = 'transition: transform 0.2s; font-size: 12px;';

    accountHeader.appendChild(accountInfo);
    accountHeader.appendChild(expandIcon);

    // Account content (initially hidden)
    const accountContent = document.createElement('div');
    accountContent.style.cssText = 'display: none; padding: 15px;';

    // Bulk actions for this account
    const bulkActions = document.createElement('div');
    bulkActions.style.cssText = 'margin-bottom: 15px; display: flex; gap: 10px; align-items: center;';

    // Add button (leftmost)
    const addBtn = document.createElement('button');
    addBtn.textContent = 'Add';
    addBtn.style.cssText = `
      padding: 5px 10px;
      border: 1px solid #28a745;
      border-radius: 4px;
      background: white;
      color: #28a745;
      cursor: pointer;
      font-size: 12px;
    `;

    const selectAllBtn = document.createElement('button');
    selectAllBtn.textContent = 'Select All';
    selectAllBtn.style.cssText = `
      padding: 5px 10px;
      border: 1px solid #ccc;
      border-radius: 4px;
      background: white;
      cursor: pointer;
      font-size: 12px;
    `;

    const selectNoneBtn = document.createElement('button');
    selectNoneBtn.textContent = 'Select None';
    selectNoneBtn.style.cssText = `
      padding: 5px 10px;
      border: 1px solid #ccc;
      border-radius: 4px;
      background: white;
      cursor: pointer;
      font-size: 12px;
    `;

    const deleteSelectedBtn = document.createElement('button');
    deleteSelectedBtn.textContent = 'Delete Selected';
    deleteSelectedBtn.style.cssText = `
      padding: 5px 10px;
      border: none;
      border-radius: 4px;
      background: #dc3545;
      color: white;
      cursor: pointer;
      font-size: 12px;
    `;

    const deleteAllBtn = document.createElement('button');
    deleteAllBtn.textContent = 'Delete All';
    deleteAllBtn.style.cssText = `
      padding: 5px 10px;
      border: none;
      border-radius: 4px;
      background: #dc3545;
      color: white;
      cursor: pointer;
      font-size: 12px;
      margin-left: auto;
    `;

    bulkActions.appendChild(addBtn);
    bulkActions.appendChild(selectAllBtn);
    bulkActions.appendChild(selectNoneBtn);
    bulkActions.appendChild(deleteSelectedBtn);
    bulkActions.appendChild(deleteAllBtn);

    // Transaction references list
    const transactionsList = document.createElement('div');
    transactionsList.style.cssText = `
      max-height: 300px;
      overflow-y: auto;
      border: 1px solid #e0e0e0;
      border-radius: 4px;
    `;

    // Create checkboxes for each transaction reference
    account.references.forEach((ref, refIndex) => {
      const refRow = document.createElement('div');
      refRow.style.cssText = `
        display: flex;
        align-items: center;
        padding: 8px 10px;
        border-bottom: 1px solid #f0f0f0;
        background: ${refIndex % 2 === 0 ? '#fff' : '#fafafa'};
      `;

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.style.cssText = 'margin-right: 10px;';
      checkbox.dataset.accountKey = account.key;
      checkbox.dataset.refIndex = refIndex;
      // Store the ref value as string for data attribute (handles both string and object refs)
      checkbox.dataset.refValue = typeof ref === 'object' ? JSON.stringify(ref) : ref;

      // Create formatted display for transaction reference
      const refDisplay = document.createElement('div');
      refDisplay.style.cssText = 'display: flex; align-items: center; gap: 8px;';

      // Check if ref is an object with id and date
      if (typeof ref === 'object' && ref !== null && ref.id) {
        // Date badge
        if (ref.date) {
          const dateBadge = document.createElement('span');
          dateBadge.textContent = ref.date;
          dateBadge.style.cssText = `
            background-color: #e3f2fd;
            color: #1565c0;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 500;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          `;
          refDisplay.appendChild(dateBadge);
        }

        // Transaction ID
        const idText = document.createElement('span');
        idText.textContent = ref.id;
        idText.style.cssText = 'font-family: monospace; font-size: 13px; color: #333;';
        refDisplay.appendChild(idText);
      } else {
        // Fallback for string references (legacy format)
        const refText = document.createElement('span');
        refText.textContent = typeof ref === 'object' ? JSON.stringify(ref) : ref;
        refText.style.cssText = 'font-family: monospace; font-size: 13px;';
        refDisplay.appendChild(refText);
      }

      refRow.appendChild(checkbox);
      refRow.appendChild(refDisplay);
      transactionsList.appendChild(refRow);
    });

    // Inline input area for adding transaction IDs (initially hidden)
    const addInputArea = document.createElement('div');
    addInputArea.style.cssText = `
      display: none;
      margin-bottom: 15px;
      padding: 12px;
      background-color: #f8f9fa;
      border: 1px solid #e0e0e0;
      border-radius: 4px;
    `;

    const inputLabel = document.createElement('label');
    inputLabel.textContent = 'Add Transaction IDs:';
    inputLabel.style.cssText = 'display: block; margin-bottom: 8px; font-weight: bold; font-size: 13px;';
    addInputArea.appendChild(inputLabel);

    const textarea = document.createElement('textarea');
    textarea.placeholder = 'Enter transaction IDs (one per line or comma-separated)';
    textarea.style.cssText = `
      width: 100%;
      min-height: 80px;
      padding: 8px;
      border: 1px solid #ccc;
      border-radius: 4px;
      font-family: monospace;
      font-size: 13px;
      resize: vertical;
      box-sizing: border-box;
    `;
    addInputArea.appendChild(textarea);

    const inputButtonContainer = document.createElement('div');
    inputButtonContainer.style.cssText = 'margin-top: 10px; display: flex; gap: 8px;';

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.style.cssText = `
      padding: 6px 12px;
      border: none;
      border-radius: 4px;
      background: #28a745;
      color: white;
      cursor: pointer;
      font-size: 12px;
    `;

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = `
      padding: 6px 12px;
      border: 1px solid #ccc;
      border-radius: 4px;
      background: white;
      color: #333;
      cursor: pointer;
      font-size: 12px;
    `;

    inputButtonContainer.appendChild(saveBtn);
    inputButtonContainer.appendChild(cancelBtn);
    addInputArea.appendChild(inputButtonContainer);

    accountContent.appendChild(bulkActions);
    accountContent.appendChild(addInputArea);
    accountContent.appendChild(transactionsList);

    // Toggle functionality
    let isExpanded = false;
    accountHeader.addEventListener('click', () => {
      isExpanded = !isExpanded;
      accountContent.style.display = isExpanded ? 'block' : 'none';
      expandIcon.style.transform = isExpanded ? 'rotate(180deg)' : 'rotate(0deg)';
    });

    accountHeader.addEventListener('mouseover', () => {
      accountHeader.style.backgroundColor = '#e9ecef';
    });

    accountHeader.addEventListener('mouseout', () => {
      accountHeader.style.backgroundColor = '#f8f9fa';
    });

    // Add button event listener
    let isAddingMode = false;
    addBtn.addEventListener('click', () => {
      isAddingMode = !isAddingMode;
      addInputArea.style.display = isAddingMode ? 'block' : 'none';
      addBtn.textContent = isAddingMode ? 'Cancel' : 'Add';
      addBtn.style.borderColor = isAddingMode ? '#dc3545' : '#28a745';
      addBtn.style.color = isAddingMode ? '#dc3545' : '#28a745';

      if (!isAddingMode) {
        textarea.value = '';
      }
    });

    // Save button event listener
    saveBtn.addEventListener('click', () => {
      const inputValue = textarea.value.trim();
      if (!inputValue) {
        toast.show('Please enter at least one transaction ID', 'warning');
        return;
      }

      // Parse input - handle comma-separated, space-separated, and newline-separated
      const newIds = inputValue
        .split(/[\n,]/)
        .map((id) => id.trim())
        .filter((id) => id.length > 0);

      if (newIds.length === 0) {
        toast.show('No valid transaction IDs found', 'warning');
        return;
      }

      // Check for duplicates
      const existingRefs = account.references;
      const duplicates = [];
      const uniqueNewIds = [];

      newIds.forEach((id) => {
        if (existingRefs.includes(id)) {
          duplicates.push(id);
        } else if (!uniqueNewIds.includes(id)) {
          uniqueNewIds.push(id);
        }
      });

      if (uniqueNewIds.length === 0) {
        toast.show('All transaction IDs already exist', 'warning');
        return;
      }

      // Update storage
      try {
        const updatedRefs = [...existingRefs, ...uniqueNewIds];
        GM_setValue(account.key, updatedRefs);

        // Show success message
        let message = `Added ${uniqueNewIds.length} transaction ID(s)`;
        if (duplicates.length > 0) {
          message += ` (${duplicates.length} duplicate(s) skipped)`;
        }
        toast.show(message, 'info');
        debugLog(`Added ${uniqueNewIds.length} transaction IDs to ${account.accountId}`);

        // Reset the input area
        textarea.value = '';
        isAddingMode = false;
        addInputArea.style.display = 'none';
        addBtn.textContent = 'Add';
        addBtn.style.borderColor = '#28a745';
        addBtn.style.color = '#28a745';

        // Refresh the Rogers Bank tab to show updated list
        const tabContainer = document.querySelector('.settings-tab-content');
        if (tabContainer) {
          renderTabContent(tabContainer, 'rogersbank');
        }
      } catch (error) {
        debugLog('Error adding transaction IDs:', error);
        toast.show('Error adding transaction IDs', 'error');
      }
    });

    // Cancel button event listener
    cancelBtn.addEventListener('click', () => {
      textarea.value = '';
      isAddingMode = false;
      addInputArea.style.display = 'none';
      addBtn.textContent = 'Add';
      addBtn.style.borderColor = '#28a745';
      addBtn.style.color = '#28a745';
    });

    // Bulk action event listeners
    selectAllBtn.addEventListener('click', () => {
      const checkboxes = accountContent.querySelectorAll('input[type="checkbox"]');
      checkboxes.forEach((cb) => {
        cb.checked = true;
      });
    });

    selectNoneBtn.addEventListener('click', () => {
      const checkboxes = accountContent.querySelectorAll('input[type="checkbox"]');
      checkboxes.forEach((cb) => {
        cb.checked = false;
      });
    });

    deleteSelectedBtn.addEventListener('click', async () => {
      const selectedCheckboxes = Array.from(accountContent.querySelectorAll('input[type="checkbox"]:checked'));
      if (selectedCheckboxes.length === 0) {
        toast.show('No transactions selected', 'warning');
        return;
      }

      const confirmed = await showConfirmDialog(
        `Are you sure you want to delete ${selectedCheckboxes.length} selected transaction reference(s) from ${account.accountId}?`,
      );

      if (confirmed) {
        deleteSelectedTransactionRefs(selectedCheckboxes);
      }
    });

    deleteAllBtn.addEventListener('click', async () => {
      const confirmed = await showConfirmDialog(
        `Are you sure you want to delete ALL ${account.references.length} transaction references for ${account.accountId}?\n\nThis will allow all transactions to be re-uploaded.`,
      );

      if (confirmed) {
        GM_deleteValue(account.key);
        toast.show(`All transaction references cleared for ${account.accountId}`, 'info');
        // Refresh the Rogers Bank tab
        const tabContainer = document.querySelector('.settings-tab-content');
        if (tabContainer) {
          renderTabContent(tabContainer, 'rogersbank');
        }
      }
    });

    accountSection.appendChild(accountHeader);
    accountSection.appendChild(accountContent);
    container.appendChild(accountSection);
  });

  return container;
}

/**
 * Deletes selected transaction references
 * @deprecated Will be removed in Phase 7 cleanup
 * @param {Array<HTMLInputElement>} selectedCheckboxes - Array of selected checkboxes
 */
function deleteSelectedTransactionRefs(selectedCheckboxes) {
  // Group by account key
  const refsByAccount = {};

  selectedCheckboxes.forEach((checkbox) => {
    const { accountKey, refIndex, refValue } = checkbox.dataset;
    const parsedRefIndex = parseInt(refIndex, 10);

    if (!refsByAccount[accountKey]) {
      refsByAccount[accountKey] = [];
    }

    refsByAccount[accountKey].push({ index: parsedRefIndex, value: refValue });
  });

  // Process each account
  Object.entries(refsByAccount).forEach(([accountKey, refsToDelete]) => {
    try {
      const currentRefs = GM_getValue(accountKey, []);
      const parsedRefs = Array.isArray(currentRefs) ? currentRefs : JSON.parse(currentRefs);

      // Remove selected references (sort indices in descending order to avoid index shifting)
      const indicesToRemove = refsToDelete.map((ref) => ref.index).sort((a, b) => b - a);

      indicesToRemove.forEach((index) => {
        if (index >= 0 && index < parsedRefs.length) {
          parsedRefs.splice(index, 1);
        }
      });

      // Update storage
      GM_setValue(accountKey, parsedRefs);

      const accountId = accountKey.replace(STORAGE.ROGERSBANK_UPLOADED_REFS_PREFIX, '');
      debugLog(`Deleted ${refsToDelete.length} transaction references from ${accountId}`);
    } catch (error) {
      debugLog('Error deleting transaction references:', error);
      toast.show('Error deleting some transaction references', 'error');
    }
  });

  toast.show(`Deleted ${selectedCheckboxes.length} transaction reference(s)`, 'info');

  // Refresh the Rogers Bank tab
  const tabContainer = document.querySelector('.settings-tab-content');
  if (tabContainer) {
    renderTabContent(tabContainer, 'rogersbank');
  }
}

/**
 * Renders the account settings section based on integration capabilities
 * @param {string} integrationId - Integration identifier
 * @param {Object} accountEntry - Consolidated account data object
 * @param {string} accountId - Account ID for updates
 * @param {Function} onUpdate - Callback when settings are updated
 * @returns {HTMLElement} Settings section element
 */
function renderAccountSettingsSection(integrationId, accountEntry, accountId, onUpdate) {
  const settingsSection = document.createElement('div');
  settingsSection.id = `account-settings-section-${accountId}`;
  settingsSection.style.cssText = 'margin-bottom: 15px;';

  const settingsTitle = document.createElement('h4');
  settingsTitle.textContent = 'Account Settings';
  settingsTitle.style.cssText = 'margin: 0 0 10px 0; font-size: 14px; color: #333;';
  settingsSection.appendChild(settingsTitle);

  const capabilities = getCapabilities(integrationId);
  if (!capabilities || capabilities.settings.length === 0) {
    const noSettingsMsg = document.createElement('div');
    noSettingsMsg.style.cssText = 'font-size: 13px; color: #666; font-style: italic;';
    noSettingsMsg.textContent = 'No configurable settings for this integration.';
    settingsSection.appendChild(noSettingsMsg);
    return settingsSection;
  }

  // Store transaction details in notes toggle
  if (hasSetting(integrationId, ACCOUNT_SETTINGS.STORE_TX_DETAILS_IN_NOTES)) {
    const transactionDetailsSetting = document.createElement('div');
    transactionDetailsSetting.id = `setting-tx-details-${accountId}`;
    transactionDetailsSetting.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: white; border-radius: 6px; margin-bottom: 8px;';

    const transactionDetailsLabel = document.createElement('div');
    transactionDetailsLabel.innerHTML = `
      <div style="font-weight: 500; font-size: 13px;">Store transaction details in notes</div>
      <div style="font-size: 11px; color: #666;">When enabled, transaction details will be included in the Notes field</div>
    `;

    const currentValue = accountEntry.storeTransactionDetailsInNotes ?? getSettingDefault(integrationId, ACCOUNT_SETTINGS.STORE_TX_DETAILS_IN_NOTES);
    const transactionDetailsToggle = createToggleSwitch(
      currentValue,
      (isEnabled) => {
        const success = accountService.updateAccountInList(integrationId, accountId, { storeTransactionDetailsInNotes: isEnabled });
        if (success) {
          toast.show(`Transaction details in notes ${isEnabled ? 'enabled' : 'disabled'}`, 'info');
          if (onUpdate) onUpdate();
        } else {
          toast.show('Failed to update setting', 'error');
        }
      },
      false,
    );

    transactionDetailsSetting.appendChild(transactionDetailsLabel);
    transactionDetailsSetting.appendChild(transactionDetailsToggle);
    transactionDetailsSetting.addEventListener('click', (e) => e.stopPropagation());
    settingsSection.appendChild(transactionDetailsSetting);
  }

  // Strip store numbers toggle (Wealthsimple only)
  if (hasSetting(integrationId, ACCOUNT_SETTINGS.STRIP_STORE_NUMBERS)) {
    const stripStoreNumbersSetting = document.createElement('div');
    stripStoreNumbersSetting.id = `setting-strip-store-${accountId}`;
    stripStoreNumbersSetting.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: white; border-radius: 6px; margin-bottom: 8px;';

    const stripStoreNumbersLabel = document.createElement('div');
    stripStoreNumbersLabel.innerHTML = `
      <div style="font-weight: 500; font-size: 13px;">Strip store numbers from merchants</div>
      <div style="font-size: 11px; color: #666;">Remove store numbers from merchant names (e.g., "WALMART #1234" → "WALMART")</div>
    `;

    const currentValue = accountEntry.stripStoreNumbers ?? getSettingDefault(integrationId, ACCOUNT_SETTINGS.STRIP_STORE_NUMBERS);
    const stripStoreNumbersToggle = createToggleSwitch(
      currentValue,
      (isEnabled) => {
        const success = accountService.updateAccountInList(integrationId, accountId, { stripStoreNumbers: isEnabled });
        if (success) {
          toast.show(`Store number stripping ${isEnabled ? 'enabled' : 'disabled'}`, 'info');
          if (onUpdate) onUpdate();
        } else {
          toast.show('Failed to update setting', 'error');
        }
      },
      false,
    );

    stripStoreNumbersSetting.appendChild(stripStoreNumbersLabel);
    stripStoreNumbersSetting.appendChild(stripStoreNumbersToggle);
    stripStoreNumbersSetting.addEventListener('click', (e) => e.stopPropagation());
    settingsSection.appendChild(stripStoreNumbersSetting);
  }

  // Include pending transactions toggle (Wealthsimple only)
  if (hasSetting(integrationId, ACCOUNT_SETTINGS.INCLUDE_PENDING_TRANSACTIONS)) {
    const includePendingSetting = document.createElement('div');
    includePendingSetting.id = `setting-pending-${accountId}`;
    includePendingSetting.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: white; border-radius: 6px; margin-bottom: 8px;';

    const includePendingLabel = document.createElement('div');
    includePendingLabel.innerHTML = `
      <div style="font-weight: 500; font-size: 13px;">Include pending transactions</div>
      <div style="font-size: 11px; color: #666;">When enabled, authorized (pending) transactions are included with a "Pending" tag</div>
    `;

    const currentValue = accountEntry.includePendingTransactions ?? getSettingDefault(integrationId, ACCOUNT_SETTINGS.INCLUDE_PENDING_TRANSACTIONS);
    const includePendingToggle = createToggleSwitch(
      currentValue,
      (isEnabled) => {
        const success = accountService.updateAccountInList(integrationId, accountId, { includePendingTransactions: isEnabled });
        if (success) {
          toast.show(`Pending transactions ${isEnabled ? 'enabled' : 'disabled'}`, 'info');
          if (onUpdate) onUpdate();
        } else {
          toast.show('Failed to update setting', 'error');
        }
      },
      false,
    );

    includePendingSetting.appendChild(includePendingLabel);
    includePendingSetting.appendChild(includePendingToggle);
    includePendingSetting.addEventListener('click', (e) => e.stopPropagation());
    settingsSection.appendChild(includePendingSetting);
  }

  // Transaction retention days (for deduplication-enabled integrations)
  if (hasSetting(integrationId, ACCOUNT_SETTINGS.TRANSACTION_RETENTION_DAYS)) {
    const retentionDaysSetting = document.createElement('div');
    retentionDaysSetting.id = `setting-retention-days-${accountId}`;
    retentionDaysSetting.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: white; border-radius: 6px; margin-bottom: 8px;';

    const retentionDaysLabel = document.createElement('div');
    retentionDaysLabel.innerHTML = `
      <div style="font-weight: 500; font-size: 13px;">Transaction retention days</div>
      <div style="font-size: 11px; color: #666;">Number of days to keep transaction IDs for deduplication (0 = unlimited)</div>
    `;

    const retentionDaysInputContainer = document.createElement('div');
    retentionDaysInputContainer.style.cssText = 'display: flex; align-items: center; gap: 4px;';

    const defaultRetentionDays = getSettingDefault(integrationId, ACCOUNT_SETTINGS.TRANSACTION_RETENTION_DAYS);
    const retentionDaysInput = document.createElement('input');
    retentionDaysInput.type = 'number';
    retentionDaysInput.min = '0';
    retentionDaysInput.max = '3650';
    retentionDaysInput.value = accountEntry.transactionRetentionDays ?? defaultRetentionDays;
    retentionDaysInput.style.cssText = 'width: 70px; padding: 4px 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 13px;';

    retentionDaysInput.addEventListener('change', () => {
      const value = parseInt(retentionDaysInput.value, 10);
      const previousValue = accountEntry.transactionRetentionDays ?? defaultRetentionDays;
      if (Number.isNaN(value) || value < 0) {
        retentionDaysInput.value = previousValue;
        toast.show('Please enter a valid number (0 or greater)', 'error');
        return;
      }

      // Validate retention vs lookback
      const currentLookback = getLookbackForInstitution(integrationId);
      const validation = validateLookbackVsRetention(currentLookback, value);
      if (!validation.valid) {
        retentionDaysInput.value = previousValue;
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
    daysLabel.style.cssText = 'font-size: 12px; color: #666;';

    retentionDaysInputContainer.appendChild(retentionDaysInput);
    retentionDaysInputContainer.appendChild(daysLabel);

    retentionDaysSetting.appendChild(retentionDaysLabel);
    retentionDaysSetting.appendChild(retentionDaysInputContainer);
    retentionDaysSetting.addEventListener('click', (e) => e.stopPropagation());
    settingsSection.appendChild(retentionDaysSetting);
  }

  // Invert balance toggle (Rogers Bank only)
  if (hasSetting(integrationId, ACCOUNT_SETTINGS.INVERT_BALANCE)) {
    const invertBalanceSetting = document.createElement('div');
    invertBalanceSetting.id = `setting-invert-balance-${accountId}`;
    invertBalanceSetting.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: white; border-radius: 6px; margin-bottom: 8px;';

    const invertBalanceLabel = document.createElement('div');
    invertBalanceLabel.innerHTML = `
      <div style="font-weight: 500; font-size: 13px;">Invert balance values</div>
      <div style="font-size: 11px; color: #666;">Negate balance values before uploading. Enable for manually created accounts where the bank reports negative balances.</div>
    `;

    const currentValue = accountEntry.invertBalance ?? getSettingDefault(integrationId, ACCOUNT_SETTINGS.INVERT_BALANCE);
    const invertBalanceToggle = createToggleSwitch(
      currentValue,
      (isEnabled) => {
        const success = accountService.updateAccountInList(integrationId, accountId, { invertBalance: isEnabled });
        if (success) {
          toast.show(`Balance inversion ${isEnabled ? 'enabled' : 'disabled'}`, 'info');
          if (onUpdate) onUpdate();
        } else {
          toast.show('Failed to update setting', 'error');
        }
      },
      false,
    );

    invertBalanceSetting.appendChild(invertBalanceLabel);
    invertBalanceSetting.appendChild(invertBalanceToggle);
    invertBalanceSetting.addEventListener('click', (e) => e.stopPropagation());
    settingsSection.appendChild(invertBalanceSetting);
  }

  // Transaction retention count (for deduplication-enabled integrations)
  if (hasSetting(integrationId, ACCOUNT_SETTINGS.TRANSACTION_RETENTION_COUNT)) {
    const retentionCountSetting = document.createElement('div');
    retentionCountSetting.id = `setting-retention-count-${accountId}`;
    retentionCountSetting.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: white; border-radius: 6px; margin-bottom: 8px;';

    const retentionCountLabel = document.createElement('div');
    retentionCountLabel.innerHTML = `
      <div style="font-weight: 500; font-size: 13px;">Transaction retention count</div>
      <div style="font-size: 11px; color: #666;">Maximum number of transaction IDs to keep (0 = unlimited)</div>
    `;

    const retentionCountInputContainer = document.createElement('div');
    retentionCountInputContainer.style.cssText = 'display: flex; align-items: center; gap: 4px;';

    const defaultRetentionCount = getSettingDefault(integrationId, ACCOUNT_SETTINGS.TRANSACTION_RETENTION_COUNT);
    const retentionCountInput = document.createElement('input');
    retentionCountInput.type = 'number';
    retentionCountInput.min = '0';
    retentionCountInput.max = '100000';
    retentionCountInput.value = accountEntry.transactionRetentionCount ?? defaultRetentionCount;
    retentionCountInput.style.cssText = 'width: 70px; padding: 4px 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 13px;';

    retentionCountInput.addEventListener('change', () => {
      const value = parseInt(retentionCountInput.value, 10);
      if (Number.isNaN(value) || value < 0) {
        retentionCountInput.value = accountEntry.transactionRetentionCount ?? defaultRetentionCount;
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
    countLabel.style.cssText = 'font-size: 12px; color: #666;';

    retentionCountInputContainer.appendChild(retentionCountInput);
    retentionCountInputContainer.appendChild(countLabel);

    retentionCountSetting.appendChild(retentionCountLabel);
    retentionCountSetting.appendChild(retentionCountInputContainer);
    retentionCountSetting.addEventListener('click', (e) => e.stopPropagation());
    settingsSection.appendChild(retentionCountSetting);
  }

  return settingsSection;
}

/**
 * Renders the transactions management section for deduplication
 * This section shows uploaded transaction IDs with editing capabilities
 * @param {string} integrationId - Integration identifier
 * @param {Object} accountEntry - Consolidated account data object
 * @param {string} accountId - Account ID for updates
 * @param {Function} onRefresh - Callback to refresh after changes
 * @returns {HTMLElement} Transactions management section element
 */
function renderTransactionsManagementSection(integrationId, accountEntry, accountId, onRefresh) {
  const capabilities = getCapabilities(integrationId);

  // Only render for integrations with deduplication
  if (!capabilities || !capabilities.hasDeduplication) {
    return document.createElement('div'); // Return empty div
  }

  const sectionContainer = document.createElement('div');
  sectionContainer.id = `transactions-section-${integrationId}-${accountId}`;
  sectionContainer.style.cssText = 'margin-bottom: 15px;';

  // Get uploaded transactions from account (consolidated structure)
  const uploadedTransactions = accountEntry.uploadedTransactions || [];

  // Section header with expand/collapse
  const sectionHeader = document.createElement('div');
  sectionHeader.id = `transactions-header-${integrationId}-${accountId}`;
  sectionHeader.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    background-color: #fff;
    border: 1px solid #e0e0e0;
    border-radius: 6px;
    cursor: pointer;
    transition: background-color 0.2s;
  `;

  const headerLeft = document.createElement('div');
  headerLeft.style.cssText = 'display: flex; align-items: center; gap: 8px;';

  const expandIcon = document.createElement('span');
  expandIcon.id = `transactions-expand-icon-${integrationId}-${accountId}`;
  expandIcon.textContent = '▼';
  expandIcon.style.cssText = 'transition: transform 0.2s; font-size: 12px; transform: rotate(270deg);';
  headerLeft.appendChild(expandIcon);

  const headerTitle = document.createElement('h4');
  headerTitle.textContent = 'Uploaded Transactions';
  headerTitle.style.cssText = 'margin: 0; font-size: 14px; color: #333;';
  headerLeft.appendChild(headerTitle);

  const transactionCount = document.createElement('span');
  transactionCount.style.cssText = 'font-size: 12px; color: #666;';
  transactionCount.textContent = `(${uploadedTransactions.length} stored)`;
  headerLeft.appendChild(transactionCount);

  sectionHeader.appendChild(headerLeft);
  sectionContainer.appendChild(sectionHeader);

  // Expandable content
  const expandableContent = document.createElement('div');
  expandableContent.id = `transactions-content-${integrationId}-${accountId}`;
  expandableContent.style.cssText = `
    display: none;
    padding: 12px;
    border: 1px solid #e0e0e0;
    border-top: none;
    border-radius: 0 0 6px 6px;
    background-color: #fff;
  `;

  if (uploadedTransactions.length === 0) {
    const emptyMessage = document.createElement('p');
    emptyMessage.textContent = 'No uploaded transaction IDs stored. Transactions will appear here after syncing.';
    emptyMessage.style.cssText = 'color: #666; font-style: italic; margin: 0; font-size: 13px;';
    expandableContent.appendChild(emptyMessage);
  } else {
    // Bulk actions
    const bulkActions = document.createElement('div');
    bulkActions.id = `transactions-bulk-actions-${integrationId}-${accountId}`;
    bulkActions.style.cssText = 'margin-bottom: 12px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap;';

    // Add button
    const addBtn = document.createElement('button');
    addBtn.id = `transactions-add-btn-${integrationId}-${accountId}`;
    addBtn.textContent = 'Add';
    addBtn.style.cssText = `
      padding: 5px 10px;
      border: 1px solid #28a745;
      border-radius: 4px;
      background: white;
      color: #28a745;
      cursor: pointer;
      font-size: 12px;
    `;

    const selectAllBtn = document.createElement('button');
    selectAllBtn.id = `transactions-select-all-btn-${integrationId}-${accountId}`;
    selectAllBtn.textContent = 'Select All';
    selectAllBtn.style.cssText = `
      padding: 5px 10px;
      border: 1px solid #ccc;
      border-radius: 4px;
      background: white;
      cursor: pointer;
      font-size: 12px;
    `;

    const selectNoneBtn = document.createElement('button');
    selectNoneBtn.id = `transactions-select-none-btn-${integrationId}-${accountId}`;
    selectNoneBtn.textContent = 'Select None';
    selectNoneBtn.style.cssText = `
      padding: 5px 10px;
      border: 1px solid #ccc;
      border-radius: 4px;
      background: white;
      cursor: pointer;
      font-size: 12px;
    `;

    const deleteSelectedBtn = document.createElement('button');
    deleteSelectedBtn.id = `transactions-delete-selected-btn-${integrationId}-${accountId}`;
    deleteSelectedBtn.textContent = 'Delete Selected';
    deleteSelectedBtn.style.cssText = `
      padding: 5px 10px;
      border: none;
      border-radius: 4px;
      background: #dc3545;
      color: white;
      cursor: pointer;
      font-size: 12px;
    `;

    const deleteAllBtn = document.createElement('button');
    deleteAllBtn.id = `transactions-delete-all-btn-${integrationId}-${accountId}`;
    deleteAllBtn.textContent = 'Delete All';
    deleteAllBtn.style.cssText = `
      padding: 5px 10px;
      border: none;
      border-radius: 4px;
      background: #dc3545;
      color: white;
      cursor: pointer;
      font-size: 12px;
      margin-left: auto;
    `;

    bulkActions.appendChild(addBtn);
    bulkActions.appendChild(selectAllBtn);
    bulkActions.appendChild(selectNoneBtn);
    bulkActions.appendChild(deleteSelectedBtn);
    bulkActions.appendChild(deleteAllBtn);
    expandableContent.appendChild(bulkActions);

    // Add input area (initially hidden)
    const addInputArea = document.createElement('div');
    addInputArea.id = `transactions-add-input-${integrationId}-${accountId}`;
    addInputArea.style.cssText = `
      display: none;
      margin-bottom: 12px;
      padding: 12px;
      background-color: #f8f9fa;
      border: 1px solid #e0e0e0;
      border-radius: 4px;
    `;

    const inputLabel = document.createElement('label');
    inputLabel.textContent = 'Add Transaction IDs:';
    inputLabel.style.cssText = 'display: block; margin-bottom: 8px; font-weight: bold; font-size: 13px;';
    addInputArea.appendChild(inputLabel);

    const textarea = document.createElement('textarea');
    textarea.id = `transactions-textarea-${integrationId}-${accountId}`;
    textarea.placeholder = 'Enter transaction IDs (one per line or comma-separated)';
    textarea.style.cssText = `
      width: 100%;
      min-height: 80px;
      padding: 8px;
      border: 1px solid #ccc;
      border-radius: 4px;
      font-family: monospace;
      font-size: 13px;
      resize: vertical;
      box-sizing: border-box;
    `;
    addInputArea.appendChild(textarea);

    const inputButtonContainer = document.createElement('div');
    inputButtonContainer.style.cssText = 'margin-top: 10px; display: flex; gap: 8px;';

    const saveBtn = document.createElement('button');
    saveBtn.id = `transactions-save-btn-${integrationId}-${accountId}`;
    saveBtn.textContent = 'Save';
    saveBtn.style.cssText = `
      padding: 6px 12px;
      border: none;
      border-radius: 4px;
      background: #28a745;
      color: white;
      cursor: pointer;
      font-size: 12px;
    `;

    const cancelInputBtn = document.createElement('button');
    cancelInputBtn.id = `transactions-cancel-input-btn-${integrationId}-${accountId}`;
    cancelInputBtn.textContent = 'Cancel';
    cancelInputBtn.style.cssText = `
      padding: 6px 12px;
      border: 1px solid #ccc;
      border-radius: 4px;
      background: white;
      color: #333;
      cursor: pointer;
      font-size: 12px;
    `;

    inputButtonContainer.appendChild(saveBtn);
    inputButtonContainer.appendChild(cancelInputBtn);
    addInputArea.appendChild(inputButtonContainer);
    expandableContent.appendChild(addInputArea);

    // Transaction list
    const transactionsList = document.createElement('div');
    transactionsList.id = `transactions-list-${integrationId}-${accountId}`;
    transactionsList.style.cssText = `
      max-height: 250px;
      overflow-y: auto;
      border: 1px solid #e0e0e0;
      border-radius: 4px;
    `;

    // Create checkboxes for each transaction
    uploadedTransactions.forEach((tx, txIndex) => {
      const txRow = document.createElement('div');
      txRow.id = `transaction-row-${integrationId}-${accountId}-${txIndex}`;
      txRow.style.cssText = `
        display: flex;
        align-items: center;
        padding: 8px 10px;
        border-bottom: 1px solid #f0f0f0;
        background: ${txIndex % 2 === 0 ? '#fff' : '#fafafa'};
      `;

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.style.cssText = 'margin-right: 10px;';
      checkbox.dataset.txIndex = txIndex;
      checkbox.dataset.txId = typeof tx === 'object' ? tx.id : tx;

      const txDisplay = document.createElement('div');
      txDisplay.style.cssText = 'display: flex; align-items: center; gap: 8px;';

      // Check if tx is an object with id and date
      if (typeof tx === 'object' && tx !== null && tx.id) {
        if (tx.date) {
          const dateBadge = document.createElement('span');
          dateBadge.textContent = tx.date;
          dateBadge.style.cssText = `
            background-color: #e3f2fd;
            color: #1565c0;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 500;
          `;
          txDisplay.appendChild(dateBadge);
        }

        const idText = document.createElement('span');
        idText.textContent = tx.id;
        idText.style.cssText = 'font-family: monospace; font-size: 13px; color: #333;';
        txDisplay.appendChild(idText);
      } else {
        const txText = document.createElement('span');
        txText.textContent = typeof tx === 'object' ? JSON.stringify(tx) : tx;
        txText.style.cssText = 'font-family: monospace; font-size: 13px;';
        txDisplay.appendChild(txText);
      }

      txRow.appendChild(checkbox);
      txRow.appendChild(txDisplay);
      transactionsList.appendChild(txRow);
    });

    expandableContent.appendChild(transactionsList);

    // Event handlers
    let isAddingMode = false;

    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      isAddingMode = !isAddingMode;
      addInputArea.style.display = isAddingMode ? 'block' : 'none';
      addBtn.textContent = isAddingMode ? 'Cancel' : 'Add';
      addBtn.style.borderColor = isAddingMode ? '#dc3545' : '#28a745';
      addBtn.style.color = isAddingMode ? '#dc3545' : '#28a745';
      if (!isAddingMode) textarea.value = '';
    });

    saveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const inputValue = textarea.value.trim();
      if (!inputValue) {
        toast.show('Please enter at least one transaction ID', 'warning');
        return;
      }

      const newIds = inputValue
        .split(/[\n,]/)
        .map((id) => id.trim())
        .filter((id) => id.length > 0);

      if (newIds.length === 0) {
        toast.show('No valid transaction IDs found', 'warning');
        return;
      }

      // Check for duplicates
      const existingIds = new Set(uploadedTransactions.map((tx) => (typeof tx === 'object' ? tx.id : tx)));
      const duplicates = [];
      const uniqueNewIds = [];

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

      // Add new transactions with today's date
      const today = new Date().toISOString().split('T')[0];
      const newTransactions = uniqueNewIds.map((id) => ({ id, date: today }));
      const updatedTransactions = [...uploadedTransactions, ...newTransactions];

      const success = accountService.updateAccountInList(integrationId, accountId, {
        uploadedTransactions: updatedTransactions,
      });

      if (success) {
        let message = `Added ${uniqueNewIds.length} transaction ID(s)`;
        if (duplicates.length > 0) {
          message += ` (${duplicates.length} duplicate(s) skipped)`;
        }
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

    cancelInputBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      textarea.value = '';
      isAddingMode = false;
      addInputArea.style.display = 'none';
      addBtn.textContent = 'Add';
      addBtn.style.borderColor = '#28a745';
      addBtn.style.color = '#28a745';
    });

    selectAllBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const checkboxes = transactionsList.querySelectorAll('input[type="checkbox"]');
      checkboxes.forEach((cb) => { cb.checked = true; });
    });

    selectNoneBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const checkboxes = transactionsList.querySelectorAll('input[type="checkbox"]');
      checkboxes.forEach((cb) => { cb.checked = false; });
    });

    deleteSelectedBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const selectedCheckboxes = Array.from(transactionsList.querySelectorAll('input[type="checkbox"]:checked'));
      if (selectedCheckboxes.length === 0) {
        toast.show('No transactions selected', 'warning');
        return;
      }

      const confirmed = await showConfirmDialog(
        `Are you sure you want to delete ${selectedCheckboxes.length} selected transaction reference(s)?`,
      );

      if (confirmed) {
        const indicesToRemove = selectedCheckboxes
          .map((cb) => parseInt(cb.dataset.txIndex, 10))
          .sort((a, b) => b - a); // Descending order

        const updatedTransactions = [...uploadedTransactions];
        indicesToRemove.forEach((idx) => {
          if (idx >= 0 && idx < updatedTransactions.length) {
            updatedTransactions.splice(idx, 1);
          }
        });

        const success = accountService.updateAccountInList(integrationId, accountId, {
          uploadedTransactions: updatedTransactions,
        });

        if (success) {
          toast.show(`Deleted ${selectedCheckboxes.length} transaction reference(s)`, 'info');
          if (onRefresh) setTimeout(onRefresh, 300);
        } else {
          toast.show('Error deleting transactions', 'error');
        }
      }
    });

    deleteAllBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const confirmed = await showConfirmDialog(
        `Are you sure you want to delete ALL ${uploadedTransactions.length} transaction references?\n\nThis will allow all transactions to be re-uploaded.`,
      );

      if (confirmed) {
        const success = accountService.updateAccountInList(integrationId, accountId, {
          uploadedTransactions: [],
        });

        if (success) {
          toast.show('All transaction references cleared', 'info');
          if (onRefresh) setTimeout(onRefresh, 300);
        } else {
          toast.show('Error clearing transactions', 'error');
        }
      }
    });
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
    sectionHeader.style.backgroundColor = '#f8f9fa';
  });
  sectionHeader.addEventListener('mouseout', () => {
    sectionHeader.style.backgroundColor = '#fff';
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
function renderDebugJsonSection(integrationId, accountEntry, accountId, onSave) {
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
    background-color: #fff;
    border: 1px solid #e0e0e0;
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
  headerTitle.style.cssText = 'margin: 0; font-size: 14px; color: #333;';
  headerLeft.appendChild(headerTitle);

  sectionHeader.appendChild(headerLeft);
  sectionContainer.appendChild(sectionHeader);

  // Expandable content
  const expandableContent = document.createElement('div');
  expandableContent.id = `debug-content-${integrationId}-${accountId}`;
  expandableContent.style.cssText = `
    display: none;
    padding: 12px;
    border: 1px solid #e0e0e0;
    border-top: none;
    border-radius: 0 0 6px 6px;
    background-color: #fff;
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
    background: white;
    color: #6c757d;
    cursor: pointer;
    font-size: 12px;
    display: flex;
    align-items: center;
    gap: 4px;
    transition: all 0.2s;
  `;
  editButton.addEventListener('mouseover', () => {
    editButton.style.backgroundColor = '#f8f9fa';
    editButton.style.borderColor = '#5a6268';
  });
  editButton.addEventListener('mouseout', () => {
    editButton.style.backgroundColor = 'white';
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
    background: white;
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
    cancelButton.style.backgroundColor = 'white';
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
    sectionHeader.style.backgroundColor = '#f8f9fa';
  });
  sectionHeader.addEventListener('mouseout', () => {
    sectionHeader.style.backgroundColor = '#fff';
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

/**
 * Creates generic account cards for any integration using the unified account service
 * @param {string} integrationId - Integration identifier from INTEGRATIONS enum
 * @param {Array} accounts - Array of consolidated account objects
 * @param {Function} onRefresh - Callback to refresh the tab after changes
 * @returns {HTMLElement} Container with account cards
 */
function createGenericAccountCards(integrationId, accounts, onRefresh) {
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
    const sourceAccount = accountEntry[accountKeyName] || {};
    const monarchAccount = accountEntry.monarchAccount;
    const syncEnabled = accountEntry.syncEnabled !== false; // Default to true
    const lastSyncDate = accountEntry.lastSyncDate;
    const accountId = sourceAccount.id || 'unknown';

    // Create card container
    const card = document.createElement('div');
    card.id = `${integrationId}-account-card-${accountId}`;
    card.style.cssText = `
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      margin-bottom: 15px;
      overflow: hidden;
      transition: all 0.2s;
    `;

    // Create card header
    const cardHeader = document.createElement('div');
    cardHeader.id = `${integrationId}-account-header-${accountId}`;
    cardHeader.style.cssText = `
      display: flex;
      align-items: center;
      padding: 15px;
      background-color: ${!syncEnabled ? '#fafafa' : '#fff'};
      cursor: pointer;
      transition: background-color 0.2s;
    `;

    // Expand/collapse icon
    const expandIcon = document.createElement('div');
    expandIcon.id = `${integrationId}-expand-icon-${accountId}`;
    expandIcon.style.cssText = `
      margin-right: 10px;
      font-size: 1.2em;
      color: ${!syncEnabled ? '#999' : '#666'};
      transition: transform 0.2s;
      cursor: pointer;
      flex-shrink: 0;
      transform: rotate(270deg);
    `;
    expandIcon.textContent = '▼';
    cardHeader.appendChild(expandIcon);

    // Logo
    const logoContainer = document.createElement('div');
    logoContainer.id = `${integrationId}-logo-${accountId}`;
    logoContainer.style.cssText = `margin-right: 15px; flex-shrink: 0; ${!syncEnabled ? 'opacity: 0.5;' : ''}`;
    if (faviconUrl) {
      try {
        GM_addElement(logoContainer, 'img', {
          src: faviconUrl,
          style: 'width: 40px; height: 40px; border-radius: 5px; object-fit: contain;',
        });
      } catch (error) {
        addAccountLogoFallback(logoContainer, getDisplayName(integrationId));
      }
    } else {
      addAccountLogoFallback(logoContainer, getDisplayName(integrationId));
    }
    cardHeader.appendChild(logoContainer);

    // Account info
    const infoContainer = document.createElement('div');
    infoContainer.id = `${integrationId}-info-${accountId}`;
    infoContainer.style.cssText = 'flex-grow: 1;';

    const nameDiv = document.createElement('div');
    nameDiv.id = `${integrationId}-name-${accountId}`;
    nameDiv.style.cssText = `font-weight: bold; font-size: 1.1em; margin-bottom: 2px; color: ${!syncEnabled ? '#999' : '#333'};`;
    nameDiv.textContent = sourceAccount.nickname || sourceAccount.name || 'Unknown Account';
    infoContainer.appendChild(nameDiv);

    // Account type
    if (sourceAccount.type) {
      const typeDiv = document.createElement('div');
      typeDiv.id = `${integrationId}-type-${accountId}`;
      typeDiv.style.cssText = 'font-size: 0.9em; color: #666; margin-bottom: 2px;';
      typeDiv.textContent = sourceAccount.type;
      infoContainer.appendChild(typeDiv);
    }

    // Mapping status
    const mappingDiv = document.createElement('div');
    mappingDiv.id = `${integrationId}-mapping-${accountId}`;
    mappingDiv.style.cssText = 'font-size: 0.8em; margin-top: 5px;';
    if (monarchAccount) {
      mappingDiv.innerHTML = `<span style="color: #28a745;">✓ Mapped to:</span> <span style="color: #666;">${monarchAccount.displayName || monarchAccount.name || 'Monarch Account'}</span>`;
    } else {
      mappingDiv.innerHTML = '<span style="color: #dc3545;">✗ Not mapped</span>';
    }
    infoContainer.appendChild(mappingDiv);

    // Last sync date
    if (lastSyncDate) {
      const syncDiv = document.createElement('div');
      syncDiv.id = `${integrationId}-sync-date-${accountId}`;
      syncDiv.style.cssText = 'font-size: 0.8em; color: #555; margin-top: 2px;';
      syncDiv.textContent = `Last synced: ${formatLastUpdateDate(lastSyncDate)}`;
      infoContainer.appendChild(syncDiv);
    }

    cardHeader.appendChild(infoContainer);

    // Toggle switch for enable/disable
    const toggleContainer = document.createElement('div');
    toggleContainer.id = `${integrationId}-toggle-container-${accountId}`;
    toggleContainer.style.cssText = 'margin-left: auto; margin-right: 10px; flex-shrink: 0;';
    const toggle = createToggleSwitch(syncEnabled, (isEnabled) => {
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

    // Stop propagation on toggle
    toggleContainer.addEventListener('click', (e) => e.stopPropagation());

    // Delete button
    const deleteButton = document.createElement('button');
    deleteButton.id = `${integrationId}-delete-btn-${accountId}`;
    deleteButton.textContent = '🗑️';
    deleteButton.style.cssText = `
      margin-left: 10px;
      background: transparent;
      color: #dc3545;
      border: none;
      border-radius: 50%;
      width: 24px;
      height: 24px;
      cursor: pointer;
      font-size: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    `;
    deleteButton.addEventListener('click', async (e) => {
      e.stopPropagation();
      const accountName = sourceAccount.nickname || sourceAccount.name || accountId;
      const confirmed = await showConfirmDialog(
        `Are you sure you want to delete the account "${accountName}"?\n\nThis will remove all mappings and settings for this account.`,
      );
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
    deleteButton.addEventListener('mouseover', () => {
      deleteButton.style.backgroundColor = '#f8d7da';
    });
    deleteButton.addEventListener('mouseout', () => {
      deleteButton.style.backgroundColor = 'transparent';
    });
    cardHeader.appendChild(deleteButton);

    // Expandable content with settings and debug
    const expandableContent = document.createElement('div');
    expandableContent.id = `${integrationId}-expandable-${accountId}`;
    expandableContent.style.cssText = 'display: none; padding: 15px; background-color: #f8f9fa; border-top: 1px solid #e0e0e0;';

    // Account Settings Section
    const settingsSection = renderAccountSettingsSection(integrationId, accountEntry, accountId, onRefresh);
    expandableContent.appendChild(settingsSection);

    // Transactions Management Section (for integrations with deduplication)
    const transactionsSection = renderTransactionsManagementSection(integrationId, accountEntry, accountId, onRefresh);
    expandableContent.appendChild(transactionsSection);

    // Debug JSON Section
    const debugSection = renderDebugJsonSection(integrationId, accountEntry, accountId, onRefresh);
    expandableContent.appendChild(debugSection);

    card.appendChild(cardHeader);
    card.appendChild(expandableContent);

    // Toggle functionality
    let isExpanded = false;
    cardHeader.addEventListener('click', (e) => {
      // Don't toggle if interactive elements were clicked
      if (e.target === deleteButton || e.target.closest('[id*="toggle-container"]')) return;
      isExpanded = !isExpanded;
      expandableContent.style.display = isExpanded ? 'block' : 'none';
      expandIcon.style.transform = isExpanded ? 'rotate(0deg)' : 'rotate(270deg)';
    });

    // Hover effects
    cardHeader.addEventListener('mouseover', () => {
      if (!isExpanded) {
        cardHeader.style.backgroundColor = !syncEnabled ? '#f0f0f0' : '#f8f9fa';
      }
    });
    cardHeader.addEventListener('mouseout', () => {
      if (!isExpanded) {
        cardHeader.style.backgroundColor = !syncEnabled ? '#fafafa' : '#fff';
      }
    });

    container.appendChild(card);
  });

  return container;
}

/**
 * Creates Wealthsimple account cards (legacy function, kept for backward compatibility)
 * @deprecated Will be removed in Phase 7 cleanup - use createGenericAccountCards instead
 * @param {Array} accounts - Array of consolidated account objects
 * @param {Function} onRefresh - Callback to refresh the tab after changes
 * @returns {HTMLElement} Container with account cards
 */
// eslint-disable-next-line no-unused-vars
function createWealthsimpleAccountCards(accounts, onRefresh) {
  const container = document.createElement('div');
  container.style.cssText = 'margin: 10px 0;';

  accounts.forEach((accountEntry) => {
    const wsAccount = accountEntry.wealthsimpleAccount;
    const monarchAccount = accountEntry.monarchAccount;
    const syncEnabled = accountEntry.syncEnabled;
    const lastSyncDate = accountEntry.lastSyncDate;

    // Create card container
    const card = document.createElement('div');
    card.id = `wealthsimple-account-card-${wsAccount.id}`;
    card.style.cssText = `
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      margin-bottom: 15px;
      overflow: hidden;
      transition: all 0.2s;
    `;

    // Create card header
    const cardHeader = document.createElement('div');
    cardHeader.style.cssText = `
      display: flex;
      align-items: center;
      padding: 15px;
      background-color: ${!syncEnabled ? '#fafafa' : '#fff'};
      cursor: pointer;
      transition: background-color 0.2s;
    `;

    // Expand/collapse icon
    const expandIcon = document.createElement('div');
    expandIcon.style.cssText = `
      margin-right: 10px;
      font-size: 1.2em;
      color: ${!syncEnabled ? '#999' : '#666'};
      transition: transform 0.2s;
      cursor: pointer;
      flex-shrink: 0;
      transform: rotate(270deg);
    `;
    expandIcon.textContent = '▼';
    cardHeader.appendChild(expandIcon);

    // Logo
    const logoContainer = document.createElement('div');
    logoContainer.style.cssText = `margin-right: 15px; flex-shrink: 0; ${!syncEnabled ? 'opacity: 0.5;' : ''}`;
    try {
      GM_addElement(logoContainer, 'img', {
        src: 'https://www.google.com/s2/favicons?domain=wealthsimple.com&sz=128',
        style: 'width: 40px; height: 40px; border-radius: 5px; object-fit: contain;',
      });
    } catch (error) {
      addAccountLogoFallback(logoContainer, 'Wealthsimple');
    }
    cardHeader.appendChild(logoContainer);

    // Account info
    const infoContainer = document.createElement('div');
    infoContainer.style.cssText = 'flex-grow: 1;';

    const nameDiv = document.createElement('div');
    nameDiv.style.cssText = `font-weight: bold; font-size: 1.1em; margin-bottom: 2px; color: ${!syncEnabled ? '#999' : '#333'};`;
    nameDiv.textContent = wsAccount.nickname || 'Unknown Account';
    infoContainer.appendChild(nameDiv);

    const typeDiv = document.createElement('div');
    typeDiv.style.cssText = 'font-size: 0.9em; color: #666; margin-bottom: 2px;';
    typeDiv.textContent = wsAccount.type;
    infoContainer.appendChild(typeDiv);

    // Mapping status
    const mappingDiv = document.createElement('div');
    mappingDiv.style.cssText = 'font-size: 0.8em; margin-top: 5px;';
    if (monarchAccount) {
      mappingDiv.innerHTML = `<span style="color: #28a745;">✓ Mapped to:</span> <span style="color: #666;">${monarchAccount.displayName}</span>`;
    } else {
      mappingDiv.innerHTML = '<span style="color: #dc3545;">✗ Not mapped</span>';
    }
    infoContainer.appendChild(mappingDiv);

    // Last sync date
    if (lastSyncDate) {
      const syncDiv = document.createElement('div');
      syncDiv.style.cssText = 'font-size: 0.8em; color: #555; margin-top: 2px;';
      syncDiv.textContent = `Last synced: ${formatLastUpdateDate(lastSyncDate)}`;
      infoContainer.appendChild(syncDiv);
    }

    cardHeader.appendChild(infoContainer);

    // Toggle switch
    const toggleContainer = document.createElement('div');
    toggleContainer.style.cssText = 'margin-left: auto; margin-right: 10px; flex-shrink: 0;';
    const toggle = createToggleSwitch(syncEnabled, (isEnabled) => {
      const success = markAccountAsSkipped(wsAccount.id, !isEnabled);
      if (success) {
        toast.show(`Account ${wsAccount.nickname} ${isEnabled ? 'enabled' : 'disabled'}`, 'info');
        // Refresh after a short delay
        setTimeout(onRefresh, 500);
      } else {
        toast.show('Failed to update account status', 'error');
        // Revert toggle
        setTimeout(onRefresh, 100);
      }
    });
    toggleContainer.appendChild(toggle);
    cardHeader.appendChild(toggleContainer);

    // Stop propagation on toggle
    toggleContainer.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    // Delete button
    const deleteButton = document.createElement('button');
    deleteButton.textContent = '🗑️';
    deleteButton.style.cssText = `
      margin-left: 10px;
      background: transparent;
      color: #dc3545;
      border: none;
      border-radius: 50%;
      width: 24px;
      height: 24px;
      cursor: pointer;
      font-size: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    `;
    deleteButton.addEventListener('click', async (e) => {
      e.stopPropagation();
      const confirmed = await showConfirmDialog(
        `Are you sure you want to delete the account "${wsAccount.nickname}"?\n\nThis will remove all mappings and settings for this account.`,
      );
      if (confirmed) {
        // Clear the account from the consolidated list
        const allAccounts = getWealthsimpleAccounts();
        const filteredAccounts = allAccounts.filter((acc) => acc.wealthsimpleAccount.id !== wsAccount.id);
        GM_setValue(STORAGE.WEALTHSIMPLE_ACCOUNTS_LIST, JSON.stringify(filteredAccounts));
        toast.show('Account deleted', 'info');
        onRefresh();
      }
    });
    deleteButton.addEventListener('mouseover', () => {
      deleteButton.style.backgroundColor = '#f8d7da';
    });
    deleteButton.addEventListener('mouseout', () => {
      deleteButton.style.backgroundColor = 'transparent';
    });
    cardHeader.appendChild(deleteButton);

    // Expandable content with settings
    const expandableContent = document.createElement('div');
    expandableContent.style.cssText = 'display: none; padding: 15px; background-color: #f8f9fa; border-top: 1px solid #e0e0e0;';

    // Account Settings Section
    const settingsSection = document.createElement('div');
    settingsSection.style.cssText = 'margin-bottom: 15px;';

    const settingsTitle = document.createElement('h4');
    settingsTitle.textContent = 'Account Settings';
    settingsTitle.style.cssText = 'margin: 0 0 10px 0; font-size: 14px; color: #333;';
    settingsSection.appendChild(settingsTitle);

    // Store transaction details in notes toggle
    const transactionDetailsSetting = document.createElement('div');
    transactionDetailsSetting.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: white; border-radius: 6px; margin-bottom: 8px;';

    const transactionDetailsLabel = document.createElement('div');
    transactionDetailsLabel.innerHTML = `
      <div style="font-weight: 500; font-size: 13px;">Store transaction details in notes</div>
      <div style="font-size: 11px; color: #666;">When enabled, subType and transaction ID will be included in the Notes field</div>
    `;

    const transactionDetailsToggle = createToggleSwitch(
      accountEntry.storeTransactionDetailsInNotes ?? false,
      (isEnabled) => {
        const { updateAccountInList } = require('../../services/wealthsimple/account');
        const success = updateAccountInList(wsAccount.id, { storeTransactionDetailsInNotes: isEnabled });
        if (success) {
          toast.show(`Transaction details in notes ${isEnabled ? 'enabled' : 'disabled'}`, 'info');
        } else {
          toast.show('Failed to update setting', 'error');
          setTimeout(onRefresh, 100);
        }
      },
      false, // Don't show Enabled/Disabled label
    );

    transactionDetailsSetting.appendChild(transactionDetailsLabel);
    transactionDetailsSetting.appendChild(transactionDetailsToggle);

    transactionDetailsSetting.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    settingsSection.appendChild(transactionDetailsSetting);

    // Strip store numbers toggle
    const stripStoreNumbersSetting = document.createElement('div');
    stripStoreNumbersSetting.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: white; border-radius: 6px; margin-bottom: 8px;';

    const stripStoreNumbersLabel = document.createElement('div');
    stripStoreNumbersLabel.innerHTML = `
      <div style="font-weight: 500; font-size: 13px;">Strip store numbers from merchants</div>
      <div style="font-size: 11px; color: #666;">Remove store numbers from merchant names (e.g., "WALMART #1234" → "WALMART")</div>
    `;

    const stripStoreNumbersToggle = createToggleSwitch(
      accountEntry.stripStoreNumbers ?? true, // Default true
      (isEnabled) => {
        const { updateAccountInList } = require('../../services/wealthsimple/account');
        const success = updateAccountInList(wsAccount.id, { stripStoreNumbers: isEnabled });
        if (success) {
          toast.show(`Store number stripping ${isEnabled ? 'enabled' : 'disabled'}`, 'info');
        } else {
          toast.show('Failed to update setting', 'error');
          setTimeout(onRefresh, 100);
        }
      },
      false, // Don't show Enabled/Disabled label
    );

    stripStoreNumbersSetting.appendChild(stripStoreNumbersLabel);
    stripStoreNumbersSetting.appendChild(stripStoreNumbersToggle);

    stripStoreNumbersSetting.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    settingsSection.appendChild(stripStoreNumbersSetting);

    // Include pending transactions toggle
    const includePendingSetting = document.createElement('div');
    includePendingSetting.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: white; border-radius: 6px; margin-bottom: 8px;';

    const includePendingLabel = document.createElement('div');
    includePendingLabel.innerHTML = `
      <div style="font-weight: 500; font-size: 13px;">Include pending transactions</div>
      <div style="font-size: 11px; color: #666;">When enabled, authorized (pending) transactions are included with a "Pending" tag</div>
    `;

    const includePendingToggle = createToggleSwitch(
      accountEntry.includePendingTransactions !== false, // Default true
      (isEnabled) => {
        const { updateAccountInList } = require('../../services/wealthsimple/account');
        const success = updateAccountInList(wsAccount.id, { includePendingTransactions: isEnabled });
        if (success) {
          toast.show(`Pending transactions ${isEnabled ? 'enabled' : 'disabled'}`, 'info');
        } else {
          toast.show('Failed to update setting', 'error');
          setTimeout(onRefresh, 100);
        }
      },
      false, // Don't show Enabled/Disabled label
    );

    includePendingSetting.appendChild(includePendingLabel);
    includePendingSetting.appendChild(includePendingToggle);

    includePendingSetting.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    settingsSection.appendChild(includePendingSetting);

    // Transaction retention settings (only for credit card accounts)
    if (wsAccount.type && wsAccount.type.includes('CREDIT')) {
      // Transaction Retention Days
      const retentionDaysSetting = document.createElement('div');
      retentionDaysSetting.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: white; border-radius: 6px; margin-bottom: 8px;';

      const retentionDaysLabel = document.createElement('div');
      retentionDaysLabel.innerHTML = `
        <div style="font-weight: 500; font-size: 13px;">Transaction retention days</div>
        <div style="font-size: 11px; color: #666;">Number of days to keep transaction IDs (0 = unlimited)</div>
      `;

      const retentionDaysInputContainer = document.createElement('div');
      retentionDaysInputContainer.style.cssText = 'display: flex; align-items: center; gap: 4px;';

      const retentionDaysInput = document.createElement('input');
      retentionDaysInput.type = 'number';
      retentionDaysInput.min = '0';
      retentionDaysInput.max = '3650';
      retentionDaysInput.value = accountEntry.transactionRetentionDays ?? 91;
      retentionDaysInput.style.cssText = 'width: 70px; padding: 4px 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 13px;';

      retentionDaysInput.addEventListener('change', () => {
        const value = parseInt(retentionDaysInput.value, 10);
        const previousValue = accountEntry.transactionRetentionDays ?? TRANSACTION_RETENTION_DEFAULTS.DAYS;
        if (Number.isNaN(value) || value < 0) {
          retentionDaysInput.value = previousValue;
          toast.show('Please enter a valid number (0 or greater)', 'error');
          return;
        }

        // Validate retention vs lookback (retention must be > lookback)
        const currentLookback = getLookbackForInstitution('wealthsimple');
        const validation = validateLookbackVsRetention(currentLookback, value);
        if (!validation.valid) {
          retentionDaysInput.value = previousValue;
          toast.show(`Retention period (${value} days) must be greater than lookback period (${currentLookback} days)`, 'error');
          return;
        }

        const { updateAccountInList } = require('../../services/wealthsimple/account');
        const success = updateAccountInList(wsAccount.id, { transactionRetentionDays: value });
        if (success) {
          toast.show(`Transaction retention days set to ${value === 0 ? 'unlimited' : value}`, 'info');
        } else {
          toast.show('Failed to update setting', 'error');
        }
      });

      const daysLabel = document.createElement('span');
      daysLabel.textContent = 'days';
      daysLabel.style.cssText = 'font-size: 12px; color: #666;';

      retentionDaysInputContainer.appendChild(retentionDaysInput);
      retentionDaysInputContainer.appendChild(daysLabel);

      retentionDaysSetting.appendChild(retentionDaysLabel);
      retentionDaysSetting.appendChild(retentionDaysInputContainer);

      retentionDaysSetting.addEventListener('click', (e) => {
        e.stopPropagation();
      });

      settingsSection.appendChild(retentionDaysSetting);

      // Transaction Retention Count
      const retentionCountSetting = document.createElement('div');
      retentionCountSetting.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: white; border-radius: 6px; margin-bottom: 8px;';

      const retentionCountLabel = document.createElement('div');
      retentionCountLabel.innerHTML = `
        <div style="font-weight: 500; font-size: 13px;">Transaction retention count</div>
        <div style="font-size: 11px; color: #666;">Maximum number of transaction IDs to keep (0 = unlimited)</div>
      `;

      const retentionCountInputContainer = document.createElement('div');
      retentionCountInputContainer.style.cssText = 'display: flex; align-items: center; gap: 4px;';

      const retentionCountInput = document.createElement('input');
      retentionCountInput.type = 'number';
      retentionCountInput.min = '0';
      retentionCountInput.max = '100000';
      retentionCountInput.value = accountEntry.transactionRetentionCount ?? 1000;
      retentionCountInput.style.cssText = 'width: 70px; padding: 4px 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 13px;';

      retentionCountInput.addEventListener('change', () => {
        const value = parseInt(retentionCountInput.value, 10);
        if (Number.isNaN(value) || value < 0) {
          retentionCountInput.value = accountEntry.transactionRetentionCount ?? 1000;
          toast.show('Please enter a valid number (0 or greater)', 'error');
          return;
        }
        const { updateAccountInList } = require('../../services/wealthsimple/account');
        const success = updateAccountInList(wsAccount.id, { transactionRetentionCount: value });
        if (success) {
          toast.show(`Transaction retention count set to ${value === 0 ? 'unlimited' : value}`, 'info');
        } else {
          toast.show('Failed to update setting', 'error');
        }
      });

      const countLabel = document.createElement('span');
      countLabel.textContent = 'IDs';
      countLabel.style.cssText = 'font-size: 12px; color: #666;';

      retentionCountInputContainer.appendChild(retentionCountInput);
      retentionCountInputContainer.appendChild(countLabel);

      retentionCountSetting.appendChild(retentionCountLabel);
      retentionCountSetting.appendChild(retentionCountInputContainer);

      retentionCountSetting.addEventListener('click', (e) => {
        e.stopPropagation();
      });

      settingsSection.appendChild(retentionCountSetting);
    }

    expandableContent.appendChild(settingsSection);

    // JSON Debug Info Section
    const debugSection = document.createElement('div');
    debugSection.id = `debug-section-${wsAccount.id}`;

    const debugHeader = document.createElement('div');
    debugHeader.style.cssText = 'display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;';

    const debugTitle = document.createElement('h4');
    debugTitle.textContent = 'Debug Information';
    debugTitle.style.cssText = 'margin: 0; font-size: 14px; color: #333;';
    debugHeader.appendChild(debugTitle);

    // Button container for Edit/Save/Cancel
    const buttonContainer = document.createElement('div');
    buttonContainer.id = `debug-buttons-${wsAccount.id}`;
    buttonContainer.style.cssText = 'display: flex; gap: 8px;';

    // Edit button (visible in view mode)
    const editButton = document.createElement('button');
    editButton.id = `debug-edit-btn-${wsAccount.id}`;
    editButton.textContent = '✍️ Edit';
    editButton.style.cssText = `
      padding: 4px 10px;
      border: 1px solid #6c757d;
      border-radius: 4px;
      background: white;
      color: #6c757d;
      cursor: pointer;
      font-size: 12px;
      display: flex;
      align-items: center;
      gap: 4px;
      transition: all 0.2s;
    `;
    editButton.addEventListener('mouseover', () => {
      editButton.style.backgroundColor = '#f8f9fa';
      editButton.style.borderColor = '#5a6268';
    });
    editButton.addEventListener('mouseout', () => {
      editButton.style.backgroundColor = 'white';
      editButton.style.borderColor = '#6c757d';
    });

    // Save button (hidden in view mode)
    const saveButton = document.createElement('button');
    saveButton.id = `debug-save-btn-${wsAccount.id}`;
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
    cancelButton.id = `debug-cancel-btn-${wsAccount.id}`;
    cancelButton.textContent = '✘ Cancel';
    cancelButton.style.cssText = `
      padding: 4px 10px;
      border: 1px solid #dc3545;
      border-radius: 4px;
      background: white;
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
      cancelButton.style.backgroundColor = 'white';
    });

    buttonContainer.appendChild(editButton);
    buttonContainer.appendChild(saveButton);
    buttonContainer.appendChild(cancelButton);
    debugHeader.appendChild(buttonContainer);
    debugSection.appendChild(debugHeader);

    // JSON container (view mode)
    const jsonContainer = document.createElement('pre');
    jsonContainer.id = `debug-json-view-${wsAccount.id}`;
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
    debugSection.appendChild(jsonContainer);

    // JSON textarea (edit mode - hidden by default)
    const jsonTextarea = document.createElement('textarea');
    jsonTextarea.id = `debug-json-edit-${wsAccount.id}`;
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
    debugSection.appendChild(jsonTextarea);

    // Store original JSON for cancel functionality
    let originalJson = JSON.stringify(accountEntry, null, 2);

    // Edit button click handler
    editButton.addEventListener('click', (e) => {
      e.stopPropagation();
      // Switch to edit mode
      jsonContainer.style.display = 'none';
      jsonTextarea.style.display = 'block';
      editButton.style.display = 'none';
      saveButton.style.display = 'flex';
      cancelButton.style.display = 'flex';
      // Store current value as original for cancel
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
      const { updateAccountInList } = require('../../services/wealthsimple/account');
      const success = updateAccountInList(wsAccount.id, parsedJson);

      if (success) {
        toast.show('Debug information saved successfully', 'info');
        // Update the view
        jsonContainer.textContent = JSON.stringify(parsedJson, null, 2);
        originalJson = newJsonValue;
        // Switch back to view mode
        jsonContainer.style.display = 'block';
        jsonTextarea.style.display = 'none';
        editButton.style.display = 'flex';
        saveButton.style.display = 'none';
        cancelButton.style.display = 'none';
        // Refresh the tab to reflect changes
        setTimeout(onRefresh, 500);
      } else {
        toast.show('Failed to save debug information', 'error');
      }
    });

    // Cancel button click handler
    cancelButton.addEventListener('click', (e) => {
      e.stopPropagation();
      // Restore original JSON
      jsonTextarea.value = originalJson;
      // Switch back to view mode
      jsonContainer.style.display = 'block';
      jsonTextarea.style.display = 'none';
      editButton.style.display = 'flex';
      saveButton.style.display = 'none';
      cancelButton.style.display = 'none';
    });

    expandableContent.appendChild(debugSection);

    card.appendChild(cardHeader);
    card.appendChild(expandableContent);

    // Toggle functionality
    let isExpanded = false;
    cardHeader.addEventListener('click', (e) => {
      // Don't toggle if interactive elements were clicked
      if (e.target === deleteButton || e.target.closest('.toggle-container')) return;
      isExpanded = !isExpanded;
      expandableContent.style.display = isExpanded ? 'block' : 'none';
      expandIcon.style.transform = isExpanded ? 'rotate(0deg)' : 'rotate(270deg)';
    });

    // Hover effects
    cardHeader.addEventListener('mouseover', () => {
      if (!isExpanded) {
        cardHeader.style.backgroundColor = !syncEnabled ? '#f0f0f0' : '#f8f9fa';
      }
    });
    cardHeader.addEventListener('mouseout', () => {
      if (!isExpanded) {
        cardHeader.style.backgroundColor = !syncEnabled ? '#fafafa' : '#fff';
      }
    });

    container.appendChild(card);
  });

  return container;
}

/**
 * Shows the settings modal
 */
export function showSettingsModal() {
  // Remove any existing modal
  const existingModal = document.querySelector('.settings-modal-backdrop');
  if (existingModal) {
    existingModal.remove();
  }

  // Create and show new modal
  const modal = createSettingsModal();
  document.body.appendChild(modal);
}

export { createGenericAccountCards };

export default {
  createSettingsModal,
  showSettingsModal,
  createGenericAccountCards,
};
