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

jest.mock('../../../src/core/utils', () => ({
  debugLog: jest.fn(),
  getTodayLocal: jest.fn(() => '2024-03-05'),
  getLastUpdateDate: jest.fn(() => null),
  calculateFromDateWithLookback: jest.fn(() => '2024-03-01'),
  formatDaysAgoLocal: jest.fn(() => '2024-03-01'),
  computeExtendedFromDate: jest.fn((fromDate) => fromDate),
  formatDate: jest.fn((d) => d.toISOString().split('T')[0]),
}));

// Real reconciliation runs, so the Monarch API is stubbed instead. No "Pending"
// tag → Phase 1 short-circuits and no reconciliation writes are attempted.
jest.mock('../../../src/api/monarch', () => ({
  __esModule: true,
  default: {
    getTagByName: jest.fn(() => Promise.resolve(null)),
    getTransactionsList: jest.fn(() => Promise.resolve({ results: [] })),
    updateTransaction: jest.fn(),
    setTransactionTags: jest.fn(),
    deleteTransaction: jest.fn(),
  },
}));

jest.mock('../../../src/core/state', () => ({
  __esModule: true,
  default: { setAccount: jest.fn() },
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
  ACCOUNT_SETTINGS: {
    INCLUDE_PENDING_TRANSACTIONS: 'includePendingTransactions',
    CARDHOLDER_OWNER_MODE: 'cardholderOwnerMode',
    CARDHOLDER_TAG_MODE: 'cardholderTagMode',
  },
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
  formatTransactionUploadMessage: jest.fn(() => 'uploaded'),
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

jest.mock('../../../src/utils/csv', () => ({
  // Capture the row objects so the assertions can inspect what reaches the CSV
  convertToCSV: jest.fn((rows) => JSON.stringify(rows)),
  MONARCH_CSV_COLUMNS: ['Date', 'Merchant', 'Amount', 'Notes', 'Id'],
  buildMonarchTags: jest.fn(() => ''),
}));

jest.mock('../../../src/services/common/cardholders', () => ({
  syncCardholders: jest.fn(() => Promise.resolve({ cardholders: {}, shouldTag: false, shouldMapOwner: false })),
  applyCardholderFields: jest.fn((txs) => txs),
  collectOwnerAssignments: jest.fn(() => new Map()),
  getOwnerMode: jest.fn(() => 'off'),
}));

jest.mock('../../../src/services/common/ownerSync', () => ({
  syncTransactionOwners: jest.fn(() => Promise.resolve({ success: true, noPendingOwners: true })),
  buildOwnerResolver: jest.fn(() => () => null),
  formatOwnerSyncMessage: jest.fn(() => 'None pending'),
}));

jest.mock('../../../src/ui/components/cardholderSelector', () => ({
  showCardholderSelector: jest.fn(() => Promise.resolve(null)),
}));

const { uploadTransactionsAndSaveRefs } = require('../../../src/services/common/transactionUpload');
const { convertToCSV } = require('../../../src/utils/csv');

// ── Fixtures ────────────────────────────────────────────────

/** Two identical coffees on the same card on the same day — a certain collision. */
const coffeeA = {
  transactionDate: '2024-03-04', description: 'TIM HORTONS', amount: 2.35, endingIn: '4321', referenceNumber: 'REF-AAA',
};
const coffeeB = { ...coffeeA, referenceNumber: 'REF-BBB' };

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

/** Hooks shaped like MBNA's: the id fields carry no unique discriminator. */
function createMockHooks(rawSettled) {
  return {
    fetchTransactions: jest.fn(() => Promise.resolve({
      settled: rawSettled,
      pending: [],
      metadata: { statements: [], currentCycle: { settled: [] } },
    })),
    processTransactions: jest.fn((settled) => ({
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
    getSettledRefId: jest.fn((tx) => tx.referenceNumber),
    getPendingRefId: jest.fn((tx) => tx.pendingId),
    resolveCategories: jest.fn((txs) => Promise.resolve(txs)),
    buildTransactionNotes: jest.fn(() => ''),
    getPendingIdFields: jest.fn((tx) => [
      tx.transactionDate || '',
      tx.description || '',
      tx.amount !== undefined && tx.amount !== null ? String(tx.amount) : '',
      tx.endingIn || '',
    ]),
    getSettledAmount: jest.fn((tx) => -tx.amount),
    buildBalanceHistory: jest.fn(() => null),
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
    api: { getBalance: jest.fn(() => Promise.resolve({ currentBalance: 100 })) },
    account: { accountId: 'acc-1' },
    accountDisplayName: 'Test Card',
    monarchAccount: { id: 'monarch-1' },
    fromDate: '2024-03-01',
    progressDialog,
  });

  return { result, hooks };
}

beforeEach(() => {
  jest.clearAllMocks();
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
