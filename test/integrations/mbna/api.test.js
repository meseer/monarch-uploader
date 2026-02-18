/**
 * Tests for MBNA API Client
 */

import { createApi } from '../../../src/integrations/mbna/api';

// Sample response matching the real MBNA /accounts/summary endpoint
const SAMPLE_ACCOUNTS_SUMMARY = [
  {
    cardName: 'Amazon.ca Rewards Mastercard®',
    cardNameFr: 'Mastercardᴹᴰ récompenses Amazon.ca',
    accountId: '00240691635',
    endingIn: '4201',
    allowedAccountSummary: true,
    cardNameShort: 'Amazon.ca Rewards',
    cardUrlEn: 'https://www.feeds.td.com/mbna/en_CA/images/secure/card_pictures/MPM613533E.jpg',
    cardNameShortFr: 'Amazon.ca Récompenses',
    cardUrlFr: 'https://www.feeds.td.com/mbna/fr_CA/images/secure/card_pictures/MPM515004F.jpg',
    eligibleForPaperlessOffer: false,
    enrolledForPaperlessStatements: true,
    pchName: 'JOHN DOE',
    accountCurrentSetting: 'ONLINE',
    accountEmail: 'test@example.com',
    allowedStandardEForms: true,
    primaryCardHolder: true,
  },
];

// Sample response matching the real MBNA /current-account endpoint
const SAMPLE_ACCOUNT_RESPONSE = {
  navigationTabs: ['SNAPSHOT', 'STATEMENTS', 'ACCOUNT_SERVICES'],
  accountNumber: '00240691635',
  cardSummary: {
    endingIn: '4201',
    cardArtInfos: [
      {
        language: 'en',
        cardName: 'Amazon.ca Rewards Mastercard®',
        cardNameShort: 'Amazon.ca Rewards',
        cardUrl: 'https://www.feeds.td.com/mbna/en_CA/images/secure/card_pictures/MPM613533E.jpg',
        affinityLogoUrl: 'https://www.feeds.td.com/mbna/en_CA/images/secure/affinity_logos/MSL208280E.jpg',
      },
      {
        language: 'fr',
        cardName: 'Mastercardᴹᴰ récompenses Amazon.ca',
        cardNameShort: 'Amazon.ca Récompenses',
        cardUrl: 'https://www.feeds.td.com/mbna/fr_CA/images/secure/card_pictures/MPM515004F.jpg',
        affinityLogoUrl: 'https://www.feeds.td.com/mbna/fr_CA/images/secure/affinity_logos/MSL208285F.jpg',
      },
    ],
    creditAvailable: 29806.88,
    currentBalance: 0.00,
  },
  optedForEmailConfirmation: false,
};

