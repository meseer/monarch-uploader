/**
 * Tests for the generic sync orchestrator
 */

import { syncAccount, prepareAndSyncAccount } from '../../../src/services/common/syncOrchestrator';

// ── Mocks ───────────────────────────────────────────────────

jest.mock('../../../src/core/utils', () => ({
  debugLog: jest.fn(),
  getTodayLocal: jest.fn(() => '2024-01-15'),
  getLastUpdateDate: jest.fn(() => null),
  calculateFromDateWithLookback: jest.fn(() => '2024-01-01'),
  formatDaysAgoLocal: jest.fn((days) => {
    const d = new Date(2024, 0, 15); // matches getTodayLocal mock
    d.setDate(d.getDate() - days);
    return d.toISOString().split('T')[0];
  }),
}));

jest.mock('../../../src/core/state', () => ({
  __esModule: true,
  default: {
    setAccount: jest.fn(),
  },
}));

jest.mock('../../../src/services/common/accountMappingResolver', () => ({
  resolveAccountMapping: jest.fn(() => Promise.resolve({
    monarchAccount: { id: 'monarch-1', displayName: 'Test Monarch Account' },
  })),
}));

jest.mock('../../../src/ui/components/progressDialog', () => ({
  showProgressDialog: jest.fn(),
}));

jest.mock('../../../src/ui/components/datePicker', () => ({
  showDatePickerWithOptionsPromise: jest.fn(),
}));

jest.mock('../../../src/core/integrationCapabilities', () => ({
  ACCOUNT_SETTINGS: { INCLUDE_PENDING_TRANSACTIONS: 'includePendingTransactions' },
}));

jest.mock('../../../src/services/common/accountService', () => ({
  __esModule: true,
  default: {
    getAccountData: jest.fn(() => ({
      includePendingTransactions: true,
      storeTransactionDetailsInNotes: false,
    })),
    updateAccountInList: jest.fn(),
    incrementSyncCount: jest.fn(() => 1),
    isReadyForLegacyCleanup: jest.fn(() => false),
    cleanupLegacyStorage: jest.fn(),
  },
}));

jest.mock('../../../src/services/common/creditLimitSync', () => ({
  syncCreditLimit: jest.fn(() => Promise.resolve({ success: true, message: '$5,000' })),
}));

jest.mock('../../../src/services/common/balanceUpload', () => ({
  executeBalanceUploadStep: jest.fn(() => Promise.resolve({ success: true, message: '$100.00', monarchBalance: -100 })),
}));

jest.mock('../../../src/services/common/transactionUpload', () => ({
  uploadTransactionsAndSaveRefs: jest.fn(() => Promise.resolve(true)),
  formatTransactionUploadMessage: jest.fn((s, p, d) => {
    const parts = [];
    if (s > 0) parts.push(`${s} settled`);
    if (p > 0) parts.push(`${p} pending`);
    if (parts.length === 0 && d > 0) return `${d} already uploaded`;
    if (parts.length === 0) return 'No new';
    const msg = parts.join(', ') + ' uploaded';
    return d > 0 ? `${msg} (${d} skipped)` : msg;
  }),
}));

jest.mock('../../../src/services/common/deduplication', () => ({
  filterDuplicateSettledTransactions: jest.fn((id, acct, txs) => ({
    newTransactions: txs,
    duplicateCount: 0,
  })),
  filterDuplicatePendingTransactions: jest.fn((id, acct, txs) => ({
    newTransactions: txs,
    duplicateCount: 0,
  })),
}));

jest.mock('../../../src/services/common/pendingReconciliation', () => ({
  reconcilePendingTransactions: jest.fn(() => Promise.resolve({ success: true, settled: 0, cancelled: 0, failed: 0, noPendingTransactions: true })),
  separateAndDeduplicateTransactions: jest.fn(({ settled, pending }) => Promise.resolve({
    settled,
    pending: pending.map((tx, i) => ({ ...tx, generatedId: `test-tx:${i}`, isPending: true })),
    duplicatesRemoved: 0,
    settledIdMap: new Map(),
    pendingIdMap: new Map(),
  })),
  formatReconciliationMessage: jest.fn(() => 'No pending transactions'),
}));

