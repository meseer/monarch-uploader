/**
 * Tests for syncEnabled flag enforcement in Questrade sync/upload flows
 */

import {
  getAccountsForSync,
  uploadAllAccountsToMonarch,
} from '../../../src/services/questrade/balance';
import { syncAllAccountsToMonarch } from '../../../src/services/questrade/sync';
import questradeApi from '../../../src/api/questrade';
import accountService from '../../../src/services/common/accountService';
import { INTEGRATIONS } from '../../../src/core/integrationCapabilities';
import { ACCOUNT_STATUS } from '../../../src/core/config';

// Mock all external dependencies
vi.mock('../../../src/api/questrade', () => {
  const mock = {
    fetchAccounts: vi.fn(),
    makeApiCall: vi.fn(),
  };
  return { ...mock, default: mock };
});

vi.mock('../../../src/api/monarch', () => {
  const mock = {
    uploadBalance: vi.fn(),
    listAccounts: vi.fn(),
    validateAndRefreshAccountMapping: vi.fn(),
  };
  return { ...mock, default: mock };
});

vi.mock('../../../src/services/common/accountService', () => {
  const mock = {
    getAccounts: vi.fn(),
    getMonarchAccountMapping: vi.fn(),
    getAccountData: vi.fn(),
    upsertAccount: vi.fn(),
    updateAccountInList: vi.fn(),
  };
  return { ...mock, default: mock };
});

vi.mock('../../../src/ui/components/progressDialog', () => ({
  showProgressDialog: vi.fn(),
}));

vi.mock('../../../src/ui/components/monarchLoginLink', () => ({
  ensureMonarchAuthentication: vi.fn(),
}));

vi.mock('../../../src/ui/components/accountSelectorWithCreate', () => ({
  showMonarchAccountSelectorWithCreate: vi.fn(),
}));

vi.mock('../../../src/ui/components/datePicker', () => ({
  showDatePickerPromise: vi.fn(),
}));

vi.mock('../../../src/core/state', () => {
  const mock = {
    setAccount: vi.fn(),
    getState: vi.fn().mockReturnValue({ currentAccount: { name: 'Test' } }),
  };
  return { ...mock, default: mock };
});

vi.mock('../../../src/ui/toast', () => {
  const mock = {
    show: vi.fn(),
  };
  return { ...mock, default: mock };
});

vi.mock('../../../src/core/utils', async () => {
  const actual = await vi.importActual('../../../src/core/utils');
  return {
    ...actual,
    getLastUpdateDate: vi.fn().mockReturnValue('2025-01-01'),
    calculateFromDateWithLookback: vi.fn().mockReturnValue('2025-01-01'),
    saveLastUploadDate: vi.fn(),
    getTodayLocal: vi.fn().mockReturnValue('2025-02-01'),
    formatDaysAgoLocal: vi.fn().mockReturnValue('2025-01-15'),
  };
});

vi.mock('../../../src/services/questrade/positions', () => ({
  default: { processAccountPositions: vi.fn() },
  processAccountPositions: vi.fn(),
}));

vi.mock('../../../src/services/questrade/transactions', () => ({
  default: {
    processAndUploadOrders: vi.fn(),
    processAndUploadActivityTransactions: vi.fn(),
  },
  processAndUploadOrders: vi.fn(),
  processAndUploadActivityTransactions: vi.fn(),
}));

// We need to partially mock balance to test syncAllAccountsToMonarch without real API calls
// but let getAccountsForSync run through for the propagation tests
vi.mock('../../../src/services/questrade/balance', async () => {
  const actual = await vi.importActual('../../../src/services/questrade/balance');
  return {
    ...actual,
    fetchBalanceHistory: vi.fn(),
    extractBalanceChange: vi.fn().mockReturnValue(null),
    processBalanceData: vi.fn().mockReturnValue('"Date","Total"\n"2025-01-01","100"\n'),
    uploadBalanceToMonarch: vi.fn().mockResolvedValue(true),
    markAccountAsClosed: vi.fn(),
  };
});

globalThis.GM_getValue = vi.fn();
globalThis.GM_setValue = vi.fn();

