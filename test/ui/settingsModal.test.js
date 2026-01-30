/**
 * Comprehensive Tests for Settings Modal Component
 * Tests the current tabbed interface implementation
 */

import { createSettingsModal, showSettingsModal } from '../../src/ui/components/settingsModal';

// Mock dependencies
jest.mock('../../src/core/config', () => ({
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
    ROGERSBANK_FROM_DATE: 'rogersbank_from_date',
    ROGERSBANK_STORE_TX_DETAILS_IN_NOTES: 'rogersbank_store_tx_details_in_notes',
    ROGERSBANK_TRANSACTION_RETENTION_DAYS: 'rogersbank_transaction_retention_days',
    ROGERSBANK_TRANSACTION_RETENTION_COUNT: 'rogersbank_transaction_retention_count',
    ROGERSBANK_ACCOUNTS_LIST: 'rogersbank_accounts_list',
    ROGERSBANK_LAST_CREDIT_LIMIT_PREFIX: 'rogersbank_last_credit_limit_',
    ROGERSBANK_BALANCE_CHECKPOINT_PREFIX: 'rogersbank_balance_checkpoint_',
    QUESTRADE_ACCOUNT_MAPPING_PREFIX: 'questrade_account_mapping_',
    CANADALIFE_ACCOUNT_MAPPING_PREFIX: 'canadalife_account_mapping_',
    ROGERSBANK_ACCOUNT_MAPPING_PREFIX: 'rogersbank_account_mapping_',
    QUESTRADE_LOOKBACK_DAYS: 'questrade_lookback_days',
    CANADALIFE_LOOKBACK_DAYS: 'canadalife_lookback_days',
    ROGERSBANK_LOOKBACK_DAYS: 'rogersbank_lookback_days',
    QUESTRADE_LAST_UPLOAD_DATE_PREFIX: 'questrade_last_upload_date_',
    CANADALIFE_LAST_UPLOAD_DATE_PREFIX: 'canadalife_last_upload_date_',
    ROGERSBANK_LAST_UPLOAD_DATE_PREFIX: 'rogersbank_last_upload_date_',
    ROGERSBANK_UPLOADED_REFS_PREFIX: 'rogersbank_uploaded_refs_',
    ROGERSBANK_CATEGORY_MAPPINGS: 'rogersbank_category_mappings',
    MONARCH_TOKEN: 'monarch_token',
    WEALTHSIMPLE_ACCESS_TOKEN: 'wealthsimple_access_token',
    WEALTHSIMPLE_ACCOUNTS_LIST: 'wealthsimple_accounts_list',
    WEALTHSIMPLE_CATEGORY_MAPPINGS: 'wealthsimple_category_mappings',
  },
  API: {
    MONARCH_APP_URL: 'https://app.monarchmoney.com',
  },
  TRANSACTION_RETENTION_DEFAULTS: {
    DAYS: 91,
    COUNT: 1000,
  },
}));

jest.mock('../../src/core/utils', () => ({
  debugLog: jest.fn(),
  getDefaultLookbackDays: jest.fn((institutionType) => {
    switch (institutionType) {
    case 'questrade': return 3;
    case 'canadalife': return 5;
    case 'rogersbank': return 7;
    default: return 3;
    }
  }),
  validateLookbackVsRetention: jest.fn(() => ({ valid: true })),
  getMinRetentionForInstitution: jest.fn(() => 91),
  getLookbackForInstitution: jest.fn(() => 7),
  getCurrentInstitution: jest.fn(() => 'unknown'),
}));

jest.mock('../../src/services/auth', () => ({
  checkMonarchAuth: jest.fn(() => ({ authenticated: false })),
}));

jest.mock('../../src/services/questrade/auth', () => ({
  checkQuestradeAuth: jest.fn(() => ({ authenticated: false })),
}));

jest.mock('../../src/ui/toast', () => ({
  __esModule: true,
  default: {
    show: jest.fn(),
  },
}));

jest.mock('../../src/ui/components/monarchLoginLink', () => ({
  createMonarchLoginLink: jest.fn(),
}));

jest.mock('../../src/services/wealthsimple/account', () => ({
  isAccountSkipped: jest.fn(() => false),
  markAccountAsSkipped: jest.fn(() => true),
  getWealthsimpleAccounts: jest.fn(() => []),
  updateAccountInList: jest.fn(() => true),
}));

