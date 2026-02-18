/**
 * MBNA Upload Button Component
 *
 * Creates the upload button styled with MBNA branding.
 * Follows the same pattern as Rogers Bank uploadButton.js.
 *
 * @module ui/mbna/components/uploadButton
 */

import { debugLog } from '../../../core/utils';
import manifest from '../../../integrations/mbna/manifest';

/** MBNA brand color from manifest */
const BRAND_COLOR = manifest.brandColor;
const BRAND_HOVER_COLOR = '#00245e';

/**
 * Creates a styled button for MBNA
 * @param {string} text - Button text
 * @param {Function} onClick - Click handler
 * @param {Object} [options] - Button options
 * @returns {HTMLButtonElement} The created button
 */
function createMbnaButton(text, onClick, options = {}) {
  const button = document.createElement('button');
  button.textContent = text;
  const color = options.color || BRAND_COLOR;

  button.style.cssText = `
    background-color: ${color};
    color: white;
    border: none;
    border-radius: 4px;
    padding: 10px 16px;
    margin: 5px 0;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
    box-shadow: 0 2px 4px rgba(0, 48, 135, 0.2);
    ${options.disabled ? 'opacity: 0.6; cursor: not-allowed;' : ''}
  `;

  if (options.id) {
    button.id = options.id;
  }

  if (options.className) {
    button.className = options.className;
  }

  button.disabled = Boolean(options.disabled);

  button.addEventListener('mouseover', () => {
    if (!button.disabled) {
      button.style.backgroundColor = options.hoverColor || BRAND_HOVER_COLOR;
      button.style.transform = 'translateY(-1px)';
      button.style.boxShadow = '0 4px 8px rgba(0, 48, 135, 0.3)';
    }
  });

  button.addEventListener('mouseout', () => {
    if (!button.disabled) {
      button.style.backgroundColor = color;
      button.style.transform = 'translateY(0)';
      button.style.boxShadow = '0 2px 4px rgba(0, 48, 135, 0.2)';
    }
  });

  if (onClick && !options.disabled) {
    button.addEventListener('click', onClick);
  }

  return button;
}

/**
 * Creates the main upload button for MBNA
 * @param {boolean} isAuthenticated - Whether the MBNA session is active
 * @param {Function} [onUploadClick] - Handler when upload is clicked
 * @returns {HTMLElement} Upload button container
 */
export function createMbnaUploadButton(isAuthenticated, onUploadClick) {
  const container = document.createElement('div');
  container.className = 'mbna-upload-button-container';
  container.id = 'mbna-upload-button-container';
  container.style.cssText = 'margin: 8px 0;';

  if (!isAuthenticated) {
    const message = document.createElement('div');
    message.id = 'mbna-auth-waiting-message';
    message.textContent = 'Waiting for MBNA session to be detected...';
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
    helpText.textContent = 'Log in to your MBNA account to enable uploading.';
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

  const uploadButton = createMbnaButton('Upload to Monarch', () => {
    if (onUploadClick) {
      onUploadClick(uploadButton);
    } else {
      debugLog('MBNA upload clicked — service not yet wired (Milestone 6)');
    }
  }, { color: '#28a745', id: 'mbna-upload-button' });

  container.appendChild(uploadButton);

  const infoText = document.createElement('div');
  infoText.id = 'mbna-upload-info';
  infoText.textContent = 'Click to upload balance and transactions to Monarch Money.';
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
  createMbnaButton,
  createMbnaUploadButton,
};