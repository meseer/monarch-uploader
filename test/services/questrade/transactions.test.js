/**
 * Tests for Questrade Transactions Service
 */

import transactionsService from '../../../src/services/questrade/transactions';
import questradeApi from '../../../src/api/questrade';
import monarchApi from '../../../src/api/monarch';
import { convertQuestradeOrdersToMonarchCSV } from '../../../src/utils/csv';

// Mock dependencies
jest.mock('../../../src/api/questrade');
jest.mock('../../../src/api/monarch');
jest.mock('../../../src/utils/csv');
jest.mock('../../../src/ui/toast');
jest.mock('../../../src/mappers/category');
jest.mock('../../../src/ui/components/categorySelector');

describe('Questrade Transactions Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Clear GM storage
    global.GM_getValue = jest.fn(() => []);
    global.GM_setValue = jest.fn();
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

      // Mock that uuid1 has already been uploaded
      global.GM_getValue = jest.fn(() => ['uuid1']);

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

      global.GM_getValue = jest.fn(() => []);

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
      monarchApi.resolveAccountMapping = jest.fn().mockResolvedValue({ id: 'monarch-account-id' });
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

      const result = await transactionsService.processAndUploadTransactions(
        'account123',
        'Test Account',
        '2025-01-01',
      );

      expect(result.success).toBe(true);
      expect(result.message).toBe('No orders found');
      expect(result.ordersProcessed).toBe(0);
    });

    it('should return success when no executed orders found', async () => {
      const mockOrders = [
        { orderUuid: 'uuid1', status: 'Pending', action: 'Buy' },
        { orderUuid: 'uuid2', status: 'Cancelled', action: 'Sell' },
      ];

      questradeApi.fetchOrders = jest.fn().mockResolvedValue({ data: mockOrders });

      const result = await transactionsService.processAndUploadTransactions(
        'account123',
        'Test Account',
        '2025-01-01',
      );

      expect(result.success).toBe(true);
      expect(result.message).toBe('No executed orders found');
      expect(result.ordersProcessed).toBe(0);
    });

    it('should skip duplicate orders', async () => {
      const mockOrders = [
        { orderUuid: 'uuid1', status: 'Executed', action: 'Buy' },
        { orderUuid: 'uuid2', status: 'Executed', action: 'Sell' },
      ];

      questradeApi.fetchOrders = jest.fn().mockResolvedValue({ data: mockOrders });
      global.GM_getValue = jest.fn(() => ['uuid1']); // uuid1 already uploaded

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

    it('should save order UUIDs after successful upload', async () => {
      const mockOrders = [
        {
          orderUuid: 'uuid1',
          status: 'Executed',
          action: 'Buy',
          resolvedMonarchCategory: 'Investment',
        },
      ];

      questradeApi.fetchOrders = jest.fn().mockResolvedValue({ data: mockOrders });

      await transactionsService.processAndUploadTransactions(
        'account123',
        'Test Account',
        '2025-01-01',
      );

      expect(global.GM_setValue).toHaveBeenCalledWith(
        expect.stringContaining('questrade_uploaded_orders_'),
        expect.arrayContaining(['uuid1']),
      );
    });
  });
});