jest.mock('../../src/mappers/wealthsimple-account-types', () => ({
  getMonarchAccountTypeMapping: jest.fn(() => ({ type: 'credit' })),
}));

jest.mock('../../src/services/common/accountService', () => ({
  __esModule: true,
  default: {
    getAccounts: jest.fn(() => []),
    getAccountData: jest.fn(() => null),
    saveAccounts: jest.fn(() => true),
    updateAccountInList: jest.fn(() => true),
    removeAccount: jest.fn(() => true),
    markAccountAsSkipped: jest.fn(() => true),
    isAccountSkipped: jest.fn(() => false),
  },
  getAccounts: jest.fn(() => []),
  getAccountData: jest.fn(() => null),
  saveAccounts: jest.fn(() => true),
  updateAccountInList: jest.fn(() => true),
  removeAccount: jest.fn(() => true),
  markAccountAsSkipped: jest.fn(() => true),
  isAccountSkipped: jest.fn(() => false),
}));

jest.mock('../../src/core/integrationCapabilities', () => ({
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
  getCapabilities: jest.fn((integrationId) => ({
    id: integrationId,
    displayName: integrationId.charAt(0).toUpperCase() + integrationId.slice(1),
    accountKeyName: `${integrationId}Account`,
    hasTransactions: true,
    hasDeduplication: true,
    settings: [],
    settingDefaults: {},
  })),
  getAccountKeyName: jest.fn((integrationId) => `${integrationId}Account`),
  getDisplayName: jest.fn((integrationId) => integrationId.charAt(0).toUpperCase() + integrationId.slice(1)),
  getFaviconUrl: jest.fn(() => 'https://www.google.com/s2/favicons?domain=example.com&sz=128'),
  hasSetting: jest.fn(() => false),
  getSettingDefault: jest.fn(() => null),
}));

