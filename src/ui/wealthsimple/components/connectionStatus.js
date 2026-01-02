/**
 * Wealthsimple Connection Status Component
 * Creates and manages connection status indicators
 */

import wealthsimpleApi from '../../../api/wealthsimple';

/**
 * Format time remaining until expiration
 * @param {string} expiresAt - ISO timestamp
 * @returns {string} Formatted time remaining
 */
function formatTimeRemaining(expiresAt) {
  if (!expiresAt) return '';

  try {
    const expiryTime = new Date(expiresAt).getTime();
    const currentTime = Date.now();
    const remainingMs = expiryTime - currentTime;

    if (remainingMs <= 0) {
      return 'expired';
    }

    const remainingMinutes = Math.floor(remainingMs / 60000);
    const remainingHours = Math.floor(remainingMinutes / 60);
    const remainingDays = Math.floor(remainingHours / 24);

    if (remainingDays > 0) {
      return `expires in ${remainingDays}d ${remainingHours % 24}h`;
    }
    if (remainingHours > 0) {
      return `expires in ${remainingHours}h ${remainingMinutes % 60}m`;
    }
    return `expires in ${remainingMinutes}m`;
  } catch (error) {
    return '';
  }
}

/**
 * Get color for expiration status
 * @param {string} expiresAt - ISO timestamp
 * @returns {string} Color code
 */
function getExpirationColor(expiresAt) {
  if (!expiresAt) return '#dc3545'; // Red for no expiration

  try {
    const expiryTime = new Date(expiresAt).getTime();
    const currentTime = Date.now();
    const remainingMs = expiryTime - currentTime;
    const remainingMinutes = Math.floor(remainingMs / 60000);

    if (remainingMinutes <= 0) {
      return '#dc3545'; // Red for expired
    }
    if (remainingMinutes < 10) {
      return '#ffc107'; // Yellow for <10 minutes
    }
    return '#28a745'; // Green for >10 minutes
  } catch (error) {
    return '#dc3545';
  }
}

/**
 * Creates connection status indicators container
 * @returns {HTMLElement} Connection status container
 */
export function createConnectionStatus() {
  const container = document.createElement('div');
  container.id = 'wealthsimple-connection-status-container';
  container.className = 'connection-status-container';
  container.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 8px 0;
    padding: 8px;
    background-color: #ffffff;
    border: 1px solid #e5e5e5;
    border-radius: 4px;
    font-size: 13px;
    font-family: "Wealthsimple Sans", sans-serif;
  `;

  // Create Wealthsimple status indicator
  const wealthsimpleStatus = document.createElement('div');
  wealthsimpleStatus.id = 'wealthsimple-status-indicator';
  wealthsimpleStatus.className = 'wealthsimple-status';
  wealthsimpleStatus.textContent = 'Wealthsimple: Checking...';
  wealthsimpleStatus.style.cssText = `
    font-weight: 500;
    color: #666;
  `;

  container.appendChild(wealthsimpleStatus);

  // Create Monarch status indicator
  const monarchStatus = document.createElement('div');
  monarchStatus.id = 'wealthsimple-monarch-status-indicator';
  monarchStatus.className = 'monarch-status';
  monarchStatus.textContent = 'Monarch: Checking...';
  monarchStatus.style.cssText = `
    font-weight: 500;
    color: #666;
  `;

  container.appendChild(monarchStatus);

  // Set up periodic updates for expiration countdown
  setInterval(() => {
    updateWealthsimpleStatus(wealthsimpleStatus);
  }, 60000); // Update every minute

  return container;
}

/**
 * Update Wealthsimple status display
 * @param {HTMLElement} statusElement - Status element to update
 */
function updateWealthsimpleStatus(statusElement) {
  const authStatus = wealthsimpleApi.checkAuth();

  if (authStatus.authenticated && authStatus.expiresAt) {
    const timeRemaining = formatTimeRemaining(authStatus.expiresAt);
    const color = getExpirationColor(authStatus.expiresAt);

    statusElement.textContent = `Wealthsimple: Connected (${timeRemaining})`;
    statusElement.style.color = color;
  } else if (authStatus.expired) {
    statusElement.textContent = 'Wealthsimple: Token expired';
    statusElement.style.color = '#dc3545';
  } else {
    statusElement.textContent = 'Wealthsimple: Not connected';
    statusElement.style.color = '#dc3545';
  }

  // Ensure icon is first child
  const icon = statusElement.querySelector('span');
  if (icon && icon.nextSibling) {
    icon.nextSibling.textContent = ` ${statusElement.textContent.split(': ')[1]}`;
    statusElement.textContent = 'Wealthsimple: ';
    statusElement.appendChild(icon.nextSibling);
  }
}

export default {
  createConnectionStatus,
};
