/**
 * Tests for Wealthsimple Upload Service
 */

import {
  uploadAllWealthsimpleAccountsToMonarch,
  getLastUploadDate,
  clearLastUploadDate,
} from '../../src/services/wealthsimple-upload';
import toast from '../../src/ui/toast';
import * as accountService from '../../src/services/wealthsimple/account';
import wealthsimpleApi from '../../src/api/wealthsimple';
import { showProgressDialog } from '../../src/ui/components/progressDialog';

// Mock dependencies
jest.mock('../../src/ui/toast');
jest.mock('../../src/services/wealthsimple/account');
jest.mock('../../src/api/wealthsimple');
jest.mock('../../src/ui/components/progressDialog');
jest.mock('../../src/services/wealthsimple/balance', () => ({
  getDefaultDateRange: jest.fn(() => ({
    fromDate: '2025-10-05',
    toDate: '2026-01-03',
  })),
  extractDateFromISO: jest.fn((date) => date),
  accountNeedsBalanceReconstruction: jest.fn(() => false),
  calculateCheckpointDate: jest.fn(() => '2025-12-31'),
  getBalanceAtDate: jest.fn(() => 0),
  reconstructBalanceFromTransactions: jest.fn(() => []),
}));
jest.mock('../../src/services/wealthsimple/positions', () => ({
  isInvestmentAccount: jest.fn(() => false), // Default to non-investment to simplify tests
  processAccountPositions: jest.fn(() => Promise.resolve({ success: true, positionsProcessed: 0 })),
  processCashPositions: jest.fn(() => Promise.resolve({ success: true, cashSynced: 0, cashSkipped: 0 })),
}));
jest.mock('../../src/services/wealthsimple/transactions', () => ({
  fetchAndProcessTransactions: jest.fn(() => Promise.resolve([])),
  reconcilePendingTransactions: jest.fn(() => Promise.resolve({ success: true, deleted: 0, pending: 0 })),
  formatReconciliationMessage: jest.fn(() => 'No changes'),
}));
jest.mock('../../src/core/utils', () => ({
  debugLog: jest.fn(),
  getDefaultLookbackDays: jest.fn(() => 2),
  getTodayLocal: jest.fn(() => '2026-01-03'),
}));

