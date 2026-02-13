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
    ROGERSBANK_STORE_TX_DETAILS_IN_NOTES: 'rogersbank_store_tx_details_in_notes',
    ROGERSBANK_ACCOUNTS_LIST: 'rogersbank_accounts_list',
  },
  LOGO_CLOUDINARY_IDS: {
    ROGERS: 'production/account_logos/rogers',
  },
  TRANSACTION_RETENTION_DEFAULTS: {
    DAYS: 91,
    COUNT: 1000,
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
  convertTransactionsToMonarchCSV: jest.fn(() => 'csv,data'),
}));

jest.mock('../../src/mappers/category', () => ({
  applyCategoryMapping: jest.fn(),
  saveUserCategorySelection: jest.fn(),
  calculateAllCategorySimilarities: jest.fn(),
}));

jest.mock('../../src/utils/transactionStorage', () => ({
  getTransactionIdsFromArray: jest.fn(() => new Set()),
  mergeAndRetainTransactions: jest.fn((existing, newRefs) => [...(existing || []), ...newRefs]),
  getRetentionSettingsFromAccount: jest.fn(() => ({ retentionDays: 91, retentionCount: 1000 })),
}));

jest.mock('../../src/ui/components/categorySelector', () => ({
  showMonarchCategorySelector: jest.fn(),
}));

jest.mock('../../src/services/common/accountService', () => ({
  __esModule: true,
  default: {
    getMonarchAccountMapping: jest.fn(),
    upsertAccount: jest.fn(),
    getAccountData: jest.fn(),
    updateAccountInList: jest.fn(),
    incrementSyncCount: jest.fn(),
    isReadyForLegacyCleanup: jest.fn(),
    cleanupLegacyStorage: jest.fn(),
  },
}));

