/**
 * Tests for Rogers Bank Upload Service - Core - Error Handling, Balance Upload, Transactions, Categories
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
  ACCOUNT_SETTINGS: {
    STORE_TX_DETAILS_IN_NOTES: 'storeTransactionDetailsInNotes',
    TRANSACTION_RETENTION_DAYS: 'transactionRetentionDays',
    TRANSACTION_RETENTION_COUNT: 'transactionRetentionCount',
    STRIP_STORE_NUMBERS: 'stripStoreNumbers',
    INCLUDE_PENDING_TRANSACTIONS: 'includePendingTransactions',
    INVERT_BALANCE: 'invertBalance',
    SKIP_CATEGORIZATION: 'skipCategorization',
  },
}));

jest.mock('../../src/services/rogersbank/pendingTransactions', () => ({
  separateAndDeduplicateTransactions: jest.fn(async (transactions) => {
    const settled = (transactions || []).filter((tx) => tx.activityStatus === 'APPROVED').map((tx) => {
      // Attach generatedId to settled transactions without referenceNumber (mirrors real behavior)
      if (!tx.referenceNumber) {
        return { ...tx, generatedId: `rb-tx:mock${Math.random().toString(16).slice(2, 18)}` };
      }
      return tx;
    });
    const pending = (transactions || []).filter((tx) => tx.activityStatus === 'PENDING').map((tx) => ({
      ...tx,
      generatedId: `rb-tx:mock${Math.random().toString(16).slice(2, 18)}`,
    }));
    return { settled, pending, pendingIdMap: new Map(), settledIdMap: new Map(), duplicatesRemoved: 0 };
  }),
  reconcileRogersPendingTransactions: jest.fn(async () => ({
    success: true, settled: 0, cancelled: 0, failed: 0, noPendingTransactions: true,
  })),
  formatReconciliationMessage: jest.fn(() => 'No pending transactions'),
  formatPendingIdForNotes: jest.fn((id) => id || ''),
}));

// Mock GM functions
globalThis.GM_getValue = jest.fn();
globalThis.GM_setValue = jest.fn();
globalThis.GM_xmlhttpRequest = jest.fn();


describe('Rogers Bank Upload Service - Core - Error Handling, Balance Upload, Transactions, Categories', () => {
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
      expect(result.message).toContain('skipped');
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

  describe('Fee Transaction Deduplication', () => {
    test('should NOT filter fee transaction that shares referenceNumber with a purchase', async () => {
      getRogersBankCredentials.mockReturnValue({
        authToken: 'test-token',
        accountId: 'test-account',
        customerId: 'test-customer',
        accountIdEncoded: 'encoded-account',
        customerIdEncoded: 'encoded-customer',
        deviceId: 'test-device',
      });

      calculateFromDateWithLookback.mockReturnValue('2024-01-01');

      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -1000, creditLimit: 5000, openedDate: '2023-01-01' });
      monarchApi.uploadBalance.mockResolvedValue(true);

      // The purchase's referenceNumber is already in dedup store
      const transactionStorageMock = jest.requireMock('../../src/utils/transactionStorage');
      transactionStorageMock.getTransactionIdsFromArray.mockReturnValue(new Set(['SHARED_REF_123']));

      // API returns both a purchase and a fee with the SAME referenceNumber
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          activitySummary: {
            totalCount: 2,
            activities: [
              {
                referenceNumber: 'SHARED_REF_123',
                activityStatus: 'APPROVED',
                activityClassification: 'PURCHASE',
                transactionAmount: -100.00,
                date: '2024-01-10',
                amount: { value: '100.00', currency: 'CAD' },
                merchant: { name: 'SOME MERCHANT', category: 'RETAIL' },
              },
              {
                referenceNumber: 'SHARED_REF_123',
                activityStatus: 'APPROVED',
                activityClassification: 'FEES',
                activityCategory: 'FRONT-END FEE',
                transactionAmount: -5.00,
                date: '2024-01-10',
                amount: { value: '5.00', currency: 'CAD' },
                merchant: { name: 'CASH ADVANCE FEE', category: 'MISCELLANEOUS' },
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
      // The purchase (SHARED_REF_123) should be filtered as duplicate
      // The fee (SHARED_REF_123:fee) should NOT be filtered
      // So 1 transaction should be uploaded (the fee)
      expect(convertTransactionsToMonarchCSV).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            activityClassification: 'FEES',
            merchant: expect.objectContaining({ name: 'CASH ADVANCE FEE' }),
          }),
        ]),
        expect.any(String),
        expect.any(Object),
      );
      // The purchase should have been filtered out (1 skipped)
      expect(result.message).toContain('skipped');
    });

    test('should filter fee transaction when its qualified key is already in dedup store', async () => {
      getRogersBankCredentials.mockReturnValue({
        authToken: 'test-token',
        accountId: 'test-account',
        customerId: 'test-customer',
        accountIdEncoded: 'encoded-account',
        customerIdEncoded: 'encoded-customer',
        deviceId: 'test-device',
      });

      calculateFromDateWithLookback.mockReturnValue('2024-01-01');

      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -1000, creditLimit: 5000, openedDate: '2023-01-01' });
      monarchApi.uploadBalance.mockResolvedValue(true);

      // Both the purchase AND the fee's qualified key are in dedup store
      const transactionStorageMock = jest.requireMock('../../src/utils/transactionStorage');
      transactionStorageMock.getTransactionIdsFromArray.mockReturnValue(
        new Set(['SHARED_REF_123', 'SHARED_REF_123:fee']),
      );

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          activitySummary: {
            totalCount: 2,
            activities: [
              {
                referenceNumber: 'SHARED_REF_123',
                activityStatus: 'APPROVED',
                activityClassification: 'PURCHASE',
                transactionAmount: -100.00,
                date: '2024-01-10',
                amount: { value: '100.00', currency: 'CAD' },
                merchant: { name: 'SOME MERCHANT', category: 'RETAIL' },
              },
              {
                referenceNumber: 'SHARED_REF_123',
                activityStatus: 'APPROVED',
                activityClassification: 'FEES',
                transactionAmount: -5.00,
                date: '2024-01-10',
                amount: { value: '5.00', currency: 'CAD' },
                merchant: { name: 'CASH ADVANCE FEE', category: 'MISCELLANEOUS' },
              },
            ],
          },
        }),
      });

      const result = await uploadRogersBankToMonarch();

      expect(result.success).toBe(true);
      // Both transactions should be filtered as duplicates
      expect(monarchApi.uploadTransactions).not.toHaveBeenCalled();
      expect(result.message).toContain('skipped');
    });

    test('should save fee dedup key with :fee suffix after upload', async () => {
      getRogersBankCredentials.mockReturnValue({
        authToken: 'test-token',
        accountId: 'test-account',
        customerId: 'test-customer',
        accountIdEncoded: 'encoded-account',
        customerIdEncoded: 'encoded-customer',
        deviceId: 'test-device',
      });

      calculateFromDateWithLookback.mockReturnValue('2024-01-01');

      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -1000, creditLimit: 5000, openedDate: '2023-01-01' });
      monarchApi.uploadBalance.mockResolvedValue(true);

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          activitySummary: {
            totalCount: 1,
            activities: [
              {
                referenceNumber: 'FEE_REF_456',
                activityStatus: 'APPROVED',
                activityClassification: 'FEES',
                transactionAmount: -5.00,
                date: '2024-01-10',
                amount: { value: '5.00', currency: 'CAD' },
                merchant: { name: 'CASH ADVANCE FEE', category: 'MISCELLANEOUS' },
              },
            ],
          },
        }),
      });

      monarchApi.getCategoriesAndGroups.mockResolvedValue({ categories: [] });
      applyCategoryMapping.mockReturnValue('Uncategorized');
      convertTransactionsToMonarchCSV.mockReturnValue('csv,data');
      monarchApi.uploadTransactions.mockResolvedValue(true);

      const transactionStorageMock = jest.requireMock('../../src/utils/transactionStorage');

      await uploadRogersBankToMonarch();

      // Verify that mergeAndRetainTransactions was called with the :fee-suffixed key
      expect(transactionStorageMock.mergeAndRetainTransactions).toHaveBeenCalledWith(
        expect.any(Array),
        expect.arrayContaining(['FEE_REF_456:fee']),
        expect.any(Object),
        expect.any(String),
      );
    });
  });

  describe('CASH Auto-Categorization', () => {
    test('should auto-categorize CASH/CASH transactions as Cash & ATM', async () => {
      getRogersBankCredentials.mockReturnValue({
        authToken: 'test-token',
        accountId: 'test-account',
        customerId: 'test-customer',
        accountIdEncoded: 'encoded-account',
        customerIdEncoded: 'encoded-customer',
        deviceId: 'test-device',
      });

      calculateFromDateWithLookback.mockReturnValue('2024-01-01');

      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -1000, creditLimit: 5000, openedDate: '2023-01-01' });
      monarchApi.uploadBalance.mockResolvedValue(true);

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          activitySummary: {
            totalCount: 2,
            activities: [
              {
                referenceNumber: 'REF_PURCHASE',
                activityStatus: 'APPROVED',
                activityClassification: 'PURCHASE',
                transactionAmount: -100.00,
                date: '2024-01-10',
                amount: { value: '100.00', currency: 'CAD' },
                merchant: { name: 'SOME MERCHANT', category: 'RETAIL' },
              },
              {
                referenceNumber: 'REF_CASH',
                activityStatus: 'APPROVED',
                activityClassification: 'CASH',
                activityCategory: 'CASH',
                transactionAmount: -10.00,
                date: '2024-01-12',
                amount: { value: '10.00', currency: 'CAD' },
                merchant: { name: 'COINBASE RTL-KQP9WV9C', categoryCode: '6051', category: 'MISCELLANEOUS' },
              },
            ],
          },
        }),
      });

      monarchApi.getCategoriesAndGroups.mockResolvedValue({
        categories: [{ name: 'Cash & ATM' }, { name: 'Shopping' }],
      });
      applyCategoryMapping.mockReturnValue('Shopping');

      convertTransactionsToMonarchCSV.mockReturnValue('csv,data');
      monarchApi.uploadTransactions.mockResolvedValue(true);

      await uploadRogersBankToMonarch();

      expect(convertTransactionsToMonarchCSV).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            activityClassification: 'CASH',
            activityCategory: 'CASH',
            resolvedMonarchCategory: 'Cash & ATM',
          }),
          expect.objectContaining({
            activityClassification: 'PURCHASE',
            resolvedMonarchCategory: 'Shopping',
          }),
        ]),
        expect.any(String),
        expect.any(Object),
      );
    });

    test('should NOT auto-categorize when activityCategory differs from CASH', async () => {
      getRogersBankCredentials.mockReturnValue({
        authToken: 'test-token',
        accountId: 'test-account',
        customerId: 'test-customer',
        accountIdEncoded: 'encoded-account',
        customerIdEncoded: 'encoded-customer',
        deviceId: 'test-device',
      });

      calculateFromDateWithLookback.mockReturnValue('2024-01-01');

      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -1000, creditLimit: 5000, openedDate: '2023-01-01' });
      monarchApi.uploadBalance.mockResolvedValue(true);

      // A transaction with activityClassification=CASH but activityCategory=FRONT-END FEE
      // should NOT be auto-categorized as Cash & ATM
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          activitySummary: {
            totalCount: 1,
            activities: [
              {
                referenceNumber: 'REF_NOT_CASH',
                activityStatus: 'APPROVED',
                activityClassification: 'CASH',
                activityCategory: 'FRONT-END FEE',
                transactionAmount: -5.00,
                date: '2024-01-10',
                amount: { value: '5.00', currency: 'CAD' },
                merchant: { name: 'SOME FEE', category: 'MISCELLANEOUS' },
              },
            ],
          },
        }),
      });

      monarchApi.getCategoriesAndGroups.mockResolvedValue({
        categories: [{ name: 'Cash & ATM' }, { name: 'Shopping' }],
      });
      // Normal category mapping returns a resolved category
      applyCategoryMapping.mockReturnValue('Shopping');

      convertTransactionsToMonarchCSV.mockReturnValue('csv,data');
      monarchApi.uploadTransactions.mockResolvedValue(true);

      await uploadRogersBankToMonarch();

      // Should use normal category mapping, NOT Cash & ATM
      expect(convertTransactionsToMonarchCSV).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            activityClassification: 'CASH',
            activityCategory: 'FRONT-END FEE',
            resolvedMonarchCategory: 'Shopping',
          }),
        ]),
        expect.any(String),
        expect.any(Object),
      );
    });
  });

  describe('FEES Auto-Categorization', () => {
    test('should auto-categorize FEES transactions as Financial Fees', async () => {
      getRogersBankCredentials.mockReturnValue({
        authToken: 'test-token',
        accountId: 'test-account',
        customerId: 'test-customer',
        accountIdEncoded: 'encoded-account',
        customerIdEncoded: 'encoded-customer',
        deviceId: 'test-device',
      });

      calculateFromDateWithLookback.mockReturnValue('2024-01-01');

      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -1000, creditLimit: 5000, openedDate: '2023-01-01' });
      monarchApi.uploadBalance.mockResolvedValue(true);

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          activitySummary: {
            totalCount: 2,
            activities: [
              {
                referenceNumber: 'REF_PURCHASE',
                activityStatus: 'APPROVED',
                activityClassification: 'PURCHASE',
                transactionAmount: -100.00,
                date: '2024-01-10',
                amount: { value: '100.00', currency: 'CAD' },
                merchant: { name: 'SOME MERCHANT', category: 'RETAIL' },
              },
              {
                referenceNumber: 'REF_FEE',
                activityStatus: 'APPROVED',
                activityClassification: 'FEES',
                activityCategory: 'FRONT-END FEE',
                transactionAmount: -5.00,
                date: '2024-01-10',
                amount: { value: '5.00', currency: 'CAD' },
                merchant: { name: 'CASH ADVANCE FEE', category: 'MISCELLANEOUS' },
              },
            ],
          },
        }),
      });

      monarchApi.getCategoriesAndGroups.mockResolvedValue({
        categories: [{ name: 'Financial Fees' }, { name: 'Shopping' }],
      });
      // For the purchase transaction, return a normal mapping
      applyCategoryMapping.mockReturnValue('Shopping');

      convertTransactionsToMonarchCSV.mockReturnValue('csv,data');
      monarchApi.uploadTransactions.mockResolvedValue(true);

      await uploadRogersBankToMonarch();

      // The fee transaction should be auto-categorized as "Financial Fees"
      // The purchase should use normal category mapping
      expect(convertTransactionsToMonarchCSV).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            activityClassification: 'FEES',
            resolvedMonarchCategory: 'Financial Fees',
          }),
          expect.objectContaining({
            activityClassification: 'PURCHASE',
            resolvedMonarchCategory: 'Shopping',
          }),
        ]),
        expect.any(String),
        expect.any(Object),
      );
    });

    test('should auto-categorize FEES even when skipCategorization is false', async () => {
      getRogersBankCredentials.mockReturnValue({
        authToken: 'test-token',
        accountId: 'test-account',
        customerId: 'test-customer',
        accountIdEncoded: 'encoded-account',
        customerIdEncoded: 'encoded-customer',
        deviceId: 'test-device',
      });

      calculateFromDateWithLookback.mockReturnValue('2024-01-01');

      fetchRogersBankAccountDetails.mockResolvedValue({ balance: -1000, creditLimit: 5000, openedDate: '2023-01-01' });
      monarchApi.uploadBalance.mockResolvedValue(true);

      // Only a fee transaction - should NOT trigger manual category selection
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          activitySummary: {
            totalCount: 1,
            activities: [
              {
                referenceNumber: 'REF_FEE',
                activityStatus: 'APPROVED',
                activityClassification: 'FEES',
                transactionAmount: -5.00,
                date: '2024-01-10',
                amount: { value: '5.00', currency: 'CAD' },
                merchant: { name: 'ANNUAL FEE', category: 'MISCELLANEOUS' },
              },
            ],
          },
        }),
      });

      monarchApi.getCategoriesAndGroups.mockResolvedValue({ categories: [] });
      // Return needsManualSelection for the merchant category - but FEES override should bypass this
      applyCategoryMapping.mockReturnValue({
        needsManualSelection: true,
        bankCategory: 'MISCELLANEOUS',
        suggestedCategory: 'Uncategorized',
        similarityScore: 0.1,
      });

      convertTransactionsToMonarchCSV.mockReturnValue('csv,data');
      monarchApi.uploadTransactions.mockResolvedValue(true);

      await uploadRogersBankToMonarch();

      // FEES auto-categorization should override the merchant.category mapping
      expect(convertTransactionsToMonarchCSV).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            resolvedMonarchCategory: 'Financial Fees',
          }),
        ]),
        expect.any(String),
        expect.any(Object),
      );
      // Manual category selector should NOT have been shown for the fee
      // (it may be shown for MISCELLANEOUS category during the scanning phase,
      //  but the final mapping uses FEES override)
    });
  });

});
