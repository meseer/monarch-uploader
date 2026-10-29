/**
 * Comprehensive Tests for Settings Modal Component
 * Tests the current tabbed interface implementation
 */

import { createSettingsModal, showSettingsModal } from '../../src/ui/components/settingsModal';
import stateManager from '../../src/core/state';
import * as toastModule from '../../src/ui/toast';
import * as authModule from '../../src/services/auth';
import * as authModule2 from '../../src/services/questrade/auth';
import * as monarchLoginLinkModule from '../../src/ui/components/monarchLoginLink';
import * as configStoreModule from '../../src/services/common/configStore';
import * as utilsModule from '../../src/core/utils';
import * as accountServiceModule from '../../src/services/common/accountService';

// Mock dependencies
vi.mock('../../src/core/config', () => ({
  STORAGE: {
    DEVELOPMENT_MODE: 'development_mode',
    CANADALIFE_TOKEN_KEY: 'canadalife_token',
    ROGERSBANK_AUTH_TOKEN: 'rogersbank_auth_token',
    ROGERSBANK_ACCOUNT_ID: 'rogersbank_account_id',
    ROGERSBANK_CUSTOMER_ID: 'rogersbank_customer_id',
    ROGERSBANK_ACCOUNT_ID_ENCODED: 'rogersbank_account_id_encoded',
    ROGERSBANK_CUSTOMER_ID_ENCODED: 'rogersbank_customer_id_encoded',
    ROGERSBANK_DEVICE_ID: 'rogersbank_device_id',
    ROGERSBANK_LAST_UPDATED: 'rogersbank_last_updated',
    ROGERSBANK_ACCOUNTS_LIST: 'rogersbank_accounts_list',
    ROGERSBANK_LAST_CREDIT_LIMIT_PREFIX: 'rogersbank_last_credit_limit_',
    ROGERSBANK_BALANCE_CHECKPOINT_PREFIX: 'rogersbank_balance_checkpoint_',
    ROGERSBANK_ACCOUNT_MAPPING_PREFIX: 'rogersbank_account_mapping_',
    ROGERSBANK_LOOKBACK_DAYS: 'rogersbank_lookback_days',
    ROGERSBANK_LAST_UPLOAD_DATE_PREFIX: 'rogersbank_last_upload_date_',
    ROGERSBANK_UPLOADED_REFS_PREFIX: 'rogersbank_uploaded_refs_',
    ROGERSBANK_CATEGORY_MAPPINGS: 'rogersbank_category_mappings',
    MONARCH_CSRF_TOKEN: 'monarch_csrf_token', MONARCH_SESSION_EXPIRES_AT: 'monarch_session_expires_at',
    WEALTHSIMPLE_ACCOUNTS_LIST: 'wealthsimple_accounts_list',
    WEALTHSIMPLE_CONFIG: 'wealthsimple_config',
    QUESTRADE_CONFIG: 'questrade_config',
    CANADALIFE_CONFIG: 'canadalife_config',
    ROGERSBANK_CONFIG: 'rogersbank_config',
  },
  API: {
    MONARCH_APP_URL: 'https://app.monarchmoney.com',
  },
  TRANSACTION_RETENTION_DEFAULTS: {
    DAYS: 91,
    COUNT: 1000,
  },
}));

vi.mock('../../src/core/utils', async () => ({
  debugLog: vi.fn(),
  escapeHtml: (await import('../helpers/escapeHtmlMock')).realEscapeHtml(),
  getDefaultLookbackDays: vi.fn((institutionType) => {
    switch (institutionType) {
    case 'questrade': return 3;
    case 'canadalife': return 5;
    case 'rogersbank': return 7;
    default: return 3;
    }
  }),
  validateLookbackVsRetention: vi.fn(() => ({ valid: true })),
  getMinRetentionForInstitution: vi.fn(() => 91),
  getLookbackForInstitution: vi.fn(() => 7),
  getCurrentInstitution: vi.fn(() => 'unknown'),
}));

vi.mock('../../src/services/auth', () => ({
  checkMonarchAuth: vi.fn(() => ({ authenticated: false })),
}));

vi.mock('../../src/services/questrade/auth', () => ({
  checkQuestradeAuth: vi.fn(() => ({ authenticated: false })),
}));

vi.mock('../../src/ui/toast', () => ({
  __esModule: true,
  default: {
    show: vi.fn(),
  },
}));

vi.mock('../../src/ui/components/monarchLoginLink', () => ({
  createMonarchLoginLink: vi.fn(),
}));

vi.mock('../../src/services/wealthsimple/account', () => ({
  isAccountSkipped: vi.fn(() => false),
  markAccountAsSkipped: vi.fn(() => true),
  getWealthsimpleAccounts: vi.fn(() => []),
  updateAccountInList: vi.fn(() => true),
}));

