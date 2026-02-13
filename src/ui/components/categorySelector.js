/**
 * Category Selector Component
 * A reusable dropdown for selecting Monarch categories with sophisticated modal UI
 * Follows the same design patterns as the account selector
 */

import { debugLog } from '../../core/utils';
import monarchApi from '../../api/monarch';
import toast from '../toast';
import { addModalKeyboardHandlers, makeItemsKeyboardNavigable } from '../keyboardNavigation';
import {
  createSearchInput,
  createTopActionBar,
  createModalOverlay,
  getGroupColor,
  getGroupIcon,
} from './categorySelectorUtils';
import { showManualCategorizationDialog } from './categorySelectorManual';

// Re-export utilities for consumers
export {
  createSearchInput,
  createSplitSkipButton,
  createTopActionBar,
  createModalOverlay,
  getGroupColor,
  getGroupIcon,
} from './categorySelectorUtils';

export { showManualCategorizationDialog } from './categorySelectorManual';

/**
 * Creates a simple category selector dropdown
 *
 * @param {Object} options - Configuration options
 * @param {string} options.bankCategory - Bank category name being mapped
 * @param {Array<Object>} options.categories - List of categories to select from
 * @param {Function} options.onChange - Callback when selection changes
 * @param {string} options.selectedId - Initially selected category ID
 * @param {string} options.labelText - Text to show as label
 * @param {string} options.placeholderText - Placeholder text when no selection
 * @param {boolean} options.required - Whether selection is required (default: true)
 * @returns {HTMLElement} The created selector element
 */
export function createCategorySelector({
  bankCategory = '',
  categories = [],
  onChange = null,
  selectedId = null,
  labelText = null,
  placeholderText = 'Choose a category...',
  required = true,
}) {
  const container = document.createElement('div');
  container.className = 'category-selector-container';
  container.style.cssText = 'margin: 10px 0; display: flex; flex-direction: column; gap: 5px;';

  const label = document.createElement('label');
  label.textContent = labelText || `Select Monarch category for "${bankCategory}":`;
  label.style.cssText = 'font-weight: bold; font-size: 14px;';
  container.appendChild(label);

  const select = document.createElement('select');
  select.className = 'category-selector';
  select.style.cssText = 'padding: 8px; border-radius: 4px; border: 1px solid #ccc; font-size: 14px; width: 100%;';

  if (required) {
    select.setAttribute('required', 'required');
  }

  const placeholderOption = document.createElement('option');
  placeholderOption.value = '';
  placeholderOption.textContent = placeholderText;
  placeholderOption.disabled = true;
  placeholderOption.selected = !selectedId;
  select.appendChild(placeholderOption);

  categories.forEach((category) => {
    const option = document.createElement('option');
    option.value = category.id;
    option.textContent = category.name;
    option.selected = category.id === selectedId;
    select.appendChild(option);
  });

  if (categories.length === 0) {
    select.disabled = true;
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = 'No categories available';
    select.appendChild(emptyOption);
  }

  if (onChange && typeof onChange === 'function') {
    select.addEventListener('change', (event) => {
      const selectedCategory = categories.find((cat) => cat.id === event.target.value);
      onChange(selectedCategory);
    });
  }

  container.appendChild(select);
  return container;
}

/**
 * Show sophisticated Monarch category selector with group-based selection
 * @param {string} bankCategory - Bank category name being mapped
 * @param {Function} callback - Callback function to receive selected category
 * @param {Object} similarityInfo - Optional comprehensive similarity data
 * @param {Object} transactionDetails - Optional transaction details (merchant, amount, etc.)
 * @returns {Promise} Promise that resolves when selection is complete
 */
export async function showMonarchCategorySelector(bankCategory, callback, similarityInfo = null, transactionDetails = null) {
  debugLog('Starting category selector for bank category:', bankCategory);
  debugLog('Transaction details:', transactionDetails);

  try {
    let groupsWithCategories = [];

    if (similarityInfo && similarityInfo.categoryGroups && similarityInfo.categoryGroups.length > 0) {
      debugLog('Using pre-calculated similarity data for category selection');
      groupsWithCategories = similarityInfo.categoryGroups;
    } else {
      debugLog('No similarity data provided, falling back to original behavior');
      debugLog('Fetching category data from Monarch');
      const categoryData = await monarchApi.getCategoriesAndGroups();

      const categoryGroups = categoryData.categoryGroups || [];
      const categories = categoryData.categories || [];

      if (!categoryGroups.length && !categories.length) {
        toast.show('No categories found in Monarch', 'error');
        callback(null);
        return;
      }

      const categoriesByGroup = {};
      categories.forEach((category) => {
        if (!category.isDisabled && category.group) {
          const groupId = category.group.id;
          if (!categoriesByGroup[groupId]) {
            categoriesByGroup[groupId] = [];
          }
          categoriesByGroup[groupId].push(category);
        }
      });

      groupsWithCategories = categoryGroups
        .map((group) => ({
          ...group,
          categories: categoriesByGroup[group.id] || [],
          categoryCount: (categoriesByGroup[group.id] || []).length,
        }))
        .filter((group) => group.categoryCount > 0)
        .sort((a, b) => a.order - b.order);
    }

    if (!groupsWithCategories.length) {
      toast.show('No valid category groups found', 'error');
      callback(null);
      return;
    }

    debugLog('Showing category group selector with', {
      groupCount: groupsWithCategories.length,
      bankCategory,
      hasSimilarityData: Boolean(similarityInfo),
      hasTransactionDetails: Boolean(transactionDetails),
    });

    showCategoryGroupSelector(groupsWithCategories, bankCategory, callback, similarityInfo, transactionDetails);
  } catch (error) {
    debugLog('Failed to get category data:', error);
    toast.show('Failed to load categories from Monarch', 'error');
    callback(null);
  }
}

