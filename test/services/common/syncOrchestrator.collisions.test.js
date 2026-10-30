/**
 * Orchestrator-level coverage for hash-colliding settled transactions.
 *
 * The other syncOrchestrator suites mock `separateAndDeduplicateTransactions`
 * with a pass-through, which makes them structurally incapable of catching a
 * transaction dropped inside it — that is how the collapse survived. This suite
 * deliberately uses the REAL pendingReconciliation module so a drop shows up at
 * the CSV/upload boundary, where the user would feel it.
 */

import { syncAccount } from '../../../src/services/common/syncOrchestrator';

// ── Mocks ───────────────────────────────────────────────────
//
// Note what is NOT mocked: src/services/common/pendingReconciliation.

vi.mock('../../../src/core/utils', () => ({
  debugLog: vi.fn(),
  getTodayLocal: vi.fn(() => '2024-03-05'),
  getLastUpdateDate: vi.fn(() => null),
  calculateFromDateWithLookback: vi.fn(() => '2024-03-01'),
  formatDaysAgoLocal: vi.fn(() => '2024-03-01'),
  computeExtendedFromDate: vi.fn((fromDate) => fromDate),
  formatDate: vi.fn((d) => d.toISOString().split('T')[0]),
}));

// Real reconciliation runs, so the Monarch API is stubbed instead. No "Pending"
// tag → Phase 1 short-circuits and no reconciliation writes are attempted.
vi.mock('../../../src/api/monarch', () => ({
  default: {
    getTagByName: vi.fn(() => Promise.resolve(null)),
    getTransactionsList: vi.fn(() => Promise.resolve({ results: [] })),
    updateTransaction: vi.fn(),
    setTransactionTags: vi.fn(),
    deleteTransaction: vi.fn(),
  },
}));

vi.mock('../../../src/core/state', () => ({
  default: { setAccount: vi.fn() },
}));

vi.mock('../../../src/services/common/accountMappingResolver', () => ({
  resolveAccountMapping: vi.fn(() => Promise.resolve({
    monarchAccount: { id: 'monarch-1', displayName: 'Test Monarch Account' },
  })),
}));

vi.mock('../../../src/ui/components/progressDialog', () => ({
  showProgressDialog: vi.fn(),
}));

vi.mock('../../../src/ui/components/datePicker', () => ({
  showDatePickerWithOptionsPromise: vi.fn(),
}));

vi.mock('../../../src/core/integrationCapabilities', () => ({
  ACCOUNT_SETTINGS: {
    INCLUDE_PENDING_TRANSACTIONS: 'includePendingTransactions',
    CARDHOLDER_OWNER_MODE: 'cardholderOwnerMode',
    CARDHOLDER_TAG_MODE: 'cardholderTagMode',
  },
}));

vi.mock('../../../src/services/common/accountService', () => ({
  default: {
    getAccountData: vi.fn(() => ({
      includePendingTransactions: true,
      storeTransactionDetailsInNotes: false,
    })),
    updateAccountInList: vi.fn(),
    incrementSyncCount: vi.fn(() => 1),
    isReadyForLegacyCleanup: vi.fn(() => false),
    cleanupLegacyStorage: vi.fn(),
  },
}));

vi.mock('../../../src/services/common/creditLimitSync', () => ({
  syncCreditLimit: vi.fn(() => Promise.resolve({ success: true, message: '$5,000' })),
}));

vi.mock('../../../src/services/common/balanceUpload', () => ({
  executeBalanceUploadStep: vi.fn(() => Promise.resolve({ success: true, message: '$100.00', monarchBalance: -100 })),
}));

vi.mock('../../../src/services/common/transactionUpload', () => ({
  uploadTransactionsAndSaveRefs: vi.fn(() => Promise.resolve(true)),
  formatTransactionUploadMessage: vi.fn(() => 'uploaded'),
}));

vi.mock('../../../src/services/common/deduplication', () => ({
  filterDuplicateSettledTransactions: vi.fn((id, acct, txs) => ({
    newTransactions: txs,
    duplicateCount: 0,
  })),
  filterDuplicatePendingTransactions: vi.fn((id, acct, txs) => ({
    newTransactions: txs,
    duplicateCount: 0,
  })),
}));

vi.mock('../../../src/utils/csv', () => ({
  // Capture the row objects so the assertions can inspect what reaches the CSV
  convertToCSV: vi.fn((rows) => JSON.stringify(rows)),
  MONARCH_CSV_COLUMNS: ['Date', 'Merchant', 'Amount', 'Notes', 'Id'],
  buildMonarchTags: vi.fn(() => ''),
}));

vi.mock('../../../src/services/common/cardholders', () => ({
  syncCardholders: vi.fn(() => Promise.resolve({ cardholders: {}, shouldTag: false, shouldMapOwner: false })),
  applyCardholderFields: vi.fn((txs) => txs),
  collectOwnerAssignments: vi.fn(() => new Map()),
  getOwnerMode: vi.fn(() => 'off'),
}));

vi.mock('../../../src/services/common/ownerSync', () => ({
  syncTransactionOwners: vi.fn(() => Promise.resolve({ success: true, noPendingOwners: true })),
  buildOwnerResolver: vi.fn(() => () => null),
  formatOwnerSyncMessage: vi.fn(() => 'None pending'),
}));

vi.mock('../../../src/ui/components/cardholderSelector', () => ({
  showCardholderSelector: vi.fn(() => Promise.resolve(null)),
}));

