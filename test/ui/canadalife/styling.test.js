/**
 * @jest-environment jsdom
 */

import { FONTS } from '../../../src/core/config';
import { createUIContainer } from '../../../src/ui/canadalife/uiManager';
import { createConnectionStatus } from '../../../src/ui/canadalife/components/connectionStatus';
import {
  createCanadaLifeButton,
  createCanadaLifeUploadButton,
} from '../../../src/ui/canadalife/components/uploadButton';

// ── Dependency mocks ──────────────────────────────────────────────────────────

jest.mock('../../../src/core/utils', () => ({
  debugLog: jest.fn(),
  escapeHtml: jest.fn((str) => String(str)),
  getTodayLocal: jest.fn(() => '2026-10-14'),
  formatDaysAgoLocal: jest.fn(() => '2026-10-07'),
}));

jest.mock('../../../src/api/canadalife', () => ({
  __esModule: true,
  default: {
    checkAuth: jest.fn(() => ({ authenticated: true })),
    loadCanadaLifeAccounts: jest.fn(() => Promise.resolve([])),
  },
}));

jest.mock('../../../src/services/auth', () => ({
  __esModule: true,
  default: {
    getMonarchCredentials: jest.fn(() => ({ token: 'mock-token' })),
  },
}));

jest.mock('../../../src/ui/toast', () => ({
  __esModule: true,
  default: { show: jest.fn() },
}));

jest.mock('../../../src/ui/components/settingsModal', () => ({
  showSettingsModal: jest.fn(),
}));

describe('Canada Life UI typography and styling', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    jest.clearAllMocks();
    global.GM_getValue = jest.fn((key) => {
      if (key === 'development_mode') return true;
      return null;
    });
  });

  describe('createUIContainer', () => {
    it('returns null if .ims-navigation anchor is not in document', () => {
      const container = createUIContainer();
      expect(container).toBeNull();
    });

    it('attaches container and applies Canada Life base and display fonts', () => {
      const nav = document.createElement('div');
      nav.className = 'ims-navigation';
      document.body.appendChild(nav);

      const container = createUIContainer();
      expect(container).not.toBeNull();
      expect(container.id).toBe('canadalife-balance-uploader-container');
      expect(container.style.fontFamily).toContain('Source Sans Pro');

      const title = container.querySelector('#canadalife-uploader-title');
      expect(title).not.toBeNull();
      expect(title.style.fontFamily).toContain('Foco');

      const subtitle = container.querySelector('#canadalife-uploader-subtitle');
      expect(subtitle).not.toBeNull();
      expect(subtitle.style.fontFamily).toContain('Source Sans Pro');

      const settingsBtn = container.querySelector('#canadalife-settings-button');
      expect(settingsBtn).not.toBeNull();
      expect(settingsBtn.style.fontFamily).toContain('Source Sans Pro');
    });

    it('sets IDs on structural header and title elements', () => {
      const nav = document.createElement('div');
      nav.className = 'ims-navigation';
      document.body.appendChild(nav);

      const container = createUIContainer();
      expect(container.querySelector('#canadalife-uploader-header')).not.toBeNull();
      expect(container.querySelector('#canadalife-uploader-title-section')).not.toBeNull();
      expect(container.querySelector('#canadalife-uploader-title-row')).not.toBeNull();
    });
  });

  describe('createConnectionStatus', () => {
    it('applies Canada Life base font and IDs to status container and indicators', () => {
      const connectionStatus = createConnectionStatus();
      expect(connectionStatus.id).toBe('canadalife-connection-status-container');
      expect(connectionStatus.style.fontFamily).toContain('Source Sans Pro');

      const clIndicator = connectionStatus.querySelector('#canadalife-status-indicator');
      expect(clIndicator).not.toBeNull();
      expect(clIndicator.style.fontFamily).toContain('Source Sans Pro');

      const monarchIndicator = connectionStatus.querySelector('#canadalife-monarch-status-indicator');
      expect(monarchIndicator).not.toBeNull();
      expect(monarchIndicator.style.fontFamily).toContain('Source Sans Pro');
    });
  });

  describe('createCanadaLifeButton', () => {
    it('applies Canada Life base font to buttons', () => {
      const button = createCanadaLifeButton('Click Me', null, { id: 'test-button' });
      expect(button.id).toBe('test-button');
      expect(button.style.fontFamily).toContain('Source Sans Pro');
    });
  });

  describe('createCanadaLifeUploadButton', () => {
    it('applies Canada Life base font to upload buttons and containers', () => {
      const uploadContainer = createCanadaLifeUploadButton();
      expect(uploadContainer.id).toBe('canadalife-upload-button-container');

      const uploadAllBtn = uploadContainer.querySelector('#canadalife-upload-all-button');
      expect(uploadAllBtn).not.toBeNull();
      expect(uploadAllBtn.style.fontFamily).toContain('Source Sans Pro');

      const customRangeBtn = uploadContainer.querySelector('#canadalife-upload-custom-range-button');
      expect(customRangeBtn).not.toBeNull();
      expect(customRangeBtn.style.fontFamily).toContain('Source Sans Pro');
    });

    it('renders auth message with Canada Life font when unauthenticated', () => {
      const canadalife = require('../../../src/api/canadalife').default;
      canadalife.checkAuth.mockReturnValueOnce({ authenticated: false });

      const uploadContainer = createCanadaLifeUploadButton();
      const message = uploadContainer.querySelector('#canadalife-auth-message');
      expect(message).not.toBeNull();
      expect(message.style.fontFamily).toContain('Source Sans Pro');
    });

    it('applies Canada Life font to development testing section inputs and buttons', () => {
      const uploadContainer = createCanadaLifeUploadButton();
      const testingSection = uploadContainer.querySelector('#canadalife-testing-section');
      expect(testingSection).not.toBeNull();

      const testingHeader = uploadContainer.querySelector('#canadalife-testing-header');
      expect(testingHeader.style.fontFamily).toContain('Source Sans Pro');

      const accountSelector = uploadContainer.querySelector('#canadalife-account-selector');
      expect(accountSelector.style.fontFamily).toContain('Source Sans Pro');

      const dateSelector = uploadContainer.querySelector('#canadalife-date-selector');
      expect(dateSelector.style.fontFamily).toContain('Source Sans Pro');

      const loadBalanceBtn = uploadContainer.querySelector('#canadalife-load-balance-button');
      expect(loadBalanceBtn.style.fontFamily).toContain('Source Sans Pro');
    });
  });

  describe('FONTS configuration values', () => {
    it('defines expected Canada Life font tokens', () => {
      expect(FONTS.CANADALIFE_BASE).toContain('Source Sans Pro');
      expect(FONTS.CANADALIFE_DISPLAY).toContain('Foco');
    });
  });
});
