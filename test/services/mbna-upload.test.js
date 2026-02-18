/**
 * Tests for MBNA Upload Service
 */

import { syncMbnaAccount, uploadMbnaAccount } from '../../src/services/mbna-upload';

// Mock dependencies
jest.mock('../../src/core/utils', () => ({
  debugLog: jest.fn(),
  getTodayLocal: jest.fn(() => '2025-02-17'),
  getLastUpdateDate: jest.fn(() => null),
  saveLastUploadDate: jest.fn(),
  calculateFromDateWithLookback: jest.fn(() => '2024-11-18'),
  formatDate: jest.fn((d) => {
    if (d instanceof Date) return d.toISOString().split('T')[0];
    return d;
  }),
}));

jest.mock('../../src/core/config', () => ({
  LOGO_CLOUDINARY_IDS: {
    MBNA: 'production/account_logos/test/mbna-logo',
  },
  STORAGE: {
    WEALTHSIMPLE_CONFIG: 'wealthsimple_config',
    QUESTRADE_CONFIG: 'questrade_config',
    CANADALIFE_CONFIG: 'canadalife_config',
    ROGERSBANK_CONFIG: 'rogersbank_config',
    MBNA_CONFIG: 'mbna_config',
    WEALTHSIMPLE_ACCOUNTS_LIST: 'wealthsimple_accounts_list',
    QUESTRADE_ACCOUNTS_LIST: 'questrade_accounts_list',
    CANADALIFE_ACCOUNTS_LIST: 'canadalife_accounts_list',
    ROGERSBANK_ACCOUNTS_LIST: 'rogersbank_accounts_list',
    MBNA_ACCOUNTS_LIST: 'mbna_accounts_list',
    CATEGORY_MAPPINGS: 'category_mappings',
  },
}));

jest.mock('../../src/core/integrationCapabilities', () => ({
  INTEGRATIONS: { MBNA: 'mbna' },
  ACCOUNT_SETTINGS: {
    INCLUDE_PENDING_TRANSACTIONS: 'includePendingTransactions',
    mbna: {
      defaultLookbackDays: 91,
    },
  },
  getIntegrationConfig: jest.fn(() => ({
    hasDeduplication: true,
    hasTransactions: true,
    hasBalance: true,
    hasCreditLimit: true,
    settings: [],
    categoryMappings: { enabled: true },
  })),
}));

jest.mock('../../src/core/state', () => ({
  __esModule: true,
  default: {
    setAccount: jest.fn(),
  },
}));

jest.mock('../../src/api/monarch', () => ({
  __esModule: true,
  default: {
    setCreditLimit: jest.fn(),
    setAccountLogo: jest.fn(),
    uploadBalance: jest.fn().mockResolvedValue(true),
    uploadTransactions: jest.fn().mockResolvedValue(true),
  },
}));

jest.mock('../../src/services/common/accountService', () => ({
  __esModule: true,
  default: {
    getAccountData: jest.fn(),
    getMonarchAccountMapping: jest.fn(),
    upsertAccount: jest.fn(() => true),
    updateAccountInList: jest.fn(() => true),
    incrementSyncCount: jest.fn(() => 1),
    isReadyForLegacyCleanup: jest.fn(() => false),
    cleanupLegacyStorage: jest.fn(() => ({ cleaned: false, keysDeleted: 0 })),
  },
}));

jest.mock('../../src/ui/toast', () => ({
  __esModule: true,
  default: {
    show: jest.fn(),
  },
}));

jest.mock('../../src/ui/components/progressDialog', () => ({
  showProgressDialog: jest.fn(),
}));

jest.mock('../../src/ui/components/accountSelectorWithCreate', () => ({
  showMonarchAccountSelectorWithCreate: jest.fn(),
}));

jest.mock('../../src/ui/components/datePicker', () => ({
  showDatePickerWithOptionsPromise: jest.fn(),
}));

jest.mock('../../src/utils/csv', () => ({
  convertMbnaTransactionsToMonarchCSV: jest.fn(() => 'csv-data'),
}));

