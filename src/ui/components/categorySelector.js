/**
 * Category Selector Component
 * A reusable dropdown for selecting Monarch categories with sophisticated modal UI
 * Follows the same design patterns as the account selector
 */

import { debugLog } from '../../core/utils';
import monarchApi from '../../api/monarch';
import toast from '../toast';
import { addModalKeyboardHandlers, makeItemsKeyboardNavigable } from '../keyboardNavigation';

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
  // Create container
  const container = document.createElement('div');
  container.className = 'category-selector-container';
  container.style.cssText = 'margin: 10px 0; display: flex; flex-direction: column; gap: 5px;';

  // Create label
  const label = document.createElement('label');
  label.textContent = labelText || `Select Monarch category for "${bankCategory}":`;
  label.style.cssText = 'font-weight: bold; font-size: 14px;';
  container.appendChild(label);

  // Create select element
  const select = document.createElement('select');
  select.className = 'category-selector';
  select.style.cssText = 'padding: 8px; border-radius: 4px; border: 1px solid #ccc; font-size: 14px; width: 100%;';

  if (required) {
    select.setAttribute('required', 'required');
  }

  // Add placeholder option
  const placeholderOption = document.createElement('option');
  placeholderOption.value = '';
  placeholderOption.textContent = placeholderText;
  placeholderOption.disabled = true;
  placeholderOption.selected = !selectedId;
  select.appendChild(placeholderOption);

  // Add category options
  categories.forEach((category) => {
    const option = document.createElement('option');
    option.value = category.id;
    option.textContent = category.name;
    option.selected = category.id === selectedId;
    select.appendChild(option);
  });

  // Handle empty categories array
  if (categories.length === 0) {
    select.disabled = true;
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = 'No categories available';
    select.appendChild(emptyOption);
  }

  // Add event listener
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

    // If we have pre-calculated similarity data, use it directly
    if (similarityInfo && similarityInfo.categoryGroups && similarityInfo.categoryGroups.length > 0) {
      debugLog('Using pre-calculated similarity data for category selection');
      groupsWithCategories = similarityInfo.categoryGroups;
    } else {
      // Fallback to original behavior if no similarity data provided
      debugLog('No similarity data provided, falling back to original behavior');

      // Fetch categories and category groups from Monarch
      debugLog('Fetching category data from Monarch');
      const categoryData = await monarchApi.getCategoriesAndGroups();

      const categoryGroups = categoryData.categoryGroups || [];
      const categories = categoryData.categories || [];

      if (!categoryGroups.length && !categories.length) {
        toast.show('No categories found in Monarch', 'error');
        callback(null);
        return;
      }

      // Group categories by their group
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

      // Create group list with category counts (no similarity sorting)
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

    // Display the category groups
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
 * Create a search input element
 * @param {string} placeholder - Placeholder text for the input
 * @param {Function} onSearch - Callback function when search value changes
 * @returns {Object} Object containing the container and input elements
 */
function createSearchInput(placeholder, onSearch) {
  const searchContainer = document.createElement('div');
  searchContainer.style.cssText = `
    margin-bottom: 15px;
    position: relative;
  `;

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = placeholder;
  searchInput.style.cssText = `
    width: 100%;
    padding: 10px 12px;
    border: 1px solid #ddd;
    border-radius: 6px;
    font-size: 14px;
    box-sizing: border-box;
  `;

  searchInput.addEventListener('input', (e) => {
    onSearch(e.target.value.toLowerCase());
  });

  searchContainer.appendChild(searchInput);

  // Return both container and input for reference
  return { container: searchContainer, input: searchInput };
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

  // Set up keyboard navigation cleanup function
  let cleanupKeyboard = () => {};

  // Create overlay
  const overlay = createModalOverlay(() => {
    cleanupKeyboard();
    overlay.remove();
    callback(null);
  });

  // Create modal content
  const modal = document.createElement('div');
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
  header.style.cssText = 'margin-top:0; margin-bottom: 20px; font-size: 1.2em;';
  header.textContent = 'Select Category Group';
  modal.appendChild(header);

  // Initialize search query variable
  let searchQuery = '';

  // Track selected category (for two-button UI)
  let selectedCategory = null;

  // Declare searchElements in outer scope (will be initialized later)
  let searchElements;

  // Add transaction details section if available
  if (transactionDetails) {
    const transactionInfo = document.createElement('div');
    transactionInfo.style.cssText = `
      background: #f8f9fa;
      border: 1px solid #dee2e6;
      border-radius: 6px;
      padding: 12px;
      margin-bottom: 15px;
    `;

    let transactionHtml = '<div style="font-weight: bold; margin-bottom: 8px; color: #333;">Transaction Details:</div>';

    // Add merchant name if available
    if (transactionDetails.merchant) {
      transactionHtml += `<div style="margin-bottom: 4px;">
        <span style="color: #666;">Merchant:</span> 
        <span style="font-weight: 500; color: #333;">${transactionDetails.merchant}</span>
      </div>`;
    }

    // Add amount if available
    if (transactionDetails.amount !== undefined && transactionDetails.amount !== null) {
      let formattedAmount = '';
      let amountValue = 0;

      // Handle amount as object with value and currency properties
      if (typeof transactionDetails.amount === 'object' && transactionDetails.amount.value !== undefined) {
        amountValue = parseFloat(transactionDetails.amount.value) || 0;
        const currency = transactionDetails.amount.currency || 'CAD';
        formattedAmount = `$${Math.abs(amountValue).toFixed(2)} ${currency}`;
      } else if (typeof transactionDetails.amount === 'number') {
        // Fallback for simple number
        amountValue = transactionDetails.amount;
        formattedAmount = `$${Math.abs(amountValue).toFixed(2)}`;
      } else {
        // Fallback for string or other formats
        formattedAmount = String(transactionDetails.amount);
      }

      // Determine color based on institution
      // For Wealthsimple: negative = red (expense), positive = green (credit/payment)
      // For Rogers and others: negative = green (credit/refund), positive = red (expense)
      const isWealthsimple = transactionDetails.institution === 'wealthsimple';
      let amountColor;
      if (isWealthsimple) {
        amountColor = amountValue < 0 ? '#dc3545' : '#28a745';
      } else {
        amountColor = amountValue < 0 ? '#28a745' : '#dc3545';
      }

      transactionHtml += `<div style="margin-bottom: 4px;">
        <span style="color: #666;">Amount:</span> 
        <span style="font-weight: 500; color: ${amountColor};">${formattedAmount}</span>
      </div>`;
    }

    // Add date if available
    if (transactionDetails.date) {
      transactionHtml += `<div style="margin-bottom: 4px;">
        <span style="color: #666;">Date:</span> 
        <span style="font-weight: 500; color: #333;">${transactionDetails.date}</span>
      </div>`;
    }

    // Add AFT details if available (for DEPOSIT/AFT transactions)
    if (transactionDetails.aftDetails) {
      const aft = transactionDetails.aftDetails;

      if (aft.aftOriginatorName) {
        transactionHtml += `<div style="margin-bottom: 4px;">
          <span style="color: #666;">Originator:</span>
          <span style="font-weight: 500; color: #333;">${aft.aftOriginatorName}</span>
        </div>`;
      }

      if (aft.aftTransactionType) {
        transactionHtml += `<div style="margin-bottom: 4px;">
          <span style="color: #666;">AFT Type:</span>
          <span style="font-weight: 500; color: #333;">${aft.aftTransactionType}</span>
        </div>`;
      }

      if (aft.aftTransactionCategory) {
        transactionHtml += `<div style="margin-bottom: 4px;">
          <span style="color: #666;">AFT Category:</span>
          <span style="font-weight: 500; color: #333;">${aft.aftTransactionCategory}</span>
        </div>`;
      }
    }

    // Add P2P details if available (for P2P_PAYMENT transactions)
    if (transactionDetails.p2pDetails) {
      const p2p = transactionDetails.p2pDetails;

      if (p2p.type) {
        transactionHtml += `<div style="margin-bottom: 4px;">
          <span style="color: #666;">Type:</span>
          <span style="font-weight: 500; color: #333;">${p2p.type}</span>
        </div>`;
      }

      if (p2p.subType) {
        transactionHtml += `<div style="margin-bottom: 4px;">
          <span style="color: #666;">SubType:</span>
          <span style="font-weight: 500; color: #333;">${p2p.subType}</span>
        </div>`;
      }

      if (p2p.p2pHandle) {
        transactionHtml += `<div style="margin-bottom: 4px;">
          <span style="color: #666;">Handle:</span>
          <span style="font-weight: 500; color: #333;">${p2p.p2pHandle}</span>
        </div>`;
      }
    }

    transactionInfo.innerHTML = transactionHtml;
    modal.appendChild(transactionInfo);
  }

  // Add bank category reference with similarity score if available
  const bankCategoryRef = document.createElement('div');
  bankCategoryRef.style.cssText = 'margin-bottom: 15px; font-size: 0.95em; color: #666;';
  let bankCategoryHtml = `Selecting Monarch category for bank category: <b>${bankCategory}</b>`;

  // Add similarity score if provided
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

  // Create placeholder for search container (will be filled after updateDisplay is defined)
  const searchPlaceholder = document.createElement('div');
  modal.appendChild(searchPlaceholder);

  // Create containers for dynamic content
  const contentContainer = document.createElement('div');
  modal.appendChild(contentContainer);

  // Helper function to create a group item
  const createGroupItem = (group, onClick) => {
    const item = document.createElement('div');
    item.style.cssText = `
        display: flex;
        align-items: center;
        padding: 15px;
        border-radius: 8px;
        cursor: pointer;
        margin-bottom: 15px;
        border: 1px solid #eee;
        transition: all 0.2s;
        position: relative;
      `;

    // Create left section with icon
    const iconContainer = document.createElement('div');
    iconContainer.style.cssText = 'margin-right: 15px; flex-shrink: 0;';

    const iconDiv = document.createElement('div');
    iconDiv.style.cssText = `
        width: 40px;
        height: 40px;
        border-radius: 5px;
        background-color: ${getGroupColor(group.type || group.name)};
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 20px;
        color: white;
        font-weight: bold;
      `;
    iconDiv.textContent = getGroupIcon(group.type || group.name);
    iconContainer.appendChild(iconDiv);
    item.appendChild(iconContainer);

    // Create center section with text details
    const infoDiv = document.createElement('div');
    infoDiv.style.cssText = 'flex-grow: 1;';

    const nameDiv = document.createElement('div');
    nameDiv.style.cssText = 'font-weight: bold; font-size: 1.1em;';
    nameDiv.textContent = group.name;
    infoDiv.appendChild(nameDiv);

    const countDiv = document.createElement('div');
    countDiv.style.cssText = 'font-size: 0.9em; color: #666;';
    countDiv.textContent = `${group.categoryCount} categories`;
    infoDiv.appendChild(countDiv);

    // Add similarity score if available
    if (typeof group.maxSimilarityScore === 'number') {
      const scorePercent = Math.round(group.maxSimilarityScore * 100);
      let scoreColor = '#e74c3c';
      if (group.maxSimilarityScore > 0.95) {
        scoreColor = '#27ae60';
      } else if (group.maxSimilarityScore > 0.7) {
        scoreColor = '#f39c12';
      }

      const scoreDiv = document.createElement('div');
      scoreDiv.style.cssText = `font-size: 0.85em; font-weight: bold; color: ${scoreColor};`;
      scoreDiv.textContent = `${scorePercent}% match`;
      infoDiv.appendChild(scoreDiv);
    }

    item.appendChild(infoDiv);

    // Add right arrow icon
    const arrowContainer = document.createElement('div');
    arrowContainer.style.cssText = `
        margin-left: 15px;
        font-size: 1.5em;
        color: #aaa;
        position: relative;
        z-index: 1;
      `;
    arrowContainer.innerHTML = '&rsaquo;';
    item.appendChild(arrowContainer);

    // Add hover effect
    item.onmouseover = () => {
      item.style.backgroundColor = '#f5f5f5';
      item.style.borderColor = '#ddd';
    };
    item.onmouseout = () => {
      item.style.backgroundColor = '';
      item.style.borderColor = '#eee';
    };

    item.onclick = onClick;
    return item;
  };

  // Helper function to create a category item (for search results) - selects but doesn't submit
  const createCategoryItem = (category, onSelect, isSelected = false) => {
    const item = document.createElement('div');
    item.style.cssText = `
        display: flex;
        align-items: center;
        padding: 15px;
        border-radius: 8px;
        cursor: pointer;
        margin-bottom: 10px;
        border: 2px solid ${isSelected ? '#007bff' : '#eee'};
        transition: all 0.2s;
        position: relative;
        background-color: ${isSelected ? '#e7f1ff' : 'white'};
      `;

    // Create icon container
    const iconContainer = document.createElement('div');
    iconContainer.style.cssText = 'margin-right: 15px; flex-shrink: 0;';

    const iconDiv = document.createElement('div');
    iconDiv.style.cssText = `
        width: 32px;
        height: 32px;
        border-radius: 4px;
        background-color: ${category.groupColor || '#f0f0f0'};
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        color: white;
      `;
    iconDiv.textContent = category.icon || '📁';
    iconContainer.appendChild(iconDiv);
    item.appendChild(iconContainer);

    // Create text container
    const textContainer = document.createElement('div');
    textContainer.style.flexGrow = '1';

    const nameDiv = document.createElement('div');
    nameDiv.style.cssText = 'font-weight: bold;';
    nameDiv.textContent = category.name;
    textContainer.appendChild(nameDiv);

    // Show group name
    if (category.groupName) {
      const groupDiv = document.createElement('div');
      groupDiv.style.cssText = 'font-size: 0.85em; color: #666;';
      groupDiv.textContent = category.groupName;
      textContainer.appendChild(groupDiv);
    }

    // Add similarity score if available
    if (typeof category.similarityScore === 'number') {
      const scorePercent = Math.round(category.similarityScore * 100);
      let scoreColor = '#e74c3c';
      if (category.similarityScore > 0.95) {
        scoreColor = '#27ae60';
      } else if (category.similarityScore > 0.7) {
        scoreColor = '#f39c12';
      }

      const scoreDiv = document.createElement('div');
      scoreDiv.style.cssText = `font-size: 0.8em; font-weight: bold; color: ${scoreColor};`;
      scoreDiv.textContent = `${scorePercent}% match`;
      textContainer.appendChild(scoreDiv);
    }

    item.appendChild(textContainer);

    // Add selection checkmark if selected
    if (isSelected) {
      const checkmark = document.createElement('div');
      checkmark.style.cssText = `
        margin-left: 10px;
        color: #007bff;
        font-size: 1.2em;
        font-weight: bold;
      `;
      checkmark.textContent = '✓';
      item.appendChild(checkmark);
    }

    // Hover effects (only if not selected)
    item.onmouseover = () => {
      if (!isSelected) {
        item.style.backgroundColor = '#f5f5f5';
        item.style.borderColor = '#ddd';
      }
    };
    item.onmouseout = () => {
      if (!isSelected) {
        item.style.backgroundColor = 'white';
        item.style.borderColor = '#eee';
      }
    };

    item.onclick = onSelect;
    return item;
  };

  // Create selection display section FIRST (before updateSelectionUI function)
  const selectionSection = document.createElement('div');
  selectionSection.id = 'category-selector-selection-section';
  selectionSection.style.cssText = `
    margin-top: 15px;
    padding: 12px;
    background: #f8f9fa;
    border: 1px solid #ddd;
    border-radius: 6px;
  `;

  const selectionLabel = document.createElement('div');
  selectionLabel.style.cssText = 'font-size: 0.85em; color: #666; margin-bottom: 5px;';
  selectionLabel.textContent = 'Selected Category:';
  selectionSection.appendChild(selectionLabel);

  const selectionDisplay = document.createElement('div');
  selectionDisplay.id = 'category-selector-selection-display';
  selectionDisplay.style.cssText = `
    padding: 10px;
    border: 1px solid #ddd;
    border-radius: 4px;
    background: #f8f9fa;
  `;

  const selectionText = document.createElement('span');
  selectionText.id = 'category-selector-selection-text';
  selectionText.style.cssText = 'color: #888;';
  selectionText.textContent = 'No category selected';
  selectionDisplay.appendChild(selectionText);
  selectionSection.appendChild(selectionDisplay);

  // Create action buttons section
  const buttonSection = document.createElement('div');
  buttonSection.id = 'category-selector-button-section';
  buttonSection.style.cssText = `
    margin-top: 15px;
    display: flex;
    gap: 10px;
    justify-content: flex-end;
  `;

  // Cancel button
  const cancelBtn = document.createElement('button');
  cancelBtn.id = 'category-selector-cancel-btn';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = `
    padding: 10px 16px;
    background-color: #f5f5f5;
    color: #333;
    border: 1px solid #ddd;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
  `;
  cancelBtn.onclick = () => {
    cleanupKeyboard();
    overlay.remove();
    callback(null);
  };

  // Save as Rule button
  const saveRuleBtn = document.createElement('button');
  saveRuleBtn.id = 'category-selector-save-rule-btn';
  saveRuleBtn.textContent = 'Save as Rule';
  saveRuleBtn.disabled = true;
  saveRuleBtn.style.cssText = `
    padding: 10px 16px;
    background-color: #cccccc;
    color: #666;
    border: none;
    border-radius: 4px;
    cursor: not-allowed;
    font-size: 14px;
  `;
  saveRuleBtn.onclick = () => {
    if (selectedCategory) {
      debugLog('Save as Rule clicked:', { name: selectedCategory.name, id: selectedCategory.id });
      cleanupKeyboard();
      overlay.remove();
      // assignmentType: 'rule' means save to persistent storage and apply to all matching
      callback({ ...selectedCategory, assignmentType: 'rule' });
    }
  };

  // Assign Once button
  const assignOnceBtn = document.createElement('button');
  assignOnceBtn.id = 'category-selector-assign-once-btn';
  assignOnceBtn.textContent = 'Assign Once';
  assignOnceBtn.disabled = true;
  assignOnceBtn.style.cssText = `
    padding: 10px 16px;
    background-color: #cccccc;
    color: #666;
    border: none;
    border-radius: 4px;
    cursor: not-allowed;
    font-size: 14px;
  `;
  assignOnceBtn.onclick = () => {
    if (selectedCategory) {
      debugLog('Assign Once clicked:', { name: selectedCategory.name, id: selectedCategory.id });
      cleanupKeyboard();
      overlay.remove();
      // assignmentType: 'once' means only apply to this specific transaction
      callback({ ...selectedCategory, assignmentType: 'once' });
    }
  };

  // Skip All button (skip remaining categories for this sync session)
  const skipAllBtn = document.createElement('button');
  skipAllBtn.id = 'category-selector-skip-all-btn';
  skipAllBtn.textContent = 'Skip All (this sync)';
  skipAllBtn.style.cssText = `
    padding: 10px 16px;
    background-color: #6c757d;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
  `;
  skipAllBtn.onclick = () => {
    debugLog('Skip All clicked - skipping remaining category selections for this sync');
    cleanupKeyboard();
    overlay.remove();
    callback({ skipAll: true });
  };

  buttonSection.appendChild(cancelBtn);
  buttonSection.appendChild(skipAllBtn);
  buttonSection.appendChild(saveRuleBtn);
  buttonSection.appendChild(assignOnceBtn);

  // Helper function to update selection display and button states
  const updateSelectionUI = () => {
    // Update selection display
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

    // Update button states
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

  // Define updateDisplay function first before using it in search input
  const updateDisplay = () => {
    contentContainer.innerHTML = '';
    const items = [];

    if (searchQuery) {
      // Search mode: show filtered categories from all groups
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

      // Sort by similarity score if available, then by name
      filteredCategories.sort((a, b) => {
        if (typeof a.similarityScore === 'number' && typeof b.similarityScore === 'number') {
          if (b.similarityScore !== a.similarityScore) {
            return b.similarityScore - a.similarityScore;
          }
        }
        return a.name.localeCompare(b.name);
      });

      if (filteredCategories.length === 0) {
        const noResults = document.createElement('div');
        noResults.textContent = 'No categories found matching your search.';
        noResults.style.cssText = 'color: #666; padding: 20px 0; text-align: center;';
        contentContainer.appendChild(noResults);
        // Clear selection when no results
        selectedCategory = null;
        updateSelectionUI();
      } else {
        // Auto-select if exactly one result
        if (filteredCategories.length === 1) {
          selectedCategory = filteredCategories[0];
          updateSelectionUI();
        }

        // Display filtered categories
        filteredCategories.forEach((category) => {
          const isSelected = selectedCategory && selectedCategory.id === category.id;
          const item = createCategoryItem(category, () => {
            debugLog('Selected category from search:', { name: category.name, id: category.id });
            selectedCategory = category;
            updateSelectionUI();
            updateDisplay(); // Re-render to show selection state
          }, isSelected);
          contentContainer.appendChild(item);
          items.push(item);
        });
      }
    } else {
      // Normal mode: show category groups
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
          // Pass selectedCategory state to child modal
          showCategorySelector(group, bankCategory, callback, categoryGroups, transactionDetails);
        });
        contentContainer.appendChild(item);
        items.push(item);
      });
    }

    // Update keyboard navigation for new items
    if (items.length > 0) {
      // Wrap the keyboard navigation handler to check if search has focus
      const originalCleanup = makeItemsKeyboardNavigable(
        items,
        (item) => {
          item.click();
        },
        0,
      );

      // Override cleanup to also check for search focus
      cleanupKeyboard = () => {
        // Don't process keyboard navigation if search input has focus
        if (document.activeElement === searchElements.input) {
          return;
        }
        originalCleanup();
      };
    }
  };

  // Now create the search input with access to updateDisplay function
  searchElements = createSearchInput('Search categories...', (query) => {
    searchQuery = query;
    updateDisplay();
    // Keep focus on search input after update
    setTimeout(() => searchElements.input.focus(), 0);
  });

  // Replace the placeholder with actual search container
  searchPlaceholder.replaceWith(searchElements.container);

  // Initial display
  updateDisplay();

  // Add selection section and button section to modal
  modal.appendChild(selectionSection);
  modal.appendChild(buttonSection);

  // Add keyboard handlers for the modal (Escape to close)
  addModalKeyboardHandlers(overlay, () => {
    cleanupKeyboard();
    overlay.remove();
    callback(null);
  });

  // Override keyboard event handling to check if search has focus
  document.addEventListener('keydown', (e) => {
    // If search input has focus, don't let keyboard navigation interfere
    if (document.activeElement === searchElements.input) {
      e.stopPropagation();
    }
  }, true);

  // Focus search input initially
  setTimeout(() => searchElements.input.focus(), 100);

  // Show the modal
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

