/**
 * Rogers Bank Connection Status Component
 * Creates and manages connection status indicators
 */

interface CredentialItem {
  label: string;
  value?: string;
  mask?: boolean;
}

interface RogersBankCredentials {
  authToken?: string;
  accountId?: string;
  customerId?: string;
  deviceId?: string;
  lastUpdated?: string;
  [key: string]: unknown;
}

/**
 * Creates connection status indicators container
 */
export function createConnectionStatus(): HTMLElement {
  const container = document.createElement('div');
  container.className = 'connection-status-container';
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

  // Create Rogers Bank status indicator
  const rogersbankStatus = document.createElement('div');
  rogersbankStatus.className = 'rogersbank-status';
  rogersbankStatus.textContent = 'Rogers Bank: Checking...';
  rogersbankStatus.style.cssText = `
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 500;
    color: #666;
  `;

  // Add status icon
  const rogersbankIcon = document.createElement('span');
  rogersbankIcon.textContent = '●';
  rogersbankIcon.style.cssText = 'color: inherit;';
  rogersbankStatus.insertBefore(rogersbankIcon, rogersbankStatus.firstChild);

  container.appendChild(rogersbankStatus);

  // Create Monarch status indicator
  const monarchStatus = document.createElement('div');
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

  // Create credentials details (collapsible)
  const credentialsDetails = document.createElement('div');
  credentialsDetails.className = 'credentials-details';
  credentialsDetails.style.cssText = `
    width: 100%;
    max-width: 100%;
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid #e9ecef;
    font-size: 12px;
    color: #666;
    display: none;
    box-sizing: border-box;
    overflow: hidden;
  `;

  const credentialsTitle = document.createElement('div');
  credentialsTitle.textContent = 'Captured Credentials:';
  credentialsTitle.style.cssText = 'font-weight: 600; margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis;';
  credentialsDetails.appendChild(credentialsTitle);

  const credentialsList = document.createElement('div');
  credentialsList.className = 'credentials-list';
  credentialsList.style.cssText = `
    padding-left: 12px;
    max-width: 100%;
    box-sizing: border-box;
    overflow: hidden;
  `;
  credentialsDetails.appendChild(credentialsList);

  container.appendChild(credentialsDetails);

  // Add click handler to toggle credentials display
  container.style.cursor = 'pointer';
  container.addEventListener('click', () => {
    const isVisible = credentialsDetails.style.display !== 'none';
    credentialsDetails.style.display = isVisible ? 'none' : 'block';
  });

  return container;
}

/**
 * Update credentials display
 */
export function updateCredentialsDisplay(container: HTMLElement, credentials: RogersBankCredentials): void {
  const credentialsList = container.querySelector('.credentials-list');
  if (!credentialsList) return;

  const items: CredentialItem[] = [
    { label: 'Auth Token', value: credentials.authToken, mask: true },
    { label: 'Account ID', value: credentials.accountId },
    { label: 'Customer ID', value: credentials.customerId },
    { label: 'Device ID', value: credentials.deviceId, mask: true },
    { label: 'Last Updated', value: credentials.lastUpdated },
  ];

  credentialsList.innerHTML = items
    .map((item) => {
      let displayValue = 'Not captured';
      if (item.value) {
        if (item.mask && item.value.length > 10) {
          // Mask sensitive values
          displayValue = `${item.value.substring(0, 6)}...${item.value.substring(item.value.length - 4)}`;
        } else {
          displayValue = item.value;
        }
      }
      return `<div><strong>${item.label}:</strong> ${displayValue}</div>`;
    })
    .join('');
}