jest.mock('../../src/integrations/mbna/monarch-mapper/transactions', () => ({
  processMbnaTransactions: jest.fn(() => ({ settled: [], pending: [], all: [] })),
  resolveMbnaCategories: jest.fn((txs) => txs),
  filterDuplicateSettledTransactions: jest.fn((txs) => ({ newTransactions: txs, duplicateCount: 0 })),
}));

jest.mock('../../src/integrations/mbna/balanceReconstruction', () => ({
  buildBalanceHistory: jest.fn(() => []),
}));

jest.mock('../../src/integrations/mbna/monarch-mapper/balanceFormatter', () => ({
  formatBalanceHistoryForMonarch: jest.fn(() => []),
}));

jest.mock('../../src/integrations/mbna/monarch-mapper/pendingTransactions', () => ({
  separateAndDeduplicateTransactions: jest.fn(() => ({
    settled: [],
    pending: [],
    duplicatesRemoved: 0,
  })),
  reconcileMbnaPendingTransactions: jest.fn(() => ({
    success: true, settled: 0, cancelled: 0, failed: 0,
  })),
  formatReconciliationMessage: jest.fn(() => 'No pending transactions'),
}));

jest.mock('../../src/utils/transactionStorage', () => ({
  getTransactionIdsFromArray: jest.fn(() => []),
  mergeAndRetainTransactions: jest.fn((existing, newRefs) => [
    ...existing,
    ...newRefs.map((id) => ({ id, date: '2025-02-17' })),
  ]),
  getRetentionSettingsFromAccount: jest.fn(() => ({
    retentionDays: 91,
    retentionCount: 1000,
  })),
}));

// Import mocked modules for assertions
import monarchApi from '../../src/api/monarch';
import accountService from '../../src/services/common/accountService';
import stateManager from '../../src/core/state';
import { showProgressDialog } from '../../src/ui/components/progressDialog';
import { showMonarchAccountSelectorWithCreate } from '../../src/ui/components/accountSelectorWithCreate';

