/**
 * Tests for Wealthsimple Account Service
 */

import { syncCreditLimit } from '../../../src/services/wealthsimple/account';
import wealthsimpleApi from '../../../src/api/wealthsimple';
import monarchApi from '../../../src/api/monarch';
import toast from '../../../src/ui/toast';
import { STORAGE } from '../../../src/core/config';

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
});
