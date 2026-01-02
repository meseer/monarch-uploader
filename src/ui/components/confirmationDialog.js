/**
 * Confirmation Dialog Component
 * Reusable dialog for confirming user actions
 */

import { addModalKeyboardHandlers } from '../keyboardNavigation';

/**
 * Show a confirmation dialog with custom message and button text
 * @param {string} message - The message to display
 * @param {string} confirmText - Text for the confirm button (default: 'Confirm')
 * @param {string} cancelText - Text for the cancel button (default: 'Cancel')
 * @returns {Promise<boolean>} True if confirmed, false if cancelled
 */
export async function showConfirmationDialog(
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
) {
  return new Promise((resolve) => {
    let cleanupKeyboard = () => {};

    const overlay = document.createElement('div');
    overlay.id = 'confirmation-dialog-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(0, 0, 0, 0.5);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 10000;
    `;

    const modal = document.createElement('div');
    modal.id = 'confirmation-dialog-modal';
    modal.style.cssText = `
      background: white;
      padding: 25px;
      border-radius: 8px;
      width: 90%;
      max-width: 400px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    `;

    // Message
    const messageDiv = document.createElement('div');
    messageDiv.id = 'confirmation-dialog-message';
    messageDiv.style.cssText = `
      margin-bottom: 25px;
      font-size: 1em;
      line-height: 1.5;
      color: #333;
    `;
    messageDiv.textContent = message;
    modal.appendChild(messageDiv);

    // Button container
    const buttonContainer = document.createElement('div');
    buttonContainer.id = 'confirmation-dialog-buttons';
    buttonContainer.style.cssText = `
      display: flex;
      gap: 10px;
      justify-content: flex-end;
    `;

    // Cancel button
    const cancelBtn = document.createElement('button');
    cancelBtn.id = 'confirmation-dialog-cancel';
    cancelBtn.type = 'button';
    cancelBtn.textContent = cancelText;
    cancelBtn.style.cssText = `
      padding: 10px 20px;
      background-color: #f5f5f5;
      color: #333;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.95em;
      transition: background-color 0.2s;
    `;
    cancelBtn.onmouseover = () => {
      cancelBtn.style.backgroundColor = '#e0e0e0';
    };
    cancelBtn.onmouseout = () => {
      cancelBtn.style.backgroundColor = '#f5f5f5';
    };
    cancelBtn.onclick = () => {
      cleanupKeyboard();
      overlay.remove();
      resolve(false);
    };
    buttonContainer.appendChild(cancelBtn);

    // Confirm button
    const confirmBtn = document.createElement('button');
    confirmBtn.id = 'confirmation-dialog-confirm';
    confirmBtn.type = 'button';
    confirmBtn.textContent = confirmText;
    confirmBtn.style.cssText = `
      padding: 10px 20px;
      background-color: #d32f2f;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.95em;
      font-weight: bold;
      transition: background-color 0.2s;
    `;
    confirmBtn.onmouseover = () => {
      confirmBtn.style.backgroundColor = '#b71c1c';
    };
    confirmBtn.onmouseout = () => {
      confirmBtn.style.backgroundColor = '#d32f2f';
    };
    confirmBtn.onclick = () => {
      cleanupKeyboard();
      overlay.remove();
      resolve(true);
    };
    buttonContainer.appendChild(confirmBtn);

    modal.appendChild(buttonContainer);

    // Add keyboard handlers
    const cleanupModalHandlers = addModalKeyboardHandlers(overlay, () => {
      cleanupKeyboard();
      overlay.remove();
      resolve(false);
    });

    cleanupKeyboard = () => {
      cleanupModalHandlers();
    };

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Focus confirm button by default
    confirmBtn.focus();
  });
}

export default {
  showConfirmationDialog,
};
