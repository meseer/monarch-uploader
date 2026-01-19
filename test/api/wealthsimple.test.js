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

    it('should NOT inject identity ID for FetchFundingIntent operation', async () => {
      const futureDate = new Date(Date.now() + 3600000).toISOString();
      GM_getValue.mockImplementation((key) => {
        if (key === STORAGE.WEALTHSIMPLE_ACCESS_TOKEN) return 'test-token';
        if (key === STORAGE.WEALTHSIMPLE_IDENTITY_ID) return 'identity-123';
        if (key === STORAGE.WEALTHSIMPLE_TOKEN_EXPIRES_AT) return futureDate;
        return null;
      });

      GM_xmlhttpRequest.mockImplementation(({ data, onload }) => {
        const parsedData = JSON.parse(data);
        // FetchFundingIntent should NOT have identityId injected
        expect(parsedData.variables.identityId).toBeUndefined();
        expect(parsedData.variables.ids).toEqual(['funding_intent-abc123']);
        onload({
          status: 200,
          responseText: JSON.stringify({ data: { searchFundingIntents: { edges: [] } } }),
        });
      });

      await wealthsimpleApi.makeGraphQLQuery('FetchFundingIntent', 'query { ... }', {
        ids: ['funding_intent-abc123'],
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
                  unifiedAccountType: 'MANAGED_TFSA',
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
                  unifiedAccountType: 'MANAGED_RRSP',
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
                  id: 'acc-4abc',
                  status: 'open',
                  archivedAt: null,
                  unifiedAccountType: 'CASH',
                  type: 'ca_cash',
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
      expect(result[1].id).toBe('acc-4abc');
      // New format: "Wealthsimple {Display Name} ({last4})"
      expect(result[1].nickname).toBe('Wealthsimple Cash (4abc)');
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
                  unifiedAccountType: 'CREDIT_CARD',
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

      // New format: "Wealthsimple {Display Name} ({last4})"
      // For credit cards without user nickname, it initially uses account ID last 4
      // (enrichCreditCardNicknames in fetchAndCacheAccounts will update with actual card digits)
      expect(result[0].nickname).toBe('Wealthsimple Credit Card (1234)');
      expect(result[0].needsNicknameEnrichment).toBe(true);
    });

    it('should set needsNicknameEnrichment flag for credit cards without user nickname', async () => {
      const mockResponse = {
        identity: {
          accounts: {
            edges: [
              {
                node: {
                  id: 'cc-account-1234',
                  status: 'open',
                  archivedAt: null,
                  unifiedAccountType: 'CREDIT_CARD',
                  type: 'ca_credit_card',
                  nickname: null, // No user-set nickname
                  currency: 'CAD',
                },
              },
              {
                node: {
                  id: 'cc-account-5678',
                  status: 'open',
                  archivedAt: null,
                  unifiedAccountType: 'CREDIT_CARD',
                  type: 'ca_credit_card',
                  nickname: 'My Credit Card', // User-set nickname
                  currency: 'CAD',
                },
              },
              {
                node: {
                  id: 'tfsa-account-9999',
                  status: 'open',
                  archivedAt: null,
                  unifiedAccountType: 'MANAGED_TFSA',
                  type: 'ca_tfsa',
                  nickname: null, // No user-set nickname, but not a credit card
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

      // Credit card without user nickname should need enrichment
      expect(result[0].needsNicknameEnrichment).toBe(true);
      expect(result[0].nickname).toBe('Wealthsimple Credit Card (1234)');

      // Credit card with user nickname should NOT need enrichment
      expect(result[1].needsNicknameEnrichment).toBe(false);
      expect(result[1].nickname).toBe('My Credit Card');

      // Non-credit card without user nickname should NOT need enrichment
      expect(result[2].needsNicknameEnrichment).toBe(false);
      expect(result[2].nickname).toBe('Wealthsimple Managed TFSA (9999)');
    });

    it('should generate nicknames with display names for known account types', async () => {
      const mockResponse = {
        identity: {
          accounts: {
            edges: [
              {
                node: {
                  id: 'acc-tfsa-1234',
                  status: 'open',
                  archivedAt: null,
                  unifiedAccountType: 'MANAGED_TFSA',
                  type: 'ca_tfsa',
                  nickname: null,
                  currency: 'CAD',
                },
              },
              {
                node: {
                  id: 'acc-rrsp-5678',
                  status: 'open',
                  archivedAt: null,
                  unifiedAccountType: 'SELF_DIRECTED_RRSP',
                  type: 'ca_rrsp',
                  nickname: null,
                  currency: 'CAD',
                },
              },
              {
                node: {
                  id: 'acc-cash-9012',
                  status: 'open',
                  archivedAt: null,
                  unifiedAccountType: 'CASH_USD',
                  type: 'ca_cash_usd',
                  nickname: null,
                  currency: 'USD',
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

      expect(result[0].nickname).toBe('Wealthsimple Managed TFSA (1234)');
      expect(result[1].nickname).toBe('Wealthsimple Self Directed RRSP (5678)');
      expect(result[2].nickname).toBe('Wealthsimple Cash USD (9012)');
    });

    it('should fallback to raw type for unknown account types', async () => {
      const mockResponse = {
        identity: {
          accounts: {
            edges: [
              {
                node: {
                  id: 'acc-unknown-1234',
                  status: 'open',
                  archivedAt: null,
                  unifiedAccountType: 'UNKNOWN_TYPE',
                  type: 'ca_unknown',
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

      // Falls back to raw type when not in display names mapping
      expect(result[0].nickname).toBe('Wealthsimple UNKNOWN_TYPE (1234)');
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

    it('should fetch balances for multiple non-credit-card accounts', async () => {
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

      const accounts = [
        { id: 'acc-1', type: 'MANAGED_TFSA', currency: 'CAD' },
        { id: 'acc-2', type: 'MANAGED_RRSP', currency: 'CAD' },
      ];
      const result = await wealthsimpleApi.fetchAccountBalances(accounts);

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

    it('should fetch balances for credit card accounts using FetchCreditCardAccountSummary and negate the amount', async () => {
      const mockCreditCardResponse = {
        creditCardAccount: {
          id: 'cc-1',
          balance: {
            current: '30.53',
          },
          creditLimit: 17000,
          currentCards: [{ cardNumberLast4Digits: '6903' }],
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ data, onload }) => {
        const parsedData = JSON.parse(data);
        if (parsedData.operationName === 'FetchCreditCardAccountSummary') {
          onload({
            status: 200,
            responseText: JSON.stringify({ data: mockCreditCardResponse }),
          });
        }
      });

      const accounts = [
        { id: 'cc-1', type: 'CREDIT_CARD', currency: 'CAD' },
      ];
      const result = await wealthsimpleApi.fetchAccountBalances(accounts);

      expect(result.success).toBe(true);
      expect(result.balances.size).toBe(1);
      const ccBalance = result.balances.get('cc-1');
      // Credit card balance should be negated (Wealthsimple returns positive, Monarch expects negative)
      expect(ccBalance.amount).toBeCloseTo(-30.53, 2);
      expect(ccBalance.currency).toBe('CAD');
    });

    it('should fetch balances for mixed account types with negated credit card balance', async () => {
      const mockInvestmentResponse = {
        accounts: [
          {
            id: 'tfsa-1',
            financials: {
              currentCombined: {
                netLiquidationValueV2: {
                  amount: '50000.00',
                  currency: 'CAD',
                },
              },
            },
          },
        ],
      };

      const mockCreditCardResponse = {
        creditCardAccount: {
          id: 'cc-1',
          balance: {
            current: '150.75',
          },
          creditLimit: 10000,
          currentCards: [],
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ data, onload }) => {
        const parsedData = JSON.parse(data);
        if (parsedData.operationName === 'FetchCreditCardAccountSummary') {
          onload({
            status: 200,
            responseText: JSON.stringify({ data: mockCreditCardResponse }),
          });
        } else if (parsedData.operationName === 'FetchAccountCombinedFinancialsPreload') {
          onload({
            status: 200,
            responseText: JSON.stringify({ data: mockInvestmentResponse }),
          });
        }
      });

      const accounts = [
        { id: 'cc-1', type: 'CREDIT_CARD', currency: 'CAD' },
        { id: 'tfsa-1', type: 'MANAGED_TFSA', currency: 'CAD' },
      ];
      const result = await wealthsimpleApi.fetchAccountBalances(accounts);

      expect(result.success).toBe(true);
      expect(result.balances.size).toBe(2);
      // Credit card balance should be negated
      expect(result.balances.get('cc-1')).toEqual({
        amount: -150.75,
        currency: 'CAD',
      });
      // Investment account balance stays positive
      expect(result.balances.get('tfsa-1')).toEqual({
        amount: 50000.00,
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

      const accounts = [
        { id: 'acc-1', type: 'MANAGED_TFSA', currency: 'CAD' },
        { id: 'acc-2', type: 'MANAGED_RRSP', currency: 'CAD' },
      ];
      const result = await wealthsimpleApi.fetchAccountBalances(accounts);

      expect(result.success).toBe(true);
      expect(result.balances.get('acc-1')).toEqual({
        amount: 1000.00,
        currency: 'CAD',
      });
      expect(result.balances.get('acc-2')).toBeNull();
    });

    it('should return error when no accounts provided', async () => {
      const result = await wealthsimpleApi.fetchAccountBalances([]);

      expect(result.success).toBe(false);
      expect(result.error).toBe('No accounts provided');
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

      const accounts = [{ id: 'acc-1', type: 'MANAGED_TFSA', currency: 'CAD' }];
      const result = await wealthsimpleApi.fetchAccountBalances(accounts);

      expect(result.success).toBe(true);
      expect(result.balances.get('acc-1')).toBeNull();
    });

    it('should handle API errors for non-credit-card accounts', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 500,
        });
      });

      const accounts = [{ id: 'acc-1', type: 'MANAGED_TFSA', currency: 'CAD' }];
      const result = await wealthsimpleApi.fetchAccountBalances(accounts);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Server error');
    });

    it('should handle credit card API errors gracefully and set null balance', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 500,
        });
      });

      const accounts = [{ id: 'cc-1', type: 'CREDIT_CARD', currency: 'CAD' }];
      const result = await wealthsimpleApi.fetchAccountBalances(accounts);

      // Credit card errors are handled per-account, so success is still true
      expect(result.success).toBe(true);
      expect(result.balances.get('cc-1')).toBeNull();
    });

    it('should handle missing response data for non-credit-card accounts', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: {} }),
        });
      });

      const accounts = [{ id: 'acc-1', type: 'MANAGED_TFSA', currency: 'CAD' }];
      const result = await wealthsimpleApi.fetchAccountBalances(accounts);

      // Sets null for accounts that failed
      expect(result.success).toBe(true);
      expect(result.balances.get('acc-1')).toBeNull();
    });

    it('should handle credit card with missing balance.current', async () => {
      const mockCreditCardResponse = {
        creditCardAccount: {
          id: 'cc-1',
          balance: {},
          creditLimit: 17000,
          currentCards: [],
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockCreditCardResponse }),
        });
      });

      const accounts = [{ id: 'cc-1', type: 'CREDIT_CARD', currency: 'CAD' }];
      const result = await wealthsimpleApi.fetchAccountBalances(accounts);

      expect(result.success).toBe(true);
      expect(result.balances.get('cc-1')).toBeNull();
    });

    it('should default currency to CAD for credit cards and negate the balance', async () => {
      const mockCreditCardResponse = {
        creditCardAccount: {
          id: 'cc-1',
          balance: {
            current: '100.00',
          },
          creditLimit: 5000,
          currentCards: [],
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockCreditCardResponse }),
        });
      });

      // Credit card without explicit currency
      const accounts = [{ id: 'cc-1', type: 'CREDIT_CARD' }];
      const result = await wealthsimpleApi.fetchAccountBalances(accounts);

      expect(result.success).toBe(true);
      expect(result.balances.get('cc-1').currency).toBe('CAD');
      // Balance should be negated
      expect(result.balances.get('cc-1').amount).toBe(-100.00);
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

  describe('fetchCreditCardAccountSummary', () => {
    beforeEach(() => {
      const futureDate = new Date(Date.now() + 3600000).toISOString();
      GM_getValue.mockImplementation((key) => {
        if (key === STORAGE.WEALTHSIMPLE_ACCESS_TOKEN) return 'test-token';
        if (key === STORAGE.WEALTHSIMPLE_IDENTITY_ID) return 'identity-123';
        if (key === STORAGE.WEALTHSIMPLE_TOKEN_EXPIRES_AT) return futureDate;
        return null;
      });
    });

    it('should require accountId parameter', async () => {
      await expect(
        wealthsimpleApi.fetchCreditCardAccountSummary(null),
      ).rejects.toThrow('Account ID is required');

      await expect(
        wealthsimpleApi.fetchCreditCardAccountSummary(''),
      ).rejects.toThrow('Account ID is required');
    });

    it('should fetch credit card account summary successfully', async () => {
      const mockResponse = {
        creditCardAccount: {
          id: 'ca-credit-card-ABC123',
          balance: {
            current: 1500.50,
            __typename: 'Money',
          },
          creditRegistrationStatus: 'REGISTERED',
          creditLimit: 17000,
          currentCards: [
            {
              id: 'card-1',
              cardNumberLast4Digits: '1234',
              cardVariant: 'PRIMARY',
              __typename: 'CreditCard',
            },
          ],
          __typename: 'CreditCardAccount',
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchCreditCardAccountSummary('ca-credit-card-ABC123');

      expect(result).toEqual(mockResponse.creditCardAccount);
      expect(result.creditLimit).toBe(17000);
      expect(result.balance.current).toBe(1500.50);
      expect(result.creditRegistrationStatus).toBe('REGISTERED');
      expect(result.currentCards).toHaveLength(1);
      expect(result.currentCards[0].cardNumberLast4Digits).toBe('1234');
    });

    it('should pass correct account ID in GraphQL query', async () => {
      const mockResponse = {
        creditCardAccount: {
          id: 'ca-credit-card-XYZ789',
          balance: { current: 0 },
          creditRegistrationStatus: 'REGISTERED',
          creditLimit: 5000,
          currentCards: [],
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ data, onload }) => {
        const parsedData = JSON.parse(data);
        expect(parsedData.operationName).toBe('FetchCreditCardAccountSummary');
        expect(parsedData.variables.id).toBe('ca-credit-card-XYZ789');

        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      await wealthsimpleApi.fetchCreditCardAccountSummary('ca-credit-card-XYZ789');
    });

    it('should handle missing credit card account data in response', async () => {
      const mockResponse = {};

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      await expect(
        wealthsimpleApi.fetchCreditCardAccountSummary('ca-credit-card-ABC123'),
      ).rejects.toThrow('No credit card account data in response');
    });

    it('should handle null credit card account in response', async () => {
      const mockResponse = {
        creditCardAccount: null,
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      await expect(
        wealthsimpleApi.fetchCreditCardAccountSummary('ca-credit-card-ABC123'),
      ).rejects.toThrow('No credit card account data in response');
    });

    it('should handle account with null credit limit', async () => {
      const mockResponse = {
        creditCardAccount: {
          id: 'ca-credit-card-ABC123',
          balance: { current: 500.00 },
          creditRegistrationStatus: 'PENDING',
          creditLimit: null,
          currentCards: [],
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchCreditCardAccountSummary('ca-credit-card-ABC123');

      expect(result.creditLimit).toBeNull();
    });

    it('should handle account with zero credit limit', async () => {
      const mockResponse = {
        creditCardAccount: {
          id: 'ca-credit-card-ABC123',
          balance: { current: 0 },
          creditRegistrationStatus: 'REGISTERED',
          creditLimit: 0,
          currentCards: [],
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchCreditCardAccountSummary('ca-credit-card-ABC123');

      expect(result.creditLimit).toBe(0);
    });

    it('should handle multiple cards in response', async () => {
      const mockResponse = {
        creditCardAccount: {
          id: 'ca-credit-card-ABC123',
          balance: { current: 2000.00 },
          creditRegistrationStatus: 'REGISTERED',
          creditLimit: 10000,
          currentCards: [
            {
              id: 'card-1',
              cardNumberLast4Digits: '1234',
              cardVariant: 'PRIMARY',
              __typename: 'CreditCard',
            },
            {
              id: 'card-2',
              cardNumberLast4Digits: '5678',
              cardVariant: 'SUPPLEMENTARY',
              __typename: 'CreditCard',
            },
          ],
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchCreditCardAccountSummary('ca-credit-card-ABC123');

      expect(result.currentCards).toHaveLength(2);
      expect(result.currentCards[0].cardVariant).toBe('PRIMARY');
      expect(result.currentCards[1].cardVariant).toBe('SUPPLEMENTARY');
    });

    it('should handle auth errors', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({ status: 401 });
      });

      await expect(
        wealthsimpleApi.fetchCreditCardAccountSummary('ca-credit-card-ABC123'),
      ).rejects.toThrow('Auth token expired');

      expect(GM_deleteValue).toHaveBeenCalledWith(STORAGE.WEALTHSIMPLE_ACCESS_TOKEN);
    });

    it('should handle GraphQL errors', async () => {
      const errorResponse = {
        errors: [
          { message: 'Account not found' },
        ],
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify(errorResponse),
        });
      });

      await expect(
        wealthsimpleApi.fetchCreditCardAccountSummary('invalid-account'),
      ).rejects.toThrow('GraphQL Error: Account not found');
    });

    it('should handle network errors', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onerror }) => {
        onerror(new Error('Network failure'));
      });

      await expect(
        wealthsimpleApi.fetchCreditCardAccountSummary('ca-credit-card-ABC123'),
      ).rejects.toThrow('Network error');
    });

    it('should handle server errors', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({ status: 500 });
      });

      await expect(
        wealthsimpleApi.fetchCreditCardAccountSummary('ca-credit-card-ABC123'),
      ).rejects.toThrow('Server error');
    });
  });

  describe('fetchFundingIntents', () => {
    beforeEach(() => {
      const futureDate = new Date(Date.now() + 3600000).toISOString();
      GM_getValue.mockImplementation((key) => {
        if (key === STORAGE.WEALTHSIMPLE_ACCESS_TOKEN) return 'test-token';
        if (key === STORAGE.WEALTHSIMPLE_IDENTITY_ID) return 'identity-123';
        if (key === STORAGE.WEALTHSIMPLE_TOKEN_EXPIRES_AT) return futureDate;
        return null;
      });
    });

    it('should return empty map for empty array', async () => {
      const result = await wealthsimpleApi.fetchFundingIntents([]);
      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });

    it('should return empty map for null input', async () => {
      const result = await wealthsimpleApi.fetchFundingIntents(null);
      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });

    it('should filter out non-funding_intent- IDs', async () => {
      const result = await wealthsimpleApi.fetchFundingIntents([
        'credit-transaction-123',
        'some-other-id',
      ]);
      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
      // Should not make any API call since no valid IDs
      expect(GM_xmlhttpRequest).not.toHaveBeenCalled();
    });

    it('should fetch funding intents for valid IDs', async () => {
      const mockResponse = {
        searchFundingIntents: {
          edges: [
            {
              node: {
                id: 'funding_intent-abc123',
                state: 'completed',
                transactionType: 'e_transfer_receive',
                transferMetadata: {
                  memo: 'Test memo message',
                  paymentType: 'ACCOUNT_ALIAS_PAYMENT',
                  recipient_email: 'test@example.com',
                  __typename: 'FundingIntentETransferReceiveMetadata',
                },
                __typename: 'FundingIntent',
              },
              __typename: 'FundingIntentEdge',
            },
          ],
          pageInfo: {
            hasNextPage: false,
            endCursor: 'MQ',
            __typename: 'PageInfo',
          },
          __typename: 'FundingIntentConnection',
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchFundingIntents([
        'funding_intent-abc123',
      ]);

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(1);
      expect(result.has('funding_intent-abc123')).toBe(true);
      expect(result.get('funding_intent-abc123').transferMetadata.memo).toBe('Test memo message');
    });

    it('should fetch multiple funding intents in single request', async () => {
      const mockResponse = {
        searchFundingIntents: {
          edges: [
            {
              node: {
                id: 'funding_intent-abc123',
                state: 'completed',
                transactionType: 'e_transfer_receive',
                transferMetadata: {
                  memo: 'First memo',
                  __typename: 'FundingIntentETransferReceiveMetadata',
                },
              },
            },
            {
              node: {
                id: 'funding_intent-def456',
                state: 'completed',
                transactionType: 'e_transfer_send',
                transferMetadata: {
                  message: 'Second memo',
                  __typename: 'FundingIntentETransferTransactionMetadata',
                },
              },
            },
          ],
          pageInfo: {
            hasNextPage: false,
            endCursor: 'Mg',
          },
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ data, onload }) => {
        const parsedData = JSON.parse(data);
        expect(parsedData.operationName).toBe('FetchFundingIntent');
        expect(parsedData.variables.ids).toEqual([
          'funding_intent-abc123',
          'funding_intent-def456',
        ]);

        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchFundingIntents([
        'funding_intent-abc123',
        'funding_intent-def456',
      ]);

      expect(result.size).toBe(2);
      expect(result.get('funding_intent-abc123').transferMetadata.memo).toBe('First memo');
      expect(result.get('funding_intent-def456').transferMetadata.message).toBe('Second memo');
    });

    it('should filter valid IDs from mixed input', async () => {
      const mockResponse = {
        searchFundingIntents: {
          edges: [
            {
              node: {
                id: 'funding_intent-valid123',
                state: 'completed',
                transferMetadata: null,
              },
            },
          ],
          pageInfo: {
            hasNextPage: false,
            endCursor: null,
          },
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ data, onload }) => {
        const parsedData = JSON.parse(data);
        // Should only include funding_intent- prefixed IDs
        expect(parsedData.variables.ids).toEqual(['funding_intent-valid123']);

        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchFundingIntents([
        'credit-transaction-123',
        'funding_intent-valid123',
        'other-id',
      ]);

      expect(result.size).toBe(1);
      expect(result.has('funding_intent-valid123')).toBe(true);
    });

    it('should return empty map when no searchFundingIntents in response', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: {} }),
        });
      });

      const result = await wealthsimpleApi.fetchFundingIntents([
        'funding_intent-abc123',
      ]);

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });

    it('should return empty map on API error without failing', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({ status: 500 });
      });

      // Should not throw, just return empty map
      const result = await wealthsimpleApi.fetchFundingIntents([
        'funding_intent-abc123',
      ]);

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });

    it('should return empty map on network error without failing', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onerror }) => {
        onerror(new Error('Network failure'));
      });

      // Should not throw, just return empty map
      const result = await wealthsimpleApi.fetchFundingIntents([
        'funding_intent-abc123',
      ]);

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });

    it('should handle empty edges array', async () => {
      const mockResponse = {
        searchFundingIntents: {
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

      const result = await wealthsimpleApi.fetchFundingIntents([
        'funding_intent-abc123',
      ]);

      expect(result.size).toBe(0);
    });

    it('should handle funding intent with incoming e-transfer metadata', async () => {
      const mockResponse = {
        searchFundingIntents: {
          edges: [
            {
              node: {
                id: 'funding_intent-l1CpBeHrJabDfHWKDucwgX6LXWV',
                state: 'completed',
                idempotencyKey: 'transaction-ZJVwl7rkDaRe7uPMmaWncbo8JQa',
                createdAt: '2025-10-29T20:43:21.327576Z',
                updatedAt: '2025-10-29T22:20:19.213103Z',
                externalReferenceId: 'transaction-ZJVwl7rkDaRe7uPMmaWncbo8JQa',
                fundableType: 'Deposit',
                transactionType: 'e_transfer_receive',
                fundableDetails: {
                  createdAt: '2025-10-29T20:43:21.317164Z',
                  amount: '450.0',
                  currency: 'CAD',
                  completedAt: '2025-10-29T22:20:19.234950Z',
                  provisionalCredit: null,
                  __typename: 'FundingIntentDeposit',
                },
                source: {
                  id: 'funding_method-3NGF5M4kBwjIGkrPvqZo28CF0qb',
                  type: 'FundingMethod',
                  __typename: 'FundingPoint',
                },
                destination: {
                  id: 'ca-cash-msb-iusfagkx',
                  type: 'Account',
                  __typename: 'FundingPoint',
                },
                postDated: null,
                transactionMetadata: null,
                transferMetadata: {
                  memo: 'Oven for Unit 202 Trinity',
                  paymentType: 'ACCOUNT_ALIAS_PAYMENT',
                  recipient_email: 'mykhailo@wealthsimple.me',
                  __typename: 'FundingIntentETransferReceiveMetadata',
                },
                transferMetadataV2: null,
                userReferenceId: 'D7HEB',
                recurrence: null,
                __typename: 'FundingIntent',
              },
            },
          ],
          pageInfo: {
            hasNextPage: false,
            endCursor: 'MQ',
          },
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchFundingIntents([
        'funding_intent-l1CpBeHrJabDfHWKDucwgX6LXWV',
      ]);

      expect(result.size).toBe(1);
      const intent = result.get('funding_intent-l1CpBeHrJabDfHWKDucwgX6LXWV');
      expect(intent.transactionType).toBe('e_transfer_receive');
      expect(intent.transferMetadata.memo).toBe('Oven for Unit 202 Trinity');
      expect(intent.transferMetadata.paymentType).toBe('ACCOUNT_ALIAS_PAYMENT');
      expect(intent.fundableDetails.amount).toBe('450.0');
    });

    it('should handle funding intent with outgoing e-transfer metadata', async () => {
      const mockResponse = {
        searchFundingIntents: {
          edges: [
            {
              node: {
                id: 'funding_intent-outgoing123',
                state: 'completed',
                transactionType: 'e_transfer_send',
                transferMetadata: {
                  message: 'Payment for services',
                  securityAnswer: null,
                  __typename: 'FundingIntentETransferTransactionMetadata',
                },
                __typename: 'FundingIntent',
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

      const result = await wealthsimpleApi.fetchFundingIntents([
        'funding_intent-outgoing123',
      ]);

      expect(result.size).toBe(1);
      const intent = result.get('funding_intent-outgoing123');
      expect(intent.transactionType).toBe('e_transfer_send');
      // Outgoing e-transfers have 'message' instead of 'memo'
      expect(intent.transferMetadata.message).toBe('Payment for services');
    });
  });

  describe('fetchInternalTransfer', () => {
    beforeEach(() => {
      const futureDate = new Date(Date.now() + 3600000).toISOString();
      GM_getValue.mockImplementation((key) => {
        if (key === STORAGE.WEALTHSIMPLE_ACCESS_TOKEN) return 'test-token';
        if (key === STORAGE.WEALTHSIMPLE_IDENTITY_ID) return 'identity-123';
        if (key === STORAGE.WEALTHSIMPLE_TOKEN_EXPIRES_AT) return futureDate;
        return null;
      });
    });

    it('should return null for null input', async () => {
      const result = await wealthsimpleApi.fetchInternalTransfer(null);
      expect(result).toBeNull();
      expect(GM_xmlhttpRequest).not.toHaveBeenCalled();
    });

    it('should return null for empty string input', async () => {
      const result = await wealthsimpleApi.fetchInternalTransfer('');
      expect(result).toBeNull();
      expect(GM_xmlhttpRequest).not.toHaveBeenCalled();
    });

    it('should fetch internal transfer details successfully', async () => {
      const mockResponse = {
        internalTransfer: {
          id: 'funding_intent-RHgNxU9iOg99IbPmQwSErvXLL0n',
          amount: '19.68',
          currency: 'CAD',
          fxRate: null,
          fxAdjustedAmount: null,
          reportedFxAdjustedAmount: null,
          fxFeeRate: null,
          isCancellable: false,
          status: 'completed',
          transferType: 'partial_in_cash',
          instantEligibility: {
            status: 'eligible',
            amount: '19.68',
            __typename: 'InternalTransferInstantEligibility',
          },
          tax_detail: null,
          annotation: 'additional payment landed in wrong account',
          reason: null,
          __typename: 'InternalTransfer',
          source_account: {
            id: 'ca-cash-msb-4IX85yCxIw',
            unifiedAccountType: 'CASH',
            __typename: 'Account',
          },
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchInternalTransfer('funding_intent-RHgNxU9iOg99IbPmQwSErvXLL0n');

      expect(result).not.toBeNull();
      expect(result.id).toBe('funding_intent-RHgNxU9iOg99IbPmQwSErvXLL0n');
      expect(result.annotation).toBe('additional payment landed in wrong account');
      expect(result.status).toBe('completed');
      expect(result.transferType).toBe('partial_in_cash');
    });

    it('should NOT inject identity ID into request', async () => {
      const mockResponse = {
        internalTransfer: {
          id: 'funding_intent-test123',
          annotation: 'test annotation',
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ data, onload }) => {
        const parsedData = JSON.parse(data);
        expect(parsedData.operationName).toBe('FetchInternalTransfer');
        // FetchInternalTransfer should NOT have identityId injected
        expect(parsedData.variables.identityId).toBeUndefined();
        expect(parsedData.variables.id).toBe('funding_intent-test123');

        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      await wealthsimpleApi.fetchInternalTransfer('funding_intent-test123');
    });

    it('should return null when no internalTransfer in response', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: {} }),
        });
      });

      const result = await wealthsimpleApi.fetchInternalTransfer('funding_intent-abc123');
      expect(result).toBeNull();
    });

    it('should return null on API error without failing', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({ status: 500 });
      });

      // Should not throw, just return null
      const result = await wealthsimpleApi.fetchInternalTransfer('funding_intent-abc123');
      expect(result).toBeNull();
    });

    it('should return null on network error without failing', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onerror }) => {
        onerror(new Error('Network failure'));
      });

      // Should not throw, just return null
      const result = await wealthsimpleApi.fetchInternalTransfer('funding_intent-abc123');
      expect(result).toBeNull();
    });

    it('should handle internal transfer without annotation', async () => {
      const mockResponse = {
        internalTransfer: {
          id: 'funding_intent-no-annotation',
          amount: '100.00',
          currency: 'CAD',
          status: 'completed',
          annotation: null,
          reason: null,
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchInternalTransfer('funding_intent-no-annotation');

      expect(result).not.toBeNull();
      expect(result.annotation).toBeNull();
    });
  });

  describe('fetchFundsTransfer', () => {
    beforeEach(() => {
      const futureDate = new Date(Date.now() + 3600000).toISOString();
      GM_getValue.mockImplementation((key) => {
        if (key === STORAGE.WEALTHSIMPLE_ACCESS_TOKEN) return 'test-token';
        if (key === STORAGE.WEALTHSIMPLE_IDENTITY_ID) return 'identity-123';
        if (key === STORAGE.WEALTHSIMPLE_TOKEN_EXPIRES_AT) return futureDate;
        return null;
      });
    });

    it('should return null for null input', async () => {
      const result = await wealthsimpleApi.fetchFundsTransfer(null);
      expect(result).toBeNull();
      expect(GM_xmlhttpRequest).not.toHaveBeenCalled();
    });

    it('should return null for empty string input', async () => {
      const result = await wealthsimpleApi.fetchFundsTransfer('');
      expect(result).toBeNull();
      expect(GM_xmlhttpRequest).not.toHaveBeenCalled();
    });

    it('should fetch funds transfer details successfully', async () => {
      const mockResponse = {
        fundsTransfer: {
          id: 'funding_intent-OJbdrSdcFlCIPm3hagqmOM0sNhV',
          status: 'accepted',
          cancellable: false,
          annotation: null,
          rejectReason: null,
          schedule: null,
          destination: {
            bankAccount: {
              id: 'bank_account-2csO3N2RLuYwBZ6JIs8MHWH6bM',
              accountName: 'Tax Stash',
              corporate: false,
              createdAt: '2024-09-12T05:03:03.753780Z',
              currency: 'CAD',
              institutionName: 'EQ Bank',
              jurisdiction: 'CA',
              nickname: 'Tax Stash',
              type: 'savings',
              updatedAt: '2024-09-12T05:03:03.753780Z',
              accountNumber: '****6297',
              __typename: 'CaBankAccount',
            },
            __typename: 'BankAccountOwner',
          },
          reason: null,
          tax_detail: null,
          __typename: 'Withdrawal',
          source: {
            id: 'ca-cash-msb-iusfagkx',
            nickname: '💳 Cash',
            currency: 'CAD',
            status: 'open',
            type: 'ca_cash_msb',
            __typename: 'Account',
          },
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchFundsTransfer('funding_intent-OJbdrSdcFlCIPm3hagqmOM0sNhV');

      expect(result).not.toBeNull();
      expect(result.id).toBe('funding_intent-OJbdrSdcFlCIPm3hagqmOM0sNhV');
      expect(result.status).toBe('accepted');
      expect(result.destination.bankAccount.institutionName).toBe('EQ Bank');
      expect(result.destination.bankAccount.nickname).toBe('Tax Stash');
      expect(result.destination.bankAccount.accountNumber).toBe('****6297');
      expect(result.destination.bankAccount.currency).toBe('CAD');
      expect(result.source.nickname).toBe('💳 Cash');
    });

    it('should NOT inject identity ID into request', async () => {
      const mockResponse = {
        fundsTransfer: {
          id: 'funding_intent-test123',
          status: 'accepted',
          annotation: 'test annotation',
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ data, onload }) => {
        const parsedData = JSON.parse(data);
        expect(parsedData.operationName).toBe('FetchFundsTransfer');
        // FetchFundsTransfer should NOT have identityId injected
        expect(parsedData.variables.identityId).toBeUndefined();
        expect(parsedData.variables.id).toBe('funding_intent-test123');

        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      await wealthsimpleApi.fetchFundsTransfer('funding_intent-test123');
    });

    it('should return null when no fundsTransfer in response', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: {} }),
        });
      });

      const result = await wealthsimpleApi.fetchFundsTransfer('funding_intent-abc123');
      expect(result).toBeNull();
    });

    it('should return null on API error without failing', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({ status: 500 });
      });

      // Should not throw, just return null
      const result = await wealthsimpleApi.fetchFundsTransfer('funding_intent-abc123');
      expect(result).toBeNull();
    });

    it('should return null on network error without failing', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onerror }) => {
        onerror(new Error('Network failure'));
      });

      // Should not throw, just return null
      const result = await wealthsimpleApi.fetchFundsTransfer('funding_intent-abc123');
      expect(result).toBeNull();
    });

    it('should handle funds transfer with annotation', async () => {
      const mockResponse = {
        fundsTransfer: {
          id: 'funding_intent-with-annotation',
          status: 'accepted',
          cancellable: false,
          annotation: 'Monthly savings transfer',
          rejectReason: null,
          destination: {
            bankAccount: {
              id: 'bank_account-xyz',
              institutionName: 'TD Bank',
              nickname: 'Savings',
              accountNumber: '****1234',
              currency: 'CAD',
            },
          },
          source: {
            id: 'ca-cash-account',
            nickname: 'Cash',
          },
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchFundsTransfer('funding_intent-with-annotation');

      expect(result).not.toBeNull();
      expect(result.annotation).toBe('Monthly savings transfer');
    });

    it('should handle funds transfer without destination bank account', async () => {
      const mockResponse = {
        fundsTransfer: {
          id: 'funding_intent-no-dest-bank',
          status: 'accepted',
          annotation: null,
          destination: {
            bankAccount: null,
            __typename: 'BankAccountOwner',
          },
          source: {
            id: 'ca-cash-account',
            nickname: 'Cash',
          },
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchFundsTransfer('funding_intent-no-dest-bank');

      expect(result).not.toBeNull();
      expect(result.destination.bankAccount).toBeNull();
    });

    it('should handle deposit type funds transfer (source has bank account)', async () => {
      const mockResponse = {
        fundsTransfer: {
          id: 'funding_intent-deposit',
          status: 'accepted',
          cancellable: false,
          annotation: null,
          rejectReason: null,
          source: {
            bankAccount: {
              id: 'bank_account-source',
              institutionName: 'RBC',
              nickname: 'Chequing',
              accountNumber: '****5678',
              currency: 'CAD',
            },
          },
          destination: {
            id: 'ca-cash-dest',
            nickname: 'Wealthsimple Cash',
          },
          __typename: 'Deposit',
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchFundsTransfer('funding_intent-deposit');

      expect(result).not.toBeNull();
      expect(result.source.bankAccount.institutionName).toBe('RBC');
      expect(result.source.bankAccount.accountNumber).toBe('****5678');
    });

    it('should return full object with all fields for future use', async () => {
      const mockResponse = {
        fundsTransfer: {
          id: 'funding_intent-full',
          status: 'accepted',
          cancellable: false,
          annotation: 'Test annotation',
          rejectReason: null,
          schedule: {
            id: 'schedule-123',
            is_skippable: true,
            recurrence: {
              events: ['2026-01-15', '2026-02-15', '2026-03-15'],
            },
          },
          destination: {
            bankAccount: {
              id: 'bank_account-full',
              accountName: 'Full Account',
              corporate: false,
              createdAt: '2024-01-01T00:00:00.000000Z',
              currency: 'CAD',
              institutionName: 'Test Bank',
              jurisdiction: 'CA',
              nickname: 'Full Nickname',
              type: 'chequing',
              updatedAt: '2024-06-01T00:00:00.000000Z',
              verificationDocuments: [],
              verifications: [],
              accountNumber: '****9999',
              __typename: 'CaBankAccount',
            },
            __typename: 'BankAccountOwner',
          },
          reason: 'planned_expense',
          tax_detail: null,
          __typename: 'Withdrawal',
          source: {
            id: 'ca-cash-full',
            archivedAt: null,
            branch: 'WS',
            closedAt: null,
            createdAt: '2021-07-12T21:35:38.853909Z',
            currency: 'CAD',
            nickname: 'Full Cash',
            status: 'open',
            type: 'ca_cash_msb',
            __typename: 'Account',
          },
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchFundsTransfer('funding_intent-full');

      expect(result).not.toBeNull();
      // Verify the full object is returned for future use
      expect(result.schedule).not.toBeNull();
      expect(result.schedule.id).toBe('schedule-123');
      expect(result.schedule.recurrence.events).toHaveLength(3);
      expect(result.destination.bankAccount.verificationDocuments).toEqual([]);
      expect(result.reason).toBe('planned_expense');
      expect(result.source.branch).toBe('WS');
    });
  });

  describe('fetchShortOptionPositionExpiryDetail', () => {
    beforeEach(() => {
      const futureDate = new Date(Date.now() + 3600000).toISOString();
      GM_getValue.mockImplementation((key) => {
        if (key === STORAGE.WEALTHSIMPLE_ACCESS_TOKEN) return 'test-token';
        if (key === STORAGE.WEALTHSIMPLE_IDENTITY_ID) return 'identity-123';
        if (key === STORAGE.WEALTHSIMPLE_TOKEN_EXPIRES_AT) return futureDate;
        return null;
      });
    });

    it('should return null for null input', async () => {
      const result = await wealthsimpleApi.fetchShortOptionPositionExpiryDetail(null);
      expect(result).toBeNull();
      expect(GM_xmlhttpRequest).not.toHaveBeenCalled();
    });

    it('should return null for empty string input', async () => {
      const result = await wealthsimpleApi.fetchShortOptionPositionExpiryDetail('');
      expect(result).toBeNull();
      expect(GM_xmlhttpRequest).not.toHaveBeenCalled();
    });

    it('should fetch short option position expiry detail successfully', async () => {
      const mockResponse = {
        shortOptionPositionExpiryDetail: {
          id: 'oe-c8861ccc2c9905f176b8946b5bedfaae4b0b2cde',
          decision: 'EXPIRE',
          reason: 'EXPIRE',
          fxRate: '1.3531',
          custodianAccountId: 'H10739748CAD',
          deliverables: [
            {
              quantity: '3.3333',
              securityId: 'sec-s-555ffa9de9ad47d2925dda6a2032c225',
              __typename: 'Deliverable',
            },
          ],
          securityCurrency: 'USD',
          __typename: 'ShortPositionExpiryDetail',
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchShortOptionPositionExpiryDetail('oe-c8861ccc2c9905f176b8946b5bedfaae4b0b2cde');

      expect(result).not.toBeNull();
      expect(result.id).toBe('oe-c8861ccc2c9905f176b8946b5bedfaae4b0b2cde');
      expect(result.decision).toBe('EXPIRE');
      expect(result.reason).toBe('EXPIRE');
      expect(result.fxRate).toBe('1.3531');
      expect(result.custodianAccountId).toBe('H10739748CAD');
      expect(result.securityCurrency).toBe('USD');
      expect(result.deliverables).toHaveLength(1);
      expect(result.deliverables[0].quantity).toBe('3.3333');
      expect(result.deliverables[0].securityId).toBe('sec-s-555ffa9de9ad47d2925dda6a2032c225');
    });

    it('should pass correct ID in GraphQL query', async () => {
      const mockResponse = {
        shortOptionPositionExpiryDetail: {
          id: 'oe-test123',
          decision: 'ASSIGN',
          reason: 'ASSIGN',
          fxRate: '1.0000',
          custodianAccountId: 'H12345678CAD',
          deliverables: [],
          securityCurrency: 'CAD',
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ data, onload }) => {
        const parsedData = JSON.parse(data);
        expect(parsedData.operationName).toBe('FetchShortOptionPositionExpiryDetail');
        expect(parsedData.variables.id).toBe('oe-test123');

        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      await wealthsimpleApi.fetchShortOptionPositionExpiryDetail('oe-test123');
    });

    it('should return null when no shortOptionPositionExpiryDetail in response', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: {} }),
        });
      });

      const result = await wealthsimpleApi.fetchShortOptionPositionExpiryDetail('oe-abc123');
      expect(result).toBeNull();
    });

    it('should return null on API error without failing', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({ status: 500 });
      });

      // Should not throw, just return null
      const result = await wealthsimpleApi.fetchShortOptionPositionExpiryDetail('oe-abc123');
      expect(result).toBeNull();
    });

    it('should return null on network error without failing', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onerror }) => {
        onerror(new Error('Network failure'));
      });

      // Should not throw, just return null
      const result = await wealthsimpleApi.fetchShortOptionPositionExpiryDetail('oe-abc123');
      expect(result).toBeNull();
    });

    it('should handle expiry detail with empty deliverables array', async () => {
      const mockResponse = {
        shortOptionPositionExpiryDetail: {
          id: 'oe-empty-deliverables',
          decision: 'EXPIRE',
          reason: 'OUT_OF_THE_MONEY',
          fxRate: '1.4000',
          custodianAccountId: 'H98765432CAD',
          deliverables: [],
          securityCurrency: 'USD',
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchShortOptionPositionExpiryDetail('oe-empty-deliverables');

      expect(result).not.toBeNull();
      expect(result.deliverables).toEqual([]);
    });

    it('should handle expiry detail with multiple deliverables', async () => {
      const mockResponse = {
        shortOptionPositionExpiryDetail: {
          id: 'oe-multi-deliverables',
          decision: 'ASSIGN',
          reason: 'ASSIGN',
          fxRate: '1.3500',
          custodianAccountId: 'H11111111CAD',
          deliverables: [
            {
              quantity: '100.0000',
              securityId: 'sec-s-aaaa',
              __typename: 'Deliverable',
            },
            {
              quantity: '50.0000',
              securityId: 'sec-s-bbbb',
              __typename: 'Deliverable',
            },
          ],
          securityCurrency: 'USD',
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchShortOptionPositionExpiryDetail('oe-multi-deliverables');

      expect(result).not.toBeNull();
      expect(result.deliverables).toHaveLength(2);
      expect(result.deliverables[0].quantity).toBe('100.0000');
      expect(result.deliverables[1].quantity).toBe('50.0000');
    });

    it('should handle expiry detail with null fxRate (same currency)', async () => {
      const mockResponse = {
        shortOptionPositionExpiryDetail: {
          id: 'oe-cad-currency',
          decision: 'EXPIRE',
          reason: 'EXPIRE',
          fxRate: null,
          custodianAccountId: 'H22222222CAD',
          deliverables: [],
          securityCurrency: 'CAD',
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchShortOptionPositionExpiryDetail('oe-cad-currency');

      expect(result).not.toBeNull();
      expect(result.fxRate).toBeNull();
      expect(result.securityCurrency).toBe('CAD');
    });

    it('should handle GraphQL errors', async () => {
      const errorResponse = {
        errors: [
          { message: 'Short option position expiry detail not found' },
        ],
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify(errorResponse),
        });
      });

      // Should return null on GraphQL error (graceful failure)
      const result = await wealthsimpleApi.fetchShortOptionPositionExpiryDetail('oe-not-found');
      expect(result).toBeNull();
    });
  });

  describe('fetchManagedPortfolioPositions', () => {
    beforeEach(() => {
      const futureDate = new Date(Date.now() + 3600000).toISOString();
      GM_getValue.mockImplementation((key) => {
        if (key === STORAGE.WEALTHSIMPLE_ACCESS_TOKEN) return 'test-token';
        if (key === STORAGE.WEALTHSIMPLE_IDENTITY_ID) return 'identity-123';
        if (key === STORAGE.WEALTHSIMPLE_TOKEN_EXPIRES_AT) return futureDate;
        return null;
      });
    });

    it('should require accountId parameter', async () => {
      await expect(
        wealthsimpleApi.fetchManagedPortfolioPositions(null),
      ).rejects.toThrow('Account ID is required');

      await expect(
        wealthsimpleApi.fetchManagedPortfolioPositions(''),
      ).rejects.toThrow('Account ID is required');
    });

    it('should fetch managed portfolio positions successfully', async () => {
      const mockResponse = {
        account: {
          id: 'resp-gjp2y-3a',
          positions: [
            { id: 'pos-1', symbol: 'CAD', quantity: '354.18', type: 'currency', name: 'CAD', value: '354.18' },
            { id: 'pos-2', symbol: 'EEMV', quantity: '57.3763', type: 'exchange_traded_fund', name: 'iShares ETF', value: '5284.35' },
          ],
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({ status: 200, responseText: JSON.stringify({ data: mockResponse }) });
      });

      const result = await wealthsimpleApi.fetchManagedPortfolioPositions('resp-gjp2y-3a');

      expect(result).toHaveLength(2);
      expect(result[0].symbol).toBe('CAD');
      expect(result[0].quantity).toBe('354.18');
      expect(result[1].symbol).toBe('EEMV');
    });

    it('should return empty array when no positions', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({ status: 200, responseText: JSON.stringify({ data: { account: { positions: [] } } }) });
      });

      const result = await wealthsimpleApi.fetchManagedPortfolioPositions('test-account');
      expect(result).toEqual([]);
    });

    it('should return empty array when no account in response', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({ status: 200, responseText: JSON.stringify({ data: {} }) });
      });

      const result = await wealthsimpleApi.fetchManagedPortfolioPositions('test-account');
      expect(result).toEqual([]);
    });
  });

  describe('fetchActivityByOrdersServiceOrderId', () => {
    beforeEach(() => {
      const futureDate = new Date(Date.now() + 3600000).toISOString();
      GM_getValue.mockImplementation((key) => {
        if (key === STORAGE.WEALTHSIMPLE_ACCESS_TOKEN) return 'test-token';
        if (key === STORAGE.WEALTHSIMPLE_IDENTITY_ID) return 'identity-123';
        if (key === STORAGE.WEALTHSIMPLE_TOKEN_EXPIRES_AT) return futureDate;
        return null;
      });
    });

    it('should return null for null accountId', async () => {
      const result = await wealthsimpleApi.fetchActivityByOrdersServiceOrderId(null, 'order-123');
      expect(result).toBeNull();
      expect(GM_xmlhttpRequest).not.toHaveBeenCalled();
    });

    it('should return null for null ordersServiceOrderId', async () => {
      const result = await wealthsimpleApi.fetchActivityByOrdersServiceOrderId('resp-gjp2y-3a', null);
      expect(result).toBeNull();
      expect(GM_xmlhttpRequest).not.toHaveBeenCalled();
    });

    it('should return null for empty accountId', async () => {
      const result = await wealthsimpleApi.fetchActivityByOrdersServiceOrderId('', 'order-123');
      expect(result).toBeNull();
      expect(GM_xmlhttpRequest).not.toHaveBeenCalled();
    });

    it('should return null for empty ordersServiceOrderId', async () => {
      const result = await wealthsimpleApi.fetchActivityByOrdersServiceOrderId('resp-gjp2y-3a', '');
      expect(result).toBeNull();
      expect(GM_xmlhttpRequest).not.toHaveBeenCalled();
    });

    it('should fetch activity by orders service order ID successfully', async () => {
      const mockResponse = {
        account: {
          id: 'resp-gjp2y-3a',
          activityByOrdersServiceOrderId: {
            id: 'custodian_account_activity-6cjmdMiO9VzGoLt_l8pKqGcvdxU',
            quantity: '0.8257',
            fxRate: '1.0',
            marketPrice: {
              amount: '11.165',
              currency: 'CAD',
              __typename: 'Amount',
            },
            __typename: 'PaginatedActivity',
          },
          __typename: 'Account',
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchActivityByOrdersServiceOrderId('resp-gjp2y-3a', 'order-00YDx9aoiwh1');

      expect(result).not.toBeNull();
      expect(result.id).toBe('custodian_account_activity-6cjmdMiO9VzGoLt_l8pKqGcvdxU');
      expect(result.quantity).toBe('0.8257');
      expect(result.fxRate).toBe('1.0');
      expect(result.marketPrice.amount).toBe('11.165');
      expect(result.marketPrice.currency).toBe('CAD');
    });

    it('should pass correct variables in GraphQL query', async () => {
      const mockResponse = {
        account: {
          id: 'test-account-id',
          activityByOrdersServiceOrderId: {
            id: 'activity-123',
            quantity: '1.0',
            fxRate: '1.35',
            marketPrice: { amount: '50.00', currency: 'USD' },
          },
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ data, onload }) => {
        const parsedData = JSON.parse(data);
        expect(parsedData.operationName).toBe('FetchActivityByOrdersServiceOrderId');
        expect(parsedData.variables.id).toBe('test-account-id');
        expect(parsedData.variables.ordersServiceOrderId).toBe('order-test123');
        // FetchActivityByOrdersServiceOrderId should NOT have identityId injected
        expect(parsedData.variables.identityId).toBeUndefined();

        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      await wealthsimpleApi.fetchActivityByOrdersServiceOrderId('test-account-id', 'order-test123');
    });

    it('should return null when no account in response', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: {} }),
        });
      });

      const result = await wealthsimpleApi.fetchActivityByOrdersServiceOrderId('resp-gjp2y-3a', 'order-123');
      expect(result).toBeNull();
    });

    it('should return null when no activityByOrdersServiceOrderId in response', async () => {
      const mockResponse = {
        account: {
          id: 'resp-gjp2y-3a',
          activityByOrdersServiceOrderId: null,
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchActivityByOrdersServiceOrderId('resp-gjp2y-3a', 'order-not-found');
      expect(result).toBeNull();
    });

    it('should return null on API error without failing', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({ status: 500 });
      });

      // Should not throw, just return null
      const result = await wealthsimpleApi.fetchActivityByOrdersServiceOrderId('resp-gjp2y-3a', 'order-error');
      expect(result).toBeNull();
    });

    it('should return null on network error without failing', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onerror }) => {
        onerror(new Error('Network failure'));
      });

      // Should not throw, just return null
      const result = await wealthsimpleApi.fetchActivityByOrdersServiceOrderId('resp-gjp2y-3a', 'order-network-error');
      expect(result).toBeNull();
    });

    it('should handle activity with different FX rate', async () => {
      const mockResponse = {
        account: {
          id: 'rrsp-abc123',
          activityByOrdersServiceOrderId: {
            id: 'activity-fx',
            quantity: '5.5',
            fxRate: '1.3567',
            marketPrice: {
              amount: '100.50',
              currency: 'USD',
            },
          },
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchActivityByOrdersServiceOrderId('rrsp-abc123', 'order-fx-test');

      expect(result).not.toBeNull();
      expect(result.fxRate).toBe('1.3567');
      expect(result.marketPrice.currency).toBe('USD');
    });
  });

  describe('fetchExtendedOrder', () => {
    beforeEach(() => {
      const futureDate = new Date(Date.now() + 3600000).toISOString();
      GM_getValue.mockImplementation((key) => {
        if (key === STORAGE.WEALTHSIMPLE_ACCESS_TOKEN) return 'test-token';
        if (key === STORAGE.WEALTHSIMPLE_IDENTITY_ID) return 'identity-123';
        if (key === STORAGE.WEALTHSIMPLE_TOKEN_EXPIRES_AT) return futureDate;
        return null;
      });
    });

    it('should return null for null externalId', async () => {
      const result = await wealthsimpleApi.fetchExtendedOrder(null);
      expect(result).toBeNull();
      expect(GM_xmlhttpRequest).not.toHaveBeenCalled();
    });

    it('should return null for empty externalId', async () => {
      const result = await wealthsimpleApi.fetchExtendedOrder('');
      expect(result).toBeNull();
      expect(GM_xmlhttpRequest).not.toHaveBeenCalled();
    });

    it('should fetch extended order for stock order successfully', async () => {
      const mockResponse = {
        soOrdersExtendedOrder: {
          averageFilledPrice: '620.9154',
          filledExchangeRate: '1.000000',
          filledQuantity: '11.6131',
          filledCommissionFee: null,
          filledTotalFee: '0.00',
          firstFilledAtUtc: '2025-11-04T14:40:29.233Z',
          lastFilledAtUtc: '2025-11-04T14:40:29.233Z',
          limitPrice: null,
          openClose: null,
          orderType: 'BUY_VALUE',
          optionMultiplier: null,
          rejectionCause: null,
          rejectionCode: null,
          securityCurrency: 'USD',
          status: 'posted',
          stopPrice: null,
          submittedAtUtc: '2025-11-04T14:40:28.998Z',
          submittedExchangeRate: '1.000000',
          submittedNetValue: '7211.02',
          submittedQuantity: '11.6131',
          submittedTotalFee: '0.00',
          timeInForce: 'DAY',
          accountId: 'H10739748CAD',
          canonicalAccountId: 'rrsp-qthtmh-s',
          cancellationCutoff: null,
          tradingSession: 'REGULAR',
          expiredAtUtc: '2025-11-04T21:00:00.000Z',
          __typename: 'SoOrders_ExtendedOrderResponse',
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchExtendedOrder('order-3f73016b-5af3-4f03-ba22-9ef5e45fbb3d');

      expect(result).not.toBeNull();
      expect(result.averageFilledPrice).toBe('620.9154');
      expect(result.filledQuantity).toBe('11.6131');
      expect(result.orderType).toBe('BUY_VALUE');
      expect(result.status).toBe('posted');
      expect(result.securityCurrency).toBe('USD');
      expect(result.timeInForce).toBe('DAY');
      expect(result.tradingSession).toBe('REGULAR');
      expect(result.optionMultiplier).toBeNull();
      expect(result.openClose).toBeNull();
    });

    it('should fetch extended order for options order successfully', async () => {
      const mockResponse = {
        soOrdersExtendedOrder: {
          averageFilledPrice: '0.0600',
          filledExchangeRate: '1.000000',
          filledQuantity: '9.0000',
          filledCommissionFee: '0.00',
          filledTotalFee: '0.00',
          firstFilledAtUtc: '2025-11-12T15:36:10.201Z',
          lastFilledAtUtc: '2025-11-12T15:36:10.201Z',
          limitPrice: '0.0600',
          openClose: 'OPEN',
          orderType: 'SELL_QUANTITY',
          optionMultiplier: '100.00',
          rejectionCause: null,
          rejectionCode: null,
          securityCurrency: 'USD',
          status: 'posted',
          stopPrice: null,
          submittedAtUtc: '2025-11-12T15:30:30.080Z',
          submittedExchangeRate: '1.000000',
          submittedNetValue: '54.00',
          submittedQuantity: '9.0000',
          submittedTotalFee: '0.00',
          timeInForce: 'DAY',
          accountId: 'H10739748CAD',
          canonicalAccountId: 'rrsp-qthtmh-s',
          cancellationCutoff: null,
          tradingSession: 'REGULAR',
          expiredAtUtc: '2025-11-12T21:00:00.000Z',
          __typename: 'SoOrders_ExtendedOrderResponse',
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchExtendedOrder('order-options-123');

      expect(result).not.toBeNull();
      expect(result.averageFilledPrice).toBe('0.0600');
      expect(result.filledQuantity).toBe('9.0000');
      expect(result.orderType).toBe('SELL_QUANTITY');
      expect(result.openClose).toBe('OPEN');
      expect(result.optionMultiplier).toBe('100.00');
      expect(result.limitPrice).toBe('0.0600');
    });

    it('should NOT inject identityId into request', async () => {
      const mockResponse = {
        soOrdersExtendedOrder: {
          status: 'posted',
          orderType: 'BUY_VALUE',
          __typename: 'SoOrders_ExtendedOrderResponse',
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ data, onload }) => {
        const parsedData = JSON.parse(data);
        expect(parsedData.operationName).toBe('FetchSoOrdersExtendedOrder');
        // FetchSoOrdersExtendedOrder should NOT have identityId injected
        expect(parsedData.variables.identityId).toBeUndefined();
        expect(parsedData.variables.branchId).toBe('TR');
        expect(parsedData.variables.externalId).toBe('order-test123');

        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      await wealthsimpleApi.fetchExtendedOrder('order-test123');
    });

    it('should return null when no soOrdersExtendedOrder in response', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: {} }),
        });
      });

      const result = await wealthsimpleApi.fetchExtendedOrder('order-not-found');
      expect(result).toBeNull();
    });

    it('should return null on API error without failing', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({ status: 500 });
      });

      // Should not throw, just return null
      const result = await wealthsimpleApi.fetchExtendedOrder('order-error');
      expect(result).toBeNull();
    });

    it('should return null on network error without failing', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onerror }) => {
        onerror(new Error('Network failure'));
      });

      // Should not throw, just return null
      const result = await wealthsimpleApi.fetchExtendedOrder('order-network-error');
      expect(result).toBeNull();
    });

    it('should handle order with rejection details', async () => {
      const mockResponse = {
        soOrdersExtendedOrder: {
          averageFilledPrice: null,
          filledExchangeRate: null,
          filledQuantity: '0.0000',
          filledCommissionFee: null,
          filledTotalFee: null,
          firstFilledAtUtc: null,
          lastFilledAtUtc: null,
          limitPrice: '100.00',
          openClose: null,
          orderType: 'BUY_QUANTITY',
          optionMultiplier: null,
          rejectionCause: 'insufficient_funds',
          rejectionCode: 'INS_FUNDS',
          securityCurrency: 'USD',
          status: 'rejected',
          stopPrice: null,
          submittedAtUtc: '2025-11-04T14:40:28.998Z',
          submittedExchangeRate: '1.000000',
          submittedNetValue: '1000.00',
          submittedQuantity: '10.0000',
          submittedTotalFee: '0.00',
          timeInForce: 'DAY',
          accountId: 'H10739748CAD',
          canonicalAccountId: 'rrsp-qthtmh-s',
          cancellationCutoff: null,
          tradingSession: 'REGULAR',
          expiredAtUtc: '2025-11-04T21:00:00.000Z',
          __typename: 'SoOrders_ExtendedOrderResponse',
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchExtendedOrder('order-rejected');

      expect(result).not.toBeNull();
      expect(result.status).toBe('rejected');
      expect(result.rejectionCause).toBe('insufficient_funds');
      expect(result.rejectionCode).toBe('INS_FUNDS');
      expect(result.filledQuantity).toBe('0.0000');
    });

    it('should handle pending order', async () => {
      const mockResponse = {
        soOrdersExtendedOrder: {
          averageFilledPrice: null,
          filledExchangeRate: null,
          filledQuantity: '0.0000',
          filledCommissionFee: null,
          filledTotalFee: null,
          firstFilledAtUtc: null,
          lastFilledAtUtc: null,
          limitPrice: '500.00',
          openClose: null,
          orderType: 'BUY_QUANTITY',
          optionMultiplier: null,
          rejectionCause: null,
          rejectionCode: null,
          securityCurrency: 'USD',
          status: 'pending',
          stopPrice: '490.00',
          submittedAtUtc: '2025-11-04T14:40:28.998Z',
          submittedExchangeRate: '1.000000',
          submittedNetValue: '5000.00',
          submittedQuantity: '10.0000',
          submittedTotalFee: '0.00',
          timeInForce: 'GTC',
          accountId: 'H10739748CAD',
          canonicalAccountId: 'rrsp-qthtmh-s',
          cancellationCutoff: '2025-11-04T20:00:00.000Z',
          tradingSession: 'REGULAR',
          expiredAtUtc: null,
          __typename: 'SoOrders_ExtendedOrderResponse',
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchExtendedOrder('order-pending');

      expect(result).not.toBeNull();
      expect(result.status).toBe('pending');
      expect(result.stopPrice).toBe('490.00');
      expect(result.timeInForce).toBe('GTC');
      expect(result.cancellationCutoff).toBe('2025-11-04T20:00:00.000Z');
      expect(result.expiredAtUtc).toBeNull();
    });
  });
});