/**
 * Show the category selection screen for a specific group
 * @param {Object} categoryGroup - Category group object with categories
 * @param {string} bankCategory - Bank category name being mapped
 * @param {Function} callback - Callback for category selection
 * @param {Array} allCategoryGroups - All category groups for navigation
 * @param {Object} transactionDetails - Optional transaction details (merchant, amount, etc.)
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

  // Set up keyboard navigation cleanup function
  let cleanupKeyboard = () => {};

  // Create the overlay first
  let overlay;

  // Helper to close modal with cleanup
  const closeModal = () => {
    cleanupKeyboard();
    overlay.remove();
    callback(null);
  };

  const backAction = () => {
    debugLog('Navigating back to category group list');
    cleanupKeyboard();
    overlay.remove();
    // Re-show the category group selector with transaction details
    showCategoryGroupSelector(allCategoryGroups, bankCategory, callback, null, transactionDetails);
  };

  // Now initialize the overlay with the closeModal function
  overlay = createModalOverlay(closeModal);

  // Create the modal
  const modal = document.createElement('div');
  modal.style.cssText = `
    background: white;
    padding: 25px;
    border-radius: 8px;
    width: 90%;
    max-width: 500px;
    max-height: 80vh;
    overflow-y: auto;
  `;

  // Create back button
  const backButton = document.createElement('div');
  backButton.style.cssText = `
    display: flex;
    align-items: center;
    font-size: 0.9em;
    color: #0066cc;
    cursor: pointer;
    margin-bottom: 20px;
  `;
  backButton.innerHTML = '&lsaquo; Back to category groups';
  backButton.onclick = backAction;
  modal.appendChild(backButton);

  // Add header with group name
  const header = document.createElement('h2');
  header.style.cssText = 'margin-top:0; margin-bottom: 20px; font-size: 1.2em;';
  header.textContent = categoryGroup.name;
  modal.appendChild(header);

  // Initialize search and navigation variables
  let searchQuery = '';
  let cleanupItemNavigation = () => {};

  // Declare searchElements in outer scope (will be initialized later)
  let searchElements;

  // Add transaction details section if available
  if (transactionDetails) {
    const transactionInfo = document.createElement('div');
    transactionInfo.style.cssText = `
      background: #f8f9fa;
      border: 1px solid #dee2e6;
      border-radius: 6px;
      padding: 12px;
      margin-bottom: 15px;
    `;

    let transactionHtml = '<div style="font-weight: bold; margin-bottom: 8px; color: #333;">Transaction Details:</div>';

    // Add merchant name if available
    if (transactionDetails.merchant) {
      transactionHtml += `<div style="margin-bottom: 4px;">
        <span style="color: #666;">Merchant:</span>
        <span style="font-weight: 500; color: #333;">${transactionDetails.merchant}</span>
      </div>`;
    }

    // Add amount if available
    if (transactionDetails.amount !== undefined && transactionDetails.amount !== null) {
      let formattedAmount = '';
      let amountValue = 0;

      // Handle amount as object with value and currency properties
      if (typeof transactionDetails.amount === 'object' && transactionDetails.amount.value !== undefined) {
        amountValue = parseFloat(transactionDetails.amount.value) || 0;
        const currency = transactionDetails.amount.currency || 'CAD';
        formattedAmount = `$${Math.abs(amountValue).toFixed(2)} ${currency}`;
      } else if (typeof transactionDetails.amount === 'number') {
        // Fallback for simple number
        amountValue = transactionDetails.amount;
        formattedAmount = `$${Math.abs(amountValue).toFixed(2)}`;
      } else {
        // Fallback for string or other formats
        formattedAmount = String(transactionDetails.amount);
      }

      const amountColor = amountValue < 0 ? '#28a745' : '#dc3545';
      transactionHtml += `<div style="margin-bottom: 4px;">
        <span style="color: #666;">Amount:</span>
        <span style="font-weight: 500; color: ${amountColor};">${formattedAmount}</span>
      </div>`;
    }

    // Add date if available
    if (transactionDetails.date) {
      transactionHtml += `<div style="margin-bottom: 4px;">
        <span style="color: #666;">Date:</span>
        <span style="font-weight: 500; color: #333;">${transactionDetails.date}</span>
      </div>`;
    }

    transactionInfo.innerHTML = transactionHtml;
    modal.appendChild(transactionInfo);
  }

  // Add bank category reference
  const bankCategoryRef = document.createElement('div');
  bankCategoryRef.style.cssText = 'margin-bottom: 15px; font-size: 0.95em;';
  bankCategoryRef.innerHTML = `Selecting Monarch category for bank category: <b>${bankCategory}</b>`;
  modal.appendChild(bankCategoryRef);

  // Create placeholder for search container (will be filled after updateDisplay is defined)
  const searchPlaceholder = document.createElement('div');
  modal.appendChild(searchPlaceholder);

  // Create container for dynamic content
  const contentContainer = document.createElement('div');
  modal.appendChild(contentContainer);

  // Define updateDisplay function first before using it in search input
  const updateDisplay = () => {
    contentContainer.innerHTML = '';
    const categoryItems = [];

    // Sort categories by similarity score (if available), then by order, then by name
    const sortedCategories = [...categories].sort((a, b) => {
      if (typeof a.similarityScore === 'number' && typeof b.similarityScore === 'number') {
        if (b.similarityScore !== a.similarityScore) {
          return b.similarityScore - a.similarityScore;
        }
      }
      if (a.order !== b.order) {
        return a.order - b.order;
      }
      return a.name.localeCompare(b.name);
    });

    // Filter categories based on search
    const filteredCategories = searchQuery
      ? sortedCategories.filter((cat) => cat.name.toLowerCase().includes(searchQuery))
      : sortedCategories;

    if (filteredCategories.length === 0) {
      const noResults = document.createElement('div');
      noResults.textContent = 'No categories found matching your search.';
      noResults.style.cssText = 'color: #666; padding: 20px 0; text-align: center;';
      contentContainer.appendChild(noResults);
    } else {
      // Add categories
      filteredCategories.forEach((category) => {
        // Create list item container
        const item = document.createElement('div');
        item.style.cssText = `
          display: flex;
          align-items: center;
          padding: 15px;
          border-radius: 8px;
          cursor: pointer;
          margin-bottom: 10px;
          border: 1px solid #eee;
          transition: all 0.2s;
          position: relative;
        `;

        // Create icon container
        const iconContainer = document.createElement('div');
        iconContainer.style.cssText = 'margin-right: 15px; flex-shrink: 0;';

        // Category icon
        const iconDiv = document.createElement('div');
        iconDiv.style.cssText = `
          width: 32px;
          height: 32px;
          border-radius: 4px;
          background-color: #f0f0f0;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          color: #666;
        `;
        iconDiv.textContent = category.icon || '📁';
        iconContainer.appendChild(iconDiv);
        item.appendChild(iconContainer);

        // Create text container
        const textContainer = document.createElement('div');
        textContainer.style.flexGrow = '1';

        // Category name
        const nameDiv = document.createElement('div');
        nameDiv.style.cssText = 'font-weight: bold;';
        nameDiv.textContent = category.name;
        textContainer.appendChild(nameDiv);

        // System category indicator
        if (category.isSystemCategory) {
          const systemDiv = document.createElement('div');
          systemDiv.style.cssText = 'font-size: 0.8em; color: #888;';
          systemDiv.textContent = 'System category';
          textContainer.appendChild(systemDiv);
        }

        // Add similarity score if available
        if (typeof category.similarityScore === 'number') {
          const scorePercent = Math.round(category.similarityScore * 100);
          let scoreColor = '#e74c3c'; // Red for low scores
          if (category.similarityScore > 0.95) {
            scoreColor = '#27ae60'; // Green for high scores
          } else if (category.similarityScore > 0.7) {
            scoreColor = '#f39c12'; // Orange for medium scores
          }

          const scoreDiv = document.createElement('div');
          scoreDiv.style.cssText = `font-size: 0.8em; font-weight: bold; color: ${scoreColor};`;
          scoreDiv.textContent = `${scorePercent}% match`;
          textContainer.appendChild(scoreDiv);
        }

        item.appendChild(textContainer);

        // Hover effects
        item.onmouseover = () => {
          item.style.backgroundColor = '#f5f5f5';
          item.style.borderColor = '#ddd';
        };
        item.onmouseout = () => {
          item.style.backgroundColor = '';
          item.style.borderColor = '#eee';
        };

        // Click handler
        item.onclick = () => {
          debugLog('Selected category:', { name: category.name, id: category.id });
          cleanupKeyboard();
          overlay.remove();
          callback(category); // Return the full category object
        };

        contentContainer.appendChild(item);
        categoryItems.push(item);
      });
    }

    // Update keyboard navigation for new items
    if (categoryItems.length > 0) {
      const originalCleanup = makeItemsKeyboardNavigable(
        categoryItems,
        (_item, index) => {
          // Same logic as click handler
          const category = filteredCategories[index];
          debugLog('Keyboard selecting category:', { name: category.name, id: category.id });
          cleanupKeyboard();
          overlay.remove();
          callback(category); // Return the full category object
        },
        0, // Focus first item initially
      );

      // Override cleanup to check for search focus
      cleanupItemNavigation = () => {
        // Don't process keyboard navigation if search input has focus
        if (document.activeElement === searchElements.input) {
          return;
        }
        originalCleanup();
      };
    }
  };

  // Now create the search input with access to updateDisplay function
  searchElements = createSearchInput('Search within this group...', (query) => {
    searchQuery = query;
    updateDisplay();
    // Keep focus on search input after update
    setTimeout(() => searchElements.input.focus(), 0);
  });

  // Replace the placeholder with actual search container
  searchPlaceholder.replaceWith(searchElements.container);

  // Initial display
  updateDisplay();

  // Add a cancel button
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = `
    padding: 8px 16px;
    background-color: #f5f5f5;
    color: #333;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    margin-top: 10px;
  `;
  cancelBtn.onclick = closeModal;
  modal.appendChild(cancelBtn);

  // Add keyboard handlers for the modal (Escape to close)
  const cleanupModalHandlers = addModalKeyboardHandlers(overlay, closeModal);

  // Override keyboard event handling to check if search has focus
  document.addEventListener('keydown', (e) => {
    // If search input has focus, don't let keyboard navigation interfere
    if (document.activeElement === searchElements.input) {
      e.stopPropagation();
    }
  }, true);

  // Make back button keyboard navigable
  backButton.setAttribute('tabindex', '0');
  backButton.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      backAction();
    }
  });

  // Combine cleanup functions
  cleanupKeyboard = () => {
    cleanupModalHandlers();
    cleanupItemNavigation();
  };

  // Focus search input initially
  setTimeout(() => searchElements.input.focus(), 100);

  // Show the modal
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

/**
 * Create a modal overlay with standard styling
 * @param {Function} onClickOutside - Handler for clicking outside modal
 * @returns {HTMLElement} Overlay element
 */
