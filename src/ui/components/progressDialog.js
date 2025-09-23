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
  const dialogId = `balance-uploader-progress-${Date.now()}`;

  // Create overlay
  const overlay = document.createElement('div');
  overlay.id = dialogId;
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
  header.style.cssText = `
    margin-top: 0;
    margin-bottom: 15px;
    font-size: 1.2em;
  `;
  header.textContent = title;
  modal.appendChild(header);

  // Account list container
  const accountList = document.createElement('div');
  accountList.style.cssText = `
    margin-bottom: 20px;
    max-height: 300px;
    overflow-y: auto;
  `;
  modal.appendChild(accountList);

  // Create account rows
  const accountElements = {};
  accounts.forEach((account) => {
    const accountRow = document.createElement('div');
    accountRow.style.cssText = `
      display: flex;
      align-items: center;
      padding: 10px;
      border-bottom: 1px solid #eee;
    `;

    // Status icon
    const statusIcon = document.createElement('span');
    statusIcon.style.cssText = `
      margin-right: 10px;
      font-size: 1.2em;
    `;
    statusIcon.textContent = '○'; // Pending
    statusIcon.dataset.status = 'pending';
    accountRow.appendChild(statusIcon);

    // Account name container
    const accountNameContainer = document.createElement('div');
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
    accountId.textContent = account.key || account.id;
    accountNameContainer.appendChild(accountId);

    accountRow.appendChild(accountNameContainer);

    // Status text
    const statusText = document.createElement('div');
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

    accountList.appendChild(accountRow);

    accountElements[account.key || account.id] = {
      row: accountRow,
      icon: statusIcon,
      status: statusText,
    };
  });

  // Error container (initially hidden)
  const errorContainer = document.createElement('div');
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
  summary.style.cssText = `
    margin-bottom: 20px;
    font-weight: bold;
  `;
  summary.textContent = `Total: ${accounts.length} accounts`;
  modal.appendChild(summary);

  // Buttons container
  const buttonsContainer = document.createElement('div');
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
     * @param {Object} stats - Statistics object with success, failed, total counts
     * @returns {Object} Dialog instance for chaining
     */
    showSummary: (stats) => {
      const pendingCount = stats.total - stats.success - stats.failed;
      summary.textContent = `Summary: ${stats.success} success, ${stats.failed} failed, ${pendingCount} pending`;
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
      hasCallback: !!cancelCallback,
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
