/**
 * Settings Modal - Uploaded Transactions Section
 *
 * Renders the per-account "Uploaded Transactions" collapsible: the dedup
 * reference list with date, merchant and ID, a filter box, and bulk add/delete
 * actions.
 *
 * Rows are displayed newest-first via `getTransactionsNewestFirst`, which is a
 * plain reversal of the oldest-first stored order — not a re-sort. Ordering is
 * owned by insertion time in `transactionStorage`, so a misordered stored list
 * stays visible here instead of being silently corrected.
 */

import { debugLog, getTodayLocal } from '../../core/utils';
import toast from '../toast';
import { getCapabilities } from '../../core/integrationCapabilities';
import accountService from '../../services/common/accountService';
import { getTransactionsNewestFirst, type StoredTransaction } from '../../utils/transactionStorage';
import { showConfirmDialog } from './settingsModalHelpers';
import { createCollapsibleHeader, setupCollapsible, createSmallButton } from './settingsModalCollapsible';

/**
 * Account entry fields this section reads.
 *
 * `uploadedTransactions` is typed loosely because stored entries can predate the
 * current schema (legacy string IDs, entries without a merchant); the row
 * renderer narrows each entry defensively.
 */
interface TransactionsAccountEntry {
  uploadedTransactions?: unknown[];
  [key: string]: unknown;
}

/**
 * Renders the transactions management section for deduplication
 */
export function renderTransactionsManagementSection(
  integrationId: string,
  accountEntry: TransactionsAccountEntry,
  accountId: string,
  onRefresh: (() => void) | null,
): HTMLElement {
  const capabilities = getCapabilities(integrationId);

  if (!capabilities || !capabilities.hasDeduplication) {
    return document.createElement('div');
  }

  const sectionContainer = document.createElement('div');
  sectionContainer.id = `transactions-section-${integrationId}-${accountId}`;
  sectionContainer.style.cssText = 'margin-bottom: 15px;';

  const uploadedTransactions: StoredTransaction[] = (accountEntry.uploadedTransactions || []) as StoredTransaction[];

  const sectionHeader = createCollapsibleHeader(
    `transactions-${integrationId}-${accountId}`,
    'Uploaded Transactions',
    `(${uploadedTransactions.length} stored)`,
  );
  sectionContainer.appendChild(sectionHeader.header);

  const expandableContent = document.createElement('div');
  expandableContent.id = `transactions-content-${integrationId}-${accountId}`;
  expandableContent.style.cssText = `
    display: none;
    padding: 12px;
    border: 1px solid var(--mu-border, #e0e0e0);
    border-top: none;
    border-radius: 0 0 6px 6px;
    background-color: var(--mu-bg-primary, #fff);
  `;

  if (uploadedTransactions.length === 0) {
    const emptyMessage = document.createElement('p');
    emptyMessage.textContent = 'No uploaded transaction IDs stored. Transactions will appear here after syncing.';
    emptyMessage.style.cssText = 'color: var(--mu-text-secondary, #666); font-style: italic; margin: 0; font-size: 13px;';
    expandableContent.appendChild(emptyMessage);
  } else {
    buildTransactionsContent(expandableContent, integrationId, accountId, uploadedTransactions, onRefresh);
  }

  sectionContainer.appendChild(expandableContent);
  setupCollapsible(sectionHeader, expandableContent);

  return sectionContainer;
}

/**
 * Build the bulk action toolbar (add / select / delete buttons).
 */
