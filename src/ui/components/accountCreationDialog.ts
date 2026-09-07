/**
 * Account Creation Dialog Component
 * Single-form dialog for creating new Monarch accounts
 */

import { debugLog } from '../../core/utils';
import monarchApi from '../../api/monarch';
import { getHouseholdMembers, type HouseholdMember } from '../../api/monarchHousehold';
import { CARDHOLDER } from '../../core/config';
import { isOwnerMappingAvailable } from '../../core/markerTags';
import toast from '../toast';
import { addModalKeyboardHandlers } from '../keyboardNavigation';

interface AccountCreationOptions {
  defaultName?: string;
  defaultType?: string | null;
  defaultSubtype?: string | null;
  defaultBalance?: number;
  defaultIncludeInNetWorth?: boolean;
  trackingMethod?: 'balance' | 'holdings';
  /**
   * Whether the source integration exposes a cardholder name on its
   * transactions (the `hasCardholders` capability).
   *
   * A **capability flag, not an integration id**, on purpose: this dialog is
   * generic Monarch-account UI and has no business knowing about Rogers or
   * MBNA. The caller resolves the capability and passes the answer.
   */
  supportsCardholders?: boolean;
}

/**
 * Sentinel `<option>` value for the Shared choice.
 *
 * Monarch models a shared account as `ownerUserId: null`, so this maps to "send
 * no owner" rather than to any member id. An empty string keeps it distinct from
 * every real user id.
 */
const SHARED_OWNER_VALUE = '';

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
  /**
   * Cardholder sync choices, present only when `supportsCardholders` was set.
   *
   * **Reported, not persisted.** These settings live on the *source* account
   * entry, and this dialog only knows the Monarch account it just created — it
   * has neither the integration id nor the source account id. The caller
   * (which has both, and is already building an `upsertAccount` payload) folds
   * these in, so persistence stays in the service layer where it belongs.
   */
  cardholderOwnerMode?: string;
  cardholderTagMode?: string;
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

/** The cardholder sync controls and a reader for their current values */
interface CardholderSectionResult {
  container: HTMLDivElement;
  ownerToggle: HTMLInputElement;
  tagSelect: HTMLSelectElement;
  /** Current choices, in the shape the account entry stores */
  readValues: () => { cardholderOwnerMode: string; cardholderTagMode: string };
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
    supportsCardholders = false,
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

  // Fetch household members for the owner dropdown.
  //
  // Non-fatal by design: account creation is the user's actual goal, so a
  // household fetch failure omits the dropdown rather than blocking them. The
  // owner can always be set in Monarch afterwards. A single-member household
  // gets no dropdown either — there is nothing to choose between.
  let householdMembers: HouseholdMember[] = [];
  try {
    const household = await getHouseholdMembers();
    householdMembers = household.members || [];
    debugLog(`Fetched ${householdMembers.length} household member(s) for the owner selector`);
  } catch (error) {
    debugLog('Could not fetch household members, omitting the owner selector:', error);
  }

  // Owner mapping needs 2+ members to mean anything; the rule is shared with the
  // settings widget so the two cannot disagree about when it is offered.
  const ownerMappingAvailable = isOwnerMappingAvailable(householdMembers.length);
  const showOwnerSelector = ownerMappingAvailable;

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

    // Account Owner dropdown — Shared by default, matching Monarch's own default
    let ownerGroup: DropdownGroupResult | null = null;
    if (showOwnerSelector) {
      ownerGroup = createOwnerDropdown('account-owner', 'Account Owner:', householdMembers);
      form.appendChild(ownerGroup.container);
    }

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

