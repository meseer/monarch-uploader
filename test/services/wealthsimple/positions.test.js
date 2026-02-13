/**
 * Wealthsimple Positions Service Tests
 */

import {
  isInvestmentAccount,
  fetchCashBalances,
  processCashPositions,
  resolveSecurityMapping,
  detectAndRemoveDeletedHoldings,
  PositionsError,
} from '../../../src/services/wealthsimple/positions';
import wealthsimpleApi from '../../../src/api/wealthsimple';
import monarchApi from '../../../src/api/monarch';
import accountService from '../../../src/services/common/accountService';
import { showMonarchSecuritySelector } from '../../../src/ui/components/securitySelector';

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

// Mock accountService
jest.mock('../../../src/services/common/accountService', () => ({
  __esModule: true,
  default: {
    getAccountData: jest.fn(),
    updateAccountInList: jest.fn(),
    getHoldingMapping: jest.fn(),
    getHoldingsMappings: jest.fn(),
    saveHoldingMapping: jest.fn(),
    deleteHoldingMapping: jest.fn(),
    clearHoldingsMappings: jest.fn(),
  },
}));

// Mock integrationCapabilities
jest.mock('../../../src/core/integrationCapabilities', () => ({
  INTEGRATIONS: {
    WEALTHSIMPLE: 'wealthsimple',
  },
}));

// Mock toast
jest.mock('../../../src/ui/toast', () => ({
  __esModule: true,
  default: {
    show: jest.fn(),
  },
}));

// Mock security selector
jest.mock('../../../src/ui/components/securitySelector', () => ({
  showMonarchSecuritySelector: jest.fn(),
}));

