/**
 * Tests for Wealthsimple Account Service
 */

import {
  syncCreditLimit,
  getWealthsimpleAccounts,
  getAccountData,
  updateAccountInList,
  markAccountAsSkipped,
  isAccountSkipped,
  getExistingAccountMapping,
  clearAccountMapping,
  getDefaultAccountSettings,
  applyTransactionRetentionEviction,
} from '../../../src/services/wealthsimple/account';
import wealthsimpleApi from '../../../src/api/wealthsimple';
import monarchApi from '../../../src/api/monarch';
import toast from '../../../src/ui/toast';
import { STORAGE, TRANSACTION_RETENTION_DEFAULTS } from '../../../src/core/config';

// Mock dependencies
jest.mock('../../../src/api/wealthsimple');
jest.mock('../../../src/api/monarch');
jest.mock('../../../src/ui/toast');

// Mock GM functions
global.GM_getValue = jest.fn();
global.GM_setValue = jest.fn();
global.GM_deleteValue = jest.fn();

describe('Wealthsimple Account Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default empty accounts list
    GM_getValue.mockReturnValue('[]');
  });

  describe('syncCreditLimit', () => {
    const createMockConsolidatedAccount = (type, lastSyncedCreditLimit = undefined) => ({
      wealthsimpleAccount: {
        id: 'ws-cc-123',
        nickname: 'My Credit Card',
        type,
      },
      monarchAccount: {
        id: 'monarch-123',
        displayName: 'Credit Card',
      },
      syncEnabled: true,
      lastSyncDate: '2025-12-01',
      lastSyncedCreditLimit,
    });

    beforeEach(() => {
      // Mock account list for updateAccountInList
      GM_getValue.mockImplementation((key) => {
        if (key === STORAGE.WEALTHSIMPLE_ACCOUNTS_LIST) {
          return JSON.stringify([
            {
              wealthsimpleAccount: {
                id: 'ws-cc-123',
                nickname: 'My Credit Card',
                type: 'CREDIT_CARD',
              },
              monarchAccount: {
                id: 'monarch-123',
                displayName: 'Credit Card',
              },
              syncEnabled: true,
            },
          ]);
        }
        return null;
      });
    });

    it('should skip non-credit card accounts', async () => {
      const consolidatedAccount = createMockConsolidatedAccount('MANAGED_TFSA');

      const result = await syncCreditLimit(consolidatedAccount, 'monarch-123');

      expect(result).toBe(true);
      expect(wealthsimpleApi.fetchCreditCardAccountSummary).not.toHaveBeenCalled();
      expect(monarchApi.getCreditLimit).not.toHaveBeenCalled();
      expect(monarchApi.setCreditLimit).not.toHaveBeenCalled();
    });

    it('should skip for CASH account type', async () => {
      const consolidatedAccount = createMockConsolidatedAccount('CASH');

      const result = await syncCreditLimit(consolidatedAccount, 'monarch-123');

      expect(result).toBe(true);
      expect(wealthsimpleApi.fetchCreditCardAccountSummary).not.toHaveBeenCalled();
    });

    it('should fetch WS credit limit for credit card accounts', async () => {
      const consolidatedAccount = createMockConsolidatedAccount('CREDIT_CARD');

      wealthsimpleApi.fetchCreditCardAccountSummary.mockResolvedValue({
        id: 'ws-cc-123',
        creditLimit: 17000,
        balance: { current: 500 },
      });

      monarchApi.getCreditLimit.mockResolvedValue(17000);

      const result = await syncCreditLimit(consolidatedAccount, 'monarch-123');

      expect(result).toBe(true);
      expect(wealthsimpleApi.fetchCreditCardAccountSummary).toHaveBeenCalledWith('ws-cc-123');
    });

    it('should fetch Monarch credit limit on first sync (no stored limit)', async () => {
      const consolidatedAccount = createMockConsolidatedAccount('CREDIT_CARD', undefined);

      wealthsimpleApi.fetchCreditCardAccountSummary.mockResolvedValue({
        creditLimit: 17000,
      });

      monarchApi.getCreditLimit.mockResolvedValue(15000);
      monarchApi.setCreditLimit.mockResolvedValue({});

      await syncCreditLimit(consolidatedAccount, 'monarch-123');

      // Should fetch from Monarch since no stored limit
      expect(monarchApi.getCreditLimit).toHaveBeenCalledWith('monarch-123');
    });

    it('should use stored credit limit on subsequent sync', async () => {
      const consolidatedAccount = createMockConsolidatedAccount('CREDIT_CARD', 17000);

      wealthsimpleApi.fetchCreditCardAccountSummary.mockResolvedValue({
        creditLimit: 17000,
      });

      await syncCreditLimit(consolidatedAccount, 'monarch-123');

      // Should NOT fetch from Monarch since we have stored limit
      expect(monarchApi.getCreditLimit).not.toHaveBeenCalled();
    });

    it('should update Monarch when limits differ (first sync)', async () => {
      const consolidatedAccount = createMockConsolidatedAccount('CREDIT_CARD', undefined);

      wealthsimpleApi.fetchCreditCardAccountSummary.mockResolvedValue({
        creditLimit: 20000,
      });

      monarchApi.getCreditLimit.mockResolvedValue(15000);
      monarchApi.setCreditLimit.mockResolvedValue({});

      const result = await syncCreditLimit(consolidatedAccount, 'monarch-123');

      expect(result).toBe(true);
      expect(monarchApi.setCreditLimit).toHaveBeenCalledWith('monarch-123', 20000);
    });

    it('should update Monarch when limits differ (subsequent sync)', async () => {
      const consolidatedAccount = createMockConsolidatedAccount('CREDIT_CARD', 15000);

      wealthsimpleApi.fetchCreditCardAccountSummary.mockResolvedValue({
        creditLimit: 20000,
      });

      monarchApi.setCreditLimit.mockResolvedValue({});

      const result = await syncCreditLimit(consolidatedAccount, 'monarch-123');

      expect(result).toBe(true);
      expect(monarchApi.getCreditLimit).not.toHaveBeenCalled();
      expect(monarchApi.setCreditLimit).toHaveBeenCalledWith('monarch-123', 20000);
    });

    it('should not update Monarch when limits match (first sync)', async () => {
      const consolidatedAccount = createMockConsolidatedAccount('CREDIT_CARD', undefined);

      wealthsimpleApi.fetchCreditCardAccountSummary.mockResolvedValue({
        creditLimit: 17000,
      });

      monarchApi.getCreditLimit.mockResolvedValue(17000);

      const result = await syncCreditLimit(consolidatedAccount, 'monarch-123');

      expect(result).toBe(true);
      expect(monarchApi.setCreditLimit).not.toHaveBeenCalled();
    });

    it('should not update Monarch when limits match (subsequent sync)', async () => {
      const consolidatedAccount = createMockConsolidatedAccount('CREDIT_CARD', 17000);

      wealthsimpleApi.fetchCreditCardAccountSummary.mockResolvedValue({
        creditLimit: 17000,
      });

      const result = await syncCreditLimit(consolidatedAccount, 'monarch-123');

      expect(result).toBe(true);
      expect(monarchApi.getCreditLimit).not.toHaveBeenCalled();
      expect(monarchApi.setCreditLimit).not.toHaveBeenCalled();
    });

    it('should store synced credit limit after successful sync', async () => {
      const consolidatedAccount = createMockConsolidatedAccount('CREDIT_CARD', undefined);

      wealthsimpleApi.fetchCreditCardAccountSummary.mockResolvedValue({
        creditLimit: 17000,
      });

      monarchApi.getCreditLimit.mockResolvedValue(17000);

      await syncCreditLimit(consolidatedAccount, 'monarch-123');

      // Should have called GM_setValue to update the account list with new credit limit
      expect(GM_setValue).toHaveBeenCalled();
      const savedValue = JSON.parse(GM_setValue.mock.calls[0][1]);
      expect(savedValue[0].lastSyncedCreditLimit).toBe(17000);
    });

    it('should handle WS API fetch failure gracefully', async () => {
      const consolidatedAccount = createMockConsolidatedAccount('CREDIT_CARD');

      wealthsimpleApi.fetchCreditCardAccountSummary.mockRejectedValue(
        new Error('Network error'),
      );

      const result = await syncCreditLimit(consolidatedAccount, 'monarch-123');

      expect(result).toBe(false);
      expect(toast.show).toHaveBeenCalledWith(
        'Warning: Could not fetch credit limit from Wealthsimple',
        'warning',
      );
      expect(monarchApi.setCreditLimit).not.toHaveBeenCalled();
    });

    it('should handle Monarch API fetch failure gracefully', async () => {
      const consolidatedAccount = createMockConsolidatedAccount('CREDIT_CARD', undefined);

      wealthsimpleApi.fetchCreditCardAccountSummary.mockResolvedValue({
        creditLimit: 17000,
      });

      monarchApi.getCreditLimit.mockRejectedValue(new Error('API error'));
      monarchApi.setCreditLimit.mockResolvedValue({});

      const result = await syncCreditLimit(consolidatedAccount, 'monarch-123');

      // Should still succeed and update Monarch with WS limit
      expect(result).toBe(true);
      expect(monarchApi.setCreditLimit).toHaveBeenCalledWith('monarch-123', 17000);
    });

    it('should handle Monarch update failure gracefully', async () => {
      const consolidatedAccount = createMockConsolidatedAccount('CREDIT_CARD', 15000);

      wealthsimpleApi.fetchCreditCardAccountSummary.mockResolvedValue({
        creditLimit: 20000,
      });

      monarchApi.setCreditLimit.mockRejectedValue(new Error('Update failed'));

      const result = await syncCreditLimit(consolidatedAccount, 'monarch-123');

      expect(result).toBe(false);
      expect(toast.show).toHaveBeenCalledWith(
        'Warning: Could not update credit limit in Monarch',
        'warning',
      );
    });

    it('should handle null credit limit from WS', async () => {
      const consolidatedAccount = createMockConsolidatedAccount('CREDIT_CARD');

      wealthsimpleApi.fetchCreditCardAccountSummary.mockResolvedValue({
        creditLimit: null,
      });

      const result = await syncCreditLimit(consolidatedAccount, 'monarch-123');

      expect(result).toBe(true);
      expect(monarchApi.getCreditLimit).not.toHaveBeenCalled();
      expect(monarchApi.setCreditLimit).not.toHaveBeenCalled();
    });

    it('should handle undefined credit limit from WS', async () => {
      const consolidatedAccount = createMockConsolidatedAccount('CREDIT_CARD');

      wealthsimpleApi.fetchCreditCardAccountSummary.mockResolvedValue({
        creditLimit: undefined,
      });

      const result = await syncCreditLimit(consolidatedAccount, 'monarch-123');

      expect(result).toBe(true);
      expect(monarchApi.setCreditLimit).not.toHaveBeenCalled();
    });

    it('should handle zero credit limit from WS', async () => {
      const consolidatedAccount = createMockConsolidatedAccount('CREDIT_CARD', undefined);

      wealthsimpleApi.fetchCreditCardAccountSummary.mockResolvedValue({
        creditLimit: 0,
      });

      monarchApi.getCreditLimit.mockResolvedValue(5000);
      monarchApi.setCreditLimit.mockResolvedValue({});

      const result = await syncCreditLimit(consolidatedAccount, 'monarch-123');

      expect(result).toBe(true);
      // Should update because 0 !== 5000
      expect(monarchApi.setCreditLimit).toHaveBeenCalledWith('monarch-123', 0);
    });

    it('should show debug toast when credit limit is updated', async () => {
      const consolidatedAccount = createMockConsolidatedAccount('CREDIT_CARD', 15000);

      wealthsimpleApi.fetchCreditCardAccountSummary.mockResolvedValue({
        creditLimit: 20000,
      });

      monarchApi.setCreditLimit.mockResolvedValue({});

      await syncCreditLimit(consolidatedAccount, 'monarch-123');

      expect(toast.show).toHaveBeenCalledWith(
        'Updated credit limit for My Credit Card to $20000',
        'debug',
      );
    });

    it('should handle account with missing wealthsimpleAccount property', async () => {
      const consolidatedAccount = {
        monarchAccount: { id: 'monarch-123' },
      };

      const result = await syncCreditLimit(consolidatedAccount, 'monarch-123');

      // Should skip since no account type
      expect(result).toBe(true);
      expect(wealthsimpleApi.fetchCreditCardAccountSummary).not.toHaveBeenCalled();
    });
  });

  describe('getWealthsimpleAccounts', () => {
    it('should return parsed accounts array from storage', () => {
      const mockAccounts = [
        {
          wealthsimpleAccount: { id: 'acc-1', nickname: 'TFSA' },
          syncEnabled: true,
        },
        {
          wealthsimpleAccount: { id: 'acc-2', nickname: 'RRSP' },
          syncEnabled: false,
        },
      ];
      GM_getValue.mockReturnValue(JSON.stringify(mockAccounts));

      const result = getWealthsimpleAccounts();

      expect(result).toEqual(mockAccounts);
      expect(result).toHaveLength(2);
    });

    it('should return empty array when no accounts stored', () => {
      GM_getValue.mockReturnValue('[]');

      const result = getWealthsimpleAccounts();

      expect(result).toEqual([]);
    });

    it('should return empty array on JSON parse error', () => {
      GM_getValue.mockReturnValue('invalid json');

      const result = getWealthsimpleAccounts();

      expect(result).toEqual([]);
    });

    it('should return empty array when storage returns undefined', () => {
      GM_getValue.mockReturnValue(undefined);

      const result = getWealthsimpleAccounts();

      expect(result).toEqual([]);
    });
  });

  describe('getAccountData', () => {
    const mockAccounts = [
      {
        wealthsimpleAccount: { id: 'acc-1', nickname: 'TFSA' },
        syncEnabled: true,
        lastSyncDate: '2025-12-01',
      },
      {
        wealthsimpleAccount: { id: 'acc-2', nickname: 'RRSP' },
        syncEnabled: false,
      },
    ];

    beforeEach(() => {
      GM_getValue.mockReturnValue(JSON.stringify(mockAccounts));
    });

    it('should find account by ID', () => {
      const result = getAccountData('acc-1');

      expect(result).toEqual(mockAccounts[0]);
      expect(result.wealthsimpleAccount.nickname).toBe('TFSA');
    });

    it('should return null when account not found', () => {
      const result = getAccountData('non-existent-id');

      expect(result).toBeNull();
    });

    it('should handle empty accounts array', () => {
      GM_getValue.mockReturnValue('[]');

      const result = getAccountData('acc-1');

      expect(result).toBeNull();
    });

    it('should find second account in list', () => {
      const result = getAccountData('acc-2');

      expect(result).toEqual(mockAccounts[1]);
      expect(result.wealthsimpleAccount.nickname).toBe('RRSP');
    });
  });

  describe('updateAccountInList', () => {
    const mockAccounts = [
      {
        wealthsimpleAccount: { id: 'acc-1', nickname: 'TFSA' },
        syncEnabled: true,
      },
      {
        wealthsimpleAccount: { id: 'acc-2', nickname: 'RRSP' },
        syncEnabled: true,
      },
    ];

    beforeEach(() => {
      GM_getValue.mockReturnValue(JSON.stringify(mockAccounts));
    });

    it('should update account properties', () => {
      const result = updateAccountInList('acc-1', { syncEnabled: false, lastSyncDate: '2025-12-15' });

      expect(result).toBe(true);
      expect(GM_setValue).toHaveBeenCalled();

      const savedValue = JSON.parse(GM_setValue.mock.calls[0][1]);
      expect(savedValue[0].syncEnabled).toBe(false);
      expect(savedValue[0].lastSyncDate).toBe('2025-12-15');
    });

    it('should return false when account not found', () => {
      const result = updateAccountInList('non-existent-id', { syncEnabled: false });

      expect(result).toBe(false);
      expect(GM_setValue).not.toHaveBeenCalled();
    });

    it('should preserve other accounts when updating', () => {
      updateAccountInList('acc-1', { syncEnabled: false });

      const savedValue = JSON.parse(GM_setValue.mock.calls[0][1]);
      expect(savedValue[1]).toEqual(mockAccounts[1]); // Second account unchanged
    });

    it('should merge updates with existing properties', () => {
      updateAccountInList('acc-1', { newProperty: 'newValue' });

      const savedValue = JSON.parse(GM_setValue.mock.calls[0][1]);
      expect(savedValue[0].syncEnabled).toBe(true); // Original preserved
      expect(savedValue[0].newProperty).toBe('newValue'); // New added
    });
  });

  describe('markAccountAsSkipped', () => {
    const mockAccounts = [
      {
        wealthsimpleAccount: { id: 'acc-1', nickname: 'TFSA' },
        syncEnabled: true,
      },
    ];

    beforeEach(() => {
      GM_getValue.mockReturnValue(JSON.stringify(mockAccounts));
    });

    it('should set syncEnabled to false when skipped=true', () => {
      const result = markAccountAsSkipped('acc-1', true);

      expect(result).toBe(true);
      const savedValue = JSON.parse(GM_setValue.mock.calls[0][1]);
      expect(savedValue[0].syncEnabled).toBe(false);
    });

    it('should set syncEnabled to true when skipped=false', () => {
      mockAccounts[0].syncEnabled = false;
      GM_getValue.mockReturnValue(JSON.stringify(mockAccounts));

      const result = markAccountAsSkipped('acc-1', false);

      expect(result).toBe(true);
      const savedValue = JSON.parse(GM_setValue.mock.calls[0][1]);
      expect(savedValue[0].syncEnabled).toBe(true);
    });

    it('should return false for non-existent account', () => {
      const result = markAccountAsSkipped('non-existent', true);

      expect(result).toBe(false);
    });
  });

  describe('isAccountSkipped', () => {
    it('should return true when syncEnabled is false', () => {
      GM_getValue.mockReturnValue(JSON.stringify([
        {
          wealthsimpleAccount: { id: 'acc-1' },
          syncEnabled: false,
        },
      ]));

      const result = isAccountSkipped('acc-1');

      expect(result).toBe(true);
    });

    it('should return false when syncEnabled is true', () => {
      GM_getValue.mockReturnValue(JSON.stringify([
        {
          wealthsimpleAccount: { id: 'acc-1' },
          syncEnabled: true,
        },
      ]));

      const result = isAccountSkipped('acc-1');

      expect(result).toBe(false);
    });

    it('should return false when account not found', () => {
      GM_getValue.mockReturnValue('[]');

      const result = isAccountSkipped('non-existent');

      expect(result).toBe(false);
    });

    it('should return true when syncEnabled is undefined (treated as disabled)', () => {
      GM_getValue.mockReturnValue(JSON.stringify([
        {
          wealthsimpleAccount: { id: 'acc-1' },
        },
      ]));

      const result = isAccountSkipped('acc-1');

      // When syncEnabled is undefined, !undefined = true, so account is skipped
      expect(result).toBe(true);
    });
  });

  describe('getExistingAccountMapping', () => {
    it('should return parsed mapping when exists', () => {
      const mockMapping = { id: 'monarch-123', displayName: 'My Account' };
      GM_getValue.mockReturnValue(JSON.stringify(mockMapping));

      const result = getExistingAccountMapping('ws-acc-1');

      expect(result).toEqual(mockMapping);
      expect(GM_getValue).toHaveBeenCalledWith(`${STORAGE.WEALTHSIMPLE_ACCOUNT_MAPPING_PREFIX}ws-acc-1`, null);
    });

    it('should return null when no mapping exists', () => {
      GM_getValue.mockReturnValue(null);

      const result = getExistingAccountMapping('ws-acc-1');

      expect(result).toBeNull();
    });

    it('should return null on JSON parse error', () => {
      GM_getValue.mockReturnValue('invalid json');

      const result = getExistingAccountMapping('ws-acc-1');

      expect(result).toBeNull();
    });
  });

  describe('clearAccountMapping', () => {
    it('should call GM_deleteValue with correct key', () => {
      clearAccountMapping('ws-acc-1');

      expect(GM_deleteValue).toHaveBeenCalledWith(`${STORAGE.WEALTHSIMPLE_ACCOUNT_MAPPING_PREFIX}ws-acc-1`);
    });

    it('should handle different account IDs', () => {
      clearAccountMapping('different-id');

      expect(GM_deleteValue).toHaveBeenCalledWith(`${STORAGE.WEALTHSIMPLE_ACCOUNT_MAPPING_PREFIX}different-id`);
    });
  });

  describe('getDefaultAccountSettings', () => {
    it('should return expected default object structure', () => {
      const defaults = getDefaultAccountSettings();

      expect(defaults).toEqual({
        syncEnabled: true,
        storeTransactionDetailsInNotes: false,
        stripStoreNumbers: true,
        transactionRetentionDays: TRANSACTION_RETENTION_DEFAULTS.DAYS,
        transactionRetentionCount: TRANSACTION_RETENTION_DEFAULTS.COUNT,
      });
    });

    it('should have syncEnabled default to true', () => {
      const defaults = getDefaultAccountSettings();

      expect(defaults.syncEnabled).toBe(true);
    });

    it('should have storeTransactionDetailsInNotes default to false', () => {
      const defaults = getDefaultAccountSettings();

      expect(defaults.storeTransactionDetailsInNotes).toBe(false);
    });

    it('should have stripStoreNumbers default to true', () => {
      const defaults = getDefaultAccountSettings();

      expect(defaults.stripStoreNumbers).toBe(true);
    });
  });

  describe('applyTransactionRetentionEviction', () => {
    it('should return true when account has no transactions', () => {
      GM_getValue.mockReturnValue(JSON.stringify([
        {
          wealthsimpleAccount: { id: 'acc-1' },
          uploadedTransactions: [],
        },
      ]));

      const result = applyTransactionRetentionEviction('acc-1');

      expect(result).toBe(true);
    });

    it('should return false when account not found', () => {
      GM_getValue.mockReturnValue('[]');

      const result = applyTransactionRetentionEviction('non-existent');

      expect(result).toBe(false);
    });

    it('should return true when uploadedTransactions is undefined', () => {
      GM_getValue.mockReturnValue(JSON.stringify([
        {
          wealthsimpleAccount: { id: 'acc-1' },
        },
      ]));

      const result = applyTransactionRetentionEviction('acc-1');

      expect(result).toBe(true);
    });

    it('should retain transactions within retention period', () => {
      const today = new Date();
      const recentDate = new Date(today);
      recentDate.setDate(recentDate.getDate() - 5);
      const recentDateStr = recentDate.toISOString().split('T')[0];

      GM_getValue.mockReturnValue(JSON.stringify([
        {
          wealthsimpleAccount: { id: 'acc-1' },
          uploadedTransactions: [
            { id: 'tx-1', date: recentDateStr },
            { id: 'tx-2', date: recentDateStr },
          ],
          transactionRetentionDays: 90,
          transactionRetentionCount: 1000,
        },
      ]));

      const result = applyTransactionRetentionEviction('acc-1');

      expect(result).toBe(true);
      // Should not update if nothing was evicted
    });
  });
});