function buildBulkActions(integrationId: string, accountId: string): {
  container: HTMLElement;
  addBtn: HTMLButtonElement;
  selectAllBtn: HTMLButtonElement;
  selectNoneBtn: HTMLButtonElement;
  deleteSelectedBtn: HTMLButtonElement;
  deleteAllBtn: HTMLButtonElement;
} {
  const container = document.createElement('div');
  container.id = `transactions-bulk-actions-${integrationId}-${accountId}`;
  container.style.cssText = 'margin-bottom: 12px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap;';

  const addBtn = createSmallButton(`transactions-add-btn-${integrationId}-${accountId}`, 'Add', '#28a745', true);
  const selectAllBtn = createSmallButton(`transactions-select-all-btn-${integrationId}-${accountId}`, 'Select All');
  const selectNoneBtn = createSmallButton(`transactions-select-none-btn-${integrationId}-${accountId}`, 'Select None');
  const deleteSelectedBtn = createSmallButton(`transactions-delete-selected-btn-${integrationId}-${accountId}`, 'Delete Selected', '#dc3545');
  const deleteAllBtn = createSmallButton(`transactions-delete-all-btn-${integrationId}-${accountId}`, 'Delete All', '#dc3545');
  deleteAllBtn.style.marginLeft = 'auto';

  container.appendChild(addBtn);
  container.appendChild(selectAllBtn);
  container.appendChild(selectNoneBtn);
  container.appendChild(deleteSelectedBtn);
  container.appendChild(deleteAllBtn);

  return {
    container, addBtn, selectAllBtn, selectNoneBtn, deleteSelectedBtn, deleteAllBtn,
  };
}

/**
 * Build the "Add transaction IDs" input area (hidden until Add is clicked).
 */
function buildAddInputArea(integrationId: string, accountId: string): {
  container: HTMLElement;
  textarea: HTMLTextAreaElement;
  saveBtn: HTMLButtonElement;
  cancelBtn: HTMLButtonElement;
} {
  const container = document.createElement('div');
  container.id = `transactions-add-input-${integrationId}-${accountId}`;
  container.style.cssText = 'display: none; margin-bottom: 12px; padding: 12px; background-color: var(--mu-bg-secondary, #f8f9fa); border: 1px solid var(--mu-border, #e0e0e0); border-radius: 4px;';

  const inputLabel = document.createElement('label');
  inputLabel.textContent = 'Add Transaction IDs:';
  inputLabel.style.cssText = 'display: block; margin-bottom: 8px; font-weight: bold; font-size: 13px;';
  container.appendChild(inputLabel);

  const textarea = document.createElement('textarea');
  textarea.id = `transactions-textarea-${integrationId}-${accountId}`;
  textarea.placeholder = 'Enter transaction IDs (one per line or comma-separated)';
  textarea.style.cssText = 'width: 100%; min-height: 80px; padding: 8px; border: 1px solid var(--mu-input-border, #ccc); border-radius: 4px; font-family: monospace; font-size: 13px; resize: vertical; box-sizing: border-box; background: var(--mu-input-bg, white); color: var(--mu-text-primary, #333);';
  container.appendChild(textarea);

  const inputButtonContainer = document.createElement('div');
  inputButtonContainer.style.cssText = 'margin-top: 10px; display: flex; gap: 8px;';
  const saveBtn = createSmallButton(`transactions-save-btn-${integrationId}-${accountId}`, 'Save', '#28a745');
  const cancelBtn = createSmallButton(`transactions-cancel-input-btn-${integrationId}-${accountId}`, 'Cancel');
  inputButtonContainer.appendChild(saveBtn);
  inputButtonContainer.appendChild(cancelBtn);
  container.appendChild(inputButtonContainer);

  return { container, textarea, saveBtn, cancelBtn };
}

/**
 * Build the filter bar: text input, match counter and clear button.
 */