describe('Wealthsimple Upload Service', () => {
  // Mock progress dialog object
  const mockProgressDialog = {
    updateProgress: jest.fn(),
    showSummary: jest.fn(),
    showError: jest.fn(),
    hideCancel: jest.fn(),
    close: jest.fn(),
    onCancel: jest.fn(),
    isCancelled: jest.fn(() => false),
    initSteps: jest.fn(),
    updateStepStatus: jest.fn(),
    updateBalanceChange: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    showProgressDialog.mockReturnValue(mockProgressDialog);
  });

  describe('uploadAllWealthsimpleAccountsToMonarch', () => {
    it('should successfully process accounts', async () => {
      wealthsimpleApi.fetchAccountBalances.mockResolvedValue({
        success: true,
        balances: new Map([
          ['acc-1', { amount: 10000, currency: 'CAD' }],
          ['acc-2', { amount: 20000, currency: 'CAD' }],
        ]),
      });

      const mockAccounts = [
        {
          wealthsimpleAccount: {
            id: 'acc-1',
            nickname: 'My TFSA',
            type: 'TFSA',
            currency: 'CAD',
            branch: 'WS',
          },
          monarchAccount: null,
          syncEnabled: true,
          lastSyncDate: null,
          uploadedTransactions: [],
        },
        {
          wealthsimpleAccount: {
            id: 'acc-2',
            nickname: 'My RRSP',
            type: 'RRSP',
            currency: 'CAD',
            branch: 'WS',
          },
          monarchAccount: null,
          syncEnabled: true,
          lastSyncDate: null,
          uploadedTransactions: [],
        },
      ];

      const mockMonarchAccount = { id: 'monarch-1', displayName: 'Test Account' };

      accountService.syncAccountListWithAPI.mockResolvedValue(mockAccounts);
      accountService.resolveWealthsimpleAccountMapping.mockResolvedValue(mockMonarchAccount);
      accountService.uploadWealthsimpleBalance.mockResolvedValue(false);
      accountService.uploadWealthsimpleTransactions.mockResolvedValue(false);

      await uploadAllWealthsimpleAccountsToMonarch();

      expect(accountService.syncAccountListWithAPI).toHaveBeenCalled();
      expect(accountService.resolveWealthsimpleAccountMapping).toHaveBeenCalledTimes(2);
      expect(mockProgressDialog.showSummary).toHaveBeenCalledWith({
        success: 0,
        failed: 2,
        skipped: 0,
      });
    });

    it('should handle no accounts found', async () => {
      accountService.syncAccountListWithAPI.mockResolvedValue([]);

      await uploadAllWealthsimpleAccountsToMonarch();

      expect(toast.show).toHaveBeenCalledWith(
        'No Wealthsimple accounts found',
        'debug',
      );
    });

    it('should handle null accounts response', async () => {
      accountService.syncAccountListWithAPI.mockResolvedValue(null);

      await uploadAllWealthsimpleAccountsToMonarch();

      expect(toast.show).toHaveBeenCalledWith(
        'No Wealthsimple accounts found',
        'debug',
      );
    });

    it('should handle API errors', async () => {
      const error = new Error('API connection failed');
      accountService.syncAccountListWithAPI.mockRejectedValue(error);

      await uploadAllWealthsimpleAccountsToMonarch();

      expect(toast.show).toHaveBeenCalledWith(
        'Error fetching accounts: API connection failed',
        'error',
      );
    });

    it('should handle single account', async () => {
      wealthsimpleApi.fetchAccountBalances.mockResolvedValue({
        success: true,
        balances: new Map([
          ['acc-1', { amount: 10000, currency: 'CAD' }],
        ]),
      });

      const mockAccounts = [
        {
          wealthsimpleAccount: {
            id: 'acc-1',
            nickname: 'My TFSA',
            type: 'TFSA',
          },
          monarchAccount: null,
          syncEnabled: true,
          lastSyncDate: null,
          uploadedTransactions: [],
        },
      ];

      const mockMonarchAccount = { id: 'monarch-1', displayName: 'Test Account' };

      accountService.syncAccountListWithAPI.mockResolvedValue(mockAccounts);
      accountService.resolveWealthsimpleAccountMapping.mockResolvedValue(mockMonarchAccount);
      accountService.uploadWealthsimpleBalance.mockResolvedValue(false);
      accountService.uploadWealthsimpleTransactions.mockResolvedValue(false);

      await uploadAllWealthsimpleAccountsToMonarch();

      expect(mockProgressDialog.showSummary).toHaveBeenCalledWith({
        success: 0,
        failed: 1,
        skipped: 0,
      });
    });

    it('should skip accounts with syncEnabled false', async () => {
      const mockAccounts = [
        {
          wealthsimpleAccount: {
            id: 'acc-1',
            nickname: 'My TFSA',
            type: 'TFSA',
          },
          syncEnabled: false,
        },
        {
          wealthsimpleAccount: {
            id: 'acc-2',
            nickname: 'My RRSP',
            type: 'RRSP',
          },
          syncEnabled: true,
        },
      ];

      wealthsimpleApi.fetchAccountBalances.mockResolvedValue({
        success: true,
        balances: new Map([
          ['acc-2', { amount: 20000, currency: 'CAD' }],
        ]),
      });

      const mockMonarchAccount = { id: 'monarch-1', displayName: 'Test Account' };

      accountService.syncAccountListWithAPI.mockResolvedValue(mockAccounts);
      accountService.resolveWealthsimpleAccountMapping.mockResolvedValue(mockMonarchAccount);
      accountService.uploadWealthsimpleBalance.mockResolvedValue(true);
      accountService.uploadWealthsimpleTransactions.mockResolvedValue(true);
      accountService.getAccountData.mockReturnValue(mockAccounts[1]);

      await uploadAllWealthsimpleAccountsToMonarch();

      // Should only process acc-2 (acc-1 has syncEnabled: false)
      expect(accountService.resolveWealthsimpleAccountMapping).toHaveBeenCalledTimes(1);
    });

    it('should handle all accounts being skipped', async () => {
      const mockAccounts = [
        {
          wealthsimpleAccount: { id: 'acc-1', nickname: 'TFSA' },
          syncEnabled: false,
        },
        {
          wealthsimpleAccount: { id: 'acc-2', nickname: 'RRSP' },
          syncEnabled: false,
        },
      ];

      accountService.syncAccountListWithAPI.mockResolvedValue(mockAccounts);

      await uploadAllWealthsimpleAccountsToMonarch();

      expect(toast.show).toHaveBeenCalledWith(
        'All accounts are marked as skipped',
        'debug',
      );
    });

    it('should handle balance fetch failure', async () => {
      const mockAccounts = [
        {
          wealthsimpleAccount: { id: 'acc-1', nickname: 'TFSA' },
          syncEnabled: true,
        },
      ];

      accountService.syncAccountListWithAPI.mockResolvedValue(mockAccounts);
      wealthsimpleApi.fetchAccountBalances.mockResolvedValue({
        success: false,
        error: 'Network error',
      });

      await uploadAllWealthsimpleAccountsToMonarch();

      expect(toast.show).toHaveBeenCalledWith(
        'Failed to fetch account balances. Please try again.',
        'error',
      );
    });

    it('should skip accounts with unavailable balance', async () => {
      const mockAccounts = [
        {
          wealthsimpleAccount: { id: 'acc-1', nickname: 'TFSA' },
          syncEnabled: true,
        },
      ];

      accountService.syncAccountListWithAPI.mockResolvedValue(mockAccounts);
      wealthsimpleApi.fetchAccountBalances.mockResolvedValue({
        success: true,
        balances: new Map(), // Empty - no balance for acc-1
      });

      await uploadAllWealthsimpleAccountsToMonarch();

      expect(accountService.resolveWealthsimpleAccountMapping).not.toHaveBeenCalled();
      // Check that initSteps was called and the balance step was set to error
      expect(mockProgressDialog.initSteps).toHaveBeenCalledWith('acc-1', expect.any(Array));
      expect(mockProgressDialog.updateStepStatus).toHaveBeenCalledWith('acc-1', 'balance', 'error', 'Balance unavailable');
      expect(mockProgressDialog.showSummary).toHaveBeenCalledWith({
        success: 0,
        failed: 1,
        skipped: 0,
      });
    });

    it('should handle successful upload of all accounts', async () => {
      const mockAccounts = [
        {
          wealthsimpleAccount: { id: 'acc-1', nickname: 'TFSA', type: 'MANAGED_TFSA' },
          syncEnabled: true,
        },
      ];

      accountService.syncAccountListWithAPI.mockResolvedValue(mockAccounts);
      wealthsimpleApi.fetchAccountBalances.mockResolvedValue({
        success: true,
        balances: new Map([
          ['acc-1', { amount: 10000, currency: 'CAD' }],
        ]),
      });
      wealthsimpleApi.fetchTransactions.mockResolvedValue([]);

      const mockMonarchAccount = { id: 'monarch-1', displayName: 'Test Account' };
      accountService.resolveWealthsimpleAccountMapping.mockResolvedValue(mockMonarchAccount);
      accountService.uploadWealthsimpleBalance.mockResolvedValue(true);
      accountService.uploadWealthsimpleTransactions.mockResolvedValue({ success: true, synced: 0, skipped: 0 });
      accountService.getAccountData.mockReturnValue(mockAccounts[0]);

      await uploadAllWealthsimpleAccountsToMonarch();

      expect(toast.show).toHaveBeenCalledWith(
        'Successfully uploaded all 1 Wealthsimple account(s)',
        'info',
      );
    });

    it('should stop processing when user cancels', async () => {
      const mockAccounts = [
        {
          wealthsimpleAccount: { id: 'acc-1', nickname: 'TFSA', type: 'MANAGED_TFSA' },
          syncEnabled: true,
        },
        {
          wealthsimpleAccount: { id: 'acc-2', nickname: 'RRSP', type: 'MANAGED_RRSP' },
          syncEnabled: true,
        },
      ];

      accountService.syncAccountListWithAPI.mockResolvedValue(mockAccounts);
      wealthsimpleApi.fetchAccountBalances.mockResolvedValue({
        success: true,
        balances: new Map([
          ['acc-1', { amount: 10000, currency: 'CAD' }],
          ['acc-2', { amount: 20000, currency: 'CAD' }],
        ]),
      });

      // First account returns cancelled
      accountService.resolveWealthsimpleAccountMapping.mockResolvedValue({ cancelled: true });

      await uploadAllWealthsimpleAccountsToMonarch();

      // Should only process first account (cancelled stops processing)
      expect(accountService.resolveWealthsimpleAccountMapping).toHaveBeenCalledTimes(1);
      expect(toast.show).toHaveBeenCalledWith('Upload process was cancelled', 'info');
    });

    it('should continue processing when user skips an account', async () => {
      const mockAccounts = [
        {
          wealthsimpleAccount: { id: 'acc-1', nickname: 'TFSA', type: 'MANAGED_TFSA' },
          syncEnabled: true,
        },
        {
          wealthsimpleAccount: { id: 'acc-2', nickname: 'RRSP', type: 'MANAGED_RRSP' },
          syncEnabled: true,
        },
      ];

      accountService.syncAccountListWithAPI.mockResolvedValue(mockAccounts);
      wealthsimpleApi.fetchAccountBalances.mockResolvedValue({
        success: true,
        balances: new Map([
          ['acc-1', { amount: 10000, currency: 'CAD' }],
          ['acc-2', { amount: 20000, currency: 'CAD' }],
        ]),
      });

      // First account skipped, second succeeds
      const mockMonarchAccount = { id: 'monarch-1', displayName: 'Test Account' };
      accountService.resolveWealthsimpleAccountMapping
        .mockResolvedValueOnce({ skipped: true })
        .mockResolvedValueOnce(mockMonarchAccount);
      accountService.uploadWealthsimpleBalance.mockResolvedValue(true);
      accountService.uploadWealthsimpleTransactions.mockResolvedValue(true);
      accountService.getAccountData.mockReturnValue(mockAccounts[1]);

      await uploadAllWealthsimpleAccountsToMonarch();

      // Should process both accounts
      expect(accountService.resolveWealthsimpleAccountMapping).toHaveBeenCalledTimes(2);
      expect(accountService.markAccountAsSkipped).toHaveBeenCalledWith('acc-1', true);
    });

    it('should handle mixed results summary', async () => {
      const mockAccounts = [
        {
          wealthsimpleAccount: { id: 'acc-1', nickname: 'TFSA', type: 'MANAGED_TFSA' },
          syncEnabled: true,
        },
        {
          wealthsimpleAccount: { id: 'acc-2', nickname: 'RRSP', type: 'MANAGED_RRSP' },
          syncEnabled: true,
        },
        {
          wealthsimpleAccount: { id: 'acc-3', nickname: 'Cash', type: 'CASH' },
          syncEnabled: true,
        },
      ];

      accountService.syncAccountListWithAPI.mockResolvedValue(mockAccounts);
      wealthsimpleApi.fetchAccountBalances.mockResolvedValue({
        success: true,
        balances: new Map([
          ['acc-1', { amount: 10000, currency: 'CAD' }],
          ['acc-2', { amount: 20000, currency: 'CAD' }],
          // acc-3 has no balance
        ]),
      });
      wealthsimpleApi.fetchTransactions.mockResolvedValue([]);

      const mockMonarchAccount = { id: 'monarch-1', displayName: 'Test Account' };
      accountService.resolveWealthsimpleAccountMapping.mockResolvedValue(mockMonarchAccount);
      accountService.uploadWealthsimpleBalance
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      accountService.uploadWealthsimpleTransactions
        .mockResolvedValueOnce({ success: true, synced: 1, skipped: 0 })
        .mockResolvedValueOnce({ success: false, error: 'Failed' });
      accountService.getAccountData.mockReturnValue(mockAccounts[0]);

      await uploadAllWealthsimpleAccountsToMonarch();

      // Final summary should show mixed results
      expect(toast.show).toHaveBeenCalledWith(
        expect.stringContaining('uploaded'),
        expect.any(String),
      );
    });
  });

  describe('getLastUploadDate', () => {
    it('should return lastSyncDate from account data', () => {
      accountService.getAccountData.mockReturnValue({
        wealthsimpleAccount: { id: 'acc-1' },
        lastSyncDate: '2025-12-15',
      });

      const result = getLastUploadDate('acc-1');

      expect(result).toBe('2025-12-15');
      expect(accountService.getAccountData).toHaveBeenCalledWith('acc-1');
    });

    it('should return null when account not found', () => {
      accountService.getAccountData.mockReturnValue(null);

      const result = getLastUploadDate('non-existent');

      expect(result).toBeNull();
    });

    it('should return null when lastSyncDate is not set', () => {
      accountService.getAccountData.mockReturnValue({
        wealthsimpleAccount: { id: 'acc-1' },
        lastSyncDate: null,
      });

      const result = getLastUploadDate('acc-1');

      expect(result).toBeNull();
    });

    it('should return null when lastSyncDate is undefined', () => {
      accountService.getAccountData.mockReturnValue({
        wealthsimpleAccount: { id: 'acc-1' },
      });

      const result = getLastUploadDate('acc-1');

      expect(result).toBeNull();
    });
  });

  describe('clearLastUploadDate', () => {
    it('should call updateAccountInList with null lastSyncDate', () => {
      clearLastUploadDate('acc-1');

      expect(accountService.updateAccountInList).toHaveBeenCalledWith('acc-1', { lastSyncDate: null });
    });

    it('should handle different account IDs', () => {
      clearLastUploadDate('different-id');

      expect(accountService.updateAccountInList).toHaveBeenCalledWith('different-id', { lastSyncDate: null });
    });
  });
});
