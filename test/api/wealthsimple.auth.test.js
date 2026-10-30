/**
 * Tests for Wealthsimple API Client - Queries & Accounts
 *
 * Covers: makeGraphQLQuery, fetchAccounts, fetchAccountBalances.
 * Reading the token from the OAuth cookie (checkAuth, setupTokenMonitoring,
 * the 401 handling) is covered in wealthsimple.authCookie.test.js.
 */

import wealthsimpleApi from '../../src/api/wealthsimple';
import { API } from '../../src/core/config';

import { setupWealthsimpleAuth } from '../helpers/wealthsimpleAuthCookie';

global.GM_getValue = vi.fn();
global.GM_setValue = vi.fn();
global.GM_deleteValue = vi.fn();
global.GM_xmlhttpRequest = vi.fn();

Object.defineProperty(document, 'cookie', {
  writable: true,
  value: '',
});

vi.mock('../../src/core/state', () => ({
  default: {
    setWealthsimpleAuth: vi.fn(),
  },
}));

describe('Wealthsimple API Client - Queries & Accounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.cookie = '';
    vi.clearAllTimers();
  });

  describe('makeGraphQLQuery', () => {
    it('should make successful GraphQL request', async () => {
      const futureDate = new Date(Date.now() + 3600000).toISOString();
      setupWealthsimpleAuth({
        accessToken: 'test-token',
        identityId: 'identity-123',
        expiresAt: futureDate,
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
      setupWealthsimpleAuth({
        accessToken: 'test-token',
        identityId: 'identity-123',
        expiresAt: futureDate,
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
      setupWealthsimpleAuth({
        accessToken: 'test-token',
        identityId: 'identity-123',
        expiresAt: futureDate,
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
      setupWealthsimpleAuth(null);

      await expect(
        wealthsimpleApi.makeGraphQLQuery('TestQuery', 'query { ... }', {}),
      ).rejects.toThrow('Wealthsimple auth token not found');
    });

    it('should reject with an expired-token error on 401 without touching storage', async () => {
      const futureDate = new Date(Date.now() + 3600000).toISOString();
      setupWealthsimpleAuth({
        accessToken: 'test-token',
        identityId: 'identity-123',
        expiresAt: futureDate,
      });

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({ status: 401 });
      });

      await expect(
        wealthsimpleApi.makeGraphQLQuery('TestQuery', 'query { ... }', {}),
      ).rejects.toThrow('Auth token expired');

      // Nothing is stored, so there is nothing to clear
      expect(GM_setValue).not.toHaveBeenCalled();
      expect(GM_deleteValue).not.toHaveBeenCalled();
    });

    it('should handle GraphQL errors in response', async () => {
      const futureDate = new Date(Date.now() + 3600000).toISOString();
      setupWealthsimpleAuth({
        accessToken: 'test-token',
        identityId: 'identity-123',
        expiresAt: futureDate,
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
      setupWealthsimpleAuth({
        accessToken: 'test-token',
        identityId: 'identity-123',
        expiresAt: futureDate,
      });

      GM_xmlhttpRequest.mockImplementation(({ onerror }) => {
        onerror(new Error('Network failure'));
      });

      await expect(
        wealthsimpleApi.makeGraphQLQuery('TestQuery', 'query { ... }', {}),
      ).rejects.toThrow('Network error');
    });
  });

  describe('fetchAccounts', () => {
    beforeEach(() => {
      const futureDate = new Date(Date.now() + 3600000).toISOString();
      setupWealthsimpleAuth({
        accessToken: 'test-token',
        identityId: 'identity-123',
        expiresAt: futureDate,
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

  describe('fetchAccounts pagination', () => {
    beforeEach(() => {
      const futureDate = new Date(Date.now() + 3600000).toISOString();
      setupWealthsimpleAuth({
        accessToken: 'test-token',
        identityId: 'identity-123',
        expiresAt: futureDate,
      });
    });

    /**
     * Build an open, non-archived account edge node.
     */
    const buildEdge = (id) => ({
      node: {
        id,
        status: 'open',
        archivedAt: null,
        unifiedAccountType: 'CASH',
        type: 'ca_cash',
        nickname: `Account ${id}`,
        currency: 'CAD',
      },
    });

    /**
     * Mock GM_xmlhttpRequest to serve a sequence of accounts pages.
     * Records each request's parsed body on `requests`.
     */
    const mockPages = (pages, requests) => {
      let call = 0;
      GM_xmlhttpRequest.mockImplementation(({ data, onload }) => {
        if (requests) {
          requests.push(JSON.parse(data));
        }
        const page = pages[Math.min(call, pages.length - 1)];
        call += 1;
        onload({
          status: 200,
          responseText: JSON.stringify({
            data: { identity: { id: 'identity-123', accounts: page } },
          }),
        });
      });
    };

    it('should accumulate accounts across multiple pages', async () => {
      mockPages([
        {
          edges: [buildEdge('acc-1'), buildEdge('acc-2')],
          pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
        },
        {
          edges: [buildEdge('acc-3')],
          pageInfo: { hasNextPage: true, endCursor: 'cursor-2' },
        },
        {
          edges: [buildEdge('acc-4')],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      ]);

      const result = await wealthsimpleApi.fetchAccounts();

      expect(result).toHaveLength(4);
      expect(result.map((a) => a.id)).toEqual(['acc-1', 'acc-2', 'acc-3', 'acc-4']);
      expect(GM_xmlhttpRequest).toHaveBeenCalledTimes(3);
    });

    it('should thread the endCursor into the next page request', async () => {
      const requests = [];
      mockPages([
        {
          edges: [buildEdge('acc-1')],
          pageInfo: { hasNextPage: true, endCursor: 'cursor-abc' },
        },
        {
          edges: [buildEdge('acc-2')],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      ], requests);

      await wealthsimpleApi.fetchAccounts();

      expect(requests).toHaveLength(2);
      // First page must not send a cursor
      expect(requests[0].variables.cursor).toBeUndefined();
      // Second page must carry the first page's endCursor
      expect(requests[1].variables.cursor).toBe('cursor-abc');
    });

    it('should stop after one page when hasNextPage is false', async () => {
      mockPages([
        {
          edges: [buildEdge('acc-1')],
          pageInfo: { hasNextPage: false, endCursor: 'cursor-1' },
        },
      ]);

      const result = await wealthsimpleApi.fetchAccounts();

      expect(result).toHaveLength(1);
      expect(GM_xmlhttpRequest).toHaveBeenCalledTimes(1);
    });

    it('should stop after one page when pageInfo is absent', async () => {
      mockPages([
        { edges: [buildEdge('acc-1')] },
      ]);

      const result = await wealthsimpleApi.fetchAccounts();

      expect(result).toHaveLength(1);
      expect(GM_xmlhttpRequest).toHaveBeenCalledTimes(1);
    });

    it('should stop when hasNextPage is true but endCursor is missing', async () => {
      mockPages([
        {
          edges: [buildEdge('acc-1')],
          pageInfo: { hasNextPage: true, endCursor: null },
        },
      ]);

      const result = await wealthsimpleApi.fetchAccounts();

      expect(result).toHaveLength(1);
      expect(GM_xmlhttpRequest).toHaveBeenCalledTimes(1);
    });

    it('should stop when the cursor does not advance', async () => {
      // Page 1 hands out cursor-stuck; page 2 returns the same cursor forever.
      let call = 0;
      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        call += 1;
        onload({
          status: 200,
          responseText: JSON.stringify({
            data: {
              identity: {
                id: 'identity-123',
                accounts: {
                  edges: [buildEdge(`acc-${call}`)],
                  pageInfo: { hasNextPage: true, endCursor: 'cursor-stuck' },
                },
              },
            },
          }),
        });
      });

      const result = await wealthsimpleApi.fetchAccounts();

      // Page 1 requested with no cursor, page 2 with cursor-stuck which then
      // repeats -> loop must break rather than spin forever.
      expect(GM_xmlhttpRequest).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(2);
    });

    it('should cap pagination at the max page limit', async () => {
      // Always advertise another page with a fresh cursor so only the cap stops us.
      let call = 0;
      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        call += 1;
        onload({
          status: 200,
          responseText: JSON.stringify({
            data: {
              identity: {
                id: 'identity-123',
                accounts: {
                  edges: [buildEdge(`acc-${call}`)],
                  pageInfo: { hasNextPage: true, endCursor: `cursor-${call}` },
                },
              },
            },
          }),
        });
      });

      const result = await wealthsimpleApi.fetchAccounts();

      // ACCOUNTS_MAX_PAGES is 20
      expect(GM_xmlhttpRequest).toHaveBeenCalledTimes(20);
      expect(result).toHaveLength(20);
    });

    it('should filter closed and archived accounts across pages', async () => {
      mockPages([
        {
          edges: [
            buildEdge('open-1'),
            {
              node: {
                id: 'closed-1',
                status: 'closed',
                archivedAt: null,
                unifiedAccountType: 'CASH',
                type: 'ca_cash',
                nickname: 'Closed',
                currency: 'CAD',
              },
            },
          ],
          pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
        },
        {
          edges: [
            {
              node: {
                id: 'archived-1',
                status: 'open',
                archivedAt: '2026-01-01T00:00:00Z',
                unifiedAccountType: 'CASH',
                type: 'ca_cash',
                nickname: 'Archived',
                currency: 'CAD',
              },
            },
            buildEdge('open-2'),
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      ]);

      const result = await wealthsimpleApi.fetchAccounts();

      expect(result.map((a) => a.id)).toEqual(['open-1', 'open-2']);
    });

    it('should stop paginating when a later page has no accounts connection', async () => {
      let call = 0;
      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        call += 1;
        const body = call === 1
          ? {
            identity: {
              id: 'identity-123',
              accounts: {
                edges: [buildEdge('acc-1')],
                pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
              },
            },
          }
          : {};
        onload({
          status: 200,
          responseText: JSON.stringify({ data: body }),
        });
      });

      const result = await wealthsimpleApi.fetchAccounts();

      expect(GM_xmlhttpRequest).toHaveBeenCalledTimes(2);
      expect(result.map((a) => a.id)).toEqual(['acc-1']);
    });
  });

  describe('fetchAccountBalances', () => {
    beforeEach(() => {
      const futureDate = new Date(Date.now() + 3600000).toISOString();
      setupWealthsimpleAuth({
        accessToken: 'test-token',
        identityId: 'identity-123',
        expiresAt: futureDate,
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

});