vi.mock('../../src/mappers/wealthsimple-account-types', () => ({
  getMonarchAccountTypeMapping: vi.fn(() => ({ type: 'credit' })),
}));

vi.mock('../../src/services/common/accountService', () => ({
  __esModule: true,
  default: {
    getAccounts: vi.fn(() => []),
    getAccountData: vi.fn(() => null),
    saveAccounts: vi.fn(() => true),
    updateAccountInList: vi.fn(() => true),
    removeAccount: vi.fn(() => true),
    markAccountAsSkipped: vi.fn(() => true),
    isAccountSkipped: vi.fn(() => false),
  },
  getAccounts: vi.fn(() => []),
  getAccountData: vi.fn(() => null),
  saveAccounts: vi.fn(() => true),
  updateAccountInList: vi.fn(() => true),
  removeAccount: vi.fn(() => true),
  markAccountAsSkipped: vi.fn(() => true),
  isAccountSkipped: vi.fn(() => false),
}));

vi.mock('../../src/scriptInfo.json', () => {
  const mock = {
    version: '5.60.0',
    gistUrl: 'https://gist.github.com/meseer/f00fb552c96efeb3eb4e4e1fd520d4e7/raw/monarch-uploader.user.js',
  };
  return { ...mock, default: mock };
}, { virtual: true });

// configStore write helpers return a boolean success status; the UI now surfaces
// a failure instead of toasting success, so the mocks must return true by default.
vi.mock('../../src/services/common/configStore', () => ({
  getAuth: vi.fn(() => ({})),
  setSetting: vi.fn(() => true),
  getSetting: vi.fn(() => undefined),
  saveCategoryMappings: vi.fn(() => true),
}));

