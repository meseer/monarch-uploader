/**
 * Settings Modal Component
 * Provides a unified interface for managing application settings and stored data
 */

import { debugLog, getDefaultLookbackDays } from '../../core/utils';
import { STORAGE, API } from '../../core/config';
import { checkMonarchAuth } from '../../services/auth';
import { checkQuestradeAuth } from '../../services/questrade/auth';
import { isAccountSkipped, markAccountAsSkipped, getWealthsimpleAccounts } from '../../services/wealthsimple/account';
import toast from '../toast';
import { createMonarchLoginLink } from './monarchLoginLink';

/**
 * Gets institution logo from stored account mappings
 * @param {string} storagePrefix - Storage prefix for account mappings
 * @param {string} institutionName - Institution name for fallback
 * @returns {HTMLElement} Logo element (img or fallback)
 */
function getInstitutionLogo(storagePrefix, institutionName) {
  const allKeys = GM_listValues();

  // Look for stored account mappings with this prefix
  for (const key of allKeys) {
    if (key.startsWith(storagePrefix)) {
      try {
        const accountData = GM_getValue(key, '');
        const parsedAccount = JSON.parse(accountData);

        // Check if this account has a logoUrl
        if (parsedAccount && parsedAccount.logoUrl) {
          const logoContainer = document.createElement('div');
          logoContainer.style.cssText = 'display: inline-flex; margin-right: 6px;';
          GM_addElement(logoContainer, 'img', {
            src: parsedAccount.logoUrl,
            style: 'width: 16px; height: 16px; border-radius: 3px; object-fit: contain;',
          });
          return logoContainer;
        }
      } catch (error) {
        debugLog('Error parsing account data for logo:', error);
        continue;
      }
    }
  }

  // No logo found - create letter fallback
  const logoFallback = document.createElement('div');
  logoFallback.style.cssText = `
    width: 16px;
    height: 16px;
    border-radius: 3px;
    background-color: #e0e0e0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    color: #666;
    font-weight: bold;
    margin-right: 6px;
  `;
  const firstChar = institutionName ? institutionName.charAt(0).toUpperCase() : '?';
  logoFallback.textContent = firstChar;
  return logoFallback;
}

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
        src: 'https://www.google.com/s2/favicons?domain=monarch.com&sz=128',
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
    } else if (tab.storagePrefix && tab.institutionName) {
      // Get institution logo from stored mappings
      const logoElement = getInstitutionLogo(tab.storagePrefix, tab.institutionName);
      buttonContent.appendChild(logoElement);
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
  const section = createSection('Log Level', '🔍', 'Configure application logging level');

  const logLevelContainer = document.createElement('div');
  logLevelContainer.style.cssText = 'margin: 15px 0;';

  const label = document.createElement('label');
  label.textContent = 'Log Level:';
  label.style.cssText = 'display: block; margin-bottom: 8px; font-weight: bold;';

  const select = document.createElement('select');
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
  section.appendChild(logLevelContainer);

  container.appendChild(section);
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

    GM_setValue(storageKey, value);
    toast.show(`${institutionName} lookback period set to ${value} day${value !== 1 ? 's' : ''}`, 'info');
    debugLog(`${institutionName} lookback period updated to: ${value} days`);
  };

  // Reset to default
  resetButton.addEventListener('click', () => {
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

  // Account Mappings Section
  const mappingsSection = createSection('Account Mappings', '🔗', 'Questrade to Monarch account mappings');
  const mappingsData = getStorageData(STORAGE.QUESTRADE_ACCOUNT_MAPPING_PREFIX);
  const mappingsCards = createAccountMappingCards(mappingsData, (key) => {
    GM_deleteValue(key);
    toast.show('Account mapping deleted', 'info');
    renderTabContent(container, 'questrade');
  }, 'Questrade', 'questrade');
  mappingsSection.appendChild(mappingsCards);

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

  // Account Mappings Section
  const mappingsSection = createSection('Account Mappings', '🔗', 'CanadaLife to Monarch account mappings');
  const mappingsData = getStorageData(STORAGE.CANADALIFE_ACCOUNT_MAPPING_PREFIX);
  const mappingsCards = createAccountMappingCards(mappingsData, (key) => {
    GM_deleteValue(key);
    toast.show('Account mapping deleted', 'info');
    renderTabContent(container, 'canadalife');
  }, 'Canada Life', 'canadalife');
  mappingsSection.appendChild(mappingsCards);

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

  // Account Mappings Section
  const mappingsSection = createSection('Account Mappings', '🔗', 'Rogers Bank to Monarch account mappings');
  const mappingsData = getStorageData(STORAGE.ROGERSBANK_ACCOUNT_MAPPING_PREFIX);
  const mappingsCards = createAccountMappingCards(mappingsData, (key) => {
    GM_deleteValue(key);
    toast.show('Account mapping deleted', 'info');
    renderTabContent(container, 'rogersbank');
  }, 'Rogers Bank', 'rogersbank');
  mappingsSection.appendChild(mappingsCards);

  // Uploaded Transactions Section
  const transactionsSection = createSection('Uploaded Transactions', '📋', 'Individual transaction references that have been uploaded');
  const transactionsTable = createTransactionsManagementTable();
  transactionsSection.appendChild(transactionsTable);

  // Category Mappings Section
  const categorySection = createSection('Category Mappings', '🏷️', 'Bank category to Monarch category mappings');
  const categoryMappings = GM_getValue(STORAGE.ROGERSBANK_CATEGORY_MAPPINGS, '{}');
  let categoryData = [];

  try {
    const mappings = JSON.parse(categoryMappings);
    categoryData = Object.entries(mappings).map(([bankCategory, monarchCategory]) => [
      `${STORAGE.ROGERSBANK_CATEGORY_MAPPINGS}.${bankCategory}`,
      bankCategory,
      monarchCategory,
    ]);
  } catch (error) {
    debugLog('Error parsing category mappings:', error);
  }

  const categoryTable = createDataTable(['Bank Category', 'Monarch Category', 'Actions'], categoryData, (key) => {
    const [, bankCategory] = key.split('.');
    try {
      const currentMappings = JSON.parse(GM_getValue(STORAGE.ROGERSBANK_CATEGORY_MAPPINGS, '{}'));
      delete currentMappings[bankCategory];
      GM_setValue(STORAGE.ROGERSBANK_CATEGORY_MAPPINGS, JSON.stringify(currentMappings));
      toast.show('Category mapping deleted', 'info');
      renderTabContent(container, 'rogersbank');
    } catch (error) {
      toast.show('Error deleting category mapping', 'error');
      debugLog('Error deleting category mapping:', error);
    }
  });
  categorySection.appendChild(categoryTable);

  container.appendChild(mappingsSection);
  container.appendChild(transactionsSection);
  container.appendChild(categorySection);
}

/**
 * Renders the Wealthsimple settings tab
 * @param {HTMLElement} container - Container element
 */
function renderWealthsimpleTab(container) {
  // Lookback Period Section
  const lookbackSection = createLookbackPeriodSection('wealthsimple');
  container.appendChild(lookbackSection);

  // Account Mappings Section with consolidated structure
  const mappingsSection = createSection('Account Mappings', '🔗', 'Wealthsimple to Monarch account mappings');

  // Get all accounts from consolidated storage
  const accounts = getWealthsimpleAccounts();

  if (accounts.length === 0) {
    const emptyMessage = document.createElement('p');
    emptyMessage.textContent = 'No accounts found. Accounts will appear here after syncing with Wealthsimple.';
    emptyMessage.style.cssText = 'color: #666; font-style: italic; margin: 10px 0;';
    mappingsSection.appendChild(emptyMessage);
  } else {
    const accountCards = createWealthsimpleAccountCards(accounts, () => {
      // Refresh callback
      renderTabContent(container, 'wealthsimple');
    });
    mappingsSection.appendChild(accountCards);
  }

  container.appendChild(mappingsSection);
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
 * Gets stored data based on prefix
 * @param {string} prefix - Storage key prefix
 * @returns {Array} Array of [key, displayKey, value] tuples
 */
function getStorageData(prefix) {
  const allKeys = GM_listValues();
  const data = [];

  allKeys.forEach((key) => {
    if (key.startsWith(prefix)) {
      const displayKey = key.replace(prefix, '');
      const value = GM_getValue(key, '');
      data.push([key, displayKey, value]);
    }
  });

  return data;
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
 * @returns {HTMLElement} Toggle switch element
 */
function createToggleSwitch(isEnabled, onChange) {
  const container = document.createElement('label');
  container.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    user-select: none;
  `;

  const label = document.createElement('span');
  label.textContent = 'Enabled';
  label.style.cssText = 'font-size: 13px; color: #666;';

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
    onChange(newState);
  });

  switchContainer.appendChild(switchSlider);
  container.appendChild(label);
  container.appendChild(switchContainer);
  container.appendChild(checkbox);

  // Make the container clickable
  container.addEventListener('click', (e) => {
    if (e.target !== checkbox) {
      checkbox.checked = !checkbox.checked;
      checkbox.dispatchEvent(new Event('change'));
    }
  });

  return container;
}

/**
 * Creates account mapping cards (for Monarch account mappings)
 * @param {Array} data - Array of [key, displayKey, value] tuples
 * @param {Function} onDelete - Delete handler
 * @param {string} institutionName - Institution name for logo fallback
 * @param {string} institutionType - Type of institution for last update date lookup
 * @returns {HTMLElement} Cards container element
 */
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
 * Creates a data table
 * @param {Array} headers - Table headers
 * @param {Array} data - Table data
 * @param {Function} onDelete - Delete handler
 * @param {boolean} isJsonValue - Whether to parse value as JSON
 * @returns {HTMLElement} Table element
 */
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
 * @returns {HTMLElement} Transaction management table element
 */
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
      checkbox.dataset.refValue = ref;

      const refText = document.createElement('span');
      refText.textContent = ref;
      refText.style.cssText = 'font-family: monospace; font-size: 13px;';

      refRow.appendChild(checkbox);
      refRow.appendChild(refText);
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
 * Creates Wealthsimple account cards from consolidated structure
 * @param {Array} accounts - Array of consolidated account objects
 * @param {Function} onRefresh - Refresh callback
 * @returns {HTMLElement} Cards container element
 */
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
    jsonContainer.textContent = JSON.stringify(accountEntry, null, 2);
    expandableContent.appendChild(jsonContainer);

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

export default {
  createSettingsModal,
  showSettingsModal,
};
