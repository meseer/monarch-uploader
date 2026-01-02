/**
 * Account Creation Dialog Component
 * Single-form dialog for creating new Monarch accounts
 */

import { debugLog } from '../../core/utils';
import monarchApi from '../../api/monarch';
import toast from '../toast';
import { addModalKeyboardHandlers } from '../keyboardNavigation';

/**
 * Show account creation dialog
 * @param {Object} options - Configuration options
 * @param {string} options.defaultName - Default account name
 * @param {string} options.defaultType - Default account type (e.g., 'brokerage')
 * @param {string} options.defaultSubtype - Default account subtype (e.g., 'tfsa')
 * @param {number} options.defaultBalance - Default initial balance
 * @param {boolean} options.defaultIncludeInNetWorth - Default net worth inclusion
 * @returns {Promise<Object|null>} Created account or null if cancelled
 */
export async function showAccountCreationDialog(options = {}) {
  const {
    defaultName = '',
    defaultType = null,
    defaultSubtype = null,
    defaultBalance = 0,
    defaultIncludeInNetWorth = true,
  } = options;

  debugLog('Opening account creation dialog with defaults:', {
    defaultName,
    defaultType,
    defaultSubtype,
    defaultBalance,
    defaultIncludeInNetWorth,
  });

  // Fetch account type options from Monarch
  let accountTypeOptions;
  try {
    accountTypeOptions = await monarchApi.getAccountTypeOptions();
    debugLog(`Fetched ${accountTypeOptions.length} account type options from Monarch`);
  } catch (error) {
    debugLog('Failed to fetch account type options:', error);
    toast.show('Failed to load account types from Monarch', 'error');
    return null;
  }

  return new Promise((resolve) => {
    // Set up keyboard navigation cleanup function
    let cleanupKeyboard = () => {};

    // Create overlay
    const overlay = createModalOverlay(() => {
      cleanupKeyboard();
      overlay.remove();
      resolve(null);
    });
    overlay.id = 'account-creation-overlay';

    // Create modal
    const modal = document.createElement('div');
    modal.id = 'account-creation-modal';
    modal.style.cssText = `
      background: white;
      padding: 25px;
      border-radius: 8px;
      width: 90%;
      max-width: 500px;
      max-height: 80vh;
      overflow-y: auto;
    `;

    // Add header
    const header = document.createElement('h2');
    header.id = 'account-creation-header';
    header.style.cssText = 'margin-top: 0; margin-bottom: 20px; font-size: 1.2em;';
    header.textContent = 'Create New Monarch Account';
    modal.appendChild(header);

    // Create form
    const form = document.createElement('form');
    form.id = 'account-creation-form';
    form.style.cssText = 'display: flex; flex-direction: column; gap: 15px;';

    // Account Name field
    const nameGroup = createFormGroup(
      'account-name',
      'Account Name:',
      'text',
      defaultName,
      'Enter account name',
      true,
    );
    form.appendChild(nameGroup.container);

    // Account Type dropdown
    const typeGroup = createTypeDropdown(
      'account-type',
      'Account Type:',
      accountTypeOptions,
      defaultType,
    );
    form.appendChild(typeGroup.container);

    // Account Subtype dropdown
    const subtypeGroup = createSubtypeDropdown(
      'account-subtype',
      'Account Subtype:',
      [],
      defaultSubtype,
    );
    form.appendChild(subtypeGroup.container);

    // Initial Balance field
    const balanceGroup = createFormGroup(
      'account-balance',
      'Initial Balance:',
      'number',
      defaultBalance,
      '0.00',
      true,
    );
    balanceGroup.input.step = '0.01';
    form.appendChild(balanceGroup.container);

    // Include in Net Worth checkbox
    const netWorthGroup = createCheckboxGroup(
      'account-net-worth',
      'Include in net worth',
      defaultIncludeInNetWorth,
    );
    form.appendChild(netWorthGroup.container);

    // Error message container
    const errorContainer = document.createElement('div');
    errorContainer.id = 'account-creation-error';
    errorContainer.style.cssText = 'color: #d32f2f; font-size: 0.9em; display: none;';
    form.appendChild(errorContainer);

    // Buttons container
    const buttonContainer = document.createElement('div');
    buttonContainer.id = 'account-creation-buttons';
    buttonContainer.style.cssText = 'display: flex; gap: 10px; margin-top: 10px;';

    // Create button
    const createButton = document.createElement('button');
    createButton.id = 'account-creation-create-button';
    createButton.type = 'submit';
    createButton.textContent = 'Create';
    createButton.style.cssText = `
      padding: 10px 20px;
      background-color: #1976d2;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 1em;
      flex: 1;
    `;
    createButton.onmouseover = () => {
      if (!createButton.disabled) {
        createButton.style.backgroundColor = '#1565c0';
      }
    };
    createButton.onmouseout = () => {
      if (!createButton.disabled) {
        createButton.style.backgroundColor = '#1976d2';
      }
    };

    // Cancel button
    const cancelButton = document.createElement('button');
    cancelButton.id = 'account-creation-cancel-button';
    cancelButton.type = 'button';
    cancelButton.textContent = 'Cancel';
    cancelButton.style.cssText = `
      padding: 10px 20px;
      background-color: #f5f5f5;
      color: #333;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 1em;
      flex: 1;
    `;
    cancelButton.onclick = () => {
      cleanupKeyboard();
      overlay.remove();
      resolve(null);
    };

    buttonContainer.appendChild(createButton);
    buttonContainer.appendChild(cancelButton);
    form.appendChild(buttonContainer);

    modal.appendChild(form);

    // Set up type/subtype relationship
    const updateSubtypeOptions = (typeName) => {
      const selectedTypeOption = accountTypeOptions.find((opt) => opt.type.name === typeName);
      if (selectedTypeOption && selectedTypeOption.type.possibleSubtypes) {
        const subtypes = selectedTypeOption.type.possibleSubtypes;
        updateSubtypeDropdown(subtypeGroup.select, subtypes, defaultSubtype);
      } else {
        updateSubtypeDropdown(subtypeGroup.select, [], null);
      }
    };

    // Initialize subtypes based on default type
    if (defaultType) {
      updateSubtypeOptions(defaultType);
    }

    // Update subtypes when type changes
    typeGroup.select.addEventListener('change', (e) => {
      updateSubtypeOptions(e.target.value);
    });

    // Form validation and submission
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      // Clear previous errors
      errorContainer.style.display = 'none';
      errorContainer.textContent = '';

      // Validate inputs
      const accountName = nameGroup.input.value.trim();
      const accountType = typeGroup.select.value;
      const accountSubtype = subtypeGroup.select.value;
      const initialBalance = parseFloat(balanceGroup.input.value) || 0;
      const includeInNetWorth = netWorthGroup.checkbox.checked;

      if (!accountName) {
        showError(errorContainer, 'Account name is required');
        return;
      }

      if (!accountType) {
        showError(errorContainer, 'Account type is required');
        return;
      }

      if (!accountSubtype) {
        showError(errorContainer, 'Account subtype is required');
        return;
      }

      // Disable button and show loading state
      createButton.disabled = true;
      createButton.style.opacity = '0.6';
      createButton.style.cursor = 'not-allowed';
      createButton.textContent = 'Creating...';

      try {
        debugLog('Creating manual account with:', {
          type: accountType,
          subtype: accountSubtype,
          name: accountName,
          displayBalance: initialBalance,
          includeInNetWorth,
        });

        // Create the account via Monarch API
        const accountId = await monarchApi.createManualAccount({
          type: accountType,
          subtype: accountSubtype,
          name: accountName,
          displayBalance: initialBalance,
          includeInNetWorth,
        });

        debugLog(`Successfully created account with ID: ${accountId}`);
        toast.show(`Created account "${accountName}"`, 'info');

        // Fetch the full account details to return
        const accounts = await monarchApi.listAccounts(accountType);
        const createdAccount = accounts.find((acc) => acc.id === accountId);

        if (createdAccount) {
          cleanupKeyboard();
          overlay.remove();
          resolve(createdAccount);
        } else {
          // Fallback: return minimal account object
          cleanupKeyboard();
          overlay.remove();
          resolve({
            id: accountId,
            displayName: accountName,
            type: { name: accountType },
            subtype: { name: accountSubtype },
          });
        }
      } catch (error) {
        debugLog('Failed to create account:', error);
        showError(errorContainer, `Failed to create account: ${error.message}`);

        // Re-enable button
        createButton.disabled = false;
        createButton.style.opacity = '1';
        createButton.style.cursor = 'pointer';
        createButton.textContent = 'Create';
      }
    });

    // Add keyboard handlers for the modal (Escape to close)
    cleanupKeyboard = addModalKeyboardHandlers(overlay, () => {
      cleanupKeyboard();
      overlay.remove();
      resolve(null);
    });

    // Show the modal
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Focus the first input
    setTimeout(() => {
      nameGroup.input.focus();
    }, 100);
  });
}