function createModalOverlay(onClickOutside) {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;

  // Add click outside handler if provided
  if (onClickOutside) {
    overlay.onclick = (e) => {
      if (e.target === overlay) {
        onClickOutside();
      }
    };
  }

  return overlay;
}

/**
 * Get color for category group based on type or name
 * @param {string} groupType - Group type or name
 * @returns {string} Hex color code
 */
function getGroupColor(groupType) {
  const colors = {
    expense: '#e74c3c',
    income: '#27ae60',
    transfer: '#3498db',
    investment: '#9b59b6',
    default: '#95a5a6',
  };

  const lowerType = (groupType || '').toLowerCase();

  // Check for exact matches first
  if (colors[lowerType]) {
    return colors[lowerType];
  }

  // Check for substring matches
  if (lowerType.includes('income')) return colors.income;
  if (lowerType.includes('expense')) return colors.expense;
  if (lowerType.includes('transfer')) return colors.transfer;
  if (lowerType.includes('investment')) return colors.investment;

  return colors.default;
}

/**
 * Get icon for category group based on type or name
 * @param {string} groupType - Group type or name
 * @returns {string} Single character icon
 */
function getGroupIcon(groupType) {
  const icons = {
    expense: '💸',
    income: '💰',
    transfer: '🔄',
    investment: '📈',
    default: '📁',
  };

  const lowerType = (groupType || '').toLowerCase();

  // Check for exact matches first
  if (icons[lowerType]) {
    return icons[lowerType];
  }

  // Check for substring matches
  if (lowerType.includes('income')) return icons.income;
  if (lowerType.includes('expense')) return icons.expense;
  if (lowerType.includes('transfer')) return icons.transfer;
  if (lowerType.includes('investment')) return icons.investment;

  return icons.default;
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
    // Fetch categories from Monarch for the category selector
    debugLog('Fetching category data from Monarch');
    const categoryData = await monarchApi.getCategoriesAndGroups();

    const categoryGroups = categoryData.categoryGroups || [];
    const categories = categoryData.categories || [];

    if (!categoryGroups.length && !categories.length) {
      toast.show('No categories found in Monarch', 'error');
      callback(null);
      return;
    }

    // Group categories by their group
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

    // Create group list with category counts
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

    // Show the manual categorization dialog
    showManualCategorizationDialog(transaction, groupsWithCategories, callback);
  } catch (error) {
    debugLog('Failed to get category data:', error);
    toast.show('Failed to load categories from Monarch', 'error');
    callback(null);
  }
}

/**
 * Internal function to show the manual categorization dialog
 * @param {Object} transaction - Raw transaction object
 * @param {Array} categoryGroups - Category groups with categories
 * @param {Function} callback - Callback function
 */
function showManualCategorizationDialog(transaction, categoryGroups, callback) {
  let selectedCategory = null;
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

  const updateSaveButton = () => {
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
    merchantName = e.target.value.trim();
    updateSaveButton();
  });
  merchantSection.appendChild(merchantInput);

  // Category selector click handler
  categoryDisplay.onclick = () => {
    // Temporarily remove the current modal to show category selector
    overlay.style.display = 'none';

    // Create a wrapper callback that re-shows our dialog
    const categorySelectCallback = (selected) => {
      overlay.style.display = 'flex';

      if (selected) {
        selectedCategory = selected;
        categoryText.textContent = selected.name;
        categoryText.style.color = '#333';
        categoryText.style.fontWeight = 'bold';
        updateSaveButton();
      }
    };

    // Show the category group selector
    showCategoryGroupSelector(categoryGroups, 'manual selection', categorySelectCallback);
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

export default {
  create: createCategorySelector,
  showMonarchCategorySelector,
  showCategoryGroupSelector,
  showCategorySelector,
  showManualTransactionCategorization,
};