    // Cardholder sync section — only for integrations that expose a cardholder
    // name. Rendered before balance so the ownership-related fields sit together.
    let cardholderGroup: CardholderSectionResult | null = null;
    if (supportsCardholders) {
      cardholderGroup = createCardholderSection(ownerMappingAvailable);
      form.appendChild(cardholderGroup.container);
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

        // Apply the chosen owner. Shared needs no call — Monarch's default for a
        // new account is already shared (ownerUserId: null).
        const selectedOwnerUserId = ownerGroup?.select.value || SHARED_OWNER_VALUE;
        if (selectedOwnerUserId !== SHARED_OWNER_VALUE) {
          const applied = await assignAccountOwner(accountId, selectedOwnerUserId);
          if (!applied) {
            toast.show(
              'Account created, but the owner could not be set. You can set it in Monarch.',
              'warning',
            );
          }
        }

        // Fetch the full account details to return
        const accounts = await monarchApi.listAccounts(accountType) as unknown as Array<Record<string, unknown>>;
        const createdAccount = accounts.find((acc) => acc.id === accountId);

        // Cardholder choices are REPORTED, not saved: they belong on the source
        // account entry, whose id this dialog does not know. The caller folds
        // them into the mapping write it is already performing.
        const cardholderChoices = cardholderGroup?.readValues() ?? {};

        if (createdAccount) {
          cleanupKeyboard();
          overlay.remove();
          // Add newlyCreated flag so callers can set institution-specific logos
          // For holdings mode, include manualInvestmentsTrackingMethod for position sync support
          resolve({
            ...createdAccount,
            newlyCreated: true,
            ...(isHoldingsMode && { manualInvestmentsTrackingMethod: 'holdings' }),
            ...cardholderChoices,
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
            ...cardholderChoices,
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
 * Create the account owner dropdown.
 *
 * Monarch models account ownership as either a specific household member or
 * **Shared** (`ownerUserId: null`), and Shared is Monarch's own default — so
 * Shared is pre-selected here and requires no follow-up call.
 *
 * Members are listed by `displayName`, which is the label Monarch's UI shows.
 * (Contrast the cardholder→transaction mapping, which caches `name`; here the
 * value sent is the member **id**, so the label is purely cosmetic.)
 */
function createOwnerDropdown(
  id: string,
  label: string,
  members: HouseholdMember[],
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
  select.style.cssText = `
    padding: 8px;
    border: 1px solid var(--mu-input-border, #ccc);
    border-radius: 4px;
    font-size: 1em;
    background: var(--mu-input-bg, white);
    color: var(--mu-text-primary, #333);
  `;

  // Shared first and pre-selected — matches Monarch's default for new accounts
  const sharedOption = document.createElement('option');
  sharedOption.value = SHARED_OWNER_VALUE;
  sharedOption.textContent = CARDHOLDER.SHARED_OWNER;
  sharedOption.selected = true;
  select.appendChild(sharedOption);

  [...members]
    .sort((a, b) => (a.displayName || a.name || '').localeCompare(b.displayName || b.name || ''))
    .forEach((member) => {
      const option = document.createElement('option');
      option.value = member.id;
      option.textContent = member.displayName || member.name || member.id;
      select.appendChild(option);
    });

  const hint = document.createElement('div');
  hint.id = `${id}-hint`;
  hint.style.cssText = 'font-size: 0.8em; color: var(--mu-text-secondary, #666);';
  hint.textContent = 'Transactions in this account inherit this owner unless set individually.';

  container.appendChild(labelEl);
  container.appendChild(select);
  container.appendChild(hint);

  return { container, label: labelEl, select };
}

/**
 * Create the cardholder sync section.
 *
 * Two independent controls, both defaulting to off so nothing changes for a user
 * who ignores them:
 *
 * - **owner mapping** — a toggle, *disabled with a hint* when the household has
 *   fewer than two members, since assigning every transaction to the only member
 *   is exactly what the account-level owner already does
 * - **cardholder tag** — always available; labelling who spent what is useful
 *   even in a single-member household
 *
 * @param ownerMappingAvailable - Whether the household supports owner mapping
 */
function createCardholderSection(ownerMappingAvailable: boolean): CardholderSectionResult {
  const container = document.createElement('div');
  container.id = 'cardholder-sync-section';
  container.style.cssText = 'display: flex; flex-direction: column; gap: 12px; '
    + 'padding: 12px; border: 1px solid var(--mu-input-border, #ddd); border-radius: 6px;';

  const heading = document.createElement('div');
  heading.id = 'cardholder-sync-heading';
  heading.textContent = 'Cardholder sync';
  heading.style.cssText = 'font-weight: bold; font-size: 0.9em;';
  container.appendChild(heading);

  const intro = document.createElement('div');
  intro.id = 'cardholder-sync-intro';
  intro.style.cssText = 'font-size: 0.8em; color: var(--mu-text-secondary, #666);';
  intro.textContent = 'This card reports who made each purchase. You can change these later in settings.';
  container.appendChild(intro);

  // ── Owner mapping toggle ──────────────────────────────────
  const ownerRow = document.createElement('div');
  ownerRow.id = 'cardholder-owner-mode-group';
  ownerRow.style.cssText = 'display: flex; flex-direction: column; gap: 4px;';

  const ownerLabelRow = document.createElement('div');
  ownerLabelRow.style.cssText = 'display: flex; align-items: center; gap: 8px;';

  const ownerToggle = document.createElement('input');
  ownerToggle.id = 'cardholder-owner-mode';
  ownerToggle.type = 'checkbox';
  ownerToggle.checked = false;
  ownerToggle.disabled = !ownerMappingAvailable;
  ownerToggle.style.cssText = `width: 18px; height: 18px; cursor: ${ownerMappingAvailable ? 'pointer' : 'not-allowed'};`;

  const ownerLabel = document.createElement('label');
  ownerLabel.id = 'cardholder-owner-mode-label';
  ownerLabel.htmlFor = ownerToggle.id;
  ownerLabel.textContent = 'Set transaction owner from cardholder';
  const ownerLabelCursor = ownerMappingAvailable ? 'pointer' : 'default';
  const ownerLabelDimming = ownerMappingAvailable ? '' : ' opacity: 0.6;';
  ownerLabel.style.cssText = `font-size: 0.9em; cursor: ${ownerLabelCursor};${ownerLabelDimming}`;

  ownerLabelRow.appendChild(ownerToggle);
  ownerLabelRow.appendChild(ownerLabel);
  ownerRow.appendChild(ownerLabelRow);

  const ownerHint = document.createElement('div');
  ownerHint.id = 'cardholder-owner-mode-hint';
  ownerHint.style.cssText = 'font-size: 0.8em; color: var(--mu-text-secondary, #666); padding-left: 26px;';
  ownerHint.textContent = ownerMappingAvailable
    ? 'Assigns each transaction to the matching Monarch household member.'
    : 'Not available for single-member households — the account owner already covers this.';
  ownerRow.appendChild(ownerHint);

  container.appendChild(ownerRow);

  // ── Cardholder tag select ─────────────────────────────────
  const tagRow = document.createElement('div');
  tagRow.id = 'cardholder-tag-mode-group';
  tagRow.style.cssText = 'display: flex; flex-direction: column; gap: 4px;';

  const tagLabel = document.createElement('label');
  tagLabel.id = 'cardholder-tag-mode-label';
  tagLabel.htmlFor = 'cardholder-tag-mode';
  tagLabel.textContent = 'Tag transactions with cardholder';
  tagLabel.style.cssText = 'font-size: 0.9em;';

  const tagSelect = document.createElement('select');
  tagSelect.id = 'cardholder-tag-mode';
  tagSelect.style.cssText = 'padding: 6px; border: 1px solid var(--mu-input-border, #ccc); '
    + 'border-radius: 4px; font-size: 0.9em; background: var(--mu-input-bg, white); '
    + 'color: var(--mu-text-primary, #333);';

  [
    { value: CARDHOLDER.TAG_MODE.OFF, label: 'Off' },
    { value: CARDHOLDER.TAG_MODE.AUTO, label: 'Auto' },
    { value: CARDHOLDER.TAG_MODE.ALWAYS, label: 'Always' },
  ].forEach(({ value, label }) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    option.selected = value === CARDHOLDER.TAG_MODE.OFF;
    tagSelect.appendChild(option);
  });

  const tagHint = document.createElement('div');
  tagHint.id = 'cardholder-tag-mode-hint';
  tagHint.style.cssText = 'font-size: 0.8em; color: var(--mu-text-secondary, #666);';
  tagHint.textContent = '"Auto" only tags once two or more cardholders have been detected.';

  tagRow.appendChild(tagLabel);
  tagRow.appendChild(tagSelect);
  tagRow.appendChild(tagHint);

  container.appendChild(tagRow);

  return {
    container,
    ownerToggle,
    tagSelect,
    readValues: () => ({
      // A disabled toggle can never be checked, so this stays 'off' for a
      // single-member household without a separate guard.
      cardholderOwnerMode: ownerToggle.checked
        ? CARDHOLDER.OWNER_MODE.ON
        : CARDHOLDER.OWNER_MODE.OFF,
      cardholderTagMode: tagSelect.value || CARDHOLDER.TAG_MODE.OFF,
    }),
  };
}

/**
 * Assign an owner to a freshly created account.
 *
 * A separate call because `CreateManualAccountMutationInput` has no owner field —
 * only `updateAccount` accepts `ownerUserId`.
 *
 * Non-fatal: the account already exists and that was the user's goal, so a
 * failure here warns rather than throws. The result is verified against the
 * returned `ownedByUser` because the mutation reports field errors in its
 * payload rather than by rejecting.
 *
 * @returns True when the owner was applied and verified
 */
async function assignAccountOwner(accountId: string, ownerUserId: string): Promise<boolean> {
  try {
    const updated = await monarchApi.updateAccount({ id: accountId, ownerUserId });

    if (updated?.ownedByUser?.id === ownerUserId) {
      debugLog(`Assigned owner ${ownerUserId} to account ${accountId}`);
      return true;
    }

    debugLog('Owner assignment did not take effect', {
      accountId,
      requested: ownerUserId,
      actual: updated?.ownedByUser?.id ?? null,
    });
    return false;
  } catch (error) {
    debugLog(`Failed to assign owner to account ${accountId}:`, error);
    return false;
  }
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

