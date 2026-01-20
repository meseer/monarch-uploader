/**
 * Comprehensive Tests for Rogers Bank Upload Service
 */

import {
  uploadRogersBankToMonarch,
} from '../../src/services/rogersbank-upload';

// Mock global fetch
global.fetch = jest.fn();

// Create RogersBankUploadError class for tests
class RogersBankUploadError extends Error {
  constructor(message, accountId) {
    super(message);
    this.name = 'RogersBankUploadError';
    this.accountId = accountId;
  }
}

// Mock DOM elements for getRogersAccountName testing
Object.defineProperty(global.document, 'querySelector', {
  value: jest.fn(),
  writable: true,
});

// Mock dependencies
jest.mock('../../src/core/utils', () => ({
  debugLog: jest.fn(),
  formatDate: jest.fn((date) => {
    if (date instanceof Date) {
      return date.toISOString().split('T')[0];
    }
    return '2024-01-15';
  }),
  getTodayLocal: jest.fn(() => '2024-01-15'),
  getYesterdayLocal: jest.fn(() => '2024-01-14'),
  formatDaysAgoLocal: jest.fn(() => '2023-10-15'),
  parseLocalDate: jest.fn((dateString) => new Date(dateString)),
  calculateFromDateWithLookback: jest.fn(),
  saveLastUploadDate: jest.fn(),
  getLastUpdateDate: jest.fn(),
}));

jest.mock('../../src/core/config', () => ({
  STORAGE: {
    ROGERSBANK_ACCOUNT_MAPPING_PREFIX: 'rogersbank_account_',
    ROGERSBANK_UPLOADED_REFS_PREFIX: 'rogersbank_uploaded_refs_',
    ROGERSBANK_LAST_UPLOAD_DATE_PREFIX: 'rogersbank_last_upload_date_',
    ROGERSBANK_LOOKBACK_DAYS: 'rogersbank_lookback_days',
    ROGERSBANK_LAST_CREDIT_LIMIT_PREFIX: 'rogersbank_last_credit_limit_',
    ROGERSBANK_BALANCE_CHECKPOINT_PREFIX: 'rogersbank_balance_checkpoint_',
  },
  LOGO_CLOUDINARY_IDS: {
    ROGERS: 'production/account_logos/rogers',
  },
}));

jest.mock('../../src/core/state', () => ({
  __esModule: true,
  default: {
    getState: jest.fn(() => ({
      currentAccount: { nickname: 'Rogers Card', name: 'Rogers Card' },
    })),
    setAccount: jest.fn(),
    setRogersBankAuth: jest.fn(),
  },
}));

jest.mock('../../src/api/rogersbank', () => ({
  getRogersBankCredentials: jest.fn(),
  checkRogersBankAuth: jest.fn(),
  fetchRogersBankAccountDetails: jest.fn(),
}));

jest.mock('../../src/api/monarch', () => ({
  __esModule: true,
  default: {
    listAccounts: jest.fn(),
    uploadTransactions: jest.fn(),
    uploadBalance: jest.fn(),
    getCategoriesAndGroups: jest.fn(),
    setCreditLimit: jest.fn().mockResolvedValue(true),
    setAccountLogo: jest.fn().mockResolvedValue(true),
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
    hideCancel: jest.fn(),
    showSummary: jest.fn(),
    onCancel: jest.fn(),
    initSteps: jest.fn(),
    updateStepStatus: jest.fn(),
    updateBalanceChange: jest.fn(),
  })),
}));

jest.mock('../../src/ui/components/datePicker', () => ({
  showDatePickerWithOptionsPromise: jest.fn(),
}));

jest.mock('../../src/ui/components/accountSelectorWithCreate', () => ({
  showMonarchAccountSelectorWithCreate: jest.fn(),
}));

jest.mock('../../src/ui/components/monarchLoginLink', () => ({
  ensureMonarchAuthentication: jest.fn(),
}));

jest.mock('../../src/utils/csv', () => ({
  convertTransactionsToMonarchCSV: jest.fn(),
}));

jest.mock('../../src/mappers/category', () => ({
  applyCategoryMapping: jest.fn(),
  saveUserCategorySelection: jest.fn(),
  calculateAllCategorySimilarities: jest.fn(),
}));

jest.mock('../../src/utils/transactionStorage', () => ({
  getUploadedTransactionIds: jest.fn(() => []),
  saveUploadedTransactions: jest.fn(),
}));

jest.mock('../../src/ui/components/categorySelector', () => ({
  showMonarchCategorySelector: jest.fn(),
}));

// Mock GM functions
globalThis.GM_getValue = jest.fn();
globalThis.GM_setValue = jest.fn();
globalThis.GM_xmlhttpRequest = jest.fn();

