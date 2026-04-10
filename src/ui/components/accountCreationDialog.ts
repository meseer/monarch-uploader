/**
 * Account Creation Dialog Component
 * Single-form dialog for creating new Monarch accounts
 */

import { debugLog } from '../../core/utils';
import monarchApi from '../../api/monarch';
import toast from '../toast';
import { addModalKeyboardHandlers } from '../keyboardNavigation';

interface AccountCreationOptions {
  defaultName?: string;
  defaultType?: string | null;
  defaultSubtype?: string | null;
  defaultBalance?: number;
  defaultIncludeInNetWorth?: boolean;
  trackingMethod?: 'balance' | 'holdings';
}

interface AccountSubtype {
  name: string;
  display: string;
}

interface AccountType {
  name: string;
  display: string;
  possibleSubtypes?: AccountSubtype[];
}

interface AccountTypeOption {
  type: AccountType;
}

interface CreatedAccount {
  id: string;
  displayName?: string;
  type?: { name: string };
  subtype?: { name: string };
  newlyCreated: boolean;
  manualInvestmentsTrackingMethod?: string;
  [key: string]: unknown;
}

interface FormGroupResult {
  container: HTMLDivElement;
  label: HTMLLabelElement;
  input: HTMLInputElement;
}

interface CheckboxGroupResult {
  container: HTMLDivElement;
  checkbox: HTMLInputElement;
  label: HTMLLabelElement;
}

interface DropdownGroupResult {
  container: HTMLDivElement;
  label: HTMLLabelElement;
  select: HTMLSelectElement;
}

/**
 * Show account creation dialog
 */
