/**
 * Tests for Rogers Bank Upload Service - Fetch API, Progress, Edge Cases, invertBalance
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


describe('Rogers Bank Upload Service - Fetch API, Progress, Edge Cases, invertBalance', () => {
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

});
