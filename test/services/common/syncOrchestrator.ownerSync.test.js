/**
 * Tests for the `ownerSync` progress step in the generic orchestrator
 *
 * Two things matter about this step's placement:
 *
 * 1. It only exists when the account has opted into owner mapping — everyone
 *    else must see the exact step list they saw before.
 * 2. It runs AFTER the transaction upload, because the rows it updates are the
 *    ones the upload just created. Running it earlier would find nothing and
 *    push attribution a whole sync later.
 */

import { syncAccount } from '../../../src/services/common/syncOrchestrator';

vi.mock('../../../src/core/utils', () => ({
  debugLog: vi.fn(),
  getTodayLocal: vi.fn(() => '2024-01-15'),
  getLastUpdateDate: vi.fn(() => '2024-01-10'),
  calculateFromDateWithLookback: vi.fn(() => '2024-01-01'),
  formatDaysAgoLocal: vi.fn(() => '2024-01-01'),
  computeExtendedFromDate: vi.fn((from) => from),
}));

vi.mock('../../../src/core/state', () => ({ default: { setAccount: vi.fn() } }));

vi.mock('../../../src/core/integrationCapabilities', () => ({
  ACCOUNT_SETTINGS: {
    INCLUDE_PENDING_TRANSACTIONS: 'includePendingTransactions',
    CARDHOLDER_OWNER_MODE: 'cardholderOwnerMode',
    CARDHOLDER_TAG_MODE: 'cardholderTagMode',
  },
}));

vi.mock('../../../src/services/common/accountService', () => ({
  default: {
    getAccountData: vi.fn(() => ({ includePendingTransactions: false })),
    updateAccountInList: vi.fn(),
    incrementSyncCount: vi.fn(() => 1),
    isReadyForLegacyCleanup: vi.fn(() => false),
    cleanupLegacyStorage: vi.fn(),
  },
}));

vi.mock('../../../src/services/common/accountMappingResolver', () => ({
  resolveAccountMapping: vi.fn(),
}));
vi.mock('../../../src/services/common/creditLimitSync', () => ({ syncCreditLimit: vi.fn() }));
vi.mock('../../../src/services/common/balanceUpload', () => ({
  executeBalanceUploadStep: vi.fn(() => Promise.resolve({ success: true, message: '$0', monarchBalance: 0 })),
}));
vi.mock('../../../src/services/common/transactionUpload', () => ({
  uploadTransactionsAndSaveRefs: vi.fn(() => Promise.resolve(true)),
  formatTransactionUploadMessage: vi.fn(() => '1 settled uploaded'),
}));
vi.mock('../../../src/services/common/deduplication', () => ({
  filterDuplicateSettledTransactions: vi.fn((i, a, txs) => ({ newTransactions: txs, duplicateCount: 0 })),
  filterDuplicatePendingTransactions: vi.fn((i, a, txs) => ({ newTransactions: txs, duplicateCount: 0 })),
}));
vi.mock('../../../src/services/common/pendingReconciliation', () => ({
  fetchMonarchPendingTransactions: vi.fn(),
  reconcileFetchedPendingTransactions: vi.fn(),
  separateAndDeduplicateTransactions: vi.fn(({ settled, pending }) => Promise.resolve({
    settled, pending, duplicatesRemoved: 0, settledIdMap: new Map(), pendingIdMap: new Map(),
  })),
  formatReconciliationMessage: vi.fn(() => 'No pending transactions'),
}));
vi.mock('../../../src/utils/csv', () => ({
  convertToCSV: vi.fn(() => 'Date,Merchant\n2024-01-15,Amazon'),
  MONARCH_CSV_COLUMNS: ['Date', 'Merchant', 'Category', 'Account', 'Original Statement', 'Notes', 'Amount', 'Tags', 'Owner'],
  buildMonarchTags: vi.fn(() => ''),
  resolveNotesTransactionId: vi.fn(() => ''),
}));
vi.mock('../../../src/ui/components/progressDialog', () => ({ showProgressDialog: vi.fn() }));
vi.mock('../../../src/ui/components/datePicker', () => ({ showDatePickerWithOptionsPromise: vi.fn() }));
vi.mock('../../../src/ui/components/cardholderSelector', () => ({ showCardholderSelector: vi.fn() }));

