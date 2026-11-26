/**
 * Closed Accounts Dialog Component
 * Reusable modal prompting the user to mark missing/orphaned accounts as closed
 */

import { addModalKeyboardHandlers } from '../keyboardNavigation';

const DATE_YMD_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export interface ClosedAccountCandidate {
  id: string;
  name: string;
  shortName?: string;
  monarchAccountName?: string | null;
  lastSyncDate?: string | null;
}

export interface ClosedAccountsDialogOptions {
  title: string;
  description: string;
  note?: string;
  accounts: ClosedAccountCandidate[];
  defaultClosedDate: string;
  closedDateHint?: string;
  defaultCloseInMonarch?: boolean;
}

export interface ClosedAccountsDialogResult {
  confirmed: boolean;
  selectedAccountIds: string[];
  closeInMonarch: boolean;
  closedDate: string;
}

interface DialogController {
  overlay: HTMLDivElement;
  confirmBtn: HTMLButtonElement;
  accountCheckboxes: Map<string, HTMLInputElement>;
  dateInput: HTMLInputElement;
  monarchCheckbox: HTMLInputElement | null;
  updateConfirmState: () => void;
}

function createDialogHeader(modal: HTMLDivElement, titleText: string, descriptionText: string): void {
  const title = document.createElement('h2');
  title.id = 'closed-accounts-dialog-title';
  title.textContent = titleText;
  title.style.cssText = 'margin: 0 0 10px 0; font-size: 1.2em; color: var(--mu-text-primary, #333);';
  modal.appendChild(title);

  const description = document.createElement('p');
  description.id = 'closed-accounts-dialog-description';
  description.textContent = descriptionText;
  description.style.cssText = 'margin: 0 0 16px 0; font-size: 0.95em; line-height: 1.45; color: var(--mu-text-secondary, #555);';
  modal.appendChild(description);
}

function createAccountChecklistItem(
  account: ClosedAccountCandidate,
  onToggle: () => void,
): { row: HTMLLabelElement; checkbox: HTMLInputElement } {
  const row = document.createElement('label');
  row.id = `closed-accounts-item-${account.id}`;
  row.style.cssText = `
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 12px;
    border: 1px solid var(--mu-border, #e0e0e0);
    border-radius: 6px;
    background: var(--mu-bg-secondary, #f8f9fa);
    cursor: pointer;
  `;

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.id = `closed-accounts-checkbox-${account.id}`;
  checkbox.checked = true;
  checkbox.style.cssText = 'margin-top: 3px; cursor: pointer;';
  checkbox.addEventListener('change', onToggle);

  const info = document.createElement('div');
  info.style.cssText = 'display: flex; flex-direction: column; gap: 2px; flex: 1;';

  const name = document.createElement('div');
  name.id = `closed-accounts-name-${account.id}`;
  name.textContent = account.shortName && account.shortName !== account.name
    ? `${account.name} (${account.shortName})`
    : account.name;
  name.style.cssText = 'font-weight: 600; font-size: 0.95em; color: var(--mu-text-primary, #333);';
  info.appendChild(name);

  const metaParts: string[] = [];
  if (account.monarchAccountName) {
    metaParts.push(`Monarch: ${account.monarchAccountName}`);
  } else {
    metaParts.push('Not mapped to Monarch');
  }
  if (account.lastSyncDate) {
    metaParts.push(`Last synced: ${account.lastSyncDate}`);
  }

  const meta = document.createElement('div');
  meta.id = `closed-accounts-meta-${account.id}`;
  meta.textContent = metaParts.join(' · ');
  meta.style.cssText = 'font-size: 0.82em; color: var(--mu-text-secondary, #666);';
  info.appendChild(meta);

  row.appendChild(checkbox);
  row.appendChild(info);
  return { row, checkbox };
}

