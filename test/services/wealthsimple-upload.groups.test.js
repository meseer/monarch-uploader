/**
 * Tests for group-limited bulk syncs in the Wealthsimple Upload Service
 */

import {
  uploadAllWealthsimpleAccountsToMonarch,
} from '../../src/services/wealthsimple-upload';
import toast from '../../src/ui/toast';
import * as accountService from '../../src/services/wealthsimple/account';
import wealthsimpleApi from '../../src/api/wealthsimple';
import { showProgressDialog } from '../../src/ui/components/progressDialog';

// Mock dependencies
vi.mock('../../src/ui/toast');
vi.mock('../../src/services/wealthsimple/account');
vi.mock('../../src/api/wealthsimple');
vi.mock('../../src/ui/components/progressDialog');
vi.mock('../../src/services/wealthsimple/balance', () => ({
  getDefaultDateRange: vi.fn(() => ({
    fromDate: '2025-10-05',
    toDate: '2026-01-03',
  })),
  extractDateFromISO: vi.fn((date) => date),
  accountNeedsBalanceReconstruction: vi.fn(() => false),
  calculateCheckpointDate: vi.fn(() => '2025-12-31'),
  getBalanceAtDate: vi.fn(() => 0),
  reconstructBalanceFromTransactions: vi.fn(() => []),
}));
vi.mock('../../src/services/wealthsimple/positions', () => ({
  isInvestmentAccount: vi.fn(() => false), // Default to non-investment to simplify tests
  processAccountPositions: vi.fn(() => Promise.resolve({ success: true, positionsProcessed: 0 })),
  processCashPositions: vi.fn(() => Promise.resolve({ success: true, cashSynced: 0, cashSkipped: 0 })),
}));
vi.mock('../../src/services/wealthsimple/transactions', () => ({
  fetchAndProcessTransactions: vi.fn(() => Promise.resolve([])),
  reconcilePendingTransactions: vi.fn(() => Promise.resolve({ success: true, deleted: 0, pending: 0 })),
  formatReconciliationMessage: vi.fn(() => 'No changes'),
}));
vi.mock('../../src/core/utils', () => ({
  debugLog: vi.fn(),
  getDefaultLookbackDays: vi.fn(() => 2),
  getTodayLocal: vi.fn(() => '2026-01-03'),
}));


function account(id, type, syncEnabled = true) {
  return {
    wealthsimpleAccount: { id, nickname: `Account ${id}`, type, currency: 'CAD', branch: 'WS' },
    monarchAccount: null,
    syncEnabled,
    lastSyncDate: null,
    uploadedTransactions: [],
  };
}

const ALL_ACCOUNTS = [
  account('chq', 'CASH'),
  account('cc', 'CREDIT_CARD'),
  account('loc', 'PORTFOLIO_LINE_OF_CREDIT'),
  account('tfsa', 'MANAGED_TFSA'),
  account('crypto', 'SELF_DIRECTED_CRYPTO'),
  account('mystery', 'SOMETHING_NEW'),
];