jest.mock('../../src/core/integrationCapabilities', () => ({
  INTEGRATIONS: {
    ROGERSBANK: 'rogersbank',
    WEALTHSIMPLE: 'wealthsimple',
    QUESTRADE: 'questrade',
    CANADALIFE: 'canadalife',
  },
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
  let accountServiceMock;

  beforeEach(() => {
    jest.clearAllMocks();

    // Get all the mocked modules
    const rogersbankMock = jest.requireMock('../../src/api/rogersbank');
    getRogersBankCredentials = rogersbankMock.getRogersBankCredentials;
    fetchRogersBankAccountDetails = rogersbankMock.fetchRogersBankAccountDetails;

    monarchApi = jest.requireMock('../../src/api/monarch').default;

    // Default: validateAndRefreshAccountMapping returns valid existing account (not newlyCreated)
    monarchApi.validateAndRefreshAccountMapping.mockResolvedValue({
      valid: true,
      account: { id: 'monarch123', displayName: 'Rogers Card' },
    });

    // Default: accountService returns valid account mapping
    accountServiceMock = jest.requireMock('../../src/services/common/accountService').default;
    accountServiceMock.getMonarchAccountMapping.mockReturnValue({ id: 'monarch123', displayName: 'Rogers Card' });
    accountServiceMock.getAccountData.mockReturnValue({ lastSyncedCreditLimit: null, balanceCheckpoint: null, uploadedTransactions: [] });
    accountServiceMock.upsertAccount.mockReturnValue(true);
    accountServiceMock.updateAccountInList.mockReturnValue(true);
    accountServiceMock.incrementSyncCount.mockReturnValue(1);
    accountServiceMock.isReadyForLegacyCleanup.mockReturnValue(false);
    accountServiceMock.cleanupLegacyStorage.mockReturnValue({ cleaned: false, keysDeleted: 0, keys: [] });
    toast = jest.requireMock('../../src/ui/toast').default;
    showDatePickerWithOptionsPromise = jest.requireMock('../../src/ui/components/datePicker').showDatePickerWithOptionsPromise;
    showMonarchAccountSelectorWithCreate = jest.requireMock('../../src/ui/components/accountSelectorWithCreate').showMonarchAccountSelectorWithCreate;
    showProgressDialog = jest.requireMock('../../src/ui/components/progressDialog').showProgressDialog;
    convertTransactionsToMonarchCSV = jest.requireMock('../../src/utils/csv').convertTransactionsToMonarchCSV;
    applyCategoryMapping = jest.requireMock('../../src/mappers/category').applyCategoryMapping;
    showMonarchCategorySelector = jest.requireMock('../../src/ui/components/categorySelector').showMonarchCategorySelector;
    calculateFromDateWithLookback = jest.requireMock('../../src/core/utils').calculateFromDateWithLookback;
    saveLastUploadDate = jest.requireMock('../../src/core/utils').saveLastUploadDate;

    // Reset getTransactionIdsFromArray to return empty Set by default
    const transactionStorageMock = jest.requireMock('../../src/utils/transactionStorage');
    transactionStorageMock.getTransactionIdsFromArray.mockReturnValue(new Set());

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

      // First sync - no last upload date
      globalThis.GM_getValue.mockReturnValue(null);

      // Mock account details fetch
      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -1000, creditLimit: 5000, openedDate: '2023-01-01' });

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

      // Mock account details fetch
      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -1000, creditLimit: 5000, openedDate: '2023-01-01' });

      showDatePickerWithOptionsPromise.mockResolvedValue({ date: '2024-01-01', reconstructBalance: false });
      calculateFromDateWithLookback.mockReturnValue('2024-01-01');
      globalThis.GM_getValue.mockReturnValue(null); // No saved mapping

      // Mock no account mapping to trigger account listing
      const accountServiceMock = jest.requireMock('../../src/services/common/accountService').default;
      accountServiceMock.getMonarchAccountMapping.mockReturnValue(null);

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

      // Mock account details fetch
      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -1000, creditLimit: 5000, openedDate: '2023-01-01' });

      showDatePickerWithOptionsPromise.mockResolvedValue({ date: '2024-01-01', reconstructBalance: false });
      calculateFromDateWithLookback.mockReturnValue('2024-01-01');
      globalThis.GM_getValue.mockReturnValue(null); // No saved mapping

      // Mock no account mapping to trigger account selector
      const accountServiceMock = jest.requireMock('../../src/services/common/accountService').default;
      accountServiceMock.getMonarchAccountMapping.mockReturnValue(null);

      monarchApi.listAccounts.mockResolvedValue([
        { id: 'monarch123', displayName: 'Test Credit Card' },
      ]);

      // User cancels account selection
      showMonarchAccountSelectorWithCreate.mockImplementation((accounts, callback) => {
        callback(null);
      });

      const result = await uploadRogersBankToMonarch();

      expect(result.success).toBe(false);
      expect(result.message).toBe('Account selection cancelled');
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

      // Not first sync - has previous upload date
      calculateFromDateWithLookback.mockReturnValue('2024-01-01');

      // Mock existing account mapping with last upload date
      globalThis.GM_getValue.mockImplementation((key) => {
        if (key.includes('rogersbank_account_')) {
          return JSON.stringify({ id: 'monarch123', displayName: 'Rogers Card' });
        }
        if (key.includes('rogersbank_last_upload_date_')) {
          return '2024-01-01'; // Has previous sync
        }
        return null;
      });

      // Mock successful balance fetch
      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -1500.50, creditLimit: 5000, openedDate: '2023-01-01' });
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
      expect(result.message).toContain('Balance uploaded');
      expect(result.message).toContain('No transactions found');
      expect(fetchRogersBankAccountDetails).toHaveBeenCalled();
      expect(monarchApi.uploadBalance).toHaveBeenCalledWith(
        'monarch123',
        expect.stringContaining('-1500.5'),
        '2024-01-15',
        '2024-01-15',
      );
    });

    test('should handle balance upload failure but continue with transactions', async () => {
      // Setup for transaction upload
      getRogersBankCredentials.mockReturnValue({
        authToken: 'test-token',
        accountId: 'test-account',
        customerId: 'test-customer',
        accountIdEncoded: 'encoded-account',
        customerIdEncoded: 'encoded-customer',
        deviceId: 'test-device',
      });

      // Not first sync
      calculateFromDateWithLookback.mockReturnValue('2024-01-01');
      globalThis.GM_getValue.mockImplementation((key) => {
        if (key.includes('rogersbank_account_')) {
          return JSON.stringify({ id: 'monarch123', displayName: 'Rogers Card' });
        }
        if (key.includes('rogersbank_last_upload_date_')) {
          return '2024-01-01'; // Has previous sync
        }
        return null;
      });

      // Mock balance fetch success but upload failure
      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -1000, creditLimit: 5000, openedDate: '2023-01-01' });
      monarchApi.uploadBalance.mockResolvedValue(false); // Balance upload fails

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

      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -1000, creditLimit: 5000, openedDate: '2023-01-01' });
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
        expect.any(Object), // options parameter
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

      // Mock that REF1 is already uploaded (via consolidated storage)
      const transactionStorageMock = jest.requireMock('../../src/utils/transactionStorage');
      transactionStorageMock.getTransactionIdsFromArray.mockReturnValue(new Set(['REF1']));

      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -1000, creditLimit: 5000, openedDate: '2023-01-01' });
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
        expect.any(Object), // options parameter
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

      // Mock that both REF1 and REF2 are already uploaded (via consolidated storage)
      const transactionStorageMock = jest.requireMock('../../src/utils/transactionStorage');
      transactionStorageMock.getTransactionIdsFromArray.mockReturnValue(new Set(['REF1', 'REF2']));

      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -1000, creditLimit: 5000, openedDate: '2023-01-01' });
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

      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -1000, creditLimit: 5000, openedDate: '2023-01-01' });
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
        expect.any(Object), // options parameter
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

      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -1000, creditLimit: 5000, openedDate: '2023-01-01' });
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

      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -1000, creditLimit: 5000, openedDate: '2023-01-01' });
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

      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -1000, creditLimit: 5000, openedDate: '2023-01-01' });
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

      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -1000, creditLimit: 5000, openedDate: '2023-01-01' });
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

    test('should use fullHistory=true for first sync (fetches only once)', async () => {
      getRogersBankCredentials.mockReturnValue({
        authToken: 'test-token',
        accountId: 'test-account',
        customerId: 'test-customer',
        accountIdEncoded: 'encoded-account',
        customerIdEncoded: 'encoded-customer',
        deviceId: 'test-device',
      });

      // First sync - no last upload date
      globalThis.GM_getValue.mockImplementation((key) => {
        if (key.includes('rogersbank_account_')) {
          return JSON.stringify({ id: 'monarch123', displayName: 'Rogers Card' });
        }
        if (key.includes('rogersbank_last_upload_date_')) {
          return null; // First sync
        }
        return null;
      });

      // User selects reconstruct balance
      showDatePickerWithOptionsPromise.mockResolvedValue({
        date: '2023-01-01',
        reconstructBalance: true,
      });

      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -500, creditLimit: 5000, openedDate: '2023-01-01' });
      monarchApi.uploadBalance.mockResolvedValue(true);

      // Track ALL URLs called to verify:
      // 1. Only ONE fetch call is made
      // 2. It uses offset=20 for first sync
      const capturedUrls = [];
      global.fetch.mockImplementation((url) => {
        capturedUrls.push(url);
        return Promise.resolve({
          ok: true,
          json: async () => ({
            activitySummary: {
              totalCount: 100,
              activities: [
                {
                  referenceNumber: 'REF1',
                  activityStatus: 'APPROVED',
                  transactionAmount: -50.00,
                  description: 'Test',
                  activityDate: '2024-01-10',
                },
              ],
            },
          }),
        });
      });

      monarchApi.getCategoriesAndGroups.mockResolvedValue({ categories: [] });
      applyCategoryMapping.mockReturnValue('Uncategorized');
      convertTransactionsToMonarchCSV.mockReturnValue('csv,data');
      monarchApi.uploadTransactions.mockResolvedValue(true);

      await uploadRogersBankToMonarch();

      // Should only fetch once (not twice!)
      expect(capturedUrls.length).toBe(1);
      // First sync should use offset=20
      expect(capturedUrls[0]).toContain('offset=20');
    });

    test('should warn when transaction history is truncated during balance reconstruction', async () => {
      getRogersBankCredentials.mockReturnValue({
        authToken: 'test-token',
        accountId: 'test-account',
        customerId: 'test-customer',
        accountIdEncoded: 'encoded-account',
        customerIdEncoded: 'encoded-customer',
        deviceId: 'test-device',
      });

      // First sync - no last upload date
      globalThis.GM_getValue.mockImplementation((key) => {
        if (key.includes('rogersbank_account_')) {
          return JSON.stringify({ id: 'monarch123', displayName: 'Rogers Card' });
        }
        if (key.includes('rogersbank_last_upload_date_')) {
          return null; // First sync
        }
        return null;
      });

      // User selects reconstruct balance
      showDatePickerWithOptionsPromise.mockResolvedValue({
        date: '2020-01-01',
        reconstructBalance: true,
      });

      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -500, creditLimit: 5000, openedDate: '2020-01-01' });
      monarchApi.uploadBalance.mockResolvedValue(true);

      // Return exactly 1000 transactions to trigger truncation warning
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          activitySummary: {
            totalCount: 1000, // API limit hit
            activities: Array.from({ length: 1000 }, (_, i) => ({
              referenceNumber: `REF${i}`,
              activityStatus: 'APPROVED',
              transactionAmount: -10.00,
              description: `Transaction ${i}`,
              activityDate: '2024-01-10',
            })),
          },
        }),
      });

      monarchApi.getCategoriesAndGroups.mockResolvedValue({ categories: [] });
      applyCategoryMapping.mockReturnValue('Uncategorized');
      convertTransactionsToMonarchCSV.mockReturnValue('csv,data');
      monarchApi.uploadTransactions.mockResolvedValue(true);

      await uploadRogersBankToMonarch();

      // Should show warning about truncated history
      expect(toast.show).toHaveBeenCalledWith(
        expect.stringContaining('Transaction history may be incomplete'),
        'warning',
      );
    });

    test('should use offset=20 for regular transaction sync (consistent with first sync)', async () => {
      getRogersBankCredentials.mockReturnValue({
        authToken: 'test-token',
        accountId: 'test-account',
        customerId: 'test-customer',
        accountIdEncoded: 'encoded-account',
        customerIdEncoded: 'encoded-customer',
        deviceId: 'test-device',
      });

      // Not first sync - has previous upload date
      calculateFromDateWithLookback.mockReturnValue('2024-01-01');
      globalThis.GM_getValue.mockImplementation((key) => {
        if (key.includes('rogersbank_account_')) {
          return JSON.stringify({ id: 'monarch123', displayName: 'Rogers Card' });
        }
        if (key.includes('rogersbank_last_upload_date_')) {
          return '2024-01-01'; // Has previous sync
        }
        return null;
      });

      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -500, creditLimit: 5000, openedDate: '2023-01-01' });
      monarchApi.uploadBalance.mockResolvedValue(true);

      // Track the URL called to verify offset=20 for regular sync
      let capturedUrl = null;
      global.fetch.mockImplementation((url) => {
        capturedUrl = url;
        return Promise.resolve({
          ok: true,
          json: async () => ({
            activitySummary: {
              totalCount: 10,
              activities: [
                {
                  referenceNumber: 'REF1',
                  activityStatus: 'APPROVED',
                  transactionAmount: -50.00,
                  description: 'Test',
                  activityDate: '2024-01-10',
                },
              ],
            },
          }),
        });
      });

      monarchApi.getCategoriesAndGroups.mockResolvedValue({ categories: [] });
      applyCategoryMapping.mockReturnValue('Uncategorized');
      convertTransactionsToMonarchCSV.mockReturnValue('csv,data');
      monarchApi.uploadTransactions.mockResolvedValue(true);

      await uploadRogersBankToMonarch();

      // Regular sync uses offset=20 (same as first sync)
      expect(capturedUrl).toContain('offset=20');
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

      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -1000, creditLimit: 5000, openedDate: '2023-01-01' });
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

      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -1000, creditLimit: 5000, openedDate: '2023-01-01' });
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

      // Not first sync
      calculateFromDateWithLookback.mockReturnValue('2024-01-01');
      globalThis.GM_getValue.mockImplementation((key) => {
        if (key.includes('rogersbank_account_')) {
          return JSON.stringify({ id: 'monarch123', displayName: 'Rogers Card' });
        }
        if (key.includes('rogersbank_last_upload_date_')) {
          return '2024-01-01'; // Has previous sync
        }
        return null;
      });

      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -1500, creditLimit: 5000, openedDate: '2023-01-01' });
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

      expect(mockProgressDialog.updateStepStatus).toHaveBeenCalled();
      expect(mockProgressDialog.showSummary).toHaveBeenCalledWith({ success: 1, failed: 0, total: 1 });
    });

    test('should handle progress dialog cancellation', async () => {
      // This test verifies that the progress dialog has a cancel callback registered
      // The actual cancellation behavior depends on the abort controller
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

      // Not first sync
      calculateFromDateWithLookback.mockReturnValue('2024-01-01');
      globalThis.GM_getValue.mockImplementation((key) => {
        if (key.includes('rogersbank_account_')) {
          return JSON.stringify({ id: 'monarch123', displayName: 'Rogers Card' });
        }
        if (key.includes('rogersbank_last_upload_date_')) {
          return '2024-01-01'; // Has previous sync
        }
        return null;
      });

      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -1500, creditLimit: 5000, openedDate: '2023-01-01' });
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

      await uploadRogersBankToMonarch();

      // Verify that onCancel was registered with a callback
      expect(mockProgressDialog.onCancel).toHaveBeenCalledWith(expect.any(Function));
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

      // Not first sync
      calculateFromDateWithLookback.mockReturnValue('2024-01-01');
      globalThis.GM_getValue.mockImplementation((key) => {
        if (key.includes('rogersbank_account_')) {
          return JSON.stringify({ id: 'monarch123', displayName: 'Rogers Card' });
        }
        if (key.includes('rogersbank_last_upload_date_')) {
          return '2024-01-01'; // Has previous sync
        }
        return null;
      });

      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -1500, creditLimit: 5000, openedDate: '2023-01-01' });
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
      expect(result.message).toContain('Balance uploaded');
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

      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -1000, creditLimit: 5000, openedDate: '2023-01-01' });
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

      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -1000, creditLimit: 5000, openedDate: '2023-01-01' });
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

      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -1000, creditLimit: 5000, openedDate: '2023-01-01' });
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
        expect.any(Object), // options parameter
      );
    });
  });

  describe('uploadRogersBankToMonarch - invertBalance Setting', () => {
    test('should read invertBalance from saved account settings', async () => {
      getRogersBankCredentials.mockReturnValue({
        authToken: 'test-token',
        accountId: 'test-account',
        customerId: 'test-customer',
        accountIdEncoded: 'encoded-account',
        customerIdEncoded: 'encoded-customer',
        deviceId: 'test-device',
      });

      // Has previous sync (not first sync)
      globalThis.GM_getValue.mockImplementation((key) => {
        if (key.includes('rogersbank_last_upload_date_')) {
          return '2024-01-01';
        }
        return null;
      });

      calculateFromDateWithLookback.mockReturnValue('2024-01-01');

      // Mock existing account mapping
      accountServiceMock.getMonarchAccountMapping.mockReturnValue({ id: 'monarch123', displayName: 'Rogers Card' });

      // Mock account data WITH invertBalance setting explicitly set to true
      accountServiceMock.getAccountData.mockReturnValue({
        invertBalance: true,
        uploadedTransactions: [],
      });

      fetchRogersBankAccountDetails.mockResolvedValue({
        balance: -1500.50,
        creditLimit: 5000,
        openedDate: '2023-01-01',
      });

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

      await uploadRogersBankToMonarch();

      // Verify uploadBalance was called with INVERTED (positive) balance
      expect(monarchApi.uploadBalance).toHaveBeenCalledWith(
        'monarch123',
        expect.stringContaining('1500.5'), // Positive value (inverted from -1500.50)
        expect.any(String),
        expect.any(String),
      );
    });

    test('should NOT invert balance when invertBalance setting is false', async () => {
      getRogersBankCredentials.mockReturnValue({
        authToken: 'test-token',
        accountId: 'test-account',
        customerId: 'test-customer',
        accountIdEncoded: 'encoded-account',
        customerIdEncoded: 'encoded-customer',
        deviceId: 'test-device',
      });

      globalThis.GM_getValue.mockImplementation((key) => {
        if (key.includes('rogersbank_last_upload_date_')) {
          return '2024-01-01';
        }
        return null;
      });

      calculateFromDateWithLookback.mockReturnValue('2024-01-01');

      accountServiceMock.getMonarchAccountMapping.mockReturnValue({ id: 'monarch123', displayName: 'Rogers Card' });

      // Mock account data WITH invertBalance explicitly set to false
      accountServiceMock.getAccountData.mockReturnValue({
        invertBalance: false,
        uploadedTransactions: [],
      });

      fetchRogersBankAccountDetails.mockResolvedValue({
        balance: -1500.50,
        creditLimit: 5000,
        openedDate: '2023-01-01',
      });

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

      await uploadRogersBankToMonarch();

      // Verify uploadBalance was called with ORIGINAL (negative) balance
      expect(monarchApi.uploadBalance).toHaveBeenCalledWith(
        'monarch123',
        expect.stringContaining('-1500.5'), // Original negative value
        expect.any(String),
        expect.any(String),
      );
    });

    test('should migrate invertBalance from newlyCreated flag when invertBalance is undefined', async () => {
      getRogersBankCredentials.mockReturnValue({
        authToken: 'test-token',
        accountId: 'test-account',
        customerId: 'test-customer',
        accountIdEncoded: 'encoded-account',
        customerIdEncoded: 'encoded-customer',
        deviceId: 'test-device',
      });

      globalThis.GM_getValue.mockImplementation((key) => {
        if (key.includes('rogersbank_last_upload_date_')) {
          return '2024-01-01';
        }
        return null;
      });

      calculateFromDateWithLookback.mockReturnValue('2024-01-01');

      accountServiceMock.getMonarchAccountMapping.mockReturnValue({ id: 'monarch123', displayName: 'Rogers Card' });

      // Mock account data WITHOUT invertBalance but WITH newlyCreated flag
      accountServiceMock.getAccountData.mockReturnValue({
        monarchAccount: { id: 'monarch123', displayName: 'Rogers Card', newlyCreated: true },
        uploadedTransactions: [],
        // invertBalance is undefined - should trigger migration
      });

      fetchRogersBankAccountDetails.mockResolvedValue({
        balance: -1500.50,
        creditLimit: 5000,
        openedDate: '2023-01-01',
      });

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

      await uploadRogersBankToMonarch();

      // Should update account with migrated invertBalance setting
      expect(accountServiceMock.updateAccountInList).toHaveBeenCalledWith(
        'rogersbank',
        'test-account',
        expect.objectContaining({
          invertBalance: true, // Derived from newlyCreated: true
        }),
      );

      // Verify uploadBalance was called with INVERTED balance (migration applied)
      expect(monarchApi.uploadBalance).toHaveBeenCalledWith(
        'monarch123',
        expect.stringContaining('1500.5'), // Inverted
        expect.any(String),
        expect.any(String),
      );
    });

    test('should save invertBalance when creating new account mapping', async () => {
      getRogersBankCredentials.mockReturnValue({
        authToken: 'test-token',
        accountId: 'test-account',
        customerId: 'test-customer',
        accountIdEncoded: 'encoded-account',
        customerIdEncoded: 'encoded-customer',
        deviceId: 'test-device',
      });

      globalThis.GM_getValue.mockImplementation((key) => {
        if (key.includes('rogersbank_last_upload_date_')) {
          return '2024-01-01';
        }
        return null;
      });

      // Mock no account mapping to trigger account selector
      accountServiceMock.getMonarchAccountMapping.mockReturnValue(null);

      calculateFromDateWithLookback.mockReturnValue('2024-01-01');

      fetchRogersBankAccountDetails.mockResolvedValue({
        balance: -1000,
        creditLimit: 5000,
        openedDate: '2023-01-01',
      });

      monarchApi.listAccounts.mockResolvedValue([
        { id: 'monarch123', displayName: 'Rogers Card' },
      ]);

      // User creates a NEW account (newlyCreated: true)
      showMonarchAccountSelectorWithCreate.mockImplementation((accounts, callback) => {
        callback({
          id: 'new-monarch-account',
          displayName: 'Rogers Card',
          newlyCreated: true,
        });
      });

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

      await uploadRogersBankToMonarch();

      // Verify that accountService.upsertAccount was called with invertBalance flag
      expect(accountServiceMock.upsertAccount).toHaveBeenCalledWith(
        'rogersbank',
        expect.objectContaining({
          invertBalance: true, // Set based on newlyCreated
        }),
      );
    });
  });

  describe('uploadRogersBankToMonarch - Balance Inversion for Manual Accounts', () => {
    test('should invert balance for newly created manual accounts', async () => {
      getRogersBankCredentials.mockReturnValue({
        authToken: 'test-token',
        accountId: 'test-account',
        customerId: 'test-customer',
        accountIdEncoded: 'encoded-account',
        customerIdEncoded: 'encoded-customer',
        deviceId: 'test-device',
      });

      // Has previous sync (not first sync)
      globalThis.GM_getValue.mockImplementation((key) => {
        if (key.includes('rogersbank_last_upload_date_')) {
          return '2024-01-01';
        }
        return null;
      });

      // Mock no account mapping to trigger account selector
      accountServiceMock.getMonarchAccountMapping.mockReturnValue(null);

      // Mock account data with invertBalance: true (set when account was created)
      // This simulates a previously created manual account
      accountServiceMock.getAccountData.mockReturnValue({
        invertBalance: true, // Saved setting from when account was created
        uploadedTransactions: [],
      });

      calculateFromDateWithLookback.mockReturnValue('2024-01-01');

      // Mock account details fetch - balance is negative (typical credit card balance owed)
      fetchRogersBankAccountDetails.mockResolvedValue({
        balance: -1500.50,
        creditLimit: 5000,
        openedDate: '2023-01-01',
      });

      monarchApi.listAccounts.mockResolvedValue([
        { id: 'monarch123', displayName: 'Rogers Card' },
      ]);

      // User creates a NEW account (newlyCreated: true)
      showMonarchAccountSelectorWithCreate.mockImplementation((accounts, callback) => {
        callback({
          id: 'new-monarch-account',
          displayName: 'Rogers Card',
          newlyCreated: true,
        });
      });

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

      await uploadRogersBankToMonarch();

      // Verify uploadBalance was called with INVERTED (positive) balance
      expect(monarchApi.uploadBalance).toHaveBeenCalledWith(
        'new-monarch-account',
        expect.stringContaining('1500.5'), // Positive value (inverted from -1500.50)
        expect.any(String),
        expect.any(String),
      );

      // Ensure it does NOT contain the negative value
      const uploadBalanceCall = monarchApi.uploadBalance.mock.calls[0];
      const csvData = uploadBalanceCall[1];
      expect(csvData).not.toContain('-1500.5');
    });

    test('should NOT invert balance for linked existing accounts', async () => {
      getRogersBankCredentials.mockReturnValue({
        authToken: 'test-token',
        accountId: 'test-account',
        customerId: 'test-customer',
        accountIdEncoded: 'encoded-account',
        customerIdEncoded: 'encoded-customer',
        deviceId: 'test-device',
      });

      // Has previous sync
      globalThis.GM_getValue.mockImplementation((key) => {
        if (key.includes('rogersbank_last_upload_date_')) {
          return '2024-01-01';
        }
        return null;
      });

      // Mock no account mapping to trigger account selector
      accountServiceMock.getMonarchAccountMapping.mockReturnValue(null);

      calculateFromDateWithLookback.mockReturnValue('2024-01-01');

      // Mock account details fetch - balance is negative
      fetchRogersBankAccountDetails.mockResolvedValue({
        balance: -1500.50,
        creditLimit: 5000,
        openedDate: '2023-01-01',
      });

      monarchApi.listAccounts.mockResolvedValue([
        { id: 'existing-monarch-account', displayName: 'Linked Rogers Card' },
      ]);

      // User selects an EXISTING account (no newlyCreated flag)
      showMonarchAccountSelectorWithCreate.mockImplementation((accounts, callback) => {
        callback({
          id: 'existing-monarch-account',
          displayName: 'Linked Rogers Card',
          // Note: NO newlyCreated flag
        });
      });

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

      await uploadRogersBankToMonarch();

      // Verify uploadBalance was called with ORIGINAL (negative) balance
      expect(monarchApi.uploadBalance).toHaveBeenCalledWith(
        'existing-monarch-account',
        expect.stringContaining('-1500.5'), // Original negative value
        expect.any(String),
        expect.any(String),
      );
    });

    test('should invert balance during balance reconstruction for manual accounts', async () => {
      getRogersBankCredentials.mockReturnValue({
        authToken: 'test-token',
        accountId: 'test-account',
        customerId: 'test-customer',
        accountIdEncoded: 'encoded-account',
        customerIdEncoded: 'encoded-customer',
        deviceId: 'test-device',
      });

      // First sync - no last upload date
      globalThis.GM_getValue.mockImplementation((key) => {
        if (key.includes('rogersbank_last_upload_date_')) {
          return null; // First sync
        }
        return null;
      });

      // Mock no account mapping to trigger account selector
      accountServiceMock.getMonarchAccountMapping.mockReturnValue(null);

      // Mock account data with invertBalance: true (will be set when account is created)
      accountServiceMock.getAccountData.mockReturnValue({
        invertBalance: true, // Saved setting from when account was created
        uploadedTransactions: [],
      });

      // User selects reconstruct balance
      showDatePickerWithOptionsPromise.mockResolvedValue({
        date: '2024-01-01',
        reconstructBalance: true,
      });

      // Mock account details fetch - balance is negative
      fetchRogersBankAccountDetails.mockResolvedValue({
        balance: -500.00,
        creditLimit: 5000,
        openedDate: '2024-01-01',
      });

      monarchApi.listAccounts.mockResolvedValue([
        { id: 'monarch123', displayName: 'Rogers Card' },
      ]);

      // User creates a NEW account
      showMonarchAccountSelectorWithCreate.mockImplementation((accounts, callback) => {
        callback({
          id: 'new-manual-account',
          displayName: 'Rogers Card',
          newlyCreated: true,
        });
      });

      monarchApi.uploadBalance.mockResolvedValue(true);

      // Mock transactions for balance reconstruction
      // Must include 'date' and 'amount.value' fields for normalizeRogersTransaction
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          activitySummary: {
            totalCount: 2,
            activities: [
              {
                referenceNumber: 'REF1',
                activityStatus: 'APPROVED',
                date: '2024-01-10',
                amount: { value: '-100.00', currency: 'CAD' },
                transactionAmount: -100.00,
                description: 'Purchase 1',
                activityDate: '2024-01-10',
              },
              {
                referenceNumber: 'REF2',
                activityStatus: 'APPROVED',
                date: '2024-01-14',
                amount: { value: '-400.00', currency: 'CAD' },
                transactionAmount: -400.00,
                description: 'Purchase 2',
                activityDate: '2024-01-14',
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

      // Verify uploadBalance was called
      expect(monarchApi.uploadBalance).toHaveBeenCalled();

      // Check that the CSV contains positive values (inverted)
      const uploadBalanceCall = monarchApi.uploadBalance.mock.calls[0];
      const csvData = uploadBalanceCall[1];

      // With balance correction (always applied during reconstruction):
      // - Transactions sum to -500 by day 2024-01-15 (today)
      // - Current balance is -500, so correction factor is 0
      // - After inversion for manual account: all values become positive
      // The current balance -500 should become 500
      expect(csvData).toContain('500'); // Current balance inverted
      // Should NOT contain negative values in CSV for manual accounts
      expect(csvData).not.toMatch(/"-\d/); // No negative values in CSV
    });

    test('should preserve newlyCreated flag in account mapping storage via accountService', async () => {
      getRogersBankCredentials.mockReturnValue({
        authToken: 'test-token',
        accountId: 'test-account',
        customerId: 'test-customer',
        accountIdEncoded: 'encoded-account',
        customerIdEncoded: 'encoded-customer',
        deviceId: 'test-device',
      });

      // Has previous sync
      globalThis.GM_getValue.mockImplementation((key) => {
        if (key.includes('rogersbank_last_upload_date_')) {
          return '2024-01-01';
        }
        return null;
      });

      // Mock no account mapping to trigger account selector
      accountServiceMock.getMonarchAccountMapping.mockReturnValue(null);

      calculateFromDateWithLookback.mockReturnValue('2024-01-01');

      fetchRogersBankAccountDetails.mockResolvedValue({
        balance: -1000,
        creditLimit: 5000,
        openedDate: '2023-01-01',
      });

      monarchApi.listAccounts.mockResolvedValue([
        { id: 'monarch123', displayName: 'Rogers Card' },
      ]);

      // User creates a NEW account
      showMonarchAccountSelectorWithCreate.mockImplementation((accounts, callback) => {
        callback({
          id: 'new-monarch-account',
          displayName: 'Rogers Card',
          newlyCreated: true,
        });
      });

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

      await uploadRogersBankToMonarch();

      // Verify that accountService.upsertAccount was called with the newlyCreated flag
      expect(accountServiceMock.upsertAccount).toHaveBeenCalledWith(
        'rogersbank',
        expect.objectContaining({
          monarchAccount: expect.objectContaining({
            id: 'new-monarch-account',
            displayName: 'Rogers Card',
            newlyCreated: true,
          }),
        }),
      );
    });
  });

  describe('uploadRogersBankToMonarch - Skip Categorization', () => {
    test('should skip manual category prompts when skipCategorization setting is enabled', async () => {
      getRogersBankCredentials.mockReturnValue({
        authToken: 'test-token',
        accountId: 'test-account',
        customerId: 'test-customer',
        accountIdEncoded: 'encoded-account',
        customerIdEncoded: 'encoded-customer',
        deviceId: 'test-device',
      });

      calculateFromDateWithLookback.mockReturnValue('2024-01-01');
      globalThis.GM_getValue.mockImplementation((key) => {
        if (key.includes('rogersbank_last_upload_date_')) return '2024-01-01';
        return null;
      });

      // Enable skipCategorization in account data
      accountServiceMock.getAccountData.mockReturnValue({
        skipCategorization: true,
        uploadedTransactions: [],
      });

      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -1000, creditLimit: 5000, openedDate: '2023-01-01' });
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
                description: 'Restaurant Purchase',
                activityDate: '2024-01-10',
                merchant: { categoryDescription: 'Restaurants' },
              },
              {
                referenceNumber: 'REF2',
                activityStatus: 'APPROVED',
                transactionAmount: -50.00,
                description: 'Unknown Store',
                activityDate: '2024-01-11',
                merchant: { categoryDescription: 'Unknown Category' },
              },
            ],
          },
        }),
      });

      monarchApi.getCategoriesAndGroups.mockResolvedValue({ categories: [{ name: 'Dining' }] });
      convertTransactionsToMonarchCSV.mockReturnValue('csv,data');
      monarchApi.uploadTransactions.mockResolvedValue(true);

      const result = await uploadRogersBankToMonarch();

      expect(result.success).toBe(true);
      // Should NOT show manual category selector
      expect(showMonarchCategorySelector).not.toHaveBeenCalled();
      // All transactions should have empty resolved category
      expect(convertTransactionsToMonarchCSV).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ resolvedMonarchCategory: '', originalBankCategory: 'Restaurants' }),
          expect.objectContaining({ resolvedMonarchCategory: '', originalBankCategory: 'Unknown Category' }),
        ]),
        expect.any(String),
        expect.any(Object),
      );
    });

    test('should show manual category prompts when skipCategorization is false', async () => {
      getRogersBankCredentials.mockReturnValue({
        authToken: 'test-token',
        accountId: 'test-account',
        customerId: 'test-customer',
        accountIdEncoded: 'encoded-account',
        customerIdEncoded: 'encoded-customer',
        deviceId: 'test-device',
      });

      calculateFromDateWithLookback.mockReturnValue('2024-01-01');
      globalThis.GM_getValue.mockReturnValue(
        JSON.stringify({ id: 'monarch123', displayName: 'Rogers Card' }),
      );

      // skipCategorization is false
      accountServiceMock.getAccountData.mockReturnValue({
        skipCategorization: false,
        uploadedTransactions: [],
      });

      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -1000, creditLimit: 5000, openedDate: '2023-01-01' });
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
                description: 'Unknown Store',
                activityDate: '2024-01-10',
                merchant: { categoryDescription: 'Unknown Category' },
              },
            ],
          },
        }),
      });

      monarchApi.getCategoriesAndGroups.mockResolvedValue({ categories: [{ name: 'Shopping' }] });
      applyCategoryMapping.mockReturnValue({
        needsManualSelection: true,
        bankCategory: 'Unknown Category',
      });

      const calculateAllCategorySimilarities = jest.requireMock('../../src/mappers/category').calculateAllCategorySimilarities;
      calculateAllCategorySimilarities.mockReturnValue({
        topMatches: [{ category: 'Shopping', score: 0.5 }],
        allScores: [{ category: 'Shopping', score: 0.5 }],
      });

      // User selects a category manually
      showMonarchCategorySelector.mockImplementation((bankCategory, callback) => {
        callback({ id: 'cat1', name: 'Shopping' });
      });
      applyCategoryMapping.mockReturnValueOnce({
        needsManualSelection: true,
        bankCategory: 'Unknown Category',
      }).mockReturnValue('Shopping');

      convertTransactionsToMonarchCSV.mockReturnValue('csv,data');
      monarchApi.uploadTransactions.mockResolvedValue(true);

      const result = await uploadRogersBankToMonarch();

      expect(result.success).toBe(true);
      // Should show manual category selector when skipCategorization is false
      expect(showMonarchCategorySelector).toHaveBeenCalled();
    });

    test('should handle skipAll from category selector for remaining categories', async () => {
      getRogersBankCredentials.mockReturnValue({
        authToken: 'test-token',
        accountId: 'test-account',
        customerId: 'test-customer',
        accountIdEncoded: 'encoded-account',
        customerIdEncoded: 'encoded-customer',
        deviceId: 'test-device',
      });

      calculateFromDateWithLookback.mockReturnValue('2024-01-01');
      globalThis.GM_getValue.mockReturnValue(
        JSON.stringify({ id: 'monarch123', displayName: 'Rogers Card' }),
      );

      // skipCategorization is false (so manual prompts appear)
      accountServiceMock.getAccountData.mockReturnValue({
        skipCategorization: false,
        uploadedTransactions: [],
      });

      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -1000, creditLimit: 5000, openedDate: '2023-01-01' });
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
                description: 'Store A',
                activityDate: '2024-01-10',
                merchant: { categoryDescription: 'Category A' },
              },
              {
                referenceNumber: 'REF2',
                activityStatus: 'APPROVED',
                transactionAmount: -50.00,
                description: 'Store B',
                activityDate: '2024-01-11',
                merchant: { categoryDescription: 'Category B' },
              },
            ],
          },
        }),
      });

      monarchApi.getCategoriesAndGroups.mockResolvedValue({ categories: [{ name: 'Shopping' }] });

      // Both categories need manual selection
      applyCategoryMapping.mockReturnValue({
        needsManualSelection: true,
        bankCategory: 'Category A',
      });

      const calculateAllCategorySimilarities = jest.requireMock('../../src/mappers/category').calculateAllCategorySimilarities;
      calculateAllCategorySimilarities.mockReturnValue({
        topMatches: [],
        allScores: [],
      });

      // User clicks "Skip All" on first category prompt
      showMonarchCategorySelector.mockImplementation((bankCategory, callback) => {
        callback({ skipAll: true });
      });

      convertTransactionsToMonarchCSV.mockReturnValue('csv,data');
      monarchApi.uploadTransactions.mockResolvedValue(true);

      const result = await uploadRogersBankToMonarch();

      expect(result.success).toBe(true);
      // Should only have been called once (for Category A), then skipAll breaks the loop
      expect(showMonarchCategorySelector).toHaveBeenCalledTimes(1);
      // Unresolved categories should get empty string
      expect(convertTransactionsToMonarchCSV).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ resolvedMonarchCategory: '' }),
          expect.objectContaining({ resolvedMonarchCategory: '' }),
        ]),
        expect.any(String),
        expect.any(Object),
      );
    });
  });

  describe('uploadRogersBankToMonarch - Data Storage', () => {
    test('should save uploaded transaction references to consolidated storage', async () => {
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

      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -1000, creditLimit: 5000, openedDate: '2023-01-01' });
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

      // Verify accountService.updateAccountInList was called with uploadedTransactions
      expect(accountServiceMock.updateAccountInList).toHaveBeenCalledWith(
        'rogersbank',
        'test-account',
        expect.objectContaining({
          uploadedTransactions: expect.any(Array),
        }),
      );
      expect(saveLastUploadDate).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
      );
    });

    test('should merge with existing uploaded references', async () => {
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

      // Mock existing uploaded transactions in consolidated storage
      accountServiceMock.getAccountData.mockReturnValue({
        uploadedTransactions: ['OLD_REF1', 'OLD_REF2'],
      });

      // Mock that OLD_REF1 and OLD_REF2 are already uploaded
      const transactionStorageMock = jest.requireMock('../../src/utils/transactionStorage');
      transactionStorageMock.getTransactionIdsFromArray.mockReturnValue(new Set(['OLD_REF1', 'OLD_REF2']));

      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -1000, creditLimit: 5000, openedDate: '2023-01-01' });
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

      // Verify accountService.updateAccountInList was called with merged transactions
      expect(accountServiceMock.updateAccountInList).toHaveBeenCalledWith(
        'rogersbank',
        'test-account',
        expect.objectContaining({
          uploadedTransactions: expect.any(Array),
        }),
      );
    });
  });

  describe('uploadRogersBankToMonarch - Balance Correction for Truncated History', () => {
    test('should apply balance correction when transaction history is truncated', async () => {
      getRogersBankCredentials.mockReturnValue({
        authToken: 'test-token',
        accountId: 'test-account',
        customerId: 'test-customer',
        accountIdEncoded: 'encoded-account',
        customerIdEncoded: 'encoded-customer',
        deviceId: 'test-device',
      });

      // First sync - no last upload date
      globalThis.GM_getValue.mockImplementation((key) => {
        if (key.includes('rogersbank_account_')) {
          return JSON.stringify({ id: 'monarch123', displayName: 'Rogers Card' });
        }
        if (key.includes('rogersbank_last_upload_date_')) {
          return null; // First sync
        }
        return null;
      });

      // User selects reconstruct balance
      showDatePickerWithOptionsPromise.mockResolvedValue({
        date: '2024-01-10',
        reconstructBalance: true,
      });

      // Current balance is -500 (owes $500)
      fetchRogersBankAccountDetails.mockResolvedValue({
        balance: -500,
        creditLimit: 5000,
        openedDate: '2024-01-01',
      });

      monarchApi.uploadBalance.mockResolvedValue(true);

      // Simulate truncated transaction history (totalCount >= 1000)
      // The transactions only sum to -150, but actual balance is -500
      // So correction factor should be -350
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          activitySummary: {
            totalCount: 1000, // Truncated!
            activities: [
              {
                referenceNumber: 'REF1',
                activityStatus: 'APPROVED',
                date: '2024-01-12',
                amount: { value: '-50.00', currency: 'CAD' },
                transactionAmount: -50.00,
                description: 'Purchase 1',
                activityDate: '2024-01-12',
              },
              {
                referenceNumber: 'REF2',
                activityStatus: 'APPROVED',
                date: '2024-01-14',
                amount: { value: '-100.00', currency: 'CAD' },
                transactionAmount: -100.00,
                description: 'Purchase 2',
                activityDate: '2024-01-14',
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

      // Verify uploadBalance was called
      expect(monarchApi.uploadBalance).toHaveBeenCalled();

      // The balance CSV should contain the current balance value for today
      const uploadBalanceCall = monarchApi.uploadBalance.mock.calls[0];
      const csvData = uploadBalanceCall[1];

      // Today's balance (2024-01-15) should be -500 (the actual current balance)
      expect(csvData).toContain('-500');

      // Warning should have been shown about truncated history
      expect(toast.show).toHaveBeenCalledWith(
        expect.stringContaining('Transaction history may be incomplete'),
        'warning',
      );
    });

    test('should not apply balance correction when history is complete', async () => {
      getRogersBankCredentials.mockReturnValue({
        authToken: 'test-token',
        accountId: 'test-account',
        customerId: 'test-customer',
        accountIdEncoded: 'encoded-account',
        customerIdEncoded: 'encoded-customer',
        deviceId: 'test-device',
      });

      // First sync - no last upload date
      globalThis.GM_getValue.mockImplementation((key) => {
        if (key.includes('rogersbank_account_')) {
          return JSON.stringify({ id: 'monarch123', displayName: 'Rogers Card' });
        }
        if (key.includes('rogersbank_last_upload_date_')) {
          return null; // First sync
        }
        return null;
      });

      // User selects reconstruct balance
      showDatePickerWithOptionsPromise.mockResolvedValue({
        date: '2024-01-10',
        reconstructBalance: true,
      });

      // Current balance is -150 (matches transaction sum)
      fetchRogersBankAccountDetails.mockResolvedValue({
        balance: -150,
        creditLimit: 5000,
        openedDate: '2024-01-01',
      });

      monarchApi.uploadBalance.mockResolvedValue(true);

      // Complete transaction history (totalCount < 1000)
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          activitySummary: {
            totalCount: 2, // NOT truncated
            activities: [
              {
                referenceNumber: 'REF1',
                activityStatus: 'APPROVED',
                date: '2024-01-12',
                amount: { value: '-50.00', currency: 'CAD' },
                transactionAmount: -50.00,
                description: 'Purchase 1',
                activityDate: '2024-01-12',
              },
              {
                referenceNumber: 'REF2',
                activityStatus: 'APPROVED',
                date: '2024-01-14',
                amount: { value: '-100.00', currency: 'CAD' },
                transactionAmount: -100.00,
                description: 'Purchase 2',
                activityDate: '2024-01-14',
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

      // No warning should have been shown
      expect(toast.show).not.toHaveBeenCalledWith(
        expect.stringContaining('Transaction history may be incomplete'),
        'warning',
      );
    });

    test('should apply balance correction with inversion for manual accounts', async () => {
      getRogersBankCredentials.mockReturnValue({
        authToken: 'test-token',
        accountId: 'test-account',
        customerId: 'test-customer',
        accountIdEncoded: 'encoded-account',
        customerIdEncoded: 'encoded-customer',
        deviceId: 'test-device',
      });

      // First sync - no last upload date
      globalThis.GM_getValue.mockImplementation((key) => {
        if (key.includes('rogersbank_last_upload_date_')) {
          return null; // First sync
        }
        return null;
      });

      // Mock no account mapping to trigger account selector
      accountServiceMock.getMonarchAccountMapping.mockReturnValue(null);

      // Mock account data with invertBalance: true (will be set when account is created)
      accountServiceMock.getAccountData.mockReturnValue({
        invertBalance: true, // Saved setting from when account was created
        uploadedTransactions: [],
      });

      // User selects reconstruct balance
      showDatePickerWithOptionsPromise.mockResolvedValue({
        date: '2024-01-10',
        reconstructBalance: true,
      });

      // Current balance is -500
      fetchRogersBankAccountDetails.mockResolvedValue({
        balance: -500,
        creditLimit: 5000,
        openedDate: '2024-01-01',
      });

      monarchApi.listAccounts.mockResolvedValue([
        { id: 'monarch123', displayName: 'Rogers Card' },
      ]);

      // User creates a NEW account (newlyCreated: true)
      showMonarchAccountSelectorWithCreate.mockImplementation((accounts, callback) => {
        callback({
          id: 'new-monarch-account',
          displayName: 'Rogers Card',
          newlyCreated: true,
        });
      });

      monarchApi.uploadBalance.mockResolvedValue(true);

      // Truncated history with partial transactions
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          activitySummary: {
            totalCount: 1000, // Truncated!
            activities: [
              {
                referenceNumber: 'REF1',
                activityStatus: 'APPROVED',
                date: '2024-01-12',
                amount: { value: '-100.00', currency: 'CAD' },
                transactionAmount: -100.00,
                description: 'Purchase',
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

      // Verify uploadBalance was called
      expect(monarchApi.uploadBalance).toHaveBeenCalled();

      const uploadBalanceCall = monarchApi.uploadBalance.mock.calls[0];
      const csvData = uploadBalanceCall[1];

      // For newly created manual accounts, balance should be inverted
      // -500 becomes 500
      expect(csvData).toContain('500');
      // Should NOT contain -500 (the non-inverted value)
      expect(csvData).not.toContain('-500');
    });

    test('should correctly shift all historical balances by correction factor', async () => {
      getRogersBankCredentials.mockReturnValue({
        authToken: 'test-token',
        accountId: 'test-account',
        customerId: 'test-customer',
        accountIdEncoded: 'encoded-account',
        customerIdEncoded: 'encoded-customer',
        deviceId: 'test-device',
      });

      // First sync - no last upload date
      globalThis.GM_getValue.mockImplementation((key) => {
        if (key.includes('rogersbank_account_')) {
          return JSON.stringify({ id: 'monarch123', displayName: 'Rogers Card' });
        }
        if (key.includes('rogersbank_last_upload_date_')) {
          return null; // First sync
        }
        return null;
      });

      // User selects reconstruct balance - starting from 2024-01-13
      showDatePickerWithOptionsPromise.mockResolvedValue({
        date: '2024-01-13',
        reconstructBalance: true,
      });

      // Current balance is -1000, but transactions only sum to -150
      // Correction factor = -1000 - (-150) = -850
      fetchRogersBankAccountDetails.mockResolvedValue({
        balance: -1000,
        creditLimit: 5000,
        openedDate: '2024-01-01',
      });

      monarchApi.uploadBalance.mockResolvedValue(true);

      // Truncated history
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          activitySummary: {
            totalCount: 1000, // Truncated!
            activities: [
              {
                referenceNumber: 'REF1',
                activityStatus: 'APPROVED',
                date: '2024-01-14',
                amount: { value: '-50.00', currency: 'CAD' },
                transactionAmount: -50.00,
                description: 'Purchase 1',
                activityDate: '2024-01-14',
              },
              {
                referenceNumber: 'REF2',
                activityStatus: 'APPROVED',
                date: '2024-01-15', // Today
                amount: { value: '-100.00', currency: 'CAD' },
                transactionAmount: -100.00,
                description: 'Purchase 2',
                activityDate: '2024-01-15',
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

      // Verify uploadBalance was called
      expect(monarchApi.uploadBalance).toHaveBeenCalled();

      const uploadBalanceCall = monarchApi.uploadBalance.mock.calls[0];
      const csvData = uploadBalanceCall[1];

      // With correction applied:
      // Day 2024-01-13: runningBalance=0, after correction: 0 + (-850) = -850
      // Day 2024-01-14: runningBalance=-50, after correction: -50 + (-850) = -900
      // Day 2024-01-15: runningBalance=-150, after correction: -150 + (-850) = -1000 (matches current!)

      // The CSV should contain today's corrected balance of -1000
      expect(csvData).toContain('-1000');
    });

    test('should preserve leading zero balances and only apply correction after first non-zero balance', async () => {
      getRogersBankCredentials.mockReturnValue({
        authToken: 'test-token',
        accountId: 'test-account',
        customerId: 'test-customer',
        accountIdEncoded: 'encoded-account',
        customerIdEncoded: 'encoded-customer',
        deviceId: 'test-device',
      });

      // First sync - no last upload date
      globalThis.GM_getValue.mockImplementation((key) => {
        if (key.includes('rogersbank_account_')) {
          return JSON.stringify({ id: 'monarch123', displayName: 'Rogers Card' });
        }
        if (key.includes('rogersbank_last_upload_date_')) {
          return null; // First sync
        }
        return null;
      });

      // User selects reconstruct balance - starting from 2024-01-01 (well before first transaction)
      showDatePickerWithOptionsPromise.mockResolvedValue({
        date: '2024-01-01',
        reconstructBalance: true,
      });

      // Current balance is -1000, but transactions only sum to -150
      // This creates a correction factor of -850
      fetchRogersBankAccountDetails.mockResolvedValue({
        balance: -1000,
        creditLimit: 5000,
        openedDate: '2024-01-01',
      });

      monarchApi.uploadBalance.mockResolvedValue(true);

      // Truncated history - first transaction is on 2024-01-12 (not 2024-01-01)
      // This means days 2024-01-01 through 2024-01-11 have $0 balance
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          activitySummary: {
            totalCount: 1000, // Truncated!
            activities: [
              {
                referenceNumber: 'REF1',
                activityStatus: 'APPROVED',
                date: '2024-01-12', // First transaction
                amount: { value: '-50.00', currency: 'CAD' },
                transactionAmount: -50.00,
                description: 'Purchase 1',
                activityDate: '2024-01-12',
              },
              {
                referenceNumber: 'REF2',
                activityStatus: 'APPROVED',
                date: '2024-01-14',
                amount: { value: '-100.00', currency: 'CAD' },
                transactionAmount: -100.00,
                description: 'Purchase 2',
                activityDate: '2024-01-14',
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

      // Verify uploadBalance was called
      expect(monarchApi.uploadBalance).toHaveBeenCalled();

      const uploadBalanceCall = monarchApi.uploadBalance.mock.calls[0];
      const csvData = uploadBalanceCall[1];

      // Parse the CSV to verify the behavior
      const lines = csvData.split('\n').filter((line) => line.trim());

      // Days 2024-01-01 through 2024-01-11 should have $0 (correction NOT applied)
      // Because these are leading zeros before the first transaction
      const jan01Line = lines.find((line) => line.includes('2024-01-01'));
      const jan05Line = lines.find((line) => line.includes('2024-01-05'));
      const jan11Line = lines.find((line) => line.includes('2024-01-11'));

      expect(jan01Line).toContain('"0"'); // Should be $0, not -$850
      expect(jan05Line).toContain('"0"'); // Should be $0, not -$850
      expect(jan11Line).toContain('"0"'); // Should be $0, not -$850

      // Day 2024-01-12 (first transaction) should have correction applied
      // Raw: -50, with correction: -50 + (-850) = -900
      const jan12Line = lines.find((line) => line.includes('2024-01-12'));
      expect(jan12Line).toContain('-900');

      // Today (2024-01-15) should match the actual current balance of -1000
      const jan15Line = lines.find((line) => line.includes('2024-01-15'));
      expect(jan15Line).toContain('-1000');
    });

    test('should log correction factor when applied', async () => {
      const debugLog = jest.requireMock('../../src/core/utils').debugLog;

      getRogersBankCredentials.mockReturnValue({
        authToken: 'test-token',
        accountId: 'test-account',
        customerId: 'test-customer',
        accountIdEncoded: 'encoded-account',
        customerIdEncoded: 'encoded-customer',
        deviceId: 'test-device',
      });

      // First sync - no last upload date
      globalThis.GM_getValue.mockImplementation((key) => {
        if (key.includes('rogersbank_account_')) {
          return JSON.stringify({ id: 'monarch123', displayName: 'Rogers Card' });
        }
        if (key.includes('rogersbank_last_upload_date_')) {
          return null; // First sync
        }
        return null;
      });

      showDatePickerWithOptionsPromise.mockResolvedValue({
        date: '2024-01-14',
        reconstructBalance: true,
      });

      // Large discrepancy between actual and reconstructed balance
      fetchRogersBankAccountDetails.mockResolvedValue({
        balance: -5000,
        creditLimit: 10000,
        openedDate: '2024-01-01',
      });

      monarchApi.uploadBalance.mockResolvedValue(true);

      // Truncated history with small transaction sum
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          activitySummary: {
            totalCount: 1000, // Truncated!
            activities: [
              {
                referenceNumber: 'REF1',
                activityStatus: 'APPROVED',
                date: '2024-01-15',
                amount: { value: '-100.00', currency: 'CAD' },
                transactionAmount: -100.00,
                description: 'Purchase',
                activityDate: '2024-01-15',
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

      // Verify debugLog was called with correction information
      expect(debugLog).toHaveBeenCalledWith(
        expect.stringContaining('Balance correction applied'),
      );
    });
  });
});