jest.mock('../../../src/utils/csv', () => ({
  convertToCSV: jest.fn(() => 'Date,Merchant\n2024-01-15,Amazon'),
}));

// Get references to the mocked modules
const mockAccountService = require('../../../src/services/common/accountService').default;
const { resolveAccountMapping } = require('../../../src/services/common/accountMappingResolver');
const { getLastUpdateDate } = require('../../../src/core/utils');
const { showProgressDialog } = require('../../../src/ui/components/progressDialog');
const { showDatePickerWithOptionsPromise } = require('../../../src/ui/components/datePicker');
const stateManager = require('../../../src/core/state').default;

// ── Helpers ─────────────────────────────────────────────────

function createMockProgressDialog() {
  return {
    initSteps: jest.fn(),
    updateStepStatus: jest.fn(),
    updateProgress: jest.fn(),
    updateBalanceChange: jest.fn(),
    onCancel: jest.fn(),
    hideCancel: jest.fn(),
    showSummary: jest.fn(),
  };
}

function createMockHooks() {
  return {
    fetchTransactions: jest.fn(() => Promise.resolve({
      settled: [{ date: '2024-01-15', description: 'Amazon', amount: 42.50, referenceNumber: 'REF1' }],
      pending: [],
      metadata: { statements: [], currentCycle: { settled: [] } },
    })),
    processTransactions: jest.fn((settled, pending) => ({
      settled: settled.map((tx) => ({
        date: tx.date,
        merchant: 'Amazon',
        originalStatement: tx.description,
        amount: -tx.amount,
        referenceNumber: tx.referenceNumber || '',
        isPending: false,
        pendingId: null,
        autoCategory: null,
      })),
      pending: pending.map((tx) => ({
        date: tx.date,
        merchant: tx.description,
        originalStatement: tx.description,
        amount: -tx.amount,
        referenceNumber: '',
        isPending: true,
        pendingId: tx.generatedId || null,
        autoCategory: null,
      })),
    })),
    getSettledRefId: jest.fn((tx) => tx.referenceNumber),
    getPendingRefId: jest.fn((tx) => tx.pendingId),
    resolveCategories: jest.fn((txs) => Promise.resolve(txs.map((tx) => ({ ...tx, resolvedMonarchCategory: 'Shopping' })))),
    buildTransactionNotes: jest.fn(() => ''),
    getPendingIdFields: jest.fn((tx) => [tx.date, tx.description, String(tx.amount)]),
    getSettledAmount: jest.fn((tx) => -tx.amount),
    buildBalanceHistory: jest.fn(() => null),
  };
}

function createMockApi() {
  return {
    getCreditLimit: jest.fn(() => Promise.resolve(5000)),
    getBalance: jest.fn(() => Promise.resolve({ currentBalance: 100 })),
    getTransactions: jest.fn(),
  };
}

const defaultManifest = {
  id: 'test',
  displayName: 'Test',
  txIdPrefix: 'test-tx',
  capabilities: {
    hasTransactions: true,
    hasDeduplication: true,
    hasBalanceHistory: true,
    hasCreditLimit: true,
    hasHoldings: false,
    hasBalanceReconstruction: true,
    hasCategorization: true,
  },
};

// ── Tests ───────────────────────────────────────────────────