/**
 * Create a form group with label, input, and error container
 * @param {string} id - Input ID
 * @param {string} label - Label text
 * @param {string} type - Input type
 * @param {*} defaultValue - Default value
 * @param {string} placeholder - Placeholder text
 * @param {boolean} required - Whether field is required
 * @returns {Object} Object with container, label, input, and error elements
 */
function createFormGroup(id, label, type, defaultValue, placeholder, required = false) {
  const container = document.createElement('div');
  container.id = `${id}-group`;
  container.style.cssText = 'display: flex; flex-direction: column; gap: 5px;';

  const labelEl = document.createElement('label');
  labelEl.id = `${id}-label`;
  labelEl.htmlFor = id;
  labelEl.textContent = label;
  labelEl.style.cssText = 'font-weight: bold; font-size: 0.9em;';

  const input = document.createElement('input');
  input.id = id;
  input.type = type;
  input.value = defaultValue;
  input.placeholder = placeholder;
  input.required = required;
  input.style.cssText = `
    padding: 8px;
    border: 1px solid #ccc;
    border-radius: 4px;
    font-size: 1em;
  `;

  container.appendChild(labelEl);
  container.appendChild(input);

  return { container, label: labelEl, input };
}

/**
 * Create a checkbox form group
 * @param {string} id - Checkbox ID
 * @param {string} label - Label text
 * @param {boolean} defaultChecked - Default checked state
 * @returns {Object} Object with container, checkbox, and label elements
 */
