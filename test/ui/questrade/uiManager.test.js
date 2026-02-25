/**
 * Questrade UI Manager Tests
 * Focused on injection point behavior: inserting the container as the
 * first element of <app-general-account-sidebar>.
 */

import { initSingleAccountUI, initAllAccountsUI } from '../../../src/ui/questrade/uiManager';

// ── Dependency mocks ──────────────────────────────────────────────────────────

jest.mock('../../../src/core/utils', () => ({
  debugLog: jest.fn(),
  isQuestradeAllAccountsPage: jest.fn(() => false),
  getLastUpdateDate: jest.fn(() => null),
}));

jest.mock('../../../src/core/config', () => ({
  STORAGE: {
    MONARCH_TOKEN: 'monarch_token',
    DEVELOPMENT_MODE: 'development_mode',
  },
}));

jest.mock('../../../src/core/state', () => ({
  getState: jest.fn(() => ({
    currentAccount: { id: null, nickname: 'unknown' },
    ui: { indicators: {} },
  })),
  setUiElement: jest.fn(),
  addListener: jest.fn(() => jest.fn()), // returns unsubscribe fn
}));

jest.mock('../../../src/api/questrade', () => ({
  __esModule: true,
  default: {
    getToken: jest.fn(() => null),
  },
}));

jest.mock('../../../src/ui/toast', () => ({
  __esModule: true,
  default: { show: jest.fn() },
}));

jest.mock('../../../src/ui/components/settingsModal', () => ({
  showSettingsModal: jest.fn(),
}));

jest.mock('../../../src/ui/components/monarchLoginLink', () => ({
  createMonarchLoginLink: jest.fn(() => null),
}));

jest.mock('../../../src/ui/questrade/components/uploadButton', () => ({
  __esModule: true,
  default: {
    createSingleAccountUploadButton: jest.fn(),
    createBulkUploadButton: jest.fn(),
  },
  createTestingSection: jest.fn(() => null),
}));

jest.mock('../../../src/services/questrade/balance', () => ({
  getAccountsForSync: jest.fn(async () => [
    { questradeAccount: { id: 'acc1', nickname: 'TFSA', type: 'TFSA' } },
  ]),
}));

// ── GM globals ────────────────────────────────────────────────────────────────

globalThis.GM_getValue = jest.fn(() => null);
globalThis.GM_setValue = jest.fn();

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Sets window.location.pathname for the current test using history.pushState,
 * which is fully supported in jsdom and avoids navigation interception.
 */