function createMockProgressDialogForPrepare() {
  return {
    initSteps: jest.fn(),
    updateStepStatus: jest.fn(),
    updateProgress: jest.fn(),
    updateBalanceChange: jest.fn(),
    onCancel: jest.fn(),
    hideCancel: jest.fn(),
    showSummary: jest.fn(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAccountService.getAccountData.mockReturnValue({
    includePendingTransactions: true,
    storeTransactionDetailsInNotes: false,
  });
});

describe('syncAccount', () => {
  it('should execute full sync workflow successfully', async () => {
    const progressDialog = createMockProgressDialog();
    const hooks = createMockHooks();
    const api = createMockApi();

    const result = await syncAccount({
      integrationId: 'test',
      manifest: defaultManifest,
      hooks,
      api,
      account: { accountId: 'acc-1' },
      accountDisplayName: 'Test Card',
      monarchAccount: { id: 'monarch-1' },
      fromDate: '2024-01-01',
      progressDialog,
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain('Balance uploaded');
    expect(progressDialog.initSteps).toHaveBeenCalled();
    expect(hooks.fetchTransactions).toHaveBeenCalled();
    expect(hooks.processTransactions).toHaveBeenCalled();
    expect(hooks.resolveCategories).toHaveBeenCalled();
    expect(progressDialog.showSummary).toHaveBeenCalledWith({ success: 1, failed: 0, total: 1 });
  });

  it('should skip credit limit step when capability is disabled', async () => {
    const { syncCreditLimit } = require('../../../src/services/common/creditLimitSync');
    const progressDialog = createMockProgressDialog();
    const hooks = createMockHooks();
    const api = createMockApi();

    const manifest = {
      ...defaultManifest,
      capabilities: { ...defaultManifest.capabilities, hasCreditLimit: false },
    };

    await syncAccount({
      integrationId: 'test',
      manifest,
      hooks,
      api,
      account: { accountId: 'acc-1' },
      accountDisplayName: 'Test Card',
      monarchAccount: { id: 'monarch-1' },
      fromDate: '2024-01-01',
      progressDialog,
    });

    expect(syncCreditLimit).not.toHaveBeenCalled();
  });

  it('should skip transactions step when capability is disabled', async () => {
    const progressDialog = createMockProgressDialog();
    const hooks = createMockHooks();
    const api = createMockApi();

    const manifest = {
      ...defaultManifest,
      capabilities: { ...defaultManifest.capabilities, hasTransactions: false },
    };

    await syncAccount({
      integrationId: 'test',
      manifest,
      hooks,
      api,
      account: { accountId: 'acc-1' },
      accountDisplayName: 'Test Card',
      monarchAccount: { id: 'monarch-1' },
      fromDate: '2024-01-01',
      progressDialog,
    });

    expect(hooks.fetchTransactions).not.toHaveBeenCalled();
  });

  it('should handle sync errors gracefully', async () => {
    const progressDialog = createMockProgressDialog();
    const hooks = createMockHooks();
    hooks.fetchTransactions.mockRejectedValue(new Error('API Error'));
    const api = createMockApi();

    const result = await syncAccount({
      integrationId: 'test',
      manifest: defaultManifest,
      hooks,
      api,
      account: { accountId: 'acc-1' },
      accountDisplayName: 'Test Card',
      monarchAccount: { id: 'monarch-1' },
      fromDate: '2024-01-01',
      progressDialog,
    });

    expect(result.success).toBe(false);
    expect(result.message).toBe('API Error');
    expect(progressDialog.showSummary).toHaveBeenCalledWith({ success: 0, failed: 1, total: 1 });
  });

  it('should update sync metadata after successful sync', async () => {
    const progressDialog = createMockProgressDialog();
    const hooks = createMockHooks();
    const api = createMockApi();

    await syncAccount({
      integrationId: 'test',
      manifest: defaultManifest,
      hooks,
      api,
      account: { accountId: 'acc-1' },
      accountDisplayName: 'Test Card',
      monarchAccount: { id: 'monarch-1' },
      fromDate: '2024-01-01',
      progressDialog,
    });

    expect(mockAccountService.updateAccountInList).toHaveBeenCalledWith('test', 'acc-1', {
      lastSyncDate: '2024-01-15',
    });
    expect(mockAccountService.incrementSyncCount).toHaveBeenCalledWith('test', 'acc-1');
  });

  it('should call buildBalanceHistory on firstSync with reconstructBalance', async () => {
    const progressDialog = createMockProgressDialog();
    const hooks = createMockHooks();
    hooks.buildBalanceHistory.mockReturnValue([{ date: '2024-01-10', amount: -50 }]);
    const api = createMockApi();

    await syncAccount({
      integrationId: 'test',
      manifest: defaultManifest,
      hooks,
      api,
      account: { accountId: 'acc-1' },
      accountDisplayName: 'Test Card',
      monarchAccount: { id: 'monarch-1' },
      fromDate: '2024-01-01',
      reconstructBalance: true,
      firstSync: true,
      progressDialog,
    });

    expect(hooks.buildBalanceHistory).toHaveBeenCalled();
  });

  it('should NOT call buildBalanceHistory on firstSync when reconstructBalance is false', async () => {
    const progressDialog = createMockProgressDialog();
    const hooks = createMockHooks();
    const api = createMockApi();

    await syncAccount({
      integrationId: 'test',
      manifest: defaultManifest,
      hooks,
      api,
      account: { accountId: 'acc-1' },
      accountDisplayName: 'Test Card',
      monarchAccount: { id: 'monarch-1' },
      fromDate: '2024-01-01',
      reconstructBalance: false,
      firstSync: true,
      progressDialog,
    });

    expect(hooks.buildBalanceHistory).not.toHaveBeenCalled();
  });

  it('should call buildBalanceHistory on subsequent sync when hook and metadata are available', async () => {
    const progressDialog = createMockProgressDialog();
    const hooks = createMockHooks();
    hooks.buildBalanceHistory.mockReturnValue([
      { date: '2024-01-14', amount: -80 },
      { date: '2024-01-15', amount: -100 },
    ]);
    const api = createMockApi();

    const { executeBalanceUploadStep } = require('../../../src/services/common/balanceUpload');

    await syncAccount({
      integrationId: 'test',
      manifest: defaultManifest,
      hooks,
      api,
      account: { accountId: 'acc-1' },
      accountDisplayName: 'Test Card',
      monarchAccount: { id: 'monarch-1' },
      fromDate: '2024-01-10',
      reconstructBalance: false,
      firstSync: false,
      progressDialog,
    });

    expect(hooks.buildBalanceHistory).toHaveBeenCalledWith(expect.objectContaining({
      currentBalance: 100,
      fromDate: '2024-01-10',
    }));

    // Should pass reconstructBalance: true and the built history to balance upload
    expect(executeBalanceUploadStep).toHaveBeenCalledWith(expect.objectContaining({
      reconstructBalance: true,
      balanceHistory: expect.arrayContaining([
        expect.objectContaining({ date: '2024-01-14' }),
      ]),
    }));
  });

  it('should NOT reconstruct on subsequent sync when buildBalanceHistory hook is missing', async () => {
    const progressDialog = createMockProgressDialog();
    const hooks = createMockHooks();
    hooks.buildBalanceHistory = undefined; // No reconstruction hook
    const api = createMockApi();

    const { executeBalanceUploadStep } = require('../../../src/services/common/balanceUpload');

    await syncAccount({
      integrationId: 'test',
      manifest: defaultManifest,
      hooks,
      api,
      account: { accountId: 'acc-1' },
      accountDisplayName: 'Test Card',
      monarchAccount: { id: 'monarch-1' },
      fromDate: '2024-01-10',
      firstSync: false,
      progressDialog,
    });

    // Should pass reconstructBalance: false since no hook
    expect(executeBalanceUploadStep).toHaveBeenCalledWith(expect.objectContaining({
      reconstructBalance: false,
      balanceHistory: null,
    }));
  });

  it('should handle all transactions being duplicates', async () => {
    const { filterDuplicateSettledTransactions } = require('../../../src/services/common/deduplication');
    filterDuplicateSettledTransactions.mockReturnValueOnce({ newTransactions: [], duplicateCount: 3 });

    const progressDialog = createMockProgressDialog();
    const hooks = createMockHooks();
    const api = createMockApi();

    const result = await syncAccount({
      integrationId: 'test',
      manifest: defaultManifest,
      hooks,
      api,
      account: { accountId: 'acc-1' },
      accountDisplayName: 'Test Card',
      monarchAccount: { id: 'monarch-1' },
      fromDate: '2024-01-01',
      progressDialog,
    });

    expect(result.success).toBe(true);
    // Transactions step was 'success' with duplicates message, not an error
    expect(progressDialog.updateStepStatus).toHaveBeenCalledWith(
      'acc-1', 'transactions', 'success', expect.any(String),
    );
  });
});

describe('prepareAndSyncAccount', () => {
  const prepareManifest = {
    ...defaultManifest,
    displayName: 'Test Integration',
    accountKeyName: 'testAccount',
    logoCloudinaryId: 'test-logo',
    accountCreateDefaults: {
      defaultType: 'credit',
      defaultSubtype: 'credit_card',
      accountType: 'credit',
    },
  };

  beforeEach(() => {
    const mockPD = createMockProgressDialogForPrepare();
    showProgressDialog.mockReturnValue(mockPD);
    getLastUpdateDate.mockReturnValue(null); // first sync by default
    showDatePickerWithOptionsPromise.mockResolvedValue({ date: '2024-01-01', reconstructBalance: true });
  });

  it('should set state manager before resolving mapping', async () => {
    const hooks = createMockHooks();
    hooks.buildAccountEntry = jest.fn((a) => ({ id: a.accountId }));
    const api = createMockApi();

    await prepareAndSyncAccount({
      integrationId: 'test',
      manifest: prepareManifest,
      hooks,
      api,
      account: { accountId: 'acc-1' },
      accountDisplayName: 'Test Card',
    });

    expect(stateManager.setAccount).toHaveBeenCalledWith('acc-1', 'Test Card');
  });

  it('should return skipped when mapping is skipped', async () => {
    resolveAccountMapping.mockResolvedValueOnce({ skipped: true });
    const hooks = createMockHooks();
    hooks.buildAccountEntry = jest.fn();
    const api = createMockApi();

    const result = await prepareAndSyncAccount({
      integrationId: 'test',
      manifest: prepareManifest,
      hooks,
      api,
      account: { accountId: 'acc-1' },
      accountDisplayName: 'Test Card',
    });

    expect(result).toEqual({ success: true, message: 'Skipped', skipped: true });
    expect(showProgressDialog).not.toHaveBeenCalled();
  });

  it('should return cancelled when mapping is cancelled', async () => {
    resolveAccountMapping.mockResolvedValueOnce({ cancelled: true });
    const hooks = createMockHooks();
    hooks.buildAccountEntry = jest.fn();
    const api = createMockApi();

    const result = await prepareAndSyncAccount({
      integrationId: 'test',
      manifest: prepareManifest,
      hooks,
      api,
      account: { accountId: 'acc-1' },
      accountDisplayName: 'Test Card',
    });

    expect(result).toEqual({ success: false, message: 'Cancelled' });
    expect(showProgressDialog).not.toHaveBeenCalled();
  });

  it('should show date picker on first sync', async () => {
    const hooks = createMockHooks();
    hooks.buildAccountEntry = jest.fn((a) => ({ id: a.accountId }));
    const api = createMockApi();

    await prepareAndSyncAccount({
      integrationId: 'test',
      manifest: prepareManifest,
      hooks,
      api,
      account: { accountId: 'acc-1' },
      accountDisplayName: 'Test Card',
    });

    expect(showDatePickerWithOptionsPromise).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('Test Card'),
      expect.objectContaining({ showReconstructCheckbox: true }),
    );
  });

  it('should return cancelled when date picker is cancelled', async () => {
    showDatePickerWithOptionsPromise.mockResolvedValueOnce(null);
    const hooks = createMockHooks();
    hooks.buildAccountEntry = jest.fn((a) => ({ id: a.accountId }));
    const api = createMockApi();

    const result = await prepareAndSyncAccount({
      integrationId: 'test',
      manifest: prepareManifest,
      hooks,
      api,
      account: { accountId: 'acc-1' },
      accountDisplayName: 'Test Card',
    });

    expect(result).toEqual({ success: false, message: 'Date selection cancelled' });
  });

  it('should call suggestStartDate hook on first sync when available', async () => {
    const hooks = createMockHooks();
    hooks.buildAccountEntry = jest.fn((a) => ({ id: a.accountId }));
    hooks.suggestStartDate = jest.fn(() => Promise.resolve({ date: '2023-10-01', description: 'test suggestion' }));
    const api = createMockApi();

    await prepareAndSyncAccount({
      integrationId: 'test',
      manifest: prepareManifest,
      hooks,
      api,
      account: { accountId: 'acc-1' },
      accountDisplayName: 'Test Card',
    });

    expect(hooks.suggestStartDate).toHaveBeenCalledWith(api, 'acc-1');
    expect(showDatePickerWithOptionsPromise).toHaveBeenCalledWith(
      '2023-10-01',
      expect.any(String),
      expect.any(Object),
    );
  });

  it('should use 90-day fallback when suggestStartDate returns null', async () => {
    const hooks = createMockHooks();
    hooks.buildAccountEntry = jest.fn((a) => ({ id: a.accountId }));
    hooks.suggestStartDate = jest.fn(() => Promise.resolve(null));
    const api = createMockApi();

    await prepareAndSyncAccount({
      integrationId: 'test',
      manifest: prepareManifest,
      hooks,
      api,
      account: { accountId: 'acc-1' },
      accountDisplayName: 'Test Card',
    });

    // Should have used a date ~90 days ago (not the hook's suggestion)
    const calledDate = showDatePickerWithOptionsPromise.mock.calls[0][0];
    expect(calledDate).toBeTruthy();
    expect(calledDate).not.toBe('2023-10-01');
  });

  it('should skip date picker on subsequent sync and use lookback', async () => {
    getLastUpdateDate.mockReturnValue('2024-01-10'); // not first sync
    const hooks = createMockHooks();
    hooks.buildAccountEntry = jest.fn((a) => ({ id: a.accountId }));
    const api = createMockApi();

    await prepareAndSyncAccount({
      integrationId: 'test',
      manifest: prepareManifest,
      hooks,
      api,
      account: { accountId: 'acc-1' },
      accountDisplayName: 'Test Card',
    });

    expect(showDatePickerWithOptionsPromise).not.toHaveBeenCalled();
  });

  it('should create progress dialog with manifest-driven title', async () => {
    const hooks = createMockHooks();
    hooks.buildAccountEntry = jest.fn((a) => ({ id: a.accountId }));
    const api = createMockApi();

    await prepareAndSyncAccount({
      integrationId: 'test',
      manifest: prepareManifest,
      hooks,
      api,
      account: { accountId: 'acc-1' },
      accountDisplayName: 'Test Card',
    });

    expect(showProgressDialog).toHaveBeenCalledWith(
      [expect.objectContaining({ key: 'acc-1', nickname: 'Test Card', name: 'Test Integration Upload' })],
      'Syncing Test Integration Data to Monarch Money',
    );
  });

  it('should pass buildAccountEntry hook to resolveAccountMapping', async () => {
    const hooks = createMockHooks();
    const mockBuildEntry = jest.fn((a) => ({ id: a.accountId }));
    hooks.buildAccountEntry = mockBuildEntry;
    const api = createMockApi();

    await prepareAndSyncAccount({
      integrationId: 'test',
      manifest: prepareManifest,
      hooks,
      api,
      account: { accountId: 'acc-1' },
      accountDisplayName: 'Test Card',
    });

    expect(resolveAccountMapping).toHaveBeenCalledWith(expect.objectContaining({
      buildAccountEntry: mockBuildEntry,
    }));
  });
});
