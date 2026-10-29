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

vi.mock('../../../src/api/questrade', () => ({
  __esModule: true,
  default: { fetchAccounts: vi.fn(), makeApiCall: vi.fn(), getAccount: vi.fn() },
  fetchAccounts: vi.fn(),
  makeApiCall: vi.fn(),
}));

vi.mock('../../../src/api/monarch', () => ({
  __esModule: true,
  default: { uploadBalance: vi.fn(), uploadTransactions: vi.fn(), listAccounts: vi.fn() },
  uploadBalance: vi.fn(),
  uploadTransactions: vi.fn(),
}));

vi.mock('../../../src/services/common/accountService', () => ({
  __esModule: true,
  default: {
    getAccounts: vi.fn(),
    getAccountData: vi.fn(),
    getMonarchAccountMapping: vi.fn(),
    upsertAccount: vi.fn(),
    updateAccountInList: vi.fn(),
  },
}));

vi.mock('../../../src/ui/components/progressDialog', () => ({
  showProgressDialog: vi.fn(),
}));

vi.mock('../../../src/ui/components/monarchLoginLink', () => ({
  ensureMonarchAuthentication: vi.fn(),
}));

vi.mock('../../../src/ui/toast', () => ({
  __esModule: true,
  default: { show: vi.fn() },
  show: vi.fn(),
}));

vi.mock('../../../src/core/state', () => ({
  __esModule: true,
  default: {
    setAccount: vi.fn(),
    getState: vi.fn(() => ({ currentAccount: { nickname: 'Test Account' } })),
  },
}));

vi.mock('../../../src/core/utils', async () => {
  const actual = await vi.importActual('../../../src/core/utils');
  return {
    ...actual,
    saveLastUploadDate: vi.fn(),
    getLastUpdateDate: vi.fn(() => '2025-01-01'),
    calculateFromDateWithLookback: vi.fn(() => '2025-01-01'),
    getTodayLocal: vi.fn(() => '2025-02-01'),
  };
});

vi.mock('../../../src/services/questrade/accountMapping', () => ({
  ensureAccountMapping: vi.fn(),
  ensureAllAccountMappings: vi.fn(),
}));

vi.mock('../../../src/services/questrade/positions', () => ({
  __esModule: true,
  default: { processAccountPositions: vi.fn() },
}));

vi.mock('../../../src/services/questrade/transactions', () => ({
  __esModule: true,
  default: {
    processAndUploadOrders: vi.fn(),
    processAndUploadActivityTransactions: vi.fn(),
  },
}));

// The balance module is mocked except for storeDateRange: the real one must run so the
// tests assert on the actual watermark write (saveLastUploadDate) rather than on a stub.
vi.mock('../../../src/services/questrade/balance', async () => {
  const actual = await vi.importActual('../../../src/services/questrade/balance');
  return {
    ...actual,
    __esModule: true,
    default: { processAndUploadBalance: vi.fn() },
    fetchBalanceHistory: vi.fn(),
    extractBalanceChange: vi.fn(() => null),
    getAccountsForSync: vi.fn(),
    markAccountAsClosed: vi.fn(),
  };
});

globalThis.GM_getValue = vi.fn();
globalThis.GM_setValue = vi.fn();

import * as utils from '../../../src/core/utils';
import * as balanceModule from '../../../src/services/questrade/balance';
import positionsService from '../../../src/services/questrade/positions';
import transactionsService from '../../../src/services/questrade/transactions';
import * as syncModule from '../../../src/services/questrade/sync';
import { showProgressDialog } from '../../../src/ui/components/progressDialog';
import { ensureMonarchAuthentication } from '../../../src/ui/components/monarchLoginLink';
import { ensureAllAccountMappings } from '../../../src/services/questrade/accountMapping';

const { syncAccountToMonarch, syncAllAccountsToMonarch } = syncModule.default;

const FROM_DATE = '2025-01-01';
const TO_DATE = '2025-02-01';

function makeProgressDialog() {
  return {
    updateProgress: vi.fn(),
    updateBalanceChange: vi.fn(),
    updateStepStatus: vi.fn(),
    initSteps: vi.fn(),
    hideCancel: vi.fn(),
    showSummary: vi.fn(),
    showError: vi.fn().mockResolvedValue(undefined),
    onCancel: vi.fn(),
    close: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();

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