describe('Wealthsimple Positions Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    accountService.getAccountData.mockReturnValue(null);
    accountService.getHoldingMapping.mockReturnValue(null);
    accountService.getHoldingsMappings.mockReturnValue({});
    accountService.saveHoldingMapping.mockReturnValue(true);
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
      // accountService mocks are already set up in the parent beforeEach
      // Ensure getHoldingMapping returns null so cash holdings get created
      accountService.getHoldingMapping.mockReturnValue(null);
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

  describe('resolveSecurityMapping - crypto auto-mapping', () => {
    test('auto-maps crypto position to {symbol}-USD when exact match found', async () => {
      const position = {
        security: {
          id: 'sec-btc-123',
          securityType: 'CRYPTOCURRENCY',
          stock: { symbol: 'BTC', name: 'Bitcoin' },
        },
        quantity: '0.5',
      };

      // No existing mapping
      accountService.getHoldingMapping.mockReturnValue(null);

      // Monarch search returns BTC-USD
      monarchApi.searchSecurities.mockResolvedValueOnce([
        { id: 'monarch-btc-usd', name: 'Bitcoin USD', ticker: 'BTC-USD', type: 'crypto' },
        { id: 'monarch-btc-cad', name: 'Bitcoin CAD', ticker: 'BTC-CAD', type: 'crypto' },
      ]);

      const result = await resolveSecurityMapping('test-account', position);

      expect(result).toBe('monarch-btc-usd');
      expect(monarchApi.searchSecurities).toHaveBeenCalledWith('BTC-USD', { limit: 5 });
      // Should save the mapping
      expect(accountService.saveHoldingMapping).toHaveBeenCalledWith(
        'wealthsimple',
        'test-account',
        'sec-btc-123',
        expect.objectContaining({
          securityId: 'monarch-btc-usd',
          symbol: 'BTC',
        }),
      );
      // Should NOT show manual selector
      expect(showMonarchSecuritySelector).not.toHaveBeenCalled();
    });

    test('falls through to manual selector when no exact crypto match', async () => {
      const position = {
        security: {
          id: 'sec-doge-123',
          securityType: 'CRYPTOCURRENCY',
          stock: { symbol: 'DOGE', name: 'Dogecoin' },
        },
        quantity: '1000',
      };

      accountService.getHoldingMapping.mockReturnValue(null);

      // No exact match for DOGE-USD
      monarchApi.searchSecurities.mockResolvedValueOnce([
        { id: 'monarch-other', name: 'Something Else', ticker: 'DOGE', type: 'equity' },
      ]);

      // User picks from manual selector
      showMonarchSecuritySelector.mockImplementation((pos, callback) => {
        callback({ id: 'monarch-doge-manual', name: 'Dogecoin Manual' });
      });

      const result = await resolveSecurityMapping('test-account', position);

      expect(result).toBe('monarch-doge-manual');
      expect(showMonarchSecuritySelector).toHaveBeenCalled();
    });

    test('falls through to manual selector when crypto search fails', async () => {
      const position = {
        security: {
          id: 'sec-eth-123',
          securityType: 'CRYPTOCURRENCY',
          stock: { symbol: 'ETH', name: 'Ethereum' },
        },
        quantity: '2',
      };

      accountService.getHoldingMapping.mockReturnValue(null);

      // Search API fails
      monarchApi.searchSecurities.mockRejectedValueOnce(new Error('API Error'));

      // User picks from manual selector
      showMonarchSecuritySelector.mockImplementation((pos, callback) => {
        callback({ id: 'monarch-eth-manual', name: 'Ethereum Manual' });
      });

      const result = await resolveSecurityMapping('test-account', position);

      expect(result).toBe('monarch-eth-manual');
      expect(showMonarchSecuritySelector).toHaveBeenCalled();
    });

    test('skips crypto auto-mapping for non-crypto securities', async () => {
      const position = {
        security: {
          id: 'sec-aapl-123',
          securityType: 'EQUITY',
          stock: { symbol: 'AAPL', name: 'Apple Inc' },
        },
        quantity: '10',
      };

      accountService.getHoldingMapping.mockReturnValue(null);

      // User picks from manual selector
      showMonarchSecuritySelector.mockImplementation((pos, callback) => {
        callback({ id: 'monarch-aapl', name: 'Apple Inc' });
      });

      const result = await resolveSecurityMapping('test-account', position);

      expect(result).toBe('monarch-aapl');
      // Should NOT search for AAPL-USD
      expect(monarchApi.searchSecurities).not.toHaveBeenCalled();
      expect(showMonarchSecuritySelector).toHaveBeenCalled();
    });

    test('uses existing mapping before attempting crypto auto-map', async () => {
      const position = {
        security: {
          id: 'sec-btc-123',
          securityType: 'CRYPTOCURRENCY',
          stock: { symbol: 'BTC', name: 'Bitcoin' },
        },
        quantity: '1',
      };

      // Existing mapping exists
      accountService.getHoldingMapping.mockReturnValue({
        securityId: 'existing-monarch-btc',
        symbol: 'BTC',
      });

      const result = await resolveSecurityMapping('test-account', position);

      expect(result).toBe('existing-monarch-btc');
      // Should NOT search Monarch
      expect(monarchApi.searchSecurities).not.toHaveBeenCalled();
      expect(showMonarchSecuritySelector).not.toHaveBeenCalled();
    });
  });

  describe('detectAndRemoveDeletedHoldings', () => {
    test('deletes holding when mapped position no longer exists (sold position)', async () => {
      // Only ETH position exists now (BTC was sold)
      const currentPositions = [
        { security: { id: 'sec-eth', stock: { symbol: 'ETH' } } },
      ];

      // Monarch has both BTC and ETH holdings
      const portfolio = {
        aggregateHoldings: {
          edges: [
            {
              node: {
                security: { id: 'monarch-sec-btc' },
                holdings: [{ id: 'hold-btc', ticker: 'BTC', isManual: true }],
              },
            },
            {
              node: {
                security: { id: 'monarch-sec-eth' },
                holdings: [{ id: 'hold-eth', ticker: 'ETH', isManual: true }],
              },
            },
          ],
        },
      };

      monarchApi.getHoldings.mockResolvedValue(portfolio);
      monarchApi.deleteHolding.mockResolvedValue(true);

      // Mappings exist for both BTC and ETH
      accountService.getHoldingsMappings.mockReturnValue({
        'sec-btc': { securityId: 'monarch-sec-btc', holdingId: 'hold-btc', symbol: 'BTC' },
        'sec-eth': { securityId: 'monarch-sec-eth', holdingId: 'hold-eth', symbol: 'ETH' },
      });

      const result = await detectAndRemoveDeletedHoldings('test-account', 'monarch-account', currentPositions);

      expect(result.deleted).toBe(1);
      expect(result.autoRepaired).toBe(0);

      // BTC holding should be deleted
      expect(monarchApi.deleteHolding).toHaveBeenCalledWith('hold-btc');
      expect(monarchApi.deleteHolding).toHaveBeenCalledTimes(1);

      // BTC mapping should have holdingId cleared but securityId preserved
      expect(accountService.saveHoldingMapping).toHaveBeenCalledWith(
        'wealthsimple',
        'test-account',
        'sec-btc',
        {
          securityId: 'monarch-sec-btc',
          holdingId: null,
          symbol: 'BTC',
        },
      );
    });

    test('keeps holding when mapped position still exists', async () => {
      const currentPositions = [
        { security: { id: 'sec-eth', stock: { symbol: 'ETH' } } },
      ];

      const portfolio = {
        aggregateHoldings: {
          edges: [
            {
              node: {
                security: { id: 'monarch-sec-eth' },
                holdings: [{ id: 'hold-eth', ticker: 'ETH', isManual: true }],
              },
            },
          ],
        },
      };

      monarchApi.getHoldings.mockResolvedValue(portfolio);

      accountService.getHoldingsMappings.mockReturnValue({
        'sec-eth': { securityId: 'monarch-sec-eth', holdingId: 'hold-eth', symbol: 'ETH' },
      });

      const result = await detectAndRemoveDeletedHoldings('test-account', 'monarch-account', currentPositions);

      expect(result.deleted).toBe(0);
      expect(result.autoRepaired).toBe(0);
      expect(monarchApi.deleteHolding).not.toHaveBeenCalled();
    });

    test('deletes unmapped holding with no matching position', async () => {
      const currentPositions = [
        { security: { id: 'sec-eth', stock: { symbol: 'ETH' } } },
      ];

      const portfolio = {
        aggregateHoldings: {
          edges: [
            {
              node: {
                security: { id: 'monarch-sec-orphan' },
                holdings: [{ id: 'hold-orphan', ticker: 'ORPHAN', isManual: true }],
              },
            },
          ],
        },
      };

      monarchApi.getHoldings.mockResolvedValue(portfolio);
      monarchApi.deleteHolding.mockResolvedValue(true);

      // No mappings
      accountService.getHoldingsMappings.mockReturnValue({});

      const result = await detectAndRemoveDeletedHoldings('test-account', 'monarch-account', currentPositions);

      expect(result.deleted).toBe(1);
      expect(monarchApi.deleteHolding).toHaveBeenCalledWith('hold-orphan');
    });

    test('auto-repairs unmapped holding that matches a position by ticker', async () => {
      const currentPositions = [
        { security: { id: 'sec-aapl', stock: { symbol: 'AAPL' } } },
      ];

      const portfolio = {
        aggregateHoldings: {
          edges: [
            {
              node: {
                security: { id: 'monarch-sec-aapl' },
                holdings: [{ id: 'hold-aapl', ticker: 'AAPL', isManual: true }],
              },
            },
          ],
        },
      };

      monarchApi.getHoldings.mockResolvedValue(portfolio);

      // No mappings
      accountService.getHoldingsMappings.mockReturnValue({});

      const result = await detectAndRemoveDeletedHoldings('test-account', 'monarch-account', currentPositions);

      expect(result.deleted).toBe(0);
      expect(result.autoRepaired).toBe(1);
      expect(accountService.saveHoldingMapping).toHaveBeenCalledWith(
        'wealthsimple',
        'test-account',
        'sec-aapl',
        expect.objectContaining({
          securityId: 'monarch-sec-aapl',
          holdingId: 'hold-aapl',
          symbol: 'AAPL',
        }),
      );
    });

    test('handles all four cases in a single run', async () => {
      // Positions: ETH exists, AAPL exists; BTC sold, ORPHAN never existed
      const currentPositions = [
        { security: { id: 'sec-eth', stock: { symbol: 'ETH' } } },
        { security: { id: 'sec-aapl', stock: { symbol: 'AAPL' } } },
      ];

      const portfolio = {
        aggregateHoldings: {
          edges: [
            {
              node: {
                security: { id: 'monarch-sec-eth' },
                holdings: [{ id: 'hold-eth', ticker: 'ETH', isManual: true }],
              },
            },
            {
              node: {
                security: { id: 'monarch-sec-btc' },
                holdings: [{ id: 'hold-btc', ticker: 'BTC', isManual: true }],
              },
            },
            {
              node: {
                security: { id: 'monarch-sec-aapl' },
                holdings: [{ id: 'hold-aapl', ticker: 'AAPL', isManual: true }],
              },
            },
            {
              node: {
                security: { id: 'monarch-sec-orphan' },
                holdings: [{ id: 'hold-orphan', ticker: 'ORPHAN', isManual: true }],
              },
            },
          ],
        },
      };

      monarchApi.getHoldings.mockResolvedValue(portfolio);
      monarchApi.deleteHolding.mockResolvedValue(true);

      // ETH has mapping, BTC has mapping (but position sold)
      accountService.getHoldingsMappings.mockReturnValue({
        'sec-eth': { securityId: 'monarch-sec-eth', holdingId: 'hold-eth', symbol: 'ETH' },
        'sec-btc': { securityId: 'monarch-sec-btc', holdingId: 'hold-btc', symbol: 'BTC' },
      });

      const result = await detectAndRemoveDeletedHoldings('test-account', 'monarch-account', currentPositions);

      // Case 1: ETH kept (mapped + position exists)
      // Case 2: BTC deleted (mapped + position sold)
      // Case 3: AAPL auto-repaired (unmapped + ticker match)
      // Case 4: ORPHAN deleted (unmapped + no match)
      expect(result.deleted).toBe(2); // BTC + ORPHAN
      expect(result.autoRepaired).toBe(1); // AAPL
      expect(monarchApi.deleteHolding).toHaveBeenCalledWith('hold-btc');
      expect(monarchApi.deleteHolding).toHaveBeenCalledWith('hold-orphan');
      expect(monarchApi.deleteHolding).toHaveBeenCalledTimes(2);
    });

    test('handles empty Monarch holdings', async () => {
      monarchApi.getHoldings.mockResolvedValue(null);

      const result = await detectAndRemoveDeletedHoldings('test-account', 'monarch-account', []);

      expect(result.deleted).toBe(0);
      expect(result.autoRepaired).toBe(0);
    });

    test('handles deletion errors gracefully', async () => {
      const currentPositions = [];

      const portfolio = {
        aggregateHoldings: {
          edges: [
            {
              node: {
                security: { id: 'monarch-sec' },
                holdings: [{ id: 'hold-1', ticker: 'FAIL', isManual: true }],
              },
            },
          ],
        },
      };

      accountService.getHoldingsMappings.mockReturnValue({});
      monarchApi.getHoldings.mockResolvedValue(portfolio);
      monarchApi.deleteHolding.mockRejectedValue(new Error('Delete failed'));

      const result = await detectAndRemoveDeletedHoldings('test-account', 'monarch-account', currentPositions);

      // Should continue despite error
      expect(result.deleted).toBe(0);
    });

    test('handles API error gracefully', async () => {
      monarchApi.getHoldings.mockRejectedValue(new Error('API error'));

      const result = await detectAndRemoveDeletedHoldings('test-account', 'monarch-account', []);

      expect(result.deleted).toBe(0);
      expect(result.autoRepaired).toBe(0);
    });
  });
});