function createClosureDateSection(
  defaultDate: string,
  hint: string | undefined,
  onChange: () => void,
): { container: HTMLDivElement; dateInput: HTMLInputElement } {
  const container = document.createElement('div');
  container.id = 'closed-accounts-date-container';
  container.style.cssText = `
    padding: 10px 12px;
    margin-bottom: 12px;
    border: 1px solid var(--mu-border, #e0e0e0);
    border-radius: 6px;
    background: var(--mu-bg-primary, #fff);
  `;

  const row = document.createElement('div');
  row.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 12px;';

  const label = document.createElement('label');
  label.id = 'closed-accounts-date-label';
  label.htmlFor = 'closed-accounts-date-input';
  label.textContent = 'Closure Date:';
  label.style.cssText = 'font-weight: 500; font-size: 0.92em; color: var(--mu-text-primary, #333);';

  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.id = 'closed-accounts-date-input';
  dateInput.value = defaultDate;
  dateInput.style.cssText = 'padding: 6px 8px; border: 1px solid var(--mu-input-border, #ccc); border-radius: 4px; font-size: 0.9em; background: var(--mu-input-bg, white); color: var(--mu-text-primary, #333);';
  dateInput.addEventListener('input', onChange);
  dateInput.addEventListener('change', onChange);

  row.appendChild(label);
  row.appendChild(dateInput);
  container.appendChild(row);

  if (hint) {
    const hintDiv = document.createElement('div');
    hintDiv.id = 'closed-accounts-date-hint';
    hintDiv.textContent = hint;
    hintDiv.style.cssText = 'font-size: 0.8em; color: var(--mu-text-secondary, #666); margin-top: 6px; line-height: 1.35;';
    container.appendChild(hintDiv);
  }

  return { container, dateInput };
}

function createMonarchCloseOption(defaultChecked: boolean): {
  container: HTMLLabelElement;
  checkbox: HTMLInputElement;
} {
  const container = document.createElement('label');
  container.id = 'closed-accounts-monarch-option';
  container.style.cssText = `
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 12px;
    margin-bottom: 14px;
    border: 1px solid var(--mu-border, #e0e0e0);
    border-radius: 6px;
    background: var(--mu-bg-primary, #fff);
    cursor: pointer;
  `;

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.id = 'closed-accounts-monarch-checkbox';
  checkbox.checked = defaultChecked;
  checkbox.style.cssText = 'margin-top: 3px; cursor: pointer;';

  const textContainer = document.createElement('div');
  textContainer.style.cssText = 'display: flex; flex-direction: column; gap: 2px;';

  const label = document.createElement('div');
  label.id = 'closed-accounts-monarch-label';
  label.textContent = 'Also close selected account(s) in Monarch and set balance to $0';
  label.style.cssText = 'font-weight: 500; font-size: 0.92em; color: var(--mu-text-primary, #333);';

  const subtext = document.createElement('div');
  subtext.id = 'closed-accounts-monarch-subtext';
  subtext.textContent = 'Marks the account as closed in Monarch as of the closure date above and sets its balance to $0.';
  subtext.style.cssText = 'font-size: 0.8em; color: var(--mu-text-secondary, #666);';

  textContainer.appendChild(label);
  textContainer.appendChild(subtext);
  container.appendChild(checkbox);
  container.appendChild(textContainer);
  return { container, checkbox };
}

function createDialogButtons(
  onCancel: () => void,
  onConfirm: () => void,
): { container: HTMLDivElement; confirmBtn: HTMLButtonElement } {
  const container = document.createElement('div');
  container.id = 'closed-accounts-dialog-buttons';
  container.style.cssText = 'display: flex; gap: 10px; justify-content: flex-end; margin-top: 8px;';

  const skipBtn = document.createElement('button');
  skipBtn.id = 'closed-accounts-dialog-skip-button';
  skipBtn.type = 'button';
  skipBtn.textContent = 'Skip for Now';
  skipBtn.style.cssText = `
    padding: 9px 16px;
    background-color: var(--mu-bg-tertiary, #f5f5f5);
    color: var(--mu-text-primary, #333);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.92em;
  `;
  skipBtn.addEventListener('click', onCancel);

  const confirmBtn = document.createElement('button');
  confirmBtn.id = 'closed-accounts-dialog-confirm-button';
  confirmBtn.type = 'button';
  confirmBtn.textContent = 'Mark Selected as Closed';
  confirmBtn.style.cssText = `
    padding: 9px 16px;
    background-color: #d32f2f;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.92em;
    font-weight: 600;
  `;
  confirmBtn.addEventListener('click', onConfirm);

  container.appendChild(skipBtn);
  container.appendChild(confirmBtn);
  return { container, confirmBtn };
}

