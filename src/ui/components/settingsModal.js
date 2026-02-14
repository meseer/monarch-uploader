/**
 * Settings Modal Component
 * Provides a unified interface for managing application settings and stored data
 */

import { debugLog, getCurrentInstitution } from '../../core/utils';
import { STORAGE, API } from '../../core/config';
import { checkMonarchAuth } from '../../services/auth';
import toast from '../toast';
import { createMonarchLoginLink } from './monarchLoginLink';
import {
  INTEGRATIONS,
} from '../../core/integrationCapabilities';
import accountService from '../../services/common/accountService';
import scriptInfo from '../../scriptInfo.json';
import {
  checkInstitutionConnection,
  createLookbackPeriodSection,
  sortWealthsimpleAccounts,
  createSection,
  showConfirmDialog,
  renderCategoryMappingsSectionIfEnabled,
  renderCategoryMappingsSection,
  createToggleSwitch,
  addAccountLogoFallback,
  formatLastUpdateDate,
  renderDebugJsonSection,
} from './settingsModalHelpers';
import {
  renderAccountSettingsSection,
  renderTransactionsManagementSection,
  renderHoldingsMappingsSection,
  createGenericAccountCards,
} from './settingsModalAccountCards';

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
    background-color: var(--mu-overlay-bg, rgba(0, 0, 0, 0.5));
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 10000;
  `;

  // Create modal content
  const modalContent = document.createElement('div');
  modalContent.className = 'settings-modal-content';
  modalContent.style.cssText = `
    background-color: var(--mu-bg-primary, white);
    color: var(--mu-text-primary, #333);
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
    border-bottom: 1px solid var(--mu-border, #e0e0e0);
    background-color: var(--mu-bg-secondary, #f8f9fa);
  `;

  const title = document.createElement('h2');
  title.textContent = 'Settings';
  title.style.cssText = 'margin: 0; font-size: 20px; font-weight: bold; color: var(--mu-text-primary, #333);';
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
    color: var(--mu-text-secondary, #666);
  `;
  closeButton.addEventListener('click', () => modal.remove());
  closeButton.addEventListener('mouseover', () => {
    closeButton.style.backgroundColor = 'var(--mu-hover-bg, #f0f0f0)';
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
    background-color: var(--mu-bg-secondary, #f8f9fa);
    border-right: 1px solid var(--mu-border, #e0e0e0);
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
      institutionName: null,
    },
    {
      id: 'questrade',
      label: 'Questrade',
      fallbackIcon: '💼',
      institutionName: 'Questrade',
    },
    {
      id: 'canadalife',
      label: 'CanadaLife',
      fallbackIcon: '🏛️',
      institutionName: 'Canada Life',
    },
    {
      id: 'rogersbank',
      label: 'Rogers Bank',
      fallbackIcon: '🏦',
      institutionName: 'Rogers Bank',
    },
    {
      id: 'wealthsimple',
      label: 'Wealthsimple',
      fallbackIcon: '💰',
      institutionName: 'Wealthsimple',
    },
    {
      id: 'monarch',
      label: 'Monarch',
      fallbackIcon: '👑',
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
      tabButton.style.borderLeftColor = 'var(--mu-tab-active-border, #0073b1)';
      tabButton.style.backgroundColor = 'var(--mu-tab-active-bg, white)';
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

      tabButton.style.borderLeftColor = 'var(--mu-tab-active-border, #0073b1)';
      tabButton.style.backgroundColor = 'var(--mu-tab-active-bg, white)';
      tabButton.style.fontWeight = 'bold';

      // Update tab content
      renderTabContent(tabContent, activeTab);
    });

    tabButton.addEventListener('mouseover', () => {
      if (tab.id !== activeTab) {
        tabButton.style.backgroundColor = 'var(--mu-tab-hover-bg, #f0f0f0)';
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
    border-top: 1px solid var(--mu-border, #e0e0e0);
  `;

  const versionLink = document.createElement('a');
  versionLink.id = 'settings-version-link';
  versionLink.href = scriptInfo.gistUrl;
  versionLink.target = '_blank';
  versionLink.rel = 'noopener noreferrer';
  versionLink.textContent = `v${scriptInfo.version}`;
  versionLink.style.cssText = `
    font-size: 12px;
    color: var(--mu-text-secondary, #666);
    text-decoration: none;
    display: inline-block;
    transition: color 0.2s;
  `;
  versionLink.addEventListener('mouseover', () => {
    versionLink.style.color = 'var(--mu-link-color, #0073b1)';
    versionLink.style.textDecoration = 'underline';
  });
  versionLink.addEventListener('mouseout', () => {
    versionLink.style.color = 'var(--mu-text-secondary, #666)';
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
    border: 1px solid var(--mu-input-border, #ccc);
    border-radius: 4px;
    font-size: 14px;
    min-width: 150px;
    background: var(--mu-input-bg, white);
    color: var(--mu-text-primary, #333);
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
  devModeContainer.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 12px 15px; background: var(--mu-bg-secondary, #f8f9fa); border-radius: 8px; border: 1px solid var(--mu-border, #e0e0e0);';

  const devModeLabel = document.createElement('div');
  devModeLabel.innerHTML = `
    <div style="font-weight: 500; font-size: 14px; margin-bottom: 4px;">Enable Development Mode</div>
    <div style="font-size: 12px; color: var(--mu-text-secondary, #666);">When enabled, shows development-only UI elements like testing sections in Canada Life</div>
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
    ? 'background-color: var(--mu-status-success-bg, #d4edda); border: 1px solid var(--mu-status-success-border, #c3e6cb); color: var(--mu-status-success-text, #155724);'
    : 'background-color: var(--mu-status-error-bg, #f8d7da); border: 1px solid var(--mu-status-error-border, #f5c6cb); color: var(--mu-status-error-text, #721c24);'
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
  statusDetails.style.cssText = 'font-size: 13px; color: var(--mu-text-secondary, #666); margin-bottom: 15px; line-height: 1.4;';

  if (authStatus.authenticated) {
    statusDetails.innerHTML = `
      <strong>Status:</strong> Your authentication token is stored and ready to use.<br>
      <strong>Usage:</strong> This token is used to authenticate with Monarch Money's API for transaction uploads.
    `;
  } else {
    // MIGRATION: Use dynamic Monarch app URL
    statusDetails.innerHTML = `
      <strong>Status:</strong> No authentication token found.<br>
      <strong>To connect:</strong> Visit <a href="${API.MONARCH_APP_URL}" target="_blank" style="color: var(--mu-link-color, #0073b1); text-decoration: none;">Monarch Money</a> and log in. The token will be automatically captured.
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
    tokenInfo.style.cssText = 'margin-bottom: 15px; font-size: 14px; color: var(--mu-text-secondary, #666);';
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

// Re-export sub-module functions for backward compatibility
export {
  createGenericAccountCards,
  checkInstitutionConnection,
  createLookbackPeriodSection,
  sortWealthsimpleAccounts,
  createSection,
  showConfirmDialog,
  renderCategoryMappingsSectionIfEnabled,
  renderCategoryMappingsSection,
  createToggleSwitch,
  addAccountLogoFallback,
  formatLastUpdateDate,
  renderDebugJsonSection,
  renderAccountSettingsSection,
  renderTransactionsManagementSection,
  renderHoldingsMappingsSection,
};

export default {
  createSettingsModal,
  showSettingsModal,
  createGenericAccountCards,
};
