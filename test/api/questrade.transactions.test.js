/**
 * Comprehensive Tests for Questrade API
 */

import {
  makeQuestradeApiCall,
  fetchAndCacheQuestradeAccounts,
  getQuestradeAccount,
  fetchAccountPositions,
  fetchAccountOrders,
  fetchAccountTransactionsPage,
  fetchTransactionDetails,
  fetchAccountTransactionsSinceDate,
  fetchAllAccountTransactions,
  checkTokenStatus,
  getToken,
} from '../../src/api/questrade';

// Mock dependencies
jest.mock('../../src/core/utils', () => ({
  debugLog: jest.fn(),
}));

jest.mock('../../src/core/state', () => ({
  __esModule: true,
  default: {
    setQuestradeAuth: jest.fn(),
  },
}));

jest.mock('../../src/services/questrade/auth', () => ({
  __esModule: true,
  default: {
    checkQuestradeAuth: jest.fn(),
    getQuestradeToken: jest.fn(),
    waitForQuestradeToken: jest.fn(),
    saveQuestradeToken: jest.fn(),
  },
}));

// Mock Greasemonkey functions
globalThis.GM_getValue = jest.fn();
globalThis.GM_setValue = jest.fn();
globalThis.GM_xmlhttpRequest = jest.fn();