vi.mock('../../../src/services/common/cardholders', () => ({
  syncCardholders: vi.fn(() => Promise.resolve({ cardholders: {}, shouldTag: false, shouldMapOwner: true })),
  applyCardholderFields: vi.fn((txs) => txs),
  collectOwnerAssignments: vi.fn(() => new Map([['test-tx:aaaa', 'user-1']])),
  getOwnerMode: vi.fn(() => 'off'),
}));

vi.mock('../../../src/services/common/ownerSync', () => ({
  syncTransactionOwners: vi.fn(() => Promise.resolve({
    success: true, updated: 1, alreadyOwned: 0, unmatched: 0, failed: 0, deferred: 0, error: null,
  })),
  buildOwnerResolver: vi.fn(() => () => 'user-1'),
  formatOwnerSyncMessage: vi.fn(() => '1 owner set'),
}));

import { getOwnerMode } from '../../../src/services/common/cardholders';
import { syncTransactionOwners, buildOwnerResolver } from '../../../src/services/common/ownerSync';
import * as balanceUploadModule from '../../../src/services/common/balanceUpload';

const createProgressDialog = () => ({
  initSteps: vi.fn(),
  updateStepStatus: vi.fn(),
  updateProgress: vi.fn(),
  updateBalanceChange: vi.fn(),
  onCancel: vi.fn(),
  hideCancel: vi.fn(),
  showSummary: vi.fn(),
});

const hooks = () => ({
  fetchTransactions: vi.fn(() => Promise.resolve({
    settled: [{ date: '2024-01-15', description: 'Amazon', amount: 10, referenceNumber: 'R1' }],
    pending: [],
    metadata: null,
  })),
  processTransactions: vi.fn((settled) => ({
    settled: settled.map((tx) => ({ ...tx, isPending: false })),
    pending: [],
  })),
  getSettledRefId: vi.fn((tx) => tx.referenceNumber),
  getPendingRefId: vi.fn(() => null),
  resolveCategories: vi.fn((txs) => Promise.resolve(txs)),
  buildTransactionNotes: vi.fn(() => ''),
  getPendingIdFields: vi.fn((tx) => [tx.date]),
  getSettledAmount: vi.fn((tx) => -tx.amount),
  extractCardholder: vi.fn(() => ({ name: 'MYKHAILO DELEGAN', cardLast4: '8584' })),
});

const manifest = (capabilities = {}) => ({
  id: 'test',
  displayName: 'Test',
  txIdPrefix: 'test-tx',
  capabilities: {
    hasTransactions: true, hasCreditLimit: false, hasCardholders: true, ...capabilities,
  },
});

const run = async (progressDialog, overrides = {}) => syncAccount({
  integrationId: 'test',
  manifest: manifest(),
  hooks: hooks(),
  api: { getBalance: vi.fn(() => Promise.resolve({ currentBalance: 0 })) },
  account: { accountId: 'acc-1' },
  accountDisplayName: 'Test Card',
  monarchAccount: { id: 'monarch-1' },
  fromDate: '2024-01-01',
  progressDialog,
  ...overrides,
});

/** Step keys handed to the progress dialog */
const stepKeys = (progressDialog) => progressDialog.initSteps.mock.calls[0][1].map((s) => s.key);

beforeEach(() => {
  vi.clearAllMocks();
  getOwnerMode.mockReturnValue('off');
});

describe('step list when owner mapping is off (the default)', () => {
  it('does not include the ownerSync step', async () => {
    const progressDialog = createProgressDialog();

    await run(progressDialog);

    expect(stepKeys(progressDialog)).not.toContain('ownerSync');
  });

  it('leaves the pre-existing step list untouched', async () => {
    const progressDialog = createProgressDialog();

    await run(progressDialog);

    expect(stepKeys(progressDialog)).toEqual(['transactions', 'balance']);
  });

  it('does not run the owner sync pass at all', async () => {
    await run(createProgressDialog());

    expect(syncTransactionOwners).not.toHaveBeenCalled();
  });
});

