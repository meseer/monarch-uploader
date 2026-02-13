/**
 * Security Selector Component
 * A reusable modal for selecting Monarch securities with search functionality
 * Similar pattern to category selector but adapted for securities
 */

import { debugLog } from '../../core/utils';
import monarchApi from '../../api/monarch';
import { addModalKeyboardHandlers, makeItemsKeyboardNavigable } from '../keyboardNavigation';

/**
 * Convert string to Camel Case
 * @param {string} str - String to convert
 * @returns {string} Camel cased string
 */
function toCamelCase(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Show sophisticated Monarch security selector with search
 * @param {Object} position - Questrade position object with security details
 * @param {Function} callback - Callback function to receive selected security
 * @returns {Promise} Promise that resolves when selection is complete
 */
export async function showMonarchSecuritySelector(position, callback) {
  debugLog('Starting security selector for position:', position);

  // Extract security details from nested security object
  const symbol = position.security?.symbol || position.symbol || '';
  const exchange = position.security?.listingMarket || position.security?.listingExchange || position.listingExchange || '';
  const description = position.security?.description || position.description || '';

  // Extract search term - for symbols with dots (e.g., "BRK.B"), search by the part before the dot
  const searchTerm = symbol.includes('.') ? symbol.split('.')[0] : symbol;

  // Set up keyboard navigation cleanup function
  let cleanupKeyboard = () => {};

  // Create overlay first
  let overlay;

  // Helper to close modal with cleanup
  const closeModal = () => {
    cleanupKeyboard();
    overlay.remove();
    callback(null);
  };

  // Initialize the overlay
  overlay = createModalOverlay(closeModal);
  overlay.id = 'security-selector-overlay';

  // Create the modal
  const modal = document.createElement('div');
  modal.id = 'security-selector-modal';
  modal.style.cssText = `
    background: var(--mu-bg-primary, white);
    color: var(--mu-text-primary, #333);
    padding: 25px;
    border-radius: 8px;
    width: 90%;
    max-width: 600px;
    max-height: 80vh;
    overflow-y: auto;
  `;

  // Add header
  const header = document.createElement('h2');
  header.id = 'security-selector-header';
  header.style.cssText = 'margin-top:0; margin-bottom: 20px; font-size: 1.2em;';
  header.textContent = 'Select Monarch Security';
  modal.appendChild(header);

  // Add security details section
  const securityDetails = document.createElement('div');
  securityDetails.id = 'security-selector-details';
  securityDetails.style.cssText = `
    background: var(--mu-bg-secondary, #f8f9fa);
    border: 1px solid var(--mu-border, #dee2e6);
    border-radius: 6px;
    padding: 12px;
    margin-bottom: 15px;
  `;

  let detailsHtml = '<div style="font-weight: bold; margin-bottom: 8px; color: var(--mu-text-primary, #333);">Questrade Position:</div>';

  if (symbol) {
    detailsHtml += `<div style="margin-bottom: 4px;">
      <span style="color: var(--mu-text-secondary, #666);">Symbol:</span> 
      <span style="font-weight: 500; color: var(--mu-text-primary, #333);">${symbol}</span>
    </div>`;
  }

  if (exchange) {
    detailsHtml += `<div style="margin-bottom: 4px;">
      <span style="color: var(--mu-text-secondary, #666);">Exchange:</span> 
      <span style="font-weight: 500; color: var(--mu-text-primary, #333);">${exchange}</span>
    </div>`;
  }

  if (description) {
    detailsHtml += `<div style="margin-bottom: 4px;">
      <span style="color: var(--mu-text-secondary, #666);">Description:</span> 
      <span style="font-weight: 500; color: var(--mu-text-primary, #333);">${toCamelCase(description)}</span>
    </div>`;
  }

  securityDetails.innerHTML = detailsHtml;
  modal.appendChild(securityDetails);

  // Search state
  let currentSearchTerm = searchTerm;
  let searchDebounceTimer = null;

  // Create search input
  const searchContainer = document.createElement('div');
  searchContainer.id = 'security-selector-search-container';
  searchContainer.style.cssText = 'margin-bottom: 15px; position: relative;';

  const searchInput = document.createElement('input');
  searchInput.id = 'security-selector-search-input';
  searchInput.type = 'text';
  searchInput.value = searchTerm;
  searchInput.placeholder = 'Search by symbol or name...';
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
  searchContainer.appendChild(searchInput);
  modal.appendChild(searchContainer);

  // Loading indicator
  const loadingIndicator = document.createElement('div');
  loadingIndicator.id = 'security-selector-loading';
  loadingIndicator.style.cssText = `
    text-align: center;
    padding: 20px;
    color: var(--mu-text-secondary, #666);
    display: none;
  `;
  loadingIndicator.textContent = 'Searching...';
  modal.appendChild(loadingIndicator);

  // Results container with fixed min-height to prevent modal resizing
  const resultsContainer = document.createElement('div');
  resultsContainer.id = 'security-selector-results';
  resultsContainer.style.cssText = 'margin-bottom: 20px; min-height: 400px;';
  modal.appendChild(resultsContainer);

  // Function to perform search and display results
  const performSearch = async (term) => {
    if (!term || term.trim() === '') {
      resultsContainer.innerHTML = '<div style="color: #666; padding: 20px; text-align: center;">Enter a search term to find securities</div>';
      return;
    }

    try {
      loadingIndicator.style.display = 'block';
      resultsContainer.innerHTML = '';

      debugLog(`Searching for securities with term: ${term}`);
      const securities = await monarchApi.searchSecurities(term, { limit: 5 });

      loadingIndicator.style.display = 'none';

      if (!securities || securities.length === 0) {
        resultsContainer.innerHTML = `
          <div style="color: #666; padding: 20px; text-align: center;">
            No securities found for "${term}"<br>
            <small style="color: #999;">Try searching by ticker symbol or company name</small>
          </div>
        `;
        return;
      }

      // Display securities
      const securityItems = [];
      securities.forEach((security) => {
        const item = createSecurityItem(security, () => {
          debugLog('Selected security:', security);
          cleanupKeyboard();
          overlay.remove();
          callback(security);
        });
        resultsContainer.appendChild(item);
        securityItems.push(item);
      });

      // Set up keyboard navigation for security items
      // Don't auto-focus items to preserve search input focus
      if (securityItems.length > 0) {
        const originalCleanup = makeItemsKeyboardNavigable(
          securityItems,
          (item) => {
            item.click();
          },
          null, // Don't auto-focus items - let user keep typing in search
        );

        // Override cleanup to check for search focus
        cleanupKeyboard = () => {
          if (document.activeElement !== searchInput) {
            originalCleanup();
          }
        };
      }

      // Ensure search input maintains focus after results update
      setTimeout(() => {
        if (document.activeElement !== searchInput) {
          searchInput.focus();
        }
      }, 0);
    } catch (error) {
      loadingIndicator.style.display = 'none';
      debugLog('Error searching securities:', error);
      resultsContainer.innerHTML = `
        <div style="color: #d32f2f; padding: 20px; text-align: center;">
          Error searching securities: ${error.message}
        </div>
      `;
    }
  };

  // Set up search input handler with debouncing
  searchInput.addEventListener('input', (e) => {
    const term = e.target.value.trim();

    // Clear previous timer
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
    }

    // Don't search if term hasn't changed
    if (term === currentSearchTerm) {
      return;
    }

    currentSearchTerm = term;

    // Debounce search
    searchDebounceTimer = setTimeout(() => {
      performSearch(term);
    }, 300);
  });

  // Perform initial search with search term
  if (searchTerm) {
    performSearch(searchTerm);
  }

  // Add cancel button
  const cancelBtn = document.createElement('button');
  cancelBtn.id = 'security-selector-cancel';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = `
    padding: 8px 16px;
    background-color: var(--mu-bg-tertiary, #f5f5f5);
    color: var(--mu-text-primary, #333);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    margin-top: 10px;
  `;
  cancelBtn.onclick = closeModal;
  modal.appendChild(cancelBtn);

  // Add keyboard handlers for the modal (Escape to close)
  const cleanupModalHandlers = addModalKeyboardHandlers(overlay, closeModal);

  // Combine cleanup functions
  const originalCleanupKeyboard = cleanupKeyboard;
  cleanupKeyboard = () => {
    cleanupModalHandlers();
    originalCleanupKeyboard();
  };

  // Focus search input initially
  setTimeout(() => searchInput.focus(), 100);

  // Show the modal
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

/**
 * Create a security item element
 * @param {Object} security - Security object from Monarch API
 * @param {Function} onClick - Click handler
 * @returns {HTMLElement} Security item element
 */
function createSecurityItem(security, onClick) {
  const item = document.createElement('div');
  item.id = `security-item-${security.id}`;
  item.style.cssText = `
    display: flex;
    align-items: center;
    padding: 12px;
    border-radius: 6px;
    cursor: pointer;
    margin-bottom: 8px;
    border: 1px solid var(--mu-border-light, #eee);
    transition: all 0.2s;
  `;

  // Logo container
  const logoContainer = document.createElement('div');
  logoContainer.style.cssText = 'margin-right: 12px; flex-shrink: 0;';
  logoContainer.id = `security-logo-container-${security.id}`;

  if (security.logo) {
    // Logo is present - format as data URI if needed and display
    let logoSrc = security.logo;
    if (!logoSrc.startsWith('http') && !logoSrc.startsWith('data:')) {
      logoSrc = `data:image/png;base64,${logoSrc}`;
    }

    // Create img element - data URIs don't need CSP bypass
    const logoImg = document.createElement('img');
    logoImg.id = `security-logo-img-${security.id}`;
    logoImg.src = logoSrc;
    logoImg.style.cssText = 'width: 40px; height: 40px; border-radius: 4px; object-fit: contain;';
    logoContainer.appendChild(logoImg);
  } else {
    // No logo - show fallback
    addLogoFallback(logoContainer, security.ticker || security.name, security.id);
  }
  item.appendChild(logoContainer);

  // Info container
  const infoContainer = document.createElement('div');
  infoContainer.id = `security-info-${security.id}`;
  infoContainer.style.cssText = 'flex-grow: 1; min-width: 0;';

  // Security name
  const nameDiv = document.createElement('div');
  nameDiv.id = `security-name-${security.id}`;
  nameDiv.style.cssText = 'font-weight: 600; color: var(--mu-text-primary, #333); margin-bottom: 2px;';
  nameDiv.textContent = security.name || 'Unknown Security';
  infoContainer.appendChild(nameDiv);

  // Ticker and type
  const detailsDiv = document.createElement('div');
  detailsDiv.id = `security-details-${security.id}`;
  detailsDiv.style.cssText = 'font-size: 0.9em; color: var(--mu-text-secondary, #666); margin-bottom: 2px;';
  const tickerText = security.ticker ? `${security.ticker}` : '';
  const typeText = security.typeDisplay ? ` • ${security.typeDisplay}` : '';
  detailsDiv.textContent = tickerText + typeText;
  infoContainer.appendChild(detailsDiv);

  item.appendChild(infoContainer);

  // Price container (right side)
  if (security.currentPrice !== undefined && security.currentPrice !== null) {
    const priceContainer = document.createElement('div');
    priceContainer.id = `security-price-container-${security.id}`;
    priceContainer.style.cssText = 'text-align: right; margin-left: 12px; flex-shrink: 0;';

    const priceDiv = document.createElement('div');
    priceDiv.id = `security-price-${security.id}`;
    priceDiv.style.cssText = 'font-weight: 600; color: var(--mu-text-primary, #333);';
    priceDiv.textContent = `$${parseFloat(security.currentPrice).toFixed(2)}`;
    priceContainer.appendChild(priceDiv);

    // Show price change if available
    if (security.oneDayChangePercent !== undefined && security.oneDayChangePercent !== null) {
      const changeDiv = document.createElement('div');
      changeDiv.id = `security-price-change-${security.id}`;
      const changePercent = parseFloat(security.oneDayChangePercent);
      const changeColor = changePercent >= 0 ? '#27ae60' : '#e74c3c';
      const changeSymbol = changePercent >= 0 ? '+' : '';
      changeDiv.style.cssText = `font-size: 0.85em; color: ${changeColor};`;
      changeDiv.textContent = `${changeSymbol}${changePercent.toFixed(2)}%`;
      priceContainer.appendChild(changeDiv);
    }

    item.appendChild(priceContainer);
  }

  // Hover effects
  item.onmouseover = () => {
    item.style.backgroundColor = 'var(--mu-hover-bg, #f5f5f5)';
    item.style.borderColor = 'var(--mu-input-border, #ddd)';
  };
  item.onmouseout = () => {
    item.style.backgroundColor = '';
    item.style.borderColor = 'var(--mu-border-light, #eee)';
  };

  item.onclick = onClick;

  return item;
}

/**
 * Add a ticker-based logo fallback
 * @param {HTMLElement} container - Container to add logo to
 * @param {string} text - Ticker text to display
 * @param {string} securityId - Security ID for unique element ID
 */
function addLogoFallback(container, text, securityId) {
  const fullTicker = (text || '?').toUpperCase();

  // Use full ticker if < 4 chars, otherwise use first 4 chars
  const displayText = fullTicker.length < 4 ? fullTicker : fullTicker.substring(0, 4);

  // Adjust font size based on display text length
  let fontSize = '1.2em';
  if (displayText.length === 4) {
    fontSize = '0.85em';
  } else if (displayText.length === 3) {
    fontSize = '1em';
  } else if (displayText.length === 2) {
    fontSize = '1.1em';
  }

  const fallback = document.createElement('div');
  fallback.id = `security-logo-fallback-${securityId}`;
  fallback.style.cssText = `
    width: 40px;
    height: 40px;
    background-color: var(--mu-bg-tertiary, #e0e0e0);
    color: var(--mu-text-secondary, #666);
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: bold;
    font-size: ${fontSize};
    text-align: center;
    padding: 2px;
    box-sizing: border-box;
  `;
  fallback.textContent = displayText;
  container.appendChild(fallback);
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

export default {
  showMonarchSecuritySelector,
};
