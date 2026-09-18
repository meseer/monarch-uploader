/**
 * Regression tests for Questrade sync-date (watermark) advancement.
 *
 * The sync date must only advance over a window whose transactions actually reached
 * Monarch. Questrade's default lookback is 0 days, so a watermark advanced past a failed
 * orders/activity step would make the next sync start after the transactions that were
 * never uploaded - they are not in the dedup store either, so nothing would ever
 * re-upload them and they would be permanently missing from Monarch.
 */

import accountService from '../../../src/services/common/accountService';

jest.mock('../../../src/api/questrade', () => ({
  __esModule: true,
  default: { fetchAccounts: jest.fn(), makeApiCall: jest.fn(), getAccount: jest.fn() },
  fetchAccounts: jest.fn(),
  makeApiCall: jest.fn(),
}));

jest.mock('../../../src/api/monarch', () => ({
  __esModule: true,
  default: { uploadBalance: jest.fn(), uploadTransactions: jest.fn(), listAccounts: jest.fn() },
  uploadBalance: jest.fn(),
  uploadTransactions: jest.fn(),
}));

jest.mock('../../../src/services/common/accountService', () => ({
  __esModule: true,
  default: {
    getAccounts: jest.fn(),
    getAccountData: jest.fn(),
    getMonarchAccountMapping: jest.fn(),
    upsertAccount: jest.fn(),
    updateAccountInList: jest.fn(),
  },
}));

jest.mock('../../../src/ui/components/progressDialog', () => ({
  showProgressDialog: jest.fn(),
}));

jest.mock('../../../src/ui/components/monarchLoginLink', () => ({
  ensureMonarchAuthentication: jest.fn(),
}));

jest.mock('../../../src/ui/toast', () => ({
  __esModule: true,
  default: { show: jest.fn() },
  show: jest.fn(),
}));

jest.mock('../../../src/core/state', () => ({
  __esModule: true,
  default: {
    setAccount: jest.fn(),
    getState: jest.fn(() => ({ currentAccount: { nickname: 'Test Account' } })),
  },
}));

jest.mock('../../../src/core/utils', () => {
  const actual = jest.requireActual('../../../src/core/utils');
  return {
    ...actual,
    saveLastUploadDate: jest.fn(),
    getLastUpdateDate: jest.fn(() => '2025-01-01'),
    calculateFromDateWithLookback: jest.fn(() => '2025-01-01'),
    getTodayLocal: jest.fn(() => '2025-02-01'),
  };
});

jest.mock('../../../src/services/questrade/accountMapping', () => ({
  ensureAccountMapping: jest.fn(),
  ensureAllAccountMappings: jest.fn(),
}));

jest.mock('../../../src/services/questrade/positions', () => ({
  __esModule: true,
  default: { processAccountPositions: jest.fn() },
}));

jest.mock('../../../src/services/questrade/transactions', () => ({
  __esModule: true,
  default: {
    processAndUploadOrders: jest.fn(),
    processAndUploadActivityTransactions: jest.fn(),
  },
}));

// The balance module is mocked except for storeDateRange: the real one must run so the
// tests assert on the actual watermark write (saveLastUploadDate) rather than on a stub.
jest.mock('../../../src/services/questrade/balance', () => {
  const actual = jest.requireActual('../../../src/services/questrade/balance');
  return {
    ...actual,
    __esModule: true,
    default: { processAndUploadBalance: jest.fn() },
    fetchBalanceHistory: jest.fn(),
    extractBalanceChange: jest.fn(() => null),
    getAccountsForSync: jest.fn(),
    markAccountAsClosed: jest.fn(),
  };
});

globalThis.GM_getValue = jest.fn();
globalThis.GM_setValue = jest.fn();

const utils = require('../../../src/core/utils');
const balanceModule = require('../../../src/services/questrade/balance');
const positionsService = require('../../../src/services/questrade/positions').default;
const transactionsService = require('../../../src/services/questrade/transactions').default;
const syncModule = require('../../../src/services/questrade/sync');
const { showProgressDialog } = require('../../../src/ui/components/progressDialog');
const { ensureMonarchAuthentication } = require('../../../src/ui/components/monarchLoginLink');
const { ensureAllAccountMappings } = require('../../../src/services/questrade/accountMapping');

const { syncAccountToMonarch, syncAllAccountsToMonarch } = syncModule.default;

const FROM_DATE = '2025-01-01';
const TO_DATE = '2025-02-01';

