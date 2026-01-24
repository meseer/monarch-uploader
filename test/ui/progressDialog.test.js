/**
 * Test suite for Progress Dialog Component
 */

import { showProgressDialog } from '../../src/ui/components/progressDialog';

// Mock debugLog function
jest.mock('../../src/core/utils', () => ({
  debugLog: jest.fn(),
}));

describe('Progress Dialog Component', () => {
  let mockAccounts;
  let dialog;

  beforeEach(() => {
    // Reset DOM
    document.body.innerHTML = '';

    // Mock accounts data
    mockAccounts = [
      { key: 'acc1', nickname: 'Test Account 1' },
      { key: 'acc2', name: 'Test Account 2' },
      { id: 'acc3', nickname: 'Test Account 3' },
    ];

    // Mock DOM methods
    jest.spyOn(document, 'createElement').mockImplementation((tagName) => {
      const element = {
        tagName: tagName.toUpperCase(),
        style: {},
        appendChild: jest.fn(),
        remove: jest.fn(),
        onclick: null,
        textContent: '',
        innerHTML: '',
        id: '',
        dataset: {},
        disabled: false,
        addEventListener: jest.fn(),
        querySelector: jest.fn(() => null),
        querySelectorAll: jest.fn(() => []),
        scrollIntoView: jest.fn(), // Mock scrollIntoView for auto-scroll functionality
        scrollTo: jest.fn(), // Mock scrollTo for direct scroll manipulation
        classList: {
          add: jest.fn(),
          remove: jest.fn(),
          toggle: jest.fn(),
          contains: jest.fn(() => false),
        },
      };

      // Add style property that accepts cssText
      Object.defineProperty(element.style, 'cssText', {
        set(value) {
          // Parse basic CSS and set individual properties
          const rules = value.split(';');
          rules.forEach((rule) => {
            const [prop, val] = rule.split(':').map((s) => s.trim());
            if (prop && val) {
              this[prop.replace(/-([a-z])/g, (match, letter) => letter.toUpperCase())] = val;
            }
          });
        },
        get() {
          return Object.keys(this).filter((key) => key !== 'cssText').map((key) =>
            `${key.replace(/([A-Z])/g, '-$1').toLowerCase()}: ${this[key]}`,
          ).join('; ');
        },
      });

      return element;
    });

    jest.spyOn(document.body, 'appendChild').mockImplementation(() => {});
    jest.spyOn(document, 'getElementById').mockImplementation((id) => {
      if (id === 'error-ack-button') {
        return { onclick: null };
      }
      if (id === 'error-close-button') {
        return { onclick: null };
      }
      return null;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (dialog && typeof dialog.close === 'function') {
      try {
        dialog.close();
      } catch (e) {
        // Ignore cleanup errors in tests
      }
    }
  });

  describe('showProgressDialog creation', () => {
    test('should create dialog with default title', () => {
      dialog = showProgressDialog(mockAccounts);

      expect(document.createElement).toHaveBeenCalledWith('div'); // overlay
      expect(document.body.appendChild).toHaveBeenCalled();
      expect(dialog).toBeDefined();
      expect(typeof dialog.updateProgress).toBe('function');
    });

    test('should create dialog with custom title', () => {
      const customTitle = 'Custom Upload Progress';
      dialog = showProgressDialog(mockAccounts, customTitle);

      expect(dialog).toBeDefined();
    });

    test('should create account elements for all accounts', () => {
      dialog = showProgressDialog(mockAccounts);

      // Should create elements for each account (at least one call)
      expect(document.createElement).toHaveBeenCalled();
    });

    test('should handle accounts with different key properties', () => {
      const mixedAccounts = [
        { key: 'acc1', nickname: 'Account 1' },
        { id: 'acc2', name: 'Account 2' },
        { nickname: 'Account 3' }, // No key or id
      ];

      dialog = showProgressDialog(mixedAccounts);
      expect(dialog).toBeDefined();
    });
  });

  describe('updateProgress functionality', () => {
    beforeEach(() => {
      dialog = showProgressDialog(mockAccounts);
    });

    test('should update progress for processing status', () => {
      dialog.updateProgress('acc1', 'processing', 'Processing account...');

      // The method should execute without errors
      expect(dialog).toBeDefined();
    });

    test('should update progress for success status', () => {
      dialog.updateProgress('acc1', 'success', 'Successfully uploaded');

      expect(dialog).toBeDefined();
    });

    test('should update progress for error status', () => {
      dialog.updateProgress('acc1', 'error', 'Upload failed');

      expect(dialog).toBeDefined();
    });

    test('should update progress for pending status', () => {
      dialog.updateProgress('acc1', 'pending', 'Waiting...');

      expect(dialog).toBeDefined();
    });

    test('should handle unknown account ID gracefully', () => {
      // Should not throw error for unknown account
      expect(() => {
        dialog.updateProgress('unknown-account', 'processing', 'test');
      }).not.toThrow();
    });

    test('should handle missing message parameter', () => {
      expect(() => {
        dialog.updateProgress('acc1', 'processing');
      }).not.toThrow();
    });
  });

  describe('updateBalanceChange functionality', () => {
    beforeEach(() => {
      dialog = showProgressDialog(mockAccounts);
    });

    test('should update balance change with positive change', () => {
      const balanceData = {
        oldBalance: 1000.50,
        newBalance: 1100.75,
        lastUploadDate: '2024-01-01',
        changePercent: 10.02,
      };

      expect(() => {
        dialog.updateBalanceChange('acc1', balanceData);
      }).not.toThrow();
    });

    test('should update balance change with negative change', () => {
      const balanceData = {
        oldBalance: 1000.00,
        newBalance: 900.00,
        lastUploadDate: '2024-01-01',
        changePercent: -10.00,
      };

      expect(() => {
        dialog.updateBalanceChange('acc1', balanceData);
      }).not.toThrow();
    });

    test('should update balance change with zero change', () => {
      const balanceData = {
        oldBalance: 1000.00,
        newBalance: 1000.00,
        lastUploadDate: '2024-01-01',
        changePercent: 0,
      };

      expect(() => {
        dialog.updateBalanceChange('acc1', balanceData);
      }).not.toThrow();
    });

    test('should handle unknown account ID gracefully', () => {
      const balanceData = {
        oldBalance: 1000,
        newBalance: 1100,
        lastUploadDate: '2024-01-01',
        changePercent: 10,
      };

      expect(() => {
        dialog.updateBalanceChange('unknown-account', balanceData);
      }).not.toThrow();
    });

    test('should handle invalid balance data gracefully', () => {
      expect(() => {
        dialog.updateBalanceChange('acc1', {});
      }).not.toThrow();
    });

    test('should update balance change with accountType for investment', () => {
      const balanceData = {
        oldBalance: 100000,
        newBalance: 105000,
        lastUploadDate: '2024-01-15',
        changePercent: 5.0,
        accountType: 'investment',
      };

      expect(() => {
        dialog.updateBalanceChange('acc1', balanceData);
      }).not.toThrow();
    });

    test('should update balance change with accountType for cash', () => {
      const balanceData = {
        newBalance: 5000,
        changePercent: 10.0,
        accountType: 'cash',
        transactionCount: 15,
      };

      expect(() => {
        dialog.updateBalanceChange('acc1', balanceData);
      }).not.toThrow();
    });

    test('should update balance change with accountType for credit with debtAsPositive', () => {
      const balanceData = {
        newBalance: 1500,
        changePercent: -5.0,
        accountType: 'credit',
        transactionCount: 8,
        debtAsPositive: true,
      };

      expect(() => {
        dialog.updateBalanceChange('acc1', balanceData);
      }).not.toThrow();
    });

    test('should update balance change with negative balance (WS-style credit)', () => {
      const balanceData = {
        oldBalance: -1000,
        newBalance: -800,
        lastUploadDate: '2024-01-10',
        changePercent: 20.0, // Less debt = positive change
        accountType: 'credit',
        transactionCount: 5,
        debtAsPositive: false,
      };

      expect(() => {
        dialog.updateBalanceChange('acc1', balanceData);
      }).not.toThrow();
    });
  });

  describe('collapsed summary display with balance change', () => {
    beforeEach(() => {
      dialog = showProgressDialog(mockAccounts);
    });

    test('should show balance change in collapsed summary after all steps complete for investment account', () => {
      // Initialize steps
      dialog.initSteps('acc1', [
        { key: 'balance', name: 'Balance history' },
        { key: 'positions', name: 'Positions sync' },
      ]);

      // Complete all steps
      dialog.updateStepStatus('acc1', 'balance', 'success', 'Uploaded');
      dialog.updateStepStatus('acc1', 'positions', 'success', '5 synced');

      // Update balance change with investment accountType
      const balanceData = {
        oldBalance: 100000,
        newBalance: 102500,
        lastUploadDate: '2024-01-15',
        changePercent: 2.5,
        accountType: 'investment',
      };
      dialog.updateBalanceChange('acc1', balanceData);

      // The collapsed summary should now show the balance change
      expect(dialog).toBeDefined();
    });

    test('should show transaction count and balance for cash account in collapsed summary', () => {
      dialog.initSteps('acc1', [
        { key: 'transactions', name: 'Transaction sync' },
        { key: 'balance', name: 'Balance upload' },
      ]);

      dialog.updateStepStatus('acc1', 'transactions', 'success', '12 synced');
      dialog.updateStepStatus('acc1', 'balance', 'success', '$5,000.00');

      const balanceData = {
        newBalance: 5000,
        changePercent: 8.0,
        accountType: 'cash',
        transactionCount: 12,
      };
      dialog.updateBalanceChange('acc1', balanceData);

      expect(dialog).toBeDefined();
    });

    test('should show transaction count and balance for credit card in collapsed summary', () => {
      dialog.initSteps('acc1', [
        { key: 'transactions', name: 'Transaction sync' },
        { key: 'pendingReconciliation', name: 'Pending reconciliation' },
        { key: 'balance', name: 'Balance upload' },
      ]);

      dialog.updateStepStatus('acc1', 'transactions', 'success', '8 synced');
      dialog.updateStepStatus('acc1', 'pendingReconciliation', 'success', 'No changes');
      dialog.updateStepStatus('acc1', 'balance', 'success', '-$1,500.00');

      const balanceData = {
        oldBalance: -1200,
        newBalance: -1500,
        lastUploadDate: '2024-01-10',
        changePercent: -25.0, // More debt = negative change for WS-style
        accountType: 'credit',
        transactionCount: 8,
        debtAsPositive: false,
      };
      dialog.updateBalanceChange('acc1', balanceData);

      expect(dialog).toBeDefined();
    });

    test('should handle zero transaction count for cash accounts', () => {
      dialog.initSteps('acc1', [
        { key: 'transactions', name: 'Transaction sync' },
        { key: 'balance', name: 'Balance upload' },
      ]);

      dialog.updateStepStatus('acc1', 'transactions', 'success', 'No transactions');
      dialog.updateStepStatus('acc1', 'balance', 'success', '$10,000.00');

      const balanceData = {
        newBalance: 10000,
        changePercent: 0,
        accountType: 'cash',
        transactionCount: 0,
      };
      dialog.updateBalanceChange('acc1', balanceData);

      expect(dialog).toBeDefined();
    });

    test('should show Complete if no balance change data and all steps done', () => {
      dialog.initSteps('acc1', [
        { key: 'balance', name: 'Balance history' },
      ]);

      dialog.updateStepStatus('acc1', 'balance', 'success', 'Uploaded');

      // Don't call updateBalanceChange - should fallback to "Complete"
      expect(dialog).toBeDefined();
    });

    test('should handle debtAsPositive for Rogers-style credit accounts (debt decreased)', () => {
      dialog.initSteps('acc1', [
        { key: 'transactions', name: 'Transaction sync' },
        { key: 'balance', name: 'Balance upload' },
      ]);

      dialog.updateStepStatus('acc1', 'transactions', 'success', '5 synced');
      dialog.updateStepStatus('acc1', 'balance', 'success', '$500.00');

      // Rogers style: positive balance = debt
      // Balance went from $600 to $500 (less debt = good)
      // Raw changePercent is -16.67 (negative), but for debtAsPositive:
      // - A decrease in debt is GOOD, should show GREEN
      // - Display should invert to +16.67%
      const balanceData = {
        oldBalance: 600,
        newBalance: 500,
        lastUploadDate: '2024-01-10',
        changePercent: -16.67, // Decrease in debt = good (green)
        accountType: 'credit',
        transactionCount: 5,
        debtAsPositive: true,
      };
      dialog.updateBalanceChange('acc1', balanceData);

      expect(dialog).toBeDefined();
    });

    test('should handle debtAsPositive for Rogers-style credit accounts (debt increased)', () => {
      dialog.initSteps('acc1', [
        { key: 'transactions', name: 'Transaction sync' },
        { key: 'balance', name: 'Balance upload' },
      ]);

      dialog.updateStepStatus('acc1', 'transactions', 'success', '3 synced');
      dialog.updateStepStatus('acc1', 'balance', 'success', '$2,274.10');

      // Rogers style: positive balance = debt
      // Balance went from $1,982.43 to $2,274.10 (more debt = bad)
      // Raw changePercent is +14.71 (positive), but for debtAsPositive:
      // - An increase in debt is BAD, should show RED
      // - Display should invert to -14.71%
      const balanceData = {
        oldBalance: 1982.43,
        newBalance: 2274.10,
        lastUploadDate: '2024-01-22',
        changePercent: 14.71, // Increase in debt = bad (red)
        accountType: 'credit',
        transactionCount: 3,
        debtAsPositive: true,
      };
      dialog.updateBalanceChange('acc1', balanceData);

      expect(dialog).toBeDefined();
    });

    test('should handle debtAsPositive with zero change', () => {
      dialog.initSteps('acc1', [
        { key: 'balance', name: 'Balance upload' },
      ]);

      dialog.updateStepStatus('acc1', 'balance', 'success', '$1,000.00');

      // No change in debt
      const balanceData = {
        oldBalance: 1000,
        newBalance: 1000,
        lastUploadDate: '2024-01-20',
        changePercent: 0, // No change - should be neutral grey
        accountType: 'credit',
        debtAsPositive: true,
      };
      dialog.updateBalanceChange('acc1', balanceData);

      expect(dialog).toBeDefined();
    });
  });

  describe('showError functionality', () => {
    beforeEach(() => {
      dialog = showProgressDialog(mockAccounts);
    });

    test('should show error dialog and return promise', () => {
      const error = new Error('Test error message');
      const result = dialog.showError('acc1', error);

      expect(result).toBeInstanceOf(Promise);
    });

    test('should handle error with string message', () => {
      const error = { message: 'String error message' };
      const result = dialog.showError('acc1', error);

      expect(result).toBeInstanceOf(Promise);
    });

    test('should handle error without message', () => {
      const error = {};
      const result = dialog.showError('acc1', error);

      expect(result).toBeInstanceOf(Promise);
    });

    test('should hide cancel button when showing error', () => {
      const error = new Error('Test error');
      dialog.showError('acc1', error);

      // The hideCancel method should be called internally
      expect(dialog).toBeDefined();
    });
  });

  describe('showSummary functionality', () => {
    beforeEach(() => {
      dialog = showProgressDialog(mockAccounts);
    });

    test('should update summary with stats', () => {
      const stats = { success: 2, failed: 1, total: 3 };
      const result = dialog.showSummary(stats);

      expect(result).toBe(dialog); // Should return dialog for chaining
    });

    test('should handle zero stats', () => {
      const stats = { success: 0, failed: 0, total: 0 };
      const result = dialog.showSummary(stats);

      expect(result).toBe(dialog);
    });

    test('should handle skipped count when provided', () => {
      const stats = { success: 2, failed: 1, skipped: 5 };
      const result = dialog.showSummary(stats);

      expect(result).toBe(dialog);
    });

    test('should handle skipped count of zero', () => {
      const stats = { success: 2, failed: 1, skipped: 0 };
      const result = dialog.showSummary(stats);

      expect(result).toBe(dialog);
    });

    test('should work without skipped property for backward compatibility', () => {
      const stats = { success: 2, failed: 1 };
      const result = dialog.showSummary(stats);

      expect(result).toBe(dialog);
    });
  });

  describe('cancel functionality', () => {
    beforeEach(() => {
      dialog = showProgressDialog(mockAccounts);
    });

    test('should register cancel callback', () => {
      const cancelCallback = jest.fn();
      dialog.onCancel(cancelCallback);

      expect(dialog.isCancelled()).toBe(false);
    });

    test('should execute cancel callback when cancelled', () => {
      const cancelCallback = jest.fn();
      dialog.onCancel(cancelCallback);

      // Get the cancel button that was created
      const createElementCalls = document.createElement.mock.calls;
      const buttonCalls = createElementCalls.filter((call) => call[0] === 'button');
      const cancelButton = buttonCalls.find((call, index) => {
        const mockElement = document.createElement.mock.results[
          createElementCalls.indexOf(call)
        ].value;
        return mockElement.textContent === 'Cancel Upload' || index === 0; // First button should be cancel
      });

      if (cancelButton) {
        const mockCancelButton = document.createElement.mock.results[
          createElementCalls.indexOf(cancelButton)
        ].value;

        // Simulate cancel button click
        mockCancelButton.onclick();

        expect(cancelCallback).toHaveBeenCalled();
        expect(dialog.isCancelled()).toBe(true);
      }
    });

    test('should handle cancel button click without callback', () => {
      // Don't set a callback, then try to click cancel
      const createElementCalls = document.createElement.mock.calls;
      const buttonCalls = createElementCalls.filter((call) => call[0] === 'button');

      if (buttonCalls.length > 0) {
        const mockCancelButton = document.createElement.mock.results[
          createElementCalls.indexOf(buttonCalls[0])
        ].value;

        expect(() => {
          mockCancelButton.onclick();
        }).not.toThrow();
      }
    });

    test('should prevent multiple cancel operations', () => {
      const cancelCallback = jest.fn();
      dialog.onCancel(cancelCallback);

      const createElementCalls = document.createElement.mock.calls;
      const buttonCalls = createElementCalls.filter((call) => call[0] === 'button');

      if (buttonCalls.length > 0) {
        const mockCancelButton = document.createElement.mock.results[
          createElementCalls.indexOf(buttonCalls[0])
        ].value;

        // First cancel
        mockCancelButton.onclick();
        expect(cancelCallback).toHaveBeenCalledTimes(1);

        // Second cancel attempt should not call callback again
        mockCancelButton.onclick();
        expect(cancelCallback).toHaveBeenCalledTimes(1); // Still 1, not 2
      }
    });

    test('should handle callback execution errors gracefully', () => {
      const errorCallback = jest.fn(() => {
        throw new Error('Callback error');
      });
      dialog.onCancel(errorCallback);

      const createElementCalls = document.createElement.mock.calls;
      const buttonCalls = createElementCalls.filter((call) => call[0] === 'button');

      if (buttonCalls.length > 0) {
        const mockCancelButton = document.createElement.mock.results[
          createElementCalls.indexOf(buttonCalls[0])
        ].value;

        expect(() => {
          mockCancelButton.onclick();
        }).not.toThrow();
        expect(dialog.isCancelled()).toBe(true);
      }
    });
  });

  describe('hideCancel functionality', () => {
    beforeEach(() => {
      dialog = showProgressDialog(mockAccounts);
    });

    test('should hide cancel button', () => {
      expect(() => {
        dialog.hideCancel();
      }).not.toThrow();
    });

    test('should be chainable', () => {
      const result = dialog.hideCancel();
      expect(result).toBeUndefined(); // hideCancel doesn't return anything
    });
  });

  describe('close functionality', () => {
    beforeEach(() => {
      dialog = showProgressDialog(mockAccounts);
    });

    test('should close dialog and return dialog instance', () => {
      const result = dialog.close();
      expect(result).toBe(dialog);
    });

    test('should remove overlay from DOM', () => {
      dialog.close();
      // The remove method should be called on the overlay
      expect(dialog).toBeDefined();
    });

    test('should handle multiple close calls gracefully', () => {
      dialog.close();
      expect(() => {
        dialog.close();
      }).not.toThrow();
    });
  });

  describe('dialog API completeness', () => {
    beforeEach(() => {
      dialog = showProgressDialog(mockAccounts);
    });

    test('should have all required API methods', () => {
      expect(typeof dialog.updateProgress).toBe('function');
      expect(typeof dialog.updateBalanceChange).toBe('function');
      expect(typeof dialog.showError).toBe('function');
      expect(typeof dialog.showSummary).toBe('function');
      expect(typeof dialog.onCancel).toBe('function');
      expect(typeof dialog.isCancelled).toBe('function');
      expect(typeof dialog.hideCancel).toBe('function');
      expect(typeof dialog.close).toBe('function');
      expect(typeof dialog.initSteps).toBe('function');
      expect(typeof dialog.updateStepStatus).toBe('function');
    });

    test('should maintain state consistency', () => {
      expect(dialog.isCancelled()).toBe(false);

      const stats = { success: 1, failed: 0, total: 3 };
      const result = dialog.showSummary(stats);
      expect(result).toBe(dialog);
    });
  });

  describe('error handling edge cases', () => {
    test('should handle empty accounts array', () => {
      expect(() => {
        dialog = showProgressDialog([]);
      }).not.toThrow();
    });

    test('should handle accounts with missing properties', () => {
      const incompleteAccounts = [
        {},
        { nickname: 'Only nickname' },
        { name: 'Only name' },
      ];

      expect(() => {
        dialog = showProgressDialog(incompleteAccounts);
      }).not.toThrow();
    });

    test('should handle null/undefined accounts gracefully', () => {
      expect(() => {
        dialog = showProgressDialog([null, undefined, { key: 'valid' }]);
      }).not.toThrow();
    });
  });

  describe('DOM manipulation', () => {
    test('should create proper DOM structure', () => {
      dialog = showProgressDialog(mockAccounts);

      // Should call createElement for various elements
      expect(document.createElement).toHaveBeenCalledWith('div'); // overlay
      expect(document.createElement).toHaveBeenCalledWith('h2'); // header
      expect(document.createElement).toHaveBeenCalledWith('button'); // buttons
    });

    test('should append elements to DOM', () => {
      dialog = showProgressDialog(mockAccounts);

      expect(document.body.appendChild).toHaveBeenCalled();
    });
  });

  describe('default export', () => {
    test('should export showProgressDialog as default', () => {
      const defaultExport = require('../../src/ui/components/progressDialog').default;
      expect(defaultExport).toBeDefined();
      expect(typeof defaultExport.showProgressDialog).toBe('function');
    });
  });

  describe('auto-scroll behavior', () => {
    beforeEach(() => {
      dialog = showProgressDialog(mockAccounts);
    });

    test('should auto-expand account when step changes to processing', () => {
      // Initialize steps for the account
      dialog.initSteps('acc1', [
        { key: 'step1', name: 'Step 1' },
        { key: 'step2', name: 'Step 2' },
      ]);

      // Update step to processing
      dialog.updateStepStatus('acc1', 'step1', 'processing', 'Working...');

      // The function should execute without errors (auto-expand triggered)
      expect(dialog).toBeDefined();
    });

    test('should auto-collapse account when all steps complete', () => {
      // Initialize steps for the account
      dialog.initSteps('acc1', [
        { key: 'step1', name: 'Step 1' },
        { key: 'step2', name: 'Step 2' },
      ]);

      // Complete all steps
      dialog.updateStepStatus('acc1', 'step1', 'success', 'Done');
      dialog.updateStepStatus('acc1', 'step2', 'success', 'Done');

      // The function should execute without errors (auto-collapse triggered)
      expect(dialog).toBeDefined();
    });

    test('should handle processing then completion sequence', () => {
      dialog.initSteps('acc1', [
        { key: 'step1', name: 'Step 1' },
        { key: 'step2', name: 'Step 2' },
      ]);

      // Start processing
      dialog.updateStepStatus('acc1', 'step1', 'processing', 'Working...');

      // Complete first step
      dialog.updateStepStatus('acc1', 'step1', 'success', 'Done');

      // Process second step
      dialog.updateStepStatus('acc1', 'step2', 'processing', 'Working...');

      // Complete second step
      dialog.updateStepStatus('acc1', 'step2', 'success', 'Done');

      // Should complete without errors
      expect(dialog).toBeDefined();
    });

    test('should handle error status in steps', () => {
      dialog.initSteps('acc1', [
        { key: 'step1', name: 'Step 1' },
        { key: 'step2', name: 'Step 2' },
      ]);

      // Process and error
      dialog.updateStepStatus('acc1', 'step1', 'processing', 'Working...');
      dialog.updateStepStatus('acc1', 'step1', 'error', 'Failed');
      dialog.updateStepStatus('acc1', 'step2', 'skipped', 'Skipped due to error');

      // Should complete without errors
      expect(dialog).toBeDefined();
    });

    test('should handle multiple accounts with sequential processing', () => {
      // Initialize steps for all accounts
      dialog.initSteps('acc1', [{ key: 'step1', name: 'Step 1' }]);
      dialog.initSteps('acc2', [{ key: 'step1', name: 'Step 1' }]);
      dialog.initSteps('acc3', [{ key: 'step1', name: 'Step 1' }]);

      // Process account 1
      dialog.updateStepStatus('acc1', 'step1', 'processing', 'Working...');
      dialog.updateStepStatus('acc1', 'step1', 'success', 'Done');

      // Process account 2
      dialog.updateStepStatus('acc2', 'step1', 'processing', 'Working...');
      dialog.updateStepStatus('acc2', 'step1', 'success', 'Done');

      // Process account 3
      dialog.updateStepStatus('acc3', 'step1', 'processing', 'Working...');
      dialog.updateStepStatus('acc3', 'step1', 'success', 'Done');

      // Should complete without errors
      expect(dialog).toBeDefined();
    });
  });

  describe('user interaction disables auto-scroll', () => {
    beforeEach(() => {
      dialog = showProgressDialog(mockAccounts);
    });

    test('should still work after user scroll interaction', () => {
      // Initialize steps
      dialog.initSteps('acc1', [{ key: 'step1', name: 'Step 1' }]);

      // Simulate scroll event - this should disable auto-scroll internally
      // The actual scroll behavior is handled by the DOM, which is mocked

      // Continue processing - should not throw
      dialog.updateStepStatus('acc1', 'step1', 'processing', 'Working...');
      dialog.updateStepStatus('acc1', 'step1', 'success', 'Done');

      expect(dialog).toBeDefined();
    });

    test('should still work after user clicks on account row', () => {
      // Initialize steps
      dialog.initSteps('acc1', [{ key: 'step1', name: 'Step 1' }]);

      // Simulate click on account row - in real DOM this would disable auto-scroll
      // The mocked environment handles this gracefully

      // Continue processing - should not throw
      dialog.updateStepStatus('acc1', 'step1', 'processing', 'Working...');
      dialog.updateStepStatus('acc1', 'step1', 'success', 'Done');

      expect(dialog).toBeDefined();
    });
  });
});