/**
 * Build transaction details HTML for display in modals
 * @param {Object} transactionDetails - Transaction details object
 * @returns {string} HTML string
 */
function buildTransactionDetailsHtml(transactionDetails) {
  let html = '<div style="font-weight: bold; margin-bottom: 8px; color: var(--mu-text-primary, #333);">Transaction Details:</div>';

  if (transactionDetails.merchant) {
    html += `<div style="margin-bottom: 4px;">
      <span style="color: var(--mu-text-secondary, #666);">Merchant:</span> 
      <span style="font-weight: 500; color: var(--mu-text-primary, #333);">${transactionDetails.merchant}</span>
    </div>`;
  }

  if (transactionDetails.amount !== undefined && transactionDetails.amount !== null) {
    let formattedAmount = '';
    let amountValue = 0;

    if (typeof transactionDetails.amount === 'object' && transactionDetails.amount.value !== undefined) {
      amountValue = parseFloat(transactionDetails.amount.value) || 0;
      const currency = transactionDetails.amount.currency || 'CAD';
      formattedAmount = `$${Math.abs(amountValue).toFixed(2)} ${currency}`;
    } else if (typeof transactionDetails.amount === 'number') {
      amountValue = transactionDetails.amount;
      formattedAmount = `$${Math.abs(amountValue).toFixed(2)}`;
    } else {
      formattedAmount = String(transactionDetails.amount);
    }

    const isWealthsimple = transactionDetails.institution === 'wealthsimple';
    let amountColor;
    if (isWealthsimple) {
      amountColor = amountValue < 0 ? '#dc3545' : '#28a745';
    } else {
      amountColor = amountValue < 0 ? '#28a745' : '#dc3545';
    }

    html += `<div style="margin-bottom: 4px;">
      <span style="color: #666;">Amount:</span> 
      <span style="font-weight: 500; color: ${amountColor};">${formattedAmount}</span>
    </div>`;
  }

  if (transactionDetails.date) {
    html += `<div style="margin-bottom: 4px;">
      <span style="color: var(--mu-text-secondary, #666);">Date:</span> 
      <span style="font-weight: 500; color: var(--mu-text-primary, #333);">${transactionDetails.date}</span>
    </div>`;
  }

  if (transactionDetails.aftDetails) {
    const aft = transactionDetails.aftDetails;
    if (aft.aftOriginatorName) {
      html += `<div style="margin-bottom: 4px;">
        <span style="color: #666;">Originator:</span>
        <span style="font-weight: 500; color: #333;">${aft.aftOriginatorName}</span>
      </div>`;
    }
    if (aft.aftTransactionType) {
      html += `<div style="margin-bottom: 4px;">
        <span style="color: #666;">AFT Type:</span>
        <span style="font-weight: 500; color: #333;">${aft.aftTransactionType}</span>
      </div>`;
    }
    if (aft.aftTransactionCategory) {
      html += `<div style="margin-bottom: 4px;">
        <span style="color: #666;">AFT Category:</span>
        <span style="font-weight: 500; color: #333;">${aft.aftTransactionCategory}</span>
      </div>`;
    }
  }

  if (transactionDetails.p2pDetails) {
    const p2p = transactionDetails.p2pDetails;
    if (p2p.type) {
      html += `<div style="margin-bottom: 4px;">
        <span style="color: #666;">Type:</span>
        <span style="font-weight: 500; color: #333;">${p2p.type}</span>
      </div>`;
    }
    if (p2p.subType) {
      html += `<div style="margin-bottom: 4px;">
        <span style="color: #666;">SubType:</span>
        <span style="font-weight: 500; color: #333;">${p2p.subType}</span>
      </div>`;
    }
    if (p2p.p2pHandle) {
      html += `<div style="margin-bottom: 4px;">
        <span style="color: #666;">Handle:</span>
        <span style="font-weight: 500; color: #333;">${p2p.p2pHandle}</span>
      </div>`;
    }
  }

  return html;
}

