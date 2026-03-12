/**
 * Category Selector - Manual Transaction Categorization
 * Dialog for manually categorizing transactions with no matching rule
 */

import { debugLog } from '../../core/utils';
import { addModalKeyboardHandlers } from '../keyboardNavigation';
import { createModalOverlay } from './categorySelectorUtils';

interface ManualCategorizationResult {
  merchant: string;
  category: CategorySelection;
}

interface CategorySelection {
  id?: string;
  name: string;
  [key: string]: unknown;
}

interface Transaction {
  externalCanonicalId?: string;
  type?: string;
  subType?: string;
  amount?: number;
  amountSign?: string;
  currency?: string;
  occurredAt?: string;
  unifiedStatus?: string;
  status?: string;
  [key: string]: unknown;
}

interface CategoryGroup {
  id?: string;
  name: string;
  categories: CategorySelection[];
  [key: string]: unknown;
}

type CategoryGroupSelectorFn = (
  categoryGroups: CategoryGroup[],
  bankCategory: string,
  callback: (selected: CategorySelection | null) => void,
) => void;

/**
 * Internal function to show the manual categorization dialog
 * @param transaction - Raw transaction object
 * @param categoryGroups - Category groups with categories
 * @param callback - Callback function
 * @param showCategoryGroupSelectorFn - Injected function to show category group selector (avoids circular dependency)
 */
