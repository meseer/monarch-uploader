/**
 * MBNA Connection Status Component
 *
 * Displays connection status indicators for MBNA and Monarch.
 * Follows the same pattern as Rogers Bank connectionStatus.js
 * but uses MBNA branding.
 *
 * @module ui/mbna/components/connectionStatus
 */

/**
 * Creates connection status indicators container
 * @returns {HTMLElement} Connection status container
 */
export function createConnectionStatus() {
  const container = document.createElement('div');
  container.className = 'connection-status-container';
  container.id = 'mbna-connection-status';
  container.style.cssText = `
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 8px 0;
    padding: 8px;
    background-color: #ffffff;
    border: 1px solid #dee2e6;
    border-radius: 4px;
    font-size: 13px;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    overflow: hidden;
  `;

  // Create MBNA status indicator
  const mbnaStatus = document.createElement('div');
  mbnaStatus.className = 'mbna-status';
  mbnaStatus.id = 'mbna-status-indicator';
  mbnaStatus.textContent = 'MBNA: Checking...';
  mbnaStatus.style.cssText = `
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 500;
    color: #666;
  `;

  const mbnaIcon = document.createElement('span');
  mbnaIcon.textContent = '●';
  mbnaIcon.style.cssText = 'color: inherit;';
  mbnaStatus.insertBefore(mbnaIcon, mbnaStatus.firstChild);

  container.appendChild(mbnaStatus);

  // Create Monarch status indicator
  const monarchStatus = document.createElement('div');
  monarchStatus.className = 'monarch-status';
  monarchStatus.id = 'mbna-monarch-status-indicator';
  monarchStatus.textContent = 'Monarch: Checking...';
  monarchStatus.style.cssText = `
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 500;
    color: #666;
  `;

  const monarchIcon = document.createElement('span');
  monarchIcon.textContent = '●';
  monarchIcon.style.cssText = 'color: inherit;';
  monarchStatus.insertBefore(monarchIcon, monarchStatus.firstChild);

  container.appendChild(monarchStatus);

  return container;
}

/**
 * Update MBNA connection status indicator
 * @param {HTMLElement} container - Connection status container
 * @param {boolean} authenticated - Whether MBNA session is active
 */
export function updateMbnaStatus(container, authenticated) {
  const indicator = container.querySelector('.mbna-status');
  if (!indicator) return;

  if (authenticated) {
    indicator.textContent = 'MBNA: Connected';
    indicator.style.color = '#28a745';
  } else {
    indicator.textContent = 'MBNA: Not connected';
    indicator.style.color = '#dc3545';
  }

  // Re-add icon
  const icon = document.createElement('span');
  icon.textContent = '●';
  icon.style.cssText = 'color: inherit;';
  indicator.insertBefore(icon, indicator.firstChild);
}

/**
 * Update Monarch connection status indicator
 * @param {HTMLElement} container - Connection status container
 * @param {boolean} connected - Whether Monarch token exists
 * @param {Function} [onLoginClick] - Callback when login link is clicked
 */
export function updateMonarchStatus(container, connected, onLoginClick) {
  const indicator = container.querySelector('.monarch-status');
  if (!indicator) return;

  indicator.innerHTML = '';

  const icon = document.createElement('span');
  icon.textContent = '●';

  if (connected) {
    icon.style.cssText = 'color: #28a745;';
    indicator.style.color = '#28a745';
    indicator.appendChild(icon);
    indicator.appendChild(document.createTextNode(' Monarch: Connected'));
  } else {
    icon.style.cssText = 'color: #dc3545;';
    indicator.style.color = '#dc3545';
    indicator.appendChild(icon);

    if (onLoginClick) {
      const link = document.createElement('a');
      link.textContent = ' Monarch: Not connected (click to login)';
      link.href = '#';
      link.style.cssText = 'color: inherit; text-decoration: underline; cursor: pointer;';
      link.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onLoginClick();
      });
      indicator.appendChild(link);
    } else {
      indicator.appendChild(document.createTextNode(' Monarch: Not connected'));
    }
  }
}

export default {
  createConnectionStatus,
  updateMbnaStatus,
  updateMonarchStatus,
};