/**
 * Category Selector - Shared UI Utilities
 * Common helper functions for category selector components
 */

interface SearchInputResult {
  container: HTMLDivElement;
  input: HTMLInputElement;
}

interface SplitSkipButtonElement extends HTMLDivElement {
  cleanupFn?: () => void;
}

interface TopActionBarElement extends HTMLDivElement {
  cleanupFn?: () => void;
}

/**
 * Create a search input element
 * @param placeholder - Placeholder text for the input
 * @param onSearch - Callback function when search value changes
 * @returns Object containing the container and input elements
 */
export function createSearchInput(placeholder: string, onSearch: (query: string) => void): SearchInputResult {
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
    border: 1px solid var(--mu-input-border, #ddd);
    border-radius: 6px;
    font-size: 14px;
    box-sizing: border-box;
    background: var(--mu-input-bg, white);
    color: var(--mu-input-text, #333);
  `;

  searchInput.addEventListener('input', (e) => {
    onSearch((e.target as HTMLInputElement).value.toLowerCase());
  });

  searchContainer.appendChild(searchInput);

  // Return both container and input for reference
  return { container: searchContainer, input: searchInput };
}

/**
 * Create a split "Skip" button with dropdown for skip-all option
 * @param onSkipThis - Callback when "Skip" (single) is clicked
 * @param onSkipAll - Callback when "Skip All" is clicked
 * @returns The split button container element
 */
export function createSplitSkipButton(onSkipThis: () => void, onSkipAll: () => void): SplitSkipButtonElement {
  const container = document.createElement('div') as SplitSkipButtonElement;
  container.id = 'category-selector-skip-container';
  container.style.cssText = 'position: relative; display: inline-flex;';

  const skipBtn = document.createElement('button');
  skipBtn.id = 'category-selector-skip-btn';
  skipBtn.textContent = 'Skip';
  skipBtn.title = 'Skip categorization for this transaction';
  skipBtn.style.cssText = `
    padding: 10px 18px;
    background-color: var(--mu-close-btn-bg, #6c757d);
    color: white;
    border: none;
    border-right: 1px solid rgba(255,255,255,0.3);
    border-radius: 4px 0 0 4px;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
  `;
  skipBtn.onmouseover = () => { skipBtn.style.filter = 'brightness(0.85)'; };
  skipBtn.onmouseout = () => { skipBtn.style.filter = ''; };
  skipBtn.onclick = (e) => { e.stopPropagation(); onSkipThis(); };

  const dropdownBtn = document.createElement('button');
  dropdownBtn.id = 'category-selector-skip-dropdown-btn';
  dropdownBtn.textContent = '\u25BE';
  dropdownBtn.title = 'More skip options';
  dropdownBtn.style.cssText = `
    padding: 10px 10px;
    background-color: var(--mu-close-btn-bg, #6c757d);
    color: white;
    border: none;
    border-radius: 0 4px 4px 0;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
  `;
  dropdownBtn.onmouseover = () => { dropdownBtn.style.filter = 'brightness(0.85)'; };
  dropdownBtn.onmouseout = () => { dropdownBtn.style.filter = ''; };

  const dropdownMenu = document.createElement('div');
  dropdownMenu.id = 'category-selector-skip-dropdown-menu';
  dropdownMenu.style.cssText = `
    display: none;
    position: absolute;
    top: 100%;
    right: 0;
    min-width: 100%;
    box-sizing: border-box;
    margin-top: 0;
    background: var(--mu-close-btn-bg, #6c757d);
    border: none;
    border-radius: 0 0 4px 4px;
    z-index: 10001;
  `;

  const skipAllOption = document.createElement('div');
  skipAllOption.id = 'category-selector-skip-all-option';
  skipAllOption.style.cssText = `
    padding: 10px 18px;
    cursor: pointer;
    font-size: 14px;
    color: white;
    white-space: nowrap;
  `;
  skipAllOption.onmouseover = () => { skipAllOption.style.filter = 'brightness(0.85)'; };
  skipAllOption.onmouseout = () => { skipAllOption.style.filter = ''; };
  skipAllOption.textContent = 'Skip All';

  skipAllOption.onclick = (e) => { e.stopPropagation(); dropdownMenu.style.display = 'none'; onSkipAll(); };
  dropdownMenu.appendChild(skipAllOption);

  dropdownBtn.onclick = (e) => {
    e.stopPropagation();
    const isOpen = dropdownMenu.style.display !== 'none';
    dropdownMenu.style.display = isOpen ? 'none' : 'block';
    // Remove bottom border-radius from main buttons when open
    if (!isOpen) {
      skipBtn.style.borderRadius = '4px 0 0 0';
      dropdownBtn.style.borderRadius = '0';
    } else {
      skipBtn.style.borderRadius = '4px 0 0 4px';
      dropdownBtn.style.borderRadius = '0 4px 4px 0';
    }
  };

  const closeDropdown = (e: Event): void => {
    if (!container.contains(e.target as Node)) {
      dropdownMenu.style.display = 'none';
      skipBtn.style.borderRadius = '4px 0 0 4px';
      dropdownBtn.style.borderRadius = '0 4px 4px 0';
    }
  };
  document.addEventListener('click', closeDropdown, true);

  container.appendChild(skipBtn);
  container.appendChild(dropdownBtn);
  container.appendChild(dropdownMenu);
  container.cleanupFn = () => { document.removeEventListener('click', closeDropdown, true); };

  return container;
}

/**
 * Create the top action bar with Skip (split) and Cancel buttons
 * @param onSkipThis - Callback when "Skip" (single) is clicked
 * @param onSkipAll - Callback when "Skip All remaining" is clicked
 * @param onCancel - Callback when "Cancel" is clicked
 * @returns The action bar element
 */
export function createTopActionBar(onSkipThis: () => void, onSkipAll: () => void, onCancel: () => void): TopActionBarElement {
  const actionBar = document.createElement('div') as TopActionBarElement;
  actionBar.id = 'category-selector-action-bar';
  actionBar.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;';

  const cancelBtn = document.createElement('button');
  cancelBtn.id = 'category-selector-cancel-btn';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = `
    padding: 10px 18px;
    background-color: transparent;
    color: var(--mu-danger-bg, #dc3545);
    border: 1px solid var(--mu-danger-bg, #dc3545);
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
  `;
  cancelBtn.onmouseover = () => { cancelBtn.style.backgroundColor = 'var(--mu-danger-bg, #dc3545)'; cancelBtn.style.color = 'var(--mu-danger-text, white)'; };
  cancelBtn.onmouseout = () => { cancelBtn.style.backgroundColor = 'transparent'; cancelBtn.style.color = 'var(--mu-danger-bg, #dc3545)'; };
  cancelBtn.onclick = onCancel;
  actionBar.appendChild(cancelBtn);

  const splitSkip = createSplitSkipButton(onSkipThis, onSkipAll);
  actionBar.appendChild(splitSkip);

  actionBar.cleanupFn = () => { if (splitSkip.cleanupFn) splitSkip.cleanupFn(); };
  return actionBar;
}

/**
 * Create a modal overlay with standard styling
 * @param onClickOutside - Handler for clicking outside modal
 * @returns Overlay element
 */
export function createModalOverlay(onClickOutside?: () => void): HTMLDivElement {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: var(--mu-overlay-bg, rgba(0,0,0,0.7));
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
 * @param groupType - Group type or name
 * @returns Hex color code
 */
export function getGroupColor(groupType: string): string {
  const colors: Record<string, string> = {
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
 * @param groupType - Group type or name
 * @returns Single character icon
 */
export function getGroupIcon(groupType: string): string {
  const icons: Record<string, string> = {
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