/**
 * Wealthsimple Positions Service Tests
 */

import {
  isInvestmentAccount,
  fetchCashBalances,
  processCashPositions,
  PositionsError,
} from '../../../src/services/wealthsimple/positions';
import wealthsimpleApi from '../../../src/api/wealthsimple';
import monarchApi from '../../../src/api/monarch';

// Mock the Wealthsimple API
jest.mock('../../../src/api/wealthsimple', () => ({
  fetchAccountsWithBalance: jest.fn(),
  fetchIdentityPositions: jest.fn(),
}));

// Mock the Monarch API
jest.mock('../../../src/api/monarch', () => ({
  getHoldings: jest.fn(),
  createManualHolding: jest.fn(),
  updateHolding: jest.fn(),
  deleteHolding: jest.fn(),
  searchSecurities: jest.fn(),
}));

// Mock the account module
jest.mock('../../../src/services/wealthsimple/account', () => ({
  getAccountData: jest.fn(() => ({
    holdingsMappings: {},
    wealthsimpleAccount: { id: 'test-account', nickname: 'Test Account' },
  })),
  updateAccountInList: jest.fn(),
}));

// Mock toast
jest.mock('../../../src/ui/toast', () => ({
  show: jest.fn(),
}));

// Mock security selector
jest.mock('../../../src/ui/components/securitySelector', () => ({
  showMonarchSecuritySelector: jest.fn(),
}));

