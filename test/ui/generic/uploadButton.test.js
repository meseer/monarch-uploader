/**
 * Tests for Generic Upload Button Component
 */

import { createUploadButton } from '../../../src/ui/generic/components/uploadButton';
import { darkenColor } from '../../../src/ui/generic/components/uploadButton';

describe('Generic Upload Button Component', () => {
  describe('createUploadButton', () => {
    it('creates an upload button when authenticated', () => {
      const onUploadClick = jest.fn();
      const container = createUploadButton({
        isAuthenticated: true,
        institutionName: 'MBNA',
        onUploadClick,
      });

      expect(container).toBeDefined();
      expect(container.id).toBe('generic-upload-button-container');

      const button = container.querySelector('#generic-upload-button');
      expect(button).not.toBeNull();
      expect(button.textContent).toBe('Upload to Monarch');
      expect(button.disabled).toBe(false);
    });

    it('calls onUploadClick when button is clicked', () => {
      const onUploadClick = jest.fn();
      const container = createUploadButton({
        isAuthenticated: true,
        institutionName: 'MBNA',
        onUploadClick,
      });

      const button = container.querySelector('#generic-upload-button');
      button.click();
      expect(onUploadClick).toHaveBeenCalledTimes(1);
      expect(onUploadClick).toHaveBeenCalledWith(button);
    });

    it('shows waiting message when not authenticated', () => {
      const container = createUploadButton({
        isAuthenticated: false,
        institutionName: 'MBNA',
      });

      const button = container.querySelector('#generic-upload-button');
      expect(button).toBeNull();

      const waitingMessage = container.querySelector('#generic-auth-waiting-message');
      expect(waitingMessage).not.toBeNull();
      expect(waitingMessage.textContent).toContain('MBNA');
      expect(waitingMessage.textContent).toContain('session to be detected');

      const helpText = container.querySelector('#generic-auth-help-text');
      expect(helpText).not.toBeNull();
      expect(helpText.textContent).toContain('MBNA');
    });

    it('uses institution name in waiting message', () => {
      const container = createUploadButton({
        isAuthenticated: false,
        institutionName: 'Rogers Bank',
      });

      const waitingMessage = container.querySelector('#generic-auth-waiting-message');
      expect(waitingMessage.textContent).toContain('Rogers Bank');

      const helpText = container.querySelector('#generic-auth-help-text');
      expect(helpText.textContent).toContain('Rogers Bank');
    });

    it('includes info text when authenticated', () => {
      const container = createUploadButton({
        isAuthenticated: true,
        institutionName: 'MBNA',
        onUploadClick: jest.fn(),
      });

      const infoText = container.querySelector('#generic-upload-info');
      expect(infoText).not.toBeNull();
      expect(infoText.textContent).toContain('Monarch Money');
    });
  });

  describe('darkenColor', () => {
    it('darkens a hex color', () => {
      const result = darkenColor('#ffffff', 20);
      // Each channel: 255 - round(2.55 * 20) = 255 - 51 = 204 = 0xCC
      expect(result).toBe('#cccccc');
    });

    it('does not go below 0', () => {
      const result = darkenColor('#000000', 20);
      expect(result).toBe('#000000');
    });

    it('defaults to 20% darkening', () => {
      const result = darkenColor('#ffffff');
      expect(result).toBe('#cccccc');
    });
  });
});