function buildClosedAccountsDialog(
  options: ClosedAccountsDialogOptions,
  onCancel: () => void,
  onConfirm: () => void,
): DialogController {
  const overlay = document.createElement('div');
  overlay.id = 'closed-accounts-dialog-overlay';
  overlay.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background-color: var(--mu-overlay-bg, rgba(0, 0, 0, 0.55));
    display: flex; justify-content: center; align-items: center; z-index: 10000;
  `;

  const modal = document.createElement('div');
  modal.id = 'closed-accounts-dialog-modal';
  modal.style.cssText = `
    background: var(--mu-bg-primary, white); color: var(--mu-text-primary, #333);
    padding: 24px; border-radius: 8px; width: 92%; max-width: 500px;
    max-height: 85vh; overflow-y: auto; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  `;

  createDialogHeader(modal, options.title, options.description);

  const list = document.createElement('div');
  list.id = 'closed-accounts-dialog-list';
  list.style.cssText = 'display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px;';

  const accountCheckboxes = new Map<string, HTMLInputElement>();
  let confirmBtn!: HTMLButtonElement;
  let dateInput!: HTMLInputElement;
  const updateConfirmState = () => {
    const anyChecked = Array.from(accountCheckboxes.values()).some((cb) => cb.checked);
    const hasValidDate = DATE_YMD_REGEX.test(dateInput.value);
    const canConfirm = anyChecked && hasValidDate;
    confirmBtn.disabled = !canConfirm;
    confirmBtn.style.opacity = canConfirm ? '1' : '0.5';
    confirmBtn.style.cursor = canConfirm ? 'pointer' : 'not-allowed';
  };

  options.accounts.forEach((acc) => {
    const { row, checkbox } = createAccountChecklistItem(acc, updateConfirmState);
    accountCheckboxes.set(acc.id, checkbox);
    list.appendChild(row);
  });
  modal.appendChild(list);

  const dateSection = createClosureDateSection(options.defaultClosedDate, options.closedDateHint, updateConfirmState);
  dateInput = dateSection.dateInput;
  modal.appendChild(dateSection.container);

  const hasMonarchMappings = options.accounts.some((acc) => Boolean(acc.monarchAccountName));
  let monarchCheckbox: HTMLInputElement | null = null;
  if (hasMonarchMappings) {
    const monarchOption = createMonarchCloseOption(options.defaultCloseInMonarch !== false);
    monarchCheckbox = monarchOption.checkbox;
    modal.appendChild(monarchOption.container);
  }

  if (options.note) {
    const noteDiv = document.createElement('div');
    noteDiv.id = 'closed-accounts-dialog-note';
    noteDiv.textContent = options.note;
    noteDiv.style.cssText = 'font-size: 0.82em; color: var(--mu-text-secondary, #666); margin-bottom: 14px; line-height: 1.4;';
    modal.appendChild(noteDiv);
  }

  const buttons = createDialogButtons(onCancel, onConfirm);
  confirmBtn = buttons.confirmBtn;
  modal.appendChild(buttons.container);
  overlay.appendChild(modal);
  updateConfirmState();

  return {
    overlay, confirmBtn, accountCheckboxes, dateInput, monarchCheckbox, updateConfirmState,
  };
}

/**
 * Show a modal asking the user which missing/orphaned accounts should be marked closed.
 * @param options - Dialog title, description, candidate accounts, and defaults
 * @returns Selection result with confirmed status, selected account IDs, closure date, and Monarch option
 */
export async function showClosedAccountsDialog(
  options: ClosedAccountsDialogOptions,
): Promise<ClosedAccountsDialogResult> {
  return new Promise((resolve) => {
    let settled = false;
    let cleanupKeyboard = () => {};
    let controller!: DialogController;

    const finish = (result: ClosedAccountsDialogResult) => {
      if (settled) return;
      settled = true;
      cleanupKeyboard();
      controller.overlay.remove();
      resolve(result);
    };

    const handleCancel = () => finish({
      confirmed: false,
      selectedAccountIds: [],
      closeInMonarch: false,
      closedDate: '',
    });
    const handleConfirm = () => {
      const selectedAccountIds = Array.from(controller.accountCheckboxes.entries())
        .filter(([, cb]) => cb.checked)
        .map(([id]) => id);
      const closedDate = controller.dateInput.value;
      if (selectedAccountIds.length === 0 || !DATE_YMD_REGEX.test(closedDate)) return;

      finish({
        confirmed: true,
        selectedAccountIds,
        closeInMonarch: Boolean(controller.monarchCheckbox?.checked),
        closedDate,
      });
    };

    controller = buildClosedAccountsDialog(options, handleCancel, handleConfirm);
    controller.overlay.addEventListener('click', (event) => {
      if (event.target === controller.overlay) handleCancel();
    });

    cleanupKeyboard = addModalKeyboardHandlers(controller.overlay, handleCancel);
    document.body.appendChild(controller.overlay);
    controller.confirmBtn.focus();
  });
}
