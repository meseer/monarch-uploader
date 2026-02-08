/**
 * Tests for Questrade Transactions Service
 */

import transactionsService from '../../../src/services/questrade/transactions';
import questradeApi from '../../../src/api/questrade';
import monarchApi from '../../../src/api/monarch';
import { convertQuestradeOrdersToMonarchCSV } from '../../../src/utils/csv';
import accountService from '../../../src/services/common/accountService';

// Mock dependencies
jest.mock('../../../src/api/questrade');
jest.mock('../../../src/api/monarch');
jest.mock('../../../src/utils/csv');
jest.mock('../../../src/ui/toast');
jest.mock('../../../src/mappers/category');
jest.mock('../../../src/ui/components/categorySelector');
// Questrade now uses consolidated storage via accountService, not transactionStorage
jest.mock('../../../src/utils/transactionStorage', () => ({
  getTransactionIdsFromArray: jest.fn((transactions) => {
    if (!transactions || !Array.isArray(transactions)) return new Set();
    return new Set(transactions.map((t) => (typeof t === 'string' ? t : t.id)));
  }),
  getRetentionSettingsFromAccount: jest.fn(() => ({ days: 91, count: 1000 })),
  mergeAndRetainTransactions: jest.fn((existing, newTx, _settings) => {
    const existingIds = new Set((existing || []).map((t) => t.id));
    const result = [...(existing || [])];
    for (const tx of newTx) {
      const id = typeof tx === 'string' ? tx : tx.id;
      if (!existingIds.has(id)) {
        result.push({ id, date: tx.date || '2025-01-01' });
      }
    }
    return result;
  }),
}));
jest.mock('../../../src/services/common/accountService', () => ({
  __esModule: true,
  default: {
    getMonarchAccountMapping: jest.fn(),
    getAccountData: jest.fn(),
    upsertAccount: jest.fn(),
    updateAccountInList: jest.fn(),
  },
}));

