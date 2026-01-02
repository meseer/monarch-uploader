/**
 * Wealthsimple Connection Status Component
 * Creates and manages connection status indicators
 */

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
    flex-wrap: wrap;
    gap: 12px;
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
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 500;
    color: #666;
  `;

  // Add status icon
  const wealthsimpleIcon = document.createElement('span');
  wealthsimpleIcon.textContent = '●';
  wealthsimpleIcon.style.cssText = 'color: inherit;';
  wealthsimpleStatus.insertBefore(wealthsimpleIcon, wealthsimpleStatus.firstChild);

  container.appendChild(wealthsimpleStatus);

  // Create Monarch status indicator
  const monarchStatus = document.createElement('div');
  monarchStatus.id = 'wealthsimple-monarch-status-indicator';
  monarchStatus.className = 'monarch-status';
  monarchStatus.textContent = 'Monarch: Checking...';
  monarchStatus.style.cssText = `
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 500;
    color: #666;
  `;

  // Add status icon
  const monarchIcon = document.createElement('span');
  monarchIcon.textContent = '●';
  monarchIcon.style.cssText = 'color: inherit;';
  monarchStatus.insertBefore(monarchIcon, monarchStatus.firstChild);

  container.appendChild(monarchStatus);

  return container;
}

export default {
  createConnectionStatus,
};