/**
 * Show the category group selection screen
 * @param {Array} categoryGroups - List of category groups with categories
 * @param {string} bankCategory - Bank category name being mapped
 * @param {Function} callback - Callback for final category selection
 * @param {Object} similarityInfo - Optional similarity information to display
 * @param {Object} transactionDetails - Optional transaction details (merchant, amount, etc.)
 */
function showCategoryGroupSelector(categoryGroups, bankCategory, callback, similarityInfo = null, transactionDetails = null) {
  debugLog('Showing category group selector with', {
    groupsCount: categoryGroups ? categoryGroups.length : 0,
    bankCategory,
    hasTransactionDetails: Boolean(transactionDetails),
  });

  let cleanupKeyboard = () => {};
  let actionBarCleanup = () => {};

  const overlay = createModalOverlay(() => {
    cleanupKeyboard();
    actionBarCleanup();
    overlay.remove();
    callback(null);
  });

  const modal = document.createElement('div');
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

  const header = document.createElement('h2');
  header.style.cssText = 'margin-top:0; margin-bottom: 20px; font-size: 1.2em; color: var(--mu-text-primary, #333);';
  header.textContent = 'Select Category Group';
  modal.appendChild(header);

  let searchQuery = '';
  let selectedCategory = null;
  let searchElements;

  // Add transaction details section if available
  if (transactionDetails) {
    const transactionInfo = document.createElement('div');
    transactionInfo.style.cssText = `
      background: var(--mu-bg-secondary, #f8f9fa);
      border: 1px solid var(--mu-border, #dee2e6);
      border-radius: 6px;
      padding: 12px;
      margin-bottom: 15px;
    `;
    transactionInfo.innerHTML = buildTransactionDetailsHtml(transactionDetails);
    modal.appendChild(transactionInfo);
  }

  // Add bank category reference with similarity score if available
  const bankCategoryRef = document.createElement('div');
  bankCategoryRef.style.cssText = 'margin-bottom: 15px; font-size: 0.95em; color: var(--mu-text-secondary, #666);';
  let bankCategoryHtml = `Selecting Monarch category for bank category: <b>${bankCategory}</b>`;

  if (similarityInfo && typeof similarityInfo.score === 'number') {
    const scorePercent = (similarityInfo.score * 100).toFixed(1);
    let scoreColor = '#e74c3c';
    if (similarityInfo.score > 0.95) {
      scoreColor = '#27ae60';
    } else if (similarityInfo.score > 0.7) {
      scoreColor = '#f39c12';
    }
    bankCategoryHtml += `<br><small style="color: ${scoreColor};">Best match: `
      + `<b>${similarityInfo.bestMatch}</b> (${scorePercent}% similarity)</small>`;
  }

  bankCategoryRef.innerHTML = bankCategoryHtml;
  modal.appendChild(bankCategoryRef);

  // Add top action bar (Skip + Cancel)
  const topActionBar = createTopActionBar(
    () => {
      debugLog('Skip clicked - skipping categorization for this transaction');
      cleanupKeyboard();
      actionBarCleanup();
      overlay.remove();
      toast.show('Skipped categorization for this transaction', 'info');
      setTimeout(() => callback({ name: 'Uncategorized', assignmentType: 'once', skipped: true }), 0);
    },
    () => {
      debugLog('Skip All clicked - skipping remaining category selections for this sync');
      cleanupKeyboard();
      actionBarCleanup();
      overlay.remove();
      toast.show('Skipping categorization for remaining transactions', 'info');
      setTimeout(() => callback({ skipAll: true }), 0);
    },
    () => {
      cleanupKeyboard();
      actionBarCleanup();
      overlay.remove();
      callback(null);
    },
  );
  actionBarCleanup = () => { if (topActionBar.cleanupFn) topActionBar.cleanupFn(); };
  modal.appendChild(topActionBar);

  const searchPlaceholder = document.createElement('div');
  modal.appendChild(searchPlaceholder);

  const contentContainer = document.createElement('div');
  modal.appendChild(contentContainer);

  // Helper function to create a group item
  const createGroupItem = (group, onClick) => {
    const item = document.createElement('div');
    item.style.cssText = `
      display: flex; align-items: center; padding: 15px; border-radius: 8px;
      cursor: pointer; margin-bottom: 15px; border: 1px solid var(--mu-border-light, #eee);
      transition: all 0.2s; position: relative;
    `;

    const iconContainer = document.createElement('div');
    iconContainer.style.cssText = 'margin-right: 15px; flex-shrink: 0;';
    const iconDiv = document.createElement('div');
    iconDiv.style.cssText = `
      width: 40px; height: 40px; border-radius: 5px;
      background-color: ${getGroupColor(group.type || group.name)};
      display: flex; align-items: center; justify-content: center;
      font-size: 20px; color: white; font-weight: bold;
    `;
    iconDiv.textContent = getGroupIcon(group.type || group.name);
    iconContainer.appendChild(iconDiv);
    item.appendChild(iconContainer);

    const infoDiv = document.createElement('div');
    infoDiv.style.cssText = 'flex-grow: 1;';
    const nameDiv = document.createElement('div');
    nameDiv.style.cssText = 'font-weight: bold; font-size: 1.1em; color: var(--mu-text-primary, #333);';
    nameDiv.textContent = group.name;
    infoDiv.appendChild(nameDiv);
    const countDiv = document.createElement('div');
    countDiv.style.cssText = 'font-size: 0.9em; color: var(--mu-text-secondary, #666);';
    countDiv.textContent = `${group.categoryCount} categories`;
    infoDiv.appendChild(countDiv);

    if (typeof group.maxSimilarityScore === 'number') {
      const scorePercent = Math.round(group.maxSimilarityScore * 100);
      let scoreColor = '#e74c3c';
      if (group.maxSimilarityScore > 0.95) scoreColor = '#27ae60';
      else if (group.maxSimilarityScore > 0.7) scoreColor = '#f39c12';
      const scoreDiv = document.createElement('div');
      scoreDiv.style.cssText = `font-size: 0.85em; font-weight: bold; color: ${scoreColor};`;
      scoreDiv.textContent = `${scorePercent}% match`;
      infoDiv.appendChild(scoreDiv);
    }

    item.appendChild(infoDiv);

    const arrowContainer = document.createElement('div');
    arrowContainer.style.cssText = 'margin-left: 15px; font-size: 1.5em; color: var(--mu-text-muted, #aaa); position: relative; z-index: 1;';
    arrowContainer.innerHTML = '&rsaquo;';
    item.appendChild(arrowContainer);

    item.onmouseover = () => { item.style.backgroundColor = 'var(--mu-hover-bg, #f5f5f5)'; item.style.borderColor = 'var(--mu-border-color, #ddd)'; };
    item.onmouseout = () => { item.style.backgroundColor = ''; item.style.borderColor = 'var(--mu-border-light, #eee)'; };
    item.onclick = onClick;
    return item;
  };

  // Helper function to create a category item (for search results)
  const createCategoryItem = (category, onSelect, isSelected = false) => {
    const item = document.createElement('div');
    item.style.cssText = `
      display: flex; align-items: center; padding: 15px; border-radius: 8px;
      cursor: pointer; margin-bottom: 10px;
      border: 2px solid ${isSelected ? '#007bff' : 'var(--mu-border-light, #eee)'};
      transition: all 0.2s; position: relative;
      background-color: ${isSelected ? '#e7f1ff' : 'var(--mu-bg-primary, white)'};
    `;

    const iconContainer = document.createElement('div');
    iconContainer.style.cssText = 'margin-right: 15px; flex-shrink: 0;';
    const iconDiv = document.createElement('div');
    iconDiv.style.cssText = `
      width: 32px; height: 32px; border-radius: 4px;
      background-color: ${category.groupColor || '#f0f0f0'};
      display: flex; align-items: center; justify-content: center;
      font-size: 14px; color: white;
    `;
    iconDiv.textContent = category.icon || '📁';
    iconContainer.appendChild(iconDiv);
    item.appendChild(iconContainer);

    const textContainer = document.createElement('div');
    textContainer.style.flexGrow = '1';
    const nameDiv = document.createElement('div');
    nameDiv.style.cssText = 'font-weight: bold;';
    nameDiv.textContent = category.name;
    textContainer.appendChild(nameDiv);

    if (category.groupName) {
      const groupDiv = document.createElement('div');
      groupDiv.style.cssText = 'font-size: 0.85em; color: var(--mu-text-secondary, #666);';
      groupDiv.textContent = category.groupName;
      textContainer.appendChild(groupDiv);
    }

    if (typeof category.similarityScore === 'number') {
      const scorePercent = Math.round(category.similarityScore * 100);
      let scoreColor = '#e74c3c';
      if (category.similarityScore > 0.95) scoreColor = '#27ae60';
      else if (category.similarityScore > 0.7) scoreColor = '#f39c12';
      const scoreDiv = document.createElement('div');
      scoreDiv.style.cssText = `font-size: 0.8em; font-weight: bold; color: ${scoreColor};`;
      scoreDiv.textContent = `${scorePercent}% match`;
      textContainer.appendChild(scoreDiv);
    }

    item.appendChild(textContainer);

    if (isSelected) {
      const checkmark = document.createElement('div');
      checkmark.style.cssText = 'margin-left: 10px; color: #007bff; font-size: 1.2em; font-weight: bold;';
      checkmark.textContent = '✓';
      item.appendChild(checkmark);
    }

    item.onmouseover = () => { if (!isSelected) { item.style.backgroundColor = 'var(--mu-hover-bg, #f5f5f5)'; item.style.borderColor = 'var(--mu-border-color, #ddd)'; } };
    item.onmouseout = () => { if (!isSelected) { item.style.backgroundColor = 'var(--mu-bg-primary, white)'; item.style.borderColor = 'var(--mu-border-light, #eee)'; } };
    item.onclick = onSelect;
    return item;
  };

  // Create selection display section
  const selectionSection = document.createElement('div');
  selectionSection.id = 'category-selector-selection-section';
  selectionSection.style.cssText = 'margin-top: 15px; padding: 12px; background: var(--mu-bg-secondary, #f8f9fa); border: 1px solid var(--mu-border, #ddd); border-radius: 6px;';

  const selectionLabel = document.createElement('div');
  selectionLabel.style.cssText = 'font-size: 0.85em; color: var(--mu-text-secondary, #666); margin-bottom: 5px;';
  selectionLabel.textContent = 'Selected Category:';
  selectionSection.appendChild(selectionLabel);

  const selectionDisplay = document.createElement('div');
  selectionDisplay.id = 'category-selector-selection-display';
  selectionDisplay.style.cssText = 'padding: 10px; border: 1px solid var(--mu-border, #ddd); border-radius: 4px; background: var(--mu-bg-secondary, #f8f9fa);';

  const selectionText = document.createElement('span');
  selectionText.id = 'category-selector-selection-text';
  selectionText.style.cssText = 'color: var(--mu-text-muted, #888);';
  selectionText.textContent = 'No category selected';
  selectionDisplay.appendChild(selectionText);
  selectionSection.appendChild(selectionDisplay);

  // Create action buttons section
  const buttonSection = document.createElement('div');
  buttonSection.id = 'category-selector-button-section';
  buttonSection.style.cssText = 'margin-top: 15px; display: flex; gap: 10px; justify-content: flex-end;';

  const saveRuleBtn = document.createElement('button');
  saveRuleBtn.id = 'category-selector-save-rule-btn';
  saveRuleBtn.textContent = 'Save as Rule';
  saveRuleBtn.disabled = true;
  saveRuleBtn.style.cssText = 'padding: 10px 16px; background-color: #cccccc; color: #666; border: none; border-radius: 4px; cursor: not-allowed; font-size: 14px;';
  saveRuleBtn.onclick = () => {
    if (selectedCategory) {
      debugLog('Save as Rule clicked:', { name: selectedCategory.name, id: selectedCategory.id });
      cleanupKeyboard();
      overlay.remove();
      callback({ ...selectedCategory, assignmentType: 'rule' });
    }
  };

  const assignOnceBtn = document.createElement('button');
  assignOnceBtn.id = 'category-selector-assign-once-btn';
  assignOnceBtn.textContent = 'Assign Once';
  assignOnceBtn.disabled = true;
  assignOnceBtn.style.cssText = 'padding: 10px 16px; background-color: #cccccc; color: #666; border: none; border-radius: 4px; cursor: not-allowed; font-size: 14px;';
  assignOnceBtn.onclick = () => {
    if (selectedCategory) {
      debugLog('Assign Once clicked:', { name: selectedCategory.name, id: selectedCategory.id });
      cleanupKeyboard();
      overlay.remove();
      callback({ ...selectedCategory, assignmentType: 'once' });
    }
  };

  buttonSection.appendChild(saveRuleBtn);
  buttonSection.appendChild(assignOnceBtn);

  // Helper function to update selection display and button states
  const updateSelectionUI = () => {
    if (selectedCategory) {
      selectionText.textContent = selectedCategory.name;
      selectionText.style.color = '#333';
      selectionText.style.fontWeight = 'bold';
      selectionDisplay.style.borderColor = '#28a745';
      selectionDisplay.style.backgroundColor = '#f0fff0';
    } else {
      selectionText.textContent = 'No category selected';
      selectionText.style.color = '#888';
      selectionText.style.fontWeight = 'normal';
      selectionDisplay.style.borderColor = '#ddd';
      selectionDisplay.style.backgroundColor = '#f8f9fa';
    }

    const hasSelection = selectedCategory !== null;
    saveRuleBtn.disabled = !hasSelection;
    assignOnceBtn.disabled = !hasSelection;

    if (hasSelection) {
      saveRuleBtn.style.backgroundColor = '#007bff';
      saveRuleBtn.style.color = 'white';
      saveRuleBtn.style.cursor = 'pointer';
      assignOnceBtn.style.backgroundColor = '#28a745';
      assignOnceBtn.style.color = 'white';
      assignOnceBtn.style.cursor = 'pointer';
    } else {
      saveRuleBtn.style.backgroundColor = '#cccccc';
      saveRuleBtn.style.color = '#666';
      saveRuleBtn.style.cursor = 'not-allowed';
      assignOnceBtn.style.backgroundColor = '#cccccc';
      assignOnceBtn.style.color = '#666';
      assignOnceBtn.style.cursor = 'not-allowed';
    }
  };

  // Define updateDisplay function
  const updateDisplay = () => {
    contentContainer.innerHTML = '';
    const items = [];

    if (searchQuery) {
      const filteredCategories = [];
      categoryGroups.forEach((group) => {
        group.categories.forEach((category) => {
          if (category.name.toLowerCase().includes(searchQuery)) {
            filteredCategories.push({
              ...category,
              groupName: group.name,
              groupColor: getGroupColor(group.type || group.name),
            });
          }
        });
      });

      filteredCategories.sort((a, b) => {
        if (typeof a.similarityScore === 'number' && typeof b.similarityScore === 'number') {
          if (b.similarityScore !== a.similarityScore) return b.similarityScore - a.similarityScore;
        }
        return a.name.localeCompare(b.name);
      });

      if (filteredCategories.length === 0) {
        const noResults = document.createElement('div');
        noResults.textContent = 'No categories found matching your search.';
        noResults.style.cssText = 'color: #666; padding: 20px 0; text-align: center;';
        contentContainer.appendChild(noResults);
        selectedCategory = null;
        updateSelectionUI();
      } else {
        if (filteredCategories.length === 1) {
          selectedCategory = filteredCategories[0];
          updateSelectionUI();
        }

        filteredCategories.forEach((category) => {
          const isSelected = selectedCategory && selectedCategory.id === category.id;
          const item = createCategoryItem(category, () => {
            debugLog('Selected category from search:', { name: category.name, id: category.id });
            selectedCategory = category;
            updateSelectionUI();
            updateDisplay();
          }, isSelected);
          contentContainer.appendChild(item);
          items.push(item);
        });
      }
    } else {
      if (!categoryGroups.length) {
        const noGroups = document.createElement('div');
        noGroups.textContent = 'No category groups found.';
        noGroups.style.cssText = 'color: #666; padding: 20px 0;';
        contentContainer.appendChild(noGroups);
      }

      categoryGroups.forEach((group) => {
        const item = createGroupItem(group, () => {
          debugLog('Navigating to category selector for group:', group.name);
          cleanupKeyboard();
          overlay.remove();
          showCategorySelector(group, bankCategory, callback, categoryGroups, transactionDetails);
        });
        contentContainer.appendChild(item);
        items.push(item);
      });
    }

    if (items.length > 0) {
      const originalCleanup = makeItemsKeyboardNavigable(items, (item) => { item.click(); }, 0);
      cleanupKeyboard = () => {
        if (document.activeElement === searchElements.input) return;
        originalCleanup();
      };
    }
  };

  searchElements = createSearchInput('Search categories...', (query) => {
    searchQuery = query;
    updateDisplay();
    setTimeout(() => searchElements.input.focus(), 0);
  });

  searchPlaceholder.replaceWith(searchElements.container);
  updateDisplay();

  modal.appendChild(selectionSection);
  modal.appendChild(buttonSection);

  addModalKeyboardHandlers(overlay, () => {
    cleanupKeyboard();
    overlay.remove();
    callback(null);
  });

  document.addEventListener('keydown', (e) => {
    if (document.activeElement === searchElements.input) e.stopPropagation();
  }, true);

  setTimeout(() => searchElements.input.focus(), 100);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

/**
 * Show the category selection screen for a specific group
 * @param {Object} categoryGroup - Category group object with categories
 * @param {string} bankCategory - Bank category name being mapped
 * @param {Function} callback - Callback for category selection
 * @param {Array} allCategoryGroups - All category groups for navigation
 * @param {Object} transactionDetails - Optional transaction details
 */
function showCategorySelector(categoryGroup, bankCategory, callback, allCategoryGroups, transactionDetails = null) {
  const categories = categoryGroup.categories || [];

  debugLog('Showing category selector for group:', {
    groupName: categoryGroup.name,
    categoriesCount: categories.length,
    bankCategory,
  });

  if (!categories.length) {
    toast.show(`No categories found in group "${categoryGroup.name}"`, 'error');
    callback(null);
    return;
  }

  let cleanupKeyboard = () => {};
  let actionBarCleanup = () => {};
  let overlay;

  const closeModal = () => {
    cleanupKeyboard();
    actionBarCleanup();
    overlay.remove();
    callback(null);
  };

  const backAction = () => {
    debugLog('Navigating back to category group list');
    cleanupKeyboard();
    overlay.remove();
    showCategoryGroupSelector(allCategoryGroups, bankCategory, callback, null, transactionDetails);
  };

  overlay = createModalOverlay(closeModal);

  const modal = document.createElement('div');
  modal.style.cssText = `
    background: var(--mu-bg-primary, white);
    color: var(--mu-text-primary, #333);
    padding: 25px; border-radius: 8px; width: 90%; max-width: 500px;
    max-height: 80vh; overflow-y: auto;
  `;

  const backButton = document.createElement('div');
  backButton.style.cssText = 'display: flex; align-items: center; font-size: 0.9em; color: var(--mu-link-color, #0066cc); cursor: pointer; margin-bottom: 20px;';
  backButton.innerHTML = '&lsaquo; Back to category groups';
  backButton.onclick = backAction;
  modal.appendChild(backButton);

  const header = document.createElement('h2');
  header.style.cssText = 'margin-top:0; margin-bottom: 20px; font-size: 1.2em; color: var(--mu-text-primary, #333);';
  header.textContent = categoryGroup.name;
  modal.appendChild(header);

  let searchQuery = '';
  let cleanupItemNavigation = () => {};
  let searchElements;

  if (transactionDetails) {
    const transactionInfo = document.createElement('div');
    transactionInfo.style.cssText = 'background: var(--mu-bg-secondary, #f8f9fa); border: 1px solid var(--mu-border, #dee2e6); border-radius: 6px; padding: 12px; margin-bottom: 15px;';
    transactionInfo.innerHTML = buildTransactionDetailsHtml(transactionDetails);
    modal.appendChild(transactionInfo);
  }

  const bankCategoryRef = document.createElement('div');
  bankCategoryRef.style.cssText = 'margin-bottom: 15px; font-size: 0.95em; color: var(--mu-text-secondary, #666);';
  bankCategoryRef.innerHTML = `Selecting Monarch category for bank category: <b>${bankCategory}</b>`;
  modal.appendChild(bankCategoryRef);

  const topActionBar = createTopActionBar(
    () => {
      debugLog('Skip clicked (detail view) - skipping categorization for this transaction');
      cleanupKeyboard();
      actionBarCleanup();
      overlay.remove();
      toast.show('Skipped categorization for this transaction', 'info');
      setTimeout(() => callback({ name: 'Uncategorized', assignmentType: 'once', skipped: true }), 0);
    },
    () => {
      debugLog('Skip All clicked (detail view) - skipping remaining category selections for this sync');
      cleanupKeyboard();
      actionBarCleanup();
      overlay.remove();
      toast.show('Skipping categorization for remaining transactions', 'info');
      setTimeout(() => callback({ skipAll: true }), 0);
    },
    closeModal,
  );
  actionBarCleanup = () => { if (topActionBar.cleanupFn) topActionBar.cleanupFn(); };
  modal.appendChild(topActionBar);

  const searchPlaceholder = document.createElement('div');
  modal.appendChild(searchPlaceholder);

  const contentContainer = document.createElement('div');
  modal.appendChild(contentContainer);

  const updateDisplay = () => {
    contentContainer.innerHTML = '';
    const categoryItems = [];

    const sortedCategories = [...categories].sort((a, b) => {
      if (typeof a.similarityScore === 'number' && typeof b.similarityScore === 'number') {
        if (b.similarityScore !== a.similarityScore) return b.similarityScore - a.similarityScore;
      }
      if (a.order !== b.order) return a.order - b.order;
      return a.name.localeCompare(b.name);
    });

    const filteredCategories = searchQuery
      ? sortedCategories.filter((cat) => cat.name.toLowerCase().includes(searchQuery))
      : sortedCategories;

    if (filteredCategories.length === 0) {
      const noResults = document.createElement('div');
      noResults.textContent = 'No categories found matching your search.';
      noResults.style.cssText = 'color: #666; padding: 20px 0; text-align: center;';
      contentContainer.appendChild(noResults);
    } else {
      filteredCategories.forEach((category) => {
        const item = document.createElement('div');
        item.style.cssText = `
          display: flex; align-items: center; padding: 15px; border-radius: 8px;
          cursor: pointer; margin-bottom: 10px; border: 1px solid var(--mu-border-light, #eee);
          transition: all 0.2s; position: relative;
        `;

        const iconContainer = document.createElement('div');
        iconContainer.style.cssText = 'margin-right: 15px; flex-shrink: 0;';
        const iconDiv = document.createElement('div');
        iconDiv.style.cssText = 'width: 32px; height: 32px; border-radius: 4px; background-color: var(--mu-bg-tertiary, #f0f0f0); display: flex; align-items: center; justify-content: center; font-size: 14px; color: var(--mu-text-secondary, #666);';
        iconDiv.textContent = category.icon || '📁';
        iconContainer.appendChild(iconDiv);
        item.appendChild(iconContainer);

        const textContainer = document.createElement('div');
        textContainer.style.flexGrow = '1';
        const nameDiv = document.createElement('div');
        nameDiv.style.cssText = 'font-weight: bold;';
        nameDiv.textContent = category.name;
        textContainer.appendChild(nameDiv);

        if (category.isSystemCategory) {
          const systemDiv = document.createElement('div');
          systemDiv.style.cssText = 'font-size: 0.8em; color: #888;';
          systemDiv.textContent = 'System category';
          textContainer.appendChild(systemDiv);
        }

        if (typeof category.similarityScore === 'number') {
          const scorePercent = Math.round(category.similarityScore * 100);
          let scoreColor = '#e74c3c';
          if (category.similarityScore > 0.95) scoreColor = '#27ae60';
          else if (category.similarityScore > 0.7) scoreColor = '#f39c12';
          const scoreDiv = document.createElement('div');
          scoreDiv.style.cssText = `font-size: 0.8em; font-weight: bold; color: ${scoreColor};`;
          scoreDiv.textContent = `${scorePercent}% match`;
          textContainer.appendChild(scoreDiv);
        }

        item.appendChild(textContainer);

        item.onmouseover = () => { item.style.backgroundColor = 'var(--mu-hover-bg, #f5f5f5)'; item.style.borderColor = 'var(--mu-border-color, #ddd)'; };
        item.onmouseout = () => { item.style.backgroundColor = ''; item.style.borderColor = 'var(--mu-border-light, #eee)'; };

        item.onclick = () => {
          debugLog('Selected category:', { name: category.name, id: category.id });
          cleanupKeyboard();
          overlay.remove();
          callback(category);
        };

        contentContainer.appendChild(item);
        categoryItems.push(item);
      });
    }

    if (categoryItems.length > 0) {
      const originalCleanup = makeItemsKeyboardNavigable(
        categoryItems,
        (_item, index) => {
          const category = filteredCategories[index];
          debugLog('Keyboard selecting category:', { name: category.name, id: category.id });
          cleanupKeyboard();
          overlay.remove();
          callback(category);
        },
        0,
      );

      cleanupItemNavigation = () => {
        if (document.activeElement === searchElements.input) return;
        originalCleanup();
      };
    }
  };

  searchElements = createSearchInput('Search within this group...', (query) => {
    searchQuery = query;
    updateDisplay();
    setTimeout(() => searchElements.input.focus(), 0);
  });

  searchPlaceholder.replaceWith(searchElements.container);
  updateDisplay();

  const cleanupModalHandlers = addModalKeyboardHandlers(overlay, closeModal);

  document.addEventListener('keydown', (e) => {
    if (document.activeElement === searchElements.input) e.stopPropagation();
  }, true);

  backButton.setAttribute('tabindex', '0');
  backButton.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      backAction();
    }
  });

  cleanupKeyboard = () => {
    cleanupModalHandlers();
    cleanupItemNavigation();
  };

  setTimeout(() => searchElements.input.focus(), 100);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