function makeProgressDialog() {
  return {
    updateProgress: jest.fn(),
    updateBalanceChange: jest.fn(),
    updateStepStatus: jest.fn(),
    initSteps: jest.fn(),
    hideCancel: jest.fn(),
    showSummary: jest.fn(),
    showError: jest.fn().mockResolvedValue(undefined),
    onCancel: jest.fn(),
    close: jest.fn(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();

  // Happy path: balance uploads, positions sync, both transaction steps succeed
  balanceModule.default.processAndUploadBalance.mockResolvedValue(true);
  balanceModule.fetchBalanceHistory.mockResolvedValue({ history: { data: [] } });
  balanceModule.extractBalanceChange.mockReturnValue(null);
  positionsService.processAccountPositions.mockResolvedValue({
    success: true, positionsProcessed: 0, positionsSkipped: 0,
  });
  transactionsService.processAndUploadOrders.mockResolvedValue({
    success: true, ordersProcessed: 1, skippedDuplicates: 0,
  });
  transactionsService.processAndUploadActivityTransactions.mockResolvedValue({
    success: true, transactionsProcessed: 1, skippedDuplicates: 0,
  });
  accountService.getMonarchAccountMapping.mockReturnValue({ id: 'monarch-acc1', displayName: 'M Acc' });
});

describe('syncAccountToMonarch — sync date advancement', () => {
  test('advances the sync date once when balance and both transaction steps succeed', async () => {
    const result = await syncAccountToMonarch('acc1', 'Acc 1', FROM_DATE, TO_DATE, makeProgressDialog());

    expect(result).toBe(true);
    expect(utils.saveLastUploadDate).toHaveBeenCalledTimes(1);
    expect(utils.saveLastUploadDate).toHaveBeenCalledWith('acc1', TO_DATE, 'questrade');
  });

  test('tells the balance step not to advance the date itself', async () => {
    await syncAccountToMonarch('acc1', 'Acc 1', FROM_DATE, TO_DATE, makeProgressDialog());

    expect(balanceModule.default.processAndUploadBalance).toHaveBeenCalledWith(
      'acc1',
      'Acc 1',
      FROM_DATE,
      TO_DATE,
      { advanceSyncDate: false },
    );
  });

  test('does NOT advance the sync date when the orders step reports failure', async () => {
    transactionsService.processAndUploadOrders.mockResolvedValue({
      success: false, message: 'Upload to Monarch failed', ordersProcessed: 0,
    });

    const result = await syncAccountToMonarch('acc1', 'Acc 1', FROM_DATE, TO_DATE, makeProgressDialog());

    expect(result).toBe(false);
    expect(utils.saveLastUploadDate).not.toHaveBeenCalled();
  });

  test('does NOT advance the sync date when the orders step throws', async () => {
    transactionsService.processAndUploadOrders.mockRejectedValue(new Error('network down'));

    const result = await syncAccountToMonarch('acc1', 'Acc 1', FROM_DATE, TO_DATE, makeProgressDialog());

    expect(result).toBe(false);
    expect(utils.saveLastUploadDate).not.toHaveBeenCalled();
  });

  test('does NOT advance the sync date when the activity step reports failure', async () => {
    transactionsService.processAndUploadActivityTransactions.mockResolvedValue({
      success: false, message: 'Upload to Monarch failed', transactionsProcessed: 0,
    });

    const result = await syncAccountToMonarch('acc1', 'Acc 1', FROM_DATE, TO_DATE, makeProgressDialog());

    expect(result).toBe(false);
    expect(utils.saveLastUploadDate).not.toHaveBeenCalled();
  });

  test('does NOT advance the sync date when the activity step throws', async () => {
    transactionsService.processAndUploadActivityTransactions.mockRejectedValue(new Error('timeout'));

    const result = await syncAccountToMonarch('acc1', 'Acc 1', FROM_DATE, TO_DATE, makeProgressDialog());

    expect(result).toBe(false);
    expect(utils.saveLastUploadDate).not.toHaveBeenCalled();
  });

  test('does NOT advance the sync date when the orders step succeeds but activity fails', async () => {
    transactionsService.processAndUploadActivityTransactions.mockRejectedValue(new Error('timeout'));

    await syncAccountToMonarch('acc1', 'Acc 1', FROM_DATE, TO_DATE, makeProgressDialog());

    // The orders step itself must not write the watermark either
    expect(transactionsService.processAndUploadOrders).toHaveBeenCalled();
    expect(utils.saveLastUploadDate).not.toHaveBeenCalled();
  });

  test('does NOT advance the sync date when no Monarch mapping exists for transactions', async () => {
    accountService.getMonarchAccountMapping.mockReturnValue(null);

    const result = await syncAccountToMonarch('acc1', 'Acc 1', FROM_DATE, TO_DATE, makeProgressDialog());

    expect(result).toBe(false);
    expect(utils.saveLastUploadDate).not.toHaveBeenCalled();
  });

  test('still advances the sync date when only the positions step fails', async () => {
    positionsService.processAccountPositions.mockRejectedValue(new Error('positions down'));

    const result = await syncAccountToMonarch('acc1', 'Acc 1', FROM_DATE, TO_DATE, makeProgressDialog());

    // Positions are holdings, not transactions - they do not gate the transaction watermark
    expect(result).toBe(true);
    expect(utils.saveLastUploadDate).toHaveBeenCalledWith('acc1', TO_DATE, 'questrade');
  });

  test('does not advance the sync date when the balance step fails', async () => {
    balanceModule.default.processAndUploadBalance.mockResolvedValue(false);

    await expect(
      syncAccountToMonarch('acc1', 'Acc 1', FROM_DATE, TO_DATE, makeProgressDialog()),
    ).rejects.toThrow('Balance sync failed');

    expect(utils.saveLastUploadDate).not.toHaveBeenCalled();
  });

  test('marks the failing transaction step as an error in the progress dialog', async () => {
    transactionsService.processAndUploadActivityTransactions.mockRejectedValue(new Error('timeout'));
    const dialog = makeProgressDialog();

    await syncAccountToMonarch('acc1', 'Acc 1', FROM_DATE, TO_DATE, dialog);

    expect(dialog.updateStepStatus).toHaveBeenCalledWith('acc1', 'activity', 'error', 'timeout');
  });
});

describe('syncAllAccountsToMonarch — reporting a transaction failure', () => {
  let dialog;

  beforeEach(() => {
    dialog = makeProgressDialog();
    showProgressDialog.mockReturnValue(dialog);
    ensureMonarchAuthentication.mockResolvedValue(true);
    ensureAllAccountMappings.mockResolvedValue(true);
    balanceModule.getAccountsForSync.mockResolvedValue([
      { key: 'acc1', nickname: 'Acc 1', createdOn: '2024-01-01T00:00:00Z' },
    ]);
    accountService.getAccountData.mockReturnValue({ syncEnabled: true });
  });

  test('counts a clean sync as a success and advances the date', async () => {
    await syncAllAccountsToMonarch();

    expect(utils.saveLastUploadDate).toHaveBeenCalledWith('acc1', TO_DATE, 'questrade');
    expect(dialog.showSummary).toHaveBeenCalledWith(
      expect.objectContaining({ success: 1, failed: 0 }),
    );
  });

  test('counts a swallowed transaction failure as failed instead of reporting success', async () => {
    transactionsService.processAndUploadOrders.mockRejectedValue(new Error('network down'));

    await syncAllAccountsToMonarch();

    expect(utils.saveLastUploadDate).not.toHaveBeenCalled();
    expect(dialog.showSummary).toHaveBeenCalledWith(
      expect.objectContaining({ success: 0, failed: 1 }),
    );
    expect(dialog.updateProgress).toHaveBeenCalledWith(
      'acc1',
      'error',
      'Transactions incomplete - will retry next sync',
    );
  });

  test('keeps syncing the remaining accounts after a transaction failure', async () => {
    balanceModule.getAccountsForSync.mockResolvedValue([
      { key: 'acc1', nickname: 'Acc 1' },
      { key: 'acc2', nickname: 'Acc 2' },
    ]);
    transactionsService.processAndUploadOrders.mockImplementation((accountId) => {
      if (accountId === 'acc1') return Promise.reject(new Error('network down'));
      return Promise.resolve({ success: true, ordersProcessed: 0, skippedDuplicates: 0 });
    });

    await syncAllAccountsToMonarch();

    // acc2 still synced and advanced; acc1 did not
    expect(utils.saveLastUploadDate).toHaveBeenCalledTimes(1);
    expect(utils.saveLastUploadDate).toHaveBeenCalledWith('acc2', TO_DATE, 'questrade');
    expect(dialog.showSummary).toHaveBeenCalledWith(
      expect.objectContaining({ success: 1, failed: 1 }),
    );
  });

  test('does not mark a pending_close account as closed when a transaction step failed', async () => {
    balanceModule.getAccountsForSync.mockResolvedValue([
      { key: 'acc1', nickname: 'Acc 1', status: 'pending_close' },
    ]);
    transactionsService.processAndUploadActivityTransactions.mockResolvedValue({
      success: false, message: 'Upload failed', transactionsProcessed: 0,
    });

    await syncAllAccountsToMonarch();

    // Closing the account would forfeit its last chance to sync those transactions
    expect(balanceModule.markAccountAsClosed).not.toHaveBeenCalled();
    expect(utils.saveLastUploadDate).not.toHaveBeenCalled();
  });

  test('marks a pending_close account as closed after a clean final sync', async () => {
    balanceModule.getAccountsForSync.mockResolvedValue([
      { key: 'acc1', nickname: 'Acc 1', status: 'pending_close' },
    ]);

    await syncAllAccountsToMonarch();

    expect(balanceModule.markAccountAsClosed).toHaveBeenCalledWith('acc1');
  });
});