describe('Questrade API', () => {
  let authService;
  let stateManager;

  beforeEach(() => {
    jest.clearAllMocks();
    authService = jest.requireMock('../../src/services/questrade/auth').default;
    stateManager = jest.requireMock('../../src/core/state').default;

    // Default mock values
    globalThis.GM_getValue.mockReturnValue('[]');
    authService.checkQuestradeAuth.mockReturnValue({
      authenticated: true,
      token: 'Bearer test-token',
    });
    // Default: waitForQuestradeToken returns null (token not found after retries)
    authService.waitForQuestradeToken.mockResolvedValue(null);
  });

  describe('Edge Cases', () => {
    test('should handle malformed JSON response', async () => {
      globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
        // Use immediate execution instead of setTimeout to avoid timeout issues
        options.onload({
          status: 200,
          responseText: 'invalid json{', // Malformed JSON
        });
      });

      await expect(makeQuestradeApiCall('/test')).rejects.toThrow();
    }, 15000); // Increase timeout

    test('should handle empty response', async () => {
      globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
        // Use immediate execution instead of setTimeout to avoid timeout issues
        options.onload({
          status: 200,
          responseText: '', // Empty response
        });
      });

      await expect(makeQuestradeApiCall('/test')).rejects.toThrow();
    }, 15000); // Increase timeout

    test('should handle various endpoint formats', async () => {
      const endpoints = [
        '/v1/accounts',
        'v1/accounts',
        '/v1/accounts/',
        '/v1/accounts/123/balances',
      ];

      for (const endpoint of endpoints) {
        globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
          expect(options.url).toContain('api.questrade.com');
          setTimeout(() => {
            options.onload({
              status: 200,
              responseText: '{"success": true}',
            });
          }, 0);
        });

        await makeQuestradeApiCall(endpoint);
      }

      expect(globalThis.GM_xmlhttpRequest).toHaveBeenCalledTimes(endpoints.length);
    });
  });

  describe('fetchAccountTransactionsPage', () => {
    test('should fetch transactions with default options', async () => {
      const mockResponse = {
        data: [
          {
            action: 'TFO',
            transactionUuid: '03b685db-9b8d-4551-801b-62f53fb9c409',
            transactionUrl: '/v3/brokerage-accounts-transactions/ac21720c/transactions/03b685db',
            transactionType: 'Transfers',
            description: 'CI INVESTMENT SERVICES INC. ACCOUNT TRANSFER',
            net: { currencyCode: 'USD', amount: 0.01 },
            transactionDate: '2026-01-15',
          },
        ],
        metadata: {
          totalCount: 197,
          totalPages: 66,
          count: 1,
          currentPage: 1,
          nextLink: '/v3/brokerage-accounts-transactions/ac21720c/transactions?page=2',
        },
      };

      globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
        expect(options.url).toContain('/v3/brokerage-accounts-transactions/test-account-id/transactions');
        expect(options.url).toContain('limit=100');
        expect(options.url).toContain('orderBy=%2BTradeDate');
        expect(options.url).toContain('fields=AccountDetailType');
        expect(options.url).toContain('fields=Action');
        setTimeout(() => {
          options.onload({
            status: 200,
            responseText: JSON.stringify(mockResponse),
          });
        }, 0);
      });

      const result = await fetchAccountTransactionsPage('test-account-id');
      expect(result).toEqual(mockResponse);
      expect(result.data).toHaveLength(1);
      expect(result.metadata.totalCount).toBe(197);
    });

    test('should fetch transactions with custom limit', async () => {
      const mockResponse = {
        data: [],
        metadata: { totalCount: 0, totalPages: 0, count: 0 },
      };

      globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
        expect(options.url).toContain('limit=500');
        setTimeout(() => {
          options.onload({
            status: 200,
            responseText: JSON.stringify(mockResponse),
          });
        }, 0);
      });

      await fetchAccountTransactionsPage('test-account-id', { limit: 500 });
    });

    test('should use nextLink for pagination', async () => {
      const mockResponse = {
        data: [],
        metadata: { totalCount: 0, totalPages: 0, count: 0 },
      };

      const nextLink = '/v3/brokerage-accounts-transactions/acc123/transactions?page=3&limit=100';

      globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
        expect(options.url).toBe(`https://api.questrade.com${nextLink}`);
        setTimeout(() => {
          options.onload({
            status: 200,
            responseText: JSON.stringify(mockResponse),
          });
        }, 0);
      });

      await fetchAccountTransactionsPage('test-account-id', { nextLink });
    });

    test('should throw error when accountId is missing', async () => {
      await expect(fetchAccountTransactionsPage('')).rejects.toThrow('Account ID is required');
      await expect(fetchAccountTransactionsPage(null)).rejects.toThrow('Account ID is required');
      await expect(fetchAccountTransactionsPage(undefined)).rejects.toThrow('Account ID is required');
    });

    test('should handle auth errors', async () => {
      authService.checkQuestradeAuth.mockReturnValue({
        authenticated: false,
        token: null,
      });

      await expect(fetchAccountTransactionsPage('test-account-id')).rejects.toThrow(
        'Questrade auth token not found',
      );
    });

    test('should handle HTTP errors', async () => {
      globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
        setTimeout(() => {
          options.onload({
            status: 500,
            responseText: 'Internal Server Error',
          });
        }, 0);
      });

      await expect(fetchAccountTransactionsPage('test-account-id')).rejects.toThrow(
        'Questrade API Error: Received status 500',
      );
    });
  });

  describe('fetchTransactionDetails', () => {
    test('should fetch transaction details', async () => {
      const mockDetails = {
        gross: { currencyCode: 'USD', amount: 0.00 },
        settlementDate: '2024-12-26',
        action: '   ',
        symbol: 'H019673',
        commission: 0.00,
        currency: 'USD',
        quantity: 0.00000,
        price: { currencyCode: 'USD', amount: 0.74000000 },
        transactionUuid: '44766188-fdc3-447c-97d9-b1cf44ce1baa',
        transactionUrl: '/v3/brokerage-accounts-transactions/823a5200/transactions/44766188',
        transactionType: 'Dividends',
        description: 'ISHARES CORE AGGRESSIVE ALLOCATION FUND ETF DIST',
        net: { currencyCode: 'USD', amount: 535.17 },
        transactionDate: '2024-12-26',
        account: {
          name: 'Individual RRSP',
          accountDetailType: 'RRSP',
          key: '823a5200-4b04-4032-054f-2b4fa3950459',
        },
      };

      const transactionUrl = '/v3/brokerage-accounts-transactions/823a5200/transactions/44766188';

      globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
        expect(options.url).toBe(`https://api.questrade.com${transactionUrl}`);
        setTimeout(() => {
          options.onload({
            status: 200,
            responseText: JSON.stringify(mockDetails),
          });
        }, 0);
      });

      const result = await fetchTransactionDetails(transactionUrl);
      expect(result).toEqual(mockDetails);
      expect(result.transactionType).toBe('Dividends');
      expect(result.net.amount).toBe(535.17);
    });

    test('should throw error when transactionUrl is missing', async () => {
      await expect(fetchTransactionDetails('')).rejects.toThrow('Transaction URL is required');
      await expect(fetchTransactionDetails(null)).rejects.toThrow('Transaction URL is required');
      await expect(fetchTransactionDetails(undefined)).rejects.toThrow('Transaction URL is required');
    });

    test('should handle auth errors', async () => {
      authService.checkQuestradeAuth.mockReturnValue({
        authenticated: false,
        token: null,
      });

      await expect(fetchTransactionDetails('/v3/some/url')).rejects.toThrow(
        'Questrade auth token not found',
      );
    });

    test('should handle HTTP errors', async () => {
      globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
        setTimeout(() => {
          options.onload({
            status: 404,
            responseText: 'Not Found',
          });
        }, 0);
      });

      await expect(fetchTransactionDetails('/v3/some/url')).rejects.toThrow(
        'Questrade API Error: Received status 404',
      );
    });
  });

  describe('fetchAccountTransactionsSinceDate', () => {
    test('should fetch transactions since a given date', async () => {
      const mockResponse = {
        data: [
          { transactionUuid: 'tx1', transactionDate: '2026-01-15', description: 'Transfer 1' },
          { transactionUuid: 'tx2', transactionDate: '2026-01-14', description: 'Transfer 2' },
          { transactionUuid: 'tx3', transactionDate: '2026-01-13', description: 'Transfer 3' },
        ],
        metadata: { totalCount: 3, totalPages: 1, count: 3, nextLink: null },
      };

      globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
        setTimeout(() => {
          options.onload({
            status: 200,
            responseText: JSON.stringify(mockResponse),
          });
        }, 0);
      });

      const result = await fetchAccountTransactionsSinceDate('test-account-id', '2026-01-13');
      expect(result).toHaveLength(3);
      expect(result[0].transactionUuid).toBe('tx1');
    });

    test('should stop when reaching transactions older than sinceDate', async () => {
      const mockResponse = {
        data: [
          { transactionUuid: 'tx1', transactionDate: '2026-01-15', description: 'Recent' },
          { transactionUuid: 'tx2', transactionDate: '2026-01-10', description: 'Old' },
          { transactionUuid: 'tx3', transactionDate: '2026-01-05', description: 'Older' },
        ],
        metadata: { totalCount: 100, totalPages: 10, count: 3, nextLink: '/next' },
      };

      globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
        setTimeout(() => {
          options.onload({
            status: 200,
            responseText: JSON.stringify(mockResponse),
          });
        }, 0);
      });

      const result = await fetchAccountTransactionsSinceDate('test-account-id', '2026-01-12');

      // Should only include tx1 (2026-01-15 >= 2026-01-12)
      expect(result).toHaveLength(1);
      expect(result[0].transactionUuid).toBe('tx1');

      // Should only make one API call because we hit an older transaction
      expect(globalThis.GM_xmlhttpRequest).toHaveBeenCalledTimes(1);
    });

    test('should paginate through multiple pages until reaching sinceDate', async () => {
      const page1Response = {
        data: [
          { transactionUuid: 'tx1', transactionDate: '2026-01-20' },
          { transactionUuid: 'tx2', transactionDate: '2026-01-19' },
        ],
        metadata: { totalCount: 6, totalPages: 3, count: 2, nextLink: '/page2' },
      };

      const page2Response = {
        data: [
          { transactionUuid: 'tx3', transactionDate: '2026-01-18' },
          { transactionUuid: 'tx4', transactionDate: '2026-01-15' },
        ],
        metadata: { totalCount: 6, totalPages: 3, count: 2, nextLink: '/page3' },
      };

      const page3Response = {
        data: [
          { transactionUuid: 'tx5', transactionDate: '2026-01-10' },
          { transactionUuid: 'tx6', transactionDate: '2026-01-05' },
        ],
        metadata: { totalCount: 6, totalPages: 3, count: 2, nextLink: null },
      };

      let callCount = 0;
      globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
        callCount += 1;
        let response;
        if (callCount === 1) {
          response = page1Response;
        } else if (callCount === 2) {
          response = page2Response;
        } else {
          response = page3Response;
        }

        setTimeout(() => {
          options.onload({
            status: 200,
            responseText: JSON.stringify(response),
          });
        }, 0);
      });

      const result = await fetchAccountTransactionsSinceDate('test-account-id', '2026-01-14');

      // Should include tx1, tx2, tx3, tx4 (all >= 2026-01-14)
      expect(result).toHaveLength(4);
      expect(result.map((t) => t.transactionUuid)).toEqual(['tx1', 'tx2', 'tx3', 'tx4']);

      // Should have made 3 API calls (stopped on page 3 when hitting old transactions)
      expect(globalThis.GM_xmlhttpRequest).toHaveBeenCalledTimes(3);
    });

    test('should throw error when accountId is missing', async () => {
      await expect(fetchAccountTransactionsSinceDate('', '2026-01-01')).rejects.toThrow('Account ID is required');
    });

    test('should throw error when sinceDate is missing', async () => {
      await expect(fetchAccountTransactionsSinceDate('test-account-id', '')).rejects.toThrow('Since date is required');
      await expect(fetchAccountTransactionsSinceDate('test-account-id', null)).rejects.toThrow('Since date is required');
    });

    test('should handle empty response', async () => {
      const mockResponse = {
        data: [],
        metadata: { totalCount: 0, totalPages: 0, count: 0, nextLink: null },
      };

      globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
        setTimeout(() => {
          options.onload({
            status: 200,
            responseText: JSON.stringify(mockResponse),
          });
        }, 0);
      });

      const result = await fetchAccountTransactionsSinceDate('test-account-id', '2026-01-01');
      expect(result).toEqual([]);
    });

    test('should handle invalid API response', async () => {
      globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
        setTimeout(() => {
          options.onload({
            status: 200,
            responseText: JSON.stringify({ invalid: 'response' }),
          });
        }, 0);
      });

      const result = await fetchAccountTransactionsSinceDate('test-account-id', '2026-01-01');
      expect(result).toEqual([]);
    });
  });

  describe('fetchAllAccountTransactions', () => {
    test('should fetch all transactions across multiple pages', async () => {
      const page1Response = {
        data: [
          { transactionUuid: 'tx1', transactionDate: '2026-01-20' },
          { transactionUuid: 'tx2', transactionDate: '2026-01-19' },
        ],
        metadata: { totalCount: 4, totalPages: 2, count: 2, nextLink: '/page2' },
      };

      const page2Response = {
        data: [
          { transactionUuid: 'tx3', transactionDate: '2026-01-18' },
          { transactionUuid: 'tx4', transactionDate: '2026-01-17' },
        ],
        metadata: { totalCount: 4, totalPages: 2, count: 2, nextLink: null },
      };

      let callCount = 0;
      globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
        callCount += 1;
        const response = callCount === 1 ? page1Response : page2Response;

        setTimeout(() => {
          options.onload({
            status: 200,
            responseText: JSON.stringify(response),
          });
        }, 0);
      });

      const result = await fetchAllAccountTransactions('test-account-id');

      expect(result).toHaveLength(4);
      expect(result.map((t) => t.transactionUuid)).toEqual(['tx1', 'tx2', 'tx3', 'tx4']);
      expect(globalThis.GM_xmlhttpRequest).toHaveBeenCalledTimes(2);
    });

    test('should use custom page size', async () => {
      const mockResponse = {
        data: [{ transactionUuid: 'tx1' }],
        metadata: { totalCount: 1, totalPages: 1, count: 1, nextLink: null },
      };

      globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
        expect(options.url).toContain('limit=500');
        setTimeout(() => {
          options.onload({
            status: 200,
            responseText: JSON.stringify(mockResponse),
          });
        }, 0);
      });

      await fetchAllAccountTransactions('test-account-id', 500);
    });

    test('should throw error when accountId is missing', async () => {
      await expect(fetchAllAccountTransactions('')).rejects.toThrow('Account ID is required');
      await expect(fetchAllAccountTransactions(null)).rejects.toThrow('Account ID is required');
    });

    test('should handle empty response', async () => {
      const mockResponse = {
        data: [],
        metadata: { totalCount: 0, totalPages: 0, count: 0, nextLink: null },
      };

      globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
        setTimeout(() => {
          options.onload({
            status: 200,
            responseText: JSON.stringify(mockResponse),
          });
        }, 0);
      });

      const result = await fetchAllAccountTransactions('test-account-id');
      expect(result).toEqual([]);
    });

    test('should handle invalid API response gracefully', async () => {
      globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
        setTimeout(() => {
          options.onload({
            status: 200,
            responseText: JSON.stringify({ invalid: 'response' }),
          });
        }, 0);
      });

      const result = await fetchAllAccountTransactions('test-account-id');
      expect(result).toEqual([]);
    });

    test('should handle large number of pages', async () => {
      // Simulate 5 pages of transactions
      let callCount = 0;
      globalThis.GM_xmlhttpRequest.mockImplementation((options) => {
        callCount += 1;
        const isLastPage = callCount === 5;
        const response = {
          data: [{ transactionUuid: `tx-page${callCount}` }],
          metadata: {
            totalCount: 5,
            totalPages: 5,
            count: 1,
            nextLink: isLastPage ? null : `/page${callCount + 1}`,
          },
        };

        setTimeout(() => {
          options.onload({
            status: 200,
            responseText: JSON.stringify(response),
          });
        }, 0);
      });

      const result = await fetchAllAccountTransactions('test-account-id');

      expect(result).toHaveLength(5);
      expect(globalThis.GM_xmlhttpRequest).toHaveBeenCalledTimes(5);
    });
  });

  describe('Default Export includes new transaction methods', () => {
    test('should export new transaction methods in default object', () => {
      const questradeApi = require('../../src/api/questrade').default;

      // Verify new methods exist
      expect(questradeApi).toHaveProperty('fetchTransactionsPage');
      expect(questradeApi).toHaveProperty('fetchTransactionDetails');
      expect(questradeApi).toHaveProperty('fetchTransactionsSinceDate');
      expect(questradeApi).toHaveProperty('fetchAllTransactions');

      // Verify they are functions
      expect(typeof questradeApi.fetchTransactionsPage).toBe('function');
      expect(typeof questradeApi.fetchTransactionDetails).toBe('function');
      expect(typeof questradeApi.fetchTransactionsSinceDate).toBe('function');
      expect(typeof questradeApi.fetchAllTransactions).toBe('function');
    });

    test('default export methods should match named exports', () => {
      const questradeApi = require('../../src/api/questrade').default;
      const {
        fetchAccountTransactionsPage: namedFetchTransactionsPage,
        fetchTransactionDetails: namedFetchTransactionDetails,
        fetchAccountTransactionsSinceDate: namedFetchTransactionsSinceDate,
        fetchAllAccountTransactions: namedFetchAllTransactions,
      } = require('../../src/api/questrade');

      expect(questradeApi.fetchTransactionsPage).toBe(namedFetchTransactionsPage);
      expect(questradeApi.fetchTransactionDetails).toBe(namedFetchTransactionDetails);
      expect(questradeApi.fetchTransactionsSinceDate).toBe(namedFetchTransactionsSinceDate);
      expect(questradeApi.fetchAllTransactions).toBe(namedFetchAllTransactions);
    });
  });
});