describe('MBNA API Client', () => {
  let api;
  let mockHttpClient;
  let mockAuth;

  function createMockHttpClient(responseOverrides = {}) {
    return {
      request: jest.fn().mockResolvedValue({
        status: 200,
        responseText: JSON.stringify(SAMPLE_ACCOUNT_RESPONSE),
        responseHeaders: '',
        ...responseOverrides,
      }),
    };
  }

  function createMockAuth() {
    return {
      getCredentials: jest.fn().mockReturnValue({ autoManaged: true }),
    };
  }

  beforeEach(() => {
    mockAuth = createMockAuth();
    mockHttpClient = createMockHttpClient();
    api = createApi(mockHttpClient, mockAuth);
  });

  describe('mbnaGet (via getAccountInfo)', () => {
    it('should send standard headers without Cookie (GM_xmlhttpRequest handles cookies)', async () => {
      await api.getAccountInfo();

      const callArgs = mockHttpClient.request.mock.calls[0][0];
      expect(callArgs).toEqual({
        method: 'GET',
        url: 'https://service.mbna.ca/waw/mbna/current-account',
        headers: {
          Accept: 'application/json, text/plain, */*',
          Referer: 'https://service.mbna.ca/waw/mbna/index.html',
          'Sec-Fetch-Dest': 'empty',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Site': 'same-origin',
        },
      });
      expect(callArgs.headers).not.toHaveProperty('Cookie');
    });

    it('should throw on 401 response', async () => {
      mockHttpClient = createMockHttpClient({ status: 401, responseText: '' });
      api = createApi(mockHttpClient, mockAuth);

      await expect(api.getAccountInfo()).rejects.toThrow('MBNA session expired');
    });

    it('should throw on 403 response', async () => {
      mockHttpClient = createMockHttpClient({ status: 403, responseText: '' });
      api = createApi(mockHttpClient, mockAuth);

      await expect(api.getAccountInfo()).rejects.toThrow('MBNA session expired');
    });

    it('should throw on 404 response', async () => {
      mockHttpClient = createMockHttpClient({ status: 404, responseText: '' });
      api = createApi(mockHttpClient, mockAuth);

      await expect(api.getAccountInfo()).rejects.toThrow('MBNA API resource not found');
    });

    it('should throw on 500 response', async () => {
      mockHttpClient = createMockHttpClient({ status: 500, responseText: '' });
      api = createApi(mockHttpClient, mockAuth);

      await expect(api.getAccountInfo()).rejects.toThrow('MBNA server error');
    });

    it('should throw on other HTTP errors', async () => {
      mockHttpClient = createMockHttpClient({ status: 429, responseText: '' });
      api = createApi(mockHttpClient, mockAuth);

      await expect(api.getAccountInfo()).rejects.toThrow('MBNA API error: HTTP 429');
    });

    it('should throw on malformed JSON response', async () => {
      mockHttpClient = createMockHttpClient({ responseText: 'not-json' });
      api = createApi(mockHttpClient, mockAuth);

      await expect(api.getAccountInfo()).rejects.toThrow('Failed to parse MBNA API response');
    });
  });

  describe('getAccountsSummary', () => {
    it('should call the correct endpoint', async () => {
      mockHttpClient = createMockHttpClient({
        responseText: JSON.stringify(SAMPLE_ACCOUNTS_SUMMARY),
      });
      api = createApi(mockHttpClient, mockAuth);

      await api.getAccountsSummary();

      expect(mockHttpClient.request).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://service.mbna.ca/waw/mbna/accounts/summary',
        }),
      );
    });

    it('should parse single account from real response structure', async () => {
      mockHttpClient = createMockHttpClient({
        responseText: JSON.stringify(SAMPLE_ACCOUNTS_SUMMARY),
      });
      api = createApi(mockHttpClient, mockAuth);

      const result = await api.getAccountsSummary();

      expect(result).toHaveLength(1);
      expect(result[0].accountId).toBe('00240691635');
      expect(result[0].endingIn).toBe('4201');
      expect(result[0].cardName).toBe('Amazon.ca Rewards Mastercard®');
      expect(result[0].cardNameShort).toBe('Amazon.ca Rewards');
      expect(result[0].displayName).toBe('Amazon.ca Rewards Mastercard® (4201)');
      expect(result[0].primaryCardHolder).toBe(true);
      expect(result[0].raw).toEqual(SAMPLE_ACCOUNTS_SUMMARY[0]);
    });

    it('should handle multiple accounts', async () => {
      const multipleAccounts = [
        { ...SAMPLE_ACCOUNTS_SUMMARY[0] },
        {
          cardName: 'TD Platinum Mastercard®',
          accountId: '00999999999',
          endingIn: '5678',
          cardNameShort: 'TD Platinum',
          primaryCardHolder: true,
        },
      ];
      mockHttpClient = createMockHttpClient({
        responseText: JSON.stringify(multipleAccounts),
      });
      api = createApi(mockHttpClient, mockAuth);

      const result = await api.getAccountsSummary();

      expect(result).toHaveLength(2);
      expect(result[0].accountId).toBe('00240691635');
      expect(result[1].accountId).toBe('00999999999');
      expect(result[1].displayName).toBe('TD Platinum Mastercard® (5678)');
    });

    it('should handle empty accounts array', async () => {
      mockHttpClient = createMockHttpClient({
        responseText: JSON.stringify([]),
      });
      api = createApi(mockHttpClient, mockAuth);

      const result = await api.getAccountsSummary();

      expect(result).toEqual([]);
    });

    it('should throw on non-array response', async () => {
      mockHttpClient = createMockHttpClient({
        responseText: JSON.stringify({ error: 'not an array' }),
      });
      api = createApi(mockHttpClient, mockAuth);

      await expect(api.getAccountsSummary()).rejects.toThrow('Unexpected MBNA accounts summary format');
    });

    it('should handle missing fields gracefully', async () => {
      mockHttpClient = createMockHttpClient({
        responseText: JSON.stringify([{ accountId: '12345' }]),
      });
      api = createApi(mockHttpClient, mockAuth);

      const result = await api.getAccountsSummary();

      expect(result).toHaveLength(1);
      expect(result[0].accountId).toBe('12345');
      expect(result[0].endingIn).toBeNull();
      expect(result[0].cardName).toBeNull();
      expect(result[0].cardNameShort).toBeNull();
      expect(result[0].displayName).toBeNull();
      expect(result[0].primaryCardHolder).toBe(false);
    });

    it('should fall back to cardName for displayName when endingIn is missing', async () => {
      mockHttpClient = createMockHttpClient({
        responseText: JSON.stringify([{ accountId: '12345', cardName: 'My Card' }]),
      });
      api = createApi(mockHttpClient, mockAuth);

      const result = await api.getAccountsSummary();

      expect(result[0].displayName).toBe('My Card');
    });

    it('should throw on 401 response (session expired)', async () => {
      mockHttpClient = createMockHttpClient({ status: 401, responseText: '' });
      api = createApi(mockHttpClient, mockAuth);

      await expect(api.getAccountsSummary()).rejects.toThrow('MBNA session expired');
    });
  });

  describe('getAccountInfo', () => {
    it('should parse full account info from real response structure', async () => {
      const result = await api.getAccountInfo();

      expect(result.accountId).toBe('00240691635');
      expect(result.endingIn).toBe('4201');
      expect(result.cardName).toBe('Amazon.ca Rewards Mastercard®');
      expect(result.displayName).toBe('Amazon.ca Rewards Mastercard® (4201)');
      expect(result.currentBalance).toBe(0.00);
      expect(result.creditAvailable).toBe(29806.88);
      expect(result.raw).toEqual(SAMPLE_ACCOUNT_RESPONSE);
    });

    it('should extract English card name from cardArtInfos (plural)', async () => {
      const result = await api.getAccountInfo();

      expect(result.cardName).toBe('Amazon.ca Rewards Mastercard®');
    });

    it('should handle missing cardArtInfos', async () => {
      const response = { ...SAMPLE_ACCOUNT_RESPONSE, cardSummary: { endingIn: '1234' } };
      mockHttpClient = createMockHttpClient({ responseText: JSON.stringify(response) });
      api = createApi(mockHttpClient, mockAuth);

      const result = await api.getAccountInfo();

      expect(result.cardName).toBeNull();
      expect(result.endingIn).toBe('1234');
    });

    it('should handle missing English card art info', async () => {
      const response = {
        ...SAMPLE_ACCOUNT_RESPONSE,
        cardSummary: {
          ...SAMPLE_ACCOUNT_RESPONSE.cardSummary,
          cardArtInfos: [{ language: 'fr', cardName: 'French Name' }],
        },
      };
      mockHttpClient = createMockHttpClient({ responseText: JSON.stringify(response) });
      api = createApi(mockHttpClient, mockAuth);

      const result = await api.getAccountInfo();

      expect(result.cardName).toBeNull();
    });

    it('should handle missing cardSummary', async () => {
      const response = { accountNumber: '12345' };
      mockHttpClient = createMockHttpClient({ responseText: JSON.stringify(response) });
      api = createApi(mockHttpClient, mockAuth);

      const result = await api.getAccountInfo();

      expect(result.accountId).toBe('12345');
      expect(result.endingIn).toBeNull();
      expect(result.cardName).toBeNull();
      expect(result.currentBalance).toBeNull();
      expect(result.creditAvailable).toBeNull();
    });

    it('should handle missing accountNumber', async () => {
      const response = { cardSummary: { endingIn: '9999' } };
      mockHttpClient = createMockHttpClient({ responseText: JSON.stringify(response) });
      api = createApi(mockHttpClient, mockAuth);

      const result = await api.getAccountInfo();

      expect(result.accountId).toBeNull();
    });

    it('should construct displayName from cardName and endingIn', async () => {
      const result = await api.getAccountInfo();

      expect(result.displayName).toBe('Amazon.ca Rewards Mastercard® (4201)');
    });

    it('should return null displayName when cardName is missing', async () => {
      const response = { accountNumber: '12345', cardSummary: { endingIn: '1234' } };
      mockHttpClient = createMockHttpClient({ responseText: JSON.stringify(response) });
      api = createApi(mockHttpClient, mockAuth);

      const result = await api.getAccountInfo();

      expect(result.displayName).toBeNull();
    });

    it('should handle zero balance', async () => {
      const result = await api.getAccountInfo();

      expect(result.currentBalance).toBe(0);
    });

    it('should handle non-zero balance', async () => {
      const response = {
        ...SAMPLE_ACCOUNT_RESPONSE,
        cardSummary: { ...SAMPLE_ACCOUNT_RESPONSE.cardSummary, currentBalance: 1523.45 },
      };
      mockHttpClient = createMockHttpClient({ responseText: JSON.stringify(response) });
      api = createApi(mockHttpClient, mockAuth);

      const result = await api.getAccountInfo();

      expect(result.currentBalance).toBe(1523.45);
    });
  });

  describe('getAccountSnapshot', () => {
    it('should call correct URL with account ID', async () => {
      const snapshotResponse = { balance: 100 };
      mockHttpClient = createMockHttpClient({ responseText: JSON.stringify(snapshotResponse) });
      api = createApi(mockHttpClient, mockAuth);

      await api.getAccountSnapshot('00240691635');

      expect(mockHttpClient.request).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://service.mbna.ca/waw/mbna/accounts/00240691635/snapshot',
        }),
      );
    });

    it('should throw when accountId is missing', async () => {
      await expect(api.getAccountSnapshot('')).rejects.toThrow('Account ID is required');
      await expect(api.getAccountSnapshot(null)).rejects.toThrow('Account ID is required');
      await expect(api.getAccountSnapshot(undefined)).rejects.toThrow('Account ID is required');
    });
  });

  describe('getCreditLimit', () => {
    const SAMPLE_SNAPSHOT = {
      accountSnapshotBalances: {
        creditLimit: 29900.00,
        lastStatementBalance: 0.00,
      },
      accountBalances: {
        currentBalance: 93.12,
        creditAvailable: 29806.88,
        minimumPaymentDue: 0,
      },
      accountTransactions: {
        pendingTransactions: [],
        recentTransactions: [],
      },
    };

    it('should extract creditLimit from snapshot response', async () => {
      mockHttpClient = createMockHttpClient({
        responseText: JSON.stringify(SAMPLE_SNAPSHOT),
      });
      api = createApi(mockHttpClient, mockAuth);

      const result = await api.getCreditLimit('00240691635');

      expect(result).toBe(29900.00);
    });

    it('should return null when accountSnapshotBalances is missing', async () => {
      mockHttpClient = createMockHttpClient({
        responseText: JSON.stringify({ accountBalances: { currentBalance: 100 } }),
      });
      api = createApi(mockHttpClient, mockAuth);

      const result = await api.getCreditLimit('00240691635');

      expect(result).toBeNull();
    });

    it('should return null when creditLimit is missing from snapshot', async () => {
      mockHttpClient = createMockHttpClient({
        responseText: JSON.stringify({
          accountSnapshotBalances: { lastStatementBalance: 0 },
        }),
      });
      api = createApi(mockHttpClient, mockAuth);

      const result = await api.getCreditLimit('00240691635');

      expect(result).toBeNull();
    });

    it('should return 0 when credit limit is explicitly 0', async () => {
      mockHttpClient = createMockHttpClient({
        responseText: JSON.stringify({
          accountSnapshotBalances: { creditLimit: 0 },
        }),
      });
      api = createApi(mockHttpClient, mockAuth);

      const result = await api.getCreditLimit('00240691635');

      expect(result).toBe(0);
    });

    it('should call getAccountSnapshot with correct account ID', async () => {
      mockHttpClient = createMockHttpClient({
        responseText: JSON.stringify(SAMPLE_SNAPSHOT),
      });
      api = createApi(mockHttpClient, mockAuth);

      await api.getCreditLimit('00240691635');

      expect(mockHttpClient.request).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://service.mbna.ca/waw/mbna/accounts/00240691635/snapshot',
        }),
      );
    });
  });

  describe('getBalance', () => {
    const SAMPLE_SNAPSHOT = {
      accountSnapshotBalances: {
        creditLimit: 29900.00,
        lastStatementBalance: 0.00,
      },
      accountBalances: {
        currentBalance: 93.12,
        creditAvailable: 29806.88,
        minimumPaymentDue: 0,
      },
    };

    it('should extract all balance fields from snapshot', async () => {
      mockHttpClient = createMockHttpClient({
        responseText: JSON.stringify(SAMPLE_SNAPSHOT),
      });
      api = createApi(mockHttpClient, mockAuth);

      const result = await api.getBalance('00240691635');

      expect(result.currentBalance).toBe(93.12);
      expect(result.creditAvailable).toBe(29806.88);
      expect(result.creditLimit).toBe(29900.00);
      expect(result.currency).toBe('CAD');
      expect(result.raw).toEqual(SAMPLE_SNAPSHOT);
    });

    it('should return null for missing balance fields', async () => {
      mockHttpClient = createMockHttpClient({
        responseText: JSON.stringify({}),
      });
      api = createApi(mockHttpClient, mockAuth);

      const result = await api.getBalance('00240691635');

      expect(result.currentBalance).toBeNull();
      expect(result.creditAvailable).toBeNull();
      expect(result.creditLimit).toBeNull();
      expect(result.currency).toBe('CAD');
    });

    it('should handle zero balances', async () => {
      mockHttpClient = createMockHttpClient({
        responseText: JSON.stringify({
          accountBalances: { currentBalance: 0, creditAvailable: 0 },
          accountSnapshotBalances: { creditLimit: 0 },
        }),
      });
      api = createApi(mockHttpClient, mockAuth);

      const result = await api.getBalance('00240691635');

      expect(result.currentBalance).toBe(0);
      expect(result.creditAvailable).toBe(0);
      expect(result.creditLimit).toBe(0);
    });

    it('should handle partial snapshot (only accountBalances)', async () => {
      mockHttpClient = createMockHttpClient({
        responseText: JSON.stringify({
          accountBalances: { currentBalance: 500.50, creditAvailable: 4499.50 },
        }),
      });
      api = createApi(mockHttpClient, mockAuth);

      const result = await api.getBalance('00240691635');

      expect(result.currentBalance).toBe(500.50);
      expect(result.creditAvailable).toBe(4499.50);
      expect(result.creditLimit).toBeNull();
    });
  });

  describe('getTransactions (stub)', () => {
    it('should return empty array (not yet implemented)', async () => {
      const result = await api.getTransactions('12345', '2024-01-01', '2024-12-31');

      expect(result).toEqual([]);
    });
  });
});