function buildFilterBar(integrationId: string, accountId: string, totalCount: number): {
  container: HTMLElement;
  input: HTMLInputElement;
  counter: HTMLElement;
  clearBtn: HTMLButtonElement;
} {
  const container = document.createElement('div');
  container.id = `transactions-filter-${integrationId}-${accountId}`;
  container.style.cssText = 'margin-bottom: 10px; display: flex; align-items: center; gap: 8px;';

  const input = document.createElement('input');
  input.id = `transactions-filter-input-${integrationId}-${accountId}`;
  input.type = 'text';
  input.placeholder = 'Filter by transaction ID or merchant';
  input.style.cssText = 'flex: 1; padding: 6px 8px; border: 1px solid var(--mu-input-border, #ccc); border-radius: 4px; font-size: 13px; background: var(--mu-input-bg, white); color: var(--mu-text-primary, #333);';

  const clearBtn = document.createElement('button');
  clearBtn.id = `transactions-filter-clear-btn-${integrationId}-${accountId}`;
  clearBtn.textContent = '✕';
  clearBtn.title = 'Clear filter';
  clearBtn.style.cssText = 'display: none; background: transparent; border: none; cursor: pointer; font-size: 14px; padding: 4px 6px; color: var(--mu-text-secondary, #666);';

  const counter = document.createElement('span');
  counter.id = `transactions-filter-count-${integrationId}-${accountId}`;
  counter.style.cssText = 'font-size: 12px; color: var(--mu-text-secondary, #666); white-space: nowrap;';
  counter.textContent = `${totalCount} of ${totalCount}`;

  container.appendChild(input);
  container.appendChild(clearBtn);
  container.appendChild(counter);

  return { container, input, counter, clearBtn };
}

/**
 * Build a single transaction row: checkbox, date badge, merchant and ID.
 */
function buildTransactionRow(
  tx: StoredTransaction,
  integrationId: string,
  accountId: string,
  rowIndex: number,
): HTMLElement {
  const txRow = document.createElement('div');
  txRow.id = `transaction-row-${integrationId}-${accountId}-${rowIndex}`;
  txRow.style.cssText = `display: flex; align-items: center; padding: 8px 10px; border-bottom: 1px solid var(--mu-border, #f0f0f0); background: ${rowIndex % 2 === 0 ? 'var(--mu-bg-primary, #fff)' : 'var(--mu-bg-secondary, #fafafa)'};`;

  const txId = typeof tx === 'object' && tx !== null ? tx.id : String(tx);
  const merchant = typeof tx === 'object' && tx !== null ? tx.merchant : null;

  const checkbox = document.createElement('input');
  checkbox.id = `transaction-checkbox-${integrationId}-${accountId}-${rowIndex}`;
  checkbox.type = 'checkbox';
  checkbox.style.cssText = 'margin-right: 10px; flex-shrink: 0;';
  checkbox.dataset.txId = txId;

  const txDisplay = document.createElement('div');
  txDisplay.style.cssText = 'display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1;';

  if (typeof tx === 'object' && tx !== null && tx.id) {
    if (tx.date) {
      const dateBadge = document.createElement('span');
      dateBadge.id = `transaction-date-${integrationId}-${accountId}-${rowIndex}`;
      dateBadge.textContent = tx.date;
      dateBadge.style.cssText = 'background-color: var(--mu-badge-bg, #e3f2fd); color: var(--mu-badge-text, #1565c0); padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 500; flex-shrink: 0;';
      txDisplay.appendChild(dateBadge);
    }

    // Merchant is absent on legacy entries stored before it was tracked.
    const merchantText = document.createElement('span');
    merchantText.id = `transaction-merchant-${integrationId}-${accountId}-${rowIndex}`;
    merchantText.textContent = merchant || '—';
    merchantText.title = merchant || 'No merchant recorded';
    merchantText.style.cssText = `font-size: 13px; color: ${merchant ? 'var(--mu-text-primary, #333)' : 'var(--mu-text-muted, #999)'}; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 0;`;
    txDisplay.appendChild(merchantText);

    const idText = document.createElement('span');
    idText.id = `transaction-id-${integrationId}-${accountId}-${rowIndex}`;
    idText.textContent = tx.id;
    idText.style.cssText = 'font-family: monospace; font-size: 13px; color: var(--mu-text-secondary, #666); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
    txDisplay.appendChild(idText);
  } else {
    const txText = document.createElement('span');
    txText.id = `transaction-id-${integrationId}-${accountId}-${rowIndex}`;
    txText.textContent = typeof tx === 'object' ? JSON.stringify(tx) : String(tx);
    txText.style.cssText = 'font-family: monospace; font-size: 13px;';
    txDisplay.appendChild(txText);
  }

  txRow.appendChild(checkbox);
  txRow.appendChild(txDisplay);

  return txRow;
}

/**
 * Case-insensitive substring match against both the transaction ID and merchant.
 */
