/**
 * Tests for the source-trust signal the orchestrator threads into Phase 2
 *
 * A `fetchTransactions` hook that degrades on a partial failure (MBNA drops the
 * whole statement history when the closing-date list cannot be read) returns
 * `sourceDataComplete: false`. The orchestrator must carry that flag into
 * `reconcileFetchedPendingTransactions`, because that is the only place that can
 * decline to read "absent from the feed" as "cancelled at source" and delete the
 * Monarch row along with the user's categories, notes, splits and tags.
 *
 * Unlike `syncOrchestrator.test.js` and `syncOrchestrator.ownerSync.test.js`, the
 * reconciliation module here is NOT replaced by pass-through stubs: Phase 2 and
 * `separateAndDeduplicateTransactions` run for real behind a spy, so a test that
 * passes proves the real deletion path was exercised rather than a mock of it.
 */

import { syncAccount } from '../../../src/services/common/syncOrchestrator';

vi.mock('../../../src/core/utils', () => ({
  debugLog: vi.fn(),
  getTodayLocal: vi.fn(() => '2024-01-15'),
  getLastUpdateDate: vi.fn(() => '2024-01-10'),
  calculateFromDateWithLookback: vi.fn(() => '2024-01-01'),
  formatDaysAgoLocal: vi.fn(() => '2024-01-01'),
  computeExtendedFromDate: vi.fn((from) => from),
  formatDate: vi.fn((d) => d.toISOString().split('T')[0]),
}));

vi.mock('../../../src/api/monarch', () => ({
  __esModule: true,
  default: {
    getTagByName: vi.fn(),
    getTransactionsList: vi.fn(),
    updateTransaction: vi.fn(() => Promise.resolve({})),
    setTransactionTags: vi.fn(() => Promise.resolve({})),
    deleteTransaction: vi.fn(() => Promise.resolve({})),
  },
}));

vi.mock('../../../src/core/state', () => ({ __esModule: true, default: { setAccount: vi.fn() } }));

vi.mock('../../../src/core/integrationCapabilities', () => ({
  ACCOUNT_SETTINGS: {
    INCLUDE_PENDING_TRANSACTIONS: 'includePendingTransactions',
    CARDHOLDER_OWNER_MODE: 'cardholderOwnerMode',
    CARDHOLDER_TAG_MODE: 'cardholderTagMode',
  },
}));

vi.mock('../../../src/services/common/accountService', () => ({
  __esModule: true,
  default: {
    getAccountData: vi.fn(() => ({
      includePendingTransactions: true,
      transactionRetentionDays: 91,
      uploadedTransactions: [],
    })),
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

// Phase 1 is stubbed (it only talks to Monarch); everything else — Phase 2, the
// hash maps, the deletion decision — is the real implementation behind a spy.
vi.mock('../../../src/services/common/pendingReconciliation', async () => {
  const actual = await vi.importActual('../../../src/services/common/pendingReconciliation');
  return {
    ...actual,
    fetchMonarchPendingTransactions: vi.fn(),
    reconcileFetchedPendingTransactions: vi.fn(actual.reconcileFetchedPendingTransactions),
  };
});

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
  syncCardholders: vi.fn(() => Promise.resolve({ cardholders: {}, shouldTag: false, shouldMapOwner: false })),
  applyCardholderFields: vi.fn((txs) => txs),
  collectOwnerAssignments: vi.fn(() => new Map()),
  getOwnerMode: vi.fn(() => 'off'),
}));

// ── Setup ───────────────────────────────────────────────────

import monarchApi from '../../../src/api/monarch';
import { fetchMonarchPendingTransactions, reconcileFetchedPendingTransactions, generatePendingTransactionId } from '../../../src/services/common/pendingReconciliation';
import * as cryptoModule from 'crypto';

beforeAll(() => {
  if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.subtle) {
    const { webcrypto } = cryptoModule;
    globalThis.crypto = webcrypto;
  }
});

const TX_ID_PREFIX = 'test-tx';
const PENDING_TAG = { id: 'tag-pending', name: 'Pending' };

/** The source transaction the Monarch pending row was created from */
const AGED_HOLD_TX = { date: '2024-01-02', description: 'FAIRMONT HOTEL', amount: 412, referenceNumber: 'R-HOLD' };
/** A source transaction whose hash never matches the hold */
const UNRELATED_TX = { date: '2024-01-14', description: 'UNRELATED', amount: 9.99, referenceNumber: 'R-OTHER' };

const getPendingIdFields = (tx) => [tx.date, tx.description, String(tx.amount)];