function setPathname(pathname) {
  history.pushState({}, '', pathname);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Questrade UI Manager — injection point', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = '';
    setPathname('/accounts/12345');

    // Return real DOM elements from upload button mocks (can't use document in jest.mock factory)
    const uploadButtonMock = jest.requireMock('../../../src/ui/questrade/components/uploadButton').default;
    uploadButtonMock.createSingleAccountUploadButton.mockReturnValue(document.createElement('button'));
    uploadButtonMock.createBulkUploadButton.mockReturnValue(document.createElement('button'));
  });

  // ── initSingleAccountUI ────────────────────────────────────────────────────

  describe('initSingleAccountUI', () => {
    test('injects #balance-uploader-container inside app-general-account-sidebar', async () => {
      const sidebar = document.createElement('app-general-account-sidebar');
      document.body.appendChild(sidebar);

      await initSingleAccountUI();

      const container = document.getElementById('balance-uploader-container');
      expect(container).not.toBeNull();
      expect(sidebar.contains(container)).toBe(true);
    });

    test('inserts container as the first child of app-general-account-sidebar', async () => {
      const sidebar = document.createElement('app-general-account-sidebar');
      const existingChild = document.createElement('div');
      existingChild.id = 'pre-existing';
      sidebar.appendChild(existingChild);
      document.body.appendChild(sidebar);

      await initSingleAccountUI();

      const container = document.getElementById('balance-uploader-container');
      expect(sidebar.firstElementChild).toBe(container);
      // Pre-existing child is pushed to second position
      expect(sidebar.children[1]).toBe(existingChild);
    });

    test('inserts as first child even when sidebar has multiple pre-existing children', async () => {
      const sidebar = document.createElement('app-general-account-sidebar');
      ['a', 'b', 'c'].forEach((id) => {
        const el = document.createElement('div');
        el.id = id;
        sidebar.appendChild(el);
      });
      document.body.appendChild(sidebar);

      await initSingleAccountUI();

      const container = document.getElementById('balance-uploader-container');
      expect(sidebar.firstElementChild).toBe(container);
      expect(sidebar.children).toHaveLength(4);
    });

    test('shows toast and returns early when app-general-account-sidebar is never found', async () => {
      // No sidebar in DOM; override waitForTargetElement timeout to resolve null quickly
      // by not adding the element at all and relying on the real observer timing out —
      // but that's 30 s, so we fake it by ensuring querySelector always returns null.
      const toast = jest.requireMock('../../../src/ui/toast').default;

      // Use a very short fake timeout: replace the real observer by mocking MutationObserver
      const OriginalMutationObserver = global.MutationObserver;
      global.MutationObserver = class {
        constructor(cb) { this._cb = cb; }
        observe() {
          // Immediately trigger timeout path by doing nothing — the real setTimeout
          // inside waitForTargetElement will fire, but it's 30 s. Instead, advance
          // timers after registering.
        }
        disconnect() {}
      };

      jest.useFakeTimers();

      const promise = initSingleAccountUI();
      jest.runAllTimers();
      await promise;

      expect(toast.show).toHaveBeenCalledWith(
        'UI element not found - please refresh the page',
        'warning',
      );

      jest.useRealTimers();
      global.MutationObserver = OriginalMutationObserver;
    });

    test('does nothing when URL has no account ID', async () => {
      setPathname('/dashboard');

      const sidebar = document.createElement('app-general-account-sidebar');
      document.body.appendChild(sidebar);

      await initSingleAccountUI();

      expect(document.getElementById('balance-uploader-container')).toBeNull();
    });

    test('reuses existing container without re-injecting', async () => {
      const sidebar = document.createElement('app-general-account-sidebar');
      document.body.appendChild(sidebar);

      // First call — creates and injects
      await initSingleAccountUI();
      expect(sidebar.querySelectorAll('#balance-uploader-container')).toHaveLength(1);

      // Second call — reuses, must not duplicate
      await initSingleAccountUI();
      expect(sidebar.querySelectorAll('#balance-uploader-container')).toHaveLength(1);
    });
  });

  // ── initAllAccountsUI ──────────────────────────────────────────────────────

  describe('initAllAccountsUI', () => {
    beforeEach(() => {
      const { isQuestradeAllAccountsPage } = jest.requireMock('../../../src/core/utils');
      isQuestradeAllAccountsPage.mockReturnValue(true);
    });

    test('injects #balance-uploader-container inside app-general-account-sidebar', async () => {
      const sidebar = document.createElement('app-general-account-sidebar');
      document.body.appendChild(sidebar);

      await initAllAccountsUI();

      const container = document.getElementById('balance-uploader-container');
      expect(container).not.toBeNull();
      expect(sidebar.contains(container)).toBe(true);
    });

    test('inserts container as the first child of app-general-account-sidebar', async () => {
      const sidebar = document.createElement('app-general-account-sidebar');
      const existingChild = document.createElement('div');
      existingChild.id = 'pre-existing';
      sidebar.appendChild(existingChild);
      document.body.appendChild(sidebar);

      await initAllAccountsUI();

      const container = document.getElementById('balance-uploader-container');
      expect(sidebar.firstElementChild).toBe(container);
      expect(sidebar.children[1]).toBe(existingChild);
    });

    test('does nothing when isQuestradeAllAccountsPage returns false', async () => {
      const { isQuestradeAllAccountsPage } = jest.requireMock('../../../src/core/utils');
      isQuestradeAllAccountsPage.mockReturnValue(false);

      const sidebar = document.createElement('app-general-account-sidebar');
      document.body.appendChild(sidebar);

      await initAllAccountsUI();

      expect(document.getElementById('balance-uploader-container')).toBeNull();
    });

    test('shows toast and returns early when app-general-account-sidebar is never found', async () => {
      const toast = jest.requireMock('../../../src/ui/toast').default;

      const OriginalMutationObserver = global.MutationObserver;
      global.MutationObserver = class {
        observe() {}
        disconnect() {}
      };

      jest.useFakeTimers();

      const promise = initAllAccountsUI();
      jest.runAllTimers();
      await promise;

      expect(toast.show).toHaveBeenCalledWith(
        'UI element not found - please refresh the page',
        'warning',
      );

      jest.useRealTimers();
      global.MutationObserver = OriginalMutationObserver;
    });
  });
});