export async function showAccountCreationDialog(
  options: AccountCreationOptions = {},
): Promise<CreatedAccount | null> {
  const {
    defaultName = '',
    defaultType = null,
    defaultSubtype = null,
    defaultBalance = 0,
    defaultIncludeInNetWorth = true,
    trackingMethod = 'balance',
  } = options;

  const isHoldingsMode = trackingMethod === 'holdings';

  debugLog('Opening account creation dialog with defaults:', {
    defaultName,
    defaultType,
    defaultSubtype,
    defaultBalance,
    defaultIncludeInNetWorth,
  });

  // Fetch account type options from Monarch
  let accountTypeOptions: AccountTypeOption[];
  try {
    accountTypeOptions = await monarchApi.getAccountTypeOptions() as AccountTypeOption[];
    debugLog(`Fetched ${accountTypeOptions.length} account type options from Monarch`);
  } catch (error) {
    debugLog('Failed to fetch account type options:', error);
    toast.show('Failed to load account types from Monarch', 'error');
    return null;
  }

  return new Promise((resolve) => {
    // Set up keyboard navigation cleanup function
    let cleanupKeyboard = (): void => {};

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
      background: var(--mu-bg-primary, white);
      color: var(--mu-text-primary, #333);
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
    header.textContent = isHoldingsMode
      ? 'Create New Investment Account (Track Holdings)'
      : 'Create New Monarch Account';
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

    // Initial Balance field (round to 2 decimal places) - hidden in holdings mode
    let balanceGroup: FormGroupResult | null = null;
    if (!isHoldingsMode) {
      const roundedBalance = typeof defaultBalance === 'number'
        ? Math.round(defaultBalance * 100) / 100
        : defaultBalance;
      balanceGroup = createFormGroup(
        'account-balance',
        'Initial Balance:',
        'number',
        roundedBalance,
        '0.00',
        true,
      );
      balanceGroup.input.step = '0.01';
      form.appendChild(balanceGroup.container);
    }

    // Include in Net Worth checkbox - hidden in holdings mode (always true for holdings accounts)
    let netWorthGroup: CheckboxGroupResult | null = null;
    if (!isHoldingsMode) {
      netWorthGroup = createCheckboxGroup(
        'account-net-worth',
        'Include in net worth',
        defaultIncludeInNetWorth,
      );
      form.appendChild(netWorthGroup.container);
    }

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
      background-color: var(--mu-cancel-btn-bg, #f5f5f5);
      color: var(--mu-cancel-btn-text, #333);
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
    const updateSubtypeOptions = (typeName: string): void => {
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
    typeGroup.select.addEventListener('change', (e: Event) => {
      updateSubtypeOptions((e.target as HTMLSelectElement).value);
    });

    // Form validation and submission
    form.addEventListener('submit', async (e: Event) => {
      e.preventDefault();

      // Clear previous errors
      errorContainer.style.display = 'none';
      errorContainer.textContent = '';

      // Validate inputs
      const accountName = nameGroup.input.value.trim();
      const accountType = typeGroup.select.value;
      const accountSubtype = subtypeGroup.select.value;
      const initialBalance = balanceGroup ? (parseFloat(balanceGroup.input.value) || 0) : 0;
      const includeInNetWorth = netWorthGroup ? netWorthGroup.checkbox.checked : true;

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
        let accountId: string;

        if (isHoldingsMode) {
          debugLog('Creating manual investments account with:', {
            name: accountName,
            subtype: accountSubtype,
          });

          // Create investments account with holdings tracking via Monarch API
          accountId = await monarchApi.createManualInvestmentsAccount({
            name: accountName,
            subtype: accountSubtype,
          }) as string;

          debugLog(`Successfully created investments account with ID: ${accountId}`);
          toast.show(`Created investment account "${accountName}" (Track Holdings)`, 'info');
        } else {
          debugLog('Creating manual account with:', {
            type: accountType,
            subtype: accountSubtype,
            name: accountName,
            displayBalance: initialBalance,
            includeInNetWorth,
          });

          // Create the account via Monarch API
          accountId = await monarchApi.createManualAccount({
            type: accountType,
            subtype: accountSubtype,
            name: accountName,
            displayBalance: initialBalance,
            includeInNetWorth,
          }) as string;

          debugLog(`Successfully created account with ID: ${accountId}`);
          toast.show(`Created account "${accountName}"`, 'info');
        }

        // Fetch the full account details to return
        const accounts = await monarchApi.listAccounts(accountType) as unknown as Array<Record<string, unknown>>;
        const createdAccount = accounts.find((acc) => acc.id === accountId);

        if (createdAccount) {
          cleanupKeyboard();
          overlay.remove();
          // Add newlyCreated flag so callers can set institution-specific logos
          // For holdings mode, include manualInvestmentsTrackingMethod for position sync support
          resolve({
            ...createdAccount,
            newlyCreated: true,
            ...(isHoldingsMode && { manualInvestmentsTrackingMethod: 'holdings' }),
          } as CreatedAccount);
        } else {
          // Fallback: return minimal account object
          cleanupKeyboard();
          overlay.remove();
          // For holdings mode, include manualInvestmentsTrackingMethod for position sync support
          resolve({
            id: accountId,
            displayName: accountName,
            type: { name: accountType },
            subtype: { name: accountSubtype },
            newlyCreated: true,
            ...(isHoldingsMode && { manualInvestmentsTrackingMethod: 'holdings' }),
          });
        }
      } catch (error) {
        debugLog('Failed to create account:', error);
        showError(errorContainer, `Failed to create account: ${(error as Error).message}`);

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
 */
function createFormGroup(
  id: string,
  label: string,
  type: string,
  defaultValue: string | number,
  placeholder: string,
  required = false,
): FormGroupResult {
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
  input.value = String(defaultValue);
  input.placeholder = placeholder;
  input.required = required;
  input.style.cssText = `
    padding: 8px;
    border: 1px solid var(--mu-input-border, #ccc);
    border-radius: 4px;
    font-size: 1em;
    background: var(--mu-input-bg, white);
    color: var(--mu-text-primary, #333);
  `;

  container.appendChild(labelEl);
  container.appendChild(input);

  return { container, label: labelEl, input };
}

/**
 * Create a checkbox form group
 */
function createCheckboxGroup(
  id: string,
  label: string,
  defaultChecked: boolean,
): CheckboxGroupResult {
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
 */
function createTypeDropdown(
  id: string,
  label: string,
  accountTypeOptions: AccountTypeOption[],
  defaultValue: string | null,
): DropdownGroupResult {
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
    border: 1px solid var(--mu-input-border, #ccc);
    border-radius: 4px;
    font-size: 1em;
    background: var(--mu-input-bg, white);
    color: var(--mu-text-primary, #333);
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
 */
function createSubtypeDropdown(
  id: string,
  label: string,
  _subtypes: AccountSubtype[],
  _defaultValue: string | null,
): DropdownGroupResult {
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
    border: 1px solid var(--mu-input-border, #ccc);
    border-radius: 4px;
    font-size: 1em;
    background: var(--mu-input-bg, white);
    color: var(--mu-text-primary, #333);
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
 */
function updateSubtypeDropdown(
  select: HTMLSelectElement,
  subtypes: AccountSubtype[],
  defaultValue: string | null,
): void {
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
 */
function showError(errorContainer: HTMLElement, message: string): void {
  errorContainer.textContent = message;
  errorContainer.style.display = 'block';
}

/**
 * Create a modal overlay
 */
function createModalOverlay(onClose: () => void): HTMLDivElement {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
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

  overlay.onclick = (e: MouseEvent) => {
    if (e.target === overlay) {
      onClose();
    }
  };

  return overlay;
}

