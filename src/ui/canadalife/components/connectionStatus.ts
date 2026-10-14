/**
 * CanadaLife Connection Status Component
 * Creates and manages connection status indicators
 */

import { FONTS } from '../../../core/config';

/**
 * Creates connection status indicators container
 */
export function createConnectionStatus(): HTMLElement {
  const container = document.createElement('div');
  container.id = 'canadalife-connection-status-container';
  container.className = 'connection-status-container';
  container.style.cssText = `
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin: 8px 0;
    padding: 8px;
    background-color: #ffffff;
    border: 1px solid #dee2e6;
    border-radius: 4px;
    font-size: 13px;
    font-family: ${FONTS.CANADALIFE_BASE};
  `;

  // Create CanadaLife status indicator
  const canadalifeStatus = document.createElement('div');
  canadalifeStatus.id = 'canadalife-status-indicator';
  canadalifeStatus.className = 'canadalife-status';
  canadalifeStatus.textContent = 'CanadaLife: Checking...';
  canadalifeStatus.style.cssText = `
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 500;
    color: #666;
    font-family: ${FONTS.CANADALIFE_BASE};
  `;

  // Add status icon
  const canadalifeIcon = document.createElement('span');
  canadalifeIcon.textContent = '●';
  canadalifeIcon.style.cssText = 'color: inherit;';
  canadalifeStatus.insertBefore(canadalifeIcon, canadalifeStatus.firstChild);

  container.appendChild(canadalifeStatus);

  // Create Monarch status indicator
  const monarchStatus = document.createElement('div');
  monarchStatus.id = 'canadalife-monarch-status-indicator';
  monarchStatus.className = 'monarch-status';
  monarchStatus.textContent = 'Monarch: Checking...';
  monarchStatus.style.cssText = `
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 500;
    color: #666;
    font-family: ${FONTS.CANADALIFE_BASE};
  `;

  // Add status icon
  const monarchIcon = document.createElement('span');
  monarchIcon.textContent = '●';
  monarchIcon.style.cssText = 'color: inherit;';
  monarchStatus.insertBefore(monarchIcon, monarchStatus.firstChild);

  container.appendChild(monarchStatus);

  return container;
}

