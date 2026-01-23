/**
 * Progress Dialog Component
 * Creates and manages the sophisticated progress dialog for bulk account uploads
 * Based on the original script's showProgressDialog functionality
 *
 * Features:
 * - Accordion-style expandable account rows (collapsed by default)
 * - Per-step progress tracking within each account
 * - Dynamic step initialization based on sync process scope
 * - Balance change display showing: $old (date) → $new (+$change / +%)
 */

import { debugLog } from '../../core/utils';

/**
 * Format a date string (YYYY-MM-DD) as "Jan 20" style
 * @param {string} dateString - Date in YYYY-MM-DD format
 * @returns {string} Formatted date like "Jan 20"
 */
function formatShortDate(dateString) {
  if (!dateString) return '';

  try {
    // Parse the date string as local date (not UTC)
    const [year, month, day] = dateString.split('-').map(Number);
    const date = new Date(year, month - 1, day);

    if (Number.isNaN(date.getTime())) {
      return dateString; // Fallback to original
    }

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${monthNames[date.getMonth()]} ${date.getDate()}`;
  } catch (error) {
    return dateString; // Fallback to original
  }
}

/**
 * Format a currency amount with proper formatting
 * @param {number} amount - Amount to format
 * @param {boolean} showSign - Whether to show +/- sign for non-negative amounts
 * @returns {string} Formatted amount like "$1,234.56" or "+$1,234.56"
 */
function formatCurrency(amount, showSign = false) {
  if (amount === undefined || amount === null) return '';

  const absAmount = Math.abs(amount);
  const formatted = `$${absAmount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

  if (showSign) {
    if (amount > 0) return `+${formatted}`;
    if (amount < 0) return `-${formatted}`;
  }

  return amount < 0 ? `-${formatted}` : formatted;
}

/**
 * Calculate step summary for display in collapsed account row
 * Shows the current step being processed, or final status when complete
 * @param {Array} steps - Array of step objects with status
 * @param {Object} balanceChangeData - Optional balance change data to show on completion
 * @returns {Object} Summary object with counts and display text
 */
function calculateStepSummary(steps, balanceChangeData = null) {
  if (!steps || steps.length === 0) {
    return { complete: 0, total: 0, hasError: false, currentStep: null, text: '', color: null };
  }

  let complete = 0;
  let errors = 0;
  let skipped = 0;
  let currentStep = null;

  steps.forEach((step) => {
    if (step.status === 'success') {
      complete += 1;
    } else if (step.status === 'error') {
      errors += 1;
    } else if (step.status === 'skipped') {
      skipped += 1;
    } else if (step.status === 'processing' && !currentStep) {
      currentStep = step;
    }
  });

  const total = steps.length;
  const hasError = errors > 0;
  const allDone = complete + errors + skipped === total;

  let text;
  let color = null; // Color for the summary text (used for balance display)

  if (currentStep) {
    // Show current step being processed
    text = currentStep.message || currentStep.name || 'Processing...';
  } else if (hasError) {
    text = `${complete}/${total} complete, ${errors} error${errors > 1 ? 's' : ''}`;
  } else if (allDone && balanceChangeData) {
    // Show balance change info when complete
    const summaryResult = formatCollapsedBalanceSummary(balanceChangeData);
    text = summaryResult.text;
    color = summaryResult.color;
  } else if (allDone) {
    text = 'Complete';
  } else {
    text = 'Pending';
  }

  return { complete, total, hasError, currentStep, text, color };
}

/**
 * Format balance change summary for collapsed row display
 * @param {Object} balanceChangeData - Balance change data
 * @returns {Object} Summary with text and color
 */
function formatCollapsedBalanceSummary(balanceChangeData) {
  const {
    accountType, changePercent, oldBalance, newBalance,
    transactionCount, debtAsPositive,
  } = balanceChangeData;

  // Investment accounts: show dollar change and percentage
  if (accountType === 'investment') {
    if (oldBalance !== undefined && oldBalance !== null
        && newBalance !== undefined && newBalance !== null) {
      const dollarChange = newBalance - oldBalance;
      const formattedDollarChange = formatCurrency(dollarChange, true);
      const changeSymbol = changePercent > 0 ? '+' : '';
      const formattedPercent = `${changeSymbol}${(changePercent || 0).toFixed(2)}%`;

      // Determine color based on change
      let color;
      if (changePercent > 0) {
        color = '#2e7d32'; // Green
      } else if (changePercent < 0) {
        color = '#c62828'; // Red
      } else {
        color = '#666'; // Grey for no change
      }

      return { text: `${formattedDollarChange} / ${formattedPercent}`, color };
    }
    return { text: 'Complete', color: null };
  }

  // Cash/Credit accounts: show transaction count and colored balance
  const parts = [];

  // Add transaction count if available
  if (transactionCount !== undefined && transactionCount !== null && transactionCount > 0) {
    parts.push(`${transactionCount} new`);
  }

  // Add balance with color coding
  if (newBalance !== undefined && newBalance !== null) {
    const formattedBalance = formatCurrency(newBalance);
    parts.push(formattedBalance);
  }

  // Determine color for cash/credit accounts based on balance change
  // debtAsPositive: true for Rogers (positive balance = debt, increase is bad)
  // debtAsPositive: false/undefined for WS (negative balance = debt, decrease is bad)
  let color = '#666'; // Grey default
  if (changePercent !== undefined && changePercent !== null) {
    if (debtAsPositive) {
      // Rogers-style: positive balance is debt, so increase is bad (red), decrease is good (green)
      if (changePercent > 0) {
        color = '#c62828'; // Red - more debt
      } else if (changePercent < 0) {
        color = '#2e7d32'; // Green - less debt
      }
    } else {
      // WS-style: negative balance is debt
      // For regular cash: increase is green, decrease is red
      // For credit (negative balance): decrease (less negative) is green, increase (more negative) is red
      if (newBalance < 0) {
        // Credit card with negative balance (debt tracked as negative)
        // Balance going from -1000 to -800 (less debt) = changePercent positive = green
        // Balance going from -1000 to -1200 (more debt) = changePercent negative = red
        if (changePercent > 0) {
          color = '#2e7d32'; // Green - less debt
        } else if (changePercent < 0) {
          color = '#c62828'; // Red - more debt
        }
      } else {
        // Regular cash account
        if (changePercent > 0) {
          color = '#2e7d32'; // Green - balance increased
        } else if (changePercent < 0) {
          color = '#c62828'; // Red - balance decreased
        }
      }
    }
  }

  if (parts.length === 0) {
    return { text: 'Complete', color: null };
  }

  return { text: parts.join(' • '), color };
}

/**
 * Get status icon for a step
 * @param {string} status - Step status
 * @returns {string} Icon character
 */
function getStepIcon(status) {
  switch (status) {
  case 'processing':
    return '⟳';
  case 'success':
    return '✓';
  case 'error':
    return '✗';
  case 'skipped':
    return '○';
  case 'pending':
  default:
    return '○';
  }
}

/**
 * Get status color for a step
 * @param {string} status - Step status
 * @returns {string} CSS color value
 */
function getStepColor(status) {
  switch (status) {
  case 'processing':
    return '#1565c0';
  case 'success':
    return '#2e7d32';
  case 'error':
    return '#c62828';
  case 'skipped':
    return '#888';
  case 'pending':
  default:
    return '#888';
  }
}

/**
 * Creates and displays a progress dialog for tracking bulk account uploads
 * @param {Array} accounts - List of account objects with key and nickname/name properties
 * @param {string} title - Dialog title (default: 'Uploading Balance History for All Accounts')
 * @returns {Object} Progress dialog API object
 */
export function showProgressDialog(accounts, title = 'Uploading Balance History for All Accounts') {
  const timestamp = Date.now();

  // Create overlay
  const overlay = document.createElement('div');
  overlay.id = `balance-uploader-overlay-${timestamp}`;
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

  // Create modal
  const modal = document.createElement('div');
  modal.id = `balance-uploader-modal-${timestamp}`;
  modal.style.cssText = `
    background: white;
    padding: 25px;
    border-radius: 8px;
    width: 90%;
    max-width: 650px;
    max-height: 80vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  `;

  // Header
  const header = document.createElement('h2');
  header.id = `balance-uploader-header-${timestamp}`;
  header.style.cssText = `
    margin-top: 0;
    margin-bottom: 15px;
    font-size: 1.2em;
  `;
  header.textContent = title;
  modal.appendChild(header);

  // Account list container
  const accountList = document.createElement('div');
  accountList.id = `balance-uploader-account-list-${timestamp}`;
  accountList.style.cssText = `
    margin-bottom: 20px;
    max-height: 400px;
    overflow-y: auto;
    position: relative;
  `;
  modal.appendChild(accountList);

  // Auto-scroll state management (defined early so it can be used in account row click handlers)
  // Auto-scroll keeps the currently syncing account in view and expands its details
  // It is disabled when user interacts with the dialog (scrolling or clicking to expand/collapse)
  let autoScrollEnabled = true;
  let isProgrammaticAction = false; // Flag to distinguish programmatic scrolling from user scrolling
  let isScrollMonitoringActive = false; // Only start monitoring after first account starts processing

  // Add scroll event listener to detect user scrolling
  // Only monitors after isScrollMonitoringActive is true (when first account starts processing)
  // This prevents false triggers during dialog initialization/rendering
  accountList.addEventListener('scroll', () => {
    if (!isProgrammaticAction && isScrollMonitoringActive) {
      autoScrollEnabled = false;
      debugLog('Auto-scroll disabled due to user scroll interaction');
    }
  });

  // Create account rows
  const accountElements = {};
  accounts.forEach((account) => {
    // Skip null/undefined accounts
    if (!account) {
      return;
    }

    const accountKey = account.key || account.id;

    // Main account container
    const accountContainer = document.createElement('div');
    accountContainer.id = `balance-uploader-account-container-${accountKey}`;
    accountContainer.style.cssText = `
      border: 1px solid #eee;
      border-radius: 6px;
      margin-bottom: 8px;
      overflow: hidden;
    `;

    // Account header row (clickable for accordion)
    const accountRow = document.createElement('div');
    accountRow.id = `balance-uploader-account-row-${accountKey}`;
    accountRow.style.cssText = `
      display: flex;
      align-items: center;
      padding: 12px;
      cursor: pointer;
      transition: background-color 0.2s;
    `;

    // Expand/collapse indicator
    const expandIcon = document.createElement('span');
    expandIcon.id = `balance-uploader-expand-icon-${accountKey}`;
    expandIcon.style.cssText = `
      margin-right: 8px;
      font-size: 0.8em;
      color: #666;
      transition: transform 0.2s;
      display: inline-block;
    `;
    expandIcon.textContent = '▶';
    accountRow.appendChild(expandIcon);

    // Status icon
    const statusIcon = document.createElement('span');
    statusIcon.id = `balance-uploader-account-icon-${accountKey}`;
    statusIcon.style.cssText = `
      margin-right: 10px;
      font-size: 1.2em;
    `;
    statusIcon.textContent = '○'; // Pending
    statusIcon.dataset.status = 'pending';
    accountRow.appendChild(statusIcon);

    // Account name container
    const accountNameContainer = document.createElement('div');
    accountNameContainer.id = `balance-uploader-account-info-${accountKey}`;
    accountNameContainer.style.cssText = `
      flex-grow: 1;
      display: flex;
      flex-direction: column;
      gap: 2px;
    `;

    // Account name
    const accountName = document.createElement('div');
    accountName.style.cssText = 'font-weight: 500;';
    accountName.textContent = account.nickname || account.name || 'Account';
    accountNameContainer.appendChild(accountName);

    // Account ID
    const accountIdDiv = document.createElement('div');
    accountIdDiv.style.cssText = `
      font-size: 0.85em;
      color: #888;
      font-weight: normal;
    `;
    accountIdDiv.textContent = accountKey;
    accountNameContainer.appendChild(accountIdDiv);

    accountRow.appendChild(accountNameContainer);

    // Status text / Step summary
    const statusText = document.createElement('div');
    statusText.id = `balance-uploader-account-status-${accountKey}`;
    statusText.style.cssText = `
      margin-left: 10px;
      color: #888;
      min-width: 120px;
      max-width: 180px;
      word-wrap: break-word;
      text-align: right;
      font-size: 0.9em;
    `;
    statusText.textContent = 'Pending';
    accountRow.appendChild(statusText);

    accountContainer.appendChild(accountRow);

    // Expandable steps container (initially hidden)
    const stepsContainer = document.createElement('div');
    stepsContainer.id = `balance-uploader-steps-container-${accountKey}`;
    stepsContainer.style.cssText = `
      display: none;
      background: #f9f9f9;
      border-top: 1px solid #eee;
      padding: 0;
    `;
    accountContainer.appendChild(stepsContainer);

    // Balance change section (will be added to steps container when expanded)
    const balanceChangeDiv = document.createElement('div');
    balanceChangeDiv.id = `balance-uploader-balance-change-${accountKey}`;
    balanceChangeDiv.style.cssText = `
      display: none;
      padding: 8px 15px;
      margin: 8px 12px;
      border-radius: 4px;
      font-size: 0.9em;
      font-weight: 500;
      text-align: center;
    `;

    // Track expansion state
    let isExpanded = false;

    // Toggle expand/collapse on row click
    accountRow.addEventListener('click', () => {
      // Disable auto-scroll when user manually interacts with expand/collapse
      // Only if this is not a programmatic action
      if (!isProgrammaticAction) {
        autoScrollEnabled = false;
        debugLog('Auto-scroll disabled due to user click on account row');
      }
      isExpanded = !isExpanded;
      stepsContainer.style.display = isExpanded ? 'block' : 'none';
      expandIcon.style.transform = isExpanded ? 'rotate(90deg)' : 'rotate(0deg)';
    });

    // Hover effect
    accountRow.addEventListener('mouseenter', () => {
      if (accountRow.style.backgroundColor === '' || accountRow.style.backgroundColor === 'transparent') {
        accountRow.style.backgroundColor = '#f5f5f5';
      }
    });
    accountRow.addEventListener('mouseleave', () => {
      // Restore the status-based background color
      const currentStatus = statusIcon.dataset.status;
      if (currentStatus === 'processing') {
        accountRow.style.backgroundColor = '#e3f2fd';
      } else if (currentStatus === 'success') {
        accountRow.style.backgroundColor = '#e8f5e9';
      } else if (currentStatus === 'error') {
        accountRow.style.backgroundColor = '#ffebee';
      } else {
        accountRow.style.backgroundColor = 'transparent';
      }
    });

    accountList.appendChild(accountContainer);

    accountElements[accountKey] = {
      container: accountContainer,
      row: accountRow,
      expandIcon,
      icon: statusIcon,
      status: statusText,
      stepsContainer,
      balanceChange: balanceChangeDiv,
      steps: [], // Array of step objects: { key, name, status, message, element }
      balanceChangeData: null, // Stored balance change data for collapsed summary display
      isExpanded: () => isExpanded,
      setExpanded: (expanded) => {
        isExpanded = expanded;
        stepsContainer.style.display = isExpanded ? 'block' : 'none';
        expandIcon.style.transform = isExpanded ? 'rotate(90deg)' : 'rotate(0deg)';
      },
    };
  });

  // Error container (initially hidden)
  const errorContainer = document.createElement('div');
  errorContainer.id = `balance-uploader-error-container-${timestamp}`;
  errorContainer.style.cssText = `
    border: 1px solid #f44336;
    border-radius: 5px;
    padding: 15px;
    margin-bottom: 20px;
    display: none;
  `;
  modal.appendChild(errorContainer);

  // Summary
  const summary = document.createElement('div');
  summary.id = `balance-uploader-summary-${timestamp}`;
  summary.style.cssText = `
    margin-bottom: 20px;
    font-weight: bold;
  `;
  summary.textContent = `Total: ${accounts.length} accounts`;
  modal.appendChild(summary);

  // Buttons container
  const buttonsContainer = document.createElement('div');
  buttonsContainer.id = `balance-uploader-buttons-${timestamp}`;
  buttonsContainer.style.cssText = `
    display: flex;
    justify-content: flex-end;
    gap: 10px;
  `;
  modal.appendChild(buttonsContainer);

  // Cancel button (initially visible)
  const cancelButton = document.createElement('button');
  cancelButton.textContent = 'Cancel Upload';
  cancelButton.style.cssText = `
    padding: 8px 16px;
    border: none;
    border-radius: 4px;
    background: #dc3545;
    color: white;
    cursor: pointer;
    margin-right: 10px;
  `;
  buttonsContainer.appendChild(cancelButton);

  // Close button (initially hidden)
  const closeButton = document.createElement('button');
  closeButton.textContent = 'Close';
  closeButton.style.cssText = `
    padding: 8px 16px;
    border: none;
    border-radius: 4px;
    background: #6c757d;
    color: white;
    cursor: pointer;
    display: none;
  `;
  buttonsContainer.appendChild(closeButton);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // Promise management for error acknowledgment
  const acknowledgmentPromise = {
    promise: null,
    resolve: null,
  };

  // Cancel callback management and state tracking
  let cancelCallback = null;
  let isCancelled = false;
  let uploadState = 'pending'; // 'pending', 'active', 'completed'

  /**
   * Update the step summary display in the account row
   * @param {string} accountId - Account ID
   */
  function updateStepSummaryDisplay(accountId) {
    const el = accountElements[accountId];
    if (!el || !el.steps || el.steps.length === 0) {
      return;
    }

    // Pass balance change data for collapsed summary display when complete
    const summaryData = calculateStepSummary(el.steps, el.balanceChangeData);
    if (summaryData.text) {
      el.status.textContent = summaryData.text;
      // Apply color if specified (for balance change display)
      if (summaryData.color) {
        el.status.style.color = summaryData.color;
      }
    }
  }

  /**
   * Create a step element in the steps container
   * @param {string} accountId - Account ID
   * @param {Object} step - Step object with key, name, status, message
   * @returns {HTMLElement} The created step element
   */
  function createStepElement(accountId, step) {
    const el = accountElements[accountId];
    if (!el) return null;

    const stepDiv = document.createElement('div');
    stepDiv.id = `balance-uploader-step-${accountId}-${step.key}`;
    stepDiv.style.cssText = `
      display: flex;
      align-items: flex-start;
      padding: 8px 12px 8px 36px;
      border-bottom: 1px solid #eee;
      font-size: 0.9em;
    `;

    // Step icon
    const stepIconSpan = document.createElement('span');
    stepIconSpan.id = `balance-uploader-step-icon-${accountId}-${step.key}`;
    stepIconSpan.style.cssText = `
      margin-right: 8px;
      color: ${getStepColor(step.status)};
    `;
    stepIconSpan.textContent = getStepIcon(step.status);
    stepDiv.appendChild(stepIconSpan);

    // Step name
    const stepNameSpan = document.createElement('span');
    stepNameSpan.id = `balance-uploader-step-name-${accountId}-${step.key}`;
    stepNameSpan.style.cssText = `
      flex-grow: 1;
      color: #333;
    `;
    stepNameSpan.textContent = step.name;
    stepDiv.appendChild(stepNameSpan);

    // Step message
    const stepMessageSpan = document.createElement('span');
    stepMessageSpan.id = `balance-uploader-step-message-${accountId}-${step.key}`;
    stepMessageSpan.style.cssText = `
      color: ${getStepColor(step.status)};
      text-align: right;
      max-width: 250px;
      word-wrap: break-word;
    `;
    stepMessageSpan.textContent = step.message || '';
    stepDiv.appendChild(stepMessageSpan);

    el.stepsContainer.appendChild(stepDiv);

    return stepDiv;
  }

  /**
   * Update a step element's display
   * @param {string} accountId - Account ID
   * @param {Object} step - Step object
   */
  function updateStepElement(accountId, step) {
    const iconEl = document.getElementById(`balance-uploader-step-icon-${accountId}-${step.key}`);
    const messageEl = document.getElementById(`balance-uploader-step-message-${accountId}-${step.key}`);

    if (iconEl) {
      iconEl.textContent = getStepIcon(step.status);
      iconEl.style.color = getStepColor(step.status);
    }

    if (messageEl) {
      messageEl.textContent = step.message || '';
      messageEl.style.color = getStepColor(step.status);
    }
  }

  // Dialog API
  const dialog = {
    /**
     * Initialize steps for an account (called before sync starts)
     * @param {string} accountId - Account ID
     * @param {Array} steps - Array of step definitions [{key, name}]
     */
    initSteps: (accountId, steps) => {
      const el = accountElements[accountId];
      if (!el) {
        debugLog(`Warning: Account element not found for ID: ${accountId}`);
        return;
      }

      // Clear existing steps
      el.stepsContainer.innerHTML = '';
      el.steps = [];

      // Create step elements
      steps.forEach((stepDef) => {
        const step = {
          key: stepDef.key,
          name: stepDef.name,
          status: 'pending',
          message: '',
        };
        el.steps.push(step);
        step.element = createStepElement(accountId, step);
      });

      // Add balance change div at the end (will be shown when balance is uploaded)
      el.stepsContainer.appendChild(el.balanceChange);

      debugLog(`Initialized ${steps.length} steps for account ${accountId}`);
    },

    /**
     * Update a specific step's status
     * @param {string} accountId - Account ID
     * @param {string} stepKey - Step key to update
     * @param {string} status - Step status: 'pending', 'processing', 'success', 'error', 'skipped'
     * @param {string} message - Optional message to display
     */
    updateStepStatus: (accountId, stepKey, status, message = '') => {
      const el = accountElements[accountId];
      if (!el) {
        debugLog(`Warning: Account element not found for ID: ${accountId}`);
        return;
      }

      // Find the step
      const step = el.steps.find((s) => s.key === stepKey);
      if (!step) {
        debugLog(`Warning: Step ${stepKey} not found for account ${accountId}`);
        return;
      }

      // Update step data
      step.status = status;
      step.message = message;

      // Update the DOM element
      updateStepElement(accountId, step);

      // Update step summary display
      updateStepSummaryDisplay(accountId);

      // Update account-level icon and colors based on overall status
      const allSuccess = el.steps.every((s) => s.status === 'success' || s.status === 'skipped');
      const hasError = el.steps.some((s) => s.status === 'error');
      const hasProcessing = el.steps.some((s) => s.status === 'processing');

      let accountStatus;
      if (hasError) {
        accountStatus = 'error';
      } else if (hasProcessing) {
        accountStatus = 'processing';
      } else if (allSuccess && el.steps.length > 0) {
        accountStatus = 'success';
      } else {
        accountStatus = 'pending';
      }

      // Update account icon
      el.icon.textContent = getStepIcon(accountStatus);
      el.icon.style.color = getStepColor(accountStatus);
      el.icon.dataset.status = accountStatus;

      // Update row background
      if (accountStatus === 'processing') {
        el.row.style.backgroundColor = '#e3f2fd';
      } else if (accountStatus === 'success') {
        el.row.style.backgroundColor = '#e8f5e9';
      } else if (accountStatus === 'error') {
        el.row.style.backgroundColor = '#ffebee';
      } else {
        el.row.style.backgroundColor = 'transparent';
      }

      // Auto-scroll and auto-expand behavior
      // When account starts processing (first step becomes 'processing'), scroll into view and expand
      // When account completes (all steps done), collapse
      if (autoScrollEnabled) {
        const allDone = el.steps.every((s) =>
          s.status === 'success' || s.status === 'error' || s.status === 'skipped');

        if (accountStatus === 'processing' && status === 'processing') {
          // Activate scroll monitoring on first processing status
          // This ensures dialog initialization scroll events don't disable auto-scroll
          if (!isScrollMonitoringActive) {
            isScrollMonitoringActive = true;
            debugLog('Scroll monitoring activated - first account started processing');
          }

          // Account is actively processing - scroll into view and expand
          isProgrammaticAction = true;

          // Expand the account details
          el.setExpanded(true);

          // Scroll the account container into view within the accountList container
          // Using direct scroll manipulation because scrollIntoView doesn't work
          // reliably for nested scrollable containers
          const containerTop = el.container.offsetTop;

          // Scroll to position the element near the top of the visible area
          // with a small margin for context
          const targetScrollTop = Math.max(0, containerTop - 10);

          accountList.scrollTo({
            top: targetScrollTop,
            behavior: 'smooth',
          });

          // Reset the programmatic action flag after a delay longer than smooth scroll animation
          // (smooth scroll typically takes ~400-500ms)
          setTimeout(() => {
            isProgrammaticAction = false;
          }, 600);

          debugLog(`Auto-scrolled to account ${accountId}, scrollTop: ${targetScrollTop}`);
        } else if (allDone && el.isExpanded()) {
          // Account has completed all steps - collapse the details
          isProgrammaticAction = true;
          el.setExpanded(false);

          setTimeout(() => {
            isProgrammaticAction = false;
          }, 150);

          debugLog(`Auto-collapsed completed account ${accountId}`);
        }
      }

      debugLog(`Updated step ${stepKey} for account ${accountId}: ${status} - ${message}`);
    },

    /**
     * Update progress for a specific account (legacy method for backward compatibility)
     * @param {string} accountId - Account ID to update
     * @param {string} status - Status: 'processing', 'success', 'error', 'pending'
     * @param {string} message - Status message to display
     */
    updateProgress: (accountId, status, message) => {
      const el = accountElements[accountId];
      if (!el) {
        debugLog(`Warning: Account element not found for ID: ${accountId}`);
        return;
      }

      // Update upload state based on account status
      if (status === 'processing' && uploadState === 'pending') {
        uploadState = 'active';
        debugLog('Upload state changed to active');
      } else if ((status === 'success' || status === 'error') && uploadState === 'active') {
        debugLog(`Account ${accountId} finished with status: ${status}`);
      }

      // If steps are initialized, update summary; otherwise use the message directly
      if (el.steps && el.steps.length > 0) {
        // Steps are being used, let step updates handle the status
        // Only update if this is a final status
        if (status === 'success' || status === 'error') {
          el.icon.textContent = getStepIcon(status);
          el.icon.style.color = getStepColor(status);
          el.icon.dataset.status = status;
        }
      } else {
        // No steps initialized, use legacy behavior
        el.status.textContent = message || status;
        el.icon.textContent = getStepIcon(status);
        el.icon.dataset.status = status;
      }

      // Update colors
      if (status === 'processing') {
        el.row.style.backgroundColor = '#e3f2fd';
        el.status.style.color = '#1565c0';
      } else if (status === 'success') {
        el.row.style.backgroundColor = '#e8f5e9';
        el.status.style.color = '#2e7d32';
      } else if (status === 'error') {
        el.row.style.backgroundColor = '#ffebee';
        el.status.style.color = '#c62828';
      } else {
        el.row.style.backgroundColor = 'transparent';
        el.status.style.color = '#888';
      }

      el.icon.style.color = el.status.style.color;
    },

    /**
     * Update balance change information for a specific account
     * This is displayed in the expandable steps section AND in the collapsed row summary
     * New format: $oldBalance (date) → $newBalance (+$dollarChange / +percent%)
     * Example: $132,085.72 (Jan 20) → $133,407.31 (+$1,321.59 / +1.00%)
     * @param {string} accountId - Account ID to update
     * @param {Object} balanceChangeData - Balance change data
     * @param {number} balanceChangeData.oldBalance - Previous balance (optional)
     * @param {number} balanceChangeData.newBalance - Current balance
     * @param {string} balanceChangeData.lastUploadDate - Last upload date in YYYY-MM-DD format (optional)
     * @param {number} balanceChangeData.changePercent - Percentage change (optional, null means no history)
     * @param {number} balanceChangeData.daysUploaded - Number of days uploaded (optional, legacy)
     * @param {string} balanceChangeData.accountType - 'investment' | 'cash' | 'credit' for collapsed summary display
     * @param {number} balanceChangeData.transactionCount - Number of new transactions (for cash/credit accounts)
     * @param {boolean} balanceChangeData.debtAsPositive - True if debt is tracked as positive balance (Rogers style)
     */
    updateBalanceChange: (accountId, balanceChangeData) => {
      const el = accountElements[accountId];
      if (!el || !el.balanceChange) {
        debugLog(`Warning: Balance change element not found for ID: ${accountId}`);
        return;
      }

      try {
        // Store balance change data for collapsed summary display
        el.balanceChangeData = balanceChangeData;

        const {
          oldBalance, newBalance, lastUploadDate, changePercent,
        } = balanceChangeData;

        // Build display string based on available data
        // Full format: $oldBalance (date) → $newBalance (+$dollarChange / +percent%)
        // Fallback: just $newBalance if no old balance data available

        let displayText = '';
        let effectiveChangePercent = changePercent;

        // If we have all the data for the full format
        if (oldBalance !== undefined && oldBalance !== null
            && newBalance !== undefined && newBalance !== null
            && lastUploadDate) {
          // Calculate dollar change
          const dollarChange = newBalance - oldBalance;

          // Calculate percentage if not provided
          if (effectiveChangePercent === undefined || effectiveChangePercent === null) {
            effectiveChangePercent = oldBalance !== 0
              ? ((newBalance - oldBalance) / Math.abs(oldBalance)) * 100
              : 0;
          }

          // Format the components
          const formattedOldBalance = formatCurrency(oldBalance);
          const formattedDate = formatShortDate(lastUploadDate);
          const formattedNewBalance = formatCurrency(newBalance);
          const formattedDollarChange = formatCurrency(dollarChange, true);
          const changeSymbol = effectiveChangePercent > 0 ? '+' : '';
          const formattedPercent = `${changeSymbol}${effectiveChangePercent.toFixed(2)}%`;

          // Build the full format: $old (date) → $new (+$change / +%)
          displayText = `${formattedOldBalance} (${formattedDate}) → ${formattedNewBalance} (${formattedDollarChange} / ${formattedPercent})`;
        } else if (newBalance !== undefined && newBalance !== null) {
          // Fallback: just show the current balance
          displayText = formatCurrency(newBalance);
        } else {
          // No balance data available
          debugLog(`No balance data available for ${accountId}`);
          return;
        }

        // Set the content
        el.balanceChange.textContent = displayText;

        // Set colors based on change (or neutral if no change data)
        let backgroundColor;
        let textColor;
        if (effectiveChangePercent !== undefined && effectiveChangePercent !== null) {
          if (effectiveChangePercent > 0) {
            backgroundColor = '#e8f5e9';
            textColor = '#2e7d32';
          } else if (effectiveChangePercent < 0) {
            backgroundColor = '#ffebee';
            textColor = '#c62828';
          } else {
            // Zero change - neutral gray
            backgroundColor = '#f5f5f5';
            textColor = '#666';
          }
        } else {
          // Neutral color when no change data
          backgroundColor = '#e3f2fd';
          textColor = '#1565c0';
        }

        el.balanceChange.style.backgroundColor = backgroundColor;
        el.balanceChange.style.color = textColor;
        el.balanceChange.style.display = 'block';

        // Update the collapsed row summary to show balance change info
        updateStepSummaryDisplay(accountId);

        debugLog(`Updated balance change for ${accountId}: ${displayText}`);
      } catch (error) {
        debugLog(`Error updating balance change for ${accountId}:`, error);
      }
    },

    /**
     * Show error dialog and wait for user acknowledgment
     * @param {string} accountId - Account ID that had the error
     * @param {Error} error - Error object
     * @returns {Promise} Promise that resolves when user acknowledges the error
     */
    showError: (accountId, error) => {
      // Mark upload as completed on error
      uploadState = 'completed';
      debugLog('Upload state changed to completed due to error');

      // Hide cancel button and show close button since upload is done
      dialog.hideCancel();

      errorContainer.style.display = 'block';
      errorContainer.innerHTML = `
        <div style="margin-bottom: 10px; font-weight: bold; color: #f44336;">
          Error uploading account ${accountId}:
        </div>
        <div style="margin-bottom: 15px; white-space: pre-wrap; word-wrap: break-word;">
          ${error.message || error.toString()}
        </div>
        <div style="display: flex; gap: 10px; justify-content: flex-end;">
          <button id="error-close-button" style="
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            background: #6c757d;
            color: white;
            cursor: pointer;
          ">Close</button>
          <button id="error-ack-button" style="
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            background: #f44336;
            color: white;
            cursor: pointer;
          ">Continue</button>
        </div>
      `;

      // Create new promise for acknowledgment
      acknowledgmentPromise.promise = new Promise((resolve) => {
        acknowledgmentPromise.resolve = resolve;
      });

      // Set up acknowledgment button (continue with next account if applicable)
      document.getElementById('error-ack-button').onclick = () => {
        errorContainer.style.display = 'none';
        if (acknowledgmentPromise.resolve) {
          acknowledgmentPromise.resolve();
          acknowledgmentPromise.resolve = null;
        }
      };

      // Set up close button within error dialog
      document.getElementById('error-close-button').onclick = () => {
        errorContainer.style.display = 'none';
        dialog.close();
      };

      return acknowledgmentPromise.promise;
    },

    /**
     * Show summary of results
     * @param {Object} stats - Statistics object with success, failed, skipped (optional) counts
     * @returns {Object} Dialog instance for chaining
     */
    showSummary: (stats) => {
      const skipped = stats.skipped || 0;
      let summaryText = `Summary: ${stats.success} success, ${stats.failed} failed`;
      if (skipped > 0) {
        summaryText += `, ${skipped} skipped`;
      }
      summary.textContent = summaryText;
      return dialog;
    },

    /**
     * Set up cancel callback for the upload process
     * @param {Function} callback - Function to call when cancel is requested
     */
    onCancel: (callback) => {
      cancelCallback = callback;
    },

    /**
     * Check if the operation has been cancelled
     * @returns {boolean} True if cancelled
     */
    isCancelled: () => isCancelled,

    /**
     * Hide cancel button and show close button (when upload completes)
     */
    hideCancel: () => {
      cancelButton.style.display = 'none';
      closeButton.style.display = 'inline-block';
    },

    /**
     * Close and remove the dialog
     * @returns {Object} Dialog instance for chaining
     */
    close: () => {
      overlay.remove();
      return dialog;
    },
  };

  // Set up cancel button handler with debugging
  cancelButton.onclick = () => {
    debugLog('Cancel button clicked', {
      hasCallback: Boolean(cancelCallback),
      isCancelled,
      uploadState,
    });

    if (!cancelCallback) {
      debugLog('Warning: Cancel button clicked but no callback registered');
      return;
    }

    if (isCancelled) {
      debugLog('Warning: Cancel already in progress');
      return;
    }

    debugLog('Executing cancel callback');
    isCancelled = true;
    uploadState = 'completed';
    cancelButton.textContent = 'Cancelling...';
    cancelButton.disabled = true;
    cancelButton.style.opacity = '0.6';

    try {
      cancelCallback();
      debugLog('Cancel callback executed successfully');
    } catch (error) {
      debugLog('Error executing cancel callback:', error);
    }
  };

  // Set up close button handler
  closeButton.onclick = dialog.close;

  debugLog('Progress dialog created with accounts:', accounts);
  return dialog;
}

export default {
  showProgressDialog,
};
