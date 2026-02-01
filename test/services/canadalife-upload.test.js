/**
 * Tests for Canada Life Upload Service
 */

import { jest } from '@jest/globals';
import '../setup';

// Mock all dependencies before importing the module under test
jest.mock('../../src/core/config', () => ({
  STORAGE: {
    CANADALIFE_ACCOUNT_MAPPING_PREFIX: 'canadalife_account_mapping_',
  },
  TRANSACTION_RETENTION_DEFAULTS: {
    DAYS: 91,
    COUNT: 1000,
  },
  INTEGRATIONS: {
    CANADALIFE: 'canadalife',
  },
}));

jest.mock('../../src/services/common/accountService', () => ({
  __esModule: true,
  default: {
    getAccountData: jest.fn(),
    upsertAccount: jest.fn(),
    updateAccountInList: jest.fn(),
    cleanupLegacyStorage: jest.fn(() => ({ cleaned: true, keysDeleted: 0, keys: [] })),
  },
}));

jest.mock('../../src/core/utils', () => ({
  debugLog: jest.fn(),
  formatDate: jest.fn((date) => {
    if (date instanceof Date && !isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
    return 'Invalid Date';
  }),
  getTodayLocal: jest.fn(() => '2024-01-15'),
  getYesterdayLocal: jest.fn(() => '2024-01-14'),
  formatDaysAgoLocal: jest.fn((days) => {
    const date = new Date('2024-01-15');
    date.setDate(date.getDate() - days);
    return date.toISOString().split('T')[0];
  }),
  parseLocalDate: jest.fn((dateString) => new Date(dateString)),
  calculateFromDateWithLookback: jest.fn(),
  saveLastUploadDate: jest.fn(),
  getLastUpdateDate: jest.fn(),
}));

jest.mock('../../src/core/state', () => ({
  __esModule: true,
  default: {
    getState: jest.fn(() => ({
      currentAccount: { nickname: 'Test Account', name: 'Test Account' },
    })),
    setAccount: jest.fn(),
  },
}));

jest.mock('../../src/api/canadalife', () => ({
  __esModule: true,
  default: {
    loadCanadaLifeAccounts: jest.fn(),
    loadAccountBalanceHistory: jest.fn(),
  },
}));

jest.mock('../../src/api/monarch', () => ({
  __esModule: true,
  default: {
    listAccounts: jest.fn(),
    uploadBalance: jest.fn(),
    validateAndRefreshAccountMapping: jest.fn(),
  },
}));

jest.mock('../../src/ui/toast', () => ({
  __esModule: true,
  default: {
    show: jest.fn(),
  },
}));

jest.mock('../../src/ui/components/progressDialog', () => ({
  showProgressDialog: jest.fn(() => ({
    updateProgress: jest.fn(),
    updateBalanceChange: jest.fn(),
    hideCancel: jest.fn(),
    showSummary: jest.fn(),
    onCancel: jest.fn(),
    showError: jest.fn(),
    initSteps: jest.fn(),
    updateStepStatus: jest.fn(),
  })),
}));

jest.mock('../../src/ui/components/datePicker', () => ({
  showDatePickerPromise: jest.fn(),
}));

jest.mock('../../src/ui/components/accountSelectorWithCreate', () => ({
  showMonarchAccountSelectorWithCreate: jest.fn(),
}));

jest.mock('../../src/ui/components/monarchLoginLink', () => ({
  ensureMonarchAuthentication: jest.fn(),
}));

// Mock GM functions
globalThis.GM_getValue = jest.fn();
globalThis.GM_setValue = jest.fn();

// Import the module under test after mocking all dependencies
// eslint-disable-next-line import/first
import {
  uploadAllCanadaLifeAccountsToMonarch,
  uploadCanadaLifeAccountWithDateRange,
  convertCanadaLifeDataToCSV,
  CanadaLifeUploadError,
} from '../../src/services/canadalife-upload';

describe('Canada Life Upload Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = '';
  });

  describe('CanadaLifeUploadError', () => {
    test('should create error with message and accountId', () => {
      const error = new CanadaLifeUploadError('Test error', 'account123');
      expect(error.message).toBe('Test error');
      expect(error.accountId).toBe('account123');
      expect(error.name).toBe('CanadaLifeUploadError');
      expect(error instanceof Error).toBe(true);
    });

    test('should inherit from Error correctly', () => {
      const error = new CanadaLifeUploadError('Test message', 'acc1');
      expect(error.stack).toBeDefined();
      expect(error.toString()).toContain('CanadaLifeUploadError: Test message');
    });
  });

  describe('convertCanadaLifeDataToCSV', () => {
    test('should convert valid historical data to CSV format', () => {
      const historicalData = {
        data: [
          ['Date', 'Balance', 'Account Name'], // Header row
          ['2024-01-15', '10000.50', 'RRSP Account'],
          ['2024-01-14', '9950.25', 'RRSP Account'],
          ['2024-01-13', '9900.00', 'RRSP Account'],
        ],
      };

      const result = convertCanadaLifeDataToCSV(historicalData);

      expect(result).toContain('"Date","Total Equity","Account Name"');
      expect(result).toContain('"2024-01-15","10000.50","RRSP Account"');
      expect(result).toContain('"2024-01-14","9950.25","RRSP Account"');
      expect(result).toContain('"2024-01-13","9900.00","RRSP Account"');

      // Count lines (header + 3 data rows)
      const lines = result.split('\n').filter((line) => line.length > 0);
      expect(lines).toHaveLength(4);
    });

    test('should call debugLog during conversion', () => {
      const utils = jest.requireMock('../../src/core/utils');
      const historicalData = {
        data: [
          ['Date', 'Balance', 'Account Name'],
          ['2024-01-15', '10000.50', 'RRSP Account'],
        ],
      };

      // Import after mocking to ensure the mocks are applied
      const { convertCanadaLifeDataToCSV: convert } = jest.requireActual('../../src/services/canadalife-upload');
      convert(historicalData);

      expect(utils.debugLog).toHaveBeenCalledWith(expect.stringContaining('Converted 1 balance records to CSV format'));
    });

    test('should call debugLog on error', () => {
      const utils = jest.requireMock('../../src/core/utils');

      // Import after mocking to ensure the mocks are applied
      const { convertCanadaLifeDataToCSV: convert } = jest.requireActual('../../src/services/canadalife-upload');

      expect(() => convert(null)).toThrow('Invalid historical data format');
      expect(utils.debugLog).toHaveBeenCalledWith('Error converting Canada Life data to CSV:', expect.any(Error));
    });

    test('should handle single balance record', () => {
      const historicalData = {
        data: [
          ['Date', 'Balance', 'Account Name'],
          ['2024-01-15', '5000.00', 'TFSA'],
        ],
      };

      const result = convertCanadaLifeDataToCSV(historicalData);
      expect(result).toContain('"Date","Total Equity","Account Name"');
      expect(result).toContain('"2024-01-15","5000.00","TFSA"');
    });

    test('should handle empty data array after header', () => {
      const historicalData = {
        data: [['Date', 'Balance', 'Account Name']], // Only header row
      };

      expect(() => convertCanadaLifeDataToCSV(historicalData)).toThrow('No balance data to convert');
    });

    test('should handle null historical data', () => {
      expect(() => convertCanadaLifeDataToCSV(null)).toThrow('Invalid historical data format');
    });

    test('should handle undefined historical data', () => {
      expect(() => convertCanadaLifeDataToCSV(undefined)).toThrow('Invalid historical data format');
    });

    test('should handle missing data property', () => {
      expect(() => convertCanadaLifeDataToCSV({})).toThrow('Invalid historical data format');
    });

    test('should handle non-array data property', () => {
      expect(() => convertCanadaLifeDataToCSV({ data: 'invalid' })).toThrow('Invalid historical data format');
      expect(() => convertCanadaLifeDataToCSV({ data: null })).toThrow('Invalid historical data format');
    });

    test('should handle special characters in CSV data', () => {
      const historicalData = {
        data: [
          ['Date', 'Balance', 'Account Name'],
          ['2024-01-15', '1,000.50', 'Account "Special"'],
          ['2024-01-14', '999.99', 'Account, with comma'],
        ],
      };

      const result = convertCanadaLifeDataToCSV(historicalData);
      expect(result).toContain('"1,000.50"');
      expect(result).toContain('"Account "Special""');
      expect(result).toContain('"Account, with comma"');
    });

    test('should handle empty string values', () => {
      const historicalData = {
        data: [
          ['Date', 'Balance', 'Account Name'],
          ['', '', ''],
          ['2024-01-15', '1000', 'Test'],
        ],
      };

      const result = convertCanadaLifeDataToCSV(historicalData);
      expect(result).toContain('""');
      expect(result).toContain('"1000"');
    });
  });

  describe('uploadAllCanadaLifeAccountsToMonarch', () => {
    let mockProgressDialog;
    let ensureMonarchAuthentication;
    let canadalife;
    let monarchApi;
    let toast;
    let showProgressDialog;
    let utils;
    let showDatePickerPromise;
    let stateManager;
    let accountService;

    beforeEach(() => {
      // Get the mocked modules that were set up at the top level
      ensureMonarchAuthentication = require('../../src/ui/components/monarchLoginLink').ensureMonarchAuthentication;
      canadalife = require('../../src/api/canadalife').default;
      monarchApi = require('../../src/api/monarch').default;
      accountService = require('../../src/services/common/accountService').default;

      // Default: accountService.getAccountData returns stored monarch account
      // This simulates having an existing account mapping in consolidated storage
      accountService.getAccountData.mockReturnValue({
        monarchAccount: { id: 'monarch123', displayName: 'Investment Account' },
      });

      // Default: validateAndRefreshAccountMapping returns valid existing account
      monarchApi.validateAndRefreshAccountMapping.mockResolvedValue({
        valid: true,
        account: { id: 'monarch123', displayName: 'Investment Account' },
      });
      toast = require('../../src/ui/toast').default;
      showProgressDialog = require('../../src/ui/components/progressDialog').showProgressDialog;
      utils = require('../../src/core/utils');
      showDatePickerPromise = require('../../src/ui/components/datePicker').showDatePickerPromise;
      stateManager = require('../../src/core/state').default;

      mockProgressDialog = {
        updateProgress: jest.fn(),
        updateBalanceChange: jest.fn(),
        hideCancel: jest.fn(),
        showSummary: jest.fn(),
        onCancel: jest.fn(),
        showError: jest.fn().mockResolvedValue(),
        initSteps: jest.fn(),
        updateStepStatus: jest.fn(),
      };
      showProgressDialog.mockReturnValue(mockProgressDialog);

      // Reset all mocks
      ensureMonarchAuthentication.mockReset();
      canadalife.loadCanadaLifeAccounts.mockReset();
      canadalife.loadAccountBalanceHistory.mockReset();
      monarchApi.listAccounts.mockReset();
      monarchApi.uploadBalance.mockReset();
      toast.show.mockReset();
      showDatePickerPromise.mockReset();
      stateManager.getState.mockReset();
      stateManager.setAccount.mockReset();

      // Use mockClear() for utils to preserve implementations
      utils.debugLog.mockClear();
      utils.formatDate.mockClear();
      utils.getTodayLocal.mockClear();
      utils.getYesterdayLocal.mockClear();
      utils.formatDaysAgoLocal.mockClear();
      utils.parseLocalDate.mockClear();
      utils.calculateFromDateWithLookback.mockClear();
      utils.saveLastUploadDate.mockClear();
      utils.getLastUpdateDate.mockClear();

      // Re-setup showProgressDialog after reset
      showProgressDialog.mockReset();
      showProgressDialog.mockReturnValue(mockProgressDialog);
    });

    test('should return early if authentication fails', async () => {
      ensureMonarchAuthentication.mockResolvedValue(false);

      await uploadAllCanadaLifeAccountsToMonarch();

      expect(ensureMonarchAuthentication).toHaveBeenCalledWith(null, 'upload all Canada Life accounts');
      expect(canadalife.loadCanadaLifeAccounts).not.toHaveBeenCalled();
      expect(toast.show).not.toHaveBeenCalled();
    });

    test('should show error if no accounts found', async () => {
      ensureMonarchAuthentication.mockResolvedValue(true);
      canadalife.loadCanadaLifeAccounts.mockResolvedValue([]);

      await uploadAllCanadaLifeAccountsToMonarch();

      expect(toast.show).toHaveBeenCalledWith('No Canada Life accounts found', 'error');
      expect(showProgressDialog).not.toHaveBeenCalled();
    });

    test('should show error if accounts is null', async () => {
      ensureMonarchAuthentication.mockResolvedValue(true);
      canadalife.loadCanadaLifeAccounts.mockResolvedValue(null);

      await uploadAllCanadaLifeAccountsToMonarch();

      expect(toast.show).toHaveBeenCalledWith('No Canada Life accounts found', 'error');
    });

    test('should handle error during account loading', async () => {
      ensureMonarchAuthentication.mockResolvedValue(true);
      canadalife.loadCanadaLifeAccounts.mockRejectedValue(new Error('Network error'));

      await uploadAllCanadaLifeAccountsToMonarch();

      expect(toast.show).toHaveBeenCalledWith('Failed to start upload process: Network error', 'error');
    });

    test('should show loading toast when starting', async () => {
      ensureMonarchAuthentication.mockResolvedValue(true);
      canadalife.loadCanadaLifeAccounts.mockResolvedValue([]);

      await uploadAllCanadaLifeAccountsToMonarch();

      expect(toast.show).toHaveBeenCalledWith('Loading Canada Life accounts...', 'info');
    });

    test('should create progress dialog with correct accounts', async () => {
      const mockAccounts = [
        {
          agreementId: 'acc1',
          LongNameEnglish: 'Long Account Name',
          EnglishShortName: 'Short Name',
        },
        {
          agreementId: 'acc2',
          EnglishShortName: 'Another Account',
        },
      ];

      ensureMonarchAuthentication.mockResolvedValue(true);
      canadalife.loadCanadaLifeAccounts.mockResolvedValue(mockAccounts);

      await uploadAllCanadaLifeAccountsToMonarch();

      expect(showProgressDialog).toHaveBeenCalledWith(
        [
          {
            key: 'acc1',
            nickname: 'Long Account Name',
            name: 'Short Name',
          },
          {
            key: 'acc2',
            nickname: 'Another Account',
            name: 'Another Account',
          },
        ],
        'Uploading Canada Life Balance History to Monarch',
      );
    });

    test('should successfully upload single account with full flow', async () => {
      const mockAccount = {
        agreementId: 'acc123',
        LongNameEnglish: 'Test RRSP Account',
        EnglishShortName: 'RRSP',
        EnrollmentDate: '2020-01-01',
      };

      const mockHistoricalData = {
        data: [
          ['Date', 'Balance', 'Account Name'],
          ['2024-01-10', '9000.00', 'Test RRSP Account'],
          ['2024-01-11', '9100.00', 'Test RRSP Account'],
          ['2024-01-15', '10000.50', 'Test RRSP Account'],
        ],
      };

      const mockMonarchAccount = { id: 'monarch123', displayName: 'Investment Account' };

      // Setup successful flow
      ensureMonarchAuthentication.mockResolvedValue(true);
      canadalife.loadCanadaLifeAccounts.mockResolvedValue([mockAccount]);
      utils.calculateFromDateWithLookback.mockReturnValue('2024-01-01');
      utils.debugLog.mockImplementation(() => {}); // Allow debugLog calls to execute
      globalThis.GM_getValue.mockReturnValue(JSON.stringify(mockMonarchAccount));
      canadalife.loadAccountBalanceHistory.mockResolvedValue(mockHistoricalData);
      monarchApi.uploadBalance.mockResolvedValue(true);
      utils.saveLastUploadDate.mockImplementation(() => {});
      utils.getLastUpdateDate.mockReturnValue('2024-01-10');
      stateManager.setAccount.mockImplementation(() => {});

      await uploadAllCanadaLifeAccountsToMonarch();

      expect(mockProgressDialog.updateProgress).toHaveBeenCalledWith('acc123', 'processing', 'Getting start date...');
      expect(mockProgressDialog.hideCancel).toHaveBeenCalled();
      expect(mockProgressDialog.showSummary).toHaveBeenCalledWith({ success: 1, failed: 0, total: 1 });
      expect(toast.show).toHaveBeenCalledWith('Successfully uploaded balance history for all 1 Canada Life accounts!', 'info');

      // Verify internal function calls that should execute
      expect(stateManager.setAccount).toHaveBeenCalledWith('acc123', 'Test RRSP Account');
      expect(utils.debugLog).toHaveBeenCalledWith(expect.stringContaining('Found 1 Canada Life accounts for upload'));
      expect(utils.saveLastUploadDate).toHaveBeenCalledWith('acc123', '2024-01-15', 'canadalife');
    });

    test('should execute balance change extraction code paths', async () => {
      const mockAccount = {
        agreementId: 'acc456',
        LongNameEnglish: 'Balance Change Account',
        EnglishShortName: 'Balance',
      };

      const mockHistoricalData = {
        data: [
          ['Date', 'Balance', 'Account Name'],
          ['2024-01-10', '9000.00', 'Balance Change Account'],
          ['2024-01-11', '9500.00', 'Balance Change Account'],
          ['2024-01-15', '10000.50', 'Balance Change Account'],
        ],
      };

      const mockMonarchAccount = { id: 'monarch456', displayName: 'Balance Account' };

      // Setup to exercise balance change extraction
      ensureMonarchAuthentication.mockResolvedValue(true);
      canadalife.loadCanadaLifeAccounts.mockResolvedValue([mockAccount]);
      utils.calculateFromDateWithLookback.mockReturnValue('2024-01-01');
      utils.debugLog.mockImplementation(() => {});
      globalThis.GM_getValue.mockReturnValue(JSON.stringify(mockMonarchAccount));
      canadalife.loadAccountBalanceHistory.mockResolvedValue(mockHistoricalData);
      monarchApi.uploadBalance.mockResolvedValue(true);
      utils.getLastUpdateDate.mockReturnValue('2024-01-10'); // This should match data
      stateManager.setAccount.mockImplementation(() => {});

      await uploadAllCanadaLifeAccountsToMonarch();

      // Verify balance change calculation was called
      expect(mockProgressDialog.updateBalanceChange).toHaveBeenCalledWith('acc456', expect.objectContaining({
        oldBalance: 9000.00,
        newBalance: 10000.50,
        lastUploadDate: '2024-01-10',
        changePercent: expect.any(Number),
      }));

      // Verify debug logs for balance change extraction
      expect(utils.debugLog).toHaveBeenCalledWith(expect.stringContaining('Balance change for Canada Life account acc456'));
    });

    test('should extract balance change BEFORE saving last upload date (regression test)', async () => {
      // This test verifies the fix for the bug where percentage change was always 0%
      // because saveLastUploadDate was called before extractCanadaLifeBalanceChange
      const mockAccount = {
        agreementId: 'accOrderTest',
        LongNameEnglish: 'Order Test Account',
        EnglishShortName: 'OrderTest',
      };

      const mockHistoricalData = {
        data: [
          ['Date', 'Balance', 'Account Name'],
          ['2024-01-12', '133929.57', 'Order Test Account'],
          ['2024-01-13', '134013.95', 'Order Test Account'],
        ],
      };

      const mockMonarchAccount = { id: 'monarchOrder', displayName: 'Order Test Account' };

      // Track the order of function calls
      const callOrder = [];

      ensureMonarchAuthentication.mockResolvedValue(true);
      canadalife.loadCanadaLifeAccounts.mockResolvedValue([mockAccount]);
      utils.calculateFromDateWithLookback.mockReturnValue('2024-01-10');
      utils.debugLog.mockImplementation(() => {});
      globalThis.GM_getValue.mockReturnValue(JSON.stringify(mockMonarchAccount));
      canadalife.loadAccountBalanceHistory.mockResolvedValue(mockHistoricalData);
      monarchApi.uploadBalance.mockResolvedValue(true);
      stateManager.setAccount.mockImplementation(() => {});

      // Mock getLastUpdateDate to return the PREVIOUS upload date (2024-01-12)
      // This simulates having uploaded data before, and now uploading new data
      utils.getLastUpdateDate.mockImplementation(() => {
        callOrder.push('getLastUpdateDate');
        return '2024-01-12';
      });

      // Track when saveLastUploadDate is called
      utils.saveLastUploadDate.mockImplementation(() => {
        callOrder.push('saveLastUploadDate');
      });

      // Track when updateBalanceChange is called
      mockProgressDialog.updateBalanceChange.mockImplementation(() => {
        callOrder.push('updateBalanceChange');
      });

      await uploadAllCanadaLifeAccountsToMonarch();

      // Verify the correct order: balance change extraction should happen BEFORE saving
      // getLastUpdateDate is called during balance change extraction
      // updateBalanceChange is called to display the result
      // saveLastUploadDate is called to save the new date
      const getLastUpdateIndex = callOrder.indexOf('getLastUpdateDate');
      const updateBalanceChangeIndex = callOrder.indexOf('updateBalanceChange');
      const saveLastUploadIndex = callOrder.indexOf('saveLastUploadDate');

      expect(getLastUpdateIndex).not.toBe(-1);
      expect(updateBalanceChangeIndex).not.toBe(-1);
      expect(saveLastUploadIndex).not.toBe(-1);

      // Key assertion: balance change must be extracted BEFORE saving the new date
      expect(updateBalanceChangeIndex).toBeLessThan(saveLastUploadIndex);

      // Verify the balance change was calculated correctly (not 0%)
      expect(mockProgressDialog.updateBalanceChange).toHaveBeenCalledWith('accOrderTest', expect.objectContaining({
        oldBalance: 133929.57,
        newBalance: 134013.95,
        changePercent: expect.any(Number),
      }));

      // Verify the change percent is NOT 0 (the bug would have caused 0%)
      const updateBalanceChangeCall = mockProgressDialog.updateBalanceChange.mock.calls[0];
      const balanceChangeData = updateBalanceChangeCall[1];
      expect(balanceChangeData.changePercent).not.toBe(0);
      expect(balanceChangeData.changePercent).toBeCloseTo(0.063, 2); // ~0.063% change
    });

    test('should exercise date validation code paths with enrollment date', async () => {
      const mockAccount = {
        agreementId: 'acc789',
        LongNameEnglish: 'Date Validation Account',
        EnglishShortName: 'DateVal',
        EnrollmentDate: '2023-06-15T00:00:00', // ISO format enrollment date
      };

      const mockHistoricalData = {
        data: [
          ['Date', 'Balance', 'Account Name'],
          ['2024-01-15', '10000.50', 'Date Validation Account'],
        ],
      };

      const mockMonarchAccount = { id: 'monarch789', displayName: 'Date Val Account' };

      // Setup with start date after enrollment date
      ensureMonarchAuthentication.mockResolvedValue(true);
      canadalife.loadCanadaLifeAccounts.mockResolvedValue([mockAccount]);
      utils.calculateFromDateWithLookback.mockReturnValue('2023-07-01'); // After enrollment
      utils.debugLog.mockImplementation(() => {});
      utils.parseLocalDate.mockImplementation((dateStr) => new Date(dateStr));
      globalThis.GM_getValue.mockReturnValue(JSON.stringify(mockMonarchAccount));
      canadalife.loadAccountBalanceHistory.mockResolvedValue(mockHistoricalData);
      monarchApi.uploadBalance.mockResolvedValue(true);
      stateManager.setAccount.mockImplementation(() => {});

      await uploadAllCanadaLifeAccountsToMonarch();

      // Verify date validation debug logs
      expect(utils.debugLog).toHaveBeenCalledWith(expect.stringContaining('Validating start date'));
      expect(utils.debugLog).toHaveBeenCalledWith(expect.stringContaining('Date validation passed'));
      expect(utils.parseLocalDate).toHaveBeenCalledWith('2023-07-01');
    });

    test('should handle user cancelling date selection', async () => {
      const mockAccount = {
        agreementId: 'acc456',
        LongNameEnglish: 'Test Account',
        EnglishShortName: 'Test',
      };

      ensureMonarchAuthentication.mockResolvedValue(true);
      canadalife.loadCanadaLifeAccounts.mockResolvedValue([mockAccount]);
      utils.calculateFromDateWithLookback.mockReturnValue(null); // No previous upload
      utils.formatDaysAgoLocal.mockReturnValue('2023-10-17'); // 90 days ago default
      utils.debugLog.mockImplementation(() => {});
      showDatePickerPromise.mockResolvedValue(null); // User cancelled
      stateManager.getState.mockReturnValue({
        currentAccount: { nickname: 'Test Account', name: 'Test Account' },
      });

      await uploadAllCanadaLifeAccountsToMonarch();

      expect(mockProgressDialog.updateProgress).toHaveBeenCalledWith('acc456', 'error', 'Date selection cancelled');
      expect(mockProgressDialog.hideCancel).toHaveBeenCalled();
      expect(mockProgressDialog.showSummary).toHaveBeenCalledWith({ success: 0, failed: 1, total: 1 });

      // Verify that date picker was called with correct parameters
      expect(showDatePickerPromise).toHaveBeenCalledWith(
        '2023-10-17',
        'Select initial start date for Test Account balance history upload',
      );
      expect(utils.formatDaysAgoLocal).toHaveBeenCalledWith(90);
    });

    test('should exercise business days calculation', async () => {
      const mockAccount = {
        agreementId: 'acc999',
        LongNameEnglish: 'Business Days Account',
        EnglishShortName: 'BizDays',
      };

      const mockHistoricalData = {
        data: [
          ['Date', 'Balance', 'Account Name'],
          ['2024-01-15', '10000.50', 'Business Days Account'],
        ],
      };

      const mockMonarchAccount = { id: 'monarch999', displayName: 'Biz Days Account' };

      ensureMonarchAuthentication.mockResolvedValue(true);
      canadalife.loadCanadaLifeAccounts.mockResolvedValue([mockAccount]);
      utils.calculateFromDateWithLookback.mockReturnValue('2024-01-08'); // Monday to Monday (6 days)
      utils.debugLog.mockImplementation(() => {});
      globalThis.GM_getValue.mockReturnValue(JSON.stringify(mockMonarchAccount));
      canadalife.loadAccountBalanceHistory.mockResolvedValue(mockHistoricalData);
      monarchApi.uploadBalance.mockResolvedValue(true);
      stateManager.setAccount.mockImplementation(() => {});

      await uploadAllCanadaLifeAccountsToMonarch();

      // Verify progress was called for this account
      expect(mockProgressDialog.updateProgress).toHaveBeenCalledWith('acc999', 'processing', 'Getting start date...');
    });

    test('should handle account with no enrollment date', async () => {
      const mockAccount = {
        agreementId: 'acc111',
        LongNameEnglish: 'No Enrollment Date Account',
        EnglishShortName: 'NoEnroll',
        // EnrollmentDate is undefined
      };

      const mockHistoricalData = {
        data: [
          ['Date', 'Balance', 'Account Name'],
          ['2024-01-15', '10000.50', 'No Enrollment Date Account'],
        ],
      };

      const mockMonarchAccount = { id: 'monarch111', displayName: 'No Enroll Account' };

      ensureMonarchAuthentication.mockResolvedValue(true);
      canadalife.loadCanadaLifeAccounts.mockResolvedValue([mockAccount]);
      utils.calculateFromDateWithLookback.mockReturnValue('2024-01-01');
      utils.debugLog.mockImplementation(() => {});
      globalThis.GM_getValue.mockReturnValue(JSON.stringify(mockMonarchAccount));
      canadalife.loadAccountBalanceHistory.mockResolvedValue(mockHistoricalData);
      monarchApi.uploadBalance.mockResolvedValue(true);
      stateManager.setAccount.mockImplementation(() => {});

      await uploadAllCanadaLifeAccountsToMonarch();

      // Verify that enrollment date validation was skipped
      expect(utils.debugLog).toHaveBeenCalledWith('No EnrollmentDate found for account, skipping validation');
    });

    test('should handle account upload failure', async () => {
      const mockAccount = {
        agreementId: 'acc789',
        LongNameEnglish: 'Error Account',
        EnglishShortName: 'Error',
      };

      ensureMonarchAuthentication.mockResolvedValue(true);
      canadalife.loadCanadaLifeAccounts.mockResolvedValue([mockAccount]);
      utils.calculateFromDateWithLookback.mockReturnValue('2024-01-01');
      canadalife.loadAccountBalanceHistory.mockRejectedValue(new Error('Network timeout'));

      await uploadAllCanadaLifeAccountsToMonarch();

      expect(mockProgressDialog.showError).toHaveBeenCalledWith('acc789', expect.any(CanadaLifeUploadError));
      expect(mockProgressDialog.hideCancel).toHaveBeenCalled();
      expect(mockProgressDialog.showSummary).toHaveBeenCalledWith({ success: 0, failed: 1, total: 1 });
    });

    test('should handle multiple accounts with mixed results', async () => {
      const mockAccounts = [
        {
          agreementId: 'acc1',
          LongNameEnglish: 'Success Account',
          EnglishShortName: 'Success',
        },
        {
          agreementId: 'acc2',
          LongNameEnglish: 'Fail Account',
          EnglishShortName: 'Fail',
        },
      ];

      const mockHistoricalData = {
        data: [
          ['Date', 'Balance', 'Account Name'],
          ['2024-01-15', '10000.50', 'Account'],
        ],
      };

      const mockMonarchAccount = { id: 'monarch123', displayName: 'Investment Account' };

      ensureMonarchAuthentication.mockResolvedValue(true);
      canadalife.loadCanadaLifeAccounts.mockResolvedValue(mockAccounts);
      utils.calculateFromDateWithLookback.mockReturnValue('2024-01-01');
      globalThis.GM_getValue.mockReturnValue(JSON.stringify(mockMonarchAccount));

      // First account succeeds
      canadalife.loadAccountBalanceHistory
        .mockResolvedValueOnce(mockHistoricalData)
        .mockRejectedValueOnce(new Error('Second account fails'));

      monarchApi.uploadBalance.mockResolvedValue(true);

      await uploadAllCanadaLifeAccountsToMonarch();

      expect(mockProgressDialog.showSummary).toHaveBeenCalledWith({ success: 1, failed: 1, total: 2 });
      expect(toast.show).toHaveBeenCalledWith('Uploaded 1 of 2 accounts successfully', 'warning');
    });
  });

  describe('uploadCanadaLifeAccountWithDateRange', () => {
    let ensureMonarchAuthentication;
    let canadalife;
    let toast;

    beforeEach(() => {
      ensureMonarchAuthentication = jest.requireMock('../../src/ui/components/monarchLoginLink').ensureMonarchAuthentication;
      canadalife = jest.requireMock('../../src/api/canadalife').default;
      toast = jest.requireMock('../../src/ui/toast').default;
    });

    test('should return early if authentication fails', async () => {
      ensureMonarchAuthentication.mockResolvedValue(false);

      await uploadCanadaLifeAccountWithDateRange();

      expect(ensureMonarchAuthentication).toHaveBeenCalledWith(null, 'upload Canada Life account with custom date range');
      expect(canadalife.loadCanadaLifeAccounts).not.toHaveBeenCalled();
    });

    test('should show error if no accounts found', async () => {
      ensureMonarchAuthentication.mockResolvedValue(true);
      canadalife.loadCanadaLifeAccounts.mockResolvedValue([]);

      await uploadCanadaLifeAccountWithDateRange();

      expect(toast.show).toHaveBeenCalledWith('No Canada Life accounts found', 'error');
    });

    test('should handle error during process', async () => {
      const mockToast = jest.requireMock('../../src/ui/toast').default;
      ensureMonarchAuthentication.mockResolvedValue(true);
      canadalife.loadCanadaLifeAccounts.mockRejectedValue(new Error('API error'));

      await uploadCanadaLifeAccountWithDateRange();

      expect(mockToast.show).toHaveBeenCalledWith('Upload failed: API error', 'error');
    });

    test('should show loading toast', async () => {
      const mockToast = jest.requireMock('../../src/ui/toast').default;
      ensureMonarchAuthentication.mockResolvedValue(true);
      canadalife.loadCanadaLifeAccounts.mockResolvedValue([]);

      await uploadCanadaLifeAccountWithDateRange();

      expect(mockToast.show).toHaveBeenCalledWith('Loading Canada Life accounts...', 'info');
    });
  });
});
