/**
 * Tests for Wealthsimple Upload Service
 */

import {
  uploadAllWealthsimpleAccountsToMonarch,
} from '../../src/services/wealthsimple-upload';
import toast from '../../src/ui/toast';
import * as accountService from '../../src/services/wealthsimple/account';

// Mock dependencies
jest.mock('../../src/ui/toast');
jest.mock('../../src/services/wealthsimple/account');
jest.mock('../../src/core/utils', () => ({
  debugLog: jest.fn(),
}));

describe('Wealthsimple Upload Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('uploadAllWealthsimpleAccountsToMonarch', () => {
    it('should successfully process accounts', async () => {
      const mockAccounts = [
        {
          id: 'acc-1',
          nickname: 'My TFSA',
          type: 'TFSA',
          currency: 'CAD',
          branch: 'WS',
        },
        {
          id: 'acc-2',
          nickname: 'My RRSP',
          type: 'RRSP',
          currency: 'CAD',
          branch: 'WS',
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
      expect(toast.show).toHaveBeenCalledWith(
        '2 failed',
        'warning',
      );
    });

    it('should handle no accounts found', async () => {
      accountService.syncAccountListWithAPI.mockResolvedValue([]);

      await uploadAllWealthsimpleAccountsToMonarch();

      expect(toast.show).toHaveBeenCalledWith(
        'No Wealthsimple accounts found',
        'warning',
      );
    });

    it('should handle null accounts response', async () => {
      accountService.syncAccountListWithAPI.mockResolvedValue(null);

      await uploadAllWealthsimpleAccountsToMonarch();

      expect(toast.show).toHaveBeenCalledWith(
        'No Wealthsimple accounts found',
        'warning',
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
      const mockAccounts = [
        {
          id: 'acc-1',
          nickname: 'My TFSA',
          type: 'TFSA',
        },
      ];

      const mockMonarchAccount = { id: 'monarch-1', displayName: 'Test Account' };

      accountService.syncAccountListWithAPI.mockResolvedValue(mockAccounts);
      accountService.resolveWealthsimpleAccountMapping.mockResolvedValue(mockMonarchAccount);
      accountService.uploadWealthsimpleBalance.mockResolvedValue(false);
      accountService.uploadWealthsimpleTransactions.mockResolvedValue(false);

      await uploadAllWealthsimpleAccountsToMonarch();

      expect(toast.show).toHaveBeenCalledWith(
        '1 failed',
        'warning',
      );
    });
  });
});