describe('uploadAllWealthsimpleAccountsToMonarch with an account group', () => {
  const mockProgressDialog = {
    updateProgress: vi.fn(),
    showSummary: vi.fn(),
    hideCancel: vi.fn(),
    close: vi.fn(),
    onCancel: vi.fn(),
    initSteps: vi.fn(),
    updateStepStatus: vi.fn(),
    updateBalanceChange: vi.fn(),
  };

  function dialogAccountIds() {
    return showProgressDialog.mock.calls[0][0].map((entry) => entry.key);
  }

  function balanceFetchIds() {
    return wealthsimpleApi.fetchAccountBalances.mock.calls[0][0].map((entry) => entry.id);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    showProgressDialog.mockReturnValue(mockProgressDialog);
    // Balances unavailable keeps each account from running the full sync,
    // which is all these tests need: which accounts were selected.
    wealthsimpleApi.fetchAccountBalances.mockResolvedValue({ success: true, balances: new Map() });
    accountService.syncAccountListWithAPI.mockResolvedValue(ALL_ACCOUNTS);
  });

  test('Spend & Save covers chequing, credit card and line of credit', async () => {
    await uploadAllWealthsimpleAccountsToMonarch('spendSave');

    expect(dialogAccountIds()).toEqual(['chq', 'cc', 'loc']);
    expect(balanceFetchIds()).toEqual(['chq', 'cc', 'loc']);
    expect(showProgressDialog.mock.calls[0][1]).toBe('Uploading Wealthsimple Spend & Save Accounts to Monarch');
  });

  test('Investing covers investment accounts and crypto', async () => {
    await uploadAllWealthsimpleAccountsToMonarch('investing');

    expect(dialogAccountIds()).toEqual(['tfsa', 'crypto']);
    expect(showProgressDialog.mock.calls[0][1]).toBe('Uploading Wealthsimple Investing Accounts to Monarch');
  });

  test('no group syncs every account, including unmapped types', async () => {
    await uploadAllWealthsimpleAccountsToMonarch();

    expect(dialogAccountIds()).toEqual(['chq', 'cc', 'loc', 'tfsa', 'crypto', 'mystery']);
    expect(showProgressDialog.mock.calls[0][1]).toBe('Uploading Wealthsimple Accounts to Monarch');
  });

  test('skipped accounts in the group are excluded and counted as skipped', async () => {
    accountService.syncAccountListWithAPI.mockResolvedValue([
      account('chq', 'CASH'),
      account('cc', 'CREDIT_CARD', false),
      account('tfsa', 'MANAGED_TFSA', false),
    ]);

    await uploadAllWealthsimpleAccountsToMonarch('spendSave');

    expect(dialogAccountIds()).toEqual(['chq']);
    // The skipped TFSA is outside the group, so it is not counted
    expect(mockProgressDialog.showSummary).toHaveBeenCalledWith({ success: 0, failed: 1, skipped: 1 });
  });

  test('tells the user when the group has no accounts', async () => {
    accountService.syncAccountListWithAPI.mockResolvedValue([account('chq', 'CASH')]);

    await uploadAllWealthsimpleAccountsToMonarch('investing');

    expect(toast.show).toHaveBeenCalledWith('No Investing accounts found', 'info');
    expect(showProgressDialog).not.toHaveBeenCalled();
    expect(wealthsimpleApi.fetchAccountBalances).not.toHaveBeenCalled();
  });

  test('tells the user when every account in the group is skipped', async () => {
    accountService.syncAccountListWithAPI.mockResolvedValue([
      account('chq', 'CASH', false),
      account('tfsa', 'MANAGED_TFSA'),
    ]);

    await uploadAllWealthsimpleAccountsToMonarch('spendSave');

    expect(toast.show).toHaveBeenCalledWith('All Spend & Save accounts are marked as skipped', 'info');
    expect(showProgressDialog).not.toHaveBeenCalled();
  });

  test('names the group in the success toast', async () => {
    accountService.syncAccountListWithAPI.mockResolvedValue([account('tfsa', 'MANAGED_TFSA')]);
    wealthsimpleApi.fetchAccountBalances.mockResolvedValue({
      success: true,
      balances: new Map([['tfsa', { amount: 100, currency: 'CAD' }]]),
    });
    accountService.resolveWealthsimpleAccountMapping.mockResolvedValue({ id: 'monarch-1' });
    accountService.uploadWealthsimpleBalance.mockResolvedValue(true);

    await uploadAllWealthsimpleAccountsToMonarch('investing');

    expect(mockProgressDialog.showSummary).toHaveBeenCalledWith({ success: 1, failed: 0, skipped: 0 });
    expect(toast.show).toHaveBeenCalledWith('Successfully uploaded all 1 Wealthsimple Investing account(s)', 'info');
  });
});