import { showProgressDialog } from '../../../src/ui/components/progressDialog';
import { ensureMonarchAuthentication } from '../../../src/ui/components/monarchLoginLink';
import * as monarchModule from '../../../src/api/monarch';
import * as syncModule2 from '../../../src/services/questrade/sync';
import * as balanceModule from '../../../src/services/questrade/balance';
import * as positionsModule from '../../../src/services/questrade/positions';
import * as transactionsModule from '../../../src/services/questrade/transactions';

// Helper: build a minimal progress dialog mock
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

// Helper: build a consolidated Questrade account object as returned by fetchAccounts
function makeApiAccount(id, syncEnabled = true) {
  return {
    questradeAccount: {
      id,
      key: id,
      nickname: `Account ${id}`,
      name: `Account ${id}`,
    },
    monarchAccount: { id: `monarch-${id}`, displayName: `Monarch ${id}` },
    syncEnabled,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  ensureMonarchAuthentication.mockResolvedValue(true);
});

// ─────────────────────────────────────────────────────────────────────────────
// getAccountsForSync — syncEnabled propagation
// ─────────────────────────────────────────────────────────────────────────────
describe('getAccountsForSync — syncEnabled propagation', () => {
  beforeEach(() => {
    accountService.getAccounts.mockReturnValue([]); // no storage-only accounts
  });

  test('propagates syncEnabled: true from API account', async () => {
    questradeApi.fetchAccounts.mockResolvedValue([makeApiAccount('acc1', true)]);

    const accounts = await getAccountsForSync({ includeClosed: false });

    expect(accounts).toHaveLength(1);
    expect(accounts[0].syncEnabled).toBe(true);
  });

  test('propagates syncEnabled: false from API account', async () => {
    questradeApi.fetchAccounts.mockResolvedValue([makeApiAccount('acc1', false)]);

    const accounts = await getAccountsForSync({ includeClosed: false });

    expect(accounts).toHaveLength(1);
    expect(accounts[0].syncEnabled).toBe(false);
  });

  test('defaults syncEnabled to true when field is absent on API account', async () => {
    const accountWithoutFlag = {
      questradeAccount: { id: 'acc1', key: 'acc1', nickname: 'Acc 1' },
      monarchAccount: { id: 'monarch-acc1' },
      // syncEnabled intentionally omitted
    };
    questradeApi.fetchAccounts.mockResolvedValue([accountWithoutFlag]);

    const accounts = await getAccountsForSync({ includeClosed: false });

    expect(accounts[0].syncEnabled).toBe(true);
  });

  test('propagates syncEnabled: false from storage-only account', async () => {
    questradeApi.fetchAccounts.mockResolvedValue([]); // API returns nothing
    accountService.getAccounts.mockReturnValue([
      {
        questradeAccount: { id: 'stored1', key: 'stored1', nickname: 'Stored Acc' },
        monarchAccount: { id: 'monarch-stored1' },
        syncEnabled: false,
        status: undefined, // not closed
      },
    ]);

    const accounts = await getAccountsForSync({ includeClosed: false });

    expect(accounts).toHaveLength(1);
    expect(accounts[0].syncEnabled).toBe(false);
  });

  test('defaults syncEnabled to true for storage-only account without flag', async () => {
    questradeApi.fetchAccounts.mockResolvedValue([]);
    accountService.getAccounts.mockReturnValue([
      {
        questradeAccount: { id: 'stored2', key: 'stored2', nickname: 'Stored Acc 2' },
        monarchAccount: { id: 'monarch-stored2' },
        // syncEnabled intentionally omitted
      },
    ]);

    const accounts = await getAccountsForSync({ includeClosed: false });

    expect(accounts[0].syncEnabled).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// uploadAllAccountsToMonarch — syncEnabled skip enforcement
// ─────────────────────────────────────────────────────────────────────────────
describe('uploadAllAccountsToMonarch — syncEnabled skip', () => {
  // fetchBalanceHistory is an internal call within balance.js; we can't intercept it
  // via the module mock for the same file. Instead we assert on questradeApi.makeApiCall
  // (the external I/O boundary that fetchBalanceHistory reaches out to) and on
  // monarchApi.uploadBalance.
  const monarchApi = monarchModule;

  beforeEach(() => {
    accountService.getAccounts.mockReturnValue([]);
    // questradeApi.makeApiCall is called twice per account (current + history)
    questradeApi.makeApiCall
      .mockResolvedValue({
        totalEquity: { combined: [{ currencyCode: 'CAD', amount: 5000 }] },
        data: [{ date: '2025-01-01', totalEquity: 4900 }],
      });
    monarchApi.uploadBalance.mockResolvedValue(true);
    accountService.getMonarchAccountMapping.mockReturnValue({ id: 'monarch-acc1', displayName: 'M Acc' });
  });

  test('skips account with syncEnabled: false and updates progress as skipped', async () => {
    questradeApi.fetchAccounts.mockResolvedValue([makeApiAccount('acc1', false)]);
    // Mock getAccountData to return the account with syncEnabled: false
    accountService.getAccountData.mockReturnValue({
      questradeAccount: { id: 'acc1', key: 'acc1' },
      monarchAccount: { id: 'monarch-acc1', displayName: 'M Acc' },
      syncEnabled: false,
    });
    const dialog = makeProgressDialog();
    showProgressDialog.mockReturnValue(dialog);

    await uploadAllAccountsToMonarch();

    expect(dialog.updateProgress).toHaveBeenCalledWith('acc1', 'skipped', 'Sync disabled');
    // No API calls should have been made for the disabled account
    expect(questradeApi.makeApiCall).not.toHaveBeenCalled();
    expect(monarchApi.uploadBalance).not.toHaveBeenCalled();
  });

  test('processes account with syncEnabled: true normally', async () => {
    questradeApi.fetchAccounts.mockResolvedValue([makeApiAccount('acc1', true)]);
    const dialog = makeProgressDialog();
    showProgressDialog.mockReturnValue(dialog);

    await uploadAllAccountsToMonarch();

    // fetchBalanceHistory calls makeApiCall twice (balance + history)
    expect(questradeApi.makeApiCall).toHaveBeenCalled();
    expect(dialog.updateProgress).not.toHaveBeenCalledWith('acc1', 'skipped', 'Sync disabled');
  });

  test('skips disabled account but continues processing enabled accounts', async () => {
    questradeApi.fetchAccounts.mockResolvedValue([
      makeApiAccount('disabled1', false),
      makeApiAccount('enabled2', true),
    ]);
    // Mock getAccountData to return proper syncEnabled state for each account
    accountService.getAccountData.mockImplementation((integration, accountId) => {
      if (accountId === 'disabled1') {
        return {
          questradeAccount: { id: 'disabled1', key: 'disabled1' },
          monarchAccount: { id: 'monarch-disabled1', displayName: 'M Acc' },
          syncEnabled: false,
        };
      }
      return {
        questradeAccount: { id: accountId, key: accountId },
        monarchAccount: { id: `monarch-${accountId}`, displayName: 'M Acc' },
        syncEnabled: true,
      };
    });
    accountService.getMonarchAccountMapping.mockReturnValue({ id: 'monarch-enabled2', displayName: 'M Acc' });
    const dialog = makeProgressDialog();
    showProgressDialog.mockReturnValue(dialog);

    await uploadAllAccountsToMonarch();

    expect(dialog.updateProgress).toHaveBeenCalledWith('disabled1', 'skipped', 'Sync disabled');
    // API was called (for enabled2), but not zero times
    expect(questradeApi.makeApiCall).toHaveBeenCalled();
    // disabled1's URL should never appear in the calls
    const calls = questradeApi.makeApiCall.mock.calls.map((c) => c[0]);
    expect(calls.every((url) => !url.includes('disabled1'))).toBe(true);
    expect(calls.some((url) => url.includes('enabled2'))).toBe(true);
  });

  test('accounts where syncEnabled is absent default to enabled', async () => {
    const accountWithoutFlag = {
      questradeAccount: { id: 'acc1', key: 'acc1', nickname: 'Acc 1' },
      monarchAccount: { id: 'monarch-acc1' },
      // syncEnabled absent — should default to enabled
    };
    questradeApi.fetchAccounts.mockResolvedValue([accountWithoutFlag]);
    const dialog = makeProgressDialog();
    showProgressDialog.mockReturnValue(dialog);

    await uploadAllAccountsToMonarch();

    // Should NOT be skipped due to sync-disabled
    expect(dialog.updateProgress).not.toHaveBeenCalledWith('acc1', 'skipped', 'Sync disabled');
    expect(questradeApi.makeApiCall).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// syncAllAccountsToMonarch — syncEnabled skip enforcement
// ─────────────────────────────────────────────────────────────────────────────
describe('syncAllAccountsToMonarch — syncEnabled skip', () => {
  const syncModule = syncModule2;
  // We need the real syncAllAccountsToMonarch but a mock for syncAccountToMonarch
  // Since we can't partially mock the same module we're testing, we mock the dependencies
  // that syncAccountToMonarch calls instead (balance, positions, transactions).

  const { fetchBalanceHistory, uploadBalanceToMonarch } = balanceModule;

  beforeEach(() => {
    accountService.getAccounts.mockReturnValue([]);
    accountService.getAccountData.mockReturnValue({ monarchAccount: { id: 'monarch-acc1' } });
    accountService.getMonarchAccountMapping.mockReturnValue({ id: 'monarch-acc1', displayName: 'M Acc' });
    fetchBalanceHistory.mockResolvedValue({
      currentBalance: { totalEquity: { combined: [{ currencyCode: 'CAD', amount: 5000 }] } },
      history: { data: [{ date: '2025-01-01', totalEquity: 4900 }] },
    });
    uploadBalanceToMonarch.mockResolvedValue(true);

    const positionsService = positionsModule;
    positionsService.default.processAccountPositions.mockResolvedValue({ success: true, positionsProcessed: 0, positionsSkipped: 0 });

    const txService = transactionsModule;
    txService.default.processAndUploadOrders.mockResolvedValue({ success: true, ordersProcessed: 0, skippedDuplicates: 0 });
    txService.default.processAndUploadActivityTransactions.mockResolvedValue({ success: true, transactionsProcessed: 0, skippedDuplicates: 0 });
  });

  test('skips account with syncEnabled: false and updates progress as skipped', async () => {
    questradeApi.fetchAccounts.mockResolvedValue([makeApiAccount('acc1', false)]);
    // Mock getAccountData to return the account with syncEnabled: false
    accountService.getAccountData.mockReturnValue({
      questradeAccount: { id: 'acc1', key: 'acc1' },
      monarchAccount: { id: 'monarch-acc1', displayName: 'M Acc' },
      syncEnabled: false,
    });
    const dialog = makeProgressDialog();
    showProgressDialog.mockReturnValue(dialog);

    await syncAllAccountsToMonarch();

    expect(dialog.updateProgress).toHaveBeenCalledWith('acc1', 'skipped', 'Sync disabled');
    expect(fetchBalanceHistory).not.toHaveBeenCalled();
  });

  test('processes account with syncEnabled: true', async () => {
    questradeApi.fetchAccounts.mockResolvedValue([makeApiAccount('acc1', true)]);
    const dialog = makeProgressDialog();
    showProgressDialog.mockReturnValue(dialog);

    await syncAllAccountsToMonarch();

    expect(fetchBalanceHistory).toHaveBeenCalledWith('acc1', expect.any(String), expect.any(String));
  });

  test('skips disabled account but processes enabled account', async () => {
    questradeApi.fetchAccounts.mockResolvedValue([
      makeApiAccount('disabled1', false),
      makeApiAccount('enabled2', true),
    ]);
    // Mock getAccountData to return proper syncEnabled state for each account
    accountService.getAccountData.mockImplementation((integration, accountId) => {
      if (accountId === 'disabled1') {
        return {
          questradeAccount: { id: 'disabled1', key: 'disabled1' },
          monarchAccount: { id: 'monarch-disabled1', displayName: 'M Acc' },
          syncEnabled: false,
        };
      }
      return {
        questradeAccount: { id: accountId, key: accountId },
        monarchAccount: { id: `monarch-${accountId}`, displayName: `M ${accountId}` },
        syncEnabled: true,
      };
    });
    accountService.getMonarchAccountMapping
      .mockImplementation((integration, accountId) => ({ id: `monarch-${accountId}`, displayName: `M ${accountId}` }));

    const dialog = makeProgressDialog();
    showProgressDialog.mockReturnValue(dialog);

    await syncAllAccountsToMonarch();

    expect(dialog.updateProgress).toHaveBeenCalledWith('disabled1', 'skipped', 'Sync disabled');
    expect(fetchBalanceHistory).toHaveBeenCalledWith('enabled2', expect.any(String), expect.any(String));
    expect(fetchBalanceHistory).not.toHaveBeenCalledWith('disabled1', expect.any(String), expect.any(String));
  });
});