export function showManualCategorizationDialog(
  transaction: Transaction,
  categoryGroups: CategoryGroup[],
  callback: (result: ManualCategorizationResult | null) => void,
  showCategoryGroupSelectorFn: CategoryGroupSelectorFn,
): void {
  let selectedCategory: CategorySelection | null = null;
  let merchantName = '';
  let isJsonExpanded = false;

  // Create overlay
  const overlay = createModalOverlay(() => {
    overlay.remove();
    callback(null);
  });
  overlay.id = 'manual-categorization-overlay';

  // Create modal content
  const modal = document.createElement('div');
  modal.id = 'manual-categorization-modal';
  modal.style.cssText = `
    background: white;
    padding: 25px;
    border-radius: 8px;
    width: 90%;
    max-width: 600px;
    max-height: 80vh;
    overflow-y: auto;
  `;

  // Add header
  const header = document.createElement('h2');
  header.id = 'manual-categorization-header';
  header.style.cssText = 'margin-top:0; margin-bottom: 15px; font-size: 1.2em;';
  header.textContent = 'Manual Transaction Categorization';
  modal.appendChild(header);

  // Add description
  const description = document.createElement('div');
  description.id = 'manual-categorization-description';
  description.style.cssText = `
    background: #fff3cd;
    border: 1px solid #ffc107;
    border-radius: 6px;
    padding: 12px;
    margin-bottom: 15px;
    font-size: 0.9em;
    color: #856404;
  `;
  description.innerHTML = `
    <strong>⚠️ No categorization rule found</strong><br>
    This transaction type is not yet supported for automatic categorization. 
    Please categorize it manually. <em>This categorization will not be saved for future transactions.</em>
  `;
  modal.appendChild(description);

  // Add collapsible transaction JSON section
  const jsonSection = document.createElement('div');
  jsonSection.id = 'manual-categorization-json-section';
  jsonSection.style.cssText = 'margin-bottom: 15px;';

  // JSON toggle header
  const jsonToggle = document.createElement('div');
  jsonToggle.id = 'manual-categorization-json-toggle';
  jsonToggle.style.cssText = `
    display: flex;
    align-items: center;
    cursor: pointer;
    padding: 10px;
    background: #f8f9fa;
    border: 1px solid #dee2e6;
    border-radius: 6px;
    font-weight: bold;
    color: #333;
  `;

  const toggleIcon = document.createElement('span');
  toggleIcon.id = 'manual-categorization-toggle-icon';
  toggleIcon.style.cssText = 'margin-right: 8px; transition: transform 0.2s;';
  toggleIcon.textContent = '▶';

  const toggleText = document.createElement('span');
  toggleText.id = 'manual-categorization-toggle-text';
  toggleText.textContent = 'Transaction Details (click to expand)';

  jsonToggle.appendChild(toggleIcon);
  jsonToggle.appendChild(toggleText);
  jsonSection.appendChild(jsonToggle);

  // JSON content (initially hidden)
  const jsonContent = document.createElement('div');
  jsonContent.id = 'manual-categorization-json-content';
  jsonContent.style.cssText = `
    display: none;
    margin-top: 10px;
    padding: 12px;
    background: #f4f4f4;
    border: 1px solid #ddd;
    border-radius: 4px;
    max-height: 300px;
    overflow-y: auto;
  `;

  const jsonPre = document.createElement('pre');
  jsonPre.id = 'manual-categorization-json-pre';
  jsonPre.style.cssText = `
    margin: 0;
    font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
    font-size: 12px;
    white-space: pre-wrap;
    word-break: break-all;
  `;
  jsonPre.textContent = JSON.stringify(transaction, null, 2);
  jsonContent.appendChild(jsonPre);
  jsonSection.appendChild(jsonContent);

  // Toggle click handler
  jsonToggle.onclick = () => {
    isJsonExpanded = !isJsonExpanded;
    jsonContent.style.display = isJsonExpanded ? 'block' : 'none';
    toggleIcon.style.transform = isJsonExpanded ? 'rotate(90deg)' : '';
    toggleText.textContent = isJsonExpanded
      ? 'Transaction Details (click to collapse)'
      : 'Transaction Details (click to expand)';
  };

  modal.appendChild(jsonSection);

  // Add quick info summary
  const quickInfo = document.createElement('div');
  quickInfo.id = 'manual-categorization-quick-info';
  quickInfo.style.cssText = `
    background: #e8f4f8;
    border: 1px solid #b8daff;
    border-radius: 6px;
    padding: 12px;
    margin-bottom: 15px;
    font-size: 0.9em;
  `;

  let quickInfoHtml = '<div style="font-weight: bold; margin-bottom: 8px; color: #333;">Quick Summary:</div>';

  // Type and SubType
  if (transaction.type || transaction.subType) {
    quickInfoHtml += `<div style="margin-bottom: 4px;">
      <span style="color: #666;">Type:</span>
      <span style="font-weight: 500; color: #333;">${transaction.type || 'N/A'} / ${transaction.subType || 'N/A'}</span>
    </div>`;
  }

  // Amount
  if (transaction.amount !== undefined) {
    const isNegative = transaction.amountSign === 'negative';
    const amountValue = isNegative ? -Math.abs(transaction.amount) : Math.abs(transaction.amount);
    const amountColor = amountValue < 0 ? '#dc3545' : '#28a745';
    quickInfoHtml += `<div style="margin-bottom: 4px;">
      <span style="color: #666;">Amount:</span>
      <span style="font-weight: 500; color: ${amountColor};">$${amountValue.toFixed(2)} ${transaction.currency || 'CAD'}</span>
    </div>`;
  }

  // Date
  if (transaction.occurredAt) {
    const date = new Date(transaction.occurredAt);
    const dateStr = date.toLocaleDateString();
    quickInfoHtml += `<div style="margin-bottom: 4px;">
      <span style="color: #666;">Date:</span>
      <span style="font-weight: 500; color: #333;">${dateStr}</span>
    </div>`;
  }

  // Status
  if (transaction.unifiedStatus || transaction.status) {
    quickInfoHtml += `<div style="margin-bottom: 4px;">
      <span style="color: #666;">Status:</span>
      <span style="font-weight: 500; color: #333;">${transaction.unifiedStatus || transaction.status}</span>
    </div>`;
  }

  quickInfo.innerHTML = quickInfoHtml;
  modal.appendChild(quickInfo);

  // Merchant name input section
  const merchantSection = document.createElement('div');
  merchantSection.id = 'manual-categorization-merchant-section';
  merchantSection.style.cssText = 'margin-bottom: 15px;';

  const merchantLabel = document.createElement('label');
  merchantLabel.id = 'manual-categorization-merchant-label';
  merchantLabel.style.cssText = 'display: block; font-weight: bold; margin-bottom: 5px; color: #333;';
  merchantLabel.textContent = 'Merchant Name *';
  merchantSection.appendChild(merchantLabel);

  const merchantInput = document.createElement('input');
  merchantInput.id = 'manual-categorization-merchant-input';
  merchantInput.type = 'text';
  merchantInput.placeholder = 'Enter merchant name for this transaction...';
  merchantInput.style.cssText = `
    width: 100%;
    padding: 10px 12px;
    border: 1px solid #ddd;
    border-radius: 6px;
    font-size: 14px;
    box-sizing: border-box;
  `;
  modal.appendChild(merchantSection);

  // Category selection section
  const categorySection = document.createElement('div');
  categorySection.id = 'manual-categorization-category-section';
  categorySection.style.cssText = 'margin-bottom: 15px;';

  const categoryLabel = document.createElement('label');
  categoryLabel.id = 'manual-categorization-category-label';
  categoryLabel.style.cssText = 'display: block; font-weight: bold; margin-bottom: 5px; color: #333;';
  categoryLabel.textContent = 'Category *';
  categorySection.appendChild(categoryLabel);

  // Category display/button
  const categoryDisplay = document.createElement('div');
  categoryDisplay.id = 'manual-categorization-category-display';
  categoryDisplay.style.cssText = `
    padding: 12px;
    border: 1px solid #ddd;
    border-radius: 6px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #f8f9fa;
  `;

  const categoryText = document.createElement('span');
  categoryText.id = 'manual-categorization-category-text';
  categoryText.style.cssText = 'color: #888;';
  categoryText.textContent = 'Click to select category...';

  const categoryArrow = document.createElement('span');
  categoryArrow.id = 'manual-categorization-category-arrow';
  categoryArrow.style.cssText = 'color: #888;';
  categoryArrow.textContent = '▶';

  categoryDisplay.appendChild(categoryText);
  categoryDisplay.appendChild(categoryArrow);
  categorySection.appendChild(categoryDisplay);

  modal.appendChild(categorySection);

  // Button container
  const buttonContainer = document.createElement('div');
  buttonContainer.id = 'manual-categorization-buttons';
  buttonContainer.style.cssText = `
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 20px;
  `;

  // Cancel button
  const cancelBtn = document.createElement('button');
  cancelBtn.id = 'manual-categorization-cancel-btn';
  cancelBtn.textContent = 'Cancel Upload';
  cancelBtn.style.cssText = `
    padding: 10px 20px;
    background-color: #f5f5f5;
    color: #333;
    border: 1px solid #ddd;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
  `;
  cancelBtn.onclick = () => {
    overlay.remove();
    callback(null);
  };
  buttonContainer.appendChild(cancelBtn);

  // Save button
  const saveBtn = document.createElement('button');
  saveBtn.id = 'manual-categorization-save-btn';
  saveBtn.textContent = 'Save & Continue';
  saveBtn.disabled = true;
  saveBtn.style.cssText = `
    padding: 10px 20px;
    background-color: #cccccc;
    color: #666;
    border: none;
    border-radius: 4px;
    cursor: not-allowed;
    font-size: 14px;
  `;

  const updateSaveButton = (): void => {
    const isValid = merchantName.length > 0 && selectedCategory !== null;
    saveBtn.disabled = !isValid;

    if (isValid) {
      saveBtn.style.backgroundColor = '#28a745';
      saveBtn.style.color = 'white';
      saveBtn.style.cursor = 'pointer';
    } else {
      saveBtn.style.backgroundColor = '#cccccc';
      saveBtn.style.color = '#666';
      saveBtn.style.cursor = 'not-allowed';
    }
  };

  // Now add the event listeners that use updateSaveButton
  merchantInput.addEventListener('input', (e) => {
    merchantName = (e.target as HTMLInputElement).value.trim();
    updateSaveButton();
  });
  merchantSection.appendChild(merchantInput);

  // Category selector click handler
  categoryDisplay.onclick = () => {
    // Temporarily remove the current modal to show category selector
    overlay.style.display = 'none';

    // Create a wrapper callback that re-shows our dialog
    const categorySelectCallback = (selected: CategorySelection | null): void => {
      overlay.style.display = 'flex';

      if (selected) {
        selectedCategory = selected;
        categoryText.textContent = selected.name;
        categoryText.style.color = '#333';
        categoryText.style.fontWeight = 'bold';
        updateSaveButton();
      }
    };

    // Show the category group selector (injected to avoid circular dependency)
    showCategoryGroupSelectorFn(categoryGroups, 'manual selection', categorySelectCallback);
  };

  saveBtn.onclick = () => {
    if (merchantName && selectedCategory) {
      debugLog('Manual categorization saved:', {
        merchant: merchantName,
        category: selectedCategory.name,
        transactionId: transaction.externalCanonicalId,
      });

      overlay.remove();
      callback({
        merchant: merchantName,
        category: selectedCategory,
      });
    }
  };

  buttonContainer.appendChild(saveBtn);
  modal.appendChild(buttonContainer);

  // Add keyboard handler for Escape
  addModalKeyboardHandlers(overlay, () => {
    overlay.remove();
    callback(null);
  });

  // Focus merchant input on show
  setTimeout(() => merchantInput.focus(), 100);

  // Show the modal
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}