describe('Rogers Bank Upload Service', () => {
  let getRogersBankCredentials;
  let fetchRogersBankAccountDetails;
  let monarchApi;
  let toast;
  let showDatePickerWithOptionsPromise;
  let showMonarchAccountSelectorWithCreate;
  let showProgressDialog;
  let convertTransactionsToMonarchCSV;
  let applyCategoryMapping;
  let showMonarchCategorySelector;
  let calculateFromDateWithLookback;
  let saveLastUploadDate;
  let getUploadedTransactionIds;
  let saveUploadedTransactions;

  beforeEach(() => {
    jest.clearAllMocks();

    // Get all the mocked modules
    const rogersbankMock = jest.requireMock('../../src/api/rogersbank');
    getRogersBankCredentials = rogersbankMock.getRogersBankCredentials;
    fetchRogersBankAccountDetails = rogersbankMock.fetchRogersBankAccountDetails;

    monarchApi = jest.requireMock('../../src/api/monarch').default;
    toast = jest.requireMock('../../src/ui/toast').default;
    showDatePickerWithOptionsPromise = jest.requireMock('../../src/ui/components/datePicker').showDatePickerWithOptionsPromise;
    showMonarchAccountSelectorWithCreate = jest.requireMock('../../src/ui/components/accountSelectorWithCreate').showMonarchAccountSelectorWithCreate;
    showProgressDialog = jest.requireMock('../../src/ui/components/progressDialog').showProgressDialog;
    convertTransactionsToMonarchCSV = jest.requireMock('../../src/utils/csv').convertTransactionsToMonarchCSV;
    applyCategoryMapping = jest.requireMock('../../src/mappers/category').applyCategoryMapping;
    showMonarchCategorySelector = jest.requireMock('../../src/ui/components/categorySelector').showMonarchCategorySelector;
    calculateFromDateWithLookback = jest.requireMock('../../src/core/utils').calculateFromDateWithLookback;
    saveLastUploadDate = jest.requireMock('../../src/core/utils').saveLastUploadDate;

    // Get transaction storage mocks
    const transactionStorageMock = jest.requireMock('../../src/utils/transactionStorage');
    getUploadedTransactionIds = transactionStorageMock.getUploadedTransactionIds;
    saveUploadedTransactions = transactionStorageMock.saveUploadedTransactions;

    // Setup DOM mocks
    global.document.querySelector.mockReturnValue({
      querySelectorAll: jest.fn(() => [
        { textContent: 'Rogers' },
        { textContent: 'Mastercard' },
      ]),
    });
  });

  describe('RogersBankUploadError', () => {
    test('should create error with message and optional accountId', () => {
      const error = new RogersBankUploadError('Test error', 'account123');
      expect(error.message).toBe('Test error');
      expect(error.accountId).toBe('account123');
      expect(error.name).toBe('RogersBankUploadError');
      expect(error instanceof Error).toBe(true);
    });

    test('should create error without accountId', () => {
      const error = new RogersBankUploadError('Test error');
      expect(error.message).toBe('Test error');
      expect(error.accountId).toBeUndefined();
      expect(error.name).toBe('RogersBankUploadError');
    });
  });

  describe('uploadRogersBankToMonarch - Basic Error Handling', () => {
    test('should handle missing credentials', async () => {
      getRogersBankCredentials.mockReturnValue({
        authToken: null,
        accountId: null,
        customerId: null,
        accountIdEncoded: null,
        customerIdEncoded: null,
        deviceId: null,
      });

      showDatePickerWithOptionsPromise.mockResolvedValue('2024-01-01');

      await uploadRogersBankToMonarch();

      expect(toast.show).toHaveBeenCalledWith(
        expect.stringContaining('Error:'),
        'error',
      );
    });

    test('should handle date selection cancellation', async () => {
      getRogersBankCredentials.mockReturnValue({
        authToken: 'test-token',
        accountId: 'test-account',
        customerId: 'test-customer',
        accountIdEncoded: 'encoded-account',
        customerIdEncoded: 'encoded-customer',
        deviceId: 'test-device',
      });

      showDatePickerWithOptionsPromise.mockResolvedValue(null);

      const result = await uploadRogersBankToMonarch();

      expect(result.success).toBe(false);
      expect(result.message).toBe('Date selection cancelled');
    });

    test('should handle error during monarch account listing', async () => {
      getRogersBankCredentials.mockReturnValue({
        authToken: 'test-token',
        accountId: 'test-account',
        customerId: 'test-customer',
        accountIdEncoded: 'encoded-account',
        customerIdEncoded: 'encoded-customer',
        deviceId: 'test-device',
      });

      showDatePickerWithOptionsPromise.mockResolvedValue('2024-01-01');
      calculateFromDateWithLookback.mockReturnValue('2024-01-01');
      globalThis.GM_getValue.mockReturnValue(null); // No saved mapping

      // Mock error in account mapping
      monarchApi.listAccounts.mockRejectedValue(new Error('Network error'));
      await uploadRogersBankToMonarch();

      expect(toast.show).toHaveBeenCalledWith('Error: Network error', 'error');
    });

    test('should handle account selector cancellation', async () => {
      getRogersBankCredentials.mockReturnValue({
        authToken: 'test-token',
        accountId: 'test-account',
        customerId: 'test-customer',
        accountIdEncoded: 'encoded-account',
        customerIdEncoded: 'encoded-customer',
        deviceId: 'test-device',
      });

      showDatePickerWithOptionsPromise.mockResolvedValue('2024-01-01');
      calculateFromDateWithLookback.mockReturnValue('2024-01-01');
      globalThis.GM_getValue.mockReturnValue(null); // No saved mapping
      monarchApi.listAccounts.mockResolvedValue([
        { id: 'monarch123', displayName: 'Test Credit Card' },
      ]);

      // User cancels account selection
      showMonarchAccountSelectorWithCreate.mockImplementation((accounts, callback) => {
        callback(null);
      });

      const result = await uploadRogersBankToMonarch();

      expect(result.success).toBe(false);
      expect(result.message).toBe('Account selection cancelled by user');
    });
  });

  describe('uploadRogersBankToMonarch - Successful Balance Upload', () => {
    test('should successfully upload balance only when no transactions', async () => {
      // Setup valid credentials
      getRogersBankCredentials.mockReturnValue({
        authToken: 'test-token',
        accountId: 'test-account',
        customerId: 'test-customer',
        accountIdEncoded: 'encoded-account',
        customerIdEncoded: 'encoded-customer',
        deviceId: 'test-device',
      });

      showDatePickerWithOptionsPromise.mockResolvedValue('2024-01-01');
      calculateFromDateWithLookback.mockReturnValue('2024-01-01');

      // Mock existing account mapping
      globalThis.GM_getValue.mockReturnValue(
        JSON.stringify({ id: 'monarch123', displayName: 'Rogers Card' }),
      );

      // Mock successful balance fetch
      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -1500.50, creditLimit: 5000, openedDate: "2023-01-01" });
      monarchApi.uploadBalance.mockResolvedValue(true);

      // Mock fetch to return no transactions
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          activitySummary: {
            totalCount: 0,
            activities: [],
          },
        }),
      });

      const result = await uploadRogersBankToMonarch();

      expect(result.success).toBe(true);
      expect(result.message).toContain('Balance uploaded successfully');
      expect(fetchRogersBankAccountDetails).toHaveBeenCalled();
      expect(monarchApi.uploadBalance).toHaveBeenCalledWith(
        'monarch123',
        expect.stringContaining('-1500.5'),
        '2024-01-15',
        '2024-01-15',
      );
    });

    test('should handle balance upload failure but continue with transactions', async () => {
      // Setup for successful transaction upload despite balance failure
      getRogersBankCredentials.mockReturnValue({
        authToken: 'test-token',
        accountId: 'test-account',
        customerId: 'test-customer',
        accountIdEncoded: 'encoded-account',
        customerIdEncoded: 'encoded-customer',
        deviceId: 'test-device',
      });

      showDatePickerWithOptionsPromise.mockResolvedValue('2024-01-01');
      calculateFromDateWithLookback.mockReturnValue('2024-01-01');
      globalThis.GM_getValue.mockReturnValue(
        JSON.stringify({ id: 'monarch123', displayName: 'Rogers Card' }),
      );

      // Mock balance fetch failure
      fetchRogersBankAccountDetails.mockRejectedValue(new Error('Balance fetch failed'));

      // Mock transactions
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          activitySummary: {
            totalCount: 1,
            activities: [
              {
                referenceNumber: 'REF123',
                activityStatus: 'APPROVED',
                transactionAmount: -25.00,
                description: 'Test Merchant',
                activityDate: '2024-01-10',
                merchant: { categoryDescription: 'Restaurants' },
              },
            ],
          },
        }),
      });

      // Mock category resolution
      monarchApi.getCategoriesAndGroups.mockResolvedValue({
        categories: [{ name: 'Dining' }],
      });
      applyCategoryMapping.mockReturnValue('Dining');

      convertTransactionsToMonarchCSV.mockReturnValue('csv,data');
      monarchApi.uploadTransactions.mockResolvedValue(true);

      const result = await uploadRogersBankToMonarch();

      expect(result.success).toBe(true);
      expect(result.message).toContain('uploaded');
      expect(saveLastUploadDate).toHaveBeenCalled();
    });
  });

  describe('uploadRogersBankToMonarch - Transaction Processing', () => {
    test('should filter approved transactions only', async () => {
      getRogersBankCredentials.mockReturnValue({
        authToken: 'test-token',
        accountId: 'test-account',
        customerId: 'test-customer',
        accountIdEncoded: 'encoded-account',
        customerIdEncoded: 'encoded-customer',
        deviceId: 'test-device',
      });

      showDatePickerWithOptionsPromise.mockResolvedValue('2024-01-01');
      calculateFromDateWithLookback.mockReturnValue('2024-01-01');
      globalThis.GM_getValue.mockReturnValue(
        JSON.stringify({ id: 'monarch123', displayName: 'Rogers Card' }),
      );

      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -1000, creditLimit: 5000, openedDate: "2023-01-01" });
      monarchApi.uploadBalance.mockResolvedValue(true);

      // Mock transactions with mixed statuses
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          activitySummary: {
            totalCount: 3,
            activities: [
              {
                referenceNumber: 'REF1',
                activityStatus: 'APPROVED',
                transactionAmount: -25.00,
                description: 'Approved Transaction',
                activityDate: '2024-01-10',
              },
              {
                referenceNumber: 'REF2',
                activityStatus: 'PENDING',
                transactionAmount: -50.00,
                description: 'Pending Transaction',
                activityDate: '2024-01-11',
              },
              {
                referenceNumber: 'REF3',
                activityStatus: 'APPROVED',
                transactionAmount: -75.00,
                description: 'Another Approved Transaction',
                activityDate: '2024-01-12',
              },
            ],
          },
        }),
      });

      monarchApi.getCategoriesAndGroups.mockResolvedValue({ categories: [] });
      applyCategoryMapping.mockReturnValue('Uncategorized');
      convertTransactionsToMonarchCSV.mockReturnValue('csv,data');
      monarchApi.uploadTransactions.mockResolvedValue(true);

      await uploadRogersBankToMonarch();

      // Should only process approved transactions
      expect(convertTransactionsToMonarchCSV).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ referenceNumber: 'REF1' }),
          expect.objectContaining({ referenceNumber: 'REF3' }),
        ]),
        expect.any(String),
      );
    });

    test('should filter duplicate transactions', async () => {
      getRogersBankCredentials.mockReturnValue({
        authToken: 'test-token',
        accountId: 'test-account',
        customerId: 'test-customer',
        accountIdEncoded: 'encoded-account',
        customerIdEncoded: 'encoded-customer',
        deviceId: 'test-device',
      });

      showDatePickerWithOptionsPromise.mockResolvedValue('2024-01-01');
      calculateFromDateWithLookback.mockReturnValue('2024-01-01');
      globalThis.GM_getValue.mockImplementation((key) => {
        if (key.includes('rogersbank_account_')) {
          return JSON.stringify({ id: 'monarch123', displayName: 'Rogers Card' });
        }
        return null;
      });

      // Mock that REF1 is already uploaded
      getUploadedTransactionIds.mockReturnValue(['REF1']);

      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -1000, creditLimit: 5000, openedDate: "2023-01-01" });
      monarchApi.uploadBalance.mockResolvedValue(true);

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          activitySummary: {
            totalCount: 2,
            activities: [
              {
                referenceNumber: 'REF1', // Duplicate
                activityStatus: 'APPROVED',
                transactionAmount: -25.00,
                description: 'Duplicate Transaction',
                activityDate: '2024-01-10',
              },
              {
                referenceNumber: 'REF2', // New
                activityStatus: 'APPROVED',
                transactionAmount: -50.00,
                description: 'New Transaction',
                activityDate: '2024-01-11',
              },
            ],
          },
        }),
      });

      monarchApi.getCategoriesAndGroups.mockResolvedValue({ categories: [] });
      applyCategoryMapping.mockReturnValue('Uncategorized');
      convertTransactionsToMonarchCSV.mockReturnValue('csv,data');
      monarchApi.uploadTransactions.mockResolvedValue(true);

      const result = await uploadRogersBankToMonarch();

      expect(result.success).toBe(true);
      expect(result.message).toContain('skipped');
      expect(convertTransactionsToMonarchCSV).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ referenceNumber: 'REF2' }),
        ]),
        expect.any(String),
      );
    });

    test('should handle all transactions being duplicates', async () => {
      getRogersBankCredentials.mockReturnValue({
        authToken: 'test-token',
        accountId: 'test-account',
        customerId: 'test-customer',
        accountIdEncoded: 'encoded-account',
        customerIdEncoded: 'encoded-customer',
        deviceId: 'test-device',
      });

      showDatePickerWithOptionsPromise.mockResolvedValue('2024-01-01');
      calculateFromDateWithLookback.mockReturnValue('2024-01-01');
      globalThis.GM_getValue.mockImplementation((key) => {
        if (key.includes('rogersbank_account_')) {
          return JSON.stringify({ id: 'monarch123', displayName: 'Rogers Card' });
        }
        return null;
      });

      // Mock that both REF1 and REF2 are already uploaded
      getUploadedTransactionIds.mockReturnValue(['REF1', 'REF2']);

      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -1000, creditLimit: 5000, openedDate: "2023-01-01" });
      monarchApi.uploadBalance.mockResolvedValue(true);

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          activitySummary: {
            totalCount: 2,
            activities: [
              {
                referenceNumber: 'REF1',
                activityStatus: 'APPROVED',
                transactionAmount: -25.00,
                description: 'Duplicate Transaction 1',
                activityDate: '2024-01-10',
              },
              {
                referenceNumber: 'REF2',
                activityStatus: 'APPROVED',
                transactionAmount: -50.00,
                description: 'Duplicate Transaction 2',
                activityDate: '2024-01-11',
              },
            ],
          },
        }),
      });

      const result = await uploadRogersBankToMonarch();

      expect(result.success).toBe(true);
      expect(result.message).toContain('already uploaded');
      expect(monarchApi.uploadTransactions).not.toHaveBeenCalled();
    });
  });

  describe('uploadRogersBankToMonarch - Category Resolution', () => {
    test('should handle automatic category mapping', async () => {
      getRogersBankCredentials.mockReturnValue({
        authToken: 'test-token',
        accountId: 'test-account',
        customerId: 'test-customer',
        accountIdEncoded: 'encoded-account',
        customerIdEncoded: 'encoded-customer',
        deviceId: 'test-device',
      });

      showDatePickerWithOptionsPromise.mockResolvedValue('2024-01-01');
      calculateFromDateWithLookback.mockReturnValue('2024-01-01');
      globalThis.GM_getValue.mockReturnValue(
        JSON.stringify({ id: 'monarch123', displayName: 'Rogers Card' }),
      );

      // Explicitly mock no uploaded transactions
      getUploadedTransactionIds.mockReturnValue([]);

      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -1000, creditLimit: 5000, openedDate: "2023-01-01" });
      monarchApi.uploadBalance.mockResolvedValue(true);

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          activitySummary: {
            totalCount: 1,
            activities: [
              {
                referenceNumber: 'REF1',
                activityStatus: 'APPROVED',
                transactionAmount: -25.00,
                description: 'Restaurant Purchase',
                activityDate: '2024-01-10',
                merchant: { categoryDescription: 'Restaurants' },
              },
            ],
          },
        }),
      });

      monarchApi.getCategoriesAndGroups.mockResolvedValue({
        categories: [{ name: 'Dining' }],
      });

      // Mock automatic category mapping (returns string = automatic)
      applyCategoryMapping.mockReturnValue('Dining');

      convertTransactionsToMonarchCSV.mockReturnValue('csv,data');
      monarchApi.uploadTransactions.mockResolvedValue(true);

      const result = await uploadRogersBankToMonarch();

      expect(result.success).toBe(true);
      expect(showMonarchCategorySelector).not.toHaveBeenCalled(); // No manual selection needed
      expect(convertTransactionsToMonarchCSV).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            resolvedMonarchCategory: 'Dining',
            originalBankCategory: 'Restaurants',
          }),
        ]),
        expect.any(String),
      );
    });

    test('should handle manual category selection', async () => {
      getRogersBankCredentials.mockReturnValue({
        authToken: 'test-token',
        accountId: 'test-account',
        customerId: 'test-customer',
        accountIdEncoded: 'encoded-account',
        customerIdEncoded: 'encoded-customer',
        deviceId: 'test-device',
      });

      showDatePickerWithOptionsPromise.mockResolvedValue('2024-01-01');
      calculateFromDateWithLookback.mockReturnValue('2024-01-01');
      globalThis.GM_getValue.mockReturnValue(
        JSON.stringify({ id: 'monarch123', displayName: 'Rogers Card' }),
      );

      // Explicitly mock no uploaded transactions
      getUploadedTransactionIds.mockReturnValue([]);

      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -1000, creditLimit: 5000, openedDate: "2023-01-01" });
      monarchApi.uploadBalance.mockResolvedValue(true);

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          activitySummary: {
            totalCount: 1,
            activities: [
              {
                referenceNumber: 'REF1',
                activityStatus: 'APPROVED',
                transactionAmount: -25.00,
                description: 'Unknown Merchant',
                activityDate: '2024-01-10',
                merchant: { categoryDescription: 'Unknown Category' },
              },
            ],
          },
        }),
      });

      monarchApi.getCategoriesAndGroups.mockResolvedValue({
        categories: [{ name: 'Dining' }],
      });

      // Mock manual category mapping needed
      applyCategoryMapping.mockReturnValue({
        needsManualSelection: true,
        bankCategory: 'Unknown Category',
        suggestedCategory: 'Uncategorized',
        similarityScore: 0.1,
      });

      // Mock calculateAllCategorySimilarities to return proper data
      const calculateAllCategorySimilarities = jest.requireMock('../../src/mappers/category').calculateAllCategorySimilarities;
      calculateAllCategorySimilarities.mockReturnValue({
        topMatches: [{ category: 'Shopping', score: 0.5 }],
        allScores: [{ category: 'Shopping', score: 0.5 }],
      });

      // Mock user category selection
      showMonarchCategorySelector.mockImplementation((bankCategory, callback) => {
        callback({ id: 'cat1', name: 'Shopping' });
      });

      // After user selection, return the selected category
      applyCategoryMapping.mockReturnValueOnce({
        needsManualSelection: true,
        bankCategory: 'Unknown Category',
      }).mockReturnValue('Shopping');

      convertTransactionsToMonarchCSV.mockReturnValue('csv,data');
      monarchApi.uploadTransactions.mockResolvedValue(true);

      const result = await uploadRogersBankToMonarch();

      expect(result.success).toBe(true);
      expect(showMonarchCategorySelector).toHaveBeenCalledWith(
        'Unknown Category',
        expect.any(Function),
        expect.any(Object), // similarity data
        expect.objectContaining({
          merchant: 'Unknown Merchant',
          amount: -25.00,
        }),
      );
    });

    test('should handle category selection cancellation', async () => {
      getRogersBankCredentials.mockReturnValue({
        authToken: 'test-token',
        accountId: 'test-account',
        customerId: 'test-customer',
        accountIdEncoded: 'encoded-account',
        customerIdEncoded: 'encoded-customer',
        deviceId: 'test-device',
      });

      showDatePickerWithOptionsPromise.mockResolvedValue('2024-01-01');
      calculateFromDateWithLookback.mockReturnValue('2024-01-01');
      globalThis.GM_getValue.mockReturnValue(
        JSON.stringify({ id: 'monarch123', displayName: 'Rogers Card' }),
      );

      // Explicitly mock no uploaded transactions
      getUploadedTransactionIds.mockReturnValue([]);

      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -1000, creditLimit: 5000, openedDate: "2023-01-01" });
      monarchApi.uploadBalance.mockResolvedValue(true);

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          activitySummary: {
            totalCount: 1,
            activities: [
              {
                referenceNumber: 'REF1',
                activityStatus: 'APPROVED',
                transactionAmount: -25.00,
                description: 'Test Merchant',
                activityDate: '2024-01-10',
                merchant: { categoryDescription: 'Unknown Category' },
              },
            ],
          },
        }),
      });

      monarchApi.getCategoriesAndGroups.mockResolvedValue({ categories: [] });
      applyCategoryMapping.mockReturnValue({
        needsManualSelection: true,
        bankCategory: 'Unknown Category',
      });

      // User cancels category selection
      showMonarchCategorySelector.mockImplementation((bankCategory, callback) => {
        callback(null);
      });

      const result = await uploadRogersBankToMonarch();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Category selection cancelled');
    });
  });

  describe('uploadRogersBankToMonarch - Fetch API Integration', () => {
    test('should handle API fetch failure', async () => {
      getRogersBankCredentials.mockReturnValue({
        authToken: 'test-token',
        accountId: 'test-account',
        customerId: 'test-customer',
        accountIdEncoded: 'encoded-account',
        customerIdEncoded: 'encoded-customer',
        deviceId: 'test-device',
      });

      showDatePickerWithOptionsPromise.mockResolvedValue('2024-01-01');
      calculateFromDateWithLookback.mockReturnValue('2024-01-01');
      globalThis.GM_getValue.mockReturnValue(
        JSON.stringify({ id: 'monarch123', displayName: 'Rogers Card' }),
      );

      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -1000, creditLimit: 5000, openedDate: "2023-01-01" });
      monarchApi.uploadBalance.mockResolvedValue(true);

      // Mock API failure
      global.fetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      const result = await uploadRogersBankToMonarch();

      expect(result.success).toBe(false);
      expect(result.message).toContain('API request failed: 401 Unauthorized');
    });

    test('should handle invalid API response', async () => {
      getRogersBankCredentials.mockReturnValue({
        authToken: 'test-token',
        accountId: 'test-account',
        customerId: 'test-customer',
        accountIdEncoded: 'encoded-account',
        customerIdEncoded: 'encoded-customer',
        deviceId: 'test-device',
      });

      showDatePickerWithOptionsPromise.mockResolvedValue('2024-01-01');
      calculateFromDateWithLookback.mockReturnValue('2024-01-01');
      globalThis.GM_getValue.mockReturnValue(
        JSON.stringify({ id: 'monarch123', displayName: 'Rogers Card' }),
      );

      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -1000, creditLimit: 5000, openedDate: "2023-01-01" });
      monarchApi.uploadBalance.mockResolvedValue(true);

      // Mock invalid response structure
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({}), // Missing activitySummary
      });

      const result = await uploadRogersBankToMonarch();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid API response: missing activitySummary');
    });

    test('should handle network errors during API requests', async () => {
      getRogersBankCredentials.mockReturnValue({
        authToken: 'test-token',
        accountId: 'test-account',
        customerId: 'test-customer',
        accountIdEncoded: 'encoded-account',
        customerIdEncoded: 'encoded-customer',
        deviceId: 'test-device',
      });

      showDatePickerWithOptionsPromise.mockResolvedValue('2024-01-01');
      calculateFromDateWithLookback.mockReturnValue('2024-01-01');
      globalThis.GM_getValue.mockReturnValue(
        JSON.stringify({ id: 'monarch123', displayName: 'Rogers Card' }),
      );

      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -1000, creditLimit: 5000, openedDate: "2023-01-01" });
      monarchApi.uploadBalance.mockResolvedValue(true);

      // Mock network error
      global.fetch.mockRejectedValue(new Error('Network error'));

      const result = await uploadRogersBankToMonarch();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Network error');
      expect(toast.show).toHaveBeenCalledWith(
        expect.stringContaining('Network error'),
        'error',
      );
    });

    test('should handle malformed JSON response', async () => {
      getRogersBankCredentials.mockReturnValue({
        authToken: 'test-token',
        accountId: 'test-account',
        customerId: 'test-customer',
        accountIdEncoded: 'encoded-account',
        customerIdEncoded: 'encoded-customer',
        deviceId: 'test-device',
      });

      showDatePickerWithOptionsPromise.mockResolvedValue('2024-01-01');
      calculateFromDateWithLookback.mockReturnValue('2024-01-01');
      globalThis.GM_getValue.mockReturnValue(
        JSON.stringify({ id: 'monarch123', displayName: 'Rogers Card' }),
      );

      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -1000, creditLimit: 5000, openedDate: "2023-01-01" });
      monarchApi.uploadBalance.mockResolvedValue(true);

      // Mock response with invalid JSON
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error('Unexpected end of JSON input');
        },
      });

      const result = await uploadRogersBankToMonarch();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Unexpected end of JSON input');
    });
  });

  describe('uploadRogersBankToMonarch - Progress Dialog Integration', () => {
    test('should update progress dialog during upload', async () => {
      const mockProgressDialog = {
        updateProgress: jest.fn(),
        hideCancel: jest.fn(),
        showSummary: jest.fn(),
        onCancel: jest.fn(),
        initSteps: jest.fn(),
        updateStepStatus: jest.fn(),
        updateBalanceChange: jest.fn(),
      };

      showProgressDialog.mockReturnValueOnce(mockProgressDialog);

      getRogersBankCredentials.mockReturnValue({
        authToken: 'test-token',
        accountId: 'test-account',
        customerId: 'test-customer',
        accountIdEncoded: 'encoded-account',
        customerIdEncoded: 'encoded-customer',
        deviceId: 'test-device',
      });

      showDatePickerWithOptionsPromise.mockResolvedValue('2024-01-01');
      calculateFromDateWithLookback.mockReturnValue('2024-01-01');
      globalThis.GM_getValue.mockReturnValue(
        JSON.stringify({ id: 'monarch123', displayName: 'Rogers Card' }),
      );

      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -1500, creditLimit: 5000, openedDate: "2023-01-01" });
      monarchApi.uploadBalance.mockResolvedValue(true);

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          activitySummary: {
            totalCount: 2,
            activities: [
              {
                referenceNumber: 'REF1',
                activityStatus: 'APPROVED',
                transactionAmount: -25.00,
                description: 'Test Merchant 1',
                activityDate: '2024-01-10',
                merchant: { categoryDescription: 'Restaurants' },
              },
              {
                referenceNumber: 'REF2',
                activityStatus: 'APPROVED',
                transactionAmount: -50.00,
                description: 'Test Merchant 2',
                activityDate: '2024-01-11',
                merchant: { categoryDescription: 'Gas Stations' },
              },
            ],
          },
        }),
      });

      monarchApi.getCategoriesAndGroups.mockResolvedValue({ categories: [] });
      applyCategoryMapping.mockReturnValue('Uncategorized');
      convertTransactionsToMonarchCSV.mockReturnValue('csv,data');
      monarchApi.uploadTransactions.mockResolvedValue(true);

      await uploadRogersBankToMonarch();

      expect(mockProgressDialog.updateProgress).toHaveBeenCalled();
      expect(mockProgressDialog.showSummary).toHaveBeenCalledWith({ success: 1, failed: 0, total: 1 });
    });

    test('should handle progress dialog cancellation', async () => {
      const mockProgressDialog = {
        updateProgress: jest.fn(),
        hideCancel: jest.fn(),
        showSummary: jest.fn(),
        onCancel: jest.fn(),
        initSteps: jest.fn(),
        updateStepStatus: jest.fn(),
        updateBalanceChange: jest.fn(),
      };

      showProgressDialog.mockReturnValueOnce(mockProgressDialog);

      getRogersBankCredentials.mockReturnValue({
        authToken: 'test-token',
        accountId: 'test-account',
        customerId: 'test-customer',
        accountIdEncoded: 'encoded-account',
        customerIdEncoded: 'encoded-customer',
        deviceId: 'test-device',
      });

      showDatePickerWithOptionsPromise.mockResolvedValue('2024-01-01');
      calculateFromDateWithLookback.mockReturnValue('2024-01-01');
      globalThis.GM_getValue.mockReturnValue(
        JSON.stringify({ id: 'monarch123', displayName: 'Rogers Card' }),
      );

      // Simulate cancellation during processing
      let cancelCallback;
      mockProgressDialog.onCancel.mockImplementation((callback) => {
        cancelCallback = callback;
      });

      fetchRogersBankAccountDetails.mockImplementation(() => {
        // Trigger cancellation during balance fetch
        if (cancelCallback) cancelCallback();
        return Promise.resolve(-1500);
      });

      const result = await uploadRogersBankToMonarch();

      expect(result.success).toBe(false);
      expect(result.message).toBe('Upload cancelled by user');
    });
  });

  describe('uploadRogersBankToMonarch - Edge Cases', () => {
    test('should handle empty transaction list', async () => {
      getRogersBankCredentials.mockReturnValue({
        authToken: 'test-token',
        accountId: 'test-account',
        customerId: 'test-customer',
        accountIdEncoded: 'encoded-account',
        customerIdEncoded: 'encoded-customer',
        deviceId: 'test-device',
      });

      showDatePickerWithOptionsPromise.mockResolvedValue('2024-01-01');
      calculateFromDateWithLookback.mockReturnValue('2024-01-01');
      globalThis.GM_getValue.mockReturnValue(
        JSON.stringify({ id: 'monarch123', displayName: 'Rogers Card' }),
      );

      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -1500, creditLimit: 5000, openedDate: "2023-01-01" });
      monarchApi.uploadBalance.mockResolvedValue(true);

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          activitySummary: {
            totalCount: 0,
            activities: [],
          },
        }),
      });

      const result = await uploadRogersBankToMonarch();

      expect(result.success).toBe(true);
      expect(result.message).toContain('Balance uploaded successfully');
      expect(result.message).toContain('No transactions found');
    });

    test('should handle missing merchant category', async () => {
      getRogersBankCredentials.mockReturnValue({
        authToken: 'test-token',
        accountId: 'test-account',
        customerId: 'test-customer',
        accountIdEncoded: 'encoded-account',
        customerIdEncoded: 'encoded-customer',
        deviceId: 'test-device',
      });

      showDatePickerWithOptionsPromise.mockResolvedValue('2024-01-01');
      calculateFromDateWithLookback.mockReturnValue('2024-01-01');
      globalThis.GM_getValue.mockReturnValue(
        JSON.stringify({ id: 'monarch123', displayName: 'Rogers Card' }),
      );

      // Explicitly mock no uploaded transactions
      getUploadedTransactionIds.mockReturnValue([]);

      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -1000, creditLimit: 5000, openedDate: "2023-01-01" });
      monarchApi.uploadBalance.mockResolvedValue(true);

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          activitySummary: {
            totalCount: 1,
            activities: [
              {
                referenceNumber: 'REF1',
                activityStatus: 'APPROVED',
                transactionAmount: -25.00,
                description: 'Test Merchant',
                activityDate: '2024-01-10',
                // Missing merchant property
              },
            ],
          },
        }),
      });

      monarchApi.getCategoriesAndGroups.mockResolvedValue({ categories: [] });
      applyCategoryMapping.mockReturnValue('Uncategorized');
      convertTransactionsToMonarchCSV.mockReturnValue('csv,data');
      monarchApi.uploadTransactions.mockResolvedValue(true);

      const result = await uploadRogersBankToMonarch();

      expect(result.success).toBe(true);
      expect(applyCategoryMapping).toHaveBeenCalledWith(
        'Uncategorized', // Should default to 'Uncategorized' when merchant is missing
        expect.any(Array),
      );
    });

    test('should handle monarch upload failure', async () => {
      getRogersBankCredentials.mockReturnValue({
        authToken: 'test-token',
        accountId: 'test-account',
        customerId: 'test-customer',
        accountIdEncoded: 'encoded-account',
        customerIdEncoded: 'encoded-customer',
        deviceId: 'test-device',
      });

      showDatePickerWithOptionsPromise.mockResolvedValue('2024-01-01');
      calculateFromDateWithLookback.mockReturnValue('2024-01-01');
      globalThis.GM_getValue.mockReturnValue(
        JSON.stringify({ id: 'monarch123', displayName: 'Rogers Card' }),
      );

      // Explicitly mock no uploaded transactions
      getUploadedTransactionIds.mockReturnValue([]);

      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -1000, creditLimit: 5000, openedDate: "2023-01-01" });
      monarchApi.uploadBalance.mockResolvedValue(true);

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          activitySummary: {
            totalCount: 1,
            activities: [
              {
                referenceNumber: 'REF1',
                activityStatus: 'APPROVED',
                transactionAmount: -25.00,
                description: 'Test Merchant',
                activityDate: '2024-01-10',
                merchant: { categoryDescription: 'Restaurants' },
              },
            ],
          },
        }),
      });

      monarchApi.getCategoriesAndGroups.mockResolvedValue({ categories: [] });
      applyCategoryMapping.mockReturnValue('Uncategorized');
      convertTransactionsToMonarchCSV.mockReturnValue('csv,data');

      // Mock monarch upload failure
      monarchApi.uploadTransactions.mockRejectedValue(new Error('Monarch upload failed'));

      const result = await uploadRogersBankToMonarch();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Monarch upload failed');
      expect(toast.show).toHaveBeenCalledWith(
        expect.stringContaining('Monarch upload failed'),
        'error',
      );
    });

    test('should handle large transaction volumes efficiently', async () => {
      getRogersBankCredentials.mockReturnValue({
        authToken: 'test-token',
        accountId: 'test-account',
        customerId: 'test-customer',
        accountIdEncoded: 'encoded-account',
        customerIdEncoded: 'encoded-customer',
        deviceId: 'test-device',
      });

      showDatePickerWithOptionsPromise.mockResolvedValue('2024-01-01');
      calculateFromDateWithLookback.mockReturnValue('2024-01-01');
      globalThis.GM_getValue.mockReturnValue(
        JSON.stringify({ id: 'monarch123', displayName: 'Rogers Card' }),
      );

      // Explicitly mock no uploaded transactions
      getUploadedTransactionIds.mockReturnValue([]);

      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -1000, creditLimit: 5000, openedDate: "2023-01-01" });
      monarchApi.uploadBalance.mockResolvedValue(true);

      // Generate 100 transactions
      const manyTransactions = Array.from({ length: 100 }, (_, i) => ({
        referenceNumber: `REF${i + 1}`,
        activityStatus: 'APPROVED',
        transactionAmount: -Math.round((Math.random() * 100) * 100) / 100,
        description: `Test Merchant ${i + 1}`,
        activityDate: '2024-01-10',
        merchant: { categoryDescription: 'Restaurants' },
      }));

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          activitySummary: {
            totalCount: 100,
            activities: manyTransactions,
          },
        }),
      });

      monarchApi.getCategoriesAndGroups.mockResolvedValue({ categories: [] });
      applyCategoryMapping.mockReturnValue('Uncategorized');
      convertTransactionsToMonarchCSV.mockReturnValue('csv,data');
      monarchApi.uploadTransactions.mockResolvedValue(true);

      const result = await uploadRogersBankToMonarch();

      expect(result.success).toBe(true);
      expect(result.message).toContain('100 uploaded');
      expect(convertTransactionsToMonarchCSV).toHaveBeenCalledWith(
        expect.arrayContaining(
          manyTransactions.map((tx) => expect.objectContaining({
            referenceNumber: tx.referenceNumber,
          })),
        ),
        expect.any(String),
      );
    });
  });

  describe('uploadRogersBankToMonarch - Data Storage', () => {
    test('should save uploaded transaction references', async () => {
      getRogersBankCredentials.mockReturnValue({
        authToken: 'test-token',
        accountId: 'test-account',
        customerId: 'test-customer',
        accountIdEncoded: 'encoded-account',
        customerIdEncoded: 'encoded-customer',
        deviceId: 'test-device',
      });

      showDatePickerWithOptionsPromise.mockResolvedValue('2024-01-01');
      calculateFromDateWithLookback.mockReturnValue('2024-01-01');
      globalThis.GM_getValue.mockReturnValue(
        JSON.stringify({ id: 'monarch123', displayName: 'Rogers Card' }),
      );

      // Explicitly mock no uploaded transactions
      getUploadedTransactionIds.mockReturnValue([]);

      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -1000, creditLimit: 5000, openedDate: "2023-01-01" });
      monarchApi.uploadBalance.mockResolvedValue(true);

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          activitySummary: {
            totalCount: 2,
            activities: [
              {
                referenceNumber: 'REF1',
                activityStatus: 'APPROVED',
                transactionAmount: -25.00,
                description: 'Test Merchant 1',
                activityDate: '2024-01-10',
                merchant: { categoryDescription: 'Restaurants' },
              },
              {
                referenceNumber: 'REF2',
                activityStatus: 'APPROVED',
                transactionAmount: -50.00,
                description: 'Test Merchant 2',
                activityDate: '2024-01-11',
                merchant: { categoryDescription: 'Gas Stations' },
              },
            ],
          },
        }),
      });

      monarchApi.getCategoriesAndGroups.mockResolvedValue({ categories: [] });
      applyCategoryMapping.mockReturnValue('Uncategorized');
      convertTransactionsToMonarchCSV.mockReturnValue('csv,data');
      monarchApi.uploadTransactions.mockResolvedValue(true);

      await uploadRogersBankToMonarch();

      // Verify saveUploadedTransactions was called with the new API
      expect(saveUploadedTransactions).toHaveBeenCalledWith(
        'test-account',
        ['REF1', 'REF2'],
        'rogersbank',
        expect.any(String), // transaction date
      );
      expect(saveLastUploadDate).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
      );
    });

    test('should preserve existing uploaded references', async () => {
      getRogersBankCredentials.mockReturnValue({
        authToken: 'test-token',
        accountId: 'test-account',
        customerId: 'test-customer',
        accountIdEncoded: 'encoded-account',
        customerIdEncoded: 'encoded-customer',
        deviceId: 'test-device',
      });

      showDatePickerWithOptionsPromise.mockResolvedValue('2024-01-01');
      calculateFromDateWithLookback.mockReturnValue('2024-01-01');

      // Mock existing references and account mapping
      globalThis.GM_getValue.mockImplementation((key) => {
        if (key.includes('rogersbank_account_')) {
          return JSON.stringify({ id: 'monarch123', displayName: 'Rogers Card' });
        }
        return null;
      });

      // Mock existing uploaded transactions
      getUploadedTransactionIds.mockReturnValue(['OLD_REF1', 'OLD_REF2']);

      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -1000, creditLimit: 5000, openedDate: "2023-01-01" });
      monarchApi.uploadBalance.mockResolvedValue(true);

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          activitySummary: {
            totalCount: 1,
            activities: [
              {
                referenceNumber: 'NEW_REF1',
                activityStatus: 'APPROVED',
                transactionAmount: -25.00,
                description: 'New Transaction',
                activityDate: '2024-01-10',
                merchant: { categoryDescription: 'Restaurants' },
              },
            ],
          },
        }),
      });

      monarchApi.getCategoriesAndGroups.mockResolvedValue({ categories: [] });
      applyCategoryMapping.mockReturnValue('Uncategorized');
      convertTransactionsToMonarchCSV.mockReturnValue('csv,data');
      monarchApi.uploadTransactions.mockResolvedValue(true);

      await uploadRogersBankToMonarch();

      // Verify saveUploadedTransactions was called with the new transaction
      expect(saveUploadedTransactions).toHaveBeenCalledWith(
        'test-account',
        ['NEW_REF1'],
        'rogersbank',
        expect.any(String), // transaction date
      );
    });
  });
});
