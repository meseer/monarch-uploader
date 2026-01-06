/**
 * Progress Dialog Component
 * Creates and manages the sophisticated progress dialog for bulk account uploads
 * Based on the original script's showProgressDialog functionality
 */

import { debugLog } from '../../core/utils';

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
    max-width: 600px;
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
    max-height: 300px;
    overflow-y: auto;
  `;
  modal.appendChild(accountList);

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
      border-bottom: 1px solid #eee;
      padding-bottom: 5px;
      margin-bottom: 5px;
    `;

    // Account row
    const accountRow = document.createElement('div');
    accountRow.id = `balance-uploader-account-row-${accountKey}`;
    accountRow.style.cssText = `
      display: flex;
      align-items: center;
      padding: 10px;
    `;

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
    const accountId = document.createElement('div');
    accountId.style.cssText = `
      font-size: 0.85em;
      color: #888;
      font-weight: normal;
    `;
    accountId.textContent = accountKey;
    accountNameContainer.appendChild(accountId);

    accountRow.appendChild(accountNameContainer);

    // Status text
    const statusText = document.createElement('div');
    statusText.id = `balance-uploader-account-status-${accountKey}`;
    statusText.style.cssText = `
      margin-left: 10px;
      color: #888;
      min-width: 120px;
      max-width: 150px;
      word-wrap: break-word;
      text-align: right;
    `;
    statusText.textContent = 'Pending';
    accountRow.appendChild(statusText);

    // Balance change section (initially hidden)
    const balanceChangeDiv = document.createElement('div');
    balanceChangeDiv.id = `balance-uploader-balance-change-${accountKey}`;
    balanceChangeDiv.style.cssText = `
      display: none;
      width: 100%;
      padding: 8px 15px;
      border-radius: 4px;
      font-size: 0.9em;
      font-weight: 500;
      text-align: center;
    `;

    // Add elements to container
    accountContainer.appendChild(accountRow);
    accountContainer.appendChild(balanceChangeDiv);
    accountList.appendChild(accountContainer);

    accountElements[accountKey] = {
      container: accountContainer,
      row: accountRow,
      icon: statusIcon,
      status: statusText,
      balanceChange: balanceChangeDiv,
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

  // Dialog API
  const dialog = {
    /**
     * Update progress for a specific account
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
        // Don't change to completed here - let the service layer decide when all processing is done
        debugLog(`Account ${accountId} finished with status: ${status}`);
      }

      // Update status text
      el.status.textContent = message || status;

      // Update icon
      if (status === 'processing') {
        el.icon.textContent = '⟳';
      } else if (status === 'success') {
        el.icon.textContent = '✓';
      } else if (status === 'error') {
        el.icon.textContent = '✗';
      } else {
        el.icon.textContent = '○';
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
     * @param {string} accountId - Account ID to update
     * @param {Object} balanceChangeData - Balance change data
     * @param {number} balanceChangeData.oldBalance - Previous balance
     * @param {number} balanceChangeData.newBalance - Current balance
     * @param {string} balanceChangeData.lastUploadDate - Last upload date in YYYY-MM-DD format
     * @param {number} balanceChangeData.changePercent - Percentage change
     */
    updateBalanceChange: (accountId, { oldBalance, newBalance, lastUploadDate, changePercent }) => {
      const el = accountElements[accountId];
      if (!el || !el.balanceChange) {
        debugLog(`Warning: Balance change element not found for ID: ${accountId}`);
        return;
      }

      try {
        // Format the balance change display
        const changeSymbol = changePercent > 0 ? '+' : '';
        const formattedOldBalance = `$${Math.abs(oldBalance).toFixed(2)}`;
        const formattedNewBalance = `$${Math.abs(newBalance).toFixed(2)}`;
        const formattedChangePercent = `${changeSymbol}${changePercent.toFixed(2)}%`;

        // Set the content
        el.balanceChange.textContent = `${formattedOldBalance} (${lastUploadDate}) → ${formattedNewBalance} (${formattedChangePercent})`;

        // Set colors based on change
        let backgroundColor;
        let textColor;
        if (changePercent > 0) {
          backgroundColor = '#e8f5e9';
          textColor = '#2e7d32';
        } else if (changePercent < 0) {
          backgroundColor = '#ffebee';
          textColor = '#c62828';
        } else {
          backgroundColor = '#f5f5f5';
          textColor = '#666';
        }

        el.balanceChange.style.backgroundColor = backgroundColor;
        el.balanceChange.style.color = textColor;
        el.balanceChange.style.display = 'block';

        debugLog(`Updated balance change for ${accountId}: ${formattedOldBalance} → ${formattedNewBalance} (${formattedChangePercent})`);
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