describe('Wealthsimple Positions Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('isInvestmentAccount', () => {
    test('returns true for SELF_DIRECTED_RRSP', () => {
      expect(isInvestmentAccount('SELF_DIRECTED_RRSP')).toBe(true);
    });

    test('returns true for SELF_DIRECTED_TFSA', () => {
      expect(isInvestmentAccount('SELF_DIRECTED_TFSA')).toBe(true);
    });

    test('returns true for MANAGED_RRSP', () => {
      expect(isInvestmentAccount('MANAGED_RRSP')).toBe(true);
    });

    test('returns true for MANAGED_TFSA', () => {
      expect(isInvestmentAccount('MANAGED_TFSA')).toBe(true);
    });

    test('returns true for SELF_DIRECTED_NON_REGISTERED', () => {
      expect(isInvestmentAccount('SELF_DIRECTED_NON_REGISTERED')).toBe(true);
    });

    test('returns false for CREDIT_CARD', () => {
      expect(isInvestmentAccount('CREDIT_CARD')).toBe(false);
    });

    test('returns false for CASH', () => {
      expect(isInvestmentAccount('CASH')).toBe(false);
    });

    test('returns false for unknown type', () => {
      expect(isInvestmentAccount('UNKNOWN_TYPE')).toBe(false);
    });
  });

  describe('fetchCashBalances', () => {
    test('fetches CAD and USD cash balances', async () => {
      const mockBalances = {
        'rrsp-qthtmh-s': {
          cad: 0.01,
          usd: 0.46,
        },
      };

      wealthsimpleApi.fetchAccountsWithBalance.mockResolvedValueOnce(mockBalances);

      const result = await fetchCashBalances('rrsp-qthtmh-s');

      expect(wealthsimpleApi.fetchAccountsWithBalance).toHaveBeenCalledWith(['rrsp-qthtmh-s']);
      expect(result).toEqual({ cad: 0.01, usd: 0.46 });
    });

    test('returns null values when account not found in response', async () => {
      wealthsimpleApi.fetchAccountsWithBalance.mockResolvedValueOnce({});

      const result = await fetchCashBalances('unknown-account');

      expect(result).toEqual({ cad: null, usd: null });
    });

    test('handles zero balances', async () => {
      const mockBalances = {
        'test-account': {
          cad: 0,
          usd: 0,
        },
      };

      wealthsimpleApi.fetchAccountsWithBalance.mockResolvedValueOnce(mockBalances);

      const result = await fetchCashBalances('test-account');

      expect(result).toEqual({ cad: 0, usd: 0 });
    });

    test('handles negative balances (margin debit)', async () => {
      const mockBalances = {
        'test-account': {
          cad: -100.50,
          usd: -25.00,
        },
      };

      wealthsimpleApi.fetchAccountsWithBalance.mockResolvedValueOnce(mockBalances);

      const result = await fetchCashBalances('test-account');

      expect(result).toEqual({ cad: -100.50, usd: -25.00 });
    });

    test('throws PositionsError when account ID is missing', async () => {
      await expect(fetchCashBalances(null)).rejects.toThrow(PositionsError);
      await expect(fetchCashBalances('')).rejects.toThrow(PositionsError);
    });

    test('throws PositionsError when API fails', async () => {
      wealthsimpleApi.fetchAccountsWithBalance.mockRejectedValueOnce(new Error('API Error'));

      await expect(fetchCashBalances('test-account')).rejects.toThrow(PositionsError);
    });
  });

  describe('processCashPositions', () => {
    const mockProgressDialog = {
      updateStepStatus: jest.fn(),
    };

    beforeEach(() => {
      // Reset account mock to provide holdingsMappings
      const accountMock = require('../../../src/services/wealthsimple/account');
      accountMock.getAccountData.mockReturnValue({
        holdingsMappings: {},
        wealthsimpleAccount: { id: 'test-account', nickname: 'Test Account' },
      });
    });

    test('syncs CAD and USD cash balances', async () => {
      // Mock cash balances from Wealthsimple
      wealthsimpleApi.fetchAccountsWithBalance.mockResolvedValueOnce({
        'test-account': { cad: 100.50, usd: 50.25 },
      });

      // Mock empty holdings from Monarch
      monarchApi.getHoldings.mockResolvedValueOnce({
        aggregateHoldings: { edges: [] },
      });

      // Mock creating new holdings
      monarchApi.createManualHolding.mockResolvedValueOnce({ id: 'cad-holding-123', ticker: 'CUR:CAD' });
      monarchApi.createManualHolding.mockResolvedValueOnce({ id: 'usd-holding-456', ticker: 'CUR:USD' });

      // Mock updating holdings
      monarchApi.updateHolding.mockResolvedValue(true);

      const result = await processCashPositions(
        'test-account',
        'Test Account',
        'monarch-account-id',
        mockProgressDialog,
      );

      expect(result.success).toBe(true);
      expect(result.cashSynced).toBe(2);
      expect(result.cashSkipped).toBe(0);

      // Verify progress dialog was updated
      expect(mockProgressDialog.updateStepStatus).toHaveBeenCalledWith(
        'test-account',
        'cashSync',
        'processing',
        'Fetching cash balances...',
      );
    });

    test('handles zero balances correctly', async () => {
      wealthsimpleApi.fetchAccountsWithBalance.mockResolvedValueOnce({
        'test-account': { cad: 0, usd: 0 },
      });

      monarchApi.getHoldings.mockResolvedValueOnce({
        aggregateHoldings: { edges: [] },
      });

      monarchApi.createManualHolding.mockResolvedValue({ id: 'holding-123', ticker: 'CUR:CAD' });
      monarchApi.updateHolding.mockResolvedValue(true);

      const result = await processCashPositions(
        'test-account',
        'Test Account',
        'monarch-account-id',
        mockProgressDialog,
      );

      expect(result.success).toBe(true);
      expect(result.cashSynced).toBe(2);

      // Verify updateHolding was called with zero quantity
      expect(monarchApi.updateHolding).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ quantity: 0 }),
      );
    });

    test('handles negative balances correctly', async () => {
      wealthsimpleApi.fetchAccountsWithBalance.mockResolvedValueOnce({
        'test-account': { cad: -50.00, usd: -10.00 },
      });

      monarchApi.getHoldings.mockResolvedValueOnce({
        aggregateHoldings: { edges: [] },
      });

      monarchApi.createManualHolding.mockResolvedValue({ id: 'holding-123', ticker: 'CUR:CAD' });
      monarchApi.updateHolding.mockResolvedValue(true);

      const result = await processCashPositions(
        'test-account',
        'Test Account',
        'monarch-account-id',
        mockProgressDialog,
      );

      expect(result.success).toBe(true);
      expect(result.cashSynced).toBe(2);

      // Verify updateHolding was called with negative quantity
      expect(monarchApi.updateHolding).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ quantity: -50.00, costBasis: 1, securityType: 'cash' }),
      );
    });

    test('handles null balance values (no cash for that currency)', async () => {
      wealthsimpleApi.fetchAccountsWithBalance.mockResolvedValueOnce({
        'test-account': { cad: 100.00, usd: null },
      });

      monarchApi.getHoldings.mockResolvedValueOnce({
        aggregateHoldings: { edges: [] },
      });

      monarchApi.createManualHolding.mockResolvedValue({ id: 'holding-123', ticker: 'CUR:CAD' });
      monarchApi.updateHolding.mockResolvedValue(true);

      const result = await processCashPositions(
        'test-account',
        'Test Account',
        'monarch-account-id',
        mockProgressDialog,
      );

      expect(result.success).toBe(true);
      expect(result.cashSynced).toBe(1); // Only CAD was synced
      expect(result.cashSkipped).toBe(0);
    });

    test('handles API errors gracefully', async () => {
      wealthsimpleApi.fetchAccountsWithBalance.mockRejectedValueOnce(new Error('API Error'));

      const result = await processCashPositions(
        'test-account',
        'Test Account',
        'monarch-account-id',
        mockProgressDialog,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('API Error');

      // Verify error status was set in progress dialog
      expect(mockProgressDialog.updateStepStatus).toHaveBeenCalledWith(
        'test-account',
        'cashSync',
        'error',
        expect.stringContaining('Error'),
      );
    });

    test('works without progress dialog', async () => {
      wealthsimpleApi.fetchAccountsWithBalance.mockResolvedValueOnce({
        'test-account': { cad: 100.00, usd: 50.00 },
      });

      monarchApi.getHoldings.mockResolvedValueOnce({
        aggregateHoldings: { edges: [] },
      });

      monarchApi.createManualHolding.mockResolvedValue({ id: 'holding-123', ticker: 'CUR:CAD' });
      monarchApi.updateHolding.mockResolvedValue(true);

      // Should not throw when progressDialog is null
      const result = await processCashPositions(
        'test-account',
        'Test Account',
        'monarch-account-id',
        null,
      );

      expect(result.success).toBe(true);
    });
  });
});
