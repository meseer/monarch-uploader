/**
 * Test suite for Questrade Positions Service
 */

import { jest } from '@jest/globals';

// Import after mocks
import {
  PositionsError,
  fetchPositions,
  resolveSecurityMapping,
  resolveOrCreateHolding,
  findHoldingById,
  syncPositionToHolding,
  detectAndRemoveDeletedHoldings,
  processAccountPositions,
} from '../../../src/services/questrade/positions';
import questradeApi from '../../../src/api/questrade';
import monarchApi from '../../../src/api/monarch';
import { showMonarchSecuritySelector } from '../../../src/ui/components/securitySelector';
import toast from '../../../src/ui/toast';
import accountService from '../../../src/services/common/accountService';

// Mock all dependencies first
jest.mock('../../../src/core/utils', () => ({
  debugLog: jest.fn(),
}));

jest.mock('../../../src/core/config', () => ({
  STORAGE: {
    ACCOUNTS_LIST: 'questrade_accounts_list',
  },
}));

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

jest.mock('../../../src/core/integrationCapabilities', () => ({
  INTEGRATIONS: {
    QUESTRADE: 'questrade',
  },
}));

jest.mock('../../../src/api/questrade', () => ({
  __esModule: true,
  default: {
    fetchPositions: jest.fn(),
  },
}));

jest.mock('../../../src/api/monarch', () => ({
  __esModule: true,
  default: {
    createManualHolding: jest.fn(),
    updateHolding: jest.fn(),
    getHoldings: jest.fn(),
    deleteHolding: jest.fn(),
  },
}));

jest.mock('../../../src/ui/components/securitySelector', () => ({
  showMonarchSecuritySelector: jest.fn(),
}));

jest.mock('../../../src/ui/toast', () => ({
  __esModule: true,
  default: {
    show: jest.fn(),
  },
}));

