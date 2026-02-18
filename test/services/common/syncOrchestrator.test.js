/**
 * Tests for the generic sync orchestrator
 */

import { syncAccount } from '../../../src/services/common/syncOrchestrator';

// ── Mocks ───────────────────────────────────────────────────

jest.mock('../../../src/core/utils', () => ({
  debugLog: jest.fn(),
  getTodayLocal: jest.fn(() => '2024-01-15'),
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

// Get reference to the mocked account service
const mockAccountService = require('../../../src/services/common/accountService').default;

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