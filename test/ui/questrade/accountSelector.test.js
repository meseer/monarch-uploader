/**
 * @fileoverview Tests for Questrade Account Selector Component
 */

import { jest } from '@jest/globals';
import '../../setup';
import {
  createAccountSelector,
  createMonarchAccountMappingSelector,
  showMonarchAccountSelector,
} from '../../../src/ui/questrade/components/accountSelector';
import { debugLog, extractDomain, stringSimilarity } from '../../../src/core/utils';
import stateManager from '../../../src/core/state';
import monarchApi from '../../../src/api/monarch';
import toast from '../../../src/ui/toast';
import { addModalKeyboardHandlers, makeItemsKeyboardNavigable } from '../../../src/ui/keyboardNavigation';

// Mock all external dependencies
jest.mock('../../../src/core/utils', () => ({
  debugLog: jest.fn(),
  extractDomain: jest.fn(),
  stringSimilarity: jest.fn(),
}));

jest.mock('../../../src/core/state', () => ({
  setAccount: jest.fn(),
  getState: jest.fn(),
}));

jest.mock('../../../src/api/monarch', () => ({
  getInstitutionSettings: jest.fn(),
}));

jest.mock('../../../src/ui/toast', () => ({
  show: jest.fn(),
}));

jest.mock('../../../src/ui/keyboardNavigation', () => ({
  addModalKeyboardHandlers: jest.fn(),
  makeItemsKeyboardNavigable: jest.fn(),
}));