const createProgressDialog = () => ({
  initSteps: vi.fn(),
  updateStepStatus: vi.fn(),
  updateProgress: vi.fn(),
  updateBalanceChange: vi.fn(),
  onCancel: vi.fn(),
  hideCancel: vi.fn(),
  showSummary: vi.fn(),
});

/** Hooks whose fetch returns `settled` plus whatever trust flag the test wants */
const hooks = (fetchResult) => ({
  fetchTransactions: vi.fn(() => Promise.resolve(fetchResult)),
  processTransactions: vi.fn((settled) => ({
    settled: settled.map((tx) => ({ ...tx, isPending: false })),
    pending: [],
  })),
  getSettledRefId: vi.fn((tx) => tx.referenceNumber),
  getPendingRefId: vi.fn(() => null),
  resolveCategories: vi.fn((txs) => Promise.resolve(txs)),
  buildTransactionNotes: vi.fn(() => ''),
  getPendingIdFields: vi.fn(getPendingIdFields),
  getSettledAmount: vi.fn((tx) => -tx.amount),
});

const manifest = {
  id: 'test',
  displayName: 'Test',
  txIdPrefix: TX_ID_PREFIX,
  capabilities: { hasTransactions: true, hasCreditLimit: false, hasCardholders: false },
};

const run = async (fetchResult) => syncAccount({
  integrationId: 'test',
  manifest,
  hooks: hooks(fetchResult),
  api: { getBalance: vi.fn(() => Promise.resolve({ currentBalance: 0 })) },
  account: { accountId: 'acc-1' },
  accountDisplayName: 'Test Card',
  monarchAccount: { id: 'monarch-1' },
  fromDate: '2024-01-01',
  progressDialog: createProgressDialog(),
});

let holdHashId;

beforeAll(async () => {
  holdHashId = await generatePendingTransactionId(TX_ID_PREFIX, getPendingIdFields(AGED_HOLD_TX));
});

beforeEach(() => {
  vi.clearAllMocks();
  // Monarch holds one pending row, created from AGED_HOLD_TX
  fetchMonarchPendingTransactions.mockResolvedValue({
    pendingTag: PENDING_TAG,
    monarchPendingTransactions: [{
      id: 'mtx-1',
      notes: holdHashId,
      amount: -412,
      date: '2024-01-02',
      tags: [PENDING_TAG],
      ownedByUser: null,
    }],
    oldestPendingDate: '2024-01-02',
  });
});

// ── Tests ───────────────────────────────────────────────────

describe('orchestrator threads sourceDataComplete into Phase 2', () => {
  it('passes false through when the fetch hook reports a partial fetch', async () => {
    await run({ settled: [UNRELATED_TX], pending: [], metadata: null, sourceDataComplete: false });

    expect(reconcileFetchedPendingTransactions).toHaveBeenCalledWith(
      expect.objectContaining({ sourceDataComplete: false }),
    );
  });

  it('passes true through when the fetch hook reports a complete fetch', async () => {
    await run({ settled: [UNRELATED_TX], pending: [], metadata: null, sourceDataComplete: true });

    expect(reconcileFetchedPendingTransactions).toHaveBeenCalledWith(
      expect.objectContaining({ sourceDataComplete: true }),
    );
  });

  it('defaults to true when the fetch hook omits the flag', async () => {
    // All-or-nothing hooks never report completeness; their feeds must keep working
    await run({ settled: [UNRELATED_TX], pending: [], metadata: null });

    expect(reconcileFetchedPendingTransactions).toHaveBeenCalledWith(
      expect.objectContaining({ sourceDataComplete: true }),
    );
  });
});

describe('orchestrator deletion behaviour through the real Phase 2', () => {
  it('deletes nothing when the fetch hook reports a partial fetch', async () => {
    await run({ settled: [UNRELATED_TX], pending: [], metadata: null, sourceDataComplete: false });

    expect(monarchApi.deleteTransaction).not.toHaveBeenCalled();
  });

  it('deletes nothing when the feed came back empty', async () => {
    await run({ settled: [], pending: [], metadata: null, sourceDataComplete: true });

    expect(monarchApi.deleteTransaction).not.toHaveBeenCalled();
  });

  it('still deletes a genuinely cancelled hold on a complete, non-empty fetch', async () => {
    await run({ settled: [UNRELATED_TX], pending: [], metadata: null, sourceDataComplete: true });

    expect(monarchApi.deleteTransaction).toHaveBeenCalledWith('mtx-1');
  });

  it('settles rather than deletes when the hold appears as settled', async () => {
    await run({ settled: [AGED_HOLD_TX], pending: [], metadata: null, sourceDataComplete: true });

    expect(monarchApi.deleteTransaction).not.toHaveBeenCalled();
    expect(monarchApi.setTransactionTags).toHaveBeenCalledWith('mtx-1', []);
  });
});
