/**
 * Tests for Wealthsimple Upload Service
 */

import {
  uploadAllWealthsimpleAccountsToMonarch,
} from '../../src/services/wealthsimple-upload';
import wealthsimpleApi from '../../src/api/wealthsimple';
import toast from '../../src/ui/toast';

// Mock dependencies
jest.mock('../../src/api/wealthsimple');
jest.mock('../../src/ui/toast');
jest.mock('../../src/core/utils', () => ({
  debugLog: jest.fn(),
}));

describe('Wealthsimple Upload Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('uploadAllWealthsimpleAccountsToMonarch', () => {
    it('should successfully fetch and log accounts', async () => {
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

      wealthsimpleApi.fetchAccounts.mockResolvedValue(mockAccounts);

      await uploadAllWealthsimpleAccountsToMonarch();

      expect(wealthsimpleApi.fetchAccounts).toHaveBeenCalled();
      expect(toast.show).toHaveBeenCalledWith(
        'Successfully fetched 2 Wealthsimple accounts. Check console for details.',
        'info',
      );
    });

    it('should handle no accounts found', async () => {
      wealthsimpleApi.fetchAccounts.mockResolvedValue([]);

      await uploadAllWealthsimpleAccountsToMonarch();

      expect(toast.show).toHaveBeenCalledWith(
        'No Wealthsimple accounts found',
        'warning',
      );
    });

    it('should handle null accounts response', async () => {
      wealthsimpleApi.fetchAccounts.mockResolvedValue(null);

      await uploadAllWealthsimpleAccountsToMonarch();

      expect(toast.show).toHaveBeenCalledWith(
        'No Wealthsimple accounts found',
        'warning',
      );
    });

    it('should handle API errors', async () => {
      const error = new Error('API connection failed');
      wealthsimpleApi.fetchAccounts.mockRejectedValue(error);

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

      wealthsimpleApi.fetchAccounts.mockResolvedValue(mockAccounts);

      await uploadAllWealthsimpleAccountsToMonarch();

      expect(toast.show).toHaveBeenCalledWith(
        'Successfully fetched 1 Wealthsimple accounts. Check console for details.',
        'info',
      );
    });
  });
});
