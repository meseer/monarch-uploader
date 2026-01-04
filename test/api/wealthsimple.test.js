/**
 * Tests for Wealthsimple API Client
 */

import wealthsimpleApi from '../../src/api/wealthsimple';
import { STORAGE, API } from '../../src/core/config';

// Mock GM functions
global.GM_getValue = jest.fn();
global.GM_setValue = jest.fn();
global.GM_deleteValue = jest.fn();
global.GM_xmlhttpRequest = jest.fn();

// Mock document.cookie
Object.defineProperty(document, 'cookie', {
  writable: true,
  value: '',
});

// Mock state manager
jest.mock('../../src/core/state', () => ({
  __esModule: true,
  default: {
    setWealthsimpleAuth: jest.fn(),
  },
}));

describe('Wealthsimple API Client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    document.cookie = '';
    // Clear any intervals that might have been set
    jest.clearAllTimers();
  });

  describe('checkAuth', () => {
    it('should return not authenticated when no token stored', () => {
      GM_getValue.mockReturnValue(null);

      const result = wealthsimpleApi.checkAuth();

      expect(result.authenticated).toBe(false);
      expect(result.token).toBeNull();
      expect(result.identityId).toBeNull();
    });

    it('should return authenticated when valid token exists', () => {
      const futureDate = new Date(Date.now() + 3600000).toISOString(); // 1 hour future
      GM_getValue.mockImplementation((key) => {
        if (key === STORAGE.WEALTHSIMPLE_ACCESS_TOKEN) return 'test-token';
        if (key === STORAGE.WEALTHSIMPLE_IDENTITY_ID) return 'identity-123';
        if (key === STORAGE.WEALTHSIMPLE_TOKEN_EXPIRES_AT) return futureDate;
        return null;
      });

      const result = wealthsimpleApi.checkAuth();

      expect(result.authenticated).toBe(true);
      expect(result.token).toBe('test-token');
      expect(result.identityId).toBe('identity-123');
      expect(result.expiresAt).toBe(futureDate);
    });

    it('should return expired true and clear data when token is expired', () => {
      const pastDate = new Date(Date.now() - 3600000).toISOString(); // 1 hour past
      GM_getValue.mockImplementation((key) => {
        if (key === STORAGE.WEALTHSIMPLE_ACCESS_TOKEN) return 'test-token';
        if (key === STORAGE.WEALTHSIMPLE_IDENTITY_ID) return 'identity-123';
        if (key === STORAGE.WEALTHSIMPLE_TOKEN_EXPIRES_AT) return pastDate;
        return null;
      });

      const result = wealthsimpleApi.checkAuth();

      expect(result.authenticated).toBe(false);
      expect(result.expired).toBe(true);
      expect(GM_deleteValue).toHaveBeenCalledWith(STORAGE.WEALTHSIMPLE_ACCESS_TOKEN);
      expect(GM_deleteValue).toHaveBeenCalledWith(STORAGE.WEALTHSIMPLE_IDENTITY_ID);
    });

    it('should include profile IDs when available', () => {
      const futureDate = new Date(Date.now() + 3600000).toISOString();
      GM_getValue.mockImplementation((key) => {
        if (key === STORAGE.WEALTHSIMPLE_ACCESS_TOKEN) return 'test-token';
        if (key === STORAGE.WEALTHSIMPLE_IDENTITY_ID) return 'identity-123';
        if (key === STORAGE.WEALTHSIMPLE_TOKEN_EXPIRES_AT) return futureDate;
        if (key === STORAGE.WEALTHSIMPLE_INVEST_PROFILE) return 'invest-456';
        if (key === STORAGE.WEALTHSIMPLE_TRADE_PROFILE) return 'trade-789';
        return null;
      });

      const result = wealthsimpleApi.checkAuth();

      expect(result.investProfile).toBe('invest-456');
      expect(result.tradeProfile).toBe('trade-789');
    });
  });

  describe('setupTokenMonitoring', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should set up cookie monitoring', () => {
      const tokenData = {
        access_token: 'test-token',
        identity_canonical_id: 'identity-123',
        expires_at: '2026-01-02T22:00:00.000Z',
        profiles: {
          invest: { default: 'invest-456' },
          trade: { default: 'trade-789' },
        },
      };

      document.cookie = `_oauth2_access_v2=${encodeURIComponent(JSON.stringify(tokenData))}`;

      wealthsimpleApi.setupTokenMonitoring();

      expect(GM_setValue).toHaveBeenCalledWith(
        STORAGE.WEALTHSIMPLE_ACCESS_TOKEN,
        'test-token',
      );
      expect(GM_setValue).toHaveBeenCalledWith(
        STORAGE.WEALTHSIMPLE_IDENTITY_ID,
        'identity-123',
      );
    });

    it('should check cookie periodically', () => {
      const setIntervalSpy = jest.spyOn(global, 'setInterval');

      wealthsimpleApi.setupTokenMonitoring();

      // Should have set up an interval
      expect(setIntervalSpy).toHaveBeenCalled();

      setIntervalSpy.mockRestore();
    });
  });

  describe('makeGraphQLQuery', () => {
    it('should make successful GraphQL request', async () => {
      const futureDate = new Date(Date.now() + 3600000).toISOString();
      GM_getValue.mockImplementation((key) => {
        if (key === STORAGE.WEALTHSIMPLE_ACCESS_TOKEN) return 'test-token';
        if (key === STORAGE.WEALTHSIMPLE_IDENTITY_ID) return 'identity-123';
        if (key === STORAGE.WEALTHSIMPLE_TOKEN_EXPIRES_AT) return futureDate;
        return null;
      });

      const mockResponse = {
        data: {
          identity: {
            id: 'identity-123',
            accounts: {
              edges: [],
            },
          },
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify(mockResponse),
        });
      });

      const result = await wealthsimpleApi.makeGraphQLQuery(
        'FetchAllAccounts',
        'query { ... }',
        {},
      );

      expect(result).toEqual(mockResponse.data);
      expect(GM_xmlhttpRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          url: API.WEALTHSIMPLE_GRAPHQL_URL,
          headers: expect.objectContaining({
            authorization: 'Bearer test-token',
            'content-type': 'application/json',
          }),
        }),
      );
    });

    it('should inject identity ID into variables if not present', async () => {
      const futureDate = new Date(Date.now() + 3600000).toISOString();
      GM_getValue.mockImplementation((key) => {
        if (key === STORAGE.WEALTHSIMPLE_ACCESS_TOKEN) return 'test-token';
        if (key === STORAGE.WEALTHSIMPLE_IDENTITY_ID) return 'identity-123';
        if (key === STORAGE.WEALTHSIMPLE_TOKEN_EXPIRES_AT) return futureDate;
        return null;
      });

      GM_xmlhttpRequest.mockImplementation(({ data, onload }) => {
        const parsedData = JSON.parse(data);
        expect(parsedData.variables.identityId).toBe('identity-123');
        onload({
          status: 200,
          responseText: JSON.stringify({ data: {} }),
        });
      });

      await wealthsimpleApi.makeGraphQLQuery('TestQuery', 'query { ... }', {
        filter: {},
      });
    });

    it('should throw error when not authenticated', async () => {
      GM_getValue.mockReturnValue(null);

      await expect(
        wealthsimpleApi.makeGraphQLQuery('TestQuery', 'query { ... }', {}),
      ).rejects.toThrow('Wealthsimple auth token not found');
    });

    it('should handle 401 and clear token', async () => {
      const futureDate = new Date(Date.now() + 3600000).toISOString();
      GM_getValue.mockImplementation((key) => {
        if (key === STORAGE.WEALTHSIMPLE_ACCESS_TOKEN) return 'test-token';
        if (key === STORAGE.WEALTHSIMPLE_IDENTITY_ID) return 'identity-123';
        if (key === STORAGE.WEALTHSIMPLE_TOKEN_EXPIRES_AT) return futureDate;
        return null;
      });

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({ status: 401 });
      });

      await expect(
        wealthsimpleApi.makeGraphQLQuery('TestQuery', 'query { ... }', {}),
      ).rejects.toThrow('Auth token expired');

      expect(GM_deleteValue).toHaveBeenCalledWith(STORAGE.WEALTHSIMPLE_ACCESS_TOKEN);
    });

    it('should handle GraphQL errors in response', async () => {
      const futureDate = new Date(Date.now() + 3600000).toISOString();
      GM_getValue.mockImplementation((key) => {
        if (key === STORAGE.WEALTHSIMPLE_ACCESS_TOKEN) return 'test-token';
        if (key === STORAGE.WEALTHSIMPLE_IDENTITY_ID) return 'identity-123';
        if (key === STORAGE.WEALTHSIMPLE_TOKEN_EXPIRES_AT) return futureDate;
        return null;
      });

      const errorResponse = {
        errors: [
          { message: 'Field not found' },
          { message: 'Invalid query' },
        ],
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify(errorResponse),
        });
      });

      await expect(
        wealthsimpleApi.makeGraphQLQuery('TestQuery', 'query { ... }', {}),
      ).rejects.toThrow('GraphQL Error: Field not found, Invalid query');
    });

    it('should handle network errors', async () => {
      const futureDate = new Date(Date.now() + 3600000).toISOString();
      GM_getValue.mockImplementation((key) => {
        if (key === STORAGE.WEALTHSIMPLE_ACCESS_TOKEN) return 'test-token';
        if (key === STORAGE.WEALTHSIMPLE_IDENTITY_ID) return 'identity-123';
        if (key === STORAGE.WEALTHSIMPLE_TOKEN_EXPIRES_AT) return futureDate;
        return null;
      });

      GM_xmlhttpRequest.mockImplementation(({ onerror }) => {
        onerror(new Error('Network failure'));
      });

      await expect(
        wealthsimpleApi.makeGraphQLQuery('TestQuery', 'query { ... }', {}),
      ).rejects.toThrow('Network error');
    });
  });

  describe('validateToken', () => {
    it('should validate token successfully', async () => {
      const futureDate = new Date(Date.now() + 3600000).toISOString();
      GM_getValue.mockImplementation((key) => {
        if (key === STORAGE.WEALTHSIMPLE_ACCESS_TOKEN) return 'test-token';
        if (key === STORAGE.WEALTHSIMPLE_IDENTITY_ID) return 'identity-123';
        if (key === STORAGE.WEALTHSIMPLE_TOKEN_EXPIRES_AT) return futureDate;
        return null;
      });

      const tokenInfo = {
        resource_owner_id: 'identity-123',
        scope: ['invest.read', 'invest.write'],
        expires_in: 1800,
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify(tokenInfo),
        });
      });

      const result = await wealthsimpleApi.validateToken();

      expect(result).toEqual(tokenInfo);
    });

    it('should throw error when no token to validate', async () => {
      GM_getValue.mockReturnValue(null);

      await expect(wealthsimpleApi.validateToken()).rejects.toThrow(
        'No token to validate',
      );
    });

    it('should handle 401 and clear token', async () => {
      const futureDate = new Date(Date.now() + 3600000).toISOString();
      GM_getValue.mockImplementation((key) => {
        if (key === STORAGE.WEALTHSIMPLE_ACCESS_TOKEN) return 'test-token';
        if (key === STORAGE.WEALTHSIMPLE_IDENTITY_ID) return 'identity-123';
        if (key === STORAGE.WEALTHSIMPLE_TOKEN_EXPIRES_AT) return futureDate;
        return null;
      });

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({ status: 401 });
      });

      await expect(wealthsimpleApi.validateToken()).rejects.toThrow(
        'Token is invalid or expired',
      );

      expect(GM_deleteValue).toHaveBeenCalled();
    });
  });

  describe('fetchAccounts', () => {
    beforeEach(() => {
      const futureDate = new Date(Date.now() + 3600000).toISOString();
      GM_getValue.mockImplementation((key) => {
        if (key === STORAGE.WEALTHSIMPLE_ACCESS_TOKEN) return 'test-token';
        if (key === STORAGE.WEALTHSIMPLE_IDENTITY_ID) return 'identity-123';
        if (key === STORAGE.WEALTHSIMPLE_TOKEN_EXPIRES_AT) return futureDate;
        return null;
      });
    });

    it('should fetch and filter accounts', async () => {
      const mockResponse = {
        identity: {
          id: 'identity-123',
          accounts: {
            edges: [
              {
                node: {
                  id: 'acc-1',
                  status: 'open',
                  archivedAt: null,
                  unifiedAccountType: 'TFSA',
                  type: 'ca_tfsa',
                  nickname: 'My TFSA',
                  currency: 'CAD',
                  branch: 'WS',
                },
              },
              {
                node: {
                  id: 'acc-2',
                  status: 'closed',
                  archivedAt: null,
                  unifiedAccountType: 'RRSP',
                  type: 'ca_rrsp',
                  nickname: null,
                  currency: 'CAD',
                  branch: 'WS',
                },
              },
              {
                node: {
                  id: 'acc-3',
                  status: 'open',
                  archivedAt: '2025-12-01T00:00:00Z',
                  unifiedAccountType: 'CASH',
                  type: 'ca_cash',
                  nickname: null,
                  currency: 'CAD',
                  branch: 'WS',
                },
              },
              {
                node: {
                  id: 'acc-4',
                  status: 'open',
                  archivedAt: null,
                  unifiedAccountType: 'PERSONAL',
                  type: 'ca_personal',
                  nickname: null,
                  currency: 'CAD',
                  branch: 'WS',
                },
              },
            ],
          },
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchAccounts();

      // Should only include open, non-archived accounts
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('acc-1');
      expect(result[0].nickname).toBe('My TFSA');
      expect(result[1].id).toBe('acc-4');
      expect(result[1].nickname).toBe('caPersonal cc-4'); // Generated nickname (last 4 chars)
    });

    it('should generate nicknames when not provided', async () => {
      const mockResponse = {
        identity: {
          accounts: {
            edges: [
              {
                node: {
                  id: 'account-1234',
                  status: 'open',
                  archivedAt: null,
                  type: 'ca_credit_card',
                  nickname: null,
                  currency: 'CAD',
                },
              },
            ],
          },
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchAccounts();

      expect(result[0].nickname).toBe('caCreditCard 1234');
    });

    it('should return empty array when no accounts in response', async () => {
      const mockResponse = {
        identity: {
          accounts: {
            edges: [],
          },
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchAccounts();

      expect(result).toEqual([]);
    });

    it('should handle missing response data', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: {} }),
        });
      });

      const result = await wealthsimpleApi.fetchAccounts();

      expect(result).toEqual([]);
    });

    it('should propagate errors', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 500,
        });
      });

      await expect(wealthsimpleApi.fetchAccounts()).rejects.toThrow(
        'Server error',
      );
    });
  });

  describe('Cookie parsing', () => {
    it('should parse valid OAuth cookie', () => {
      const tokenData = {
        access_token: 'test-token',
        identity_canonical_id: 'identity-123',
        expires_at: '2026-01-02T22:00:00.000Z',
        profiles: {
          invest: { default: 'invest-456' },
          trade: { default: 'trade-789' },
        },
        email: 'test@example.com',
      };

      document.cookie = `_oauth2_access_v2=${encodeURIComponent(JSON.stringify(tokenData))}`;

      wealthsimpleApi.setupTokenMonitoring();

      expect(GM_setValue).toHaveBeenCalledWith(
        STORAGE.WEALTHSIMPLE_ACCESS_TOKEN,
        'test-token',
      );
      expect(GM_setValue).toHaveBeenCalledWith(
        STORAGE.WEALTHSIMPLE_TOKEN_EXPIRES_AT,
        '2026-01-02T22:00:00.000Z',
      );
      expect(GM_setValue).toHaveBeenCalledWith(
        STORAGE.WEALTHSIMPLE_INVEST_PROFILE,
        'invest-456',
      );
    });

    it('should handle missing profiles in cookie', () => {
      const tokenData = {
        access_token: 'test-token',
        identity_canonical_id: 'identity-123',
        expires_at: '2026-01-02T22:00:00.000Z',
      };

      document.cookie = `_oauth2_access_v2=${encodeURIComponent(JSON.stringify(tokenData))}`;

      wealthsimpleApi.setupTokenMonitoring();

      expect(GM_setValue).toHaveBeenCalledWith(
        STORAGE.WEALTHSIMPLE_ACCESS_TOKEN,
        'test-token',
      );
      // Should not throw, just not save profile IDs
    });

    it('should handle missing OAuth cookie', () => {
      document.cookie = 'some_other_cookie=value';

      wealthsimpleApi.setupTokenMonitoring();

      // Should not throw or save anything
      expect(GM_setValue).not.toHaveBeenCalled();
    });
  });

  describe('fetchAccountBalances', () => {
    beforeEach(() => {
      const futureDate = new Date(Date.now() + 3600000).toISOString();
      GM_getValue.mockImplementation((key) => {
        if (key === STORAGE.WEALTHSIMPLE_ACCESS_TOKEN) return 'test-token';
        if (key === STORAGE.WEALTHSIMPLE_IDENTITY_ID) return 'identity-123';
        if (key === STORAGE.WEALTHSIMPLE_TOKEN_EXPIRES_AT) return futureDate;
        return null;
      });
    });

    it('should fetch balances for multiple accounts', async () => {
      const mockResponse = {
        accounts: [
          {
            id: 'acc-1',
            financials: {
              currentCombined: {
                netLiquidationValueV2: {
                  amount: '96780.948811840969',
                  currency: 'CAD',
                },
              },
            },
          },
          {
            id: 'acc-2',
            financials: {
              currentCombined: {
                netLiquidationValueV2: {
                  amount: '45000.50',
                  currency: 'CAD',
                },
              },
            },
          },
        ],
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchAccountBalances(['acc-1', 'acc-2']);

      expect(result.success).toBe(true);
      expect(result.balances.size).toBe(2);
      const acc1Balance = result.balances.get('acc-1');
      expect(acc1Balance.currency).toBe('CAD');
      expect(acc1Balance.amount).toBeCloseTo(96780.95, 2);
      expect(result.balances.get('acc-2')).toEqual({
        amount: 45000.50,
        currency: 'CAD',
      });
    });

    it('should return null for accounts with missing balance data', async () => {
      const mockResponse = {
        accounts: [
          {
            id: 'acc-1',
            financials: {
              currentCombined: {
                netLiquidationValueV2: {
                  amount: '1000.00',
                  currency: 'CAD',
                },
              },
            },
          },
          {
            id: 'acc-2',
            financials: {},
          },
        ],
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchAccountBalances(['acc-1', 'acc-2']);

      expect(result.success).toBe(true);
      expect(result.balances.get('acc-1')).toEqual({
        amount: 1000.00,
        currency: 'CAD',
      });
      expect(result.balances.get('acc-2')).toBeNull();
    });

    it('should return error when no account IDs provided', async () => {
      const result = await wealthsimpleApi.fetchAccountBalances([]);

      expect(result.success).toBe(false);
      expect(result.error).toBe('No account IDs provided');
      expect(result.balances.size).toBe(0);
    });

    it('should handle invalid balance amounts', async () => {
      const mockResponse = {
        accounts: [
          {
            id: 'acc-1',
            financials: {
              currentCombined: {
                netLiquidationValueV2: {
                  amount: 'invalid',
                  currency: 'CAD',
                },
              },
            },
          },
        ],
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchAccountBalances(['acc-1']);

      expect(result.success).toBe(true);
      expect(result.balances.get('acc-1')).toBeNull();
    });

    it('should handle API errors', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 500,
        });
      });

      const result = await wealthsimpleApi.fetchAccountBalances(['acc-1']);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Server error');
    });

    it('should handle missing response data', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: {} }),
        });
      });

      const result = await wealthsimpleApi.fetchAccountBalances(['acc-1']);

      expect(result.success).toBe(false);
      expect(result.error).toBe('No accounts data in response');
    });
  });

  describe('fetchTransactions', () => {
    beforeEach(() => {
      // Mock Date.now() to return a consistent timestamp
      jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-01-03T16:00:00.000Z').getTime());

      const futureDate = new Date(Date.now() + 3600000).toISOString();
      GM_getValue.mockImplementation((key) => {
        if (key === STORAGE.WEALTHSIMPLE_ACCESS_TOKEN) return 'test-token';
        if (key === STORAGE.WEALTHSIMPLE_IDENTITY_ID) return 'identity-123';
        if (key === STORAGE.WEALTHSIMPLE_TOKEN_EXPIRES_AT) return futureDate;
        return null;
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should require accountId parameter', async () => {
      await expect(
        wealthsimpleApi.fetchTransactions(null, '2025-01-01'),
      ).rejects.toThrow('Account ID is required');
    });

    it('should require startDate parameter', async () => {
      await expect(
        wealthsimpleApi.fetchTransactions('acc-1', null),
      ).rejects.toThrow('Start date is required');
    });

    it('should validate startDate format', async () => {
      await expect(
        wealthsimpleApi.fetchTransactions('acc-1', 'invalid-date'),
      ).rejects.toThrow('Start date must be in YYYY-MM-DD format');

      await expect(
        wealthsimpleApi.fetchTransactions('acc-1', '01/01/2025'),
      ).rejects.toThrow('Start date must be in YYYY-MM-DD format');
    });

    it('should fetch single page of transactions', async () => {
      const mockResponse = {
        activityFeedItems: {
          edges: [
            {
              node: {
                accountId: 'acc-1',
                canonicalId: 'txn-1',
                amount: '100.00',
                currency: 'CAD',
                occurredAt: '2025-12-15T10:00:00.000000+00:00',
                spendMerchant: 'Test Merchant',
                status: 'settled',
                type: 'CREDIT_CARD',
                subType: 'PURCHASE',
              },
            },
            {
              node: {
                accountId: 'acc-1',
                canonicalId: 'txn-2',
                amount: '50.00',
                currency: 'CAD',
                occurredAt: '2025-12-10T14:30:00.000000+00:00',
                spendMerchant: 'Another Merchant',
                status: 'settled',
                type: 'CREDIT_CARD',
                subType: 'PURCHASE',
              },
            },
          ],
          pageInfo: {
            hasNextPage: false,
            endCursor: null,
          },
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchTransactions('acc-1', '2025-12-01');

      expect(result).toHaveLength(2);
      expect(result[0].canonicalId).toBe('txn-1');
      expect(result[1].canonicalId).toBe('txn-2');
    });

    it('should fetch multiple pages of transactions', async () => {
      let callCount = 0;

      GM_xmlhttpRequest.mockImplementation(({ data, onload }) => {
        callCount++;
        const variables = JSON.parse(data).variables;

        if (callCount === 1) {
          // First page
          expect(variables.cursor).toBeUndefined();
          onload({
            status: 200,
            responseText: JSON.stringify({
              data: {
                activityFeedItems: {
                  edges: [
                    {
                      node: {
                        canonicalId: 'txn-1',
                        occurredAt: '2025-12-15T10:00:00.000000+00:00',
                        amount: '100.00',
                        currency: 'CAD',
                      },
                    },
                  ],
                  pageInfo: {
                    hasNextPage: true,
                    endCursor: 'cursor-page-2',
                  },
                },
              },
            }),
          });
        } else {
          // Second page
          expect(variables.cursor).toBe('cursor-page-2');
          onload({
            status: 200,
            responseText: JSON.stringify({
              data: {
                activityFeedItems: {
                  edges: [
                    {
                      node: {
                        canonicalId: 'txn-2',
                        occurredAt: '2025-12-10T14:30:00.000000+00:00',
                        amount: '50.00',
                        currency: 'CAD',
                      },
                    },
                  ],
                  pageInfo: {
                    hasNextPage: false,
                    endCursor: null,
                  },
                },
              },
            }),
          });
        }
      });

      const result = await wealthsimpleApi.fetchTransactions('acc-1', '2025-12-01');

      expect(callCount).toBe(2);
      expect(result).toHaveLength(2);
      expect(result[0].canonicalId).toBe('txn-1');
      expect(result[1].canonicalId).toBe('txn-2');
    });

    it('should stop pagination when hitting startDate', async () => {
      let callCount = 0;

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        callCount++;

        if (callCount === 1) {
          // First page with recent transactions
          onload({
            status: 200,
            responseText: JSON.stringify({
              data: {
                activityFeedItems: {
                  edges: [
                    {
                      node: {
                        canonicalId: 'txn-1',
                        occurredAt: '2025-12-15T10:00:00.000000+00:00',
                        amount: '100.00',
                      },
                    },
                    {
                      node: {
                        canonicalId: 'txn-2',
                        occurredAt: '2025-12-10T14:30:00.000000+00:00',
                        amount: '50.00',
                      },
                    },
                  ],
                  pageInfo: {
                    hasNextPage: true,
                    endCursor: 'cursor-page-2',
                  },
                },
              },
            }),
          });
        } else {
          // Second page with older transactions (before startDate)
          onload({
            status: 200,
            responseText: JSON.stringify({
              data: {
                activityFeedItems: {
                  edges: [
                    {
                      node: {
                        canonicalId: 'txn-3',
                        occurredAt: '2025-11-25T10:00:00.000000+00:00', // Before startDate
                        amount: '75.00',
                      },
                    },
                  ],
                  pageInfo: {
                    hasNextPage: true,
                    endCursor: 'cursor-page-3',
                  },
                },
              },
            }),
          });
        }
      });

      const result = await wealthsimpleApi.fetchTransactions('acc-1', '2025-12-01');

      // Should only make 2 API calls, stopping when we hit old transaction
      expect(callCount).toBe(2);
      // Should only include transactions from page 1 (before hitting startDate)
      expect(result).toHaveLength(2);
      expect(result[0].canonicalId).toBe('txn-1');
      expect(result[1].canonicalId).toBe('txn-2');
    });

    it('should convert UTC dates to local dates for comparison', async () => {
      const mockResponse = {
        activityFeedItems: {
          edges: [
            {
              node: {
                canonicalId: 'txn-1',
                // Dec 15, 2025 in UTC
                occurredAt: '2025-12-15T10:00:00.000000+00:00',
                amount: '100.00',
              },
            },
            {
              node: {
                canonicalId: 'txn-2',
                // Nov 30, 2025 in UTC (before startDate)
                occurredAt: '2025-11-30T10:00:00.000000+00:00',
                amount: '50.00',
              },
            },
          ],
          pageInfo: {
            hasNextPage: false,
            endCursor: null,
          },
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchTransactions('acc-1', '2025-12-01');

      // Should only include txn-1 (Dec 15) but not txn-2 (Nov 30)
      // because txn-2's local date (2025-11-30) is before startDate (2025-12-01)
      expect(result).toHaveLength(1);
      expect(result[0].canonicalId).toBe('txn-1');
    });

    it('should return empty array when no transactions found', async () => {
      const mockResponse = {
        activityFeedItems: {
          edges: [],
          pageInfo: {
            hasNextPage: false,
            endCursor: null,
          },
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchTransactions('acc-1', '2025-12-01');

      expect(result).toEqual([]);
    });

    it('should handle missing activityFeedItems in response', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: {} }),
        });
      });

      const result = await wealthsimpleApi.fetchTransactions('acc-1', '2025-12-01');

      expect(result).toEqual([]);
    });

    it('should handle auth errors', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({ status: 401 });
      });

      await expect(
        wealthsimpleApi.fetchTransactions('acc-1', '2025-12-01'),
      ).rejects.toThrow('Auth token expired');
    });

    it('should handle network errors', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onerror }) => {
        onerror(new Error('Network failure'));
      });

      await expect(
        wealthsimpleApi.fetchTransactions('acc-1', '2025-12-01'),
      ).rejects.toThrow('Network error');
    });

    it('should include all Activity fragment fields', async () => {
      const fullTransaction = {
        accountId: 'acc-1',
        aftOriginatorName: null,
        aftTransactionCategory: null,
        aftTransactionType: null,
        amount: '37.16',
        amountSign: 'negative',
        assetQuantity: null,
        assetSymbol: null,
        canonicalId: 'credit-transaction-123',
        currency: 'CAD',
        eTransferEmail: null,
        eTransferName: null,
        externalCanonicalId: 'external-123',
        groupId: null,
        identityId: 'identity-123',
        institutionName: null,
        occurredAt: '2025-12-04T22:32:38.000000+00:00',
        p2pHandle: null,
        p2pMessage: null,
        spendMerchant: 'Test Merchant',
        securityId: null,
        billPayCompanyName: null,
        billPayPayeeNickname: null,
        redactedExternalAccountNumber: null,
        opposingAccountId: null,
        status: 'settled',
        subType: 'PURCHASE',
        type: 'CREDIT_CARD',
        strikePrice: null,
        contractType: null,
        expiryDate: null,
        chequeNumber: null,
        provisionalCreditAmount: null,
        primaryBlocker: null,
        interestRate: null,
        frequency: null,
        counterAssetSymbol: null,
        rewardProgram: null,
        counterPartyCurrency: null,
        counterPartyCurrencyAmount: null,
        counterPartyName: null,
        fxRate: null,
        fees: null,
        reference: null,
        transferType: null,
        optionStrategy: null,
        rejectionReason: null,
        resolvable: null,
        withholdingTaxAmount: null,
        announcementDate: null,
        recordDate: null,
        payableDate: null,
        grossDividendRate: null,
        unifiedStatus: 'COMPLETED',
        estimatedCompletionDate: null,
      };

      const mockResponse = {
        activityFeedItems: {
          edges: [{ node: fullTransaction }],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchTransactions('acc-1', '2025-12-01');

      expect(result).toHaveLength(1);
      // Verify all fields are present
      expect(result[0]).toEqual(fullTransaction);
      expect(result[0].spendMerchant).toBe('Test Merchant');
      expect(result[0].unifiedStatus).toBe('COMPLETED');
    });

    it('should use maximum page size of 50', async () => {
      GM_xmlhttpRequest.mockImplementation(({ data, onload }) => {
        const variables = JSON.parse(data).variables;
        expect(variables.first).toBe(50);

        onload({
          status: 200,
          responseText: JSON.stringify({
            data: {
              activityFeedItems: {
                edges: [],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          }),
        });
      });

      await wealthsimpleApi.fetchTransactions('acc-1', '2025-12-01');
    });

    it('should set endDate to current time', async () => {
      GM_xmlhttpRequest.mockImplementation(({ data, onload }) => {
        const variables = JSON.parse(data).variables;
        const endDate = variables.condition.endDate;

        // Should be an ISO string close to current time
        expect(endDate).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

        onload({
          status: 200,
          responseText: JSON.stringify({
            data: {
              activityFeedItems: {
                edges: [],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          }),
        });
      });

      await wealthsimpleApi.fetchTransactions('acc-1', '2025-12-01');
    });
  });
});
