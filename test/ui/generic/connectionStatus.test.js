/**
 * Tests for Generic Connection Status Component
 */

import {
  createConnectionStatus,
  updateInstitutionStatus,
  updateMonarchStatus,
} from '../../../src/ui/generic/components/connectionStatus';

describe('Generic Connection Status Component', () => {
  describe('createConnectionStatus', () => {
    it('creates a container with institution and monarch status indicators', () => {
      const container = createConnectionStatus('MBNA');

      expect(container).toBeDefined();
      expect(container.id).toBe('generic-connection-status');
      expect(container.className).toBe('connection-status-container');

      const institutionStatus = container.querySelector('.institution-status');
      expect(institutionStatus).not.toBeNull();
      expect(institutionStatus.textContent).toContain('MBNA: Checking...');

      const monarchStatus = container.querySelector('.monarch-status');
      expect(monarchStatus).not.toBeNull();
      expect(monarchStatus.textContent).toContain('Monarch: Checking...');
    });

    it('uses the institution name in the status text', () => {
      const container = createConnectionStatus('Rogers Bank');

      const institutionStatus = container.querySelector('.institution-status');
      expect(institutionStatus.textContent).toContain('Rogers Bank: Checking...');
    });
  });

  describe('updateInstitutionStatus', () => {
    let container;

    beforeEach(() => {
      container = createConnectionStatus('MBNA');
    });

    it('shows connected status with green color when authenticated', () => {
      updateInstitutionStatus(container, 'MBNA', true);

      const indicator = container.querySelector('.institution-status');
      expect(indicator.textContent).toContain('MBNA: Connected');
      expect(indicator.style.color).toBe('rgb(40, 167, 69)'); // #28a745
    });

    it('shows not connected status with red color when not authenticated', () => {
      updateInstitutionStatus(container, 'MBNA', false);

      const indicator = container.querySelector('.institution-status');
      expect(indicator.textContent).toContain('MBNA: Not connected');
      expect(indicator.style.color).toBe('rgb(220, 53, 69)'); // #dc3545
    });

    it('uses the provided institution name', () => {
      updateInstitutionStatus(container, 'Rogers Bank', true);

      const indicator = container.querySelector('.institution-status');
      expect(indicator.textContent).toContain('Rogers Bank: Connected');
    });

    it('does nothing if institution-status element is missing', () => {
      const emptyContainer = document.createElement('div');
      // Should not throw
      updateInstitutionStatus(emptyContainer, 'MBNA', true);
    });
  });

  describe('updateMonarchStatus', () => {
    let container;

    beforeEach(() => {
      container = createConnectionStatus('MBNA');
    });

    it('shows connected status when Monarch token exists', () => {
      updateMonarchStatus(container, true);

      const indicator = container.querySelector('.monarch-status');
      expect(indicator.textContent).toContain('Monarch: Connected');
      expect(indicator.style.color).toBe('rgb(40, 167, 69)'); // #28a745
    });

    it('shows not connected status when Monarch token is missing', () => {
      updateMonarchStatus(container, false);

      const indicator = container.querySelector('.monarch-status');
      expect(indicator.textContent).toContain('Monarch: Not connected');
      expect(indicator.style.color).toBe('rgb(220, 53, 69)'); // #dc3545
    });

    it('renders a clickable login link when not connected and onLoginClick is provided', () => {
      const onLoginClick = jest.fn();
      updateMonarchStatus(container, false, onLoginClick);

      const indicator = container.querySelector('.monarch-status');
      const link = indicator.querySelector('a');
      expect(link).not.toBeNull();
      expect(link.textContent).toContain('click to login');

      // Simulate click
      link.click();
      expect(onLoginClick).toHaveBeenCalledTimes(1);
    });

    it('does not render a login link when connected', () => {
      const onLoginClick = jest.fn();
      updateMonarchStatus(container, true, onLoginClick);

      const indicator = container.querySelector('.monarch-status');
      const link = indicator.querySelector('a');
      expect(link).toBeNull();
    });

    it('does nothing if monarch-status element is missing', () => {
      const emptyContainer = document.createElement('div');
      // Should not throw
      updateMonarchStatus(emptyContainer, true);
    });
  });
});