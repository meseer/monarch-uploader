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
});