describe('Questrade Transactions Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Clear GM storage
    global.GM_getValue = jest.fn(() => []);
    global.GM_setValue = jest.fn();

    // Reset accountService mocks to default state
    accountService.getAccountData.mockReturnValue(null);
    accountService.updateAccountInList.mockImplementation(() => {});
  });

  describe('filterExecutedOrders', () => {
    it('should filter orders with status="Executed"', () => {
      const orders = [
        { orderUuid: '1', status: 'Executed', action: 'Buy' },
        { orderUuid: '2', status: 'Pending', action: 'Sell' },
        { orderUuid: '3', status: 'Executed', action: 'Buy' },
        { orderUuid: '4', status: 'Cancelled', action: 'Buy' },
      ];

      const result = transactionsService.filterExecutedOrders(orders);

      expect(result).toHaveLength(2);
      expect(result[0].orderUuid).toBe('1');
      expect(result[1].orderUuid).toBe('3');
    });

    it('should return empty array for null input', () => {
      const result = transactionsService.filterExecutedOrders(null);
      expect(result).toEqual([]);
    });

    it('should return empty array for undefined input', () => {
      const result = transactionsService.filterExecutedOrders(undefined);
      expect(result).toEqual([]);
    });

    it('should return empty array for non-array input', () => {
      const result = transactionsService.filterExecutedOrders('not an array');
      expect(result).toEqual([]);
    });
  });

  describe('filterDuplicateOrders', () => {
    it('should filter out orders that have already been uploaded', () => {
      const orders = [
        { orderUuid: 'uuid1', action: 'Buy' },
        { orderUuid: 'uuid2', action: 'Sell' },
        { orderUuid: 'uuid3', action: 'Buy' },
      ];

      // Mock consolidated storage with uuid1 already uploaded
      accountService.getAccountData.mockReturnValue({
        uploadedTransactions: [{ id: 'uuid1', date: '2025-01-01' }],
      });

      const result = transactionsService.filterDuplicateOrders(orders, 'account123');

      expect(result.orders).toHaveLength(2);
      expect(result.orders[0].orderUuid).toBe('uuid2');
      expect(result.orders[1].orderUuid).toBe('uuid3');
      expect(result.duplicateCount).toBe(1);
      expect(result.originalCount).toBe(3);
    });

    it('should return all orders when none have been uploaded', () => {
      const orders = [
        { orderUuid: 'uuid1', action: 'Buy' },
        { orderUuid: 'uuid2', action: 'Sell' },
      ];

      // Mock consolidated storage with no uploaded transactions
      accountService.getAccountData.mockReturnValue({
        uploadedTransactions: [],
      });

      const result = transactionsService.filterDuplicateOrders(orders, 'account123');

      expect(result.orders).toHaveLength(2);
      expect(result.duplicateCount).toBe(0);
      expect(result.originalCount).toBe(2);
    });
  });

  describe('fetchQuestradeOrders', () => {
    it('should fetch orders and convert date to ISO format', async () => {
      const mockResponse = {
        data: [
          { orderUuid: '1', status: 'Executed', action: 'Buy' },
          { orderUuid: '2', status: 'Executed', action: 'Sell' },
        ],
      };

      questradeApi.fetchOrders = jest.fn().mockResolvedValue(mockResponse);

      const result = await transactionsService.fetchQuestradeOrders('account-uuid', '2025-01-01');

      expect(result).toHaveLength(2);
      expect(questradeApi.fetchOrders).toHaveBeenCalledWith(
        'account-uuid',
        '2025-01-01T00:00:00.000Z',
      );
    });

    it('should handle ISO format date input', async () => {
      const mockResponse = {
        data: [{ orderUuid: '1', status: 'Executed' }],
      };

      questradeApi.fetchOrders = jest.fn().mockResolvedValue(mockResponse);

      await transactionsService.fetchQuestradeOrders('account-uuid', '2025-01-01T10:00:00.000Z');

      expect(questradeApi.fetchOrders).toHaveBeenCalledWith(
        'account-uuid',
        '2025-01-01T10:00:00.000Z',
      );
    });

    it('should throw error when API returns no data', async () => {
      questradeApi.fetchOrders = jest.fn().mockResolvedValue({});

      await expect(
        transactionsService.fetchQuestradeOrders('account-uuid', '2025-01-01'),
      ).rejects.toThrow('Invalid API response: missing data');
    });
  });

  describe('processAndUploadTransactions', () => {
    const mockAccount = {
      key: 'account123',
      uuid: 'account-uuid-123',
      nickname: 'Test Account',
    };

    beforeEach(() => {
      questradeApi.getAccount = jest.fn().mockReturnValue(mockAccount);
      global.GM_getValue = jest.fn(() => []); // No duplicates by default
      convertQuestradeOrdersToMonarchCSV.mockReturnValue('mock,csv,data');
      // Mock accountService.getMonarchAccountMapping
      accountService.getMonarchAccountMapping.mockReturnValue({ id: 'monarch-account-id' });
      monarchApi.uploadTransactions = jest.fn().mockResolvedValue(true);
    });

    it('should process and upload orders successfully', async () => {
      const mockOrders = [
        {
          orderUuid: 'uuid1',
          status: 'Executed',
          action: 'Buy',
          security: { displayName: 'AAPL' },
          dollarValue: 1000,
        },
      ];

      questradeApi.fetchOrders = jest.fn().mockResolvedValue({ data: mockOrders });

      // Mock category mapping to return a simple string category
      const { applyCategoryMapping } = require('../../../src/mappers/category');
      applyCategoryMapping.mockReturnValue('Investment');

      const result = await transactionsService.processAndUploadTransactions(
        'account123',
        'Test Account',
        '2025-01-01',
      );

      expect(result.success).toBe(true);
      expect(result.ordersProcessed).toBe(1);
      expect(monarchApi.uploadTransactions).toHaveBeenCalled();
    });

    it('should return success with message when no orders found', async () => {
      questradeApi.fetchOrders = jest.fn().mockResolvedValue({ data: [] });
      // Mock activity API to also return empty (no transactions from either source)
      questradeApi.fetchAccountTransactionsSinceDate = jest.fn().mockResolvedValue([]);

      const result = await transactionsService.processAndUploadTransactions(
        'account123',
        'Test Account',
        '2025-01-01',
      );

      expect(result.success).toBe(true);
      expect(result.message).toBe('No transactions found to upload');
      expect(result.ordersProcessed).toBe(0);
    });

    it('should return success when no executed orders found', async () => {
      const mockOrders = [
        { orderUuid: 'uuid1', status: 'Pending', action: 'Buy' },
        { orderUuid: 'uuid2', status: 'Cancelled', action: 'Sell' },
      ];

      questradeApi.fetchOrders = jest.fn().mockResolvedValue({ data: mockOrders });
      // Mock activity API to also return empty (no transactions from either source)
      questradeApi.fetchAccountTransactionsSinceDate = jest.fn().mockResolvedValue([]);

      const result = await transactionsService.processAndUploadTransactions(
        'account123',
        'Test Account',
        '2025-01-01',
      );

      expect(result.success).toBe(true);
      expect(result.message).toBe('No transactions found to upload');
      expect(result.ordersProcessed).toBe(0);
    });

    it('should skip duplicate orders', async () => {
      const mockOrders = [
        { orderUuid: 'uuid1', status: 'Executed', action: 'Buy' },
        { orderUuid: 'uuid2', status: 'Executed', action: 'Sell' },
      ];

      questradeApi.fetchOrders = jest.fn().mockResolvedValue({ data: mockOrders });
      // Mock consolidated storage with uuid1 already uploaded
      accountService.getAccountData.mockReturnValue({
        uploadedTransactions: [{ id: 'uuid1', date: '2025-01-01' }],
      });

      const result = await transactionsService.processAndUploadTransactions(
        'account123',
        'Test Account',
        '2025-01-01',
      );

      expect(result.success).toBe(true);
      expect(result.skippedDuplicates).toBe(1);
    });

    it('should throw error when account not found', async () => {
      questradeApi.getAccount = jest.fn().mockReturnValue(null);

      await expect(
        transactionsService.processAndUploadTransactions('account123', 'Test Account', '2025-01-01'),
      ).rejects.toThrow('Account not found: account123');
    });

    it('should save order UUIDs to consolidated storage after successful upload', async () => {
      const mockOrders = [
        {
          orderUuid: 'uuid1',
          status: 'Executed',
          action: 'Buy',
          resolvedMonarchCategory: 'Investment',
          updatedDateTime: '2025-01-01T10:00:00Z',
        },
      ];

      questradeApi.fetchOrders = jest.fn().mockResolvedValue({ data: mockOrders });
      // Mock empty consolidated storage
      accountService.getAccountData.mockReturnValue({
        uploadedTransactions: [],
      });

      await transactionsService.processAndUploadTransactions(
        'account123',
        'Test Account',
        '2025-01-01',
      );

      // Verify accountService.updateAccountInList was called to save transactions
      expect(accountService.updateAccountInList).toHaveBeenCalledWith(
        'questrade',
        'account123',
        expect.objectContaining({
          uploadedTransactions: expect.any(Array),
        }),
      );
    });
  });
});