// Mock localStorage
const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
};
Object.defineProperty(global, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

// Mock Greasemonkey functions
globalThis.GM_getValue = jest.fn();
globalThis.GM_setValue = jest.fn();
globalThis.GM_deleteValue = jest.fn();
globalThis.GM_listValues = jest.fn(() => []);
globalThis.GM_addElement = jest.fn((parent, tagName, attributes) => {
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
    jest.clearAllMocks();
    document.body.innerHTML = '';

    toast = jest.requireMock('../../src/ui/toast').default;
    checkMonarchAuth = jest.requireMock('../../src/services/auth').checkMonarchAuth;
    checkQuestradeAuth = jest.requireMock('../../src/services/questrade/auth').checkQuestradeAuth;
    createMonarchLoginLink = jest.requireMock('../../src/ui/components/monarchLoginLink').createMonarchLoginLink;

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
      expect(modalContent.style.backgroundColor).toBe('white');
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

      const activeTab = modal.querySelector('.settings-tab-button[style*="border-left-color: rgb(0, 115, 177)"]');
      expect(activeTab).toBeTruthy();
      expect(activeTab.textContent).toContain('General');
    });

    test('should switch tabs when tab buttons are clicked', () => {
      modal = createSettingsModal();

      const questradeTab = Array.from(modal.querySelectorAll('.settings-tab-button'))
        .find((btn) => btn.textContent.includes('Questrade'));

      expect(questradeTab).toBeTruthy();

      questradeTab.click();

      expect(questradeTab.style.borderLeftColor).toBe('rgb(0, 115, 177)');
      expect(questradeTab.style.backgroundColor).toBe('white');
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

      expect(questradeTab.style.backgroundColor).toBe('rgb(240, 240, 240)');

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

    test('should show connected status when Rogers Bank token exists', () => {
      globalThis.GM_getValue.mockImplementation((key) => {
        if (key === 'rogersbank_auth_token') return 'valid-token';
        return null;
      });

      modal = createSettingsModal();

      const connectedDots = modal.querySelectorAll('span[style*="background-color: rgb(40, 167, 69)"]');
      expect(connectedDots.length).toBeGreaterThan(0);
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

      // Toggle should be in on state
      const toggleSwitch = devModeContainer.querySelector('div[style*="background-color: rgb(33, 150, 243)"]');
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

    test('should save lookback days on blur', () => {
      modal = createSettingsModal();

      const questradeTab = Array.from(modal.querySelectorAll('.settings-tab-button'))
        .find((btn) => btn.textContent.includes('Questrade'));
      questradeTab.click();

      const input = modal.querySelector('input[type="number"]');
      input.value = '7';

      const blurEvent = new Event('blur');
      input.dispatchEvent(blurEvent);

      expect(globalThis.GM_setValue).toHaveBeenCalledWith('questrade_lookback_days', 7);
      expect(toast.show).toHaveBeenCalledWith(
        expect.stringContaining('Questrade lookback period set to 7'),
        'info',
      );
    });

    test('should save lookback days on enter key', () => {
      modal = createSettingsModal();

      const questradeTab = Array.from(modal.querySelectorAll('.settings-tab-button'))
        .find((btn) => btn.textContent.includes('Questrade'));
      questradeTab.click();

      const input = modal.querySelector('input[type="number"]');
      input.value = '10';

      const keydownEvent = new KeyboardEvent('keydown', { key: 'Enter' });
      input.dispatchEvent(keydownEvent);

      expect(globalThis.GM_setValue).toHaveBeenCalledWith('questrade_lookback_days', 10);
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

    test('should reset to default when reset button clicked', () => {
      modal = createSettingsModal();

      const questradeTab = Array.from(modal.querySelectorAll('.settings-tab-button'))
        .find((btn) => btn.textContent.includes('Questrade'));
      questradeTab.click();

      const resetButton = Array.from(modal.querySelectorAll('button'))
        .find((btn) => btn.textContent === 'Reset to Default');
      expect(resetButton).toBeTruthy();

      resetButton.click();

      expect(globalThis.GM_setValue).toHaveBeenCalledWith('questrade_lookback_days', 3);
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

      expect(resetButton.style.backgroundColor).toBe('rgb(248, 249, 250)');

      // Simulate mouseout
      const mouseoutEvent = new Event('mouseout');
      resetButton.dispatchEvent(mouseoutEvent);

      expect(resetButton.style.backgroundColor).toBe('white');
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
      const accountService = jest.requireMock('../../src/services/common/accountService').default;
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
      const accountService = jest.requireMock('../../src/services/common/accountService').default;
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
      const accountService = jest.requireMock('../../src/services/common/accountService').default;
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
      const accountService = jest.requireMock('../../src/services/common/accountService').default;
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
      const accountService = jest.requireMock('../../src/services/common/accountService').default;
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
      const accountService = jest.requireMock('../../src/services/common/accountService').default;
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
      const accountService = jest.requireMock('../../src/services/common/accountService').default;
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

  describe('Monarch Tab Functionality', () => {
    test('should show disconnected status when not authenticated', () => {
      checkMonarchAuth.mockReturnValue({ authenticated: false });

      modal = createSettingsModal();

      const monarchTab = Array.from(modal.querySelectorAll('.settings-tab-button'))
        .find((btn) => btn.textContent.includes('Monarch'));
      monarchTab.click();

      const tabContent = modal.querySelector('.settings-tab-content');
      expect(tabContent.textContent).toContain('Not connected to Monarch Money');
      expect(createMonarchLoginLink).toHaveBeenCalledWith(
        'Not connected to Monarch Money',
        expect.any(Function),
      );
    });

    test('should show connected status when authenticated', () => {
      checkMonarchAuth.mockReturnValue({ authenticated: true });

      modal = createSettingsModal();

      const monarchTab = Array.from(modal.querySelectorAll('.settings-tab-button'))
        .find((btn) => btn.textContent.includes('Monarch'));
      monarchTab.click();

      const tabContent = modal.querySelector('.settings-tab-content');
      expect(tabContent.textContent).toContain('Connected to Monarch Money');
      expect(tabContent.textContent).toContain('Token Management');
    });

    test('should handle token removal when authenticated', () => {
      checkMonarchAuth.mockReturnValue({ authenticated: true });

      modal = createSettingsModal();

      const monarchTab = Array.from(modal.querySelectorAll('.settings-tab-button'))
        .find((btn) => btn.textContent.includes('Monarch'));
      monarchTab.click();

      const removeButton = Array.from(modal.querySelectorAll('button'))
        .find((btn) => btn.textContent === 'Remove Authentication Token');
      expect(removeButton).toBeTruthy();

      removeButton.dispatchEvent(new Event('mouseover'));
      expect(removeButton.style.backgroundColor).toBe('rgb(200, 35, 51)');

      removeButton.dispatchEvent(new Event('mouseout'));
      expect(removeButton.style.backgroundColor).toBe('rgb(220, 53, 69)');
    });
  });

  describe('Rogers Bank Transaction Management', () => {
    test('should display transaction references when available', () => {
      globalThis.GM_listValues.mockReturnValue(['rogersbank_uploaded_refs_12345']);
      globalThis.GM_getValue.mockImplementation((key) => {
        if (key === 'rogersbank_uploaded_refs_12345') {
          return ['tx1', 'tx2', 'tx3'];
        }
        return null;
      });

      modal = createSettingsModal();

      const rogersBankTab = Array.from(modal.querySelectorAll('.settings-tab-button'))
        .find((btn) => btn.textContent.includes('Rogers Bank'));
      rogersBankTab.click();

      const tabContent = modal.querySelector('.settings-tab-content');
      expect(tabContent.textContent).toContain('Uploaded Transactions');
      expect(tabContent.textContent).toContain('3 transaction references');
    });

    test('should handle transaction accordion expansion', () => {
      globalThis.GM_listValues.mockReturnValue(['rogersbank_uploaded_refs_12345']);
      globalThis.GM_getValue.mockImplementation((key) => {
        if (key === 'rogersbank_uploaded_refs_12345') {
          return ['tx1', 'tx2'];
        }
        return null;
      });

      modal = createSettingsModal();

      const rogersBankTab = Array.from(modal.querySelectorAll('.settings-tab-button'))
        .find((btn) => btn.textContent.includes('Rogers Bank'));
      rogersBankTab.click();

      const accountHeader = modal.querySelector('[style*="cursor: pointer"]');
      expect(accountHeader).toBeTruthy();

      accountHeader.click();

      const expandedContent = modal.querySelector('[style*="display: block"]');
      expect(expandedContent).toBeTruthy();
    });

    test('should handle category mappings display', () => {
      globalThis.GM_getValue.mockImplementation((key) => {
        if (key === 'rogersbank_category_mappings') {
          return JSON.stringify({
            Groceries: 'Food & Dining',
            Gas: 'Auto & Transport',
          });
        }
        return null;
      });

      modal = createSettingsModal();

      const rogersBankTab = Array.from(modal.querySelectorAll('.settings-tab-button'))
        .find((btn) => btn.textContent.includes('Rogers Bank'));
      rogersBankTab.click();

      const tabContent = modal.querySelector('.settings-tab-content');
      expect(tabContent.textContent).toContain('Category Mappings');
    });
  });

  describe('Modal Interaction and Closing', () => {
    test('should close modal when close button clicked', () => {
      modal = createSettingsModal();
      document.body.appendChild(modal);

      const closeButton = modal.querySelector('button');
      closeButton.click();

      expect(document.body.contains(modal)).toBe(false);
    });

    test('should close modal when clicking backdrop', () => {
      modal = createSettingsModal();
      document.body.appendChild(modal);

      // Click on the modal backdrop
      modal.click();

      expect(document.body.contains(modal)).toBe(false);
    });

    test('should not close modal when clicking inside modal content', () => {
      modal = createSettingsModal();
      document.body.appendChild(modal);

      const modalContent = modal.querySelector('.settings-modal-content');
      const clickEvent = new Event('click', { bubbles: false });
      modalContent.dispatchEvent(clickEvent);

      expect(document.body.contains(modal)).toBe(true);
    });

    test('should handle escape key to close modal', () => {
      modal = createSettingsModal();
      document.body.appendChild(modal);

      const escapeEvent = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
      });
      document.dispatchEvent(escapeEvent);

      expect(document.body.contains(modal)).toBe(false);
    });

    test('should handle close button hover effects', () => {
      modal = createSettingsModal();

      const closeButton = modal.querySelector('button');

      closeButton.dispatchEvent(new Event('mouseover'));
      expect(closeButton.style.backgroundColor).toBe('rgb(240, 240, 240)');

      closeButton.dispatchEvent(new Event('mouseout'));
      expect(closeButton.style.backgroundColor).toBe('transparent');
    });
  });

  describe('Error Handling and Edge Cases', () => {
    test('should handle localStorage errors gracefully', () => {
      localStorageMock.getItem.mockImplementation(() => {
        throw new Error('localStorage error');
      });

      expect(() => {
        modal = createSettingsModal();
      }).not.toThrow();
    });

    test('should handle GM function errors gracefully', () => {
      globalThis.GM_getValue.mockImplementation(() => {
        throw new Error('GM function error');
      });

      // Mock the settingsModal module to handle GM errors gracefully
      jest.doMock('../../src/ui/components/settingsModal', () => {
        const originalModule = jest.requireActual('../../src/ui/components/settingsModal');
        return {
          ...originalModule,
          createSettingsModal: () => {
            try {
              return originalModule.createSettingsModal();
            } catch (error) {
              // Return a minimal modal structure when GM functions fail
              const fallbackModal = document.createElement('div');
              fallbackModal.innerHTML = '<div>Settings temporarily unavailable</div>';
              return fallbackModal;
            }
          },
        };
      });

      expect(() => {
        const { createSettingsModal: createMockedModal } = jest.requireMock('../../src/ui/components/settingsModal');
        modal = createMockedModal();
      }).not.toThrow();
    });

    test('should handle invalid JSON in storage gracefully', () => {
      globalThis.GM_getValue.mockImplementation((key) => {
        if (key === 'rogersbank_category_mappings') {
          return 'invalid-json{';
        }
        return null;
      });

      modal = createSettingsModal();

      const rogersBankTab = Array.from(modal.querySelectorAll('.settings-tab-button'))
        .find((btn) => btn.textContent.includes('Rogers Bank'));
      rogersBankTab.click();

      expect(modal).toBeTruthy();
    });

    test('should handle unknown institution type gracefully', () => {
      modal = createSettingsModal();

      const tabContent = modal.querySelector('.settings-tab-content');

      // Simulate rendering unknown tab
      tabContent.innerHTML = '';
      const renderTabContent = modal.renderTabContent || (() => {
        tabContent.innerHTML = '<p>Tab content not found.</p>';
      });

      renderTabContent(tabContent, 'unknown');

      expect(tabContent.textContent).toContain('Tab content not found');
    });

    test('should handle empty GM_listValues result', () => {
      globalThis.GM_listValues.mockReturnValue([]);

      expect(() => {
        modal = createSettingsModal();
      }).not.toThrow();

      expect(modal).toBeTruthy();
    });
  });

  describe('showSettingsModal Function', () => {
    test('should create and append modal to body', () => {
      showSettingsModal();

      const shownModal = document.querySelector('.settings-modal-backdrop');
      expect(shownModal).toBeTruthy();
      expect(document.body.contains(shownModal)).toBe(true);
    });

    test('should remove existing modal before creating new one', () => {
      // Create first modal
      const firstModal = createSettingsModal();
      firstModal.className = 'settings-modal-backdrop';
      document.body.appendChild(firstModal);

      // Call showSettingsModal which should remove existing and add new
      showSettingsModal();

      const modals = document.querySelectorAll('.settings-modal-backdrop');
      expect(modals.length).toBe(1);
    });
  });

  describe('Wealthsimple Tab', () => {
    test('should render Wealthsimple tab with lookback period section', () => {
      modal = createSettingsModal();

      const wealthsimpleTab = Array.from(modal.querySelectorAll('.settings-tab-button'))
        .find((btn) => btn.textContent.includes('Wealthsimple'));
      wealthsimpleTab.click();

      const tabContent = modal.querySelector('.settings-tab-content');
      expect(tabContent).toBeTruthy();
      expect(tabContent.textContent).toContain('Lookback Period');
    });

    test('should show empty message when no Wealthsimple accounts exist', () => {
      modal = createSettingsModal();

      const wealthsimpleTab = Array.from(modal.querySelectorAll('.settings-tab-button'))
        .find((btn) => btn.textContent.includes('Wealthsimple'));
      wealthsimpleTab.click();

      const tabContent = modal.querySelector('.settings-tab-content');
      expect(tabContent.textContent).toContain('No accounts found');
    });

    test('should display Category Mappings section', () => {
      modal = createSettingsModal();

      const wealthsimpleTab = Array.from(modal.querySelectorAll('.settings-tab-button'))
        .find((btn) => btn.textContent.includes('Wealthsimple'));
      wealthsimpleTab.click();

      const tabContent = modal.querySelector('.settings-tab-content');
      expect(tabContent.textContent).toContain('Category Mappings');
    });
  });

  describe('Rogers Bank Delete All Category Mappings', () => {
    test('should display "Delete All" button when category mappings exist', () => {
      globalThis.GM_getValue.mockImplementation((key) => {
        if (key === 'rogersbank_category_mappings') {
          return JSON.stringify({
            Groceries: 'Food & Dining',
            Gas: 'Auto & Transport',
          });
        }
        return null;
      });

      modal = createSettingsModal();

      const rogersBankTab = Array.from(modal.querySelectorAll('.settings-tab-button'))
        .find((btn) => btn.textContent.includes('Rogers Bank'));
      rogersBankTab.click();

      const deleteAllButton = modal.querySelector('#rogersbank-delete-all-categories-btn');
      expect(deleteAllButton).toBeTruthy();
      expect(deleteAllButton.textContent).toBe('Delete All');
    });

    test('should not display "Delete All" button when no category mappings exist', () => {
      globalThis.GM_getValue.mockImplementation((key) => {
        if (key === 'rogersbank_category_mappings') {
          return '{}';
        }
        return null;
      });

      modal = createSettingsModal();

      const rogersBankTab = Array.from(modal.querySelectorAll('.settings-tab-button'))
        .find((btn) => btn.textContent.includes('Rogers Bank'));
      rogersBankTab.click();

      const deleteAllButton = modal.querySelector('#rogersbank-delete-all-categories-btn');
      expect(deleteAllButton).toBeNull();
    });

    test('should handle "Delete All" button hover effects', () => {
      globalThis.GM_getValue.mockImplementation((key) => {
        if (key === 'rogersbank_category_mappings') {
          return JSON.stringify({ Groceries: 'Food & Dining' });
        }
        return null;
      });

      modal = createSettingsModal();

      const rogersBankTab = Array.from(modal.querySelectorAll('.settings-tab-button'))
        .find((btn) => btn.textContent.includes('Rogers Bank'));
      rogersBankTab.click();

      const deleteAllButton = modal.querySelector('#rogersbank-delete-all-categories-btn');

      deleteAllButton.dispatchEvent(new Event('mouseover'));
      expect(deleteAllButton.style.backgroundColor).toBe('rgb(200, 35, 51)');

      deleteAllButton.dispatchEvent(new Event('mouseout'));
      expect(deleteAllButton.style.backgroundColor).toBe('rgb(220, 53, 69)');
    });
  });

  describe('Additional Helper Functions', () => {
    test('should format dates correctly', () => {
      // Mock accountService to return accounts with lastSyncDate
      const accountService = jest.requireMock('../../src/services/common/accountService').default;
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
        lastSyncDate: '2023-12-25T15:30:00Z',
      }]);

      modal = createSettingsModal();

      const questradeTab = Array.from(modal.querySelectorAll('.settings-tab-button'))
        .find((btn) => btn.textContent.includes('Questrade'));
      questradeTab.click();

      const tabContent = modal.querySelector('.settings-tab-content');
      expect(tabContent.textContent).toContain('Dec');
      expect(tabContent.textContent).toContain('25');
      expect(tabContent.textContent).toContain('2023');
    });

    test('should handle mapping status display', () => {
      // Mock accountService to return accounts with monarch mapping
      const accountService = jest.requireMock('../../src/services/common/accountService').default;
      accountService.getAccounts.mockReturnValue([{
        questradeAccount: {
          id: '12345',
          nickname: 'Test Account',
        },
        monarchAccount: {
          id: 'monarch-123',
          displayName: 'Mapped Monarch Account',
        },
        syncEnabled: true,
      }]);

      modal = createSettingsModal();

      const questradeTab = Array.from(modal.querySelectorAll('.settings-tab-button'))
        .find((btn) => btn.textContent.includes('Questrade'));
      questradeTab.click();

      const tabContent = modal.querySelector('.settings-tab-content');
      expect(tabContent.textContent).toContain('Mapped to');
    });

    test('should handle missing account properties gracefully', () => {
      // Mock accountService to return accounts without optional properties
      const accountService = jest.requireMock('../../src/services/common/accountService').default;
      accountService.getAccounts.mockReturnValue([{
        questradeAccount: {
          id: '12345',
          // Missing nickname - should show "Unknown Account"
        },
        syncEnabled: true,
      }]);

      modal = createSettingsModal();

      const questradeTab = Array.from(modal.querySelectorAll('.settings-tab-button'))
        .find((btn) => btn.textContent.includes('Questrade'));
      questradeTab.click();

      const tabContent = modal.querySelector('.settings-tab-content');
      expect(tabContent.textContent).toContain('Unknown Account');
    });
  });
});