describe('step list when owner mapping is on', () => {
  beforeEach(() => {
    getOwnerMode.mockReturnValue('on');
  });

  it('includes the ownerSync step', async () => {
    const progressDialog = createProgressDialog();

    await run(progressDialog);

    expect(stepKeys(progressDialog)).toContain('ownerSync');
  });

  it('places ownerSync between transactions and balance', async () => {
    const progressDialog = createProgressDialog();

    await run(progressDialog);

    const keys = stepKeys(progressDialog);
    expect(keys.indexOf('ownerSync')).toBeGreaterThan(keys.indexOf('transactions'));
    expect(keys.indexOf('ownerSync')).toBeLessThan(keys.indexOf('balance'));
  });

  it('runs the owner sync pass', async () => {
    await run(createProgressDialog());

    expect(syncTransactionOwners).toHaveBeenCalledWith(expect.objectContaining({
      monarchAccountId: 'monarch-1',
      txIdPrefix: 'test-tx',
    }));
  });

  it('builds the resolver from the collected owner assignments', async () => {
    await run(createProgressDialog());

    expect(buildOwnerResolver).toHaveBeenCalledWith(new Map([['test-tx:aaaa', 'user-1']]));
  });

  it('reports the result on the ownerSync step', async () => {
    const progressDialog = createProgressDialog();

    await run(progressDialog);

    expect(progressDialog.updateStepStatus).toHaveBeenCalledWith(
      'acc-1', 'ownerSync', 'success', '1 owner set',
    );
  });

  it('marks the step as errored when the pass reports failure', async () => {
    syncTransactionOwners.mockResolvedValueOnce({
      success: false, updated: 0, alreadyOwned: 0, unmatched: 0, failed: 0, deferred: 0, error: 'boom',
    });
    const progressDialog = createProgressDialog();

    await run(progressDialog);

    expect(progressDialog.updateStepStatus).toHaveBeenCalledWith(
      'acc-1', 'ownerSync', 'error', expect.any(String),
    );
  });

  it('still uploads the balance after an owner sync failure', async () => {
    const { executeBalanceUploadStep } = balanceUploadModule;
    syncTransactionOwners.mockResolvedValueOnce({
      success: false, updated: 0, alreadyOwned: 0, unmatched: 0, failed: 0, deferred: 0, error: 'boom',
    });

    const result = await run(createProgressDialog());

    expect(executeBalanceUploadStep).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('omits the step when the integration has no txIdPrefix to correlate with', async () => {
    const progressDialog = createProgressDialog();

    await syncAccount({
      integrationId: 'test',
      manifest: { ...manifest(), txIdPrefix: null },
      hooks: hooks(),
      api: { getBalance: vi.fn(() => Promise.resolve({ currentBalance: 0 })) },
      account: { accountId: 'acc-1' },
      accountDisplayName: 'Test Card',
      monarchAccount: { id: 'monarch-1' },
      fromDate: '2024-01-01',
      progressDialog,
    });

    expect(stepKeys(progressDialog)).not.toContain('ownerSync');
    expect(syncTransactionOwners).not.toHaveBeenCalled();
  });

  it('omits the step for an integration without cardholder support', async () => {
    const progressDialog = createProgressDialog();

    await syncAccount({
      integrationId: 'test',
      manifest: manifest({ hasCardholders: false }),
      hooks: hooks(),
      api: { getBalance: vi.fn(() => Promise.resolve({ currentBalance: 0 })) },
      account: { accountId: 'acc-1' },
      accountDisplayName: 'Test Card',
      monarchAccount: { id: 'monarch-1' },
      fromDate: '2024-01-01',
      progressDialog,
    });

    expect(stepKeys(progressDialog)).not.toContain('ownerSync');
  });
});