function createCheckboxGroup(id, label, defaultChecked) {
  const container = document.createElement('div');
  container.id = `${id}-group`;
  container.style.cssText = 'display: flex; align-items: center; gap: 8px;';

  const checkbox = document.createElement('input');
  checkbox.id = id;
  checkbox.type = 'checkbox';
  checkbox.checked = defaultChecked;
  checkbox.style.cssText = 'width: 18px; height: 18px; cursor: pointer;';

  const labelEl = document.createElement('label');
  labelEl.id = `${id}-label`;
  labelEl.htmlFor = id;
  labelEl.textContent = label;
  labelEl.style.cssText = 'font-size: 0.9em; cursor: pointer;';

  container.appendChild(checkbox);
  container.appendChild(labelEl);

  return { container, checkbox, label: labelEl };
}

/**
 * Create a type dropdown
 * @param {string} id - Select ID
 * @param {string} label - Label text
 * @param {Array} accountTypeOptions - Account type options from Monarch
 * @param {string} defaultValue - Default selected value
 * @returns {Object} Object with container, label, and select elements
 */
function createTypeDropdown(id, label, accountTypeOptions, defaultValue) {
  const container = document.createElement('div');
  container.id = `${id}-group`;
  container.style.cssText = 'display: flex; flex-direction: column; gap: 5px;';

  const labelEl = document.createElement('label');
  labelEl.id = `${id}-label`;
  labelEl.htmlFor = id;
  labelEl.textContent = label;
  labelEl.style.cssText = 'font-weight: bold; font-size: 0.9em;';

  const select = document.createElement('select');
  select.id = id;
  select.required = true;
  select.style.cssText = `
    padding: 8px;
    border: 1px solid #ccc;
    border-radius: 4px;
    font-size: 1em;
  `;

  // Add placeholder option
  const placeholderOption = document.createElement('option');
  placeholderOption.value = '';
  placeholderOption.textContent = 'Select account type...';
  placeholderOption.disabled = true;
  placeholderOption.selected = !defaultValue;
  select.appendChild(placeholderOption);

  // Sort account types alphabetically by display name
  const sortedAccountTypes = [...accountTypeOptions].sort((a, b) =>
    a.type.display.localeCompare(b.type.display),
  );

  // Add type options
  sortedAccountTypes.forEach((typeOption) => {
    const option = document.createElement('option');
    option.value = typeOption.type.name;
    option.textContent = typeOption.type.display;
    option.selected = typeOption.type.name === defaultValue;
    select.appendChild(option);
  });

  container.appendChild(labelEl);
  container.appendChild(select);

  return { container, label: labelEl, select };
}

