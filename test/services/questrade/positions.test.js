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
  syncPositionToHolding,
  detectAndRemoveDeletedHoldings,
  processAccountPositions,
} from '../../../src/services/questrade/positions';
import questradeApi from '../../../src/api/questrade';
import monarchApi from '../../../src/api/monarch';
import { showMonarchSecuritySelector } from '../../../src/ui/components/securitySelector';
import toast from '../../../src/ui/toast';

// Mock all dependencies first
jest.mock('../../../src/core/utils', () => ({
  debugLog: jest.fn(),
}));

jest.mock('../../../src/core/config', () => ({
  STORAGE: {
    QUESTRADE_HOLDINGS_FOR_PREFIX: 'questrade_holdings_',
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
    test('should return existing mapping from storage', async () => {
      const position = {
        securityUuid: 'UUID1',
        security: { symbol: 'AAPL' },
      };

      const mappings = {
        UUID1: { securityId: 'SEC123', holdingId: 'HOLD123', symbol: 'AAPL' },
      };

      global.GM_getValue.mockReturnValue(JSON.stringify(mappings));

      const result = await resolveSecurityMapping('ACC123', position);

      expect(result).toBe('SEC123');
      expect(showMonarchSecuritySelector).not.toHaveBeenCalled();
    });

    test('should show selector when no mapping exists', async () => {
      const position = {
        securityUuid: 'UUID1',
        security: { symbol: 'AAPL' },
      };

      global.GM_getValue.mockReturnValue(null);

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

      global.GM_getValue.mockReturnValue(null);

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

      const mappings = {
        SYM123: { securityId: 'SEC789', holdingId: 'HOLD789', symbol: 'AAPL' },
      };

      global.GM_getValue.mockReturnValue(JSON.stringify(mappings));

      const result = await resolveSecurityMapping('ACC123', position);

      expect(result).toBe('SEC789');
    });
  });

  describe('resolveOrCreateHolding', () => {
    const position = {
      securityUuid: 'UUID1',
      security: { symbol: 'AAPL' },
      openQuantity: 100,
    };

    test('should return existing holding ID from storage', async () => {
      const mappings = {
        UUID1: { securityId: 'SEC123', holdingId: 'HOLD123', symbol: 'AAPL' },
      };

      global.GM_getValue.mockReturnValue(JSON.stringify(mappings));

      const result = await resolveOrCreateHolding(
        'ACC123',
        'MON123',
        'SEC123',
        position,
        {},
      );

      expect(result).toBe('HOLD123');
      expect(monarchApi.createManualHolding).not.toHaveBeenCalled();
    });

    test('should find existing holding in Monarch data', async () => {
      global.GM_getValue.mockReturnValue(null);

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
      expect(global.GM_setValue).toHaveBeenCalled();
      expect(monarchApi.createManualHolding).not.toHaveBeenCalled();
    });

    test('should create new holding when none exists', async () => {
      global.GM_getValue.mockReturnValue(null);

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
      expect(global.GM_setValue).toHaveBeenCalled();
    });

    test('should handle missing openQuantity', async () => {
      global.GM_getValue.mockReturnValue(null);
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
      global.GM_getValue.mockReturnValue(null);
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
    test('should delete orphaned holdings', async () => {
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

      global.GM_getValue.mockReturnValue(null);
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

      global.GM_getValue.mockReturnValue(null);
      monarchApi.getHoldings.mockResolvedValue(portfolio);

      const result = await detectAndRemoveDeletedHoldings(
        'ACC123',
        'MON123',
        currentPositions,
      );

      expect(result.autoRepaired).toBe(1);
      expect(result.deleted).toBe(0);
      expect(global.GM_setValue).toHaveBeenCalled();
    });

    test('should keep holdings with existing mappings', async () => {
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

      const mappings = {
        UUID1: { securityId: 'SEC123', holdingId: 'HOLD1', symbol: 'AAPL' },
      };

      global.GM_getValue.mockReturnValue(JSON.stringify(mappings));
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

      global.GM_getValue.mockReturnValue(null);
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
