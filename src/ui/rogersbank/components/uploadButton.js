/**
 * Rogers Bank Upload Button Component
 * Creates upload button styled for Rogers Bank branding
 */

import { debugLog } from '../../../core/utils';
import { COLORS } from '../../../core/config';
import rogersbank from '../../../api/rogersbank';
import toast from '../../toast';
import { uploadRogersBankToMonarch } from '../../../services/rogersbank-upload';

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

  // Create upload button with actual functionality
  const uploadButton = createRogersBankButton('Upload to Monarch', async () => {
    debugLog('Rogers Bank upload button clicked');

    // Disable button during upload
    uploadButton.disabled = true;
    uploadButton.style.opacity = '0.6';
    uploadButton.style.cursor = 'not-allowed';
    const originalText = uploadButton.textContent;
    uploadButton.textContent = 'Processing...';

    try {
      // Call the upload service
      const result = await uploadRogersBankToMonarch();

      if (result.success && result.data) {
        debugLog('Transaction upload completed:', result);

        // Display summary in console
        if (result.data.transactions) {
          console.log('====================================');
          console.log('Rogers Bank Transaction Upload Summary');
          console.log('====================================');
          console.log(`Date Range: ${result.data.fromDate} to ${result.data.toDate}`);
          console.log(`Approved Transactions Uploaded: ${result.data.transactions.length}`);

          if (result.data.monarchAccountName) {
            console.log(`Monarch Account: ${result.data.monarchAccountName}`);
          }

          console.log('\nFirst 3 Uploaded Transactions:');
          result.data.transactions.slice(0, 3).forEach((tx, index) => {
            console.log(`\n${index + 1}. ${tx.date} - ${tx.merchant?.name || 'N/A'}`);
            console.log(`   Amount: $${tx.amount?.value} ${tx.amount?.currency}`);
            console.log(`   Category: ${tx.merchant?.categoryDescription || tx.merchant?.category || 'N/A'}`);
            console.log(`   Status: ${tx.activityStatus}`);
            console.log(`   Type: ${tx.activityType}`);
            console.log(`   Reference: ${tx.referenceNumber}`);
          });
          console.log('====================================');
        }
      }
    } catch (error) {
      debugLog('Error during transaction upload:', error);
      toast.show('Failed to upload transactions', 'error');
    } finally {
      // Re-enable button
      uploadButton.disabled = false;
      uploadButton.style.opacity = '1';
      uploadButton.style.cursor = 'pointer';
      uploadButton.textContent = originalText;
    }
  }, { color: '#28a745' }); // Green color for upload action

  container.appendChild(uploadButton);

  // Add informational text
  const infoText = document.createElement('div');
  infoText.textContent = 'Click to upload current balance and approved transactions to Monarch Money.';
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