/**
 * Create a subtype dropdown
 * @param {string} id - Select ID
 * @param {string} label - Label text
 * @param {Array} _subtypes - Subtype options (unused in initial creation)
 * @param {string} _defaultValue - Default selected value (unused in initial creation)
 * @returns {Object} Object with container, label, and select elements
 */
function createSubtypeDropdown(id, label, _subtypes, _defaultValue) {
  const container = document.createElement('div');
  container.id = `${id}-group`;
  container.style.cssText = 'display: flex; flex-direction: column; gap: 5px;';

  const labelEl = document.createElement('label');
  labelEl.id = `${id}-label`;
  labelEl.htmlFor = id;
  labelEl.textContent = label;
  labelEl.style.cssText = 'font-weight: bold; font-size: 0.9em;';

  const select = document.createElement('select');
  select.id = id;
  select.required = true;
  select.style.cssText = `
    padding: 8px;
    border: 1px solid #ccc;
    border-radius: 4px;
    font-size: 1em;
  `;

  // Add placeholder
  const placeholderOption = document.createElement('option');
  placeholderOption.value = '';
  placeholderOption.textContent = 'Select account subtype...';
  placeholderOption.disabled = true;
  placeholderOption.selected = true;
  select.appendChild(placeholderOption);

  container.appendChild(labelEl);
  container.appendChild(select);

  return { container, label: labelEl, select };
}

/**
 * Update subtype dropdown options
 * @param {HTMLSelectElement} select - Select element to update
 * @param {Array} subtypes - New subtype options
 * @param {string} defaultValue - Value to select by default
 */
function updateSubtypeDropdown(select, subtypes, defaultValue) {
  // Clear existing options
  select.innerHTML = '';

  // Add placeholder
  const placeholderOption = document.createElement('option');
  placeholderOption.value = '';
  placeholderOption.textContent = 'Select account subtype...';
  placeholderOption.disabled = true;
  placeholderOption.selected = !defaultValue;
  select.appendChild(placeholderOption);

  // Sort subtypes alphabetically by display name
  const sortedSubtypes = [...subtypes].sort((a, b) =>
    a.display.localeCompare(b.display),
  );

  // Add subtype options
  sortedSubtypes.forEach((subtype) => {
    const option = document.createElement('option');
    option.value = subtype.name;
    option.textContent = subtype.display;
    option.selected = subtype.name === defaultValue;
    select.appendChild(option);
  });
}

/**
 * Show error message
 * @param {HTMLElement} errorContainer - Error container element
 * @param {string} message - Error message
 */
function showError(errorContainer, message) {
  errorContainer.textContent = message;
  errorContainer.style.display = 'block';
}

/**
 * Create a modal overlay
 * @param {Function} onClose - Function to call when clicking outside
 * @returns {HTMLElement} Overlay element
 */
function createModalOverlay(onClose) {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
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

  overlay.onclick = (e) => {
    if (e.target === overlay) {
      onClose();
    }
  };

  return overlay;
}

export default {
  showAccountCreationDialog,
};