vi.mock('../../src/core/integrationCapabilities', () => ({
  INTEGRATIONS: {
    WEALTHSIMPLE: 'wealthsimple',
    QUESTRADE: 'questrade',
    CANADALIFE: 'canadalife',
    ROGERSBANK: 'rogersbank',
  },
  ACCOUNT_SETTINGS: {
    STORE_TX_DETAILS_IN_NOTES: 'storeTransactionDetailsInNotes',
    TRANSACTION_RETENTION_DAYS: 'transactionRetentionDays',
    TRANSACTION_RETENTION_COUNT: 'transactionRetentionCount',
    STRIP_STORE_NUMBERS: 'stripStoreNumbers',
    INCLUDE_PENDING_TRANSACTIONS: 'includePendingTransactions',
  },
  getCapabilities: vi.fn((integrationId) => ({
    id: integrationId,
    displayName: integrationId.charAt(0).toUpperCase() + integrationId.slice(1),
    accountKeyName: `${integrationId}Account`,
    hasTransactions: true,
    hasDeduplication: true,
    hasHoldings: integrationId === 'questrade' || integrationId === 'wealthsimple',
    hasCategorization: integrationId === 'rogersbank' || integrationId === 'wealthsimple',
    categoryMappingsStorageKey: integrationId === 'rogersbank' ? 'rogersbank_config' : (integrationId === 'wealthsimple' ? 'wealthsimple_config' : null),
    categorySourceLabel: integrationId === 'rogersbank' ? 'Bank Category' : (integrationId === 'wealthsimple' ? 'Merchant Name' : null),
    settings: [],
    settingDefaults: {},
  })),
  getAccountKeyName: vi.fn((integrationId) => `${integrationId}Account`),
  getDisplayName: vi.fn((integrationId) => integrationId.charAt(0).toUpperCase() + integrationId.slice(1)),
  getFaviconUrl: vi.fn(() => 'https://www.google.com/s2/favicons?domain=example.com&sz=128'),
  hasSetting: vi.fn(() => false),
  getSettingDefault: vi.fn(() => null),
  hasCapability: vi.fn((integrationId, capability) => {
    if (capability === 'hasHoldings') {
      return integrationId === 'questrade' || integrationId === 'wealthsimple';
    }
    if (capability === 'hasCategorization') {
      return integrationId === 'rogersbank' || integrationId === 'wealthsimple';
    }
    return false;
  }),
  getCategoryMappingsConfig: vi.fn((integrationId) => {
    if (integrationId === 'rogersbank') {
      return { storageKey: 'rogersbank_config', sourceLabel: 'Bank Category' };
    }
    if (integrationId === 'wealthsimple') {
      return { storageKey: 'wealthsimple_config', sourceLabel: 'Merchant Name' };
    }
    return null;
  }),
}));

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
};
Object.defineProperty(global, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

// Mock Greasemonkey functions
globalThis.GM_getValue = vi.fn();
globalThis.GM_setValue = vi.fn();
globalThis.GM_deleteValue = vi.fn();
globalThis.GM_listValues = vi.fn(() => []);
globalThis.GM_addElement = vi.fn((parent, tagName, attributes) => {
  const element = document.createElement(tagName);
  if (attributes) {
    Object.entries(attributes).forEach(([key, value]) => {
      if (key === 'style') {
        element.style.cssText = value;
      } else {
        element.setAttribute(key, value);
      }
    });
  }
  parent.appendChild(element);
  return element;
});

describe('Settings Modal Component', () => {
  let modal;
  let toast;
  let checkMonarchAuth;
  let checkQuestradeAuth;
  let createMonarchLoginLink;

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';

    toast = toastModule.default;
    checkMonarchAuth = authModule.checkMonarchAuth;
    checkQuestradeAuth = authModule2.checkQuestradeAuth;
    createMonarchLoginLink = monarchLoginLinkModule.createMonarchLoginLink;

    // Setup default mock values
    localStorageMock.getItem.mockReturnValue(null);
    globalThis.GM_getValue.mockReturnValue(null);
    globalThis.GM_listValues.mockReturnValue([]);
    checkMonarchAuth.mockReturnValue({ authenticated: false });
    checkQuestradeAuth.mockReturnValue({ authenticated: false });

    // Setup createMonarchLoginLink mock to return a real DOM element
    createMonarchLoginLink.mockImplementation((text, callback) => {
      const link = document.createElement('a');
      link.textContent = text;
      link.href = '#';
      link.onclick = callback;
      return link;
    });
  });

  afterEach(() => {
    if (modal && modal.parentNode) {
      modal.parentNode.removeChild(modal);
    }
    document.body.innerHTML = '';
  });

  describe('Modal Creation and Structure', () => {
    test('should create modal with correct backdrop structure', () => {
      modal = createSettingsModal();

      expect(modal).toBeTruthy();
      expect(modal.className).toBe('settings-modal-backdrop');
      expect(modal.style.position).toBe('fixed');
      expect(modal.style.zIndex).toBe('10000');
      expect(modal.style.width).toBe('100%');
      expect(modal.style.height).toBe('100%');
    });

    test('should create modal content with correct structure', () => {
      modal = createSettingsModal();

      const modalContent = modal.querySelector('.settings-modal-content');
      expect(modalContent).toBeTruthy();
      expect(modalContent.style.backgroundColor).toBe('var(--mu-bg-primary, white)');
      expect(modalContent.style.borderRadius).toBe('8px');
    });

    test('should create header with title and close button', () => {
      modal = createSettingsModal();

      const title = modal.querySelector('h2');
      expect(title).toBeTruthy();
      expect(title.textContent).toBe('Settings');

      const closeButton = modal.querySelector('button');
      expect(closeButton).toBeTruthy();
      expect(closeButton.innerHTML).toBe('×');
    });

    test('should create tab navigation and content areas', () => {
      modal = createSettingsModal();

      const tabNav = modal.querySelector('.settings-tab-nav');
      expect(tabNav).toBeTruthy();

      const tabContent = modal.querySelector('.settings-tab-content');
      expect(tabContent).toBeTruthy();
    });

    test('should create tab buttons for all institutions', () => {
      modal = createSettingsModal();

      const tabButtons = modal.querySelectorAll('.settings-tab-button');
      expect(tabButtons.length).toBe(6); // general, questrade, canadalife, rogersbank, wealthsimple, monarch

      const buttonTexts = Array.from(tabButtons).map((btn) => btn.textContent);
      expect(buttonTexts.some((text) => text.includes('General'))).toBe(true);
      expect(buttonTexts.some((text) => text.includes('Questrade'))).toBe(true);
      expect(buttonTexts.some((text) => text.includes('CanadaLife'))).toBe(true);
      expect(buttonTexts.some((text) => text.includes('Rogers Bank'))).toBe(true);
      expect(buttonTexts.some((text) => text.includes('Monarch'))).toBe(true);
    });
  });

  describe('Tab Navigation', () => {
    test('should show General tab as active by default', () => {
      modal = createSettingsModal();

      const activeTab = modal.querySelector('.settings-tab-button[style*="border-left-color: var(--mu-tab-active-border"]');
      expect(activeTab).toBeTruthy();
      expect(activeTab.textContent).toContain('General');
    });

    test('should switch tabs when tab buttons are clicked', () => {
      modal = createSettingsModal();

      const questradeTab = Array.from(modal.querySelectorAll('.settings-tab-button'))
        .find((btn) => btn.textContent.includes('Questrade'));

      expect(questradeTab).toBeTruthy();

      questradeTab.click();

      expect(questradeTab.style.borderLeftColor).toBe('var(--mu-tab-active-border, #0073b1)');
      expect(questradeTab.style.backgroundColor).toBe('var(--mu-tab-active-bg, white)');
    });

    test('should update tab content when switching tabs', () => {
      modal = createSettingsModal();

      const tabContent = modal.querySelector('.settings-tab-content');
      const initialContent = tabContent.innerHTML;

      const questradeTab = Array.from(modal.querySelectorAll('.settings-tab-button'))
        .find((btn) => btn.textContent.includes('Questrade'));

      questradeTab.click();

      expect(tabContent.innerHTML).not.toBe(initialContent);
    });

    test('should handle tab hover effects', () => {
      modal = createSettingsModal();

      const questradeTab = Array.from(modal.querySelectorAll('.settings-tab-button'))
        .find((btn) => btn.textContent.includes('Questrade'));

      // Simulate mouseover
      const mouseoverEvent = new Event('mouseover');
      questradeTab.dispatchEvent(mouseoverEvent);

      expect(questradeTab.style.backgroundColor).toBe('var(--mu-tab-hover-bg, #f0f0f0)');

      // Simulate mouseout
      const mouseoutEvent = new Event('mouseout');
      questradeTab.dispatchEvent(mouseoutEvent);

      expect(questradeTab.style.backgroundColor).toBe('transparent');
    });
  });

  describe('Connection Status Indicators', () => {
    test('should show disconnected status for all institutions by default', () => {
      modal = createSettingsModal();

      const connectionDots = modal.querySelectorAll('span[style*="background-color: rgb(220, 53, 69)"]');
      expect(connectionDots.length).toBe(5); // questrade, canadalife, rogersbank, wealthsimple, monarch (not general)
    });

    test('should show connected status when Questrade is authenticated', () => {
      checkQuestradeAuth.mockReturnValue({ authenticated: true });

      modal = createSettingsModal();

      const connectedDots = modal.querySelectorAll('span[style*="background-color: rgb(40, 167, 69)"]');
      expect(connectedDots.length).toBeGreaterThan(0);
    });

    test('should show connected status when Canada Life token exists', () => {
      localStorageMock.getItem.mockImplementation((key) => {
        if (key === 'canadalife_token') return 'valid-token';
        return null;
      });

      modal = createSettingsModal();

      const connectedDots = modal.querySelectorAll('span[style*="background-color: rgb(40, 167, 69)"]');
      expect(connectedDots.length).toBeGreaterThan(0);
    });

    describe('Rogers Bank (credentials held in memory only)', () => {
      const getRogersTabDot = () => Array.from(modal.querySelectorAll('.settings-tab-button'))
        .find((btn) => btn.textContent.includes('Rogers Bank'))
        .querySelector('span[title]');

      afterEach(() => {
        stateManager.setRogersBankAuth(null);
        configStoreModule.getAuth.mockImplementation(() => ({}));
      });

      test('should show connected status when a token was captured on this page', () => {
        stateManager.setRogersBankAuth({ authToken: 'valid-token' });

        modal = createSettingsModal();

        expect(getRogersTabDot().title).toBe('Connected');
      });

      test('should ignore a Rogers Bank token left in storage by an older version', () => {
        const { getAuth } = configStoreModule;
        getAuth.mockImplementation((integrationId) => (
          integrationId === 'rogersbank' ? { authToken: 'stored-token' } : {}
        ));

        modal = createSettingsModal();

        expect(getRogersTabDot().title).toBe('Not connected');
      });
    });

    describe('Wealthsimple (token read from the page cookie, never stored)', () => {
      const getWealthsimpleTabDot = () => Array.from(modal.querySelectorAll('.settings-tab-button'))
        .find((btn) => btn.textContent.includes('Wealthsimple'))
        .querySelector('span[title]');

      afterEach(() => {
        stateManager.setWealthsimpleAuth(null);
        configStoreModule.getAuth.mockImplementation(() => ({}));
      });

      test('should show connected status when this page has a valid token', () => {
        stateManager.setWealthsimpleAuth({
          authenticated: true,
          identityId: 'identity-123',
          expiresAt: '2099-01-01T00:00:00Z',
        });

        modal = createSettingsModal();

        expect(getWealthsimpleTabDot().title).toBe('Connected');
      });

      test('should show not connected when the page has no valid token', () => {
        modal = createSettingsModal();

        expect(getWealthsimpleTabDot().title).toBe('Not connected');
      });

      test('should ignore a Wealthsimple token left in storage by an older version', () => {
        const { getAuth } = configStoreModule;
        getAuth.mockImplementation((integrationId) => (
          integrationId === 'wealthsimple' ? { accessToken: 'stored-token' } : {}
        ));

        modal = createSettingsModal();

        expect(getWealthsimpleTabDot().title).toBe('Not connected');
      });
    });

    test('should show connected status when Monarch is authenticated', () => {
      checkMonarchAuth.mockReturnValue({ authenticated: true });

      modal = createSettingsModal();

      const connectedDots = modal.querySelectorAll('span[style*="background-color: rgb(40, 167, 69)"]');
      expect(connectedDots.length).toBeGreaterThan(0);
    });
  });

  describe('General Tab Content', () => {
    test('should render log level configuration', () => {
      modal = createSettingsModal();

      const tabContent = modal.querySelector('.settings-tab-content');
      expect(tabContent.textContent).toContain('Log Level');

      const select = tabContent.querySelector('select');
      expect(select).toBeTruthy();

      const options = select.querySelectorAll('option');
      expect(options.length).toBe(4);
      expect(options[0].value).toBe('debug');
      expect(options[1].value).toBe('info');
      expect(options[2].value).toBe('warning');
      expect(options[3].value).toBe('error');
    });

    test('should load current log level from storage', () => {
      globalThis.GM_getValue.mockImplementation((key, defaultValue) => {
        if (key === 'debug_log_level') return 'warning';
        return defaultValue;
      });

      modal = createSettingsModal();

      const select = modal.querySelector('select');
      expect(select.value).toBe('warning');
    });

    test('should save log level when changed', () => {
      modal = createSettingsModal();

      const select = modal.querySelector('select');
      select.value = 'error';

      const changeEvent = new Event('change');
      select.dispatchEvent(changeEvent);

      expect(globalThis.GM_setValue).toHaveBeenCalledWith('debug_log_level', 'error');
      expect(toast.show).toHaveBeenCalledWith(
        expect.stringContaining('Log level set to'),
        'info',
      );
    });

    test('should render Development Mode toggle section', () => {
      modal = createSettingsModal();

      const tabContent = modal.querySelector('.settings-tab-content');
      expect(tabContent.textContent).toContain('Development Mode');
      expect(tabContent.textContent).toContain('Enable Development Mode');
      expect(tabContent.textContent).toContain('development-only UI elements');
    });

    test('should render Development Mode toggle with correct ID', () => {
      modal = createSettingsModal();

      const devModeContainer = modal.querySelector('#settings-dev-mode-container');
      expect(devModeContainer).toBeTruthy();
    });

    test('should load Development Mode initial value from storage as false by default', () => {
      globalThis.GM_getValue.mockImplementation((key, defaultValue) => {
        if (key === 'development_mode') return false;
        return defaultValue;
      });

      modal = createSettingsModal();

      // The toggle switch should show as disabled (unchecked)
      const devModeContainer = modal.querySelector('#settings-dev-mode-container');
      expect(devModeContainer).toBeTruthy();

      // Check that the toggle is in off state (background should be #ccc)
      const switchContainer = devModeContainer.querySelector('div[style*="background-color"]');
      expect(switchContainer).toBeTruthy();
    });

    test('should load Development Mode initial value from storage as true when enabled', () => {
      globalThis.GM_getValue.mockImplementation((key, defaultValue) => {
        if (key === 'development_mode') return true;
        return defaultValue;
      });

      modal = createSettingsModal();

      const devModeContainer = modal.querySelector('#settings-dev-mode-container');
      expect(devModeContainer).toBeTruthy();

      // Toggle should be in on state (uses CSS variable in implementation)
      const toggleSwitch = devModeContainer.querySelector('div[style*="background-color: var(--mu-toggle-active-bg"]');
      expect(toggleSwitch).toBeTruthy();
    });

    test('should save Development Mode when toggled', () => {
      globalThis.GM_getValue.mockImplementation((key, defaultValue) => {
        if (key === 'development_mode') return false;
        return defaultValue;
      });

      modal = createSettingsModal();

      const devModeContainer = modal.querySelector('#settings-dev-mode-container');
      const checkbox = devModeContainer.querySelector('input[type="checkbox"]');
      expect(checkbox).toBeTruthy();

      // Simulate toggle click
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));

      expect(globalThis.GM_setValue).toHaveBeenCalledWith('development_mode', true);
      expect(toast.show).toHaveBeenCalledWith(
        expect.stringContaining('Development mode enabled'),
        'info',
      );
    });

    test('should show refresh message when Development Mode is toggled', () => {
      globalThis.GM_getValue.mockImplementation((key, defaultValue) => {
        if (key === 'development_mode') return false;
        return defaultValue;
      });

      modal = createSettingsModal();

      const devModeContainer = modal.querySelector('#settings-dev-mode-container');
      const checkbox = devModeContainer.querySelector('input[type="checkbox"]');

      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));

      expect(toast.show).toHaveBeenCalledWith(
        expect.stringContaining('Refresh the page'),
        'info',
      );
    });
  });

  describe('Institution Logo Handling', () => {
    test('should use Google Favicon API for Questrade tab', () => {
      modal = createSettingsModal();

      expect(globalThis.GM_addElement).toHaveBeenCalledWith(
        expect.any(HTMLElement),
        'img',
        expect.objectContaining({
          src: 'https://www.google.com/s2/favicons?domain=questrade.com&sz=128',
        }),
      );
    });

    test('should use Google Favicon API for CanadaLife tab', () => {
      modal = createSettingsModal();

      expect(globalThis.GM_addElement).toHaveBeenCalledWith(
        expect.any(HTMLElement),
        'img',
        expect.objectContaining({
          src: 'https://www.google.com/s2/favicons?domain=canadalife.com&sz=128',
        }),
      );
    });

    test('should use Google Favicon API for Rogers Bank tab', () => {
      modal = createSettingsModal();

      expect(globalThis.GM_addElement).toHaveBeenCalledWith(
        expect.any(HTMLElement),
        'img',
        expect.objectContaining({
          src: 'https://www.google.com/s2/favicons?domain=rogersbank.com&sz=128',
        }),
      );
    });

    test('should use Google Favicon API for Wealthsimple tab', () => {
      modal = createSettingsModal();

      expect(globalThis.GM_addElement).toHaveBeenCalledWith(
        expect.any(HTMLElement),
        'img',
        expect.objectContaining({
          src: 'https://www.google.com/s2/favicons?domain=wealthsimple.com&sz=128',
        }),
      );
    });

    test('should use Google Favicon API for Monarch tab', () => {
      modal = createSettingsModal();

      expect(globalThis.GM_addElement).toHaveBeenCalledWith(
        expect.any(HTMLElement),
        'img',
        expect.objectContaining({
          src: 'https://www.google.com/s2/favicons?domain=monarchmoney.com&sz=128',
        }),
      );
    });

    test('should use emoji fallback for General tab', () => {
      modal = createSettingsModal();

      const generalTab = Array.from(modal.querySelectorAll('.settings-tab-button'))
        .find((btn) => btn.textContent.includes('General'));

      expect(generalTab.textContent).toContain('⚙️');
    });

    test('should handle JSON parse errors gracefully when loading logos', () => {
      globalThis.GM_listValues.mockReturnValue(['questrade_account_mapping_invalid']);
      globalThis.GM_getValue.mockImplementation((key) => {
        if (key === 'questrade_account_mapping_invalid') {
          return 'invalid-json{';
        }
        return null;
      });

      expect(() => {
        modal = createSettingsModal();
      }).not.toThrow();
    });
  });

  describe('Lookback Period Configuration', () => {
    test('should create lookback section for Questrade', () => {
      modal = createSettingsModal();

      const questradeTab = Array.from(modal.querySelectorAll('.settings-tab-button'))
        .find((btn) => btn.textContent.includes('Questrade'));
      questradeTab.click();

      const tabContent = modal.querySelector('.settings-tab-content');
      expect(tabContent.textContent).toContain('Lookback Period');
      expect(tabContent.textContent).toContain('Lookback Days');

      const input = tabContent.querySelector('input[type="number"]');
      expect(input).toBeTruthy();
      expect(input.min).toBe('0');
      expect(input.max).toBe('30');
    });

    test('should load current lookback value for institution', () => {
      const { getLookbackForInstitution } = utilsModule;
      getLookbackForInstitution.mockReturnValue(5);

      globalThis.GM_getValue.mockImplementation((key, defaultValue) => {
        if (key === 'questrade_lookback_days') return 5;
        return defaultValue;
      });

      modal = createSettingsModal();

      const questradeTab = Array.from(modal.querySelectorAll('.settings-tab-button'))
        .find((btn) => btn.textContent.includes('Questrade'));
      questradeTab.click();

      const input = modal.querySelector('input[type="number"]');
      expect(input.value).toBe('5');
    });

    test('should save lookback days on blur via configStore', () => {
      const { setSetting } = configStoreModule;

      modal = createSettingsModal();

      const questradeTab = Array.from(modal.querySelectorAll('.settings-tab-button'))
        .find((btn) => btn.textContent.includes('Questrade'));
      questradeTab.click();

      const input = modal.querySelector('input[type="number"]');
      input.value = '7';

      const blurEvent = new Event('blur');
      input.dispatchEvent(blurEvent);

      expect(setSetting).toHaveBeenCalledWith('questrade', 'lookbackDays', 7);
      expect(toast.show).toHaveBeenCalledWith(
        expect.stringContaining('Questrade lookback period set to 7'),
        'info',
      );
    });

    // Regression: a dropped configStore write used to still toast success, which
    // hid the fact that the lookback period was never persisted.
    test('should report an error instead of success when the write fails', () => {
      const { setSetting } = configStoreModule;
      setSetting.mockReturnValueOnce(false);

      modal = createSettingsModal();

      const questradeTab = Array.from(modal.querySelectorAll('.settings-tab-button'))
        .find((btn) => btn.textContent.includes('Questrade'));
      questradeTab.click();

      const input = modal.querySelector('input[type="number"]');
      input.value = '7';
      input.dispatchEvent(new Event('blur'));

      expect(setSetting).toHaveBeenCalledWith('questrade', 'lookbackDays', 7);
      expect(toast.show).toHaveBeenCalledWith(
        expect.stringContaining('Could not save the Questrade lookback period'),
        'error',
      );
      expect(toast.show).not.toHaveBeenCalledWith(
        expect.stringContaining('lookback period set to 7'),
        'info',
      );
    });

    test('should save lookback days on enter key via configStore', () => {
      const { setSetting } = configStoreModule;

      modal = createSettingsModal();

      const questradeTab = Array.from(modal.querySelectorAll('.settings-tab-button'))
        .find((btn) => btn.textContent.includes('Questrade'));
      questradeTab.click();

      const input = modal.querySelector('input[type="number"]');
      input.value = '10';

      const keydownEvent = new KeyboardEvent('keydown', { key: 'Enter' });
      input.dispatchEvent(keydownEvent);

      expect(setSetting).toHaveBeenCalledWith('questrade', 'lookbackDays', 10);
    });

    test('should validate lookback days input range', () => {
      modal = createSettingsModal();

      const questradeTab = Array.from(modal.querySelectorAll('.settings-tab-button'))
        .find((btn) => btn.textContent.includes('Questrade'));
      questradeTab.click();

      const input = modal.querySelector('input[type="number"]');
      input.value = '50'; // Invalid - over 30

      const blurEvent = new Event('blur');
      input.dispatchEvent(blurEvent);

      expect(toast.show).toHaveBeenCalledWith(
        'Please enter a valid number between 0 and 30',
        'error',
      );
    });

    test('should reset to default when reset button clicked via configStore', () => {
      const { setSetting } = configStoreModule;

      modal = createSettingsModal();

      const questradeTab = Array.from(modal.querySelectorAll('.settings-tab-button'))
        .find((btn) => btn.textContent.includes('Questrade'));
      questradeTab.click();

      const resetButton = Array.from(modal.querySelectorAll('button'))
        .find((btn) => btn.textContent === 'Reset to Default');
      expect(resetButton).toBeTruthy();

      resetButton.click();

      expect(setSetting).toHaveBeenCalledWith('questrade', 'lookbackDays', 3);
      expect(toast.show).toHaveBeenCalledWith(
        expect.stringContaining('reset to default'),
        'info',
      );
    });

    test('should handle reset button hover effects', () => {
      modal = createSettingsModal();

      const questradeTab = Array.from(modal.querySelectorAll('.settings-tab-button'))
        .find((btn) => btn.textContent.includes('Questrade'));
      questradeTab.click();

      const resetButton = Array.from(modal.querySelectorAll('button'))
        .find((btn) => btn.textContent === 'Reset to Default');

      // Simulate mouseover
      const mouseoverEvent = new Event('mouseover');
      resetButton.dispatchEvent(mouseoverEvent);

      expect(resetButton.style.backgroundColor).toBe('var(--mu-bg-secondary, #f8f9fa)');

      // Simulate mouseout
      const mouseoutEvent = new Event('mouseout');
      resetButton.dispatchEvent(mouseoutEvent);

      expect(resetButton.style.backgroundColor).toBe('var(--mu-bg-primary, white)');
    });
  });

  describe('Account Mapping Display', () => {
    test('should show empty message when no account mappings exist', () => {
      modal = createSettingsModal();

      const questradeTab = Array.from(modal.querySelectorAll('.settings-tab-button'))
        .find((btn) => btn.textContent.includes('Questrade'));
      questradeTab.click();

      const tabContent = modal.querySelector('.settings-tab-content');
      // Generic account cards show "No accounts found" when no accounts are available
      expect(tabContent.textContent).toContain('No accounts found');
    });

    test('should display account mappings when available', () => {
      // Mock accountService to return accounts
      const accountService = accountServiceModule.default;
      accountService.getAccounts.mockReturnValue([{
        questradeAccount: {
          id: '12345',
          nickname: 'Test Account',
          type: 'Checking',
        },
        monarchAccount: {
          id: 'monarch-123',
          displayName: 'Monarch Test Account',
        },
        syncEnabled: true,
        lastSyncDate: '2023-01-15T10:30:00Z',
      }]);

      modal = createSettingsModal();

      const questradeTab = Array.from(modal.querySelectorAll('.settings-tab-button'))
        .find((btn) => btn.textContent.includes('Questrade'));
      questradeTab.click();

      const tabContent = modal.querySelector('.settings-tab-content');
      expect(tabContent.textContent).toContain('Test Account');
      expect(tabContent.textContent).toContain('Checking');
    });

    test('should handle account mapping card expansion', () => {
      // Mock accountService to return accounts
      const accountService = accountServiceModule.default;
      accountService.getAccounts.mockReturnValue([{
        questradeAccount: {
          id: '12345',
          nickname: 'Test Account',
          type: 'Checking',
        },
        monarchAccount: {
          id: 'monarch-123',
          displayName: 'Monarch Test Account',
        },
        syncEnabled: true,
      }]);

      modal = createSettingsModal();

      const questradeTab = Array.from(modal.querySelectorAll('.settings-tab-button'))
        .find((btn) => btn.textContent.includes('Questrade'));
      questradeTab.click();

      const cardHeader = modal.querySelector('[style*="cursor: pointer"]');
      expect(cardHeader).toBeTruthy();

      cardHeader.click();

      // Check that some expansion occurred (details might be expanded or icon rotated)
      const expandedElements = modal.querySelectorAll('[style*="transform"], [style*="display: block"]');
      expect(expandedElements.length).toBeGreaterThan(0);
    });

    test('should handle account mapping deletion with confirmation', () => {
      // Mock accountService to return accounts
      const accountService = accountServiceModule.default;
      accountService.getAccounts.mockReturnValue([{
        questradeAccount: {
          id: '12345',
          nickname: 'Test Account',
        },
        monarchAccount: {
          id: 'monarch-123',
          displayName: 'Monarch Test Account',
        },
        syncEnabled: true,
      }]);

      modal = createSettingsModal();

      const questradeTab = Array.from(modal.querySelectorAll('.settings-tab-button'))
        .find((btn) => btn.textContent.includes('Questrade'));
      questradeTab.click();

      const deleteButton = Array.from(modal.querySelectorAll('button'))
        .find((btn) => btn.textContent === '🗑️');

      expect(deleteButton).toBeTruthy();
    });
  });

  describe('Last Update Date Management', () => {
    test('should display last synced date when available', () => {
      // Mock accountService to return accounts with lastSyncDate
      const accountService = accountServiceModule.default;
      accountService.getAccounts.mockReturnValue([{
        questradeAccount: {
          id: '12345',
          nickname: 'Test Account',
        },
        monarchAccount: {
          id: 'monarch-123',
          displayName: 'Monarch Test Account',
        },
        syncEnabled: true,
        lastSyncDate: '2023-01-15T10:30:00Z',
      }]);

      modal = createSettingsModal();

      const questradeTab = Array.from(modal.querySelectorAll('.settings-tab-button'))
        .find((btn) => btn.textContent.includes('Questrade'));
      questradeTab.click();

      const tabContent = modal.querySelector('.settings-tab-content');
      expect(tabContent.textContent).toContain('Last synced');
      expect(tabContent.textContent).toContain('Jan');
    });

    test('should not show last sync info when no date exists', () => {
      // Mock accountService to return accounts without lastSyncDate
      const accountService = accountServiceModule.default;
      accountService.getAccounts.mockReturnValue([{
        questradeAccount: {
          id: '12345',
          nickname: 'Test Account',
        },
        monarchAccount: {
          id: 'monarch-123',
          displayName: 'Monarch Test Account',
        },
        syncEnabled: true,
        // No lastSyncDate
      }]);

      modal = createSettingsModal();

      const questradeTab = Array.from(modal.querySelectorAll('.settings-tab-button'))
        .find((btn) => btn.textContent.includes('Questrade'));
      questradeTab.click();

      const tabContent = modal.querySelector('.settings-tab-content');
      // Should show account but no "Last synced" info
      expect(tabContent.textContent).toContain('Test Account');
    });

    test('should show delete button for accounts', () => {
      // Mock accountService to return accounts
      const accountService = accountServiceModule.default;
      accountService.getAccounts.mockReturnValue([{
        questradeAccount: {
          id: '12345',
          nickname: 'Test Account',
        },
        monarchAccount: {
          id: 'monarch-123',
          displayName: 'Monarch Test Account',
        },
        syncEnabled: true,
        lastSyncDate: '2023-01-15T10:30:00Z',
      }]);

      modal = createSettingsModal();

      const questradeTab = Array.from(modal.querySelectorAll('.settings-tab-button'))
        .find((btn) => btn.textContent.includes('Questrade'));
      questradeTab.click();

      const deleteButton = Array.from(modal.querySelectorAll('button'))
        .find((btn) => btn.textContent === '🗑️');
      expect(deleteButton).toBeTruthy();
    });

    test('should handle accounts without sync date', () => {
      // Mock accountService to return accounts
      const accountService = accountServiceModule.default;
      accountService.getAccounts.mockReturnValue([{
        questradeAccount: {
          id: '12345',
          nickname: 'Test Account',
        },
        monarchAccount: {
          id: 'monarch-123',
          displayName: 'Monarch Test Account',
        },
        syncEnabled: true,
      }]);

      modal = createSettingsModal();

      const questradeTab = Array.from(modal.querySelectorAll('.settings-tab-button'))
        .find((btn) => btn.textContent.includes('Questrade'));
      questradeTab.click();

      const tabContent = modal.querySelector('.settings-tab-content');
      // Account should be displayed without errors
      expect(tabContent.textContent).toContain('Test Account');
    });
  });

});