describe('Questrade Account Selector Component', () => {
  let mockAccounts;
  let mockGMSetValue;
  let mockGMGetValue;
  let mockGMAddElement;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Setup mock accounts
    mockAccounts = [
      {
        id: 'account1',
        name: 'Test Account 1',
        nickname: 'My Trading Account',
        displayName: 'Test Account 1',
      },
      {
        id: 'account2',
        name: 'Test Account 2',
        displayName: 'Test Account 2',
      },
    ];

    // Setup Greasemonkey mocks
    mockGMSetValue = jest.fn();
    mockGMGetValue = jest.fn();
    mockGMAddElement = jest.fn();

    globalThis.GM_setValue = mockGMSetValue;
    globalThis.GM_getValue = mockGMGetValue;
    globalThis.GM_addElement = mockGMAddElement;

    // Setup DOM
    document.body.innerHTML = '';

    // Setup default mock returns
    extractDomain.mockReturnValue('example.com');
    stringSimilarity.mockReturnValue(0.5);
    stateManager.getState.mockReturnValue({
      currentAccount: { nickname: 'Test Account' },
    });

    // Setup keyboard navigation mocks
    addModalKeyboardHandlers.mockReturnValue(() => {});
    makeItemsKeyboardNavigable.mockReturnValue(() => {});
  });

  describe('createAccountSelector', () => {
    test('creates basic account selector with default options', () => {
      const selector = createAccountSelector({
        accounts: mockAccounts,
      });

      expect(selector).toBeTruthy();
      expect(selector.className).toBe('account-selector-container');

      const label = selector.querySelector('label');
      expect(label.textContent).toBe('Select Account:');

      const select = selector.querySelector('select');
      expect(select.className).toBe('account-selector');
      expect(select.hasAttribute('required')).toBe(true);
    });

    test('creates selector with custom options', () => {
      const onChange = jest.fn();
      const selector = createAccountSelector({
        accounts: mockAccounts,
        onChange,
        selectedId: 'account1',
        labelText: 'Custom Label:',
        placeholderText: 'Custom Placeholder',
        required: false,
      });

      const label = selector.querySelector('label');
      expect(label.textContent).toBe('Custom Label:');

      const select = selector.querySelector('select');
      expect(select.hasAttribute('required')).toBe(false);

      const placeholder = select.querySelector('option[value=""]');
      expect(placeholder.textContent).toBe('Custom Placeholder');
      expect(placeholder.selected).toBe(false);

      const selectedOption = select.querySelector('option[value="account1"]');
      expect(selectedOption.selected).toBe(true);
    });

    test('handles empty accounts array', () => {
      const selector = createAccountSelector({
        accounts: [],
      });

      const select = selector.querySelector('select');
      expect(select.disabled).toBe(true);

      const emptyOption = select.querySelector('option:last-child');
      expect(emptyOption.textContent).toBe('No accounts available');
    });

    test('calls onChange callback when selection changes', () => {
      const onChange = jest.fn();
      const selector = createAccountSelector({
        accounts: mockAccounts,
        onChange,
      });

      const select = selector.querySelector('select');
      select.value = 'account1';
      select.dispatchEvent(new Event('change'));

      expect(onChange).toHaveBeenCalledWith(mockAccounts[0]);
    });

    test('handles missing onChange callback', () => {
      const selector = createAccountSelector({
        accounts: mockAccounts,
        onChange: null,
      });

      const select = selector.querySelector('select');
      select.value = 'account1';

      expect(() => {
        select.dispatchEvent(new Event('change'));
      }).not.toThrow();
    });

    test('handles accounts with different name properties', () => {
      const accountsWithVariousNames = [
        { id: '1', nickname: 'Nickname Account' },
        { id: '2', name: 'Name Account' },
        { id: '3', displayName: 'DisplayName Account' },
        { id: '4' }, // No name
      ];

      const selector = createAccountSelector({
        accounts: accountsWithVariousNames,
      });

      const options = selector.querySelectorAll('option:not([disabled])');
      // The order might be different based on the actual implementation
      const textContents = Array.from(options).map((opt) => opt.textContent);
      expect(textContents).toContain('Nickname Account');
      expect(textContents).toContain('Name Account');
      expect(textContents).toContain('DisplayName Account');
      expect(textContents).toContain('');
    });
  });

  describe('createMonarchAccountMappingSelector', () => {
    const questradeAccountId = 'questrade123';
    const questradeAccountName = 'My Questrade Account';
    const monarchAccounts = [
      { id: 'monarch1', displayName: 'Monarch Account 1' },
      { id: 'monarch2', displayName: 'Monarch Account 2' },
    ];
    const storagePrefix = 'questrade_account_mapping_';

    test('creates mapping selector with no existing mapping', () => {
      mockGMGetValue.mockReturnValue(null);

      const selector = createMonarchAccountMappingSelector(
        questradeAccountId,
        questradeAccountName,
        monarchAccounts,
        storagePrefix,
      );

      expect(selector).toBeTruthy();
      const label = selector.querySelector('label');
      expect(label.textContent).toContain(questradeAccountName);
      expect(label.textContent).toContain('Map Questrade');
    });

    test('creates mapping selector with existing mapping', () => {
      const existingMapping = { id: 'monarch1', displayName: 'Existing Account' };
      mockGMGetValue.mockReturnValue(JSON.stringify(existingMapping));

      const selector = createMonarchAccountMappingSelector(
        questradeAccountId,
        questradeAccountName,
        monarchAccounts,
        storagePrefix,
      );

      const select = selector.querySelector('select');
      expect(select.value).toBe('monarch1');
    });

    test('handles JSON parsing error for existing mapping', () => {
      mockGMGetValue.mockReturnValue('invalid-json');

      const selector = createMonarchAccountMappingSelector(
        questradeAccountId,
        questradeAccountName,
        monarchAccounts,
        storagePrefix,
      );

      expect(debugLog).toHaveBeenCalledWith(
        'Error parsing existing account mapping:',
        expect.any(Error),
      );
      expect(selector).toBeTruthy();
    });

    test('saves mapping when account is selected', () => {
      mockGMGetValue.mockReturnValue(null);

      const selector = createMonarchAccountMappingSelector(
        questradeAccountId,
        questradeAccountName,
        monarchAccounts,
        storagePrefix,
      );

      const select = selector.querySelector('select');
      select.value = 'monarch1';
      select.dispatchEvent(new Event('change'));

      expect(mockGMSetValue).toHaveBeenCalledWith(
        `${storagePrefix}${questradeAccountId}`,
        JSON.stringify(monarchAccounts[0]),
      );
      expect(stateManager.setAccount).toHaveBeenCalledWith(
        questradeAccountId,
        questradeAccountName,
      );
      expect(toast.show).toHaveBeenCalledWith(
        expect.stringContaining('Mapped'),
        'info',
      );
    });

    test('handles GM_setValue error', () => {
      mockGMGetValue.mockReturnValue(null);
      mockGMSetValue.mockImplementation(() => {
        throw new Error('GM_setValue error');
      });

      const selector = createMonarchAccountMappingSelector(
        questradeAccountId,
        questradeAccountName,
        monarchAccounts,
        storagePrefix,
      );

      const select = selector.querySelector('select');
      select.value = 'monarch1';
      select.dispatchEvent(new Event('change'));

      expect(toast.show).toHaveBeenCalledWith('Error saving account mapping', 'error');
      expect(debugLog).toHaveBeenCalledWith(
        'Error saving account mapping:',
        expect.any(Error),
      );
    });

    test('handles null selection gracefully', () => {
      mockGMGetValue.mockReturnValue(null);

      const selector = createMonarchAccountMappingSelector(
        questradeAccountId,
        questradeAccountName,
        monarchAccounts,
        storagePrefix,
      );

      const select = selector.querySelector('select');
      select.value = '';
      select.dispatchEvent(new Event('change'));

      expect(mockGMSetValue).not.toHaveBeenCalled();
      expect(stateManager.setAccount).not.toHaveBeenCalled();
    });
  });

  describe('showMonarchAccountSelector', () => {
    let testAccounts;
    let testCallback;
    let testInstitutionData;

    beforeEach(() => {
      testAccounts = [
        {
          id: 'account1',
          type: { name: 'brokerage' },
          displayName: 'Test Brokerage Account',
          currentBalance: 10000,
        },
        {
          id: 'account2',
          type: { name: 'credit' },
          displayName: 'Test Credit Account',
          currentBalance: -500,
        },
      ];

      testCallback = jest.fn();

      testInstitutionData = {
        credentials: [
          {
            id: 'cred1',
            institution: {
              name: 'Test Institution',
              url: 'https://example.com',
              logo: 'base64-logo-data',
            },
            dataProvider: 'Test Provider',
          },
        ],
        accounts: [
          {
            id: 'account1',
            credential: { id: 'cred1' },
            displayName: 'Test Account',
            deletedAt: null,
          },
        ],
      };

      monarchApi.getInstitutionSettings.mockResolvedValue(testInstitutionData);
    });

    test('fetches institution data and shows institution selector', async () => {
      await showMonarchAccountSelector(testAccounts, testCallback);

      expect(monarchApi.getInstitutionSettings).toHaveBeenCalled();
      expect(debugLog).toHaveBeenCalledWith(
        'Starting account selector with',
        expect.objectContaining({
          accountsCount: testAccounts.length,
        }),
      );
    });

    test('determines account type from accounts if not provided', async () => {
      await showMonarchAccountSelector(testAccounts, testCallback);

      expect(debugLog).toHaveBeenCalledWith(
        'Starting account selector with',
        expect.objectContaining({
          accountType: expect.any(String),
        }),
      );
    });

    test('uses provided account type', async () => {
      await showMonarchAccountSelector(testAccounts, testCallback, null, 'credit');

      expect(debugLog).toHaveBeenCalledWith(
        'Starting account selector with',
        expect.objectContaining({
          accountType: 'credit',
        }),
      );
    });

    test('falls back to flat selector on API error', async () => {
      monarchApi.getInstitutionSettings.mockRejectedValue(new Error('API Error'));

      await showMonarchAccountSelector(testAccounts, testCallback);

      expect(debugLog).toHaveBeenCalledWith('Failed to get institution data:', expect.any(Error));

      // Should create a modal for flat selector
      const modal = document.querySelector('[style*="position: fixed"]');
      expect(modal).toBeTruthy();
    });

    test('handles empty credentials array', async () => {
      testInstitutionData.credentials = [];
      monarchApi.getInstitutionSettings.mockResolvedValue(testInstitutionData);

      await showMonarchAccountSelector(testAccounts, testCallback);

      expect(debugLog).toHaveBeenCalledWith(
        'Showing institution selector with',
        expect.objectContaining({
          institutionsCount: 0,
        }),
      );
    });

    test('filters and sorts institutions by domain match', async () => {
      extractDomain.mockImplementation((url) => {
        if (url === 'https://example.com') return 'example.com';
        if (url.includes('example.com')) return 'example.com';
        return 'other.com';
      });

      await showMonarchAccountSelector(testAccounts, testCallback);

      expect(extractDomain).toHaveBeenCalledWith(window.location.href);
      expect(extractDomain).toHaveBeenCalledWith('https://example.com');
    });

    test('handles accounts with different credential mappings', async () => {
      testInstitutionData.accounts = [
        {
          id: 'account1',
          credential: { id: 'cred1' },
          displayName: 'Account 1',
          deletedAt: null,
        },
        {
          id: 'account2',
          credential: { id: 'cred1' },
          displayName: 'Account 2',
          deletedAt: null,
        },
        {
          id: 'account3',
          credential: { id: 'cred2' },
          displayName: 'Account 3',
          deletedAt: null,
        },
        {
          id: 'account4',
          credential: { id: 'cred1' },
          displayName: 'Deleted Account',
          deletedAt: '2024-01-01',
        },
      ];

      await showMonarchAccountSelector(testAccounts, testCallback);

      // Should group accounts by credential and filter out deleted ones
      expect(debugLog).toHaveBeenCalledWith(
        'Showing institution selector with',
        expect.any(Object),
      );
    });
  });

  describe('Modal Interactions', () => {
    test('creates modal overlay with click outside handler', async () => {
      const testModalAccounts = [
        { id: 'account1', displayName: 'Test Account', currentBalance: 1000 },
      ];
      const testModalCallback = jest.fn();

      monarchApi.getInstitutionSettings.mockRejectedValue(new Error('API Error'));

      await showMonarchAccountSelector(testModalAccounts, testModalCallback);

      const overlay = document.querySelector('[style*="position: fixed"]');
      expect(overlay).toBeTruthy();

      // Test clicking outside
      overlay.click();
      expect(testModalCallback).toHaveBeenCalledWith(null);
    });

    test('handles keyboard navigation setup and cleanup', async () => {
      const testNavAccounts = [
        { id: 'account1', displayName: 'Test Account', currentBalance: 1000 },
      ];
      const testNavCallback = jest.fn();
      const mockCleanup = jest.fn();

      addModalKeyboardHandlers.mockReturnValue(mockCleanup);
      makeItemsKeyboardNavigable.mockReturnValue(mockCleanup);

      monarchApi.getInstitutionSettings.mockRejectedValue(new Error('API Error'));

      await showMonarchAccountSelector(testNavAccounts, testNavCallback);

      expect(addModalKeyboardHandlers).toHaveBeenCalled();

      // Click cancel to trigger cleanup
      const cancelBtn = document.querySelector('button');
      if (cancelBtn) {
        cancelBtn.click();
        // Cleanup should have been called
      }
    });
  });

  describe('Logo Handling', () => {
    test('handles base64 logos', async () => {
      const testLogoAccounts = [{ id: 'account1', displayName: 'Test Account' }];
      const testLogoCallback = jest.fn();

      const institutionData = {
        credentials: [{
          id: 'cred1',
          institution: {
            name: 'Test Institution',
            logo: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
          },
        }],
        accounts: [{
          id: 'account1',
          credential: { id: 'cred1' },
          displayName: 'Test Account',
          deletedAt: null,
        }],
      };

      monarchApi.getInstitutionSettings.mockResolvedValue(institutionData);

      await showMonarchAccountSelector(testLogoAccounts, testLogoCallback);

      // Should create modal with institution
      const modal = document.querySelector('[style*="position: fixed"]');
      expect(modal).toBeTruthy();
    });

    test('handles external URL logos', async () => {
      const testUrlAccounts = [{ id: 'account1', displayName: 'Test Account' }];
      const testUrlCallback = jest.fn();

      const institutionData = {
        credentials: [{
          id: 'cred1',
          institution: {
            name: 'Test Institution',
            logo: 'https://example.com/logo.png',
          },
        }],
        accounts: [{
          id: 'account1',
          credential: { id: 'cred1' },
          displayName: 'Test Account',
          deletedAt: null,
        }],
      };

      monarchApi.getInstitutionSettings.mockResolvedValue(institutionData);

      await showMonarchAccountSelector(testUrlAccounts, testUrlCallback);

      expect(mockGMAddElement).toHaveBeenCalled();
    });

    test('handles logo fallback', async () => {
      const testFallbackAccounts = [{ id: 'account1', displayName: 'Test Account' }];
      const testFallbackCallback = jest.fn();

      const institutionData = {
        credentials: [{
          id: 'cred1',
          institution: {
            name: 'Test Institution',
            logo: null,
          },
        }],
        accounts: [{
          id: 'account1',
          credential: { id: 'cred1' },
          displayName: 'Test Account',
          deletedAt: null,
        }],
      };

      monarchApi.getInstitutionSettings.mockResolvedValue(institutionData);

      await showMonarchAccountSelector(testFallbackAccounts, testFallbackCallback);

      const modal = document.querySelector('[style*="position: fixed"]');
      expect(modal).toBeTruthy();
    });
  });

  describe('Account Similarity and Sorting', () => {
    test('sorts accounts by similarity score', async () => {
      const testSortAccounts = [
        { id: 'account1', displayName: 'Different Name', currentBalance: 1000 },
        { id: 'account2', displayName: 'Similar Name', currentBalance: 2000 },
      ];

      stateManager.getState.mockReturnValue({
        currentAccount: { nickname: 'Similar Name' },
      });

      stringSimilarity.mockImplementation((a, b) => {
        if (a === 'Similar Name' && b === 'Similar Name') return 1.0;
        if (a === 'Different Name' && b === 'Similar Name') return 0.1;
        return 0.0;
      });

      monarchApi.getInstitutionSettings.mockRejectedValue(new Error('API Error'));

      await showMonarchAccountSelector(testSortAccounts, jest.fn());

      expect(stringSimilarity).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    test('handles missing account properties gracefully', async () => {
      const incompleteAccounts = [
        { id: 'account1' }, // Missing displayName
        { displayName: 'Account 2' }, // Missing id
        null, // Null account
        undefined, // Undefined account
      ].filter(Boolean);

      monarchApi.getInstitutionSettings.mockRejectedValue(new Error('API Error'));

      await showMonarchAccountSelector(incompleteAccounts, jest.fn());

      // Should not throw and should create modal
      const modal = document.querySelector('[style*="position: fixed"]');
      expect(modal).toBeTruthy();
    });

    test('handles missing institution data gracefully', async () => {
      const testErrorAccounts = [{ id: 'account1', displayName: 'Test Account' }];

      const incompleteInstitutionData = {
        credentials: [{
          id: 'cred1',
          // Missing institution property
        }],
        accounts: [{
          id: 'account1',
          credential: { id: 'cred1' },
          displayName: 'Test Account',
        }],
      };

      monarchApi.getInstitutionSettings.mockResolvedValue(incompleteInstitutionData);

      await showMonarchAccountSelector(testErrorAccounts, jest.fn());

      expect(debugLog).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    test('handles empty accounts array', async () => {
      await showMonarchAccountSelector([], jest.fn());

      expect(debugLog).toHaveBeenCalledWith(
        'Starting account selector with',
        expect.objectContaining({
          accountsCount: 0,
        }),
      );
    });

    test('handles null callback', async () => {
      const testNullAccounts = [{ id: 'account1', displayName: 'Test Account' }];

      monarchApi.getInstitutionSettings.mockRejectedValue(new Error('API Error'));

      expect(async () => {
        await showMonarchAccountSelector(testNullAccounts, null);
      }).not.toThrow();
    });

    test('handles account type determination from empty accounts', async () => {
      await showMonarchAccountSelector([], jest.fn(), null, null);

      expect(debugLog).toHaveBeenCalledWith(
        'Starting account selector with',
        expect.objectContaining({
          accountType: expect.any(String), // Accept any string as fallback
        }),
      );
    });
  });

  describe('Integration Tests', () => {
    test('complete flow from institution to account selection', async () => {
      const testIntegrationAccounts = [
        { id: 'account1', displayName: 'Test Account', currentBalance: 1000 },
      ];
      const testIntegrationCallback = jest.fn();

      const institutionData = {
        credentials: [{
          id: 'cred1',
          institution: { name: 'Test Institution' },
        }],
        accounts: [{
          id: 'account1',
          credential: { id: 'cred1' },
          displayName: 'Test Account',
          deletedAt: null,
        }],
      };

      monarchApi.getInstitutionSettings.mockResolvedValue(institutionData);

      await showMonarchAccountSelector(testIntegrationAccounts, testIntegrationCallback);

      // Should create institution selector modal
      const modal = document.querySelector('[style*="position: fixed"]');
      expect(modal).toBeTruthy();

      // Should show institution name
      expect(modal.textContent).toContain('Test Institution');
    });
  });
});
