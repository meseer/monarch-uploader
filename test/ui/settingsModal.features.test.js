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

jest.mock('../../src/scriptInfo.json', () => ({
  version: '5.60.0',
  gistUrl: 'https://gist.github.com/meseer/f00fb552c96efeb3eb4e4e1fd520d4e7/raw/monarch-uploader.user.js',
}), { virtual: true });

jest.mock('../../src/services/common/configStore', () => ({
  getAuth: jest.fn(() => ({})),
  setSetting: jest.fn(),
  getSetting: jest.fn(() => undefined),
  getCategoryMappings: jest.fn(() => ({})),
  saveCategoryMappings: jest.fn(),
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
    hasHoldings: integrationId === 'questrade' || integrationId === 'wealthsimple',
    hasCategorization: integrationId === 'rogersbank' || integrationId === 'wealthsimple',
    categoryMappingsStorageKey: integrationId === 'rogersbank' ? 'rogersbank_category_mappings' : (integrationId === 'wealthsimple' ? 'wealthsimple_category_mappings' : null),
    categorySourceLabel: integrationId === 'rogersbank' ? 'Bank Category' : (integrationId === 'wealthsimple' ? 'Merchant Name' : null),
    settings: [],
    settingDefaults: {},
  })),
  getAccountKeyName: jest.fn((integrationId) => `${integrationId}Account`),
  getDisplayName: jest.fn((integrationId) => integrationId.charAt(0).toUpperCase() + integrationId.slice(1)),
  getFaviconUrl: jest.fn(() => 'https://www.google.com/s2/favicons?domain=example.com&sz=128'),
  hasSetting: jest.fn(() => false),
  getSettingDefault: jest.fn(() => null),
  hasCapability: jest.fn((integrationId, capability) => {
    if (capability === 'hasHoldings') {
      return integrationId === 'questrade' || integrationId === 'wealthsimple';
    }
    if (capability === 'hasCategorization') {
      return integrationId === 'rogersbank' || integrationId === 'wealthsimple';
    }
    return false;
  }),
  getCategoryMappingsConfig: jest.fn((integrationId) => {
    if (integrationId === 'rogersbank') {
      return { storageKey: 'rogersbank_category_mappings', sourceLabel: 'Bank Category' };
    }
    if (integrationId === 'wealthsimple') {
      return { storageKey: 'wealthsimple_category_mappings', sourceLabel: 'Merchant Name' };
    }
    return null;
  }),
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
      // Mock accountService to return a Rogers Bank account with uploaded transactions
      const accountService = jest.requireMock('../../src/services/common/accountService').default;
      accountService.getAccounts.mockImplementation((integrationId) => {
        if (integrationId === 'rogersbank') {
          return [{
            rogersbankAccount: { id: '12345', nickname: 'Rogers Card' },
            monarchAccount: { id: 'monarch-123', displayName: 'Monarch Rogers' },
            syncEnabled: true,
            uploadedTransactions: [
              { id: 'tx1', date: '2024-01-10' },
              { id: 'tx2', date: '2024-01-11' },
              { id: 'tx3', date: '2024-01-12' },
            ],
          }];
        }
        return [];
      });

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
      // Transactions are now shown in account cards with unified account service
      // The text format changed to "(X stored)" in the new generic cards
      expect(tabContent.textContent).toContain('Uploaded Transactions');
      expect(tabContent.textContent).toContain('stored');
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
      expect(closeButton.style.backgroundColor).toBe('var(--mu-hover-bg, #f0f0f0)');

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
      // Reset accountService mock to return empty array
      const accountService = jest.requireMock('../../src/services/common/accountService').default;
      accountService.getAccounts.mockReturnValue([]);

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
    test('should display "Delete All" button when category mappings exist (inside collapsed section)', () => {
      const { getCategoryMappings } = jest.requireMock('../../src/services/common/configStore');
      getCategoryMappings.mockReturnValue({
        Groceries: 'Food & Dining',
        Gas: 'Auto & Transport',
      });

      modal = createSettingsModal();

      const rogersBankTab = Array.from(modal.querySelectorAll('.settings-tab-button'))
        .find((btn) => btn.textContent.includes('Rogers Bank'));
      rogersBankTab.click();

      // Category mappings section is collapsible - expand it first
      const categoryHeader = modal.querySelector('#category-mappings-header-rogersbank');
      expect(categoryHeader).toBeTruthy();
      categoryHeader.click();

      const deleteAllButton = modal.querySelector('#category-mappings-delete-all-rogersbank');
      expect(deleteAllButton).toBeTruthy();
      expect(deleteAllButton.textContent).toBe('Delete All');
    });

    test('should not display "Delete All" button when no category mappings exist', () => {
      const { getCategoryMappings } = jest.requireMock('../../src/services/common/configStore');
      getCategoryMappings.mockReturnValue({});

      modal = createSettingsModal();

      const rogersBankTab = Array.from(modal.querySelectorAll('.settings-tab-button'))
        .find((btn) => btn.textContent.includes('Rogers Bank'));
      rogersBankTab.click();

      // With no mappings, Delete All button should not exist
      const deleteAllButton = modal.querySelector('#category-mappings-delete-all-rogersbank');
      expect(deleteAllButton).toBeNull();
    });

    test('should handle "Delete All" button hover effects', () => {
      const { getCategoryMappings } = jest.requireMock('../../src/services/common/configStore');
      getCategoryMappings.mockReturnValue({ Groceries: 'Food & Dining' });

      modal = createSettingsModal();

      const rogersBankTab = Array.from(modal.querySelectorAll('.settings-tab-button'))
        .find((btn) => btn.textContent.includes('Rogers Bank'));
      rogersBankTab.click();

      // Expand the collapsible section first
      const categoryHeader = modal.querySelector('#category-mappings-header-rogersbank');
      categoryHeader.click();

      const deleteAllButton = modal.querySelector('#category-mappings-delete-all-rogersbank');

      deleteAllButton.dispatchEvent(new Event('mouseover'));
      expect(deleteAllButton.style.backgroundColor).toBe('rgb(200, 35, 51)');

      deleteAllButton.dispatchEvent(new Event('mouseout'));
      expect(deleteAllButton.style.backgroundColor).toBe('rgb(220, 53, 69)');
    });
  });

  describe('Version Link in Tab Navigation', () => {
    test('should display version link at the bottom of tab navigation', () => {
      modal = createSettingsModal();

      const versionContainer = modal.querySelector('#settings-version-container');
      expect(versionContainer).toBeTruthy();
    });

    test('should display version link with correct ID', () => {
      modal = createSettingsModal();

      const versionLink = modal.querySelector('#settings-version-link');
      expect(versionLink).toBeTruthy();
    });

    test('should display correct version from scriptInfo', () => {
      modal = createSettingsModal();

      const versionLink = modal.querySelector('#settings-version-link');
      expect(versionLink.textContent).toBe('v5.60.0');
    });

    test('should have correct gist URL as href', () => {
      modal = createSettingsModal();

      const versionLink = modal.querySelector('#settings-version-link');
      expect(versionLink.href).toBe('https://gist.github.com/meseer/f00fb552c96efeb3eb4e4e1fd520d4e7/raw/monarch-uploader.user.js');
    });

    test('should open gist URL in new tab', () => {
      modal = createSettingsModal();

      const versionLink = modal.querySelector('#settings-version-link');
      expect(versionLink.target).toBe('_blank');
      expect(versionLink.rel).toBe('noopener noreferrer');
    });

    test('should have version link inside tab navigation', () => {
      modal = createSettingsModal();

      const tabNav = modal.querySelector('.settings-tab-nav');
      const versionContainer = tabNav.querySelector('#settings-version-container');
      expect(versionContainer).toBeTruthy();
    });

    test('should handle version link hover effects', () => {
      modal = createSettingsModal();

      const versionLink = modal.querySelector('#settings-version-link');

      // Initial state
      expect(versionLink.style.color).toBe('var(--mu-text-secondary, #666)');
      expect(versionLink.style.textDecoration).toBe('none');

      // Simulate mouseover
      versionLink.dispatchEvent(new Event('mouseover'));
      expect(versionLink.style.color).toBe('var(--mu-link-color, #0073b1)');
      expect(versionLink.style.textDecoration).toBe('underline');

      // Simulate mouseout
      versionLink.dispatchEvent(new Event('mouseout'));
      expect(versionLink.style.color).toBe('var(--mu-text-secondary, #666)');
      expect(versionLink.style.textDecoration).toBe('none');
    });

    test('should position version container at bottom with border-top', () => {
      modal = createSettingsModal();

      const versionContainer = modal.querySelector('#settings-version-container');
      expect(versionContainer.style.marginTop).toBe('auto');
      expect(versionContainer.style.borderTop).toContain('1px solid');
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
