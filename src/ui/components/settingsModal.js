/**
 * Settings Modal Component
 * Provides a unified interface for managing application settings and stored data
 */

import { debugLog } from '../../core/utils';
import { STORAGE } from '../../core/config';
import toast from '../toast';

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
    width: 800px;
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

  // Create tab navigation
  const tabNav = document.createElement('div');
  tabNav.className = 'settings-tab-nav';
  tabNav.style.cssText = `
    display: flex;
    border-bottom: 1px solid #e0e0e0;
    background-color: #f8f9fa;
  `;

  // Create tab content container
  const tabContent = document.createElement('div');
  tabContent.className = 'settings-tab-content';
  tabContent.style.cssText = `
    padding: 20px;
    height: 500px;
    overflow-y: auto;
  `;

  // Define tabs
  const tabs = [
    { id: 'general', label: 'General', icon: '⚙️' },
    { id: 'questrade', label: 'Questrade', icon: '💼' },
    { id: 'canadalife', label: 'CanadaLife', icon: '🏛️' },
    { id: 'rogersbank', label: 'Rogers Bank', icon: '🏦' },
  ];

  let activeTab = 'general';

  // Create tab buttons
  tabs.forEach((tab) => {
    const tabButton = document.createElement('button');
    tabButton.className = `settings-tab-button ${tab.id === activeTab ? 'active' : ''}`;
    tabButton.innerHTML = `${tab.icon} ${tab.label}`;
    tabButton.style.cssText = `
      background: none;
      border: none;
      padding: 15px 20px;
      cursor: pointer;
      font-size: 14px;
      border-bottom: 3px solid transparent;
      transition: all 0.2s;
    `;

    if (tab.id === activeTab) {
      tabButton.style.borderBottomColor = '#0073b1';
      tabButton.style.backgroundColor = 'white';
      tabButton.style.fontWeight = 'bold';
    }

    tabButton.addEventListener('click', () => {
      // Update active tab
      activeTab = tab.id;

      // Update tab button styles
      tabNav.querySelectorAll('.settings-tab-button').forEach((btn) => {
        btn.style.borderBottomColor = 'transparent';
        btn.style.backgroundColor = 'transparent';
        btn.style.fontWeight = 'normal';
      });

      tabButton.style.borderBottomColor = '#0073b1';
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

  modalContent.appendChild(tabNav);
  modalContent.appendChild(tabContent);

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

  const currentLogLevel = GM_getValue('debug_log_level', 'debug');

  logLevels.forEach((level) => {
    const option = document.createElement('option');
    option.value = level.value;
    option.textContent = level.label;
    option.selected = level.value === currentLogLevel;
    select.appendChild(option);
  });

  select.addEventListener('change', () => {
    GM_setValue('debug_log_level', select.value);
    toast.show(`Log level set to: ${select.options[select.selectedIndex].text}`, 'success');
    debugLog(`Log level changed to: ${select.value}`);
  });

  logLevelContainer.appendChild(label);
  logLevelContainer.appendChild(select);
  section.appendChild(logLevelContainer);

  container.appendChild(section);
}

/**
 * Renders the Questrade settings tab
 * @param {HTMLElement} container - Container element
 */
function renderQuestradeTab(container) {
  // Account Mappings Section
  const mappingsSection = createSection('Account Mappings', '🔗', 'Questrade to Monarch account mappings');
  const mappingsData = getStorageData(STORAGE.ACCOUNT_MAPPING_PREFIX);
  const mappingsTable = createDataTable(['Questrade Account', 'Monarch Account', 'Actions'], mappingsData, (key) => {
    GM_deleteValue(key);
    toast.show('Account mapping deleted', 'success');
    renderQuestradeTab(container);
  });
  mappingsSection.appendChild(mappingsTable);

  // Last Sync Dates Section
  const syncSection = createSection('Last Sync Dates', '📅', 'Last download dates for accounts');
  const syncData = getStorageData(STORAGE.LAST_DATE_PREFIX);
  const syncTable = createDataTable(['Account ID', 'Last Download Date', 'Actions'], syncData, (key) => {
    GM_deleteValue(key);
    toast.show('Last sync date cleared', 'success');
    renderQuestradeTab(container);
  });
  syncSection.appendChild(syncTable);

  container.appendChild(mappingsSection);
  container.appendChild(syncSection);
}

/**
 * Renders the CanadaLife settings tab
 * @param {HTMLElement} container - Container element
 */
function renderCanadaLifeTab(container) {
  // Account Mappings Section
  const mappingsSection = createSection('Account Mappings', '🔗', 'CanadaLife to Monarch account mappings');
  const mappingsData = getStorageData(STORAGE.CANADALIFE_ACCOUNT_MAPPING_PREFIX);
  const mappingsTable = createDataTable(['CanadaLife Account', 'Monarch Account', 'Actions'], mappingsData, (key) => {
    GM_deleteValue(key);
    toast.show('Account mapping deleted', 'success');
    renderCanadaLifeTab(container);
  });
  mappingsSection.appendChild(mappingsTable);

  // Last Upload Dates Section
  const uploadSection = createSection('Last Upload Dates', '📅', 'Last upload dates for accounts');
  const uploadData = getStorageData(STORAGE.CANADALIFE_LAST_UPLOAD_DATE_PREFIX);
  const uploadTable = createDataTable(['Account ID', 'Last Upload Date', 'Actions'], uploadData, (key) => {
    GM_deleteValue(key);
    toast.show('Last upload date cleared', 'success');
    renderCanadaLifeTab(container);
  });
  uploadSection.appendChild(uploadTable);

  container.appendChild(mappingsSection);
  container.appendChild(uploadSection);
}

/**
 * Renders the Rogers Bank settings tab
 * @param {HTMLElement} container - Container element
 */
function renderRogersBankTab(container) {
  // Account Mappings Section
  const mappingsSection = createSection('Account Mappings', '🔗', 'Rogers Bank to Monarch account mappings');
  const mappingsData = getStorageData(STORAGE.ROGERSBANK_ACCOUNT_MAPPING_PREFIX);
  const mappingsTable = createDataTable(['Rogers Account', 'Monarch Account', 'Actions'], mappingsData, (key) => {
    GM_deleteValue(key);
    toast.show('Account mapping deleted', 'success');
    renderRogersBankTab(container);
  });
  mappingsSection.appendChild(mappingsTable);

  // Last Upload Dates Section
  const uploadSection = createSection('Last Upload Dates', '📅', 'Last upload dates for accounts');
  const uploadData = getStorageData(STORAGE.ROGERSBANK_LAST_UPLOAD_DATE_PREFIX);
  const uploadTable = createDataTable(['Account ID', 'Last Upload Date', 'Actions'], uploadData, (key) => {
    GM_deleteValue(key);
    toast.show('Last upload date cleared', 'success');
    renderRogersBankTab(container);
  });
  uploadSection.appendChild(uploadTable);

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
      toast.show('Category mapping deleted', 'success');
      renderRogersBankTab(container);
    } catch (error) {
      toast.show('Error deleting category mapping', 'error');
      debugLog('Error deleting category mapping:', error);
    }
  });
  categorySection.appendChild(categoryTable);

  container.appendChild(mappingsSection);
  container.appendChild(uploadSection);
  container.appendChild(transactionsSection);
  container.appendChild(categorySection);
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
  transactionAccounts.forEach((account, index) => {
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

    accountContent.appendChild(bulkActions);
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
        toast.show(`All transaction references cleared for ${account.accountId}`, 'success');
        // Refresh the Rogers Bank tab
        const tabContainer = document.querySelector('.settings-tab-content');
        if (tabContainer) {
          renderRogersBankTab(tabContainer);
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

  toast.show(`Deleted ${selectedCheckboxes.length} transaction reference(s)`, 'success');

  // Refresh the Rogers Bank tab
  const tabContainer = document.querySelector('.settings-tab-content');
  if (tabContainer) {
    renderRogersBankTab(tabContainer);
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

export default {
  createSettingsModal,
  showSettingsModal,
};