/**
 * Show manual transaction categorization dialog for transactions with no matching rule
 * Displays the full transaction JSON and asks user to provide merchant name and category
 * Does NOT save any mapping - this is one-time categorization only
 *
 * @param {Object} transaction - Raw transaction object from Wealthsimple API
 * @param {Function} callback - Callback with { category, merchant } or null if cancelled
 * @returns {Promise} Promise that resolves when selection is complete
 */
export async function showManualTransactionCategorization(transaction, callback) {
  debugLog('Starting manual transaction categorization for:', transaction.externalCanonicalId);

  try {
    debugLog('Fetching category data from Monarch');
    const categoryData = await monarchApi.getCategoriesAndGroups();

    const categoryGroups = categoryData.categoryGroups || [];
    const categories = categoryData.categories || [];

    if (!categoryGroups.length && !categories.length) {
      toast.show('No categories found in Monarch', 'error');
      callback(null);
      return;
    }

    const categoriesByGroup = {};
    categories.forEach((category) => {
      if (!category.isDisabled && category.group) {
        const groupId = category.group.id;
        if (!categoriesByGroup[groupId]) {
          categoriesByGroup[groupId] = [];
        }
        categoriesByGroup[groupId].push(category);
      }
    });

    const groupsWithCategories = categoryGroups
      .map((group) => ({
        ...group,
        categories: categoriesByGroup[group.id] || [],
        categoryCount: (categoriesByGroup[group.id] || []).length,
      }))
      .filter((group) => group.categoryCount > 0)
      .sort((a, b) => a.order - b.order);

    if (!groupsWithCategories.length) {
      toast.show('No valid category groups found', 'error');
      callback(null);
      return;
    }

    // Inject showCategoryGroupSelector to avoid circular dependency
    showManualCategorizationDialog(transaction, groupsWithCategories, callback, showCategoryGroupSelector);
  } catch (error) {
    debugLog('Failed to get category data:', error);
    toast.show('Failed to load categories from Monarch', 'error');
    callback(null);
  }
}

export default {
  create: createCategorySelector,
  showMonarchCategorySelector,
  showCategoryGroupSelector,
  showCategorySelector,
  showManualTransactionCategorization,
};
