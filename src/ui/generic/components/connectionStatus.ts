/**
 * Generic Connection Status Component
 *
 * Displays connection status indicators for any institution and Monarch.
 * Parameterized by institution name — no institution-specific logic.
 *
 * @module ui/generic/components/connectionStatus
 */

/**
 * Creates connection status indicators container
 */
export function createConnectionStatus(institutionName: string): HTMLElement {
  const container = document.createElement('div');
  container.className = 'connection-status-container';
  container.id = 'generic-connection-status';
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

  // Institution status indicator
  const institutionStatus = document.createElement('div');
  institutionStatus.className = 'institution-status';
  institutionStatus.id = 'institution-status-indicator';
  institutionStatus.textContent = `${institutionName}: Checking...`;
  institutionStatus.style.cssText = `
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 500;
    color: #666;
  `;

  const institutionIcon = document.createElement('span');
  institutionIcon.textContent = '●';
  institutionIcon.style.cssText = 'color: inherit;';
  institutionStatus.insertBefore(institutionIcon, institutionStatus.firstChild);

  container.appendChild(institutionStatus);

  // Monarch status indicator
  const monarchStatus = document.createElement('div');
  monarchStatus.className = 'monarch-status';
  monarchStatus.id = 'monarch-status-indicator';
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
 * Update institution connection status indicator
 */
export function updateInstitutionStatus(container: HTMLElement, institutionName: string, authenticated: boolean): void {
  const indicator = container.querySelector('.institution-status') as HTMLElement | null;
  if (!indicator) return;

  if (authenticated) {
    indicator.textContent = `${institutionName}: Connected`;
    indicator.style.color = '#28a745';
  } else {
    indicator.textContent = `${institutionName}: Not connected`;
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
 */
export function updateMonarchStatus(container: HTMLElement, connected: boolean, onLoginClick?: () => void): void {
  const indicator = container.querySelector('.monarch-status') as HTMLElement | null;
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
      link.textContent = ' Monarch: Connect';
      link.href = '#';
      link.style.cssText = 'color: inherit; text-decoration: underline; cursor: pointer;';
      link.addEventListener('click', (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        onLoginClick();
      });
      indicator.appendChild(link);
    } else {
      indicator.appendChild(document.createTextNode(' Monarch: Connect'));
    }
  }
}

