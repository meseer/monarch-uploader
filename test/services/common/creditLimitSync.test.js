/**
 * Tests for Credit Limit Sync Service
 */

import { syncCreditLimit } from '../../../src/services/common/creditLimitSync';

// Mock dependencies
jest.mock('../../../src/core/utils', () => ({
  debugLog: jest.fn(),
}));

jest.mock('../../../src/api/monarch', () => ({
  __esModule: true,
  default: {
    setCreditLimit: jest.fn(),
  },
}));

jest.mock('../../../src/services/common/accountService', () => ({
  __esModule: true,
  default: {
    getAccountData: jest.fn(),
    updateAccountInList: jest.fn(() => true),
  },
}));

import monarchApi from '../../../src/api/monarch';
import accountService from '../../../src/services/common/accountService';

describe('Credit Limit Sync Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    accountService.getAccountData.mockReturnValue(null);
  });

  describe('syncCreditLimit', () => {
    it('should skip when credit limit is null', async () => {
      const result = await syncCreditLimit('mbna', 'acc-1', 'monarch-1', null);

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
      expect(result.message).toBe('Not available');
      expect(monarchApi.setCreditLimit).not.toHaveBeenCalled();
    });

    it('should skip when credit limit is undefined', async () => {
      const result = await syncCreditLimit('mbna', 'acc-1', 'monarch-1', undefined);

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
      expect(monarchApi.setCreditLimit).not.toHaveBeenCalled();
    });

    it('should skip API call when credit limit unchanged', async () => {
      accountService.getAccountData.mockReturnValue({ lastSyncedCreditLimit: 5000 });

      const result = await syncCreditLimit('mbna', 'acc-1', 'monarch-1', 5000);

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(false);
      expect(result.message).toContain('unchanged');
      expect(monarchApi.setCreditLimit).not.toHaveBeenCalled();
    });

    it('should call Monarch API when credit limit changed', async () => {
      accountService.getAccountData.mockReturnValue({ lastSyncedCreditLimit: 5000 });
      monarchApi.setCreditLimit.mockResolvedValue({ limit: 10000 });

      const result = await syncCreditLimit('mbna', 'acc-1', 'monarch-1', 10000);

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(false);
      expect(monarchApi.setCreditLimit).toHaveBeenCalledWith('monarch-1', 10000);
    });

    it('should call Monarch API on first sync (no stored value)', async () => {
      accountService.getAccountData.mockReturnValue(null);
      monarchApi.setCreditLimit.mockResolvedValue({ limit: 5000 });

      const result = await syncCreditLimit('mbna', 'acc-1', 'monarch-1', 5000);

      expect(result.success).toBe(true);
      expect(monarchApi.setCreditLimit).toHaveBeenCalledWith('monarch-1', 5000);
    });

    it('should save lastSyncedCreditLimit after successful sync', async () => {
      monarchApi.setCreditLimit.mockResolvedValue({ limit: 7500 });

      await syncCreditLimit('rogersbank', 'rb-1', 'monarch-1', 7500);

      expect(accountService.updateAccountInList).toHaveBeenCalledWith(
        'rogersbank', 'rb-1', { lastSyncedCreditLimit: 7500 },
      );
    });

    it('should return failure when Monarch returns different limit', async () => {
      monarchApi.setCreditLimit.mockResolvedValue({ limit: 3000 });

      const result = await syncCreditLimit('mbna', 'acc-1', 'monarch-1', 5000);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Value not applied');
      expect(accountService.updateAccountInList).not.toHaveBeenCalled();
    });

    it('should return failure when Monarch returns null', async () => {
      monarchApi.setCreditLimit.mockResolvedValue(null);

      const result = await syncCreditLimit('mbna', 'acc-1', 'monarch-1', 5000);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Value not applied');
    });

    it('should handle API errors gracefully', async () => {
      monarchApi.setCreditLimit.mockRejectedValue(new Error('Network error'));

      const result = await syncCreditLimit('mbna', 'acc-1', 'monarch-1', 5000);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Network error');
    });

    it('should format message with locale string for successful sync', async () => {
      monarchApi.setCreditLimit.mockResolvedValue({ limit: 15000 });

      const result = await syncCreditLimit('mbna', 'acc-1', 'monarch-1', 15000);

      expect(result.message).toBe('$15,000');
    });

    it('should handle stored credit limit of 0 correctly', async () => {
      accountService.getAccountData.mockReturnValue({ lastSyncedCreditLimit: 0 });
      monarchApi.setCreditLimit.mockResolvedValue({ limit: 5000 });

      const result = await syncCreditLimit('mbna', 'acc-1', 'monarch-1', 5000);

      // 0 !== 5000, so should call API
      expect(monarchApi.setCreditLimit).toHaveBeenCalledWith('monarch-1', 5000);
      expect(result.success).toBe(true);
    });

    it('should detect unchanged when new limit is also 0', async () => {
      accountService.getAccountData.mockReturnValue({ lastSyncedCreditLimit: 0 });

      const result = await syncCreditLimit('mbna', 'acc-1', 'monarch-1', 0);

      expect(monarchApi.setCreditLimit).not.toHaveBeenCalled();
      expect(result.message).toContain('unchanged');
    });
  });
});