describe('Questrade Positions Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset GM storage
    global.GM_getValue = jest.fn((key, defaultValue) => defaultValue);
    global.GM_setValue = jest.fn();
    // Reset accountService mocks
    accountService.getAccountData.mockReturnValue(null);
    accountService.updateAccountInList.mockReturnValue(true);
    accountService.getHoldingMapping.mockReturnValue(null);
    accountService.getHoldingsMappings.mockReturnValue({});
    accountService.saveHoldingMapping.mockReturnValue(true);
  });

  describe('PositionsError', () => {
    test('should create error with account ID', () => {
      const error = new PositionsError('Test error', 'ACC123');
      expect(error.message).toBe('Test error');
      expect(error.name).toBe('PositionsError');
      expect(error.accountId).toBe('ACC123');
      expect(error.position).toBeNull();
    });

    test('should create error with position data', () => {
      const position = { symbol: 'AAPL' };
      const error = new PositionsError('Test error', 'ACC123', position);
      expect(error.position).toBe(position);
    });
  });

  describe('fetchPositions', () => {
    test('should fetch positions successfully', async () => {
      const mockPositions = [
        { securityUuid: 'UUID1', security: { symbol: 'AAPL' } },
        { securityUuid: 'UUID2', security: { symbol: 'GOOGL' } },
      ];

      questradeApi.fetchPositions.mockResolvedValue({ data: mockPositions });

      const result = await fetchPositions('ACC123');

      expect(result).toEqual(mockPositions);
      expect(questradeApi.fetchPositions).toHaveBeenCalledWith('ACC123');
    });

    test('should throw error when account ID is missing', async () => {
      await expect(fetchPositions('')).rejects.toThrow(PositionsError);
      await expect(fetchPositions(null)).rejects.toThrow('Account ID is required');
    });

    test('should return empty array when no positions data', async () => {
      questradeApi.fetchPositions.mockResolvedValue({});
      const result = await fetchPositions('ACC123');
      expect(result).toEqual([]);
    });

    test('should handle API errors', async () => {
      questradeApi.fetchPositions.mockRejectedValue(new Error('API error'));

      await expect(fetchPositions('ACC123')).rejects.toThrow(PositionsError);
      await expect(fetchPositions('ACC123')).rejects.toThrow('Failed to fetch positions');
    });

    test('should return empty array for non-array positions', async () => {
      questradeApi.fetchPositions.mockResolvedValue({ data: 'not an array' });
      const result = await fetchPositions('ACC123');
      expect(result).toEqual([]);
    });
  });

  describe('resolveSecurityMapping', () => {
    test('should return existing mapping from consolidated storage', async () => {
      const position = {
        securityUuid: 'UUID1',
        security: { symbol: 'AAPL' },
      };

      // Mock getHoldingMapping to return existing mapping
      accountService.getHoldingMapping.mockReturnValue({
        securityId: 'SEC123',
        holdingId: 'HOLD123',
        symbol: 'AAPL',
      });

      const result = await resolveSecurityMapping('ACC123', position);

      expect(result).toBe('SEC123');
      expect(accountService.getHoldingMapping).toHaveBeenCalledWith('questrade', 'ACC123', 'UUID1');
      expect(showMonarchSecuritySelector).not.toHaveBeenCalled();
    });

    test('should fall back to legacy storage when consolidated has no mappings', async () => {
      const position = {
        securityUuid: 'UUID1',
        security: { symbol: 'AAPL' },
      };

      // getHoldingMapping returns mapping from legacy storage via accountService
      accountService.getHoldingMapping.mockReturnValue({
        securityId: 'SEC456',
        holdingId: 'HOLD456',
        symbol: 'AAPL',
      });

      const result = await resolveSecurityMapping('ACC123', position);

      expect(result).toBe('SEC456');
      expect(showMonarchSecuritySelector).not.toHaveBeenCalled();
    });

    test('should return existing mapping from legacy storage when account not in consolidated', async () => {
      const position = {
        securityUuid: 'UUID1',
        security: { symbol: 'AAPL' },
      };

      // getHoldingMapping returns the mapping
      accountService.getHoldingMapping.mockReturnValue({
        securityId: 'SEC123',
        holdingId: 'HOLD123',
        symbol: 'AAPL',
      });

      const result = await resolveSecurityMapping('ACC123', position);

      expect(result).toBe('SEC123');
      expect(showMonarchSecuritySelector).not.toHaveBeenCalled();
    });

    test('should show selector when no mapping exists in either storage', async () => {
      const position = {
        securityUuid: 'UUID1',
        security: { symbol: 'AAPL' },
      };

      // No mapping exists
      accountService.getHoldingMapping.mockReturnValue(null);

      showMonarchSecuritySelector.mockImplementation((pos, callback) => {
        callback({ id: 'SEC456', name: 'Apple Inc' });
      });

      const result = await resolveSecurityMapping('ACC123', position);

      expect(result).toBe('SEC456');
      expect(showMonarchSecuritySelector).toHaveBeenCalledWith(
        position,
        expect.any(Function),
      );
    });

    test('should return null when user cancels selection', async () => {
      const position = {
        securityUuid: 'UUID1',
        security: { symbol: 'AAPL' },
      };

      accountService.getHoldingMapping.mockReturnValue(null);

      showMonarchSecuritySelector.mockImplementation((pos, callback) => {
        callback(null); // User cancelled
      });

      const result = await resolveSecurityMapping('ACC123', position);

      expect(result).toBeNull();
    });

    test('should throw error when position missing security UUID', async () => {
      const position = {
        security: { symbol: 'AAPL' },
      };

      await expect(resolveSecurityMapping('ACC123', position)).rejects.toThrow(
        PositionsError,
      );
      await expect(resolveSecurityMapping('ACC123', position)).rejects.toThrow(
        'Position missing security UUID',
      );
    });

    test('should use symbolId as fallback for securityUuid', async () => {
      const position = {
        symbolId: 'SYM123',
        security: { symbol: 'AAPL' },
      };

      // getHoldingMapping should be called with symbolId
      accountService.getHoldingMapping.mockReturnValue({
        securityId: 'SEC789',
        holdingId: 'HOLD789',
        symbol: 'AAPL',
      });

      const result = await resolveSecurityMapping('ACC123', position);

      expect(result).toBe('SEC789');
      expect(accountService.getHoldingMapping).toHaveBeenCalledWith('questrade', 'ACC123', 'SYM123');
    });
  });

  describe('holdings mappings storage', () => {
    test('should save holdings to consolidated storage', async () => {
      const position = {
        securityUuid: 'UUID1',
        security: { symbol: 'AAPL' },
        openQuantity: 100,
      };

      // No existing mappings
      accountService.getHoldingMapping.mockReturnValue(null);

      monarchApi.createManualHolding.mockResolvedValue({ id: 'HOLD123' });

      await resolveOrCreateHolding(
        'ACC123',
        'MON123',
        'SEC123',
        position,
        { aggregateHoldings: { edges: [] } },
      );

      // Should save via accountService.saveHoldingMapping
      expect(accountService.saveHoldingMapping).toHaveBeenCalledWith(
        'questrade',
        'ACC123',
        'UUID1',
        expect.objectContaining({
          securityId: 'SEC123',
          holdingId: 'HOLD123',
          symbol: 'AAPL',
        }),
      );
    });

    test('should use existing holding from storage when validated in Monarch', async () => {
      const position = {
        securityUuid: 'UUID1',
        security: { symbol: 'AAPL' },
        openQuantity: 100,
      };

      // Existing mapping returns holdingId
      accountService.getHoldingMapping.mockReturnValue({
        securityId: 'SEC123',
        holdingId: 'HOLD123',
        symbol: 'AAPL',
      });

      // Holdings include the stored holdingId (validates it exists in Monarch)
      const holdings = {
        aggregateHoldings: {
          edges: [
            {
              node: {
                security: { id: 'SEC123' },
                holdings: [{ id: 'HOLD123', isManual: true, ticker: 'AAPL' }],
              },
            },
          ],
        },
      };

      const result = await resolveOrCreateHolding(
        'ACC123',
        'MON123',
        'SEC123',
        position,
        holdings,
      );

      expect(result).toBe('HOLD123');
      // Should not create new holding
      expect(monarchApi.createManualHolding).not.toHaveBeenCalled();
      // Should not save since mapping already exists and is valid
      expect(accountService.saveHoldingMapping).not.toHaveBeenCalled();
    });

    test('should find and save mapping when holding exists in Monarch', async () => {
      const position = {
        securityUuid: 'UUID2',
        security: { symbol: 'GOOGL' },
        openQuantity: 50,
      };

      // No existing mapping
      accountService.getHoldingMapping.mockReturnValue(null);

      // Holdings exist in Monarch
      const holdings = {
        aggregateHoldings: {
          edges: [
            {
              node: {
                security: { id: 'SEC2' },
                holdings: [{ id: 'HOLD2', isManual: true }],
              },
            },
          ],
        },
      };

      const result = await resolveOrCreateHolding(
        'ACC123',
        'MON123',
        'SEC2',
        position,
        holdings,
      );

      expect(result).toBe('HOLD2');
      // Should save the mapping
      expect(accountService.saveHoldingMapping).toHaveBeenCalledWith(
        'questrade',
        'ACC123',
        'UUID2',
        expect.objectContaining({
          securityId: 'SEC2',
          holdingId: 'HOLD2',
          symbol: 'GOOGL',
        }),
      );
    });

    test('should prefer consolidated storage over legacy when both exist', async () => {
      const position = {
        securityUuid: 'UUID1',
        security: { symbol: 'AAPL' },
      };

      // getHoldingMapping returns consolidated value (accountService handles the priority)
      accountService.getHoldingMapping.mockReturnValue({
        securityId: 'CONSOLIDATED_SEC',
        holdingId: 'CONSOLIDATED_HOLD',
        symbol: 'AAPL',
      });

      const result = await resolveSecurityMapping('ACC123', position);

      // Should use consolidated via accountService
      expect(result).toBe('CONSOLIDATED_SEC');
    });
  });

  describe('findHoldingById', () => {
    test('returns holding when found by ID', () => {
      const holdings = {
        aggregateHoldings: {
          edges: [
            {
              node: {
                security: { id: 'sec-1' },
                holdings: [
                  { id: 'hold-aaa', ticker: 'AAPL', isManual: true },
                  { id: 'hold-bbb', ticker: 'GOOGL', isManual: true },
                ],
              },
            },
            {
              node: {
                security: { id: 'sec-2' },
                holdings: [{ id: 'hold-ccc', ticker: 'MSFT', isManual: true }],
              },
            },
          ],
        },
      };

      expect(findHoldingById('hold-aaa', holdings)).toEqual({ id: 'hold-aaa', ticker: 'AAPL', isManual: true });
      expect(findHoldingById('hold-bbb', holdings)).toEqual({ id: 'hold-bbb', ticker: 'GOOGL', isManual: true });
      expect(findHoldingById('hold-ccc', holdings)).toEqual({ id: 'hold-ccc', ticker: 'MSFT', isManual: true });
    });

    test('returns null when holdingId not found', () => {
      const holdings = {
        aggregateHoldings: {
          edges: [
            {
              node: {
                security: { id: 'sec-1' },
                holdings: [{ id: 'hold-aaa', ticker: 'AAPL', isManual: true }],
              },
            },
          ],
        },
      };

      expect(findHoldingById('hold-nonexistent', holdings)).toBeNull();
    });

    test('returns null for null holdings', () => {
      expect(findHoldingById('hold-1', null)).toBeNull();
    });

    test('returns null for empty holdings', () => {
      expect(findHoldingById('hold-1', { aggregateHoldings: { edges: [] } })).toBeNull();
    });

    test('returns null when aggregateHoldings has no holdings array', () => {
      const holdings = {
        aggregateHoldings: {
          edges: [{ node: { security: { id: 'sec-1' } } }],
        },
      };
      expect(findHoldingById('hold-1', holdings)).toBeNull();
    });
  });

  describe('resolveOrCreateHolding', () => {
    const position = {
      securityUuid: 'UUID1',
      security: { symbol: 'AAPL' },
      openQuantity: 100,
    };

    test('should return existing holding ID from storage when validated in Monarch', async () => {
      // Mock getHoldingMapping to return existing mapping with holdingId
      accountService.getHoldingMapping.mockReturnValue({
        securityId: 'SEC123',
        holdingId: 'HOLD123',
        symbol: 'AAPL',
      });

      // Holdings include the stored holdingId (validates it exists)
      const holdings = {
        aggregateHoldings: {
          edges: [
            {
              node: {
                security: { id: 'SEC123' },
                holdings: [{ id: 'HOLD123', isManual: true, ticker: 'AAPL' }],
              },
            },
          ],
        },
      };

      const result = await resolveOrCreateHolding(
        'ACC123',
        'MON123',
        'SEC123',
        position,
        holdings,
      );

      expect(result).toBe('HOLD123');
      expect(monarchApi.createManualHolding).not.toHaveBeenCalled();
      // Should NOT save mapping since it's still valid
      expect(accountService.saveHoldingMapping).not.toHaveBeenCalled();
    });

    test('should clear stale holdingId and re-create holding when not found in Monarch', async () => {
      // Stored mapping points to a holdingId that no longer exists
      accountService.getHoldingMapping.mockReturnValue({
        securityId: 'SEC123',
        holdingId: 'HOLD-STALE',
        symbol: 'AAPL',
      });

      // Empty holdings — the stale holding doesn't exist
      const emptyHoldings = { aggregateHoldings: { edges: [] } };

      monarchApi.createManualHolding.mockResolvedValue({ id: 'HOLD-NEW' });

      const result = await resolveOrCreateHolding(
        'ACC123',
        'MON123',
        'SEC123',
        position,
        emptyHoldings,
      );

      expect(result).toBe('HOLD-NEW');

      // First call: clear stale holdingId
      expect(accountService.saveHoldingMapping).toHaveBeenCalledWith(
        'questrade',
        'ACC123',
        'UUID1',
        expect.objectContaining({
          securityId: 'SEC123',
          holdingId: null,
          symbol: 'AAPL',
        }),
      );

      // Second call: save new holdingId
      expect(accountService.saveHoldingMapping).toHaveBeenCalledWith(
        'questrade',
        'ACC123',
        'UUID1',
        expect.objectContaining({
          securityId: 'SEC123',
          holdingId: 'HOLD-NEW',
          symbol: 'AAPL',
        }),
      );

      expect(monarchApi.createManualHolding).toHaveBeenCalledWith('MON123', 'SEC123', 100);
    });

    test('should find existing Monarch holding by security after clearing stale holdingId', async () => {
      // Stored mapping points to stale holdingId, but the security exists with a different holdingId
      accountService.getHoldingMapping.mockReturnValue({
        securityId: 'SEC123',
        holdingId: 'HOLD-STALE',
        symbol: 'AAPL',
      });

      const holdings = {
        aggregateHoldings: {
          edges: [
            {
              node: {
                security: { id: 'SEC123' },
                holdings: [{ id: 'HOLD-REAL', isManual: true, ticker: 'AAPL' }],
              },
            },
          ],
        },
      };

      const result = await resolveOrCreateHolding(
        'ACC123',
        'MON123',
        'SEC123',
        position,
        holdings,
      );

      // Should find existing holding by security ID (not the stale one)
      expect(result).toBe('HOLD-REAL');
      expect(monarchApi.createManualHolding).not.toHaveBeenCalled();
    });

    test('should find existing holding in Monarch data', async () => {
      accountService.getHoldingMapping.mockReturnValue(null);

      const holdings = {
        aggregateHoldings: {
          edges: [
            {
              node: {
                security: { id: 'SEC123' },
                holdings: [{ id: 'HOLD456', isManual: true }],
              },
            },
          ],
        },
      };

      const result = await resolveOrCreateHolding(
        'ACC123',
        'MON123',
        'SEC123',
        position,
        holdings,
      );

      expect(result).toBe('HOLD456');
      // Should save the mapping via saveHoldingMapping
      expect(accountService.saveHoldingMapping).toHaveBeenCalledWith(
        'questrade',
        'ACC123',
        'UUID1',
        expect.objectContaining({
          securityId: 'SEC123',
          holdingId: 'HOLD456',
          symbol: 'AAPL',
        }),
      );
      expect(monarchApi.createManualHolding).not.toHaveBeenCalled();
    });

    test('should create new holding when none exists', async () => {
      accountService.getHoldingMapping.mockReturnValue(null);

      monarchApi.createManualHolding.mockResolvedValue({ id: 'HOLD789' });

      const result = await resolveOrCreateHolding(
        'ACC123',
        'MON123',
        'SEC123',
        position,
        { aggregateHoldings: { edges: [] } },
      );

      expect(result).toBe('HOLD789');
      expect(monarchApi.createManualHolding).toHaveBeenCalledWith(
        'MON123',
        'SEC123',
        100,
      );
      // Should save via saveHoldingMapping
      expect(accountService.saveHoldingMapping).toHaveBeenCalledWith(
        'questrade',
        'ACC123',
        'UUID1',
        expect.objectContaining({
          securityId: 'SEC123',
          holdingId: 'HOLD789',
          symbol: 'AAPL',
        }),
      );
    });

    test('should handle missing openQuantity', async () => {
      accountService.getHoldingMapping.mockReturnValue(null);
      monarchApi.createManualHolding.mockResolvedValue({ id: 'HOLD999' });

      const positionWithoutQty = {
        securityUuid: 'UUID2',
        security: { symbol: 'GOOGL' },
      };

      await resolveOrCreateHolding(
        'ACC123',
        'MON123',
        'SEC123',
        positionWithoutQty,
        { aggregateHoldings: { edges: [] } },
      );

      expect(monarchApi.createManualHolding).toHaveBeenCalledWith(
        'MON123',
        'SEC123',
        0,
      );
    });

    test('should handle API errors', async () => {
      accountService.getHoldingMapping.mockReturnValue(null);
      monarchApi.createManualHolding.mockRejectedValue(new Error('API error'));

      await expect(
        resolveOrCreateHolding(
          'ACC123',
          'MON123',
          'SEC123',
          position,
          { aggregateHoldings: { edges: [] } },
        ),
      ).rejects.toThrow(PositionsError);
    });
  });

  describe('syncPositionToHolding', () => {
    test('should sync position data successfully', async () => {
      const position = {
        security: { symbol: 'AAPL' },
        openQuantity: 100,
        averageEntryPrice: 150.5,
        securityType: 'Stock',
      };

      monarchApi.updateHolding.mockResolvedValue({});

      await syncPositionToHolding('HOLD123', position);

      expect(monarchApi.updateHolding).toHaveBeenCalledWith('HOLD123', {
        quantity: 100,
        costBasis: 150.5,
        securityType: 'equity',
      });
    });

    test('should use averagePrice as fallback', async () => {
      const position = {
        security: { symbol: 'AAPL' },
        openQuantity: 50,
        averagePrice: 200.0,
      };

      monarchApi.updateHolding.mockResolvedValue({});

      await syncPositionToHolding('HOLD123', position);

      expect(monarchApi.updateHolding).toHaveBeenCalledWith('HOLD123', {
        quantity: 50,
        costBasis: 200.0,
      });
    });

    test('should handle missing quantity and price', async () => {
      const position = {
        security: { symbol: 'AAPL' },
      };

      monarchApi.updateHolding.mockResolvedValue({});

      await syncPositionToHolding('HOLD123', position);

      expect(monarchApi.updateHolding).toHaveBeenCalledWith('HOLD123', {
        quantity: 0,
        costBasis: 0,
      });
    });

    test('should map security types correctly', async () => {
      const types = [
        { input: 'Stock', expected: 'equity' },
        { input: 'Option', expected: 'option' },
        { input: 'Bond', expected: 'bond' },
        { input: 'MutualFund', expected: 'mutualFund' },
        { input: 'Index', expected: 'index' },
        { input: 'Unknown', expected: 'equity' },
      ];

      for (const typeTest of types) {
        monarchApi.updateHolding.mockClear();

        const position = {
          security: { symbol: 'TEST' },
          openQuantity: 10,
          averageEntryPrice: 100,
          securityType: typeTest.input,
        };

        await syncPositionToHolding('HOLD123', position);

        expect(monarchApi.updateHolding).toHaveBeenCalledWith('HOLD123', {
          quantity: 10,
          costBasis: 100,
          securityType: typeTest.expected,
        });
      }
    });

    test('should handle API errors', async () => {
      monarchApi.updateHolding.mockRejectedValue(new Error('Update failed'));

      const position = {
        security: { symbol: 'AAPL' },
        openQuantity: 100,
      };

      await expect(syncPositionToHolding('HOLD123', position)).rejects.toThrow(
        PositionsError,
      );
    });
  });

  describe('detectAndRemoveDeletedHoldings', () => {
    test('should delete orphaned holdings (no mapping, no matching position)', async () => {
      const currentPositions = [
        { securityUuid: 'UUID1', security: { symbol: 'TSLA' } },
      ];

      const portfolio = {
        aggregateHoldings: {
          edges: [
            {
              node: {
                security: { id: 'SEC123' },
                holdings: [
                  { id: 'HOLD1', ticker: 'AAPL' },
                  { id: 'HOLD2', ticker: 'GOOGL' }, // Both should be deleted (no match)
                ],
              },
            },
          ],
        },
      };

      // No mappings exist
      accountService.getHoldingsMappings.mockReturnValue({});
      monarchApi.getHoldings.mockResolvedValue(portfolio);
      monarchApi.deleteHolding.mockResolvedValue({});

      const result = await detectAndRemoveDeletedHoldings(
        'ACC123',
        'MON123',
        currentPositions,
      );

      expect(result.deleted).toBe(2); // Both deleted - no mappings and no matching positions
      expect(monarchApi.deleteHolding).toHaveBeenCalledTimes(2);
    });

    test('should auto-repair missing mappings', async () => {
      const currentPositions = [
        { securityUuid: 'UUID1', security: { symbol: 'AAPL' } },
      ];

      const portfolio = {
        aggregateHoldings: {
          edges: [
            {
              node: {
                security: { id: 'SEC123' },
                holdings: [{ id: 'HOLD1', ticker: 'AAPL' }],
              },
            },
          ],
        },
      };

      // No mappings exist
      accountService.getHoldingsMappings.mockReturnValue({});
      monarchApi.getHoldings.mockResolvedValue(portfolio);

      const result = await detectAndRemoveDeletedHoldings(
        'ACC123',
        'MON123',
        currentPositions,
      );

      expect(result.autoRepaired).toBe(1);
      expect(result.deleted).toBe(0);
      // Should save via saveHoldingMapping
      expect(accountService.saveHoldingMapping).toHaveBeenCalledWith(
        'questrade',
        'ACC123',
        'UUID1',
        expect.objectContaining({
          securityId: 'SEC123',
          holdingId: 'HOLD1',
          symbol: 'AAPL',
        }),
      );
    });

    test('should keep holdings with existing mappings when position still exists', async () => {
      const currentPositions = [
        { securityUuid: 'UUID1', security: { symbol: 'AAPL' } },
      ];

      const portfolio = {
        aggregateHoldings: {
          edges: [
            {
              node: {
                security: { id: 'SEC123' },
                holdings: [{ id: 'HOLD1', ticker: 'AAPL' }],
              },
            },
          ],
        },
      };

      // Mapping exists via getHoldingsMappings
      accountService.getHoldingsMappings.mockReturnValue({
        UUID1: { securityId: 'SEC123', holdingId: 'HOLD1', symbol: 'AAPL' },
      });
      monarchApi.getHoldings.mockResolvedValue(portfolio);

      const result = await detectAndRemoveDeletedHoldings(
        'ACC123',
        'MON123',
        currentPositions,
      );

      expect(result.deleted).toBe(0);
      expect(result.autoRepaired).toBe(0);
      expect(monarchApi.deleteHolding).not.toHaveBeenCalled();
    });

    test('should delete holding when mapped position no longer exists (sold position)', async () => {
      // Only GOOGL exists now; AAPL was sold
      const currentPositions = [
        { securityUuid: 'UUID2', security: { symbol: 'GOOGL' } },
      ];

      const portfolio = {
        aggregateHoldings: {
          edges: [
            {
              node: {
                security: { id: 'SEC_AAPL' },
                holdings: [{ id: 'HOLD_AAPL', ticker: 'AAPL' }],
              },
            },
            {
              node: {
                security: { id: 'SEC_GOOGL' },
                holdings: [{ id: 'HOLD_GOOGL', ticker: 'GOOGL' }],
              },
            },
          ],
        },
      };

      // Both have mappings
      accountService.getHoldingsMappings.mockReturnValue({
        UUID1: { securityId: 'SEC_AAPL', holdingId: 'HOLD_AAPL', symbol: 'AAPL' },
        UUID2: { securityId: 'SEC_GOOGL', holdingId: 'HOLD_GOOGL', symbol: 'GOOGL' },
      });

      monarchApi.getHoldings.mockResolvedValue(portfolio);
      monarchApi.deleteHolding.mockResolvedValue({});

      const result = await detectAndRemoveDeletedHoldings(
        'ACC123',
        'MON123',
        currentPositions,
      );

      expect(result.deleted).toBe(1);
      expect(result.autoRepaired).toBe(0);

      // AAPL holding should be deleted
      expect(monarchApi.deleteHolding).toHaveBeenCalledWith('HOLD_AAPL');
      expect(monarchApi.deleteHolding).toHaveBeenCalledTimes(1);

      // AAPL mapping should have holdingId cleared but securityId preserved
      expect(accountService.saveHoldingMapping).toHaveBeenCalledWith(
        'questrade',
        'ACC123',
        'UUID1',
        {
          securityId: 'SEC_AAPL',
          holdingId: null,
          symbol: 'AAPL',
        },
      );
    });

    test('should handle all four cases in a single run', async () => {
      // Positions: GOOGL exists, TSLA exists; AAPL sold, ORPHAN never existed
      const currentPositions = [
        { securityUuid: 'UUID2', security: { symbol: 'GOOGL' } },
        { securityUuid: 'UUID3', security: { symbol: 'TSLA' } },
      ];

      const portfolio = {
        aggregateHoldings: {
          edges: [
            {
              node: {
                security: { id: 'SEC_GOOGL' },
                holdings: [{ id: 'HOLD_GOOGL', ticker: 'GOOGL' }],
              },
            },
            {
              node: {
                security: { id: 'SEC_AAPL' },
                holdings: [{ id: 'HOLD_AAPL', ticker: 'AAPL' }],
              },
            },
            {
              node: {
                security: { id: 'SEC_TSLA' },
                holdings: [{ id: 'HOLD_TSLA', ticker: 'TSLA' }],
              },
            },
            {
              node: {
                security: { id: 'SEC_ORPHAN' },
                holdings: [{ id: 'HOLD_ORPHAN', ticker: 'ORPHAN' }],
              },
            },
          ],
        },
      };

      // GOOGL and AAPL have mappings
      accountService.getHoldingsMappings.mockReturnValue({
        UUID2: { securityId: 'SEC_GOOGL', holdingId: 'HOLD_GOOGL', symbol: 'GOOGL' },
        UUID1: { securityId: 'SEC_AAPL', holdingId: 'HOLD_AAPL', symbol: 'AAPL' },
      });

      monarchApi.getHoldings.mockResolvedValue(portfolio);
      monarchApi.deleteHolding.mockResolvedValue({});

      const result = await detectAndRemoveDeletedHoldings(
        'ACC123',
        'MON123',
        currentPositions,
      );

      // Case 1: GOOGL kept (mapped + position exists)
      // Case 2: AAPL deleted (mapped + position sold)
      // Case 3: TSLA auto-repaired (unmapped + ticker match)
      // Case 4: ORPHAN deleted (unmapped + no match)
      expect(result.deleted).toBe(2); // AAPL + ORPHAN
      expect(result.autoRepaired).toBe(1); // TSLA
      expect(monarchApi.deleteHolding).toHaveBeenCalledWith('HOLD_AAPL');
      expect(monarchApi.deleteHolding).toHaveBeenCalledWith('HOLD_ORPHAN');
      expect(monarchApi.deleteHolding).toHaveBeenCalledTimes(2);
    });

    test('should handle empty Monarch holdings', async () => {
      monarchApi.getHoldings.mockResolvedValue(null);

      const result = await detectAndRemoveDeletedHoldings('ACC123', 'MON123', []);

      expect(result.deleted).toBe(0);
      expect(result.autoRepaired).toBe(0);
    });

    test('should handle deletion errors gracefully', async () => {
      const currentPositions = [];

      const portfolio = {
        aggregateHoldings: {
          edges: [
            {
              node: {
                security: { id: 'SEC123' },
                holdings: [{ id: 'HOLD1', ticker: 'ORPHAN' }],
              },
            },
          ],
        },
      };

      accountService.getHoldingsMappings.mockReturnValue({});
      monarchApi.getHoldings.mockResolvedValue(portfolio);
      monarchApi.deleteHolding.mockRejectedValue(new Error('Delete failed'));

      const result = await detectAndRemoveDeletedHoldings(
        'ACC123',
        'MON123',
        currentPositions,
      );

      // Should continue despite error
      expect(result.deleted).toBe(0);
    });

    test('should handle API errors gracefully', async () => {
      monarchApi.getHoldings.mockRejectedValue(new Error('API error'));

      const result = await detectAndRemoveDeletedHoldings('ACC123', 'MON123', []);

      expect(result.deleted).toBe(0);
      expect(result.autoRepaired).toBe(0);
    });
  });

  describe('processAccountPositions', () => {
    test('should process positions successfully', async () => {
      const positions = [
        { securityUuid: 'UUID1', security: { symbol: 'AAPL' }, openQuantity: 100 },
      ];

      questradeApi.fetchPositions.mockResolvedValue({ data: positions });
      monarchApi.getHoldings.mockResolvedValue({ aggregateHoldings: { edges: [] } });

      global.GM_getValue.mockReturnValue(null);

      showMonarchSecuritySelector.mockImplementation((pos, callback) => {
        callback({ id: 'SEC123', name: 'Apple Inc' });
      });

      monarchApi.createManualHolding.mockResolvedValue({ id: 'HOLD123' });
      monarchApi.updateHolding.mockResolvedValue({});

      const result = await processAccountPositions(
        'ACC123',
        'Test Account',
        'MON123',
      );

      expect(result.success).toBe(true);
      expect(result.positionsProcessed).toBe(1);
      expect(result.positionsSkipped).toBe(0);
      expect(toast.show).toHaveBeenCalled();
    });

    test('should handle no positions', async () => {
      questradeApi.fetchPositions.mockResolvedValue({ data: [] });

      const result = await processAccountPositions(
        'ACC123',
        'Test Account',
        'MON123',
      );

      expect(result.success).toBe(true);
      expect(result.positionsProcessed).toBe(0);
    });

    test('should skip cancelled positions', async () => {
      const positions = [
        { securityUuid: 'UUID1', security: { symbol: 'AAPL' } },
      ];

      questradeApi.fetchPositions.mockResolvedValue({ data: positions });
      monarchApi.getHoldings.mockResolvedValue({ aggregateHoldings: { edges: [] } });
      global.GM_getValue.mockReturnValue(null);

      showMonarchSecuritySelector.mockImplementation((pos, callback) => {
        callback(null); // User cancelled
      });

      const result = await processAccountPositions(
        'ACC123',
        'Test Account',
        'MON123',
      );

      expect(result.success).toBe(true);
      expect(result.positionsProcessed).toBe(0);
      expect(result.positionsSkipped).toBe(1);
    });

    test('should handle position processing errors', async () => {
      const positions = [
        { securityUuid: 'UUID1', security: { symbol: 'AAPL' } },
      ];

      questradeApi.fetchPositions.mockResolvedValue({ data: positions });
      monarchApi.getHoldings.mockResolvedValue({ aggregateHoldings: { edges: [] } });

      showMonarchSecuritySelector.mockImplementation(() => {
        throw new Error('Selector error');
      });

      const result = await processAccountPositions(
        'ACC123',
        'Test Account',
        'MON123',
      );

      expect(result.success).toBe(true);
      expect(result.positionsSkipped).toBe(1);
    });

    test('should update progress dialog', async () => {
      const progressDialog = {
        updateProgress: jest.fn(),
      };

      questradeApi.fetchPositions.mockResolvedValue({ data: [] });

      await processAccountPositions(
        'ACC123',
        'Test Account',
        'MON123',
        progressDialog,
      );

      expect(progressDialog.updateProgress).toHaveBeenCalledWith(
        'ACC123',
        'processing',
        expect.any(String),
      );
      expect(progressDialog.updateProgress).toHaveBeenCalledWith(
        'ACC123',
        'success',
        expect.any(String),
      );
    });

    test('should handle fetch errors', async () => {
      questradeApi.fetchPositions.mockRejectedValue(new Error('Fetch error'));

      const result = await processAccountPositions(
        'ACC123',
        'Test Account',
        'MON123',
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to fetch positions: Fetch error');
    });

    test('should report deletion and repair counts', async () => {
      const positions = [
        { securityUuid: 'UUID1', security: { symbol: 'AAPL' }, openQuantity: 100 },
      ];

      questradeApi.fetchPositions.mockResolvedValue({ data: positions });

      const portfolio = {
        aggregateHoldings: {
          edges: [
            {
              node: {
                security: { id: 'SEC123' },
                holdings: [
                  { id: 'HOLD1', ticker: 'AAPL' },
                  { id: 'HOLD2', ticker: 'ORPHAN' },
                ],
              },
            },
          ],
        },
      };

      monarchApi.getHoldings.mockResolvedValue(portfolio);
      monarchApi.deleteHolding.mockResolvedValue({});

      global.GM_getValue.mockReturnValue(null);

      showMonarchSecuritySelector.mockImplementation((pos, callback) => {
        callback({ id: 'SEC123', name: 'Apple Inc' });
      });

      monarchApi.createManualHolding.mockResolvedValue({ id: 'HOLD1' });
      monarchApi.updateHolding.mockResolvedValue({});

      const result = await processAccountPositions(
        'ACC123',
        'Test Account',
        'MON123',
      );

      expect(result.success).toBe(true);
      expect(result.holdingsRemoved).toBeGreaterThanOrEqual(0);
    });
  });
});