import { uploadTransactionsAndSaveRefs } from '../../../src/services/common/transactionUpload';
import { convertToCSV } from '../../../src/utils/csv';

// ── Fixtures ────────────────────────────────────────────────

/** Two identical coffees on the same card on the same day — a certain collision. */
const coffeeA = {
  transactionDate: '2024-03-04', description: 'TIM HORTONS', amount: 2.35, endingIn: '4321', referenceNumber: 'REF-AAA',
};
const coffeeB = { ...coffeeA, referenceNumber: 'REF-BBB' };

function createMockProgressDialog() {
  return {
    initSteps: vi.fn(),
    updateStepStatus: vi.fn(),
    updateProgress: vi.fn(),
    updateBalanceChange: vi.fn(),
    onCancel: vi.fn(),
    hideCancel: vi.fn(),
    showSummary: vi.fn(),
  };
}

/** Hooks shaped like MBNA's: the id fields carry no unique discriminator. */
function createMockHooks(rawSettled) {
  return {
    fetchTransactions: vi.fn(() => Promise.resolve({
      settled: rawSettled,
      pending: [],
      metadata: { statements: [], currentCycle: { settled: [] } },
    })),
    processTransactions: vi.fn((settled) => ({
      settled: settled.map((tx) => ({
        date: tx.transactionDate,
        merchant: tx.description,
        originalStatement: tx.description,
        amount: -tx.amount,
        referenceNumber: tx.referenceNumber || '',
        txHashId: tx.txHashId,
        isPending: false,
        pendingId: null,
        autoCategory: null,
      })),
      pending: [],
    })),
    getSettledRefId: vi.fn((tx) => tx.referenceNumber),
    getPendingRefId: vi.fn((tx) => tx.pendingId),
    resolveCategories: vi.fn((txs) => Promise.resolve(txs)),
    buildTransactionNotes: vi.fn(() => ''),
    getPendingIdFields: vi.fn((tx) => [
      tx.transactionDate || '',
      tx.description || '',
      tx.amount !== undefined && tx.amount !== null ? String(tx.amount) : '',
      tx.endingIn || '',
    ]),
    getSettledAmount: vi.fn((tx) => -tx.amount),
    buildBalanceHistory: vi.fn(() => null),
  };
}

const manifest = {
  id: 'test',
  displayName: 'Test',
  txIdPrefix: 'mbna-tx',
  capabilities: {
    hasTransactions: true,
    hasDeduplication: true,
    hasBalanceHistory: true,
    hasCreditLimit: false,
    hasHoldings: false,
    hasBalanceReconstruction: false,
    hasCategorization: true,
  },
};

async function runSync(rawSettled) {
  const hooks = createMockHooks(rawSettled);
  const progressDialog = createMockProgressDialog();

  const result = await syncAccount({
    integrationId: 'test',
    manifest,
    hooks,
    api: { getBalance: vi.fn(() => Promise.resolve({ currentBalance: 100 })) },
    account: { accountId: 'acc-1' },
    accountDisplayName: 'Test Card',
    monarchAccount: { id: 'monarch-1' },
    fromDate: '2024-03-01',
    progressDialog,
  });

  return { result, hooks };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ───────────────────────────────────────────────────

describe('syncAccount with real separation — hash-colliding settled transactions', () => {
  it('uploads both members of a colliding settled pair', async () => {
    const { result, hooks } = await runSync([coffeeA, coffeeB]);

    expect(result.success).toBe(true);

    // Nothing was dropped between fetch and process…
    const [settledPassedToProcess] = hooks.processTransactions.mock.calls[0];
    expect(settledPassedToProcess).toHaveLength(2);
    expect(settledPassedToProcess.map((tx) => tx.referenceNumber)).toEqual(['REF-AAA', 'REF-BBB']);

    // …and both rows reach the CSV.
    const csvRows = convertToCSV.mock.calls[0][0];
    expect(csvRows).toHaveLength(2);

    // …and both reference numbers reach the dedup store, so neither is re-uploaded
    // and neither is permanently lost.
    const { transactionRefs } = uploadTransactionsAndSaveRefs.mock.calls[0][0];
    expect(transactionRefs.map((ref) => ref.id).sort()).toEqual(['REF-AAA', 'REF-BBB']);
  });

  it('gives the colliding rows the same txHashId, not distinct ones', async () => {
    const { hooks } = await runSync([coffeeA, coffeeB]);

    const [settledPassedToProcess] = hooks.processTransactions.mock.calls[0];
    expect(settledPassedToProcess[0].txHashId).toMatch(/^mbna-tx:[a-f0-9]{16}$/);
    expect(settledPassedToProcess[1].txHashId).toBe(settledPassedToProcess[0].txHashId);
  });

  it('keeps settled count equal to the fetched count at the separation boundary', async () => {
    const lunch = {
      transactionDate: '2024-03-04', description: 'SUBWAY', amount: 14.99, endingIn: '4321', referenceNumber: 'REF-LUNCH',
    };
    const rawSettled = [coffeeA, lunch, coffeeB];

    const { hooks } = await runSync(rawSettled);

    const [settledPassedToProcess] = hooks.processTransactions.mock.calls[0];
    expect(settledPassedToProcess).toHaveLength(rawSettled.length);
    // Oldest-first input order survives, which the dedup-ref reversal relies on.
    expect(settledPassedToProcess.map((tx) => tx.referenceNumber)).toEqual([
      'REF-AAA', 'REF-LUNCH', 'REF-BBB',
    ]);
  });
});
