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

  // Helper function to create a category item (for search results)
  const createCategoryItem = (category, onClick) => {
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

    // Hover effects
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
      } else {
        // Display filtered categories
        filteredCategories.forEach((category) => {
          const item = createCategoryItem(category, () => {
            debugLog('Selected category from search:', { name: category.name, id: category.id });
            cleanupKeyboard();
            overlay.remove();
            callback(category);
          });
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
  cancelBtn.onclick = () => {
    cleanupKeyboard();
    overlay.remove();
    callback(null);
  };
  modal.appendChild(cancelBtn);

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

export default {
  create: createCategorySelector,
  showMonarchCategorySelector,
  showCategoryGroupSelector,
  showCategorySelector,
};
