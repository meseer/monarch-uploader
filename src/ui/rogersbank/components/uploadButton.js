/**
 * Rogers Bank Upload Button Component
 * Creates upload button styled for Rogers Bank branding
 */

import { debugLog } from '../../../core/utils';
import { COLORS } from '../../../core/config';
import rogersbank from '../../../api/rogersbank';
import toast from '../../toast';

/**
 * Creates a styled button for Rogers Bank
 * @param {string} text - Button text
 * @param {Function} onClick - Click handler
 * @param {Object} options - Button options
 * @returns {HTMLButtonElement} The created button
 */
function createRogersBankButton(text, onClick, options = {}) {
  const button = document.createElement('button');
  button.textContent = text;
  button.style.cssText = `
    background-color: ${options.color || COLORS.ROGERSBANK_BRAND};
    color: white;
    border: none;
    border-radius: 4px;
    padding: 10px 16px;
    margin: 5px 0;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
    box-shadow: 0 2px 4px rgba(218, 41, 28, 0.2);
    ${options.disabled ? 'opacity: 0.6; cursor: not-allowed;' : ''}
  `;

  if (options.id) {
    button.id = options.id;
  }

  if (options.className) {
    button.className = options.className;
  }

  button.disabled = !!options.disabled;

  // Add hover effect
  button.addEventListener('mouseover', () => {
    if (!button.disabled) {
      button.style.backgroundColor = options.hoverColor || '#b5241f';
      button.style.transform = 'translateY(-1px)';
      button.style.boxShadow = '0 4px 8px rgba(218, 41, 28, 0.3)';
    }
  });

  button.addEventListener('mouseout', () => {
    if (!button.disabled) {
      button.style.backgroundColor = options.color || COLORS.ROGERSBANK_BRAND;
      button.style.transform = 'translateY(0)';
      button.style.boxShadow = '0 2px 4px rgba(218, 41, 28, 0.2)';
    }
  });

  // Add click handler
  if (onClick && !options.disabled) {
    button.addEventListener('click', onClick);
  }

  return button;
}

/**
 * Creates the main upload button for Rogers Bank
 * @returns {HTMLElement} Upload button container
 */
export function createRogersBankUploadButton() {
  const container = document.createElement('div');
  container.className = 'rogersbank-upload-button-container';
  container.style.cssText = 'margin: 8px 0;';

  // Check authentication status
  const authStatus = rogersbank.checkRogersBankAuth();

  if (!authStatus.authenticated) {
    // Show message if not authenticated
    const message = document.createElement('div');
    message.textContent = 'Waiting for Rogers Bank credentials to be captured...';
    message.style.cssText = `
      padding: 8px 12px;
      background-color: #fff3cd;
      color: #856404;
      border: 1px solid #ffeaa7;
      border-radius: 4px;
      font-size: 13px;
      margin: 5px 0;
    `;

    const helpText = document.createElement('div');
    helpText.textContent = 'Navigate to your Rogers Bank account page to capture credentials automatically.';
    helpText.style.cssText = `
      padding: 4px 12px;
      font-size: 12px;
      color: #666;
      font-style: italic;
    `;

    container.appendChild(message);
    container.appendChild(helpText);
    return container;
  }

  // Create upload button (non-functional for now as requested)
  const uploadButton = createRogersBankButton('Upload to Monarch', () => {
    debugLog('Rogers Bank upload button clicked (placeholder)');
    toast.show('Rogers Bank upload functionality coming soon!', 'info');
  }, { color: '#28a745' }); // Green color for upload action

  container.appendChild(uploadButton);

  // Add informational text
  const infoText = document.createElement('div');
  infoText.textContent = 'Upload functionality will be implemented in the next phase.';
  infoText.style.cssText = `
    padding: 4px 0;
    font-size: 12px;
    color: #666;
    font-style: italic;
  `;
  container.appendChild(infoText);

  return container;
}

export default {
  createRogersBankButton,
  createRogersBankUploadButton,
};