describe('MBNA Upload Service', () => {
  let mockProgressDialog;
  let mockApi;

  const SAMPLE_ACCOUNT = {
    accountId: '00240691635',
    displayName: 'Amazon.ca Rewards Mastercard\u00AE (4201)',
    endingIn: '4201',
    cardName: 'Amazon.ca Rewards Mastercard\u00AE',
  };

  const SAMPLE_MONARCH_ACCOUNT = {
    id: 'monarch-123',
    displayName: 'MBNA Amazon Card',
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock progress dialog
    mockProgressDialog = {
      initSteps: jest.fn(),
      updateStepStatus: jest.fn(),
      updateProgress: jest.fn(),
      updateBalanceChange: jest.fn(),
      onCancel: jest.fn(),
      hideCancel: jest.fn(),
      showSummary: jest.fn(),
      close: jest.fn(),
    };
    showProgressDialog.mockReturnValue(mockProgressDialog);

    // Create mock API with correct return shapes
    mockApi = {
      getCreditLimit: jest.fn().mockResolvedValue(null),
      getBalance: jest.fn().mockResolvedValue({ currentBalance: null }),
      getAccountSnapshot: jest.fn().mockResolvedValue({
        accountSnapshot: { accountTransactions: [] },
      }),
      getClosingDates: jest.fn().mockResolvedValue({}),
      getStatementByClosingDate: jest.fn().mockResolvedValue(null),
      getTransactions: jest.fn().mockResolvedValue({
        allSettled: [],
        allPending: [],
        statements: [],
        currentCycle: { settled: [], pending: [] },
      }),
    };

    // Default: no stored data
    accountService.getAccountData.mockReturnValue(null);
  });

  describe('syncMbnaAccount', () => {
    it('should set account in state manager', async () => {
      mockApi.getCreditLimit.mockResolvedValue(29900);
      monarchApi.setCreditLimit.mockResolvedValue({ limit: 29900 });

      await syncMbnaAccount(SAMPLE_ACCOUNT, SAMPLE_MONARCH_ACCOUNT, mockApi);

      expect(stateManager.setAccount).toHaveBeenCalledWith(
        '00240691635',
        'Amazon.ca Rewards Mastercard\u00AE (4201)',
      );
    });

    it('should create progress dialog with correct account info', async () => {
      await syncMbnaAccount(SAMPLE_ACCOUNT, SAMPLE_MONARCH_ACCOUNT, mockApi);

      expect(showProgressDialog).toHaveBeenCalledWith(
        [expect.objectContaining({
          key: '00240691635',
          nickname: 'Amazon.ca Rewards Mastercard\u00AE (4201)',
        })],
        'Syncing MBNA Data to Monarch Money',
      );
    });

    it('should initialize sync steps including creditLimit, transactions, balance', async () => {
      await syncMbnaAccount(SAMPLE_ACCOUNT, SAMPLE_MONARCH_ACCOUNT, mockApi);

      expect(mockProgressDialog.initSteps).toHaveBeenCalledWith(
        '00240691635',
        expect.arrayContaining([
          expect.objectContaining({ key: 'creditLimit' }),
          expect.objectContaining({ key: 'transactions' }),
          expect.objectContaining({ key: 'balance' }),
        ]),
      );
    });

    it('should sync credit limit successfully', async () => {
      mockApi.getCreditLimit.mockResolvedValue(29900);
      monarchApi.setCreditLimit.mockResolvedValue({ limit: 29900 });

      const result = await syncMbnaAccount(SAMPLE_ACCOUNT, SAMPLE_MONARCH_ACCOUNT, mockApi);

      expect(result.success).toBe(true);
      expect(monarchApi.setCreditLimit).toHaveBeenCalledWith('monarch-123', 29900);
    });

    it('should skip credit limit sync when value unchanged', async () => {
      mockApi.getCreditLimit.mockResolvedValue(29900);
      accountService.getAccountData.mockReturnValue({ lastSyncedCreditLimit: 29900 });

      const result = await syncMbnaAccount(SAMPLE_ACCOUNT, SAMPLE_MONARCH_ACCOUNT, mockApi);

      expect(result.success).toBe(true);
      expect(monarchApi.setCreditLimit).not.toHaveBeenCalled();
    });

    it('should save lastSyncedCreditLimit after successful sync', async () => {
      mockApi.getCreditLimit.mockResolvedValue(29900);
      monarchApi.setCreditLimit.mockResolvedValue({ limit: 29900 });

      await syncMbnaAccount(SAMPLE_ACCOUNT, SAMPLE_MONARCH_ACCOUNT, mockApi);

      expect(accountService.updateAccountInList).toHaveBeenCalledWith(
        'mbna',
        '00240691635',
        expect.objectContaining({ lastSyncedCreditLimit: 29900 }),
      );
    });

    it('should handle credit limit fetch error gracefully', async () => {
      mockApi.getCreditLimit.mockRejectedValue(new Error('API error'));

      const result = await syncMbnaAccount(SAMPLE_ACCOUNT, SAMPLE_MONARCH_ACCOUNT, mockApi);

      // Should still succeed overall (credit limit is not fatal)
      expect(result.success).toBe(true);
    });

    it('should handle null credit limit from API', async () => {
      mockApi.getCreditLimit.mockResolvedValue(null);

      const result = await syncMbnaAccount(SAMPLE_ACCOUNT, SAMPLE_MONARCH_ACCOUNT, mockApi);

      expect(result.success).toBe(true);
      expect(monarchApi.setCreditLimit).not.toHaveBeenCalled();
    });

    it('should update lastSyncDate after successful sync', async () => {
      await syncMbnaAccount(SAMPLE_ACCOUNT, SAMPLE_MONARCH_ACCOUNT, mockApi);

      expect(accountService.updateAccountInList).toHaveBeenCalledWith(
        'mbna',
        '00240691635',
        expect.objectContaining({ lastSyncDate: '2025-02-17' }),
      );
    });

    it('should show summary on completion', async () => {
      await syncMbnaAccount(SAMPLE_ACCOUNT, SAMPLE_MONARCH_ACCOUNT, mockApi);

      expect(mockProgressDialog.hideCancel).toHaveBeenCalled();
      expect(mockProgressDialog.showSummary).toHaveBeenCalledWith(
        expect.objectContaining({ total: 1 }),
      );
    });

    it('should handle credit limit verification failure', async () => {
      mockApi.getCreditLimit.mockResolvedValue(29900);
      monarchApi.setCreditLimit.mockResolvedValue({ limit: 25000 });

      await syncMbnaAccount(SAMPLE_ACCOUNT, SAMPLE_MONARCH_ACCOUNT, mockApi);

      // Should NOT save credit limit since verification failed
      const creditLimitUpdates = accountService.updateAccountInList.mock.calls
        .filter((c) => c[2]?.lastSyncedCreditLimit !== undefined);
      expect(creditLimitUpdates).toHaveLength(0);
    });

    it('should use fallback display name when displayName is missing', async () => {
      const accountNoName = { accountId: '123', endingIn: '9999' };

      await syncMbnaAccount(accountNoName, SAMPLE_MONARCH_ACCOUNT, mockApi);

      expect(stateManager.setAccount).toHaveBeenCalledWith('123', 'MBNA Card (9999)');
    });
  });

  describe('uploadMbnaAccount', () => {
    it('should set state manager BEFORE showing account selector for unmapped accounts', async () => {
      accountService.getMonarchAccountMapping.mockReturnValue(null);
      accountService.getAccountData.mockReturnValue(null);

      const callOrder = [];
      stateManager.setAccount.mockImplementation(() => {
        callOrder.push('setAccount');
      });
      showMonarchAccountSelectorWithCreate.mockImplementation((_accounts, callback) => {
        callOrder.push('showSelector');
        callback(null);
      });

      await uploadMbnaAccount(SAMPLE_ACCOUNT, mockApi);

      expect(callOrder[0]).toBe('setAccount');
      expect(callOrder[1]).toBe('showSelector');
    });

    it('should return cancelled when user cancels account selector', async () => {
      accountService.getMonarchAccountMapping.mockReturnValue(null);
      accountService.getAccountData.mockReturnValue(null);

      showMonarchAccountSelectorWithCreate.mockImplementation((_accounts, callback) => {
        callback(null);
      });

      const result = await uploadMbnaAccount(SAMPLE_ACCOUNT, mockApi);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Cancelled');
    });

    it('should save skipped account when user skips', async () => {
      accountService.getMonarchAccountMapping.mockReturnValue(null);
      accountService.getAccountData.mockReturnValue(null);

      showMonarchAccountSelectorWithCreate.mockImplementation((_accounts, callback) => {
        callback({ skipped: true });
      });

      const result = await uploadMbnaAccount(SAMPLE_ACCOUNT, mockApi);

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
      expect(accountService.upsertAccount).toHaveBeenCalledWith(
        'mbna',
        expect.objectContaining({
          syncEnabled: false,
          monarchAccount: null,
        }),
      );
    });

    it('should set account logo on newly created accounts', async () => {
      accountService.getMonarchAccountMapping.mockReturnValue(null);
      accountService.getAccountData.mockReturnValue(null);

      const newlyCreatedAccount = {
        id: 'monarch-new',
        displayName: 'New MBNA Card',
        newlyCreated: true,
      };
      showMonarchAccountSelectorWithCreate.mockImplementation((_accounts, callback) => {
        callback(newlyCreatedAccount);
      });
      monarchApi.setAccountLogo.mockResolvedValue(true);

      await uploadMbnaAccount(SAMPLE_ACCOUNT, mockApi);

      expect(monarchApi.setAccountLogo).toHaveBeenCalledWith(
        'monarch-new',
        'production/account_logos/test/mbna-logo',
      );
    });
  });
});