function matchesFilter(tx: StoredTransaction, needle: string): boolean {
  if (!needle) return true;
  const haystack = `${tx.id || ''} ${tx.merchant || ''}`.toLowerCase();
  return haystack.includes(needle);
}

/**
 * Build the transactions management content (filter, bulk actions, list).
 */
function buildTransactionsContent(
  container: HTMLElement,
  integrationId: string,
  accountId: string,
  uploadedTransactions: StoredTransaction[],
  onRefresh: (() => void) | null,
): void {
  const bulkActions = buildBulkActions(integrationId, accountId);
  container.appendChild(bulkActions.container);

  const addInput = buildAddInputArea(integrationId, accountId);
  container.appendChild(addInput.container);

  const filterBar = buildFilterBar(integrationId, accountId, uploadedTransactions.length);
  container.appendChild(filterBar.container);

  // Newest first for display; storage stays oldest-first (see module docs).
  const displayTransactions = getTransactionsNewestFirst(uploadedTransactions);

  const transactionsList = document.createElement('div');
  transactionsList.id = `transactions-list-${integrationId}-${accountId}`;
  transactionsList.style.cssText = 'max-height: 250px; overflow-y: auto; border: 1px solid var(--mu-border, #e0e0e0); border-radius: 4px;';

  displayTransactions.forEach((tx, rowIndex) => {
    transactionsList.appendChild(buildTransactionRow(tx, integrationId, accountId, rowIndex));
  });

  container.appendChild(transactionsList);

  const rows = Array.from(transactionsList.children) as HTMLElement[];

  // ── Filtering ────────────────────────────────────────────
  const applyFilter = (): void => {
    const needle = filterBar.input.value.trim().toLowerCase();
    let visibleCount = 0;

    displayTransactions.forEach((tx, rowIndex) => {
      const matches = matchesFilter(tx, needle);
      rows[rowIndex].style.display = matches ? 'flex' : 'none';
      if (matches) {
        visibleCount += 1;
      } else {
        // Hidden rows must not stay selected — bulk delete acts on selection.
        const checkbox = rows[rowIndex].querySelector('input[type="checkbox"]') as HTMLInputElement | null;
        if (checkbox) checkbox.checked = false;
      }
    });

    filterBar.counter.textContent = `${visibleCount} of ${displayTransactions.length}`;
    filterBar.clearBtn.style.display = needle ? 'block' : 'none';
  };

  filterBar.input.addEventListener('input', applyFilter);
  filterBar.input.addEventListener('click', (e: Event) => e.stopPropagation());
  filterBar.clearBtn.addEventListener('click', (e: Event) => {
    e.stopPropagation();
    filterBar.input.value = '';
    applyFilter();
  });

  /** Checkboxes for rows currently visible under the active filter. */
  const getVisibleCheckboxes = (): HTMLInputElement[] => rows
    .filter((row) => row.style.display !== 'none')
    .map((row) => row.querySelector('input[type="checkbox"]') as HTMLInputElement)
    .filter(Boolean);

  // ── Add mode ─────────────────────────────────────────────
  let isAddingMode = false;

  const exitAddMode = (): void => {
    isAddingMode = false;
    addInput.textarea.value = '';
    addInput.container.style.display = 'none';
    bulkActions.addBtn.textContent = 'Add';
    bulkActions.addBtn.style.borderColor = '#28a745';
    bulkActions.addBtn.style.color = '#28a745';
  };

  bulkActions.addBtn.addEventListener('click', (e: Event) => {
    e.stopPropagation();
    if (isAddingMode) {
      exitAddMode();
      return;
    }
    isAddingMode = true;
    addInput.container.style.display = 'block';
    bulkActions.addBtn.textContent = 'Cancel';
    bulkActions.addBtn.style.borderColor = '#dc3545';
    bulkActions.addBtn.style.color = '#dc3545';
  });

  addInput.saveBtn.addEventListener('click', (e: Event) => {
    e.stopPropagation();
    const inputValue = addInput.textarea.value.trim();
    if (!inputValue) {
      toast.show('Please enter at least one transaction ID', 'warning');
      return;
    }

    const newIds = inputValue.split(/[\n,]/).map((id) => id.trim()).filter((id) => id.length > 0);
    if (newIds.length === 0) {
      toast.show('No valid transaction IDs found', 'warning');
      return;
    }

    const existingIds = new Set(uploadedTransactions.map((tx) => (typeof tx === 'object' ? tx.id : String(tx))));
    const duplicates: string[] = [];
    const uniqueNewIds: string[] = [];

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

    // Appended at the tail with today's date, matching the oldest-first
    // storage invariant (newest entries live at the end).
    const today = getTodayLocal();
    const newTransactions = uniqueNewIds.map((id) => ({ id, date: today, merchant: null }));
    const updatedTransactions = [...uploadedTransactions, ...newTransactions];

    const success = accountService.updateAccountInList(integrationId, accountId, { uploadedTransactions: updatedTransactions });
    if (success) {
      let message = `Added ${uniqueNewIds.length} transaction ID(s)`;
      if (duplicates.length > 0) message += ` (${duplicates.length} duplicate(s) skipped)`;
      toast.show(message, 'info');
      debugLog(`Added ${uniqueNewIds.length} transaction IDs to ${accountId}`);
      exitAddMode();
      if (onRefresh) setTimeout(onRefresh, 300);
    } else {
      toast.show('Error adding transaction IDs', 'error');
    }
  });

  addInput.cancelBtn.addEventListener('click', (e: Event) => {
    e.stopPropagation();
    exitAddMode();
  });

  // ── Selection ────────────────────────────────────────────
  bulkActions.selectAllBtn.addEventListener('click', (e: Event) => {
    e.stopPropagation();
    getVisibleCheckboxes().forEach((cb) => { cb.checked = true; });
  });

  bulkActions.selectNoneBtn.addEventListener('click', (e: Event) => {
    e.stopPropagation();
    getVisibleCheckboxes().forEach((cb) => { cb.checked = false; });
  });

  // ── Deletion ─────────────────────────────────────────────
  bulkActions.deleteSelectedBtn.addEventListener('click', async (e: Event) => {
    e.stopPropagation();
    const selectedCheckboxes = Array.from(transactionsList.querySelectorAll('input[type="checkbox"]:checked')) as HTMLInputElement[];
    if (selectedCheckboxes.length === 0) {
      toast.show('No transactions selected', 'warning');
      return;
    }

    const confirmed = await showConfirmDialog(`Are you sure you want to delete ${selectedCheckboxes.length} selected transaction reference(s)?`);
    if (!confirmed) return;

    // Delete by ID, not by row index: displayed rows are reversed relative to
    // storage and may be filtered, so indices do not map to storage positions.
    const idsToRemove = new Set(selectedCheckboxes.map((cb) => cb.dataset.txId));
    const updatedTransactions = uploadedTransactions.filter((tx) => {
      const txId = typeof tx === 'object' && tx !== null ? tx.id : String(tx);
      return !idsToRemove.has(txId);
    });

    const success = accountService.updateAccountInList(integrationId, accountId, { uploadedTransactions: updatedTransactions });
    if (success) {
      toast.show(`Deleted ${selectedCheckboxes.length} transaction reference(s)`, 'info');
      if (onRefresh) setTimeout(onRefresh, 300);
    } else {
      toast.show('Error deleting transactions', 'error');
    }
  });

  bulkActions.deleteAllBtn.addEventListener('click', async (e: Event) => {
    e.stopPropagation();
    const confirmed = await showConfirmDialog(`Are you sure you want to delete ALL ${uploadedTransactions.length} transaction references?\n\nThis will allow all transactions to be re-uploaded.`);
    if (!confirmed) return;

    const success = accountService.updateAccountInList(integrationId, accountId, { uploadedTransactions: [] });
    if (success) {
      toast.show('All transaction references cleared', 'info');
      if (onRefresh) setTimeout(onRefresh, 300);
    } else {
      toast.show('Error clearing transactions', 'error');
    }
  });
}

export default { renderTransactionsManagementSection };