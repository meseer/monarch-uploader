/**
 * Tests for MBNA API Client
 */

import { createApi } from '../../../src/integrations/mbna/source/api';

// Sample response matching the real MBNA /accounts/summary endpoint
const SAMPLE_ACCOUNTS_SUMMARY = [
  {
    cardName: 'Amazon.ca Rewards Mastercard®',
    cardNameFr: 'Mastercardᴹᴰ récompenses Amazon.ca',
    accountId: '00240691635',
    endingIn: '4201',
    allowedAccountSummary: true,
    cardNameShort: 'Amazon.ca Rewards',
    primaryCardHolder: true,
  },
];

// Sample response matching the real MBNA /current-account endpoint
const SAMPLE_ACCOUNT_RESPONSE = {
  accountNumber: '00240691635',
  cardSummary: {
    endingIn: '4201',
    cardArtInfos: [
      { language: 'en', cardName: 'Amazon.ca Rewards Mastercard®', cardNameShort: 'Amazon.ca Rewards' },
      { language: 'fr', cardName: 'Mastercardᴹᴰ récompenses Amazon.ca' },
    ],
    creditAvailable: 29806.88,
    currentBalance: 0.00,
  },
};

// Sample snapshot with transactions
const SAMPLE_SNAPSHOT_WITH_TRANSACTIONS = {
  accountSnapshotBalances: { creditLimit: 29900.00 },
  accountBalances: { currentBalance: 93.12, creditAvailable: 29806.88 },
  accountTransactions: {
    pendingTransactions: [
      { transactionDate: '2026-02-17', description: 'UBER *EATS HELP.UBER.COM ON', referenceNumber: 'TEMP', amount: 25.50, endingIn: '4201' },
    ],
    recentTransactions: [
      { transactionDate: '2026-02-15', description: 'Amazon.ca*RA6HH70U3 TORONTO ON', referenceNumber: '55490535351206796539264', amount: 77.82, endingIn: '4201' },
      { transactionDate: '2026-02-10', description: 'PAYMENT', referenceNumber: '03000306013000455833905', amount: -13.32, endingIn: '4201' },
    ],
  },
};

// Sample closing dates dropdown response
const SAMPLE_CLOSING_DATES_RESPONSE = {
  errorCode: '',
  closingDate: {
    mostRecentTransactions: 'Most recent transactions',
    '2026-01-14': 'January 14, 2026',
    '2025-12-15': 'December 15, 2025',
    '2025-11-14': 'November 14, 2025',
    '2025-10-14': 'October 14, 2025',
    '2025-09-15': 'September 15, 2025',
  },
  status: 'success',
};

// Sample statement response
const SAMPLE_STATEMENT_RESPONSE = {
  statement: {
    statementBalance: 158.41,
    creditLimit: 29900.00,
    minPaymentDue: 10.00,
    minPaymentDueDate: '2026-02-04',
    statementClosingDate: '2026-01-14',
    nextStatementClosingDate: '2026-02-14',
    accountTransactions: [
      { transactionDate: '2025-12-17', description: 'Amazon.ca*RA6HH70U3 TORONTO ON', referenceNumber: '55490535351206796539264', amount: 77.82, endingIn: '4201' },
      { transactionDate: '2025-12-31', description: 'PAYMENT', referenceNumber: '03000305364000552389600', amount: -158.41, endingIn: '4201' },
      { transactionDate: '2026-01-10', description: 'Amazon.ca*JT4Z76HK3 TORONTO ON', referenceNumber: '55490536010202444838043', amount: 13.32, endingIn: '4201' },
    ],
  },
  errorCode: '',
  status: 'success',
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
    return { getCredentials: jest.fn().mockReturnValue({ autoManaged: true }) };
  }

  beforeEach(() => {
    mockAuth = createMockAuth();
    mockHttpClient = createMockHttpClient();
    api = createApi(mockHttpClient, mockAuth);
  });

  describe('mbnaGet (via getAccountInfo)', () => {
    it('should send standard headers without Cookie', async () => {
      await api.getAccountInfo();
      const callArgs = mockHttpClient.request.mock.calls[0][0];
      expect(callArgs.headers).not.toHaveProperty('Cookie');
      expect(callArgs.url).toBe('https://service.mbna.ca/waw/mbna/current-account');
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
      mockHttpClient = createMockHttpClient({ responseText: JSON.stringify(SAMPLE_ACCOUNTS_SUMMARY) });
      api = createApi(mockHttpClient, mockAuth);
      await api.getAccountsSummary();
      expect(mockHttpClient.request).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://service.mbna.ca/waw/mbna/accounts/summary' }),
      );
    });

    it('should parse single account from real response structure', async () => {
      mockHttpClient = createMockHttpClient({ responseText: JSON.stringify(SAMPLE_ACCOUNTS_SUMMARY) });
      api = createApi(mockHttpClient, mockAuth);
      const result = await api.getAccountsSummary();
      expect(result).toHaveLength(1);
      expect(result[0].accountId).toBe('00240691635');
      expect(result[0].endingIn).toBe('4201');
      expect(result[0].displayName).toBe('Amazon.ca Rewards Mastercard® (4201)');
      expect(result[0].primaryCardHolder).toBe(true);
    });

    it('should handle multiple accounts', async () => {
      const multipleAccounts = [
        { ...SAMPLE_ACCOUNTS_SUMMARY[0] },
        { cardName: 'TD Platinum Mastercard®', accountId: '00999999999', endingIn: '5678', primaryCardHolder: true },
      ];
      mockHttpClient = createMockHttpClient({ responseText: JSON.stringify(multipleAccounts) });
      api = createApi(mockHttpClient, mockAuth);
      const result = await api.getAccountsSummary();
      expect(result).toHaveLength(2);
      expect(result[1].displayName).toBe('TD Platinum Mastercard® (5678)');
    });

    it('should handle empty accounts array', async () => {
      mockHttpClient = createMockHttpClient({ responseText: JSON.stringify([]) });
      api = createApi(mockHttpClient, mockAuth);
      const result = await api.getAccountsSummary();
      expect(result).toEqual([]);
    });

    it('should throw on non-array response', async () => {
      mockHttpClient = createMockHttpClient({ responseText: JSON.stringify({ error: 'not an array' }) });
      api = createApi(mockHttpClient, mockAuth);
      await expect(api.getAccountsSummary()).rejects.toThrow('Unexpected MBNA accounts summary format');
    });

    it('should handle missing fields gracefully', async () => {
      mockHttpClient = createMockHttpClient({ responseText: JSON.stringify([{ accountId: '12345' }]) });
      api = createApi(mockHttpClient, mockAuth);
      const result = await api.getAccountsSummary();
      expect(result[0].endingIn).toBeNull();
      expect(result[0].cardName).toBeNull();
      expect(result[0].displayName).toBeNull();
      expect(result[0].primaryCardHolder).toBe(false);
    });

    it('should fall back to cardName for displayName when endingIn is missing', async () => {
      mockHttpClient = createMockHttpClient({ responseText: JSON.stringify([{ accountId: '12345', cardName: 'My Card' }]) });
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
    });

    it('should handle missing cardArtInfos', async () => {
      const response = { ...SAMPLE_ACCOUNT_RESPONSE, cardSummary: { endingIn: '1234' } };
      mockHttpClient = createMockHttpClient({ responseText: JSON.stringify(response) });
      api = createApi(mockHttpClient, mockAuth);
      const result = await api.getAccountInfo();
      expect(result.cardName).toBeNull();
    });

    it('should handle missing English card art info', async () => {
      const response = {
        ...SAMPLE_ACCOUNT_RESPONSE,
        cardSummary: { ...SAMPLE_ACCOUNT_RESPONSE.cardSummary, cardArtInfos: [{ language: 'fr', cardName: 'French' }] },
      };
      mockHttpClient = createMockHttpClient({ responseText: JSON.stringify(response) });
      api = createApi(mockHttpClient, mockAuth);
      const result = await api.getAccountInfo();
      expect(result.cardName).toBeNull();
    });

    it('should handle missing cardSummary', async () => {
      mockHttpClient = createMockHttpClient({ responseText: JSON.stringify({ accountNumber: '12345' }) });
      api = createApi(mockHttpClient, mockAuth);
      const result = await api.getAccountInfo();
      expect(result.accountId).toBe('12345');
      expect(result.endingIn).toBeNull();
      expect(result.currentBalance).toBeNull();
    });

    it('should return null displayName when cardName is missing', async () => {
      mockHttpClient = createMockHttpClient({ responseText: JSON.stringify({ cardSummary: { endingIn: '1234' } }) });
      api = createApi(mockHttpClient, mockAuth);
      const result = await api.getAccountInfo();
      expect(result.displayName).toBeNull();
    });
  });

  describe('getAccountSnapshot', () => {
    it('should call correct URL with account ID', async () => {
      mockHttpClient = createMockHttpClient({ responseText: JSON.stringify({ balance: 100 }) });
      api = createApi(mockHttpClient, mockAuth);
      await api.getAccountSnapshot('00240691635');
      expect(mockHttpClient.request).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://service.mbna.ca/waw/mbna/accounts/00240691635/snapshot' }),
      );
    });

    it('should throw when accountId is missing', async () => {
      await expect(api.getAccountSnapshot('')).rejects.toThrow('Account ID is required');
      await expect(api.getAccountSnapshot(null)).rejects.toThrow('Account ID is required');
    });
  });

  describe('getCreditLimit', () => {
    it('should extract creditLimit from snapshot response', async () => {
      mockHttpClient = createMockHttpClient({
        responseText: JSON.stringify({ accountSnapshotBalances: { creditLimit: 29900.00 } }),
      });
      api = createApi(mockHttpClient, mockAuth);
      expect(await api.getCreditLimit('00240691635')).toBe(29900.00);
    });

    it('should return null when accountSnapshotBalances is missing', async () => {
      mockHttpClient = createMockHttpClient({ responseText: JSON.stringify({}) });
      api = createApi(mockHttpClient, mockAuth);
      expect(await api.getCreditLimit('00240691635')).toBeNull();
    });

    it('should return 0 when credit limit is explicitly 0', async () => {
      mockHttpClient = createMockHttpClient({
        responseText: JSON.stringify({ accountSnapshotBalances: { creditLimit: 0 } }),
      });
      api = createApi(mockHttpClient, mockAuth);
      expect(await api.getCreditLimit('00240691635')).toBe(0);
    });
  });

  describe('getBalance', () => {
    it('should extract all balance fields from snapshot', async () => {
      mockHttpClient = createMockHttpClient({
        responseText: JSON.stringify({
          accountBalances: { currentBalance: 93.12, creditAvailable: 29806.88 },
          accountSnapshotBalances: { creditLimit: 29900.00 },
        }),
      });
      api = createApi(mockHttpClient, mockAuth);
      const result = await api.getBalance('00240691635');
      expect(result.currentBalance).toBe(93.12);
      expect(result.creditAvailable).toBe(29806.88);
      expect(result.creditLimit).toBe(29900.00);
      expect(result.currency).toBe('CAD');
    });

    it('should return null for missing balance fields', async () => {
      mockHttpClient = createMockHttpClient({ responseText: JSON.stringify({}) });
      api = createApi(mockHttpClient, mockAuth);
      const result = await api.getBalance('00240691635');
      expect(result.currentBalance).toBeNull();
      expect(result.creditLimit).toBeNull();
    });
  });

  describe('getCurrentCycleTransactions', () => {
    it('should extract pending and settled transactions from snapshot', async () => {
      mockHttpClient = createMockHttpClient({
        responseText: JSON.stringify(SAMPLE_SNAPSHOT_WITH_TRANSACTIONS),
      });
      api = createApi(mockHttpClient, mockAuth);
      const result = await api.getCurrentCycleTransactions('00240691635');
      expect(result.pending).toHaveLength(1);
      expect(result.settled).toHaveLength(2);
      expect(result.pending[0].referenceNumber).toBe('TEMP');
      expect(result.settled[0].referenceNumber).toBe('55490535351206796539264');
    });

    it('should return empty arrays when no transactions', async () => {
      mockHttpClient = createMockHttpClient({
        responseText: JSON.stringify({ accountTransactions: { pendingTransactions: [], recentTransactions: [] } }),
      });
      api = createApi(mockHttpClient, mockAuth);
      const result = await api.getCurrentCycleTransactions('00240691635');
      expect(result.pending).toEqual([]);
      expect(result.settled).toEqual([]);
    });

    it('should handle missing accountTransactions', async () => {
      mockHttpClient = createMockHttpClient({ responseText: JSON.stringify({}) });
      api = createApi(mockHttpClient, mockAuth);
      const result = await api.getCurrentCycleTransactions('00240691635');
      expect(result.pending).toEqual([]);
      expect(result.settled).toEqual([]);
    });

    it('should handle missing pendingTransactions key', async () => {
      mockHttpClient = createMockHttpClient({
        responseText: JSON.stringify({ accountTransactions: { recentTransactions: [{ referenceNumber: 'abc', amount: 10 }] } }),
      });
      api = createApi(mockHttpClient, mockAuth);
      const result = await api.getCurrentCycleTransactions('00240691635');
      expect(result.pending).toEqual([]);
      expect(result.settled).toHaveLength(1);
    });

    it('should call correct URL (snapshot)', async () => {
      mockHttpClient = createMockHttpClient({ responseText: JSON.stringify(SAMPLE_SNAPSHOT_WITH_TRANSACTIONS) });
      api = createApi(mockHttpClient, mockAuth);
      await api.getCurrentCycleTransactions('00240691635');
      expect(mockHttpClient.request).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://service.mbna.ca/waw/mbna/accounts/00240691635/snapshot' }),
      );
    });
  });

  describe('getClosingDates', () => {
    it('should extract and sort closing dates newest first', async () => {
      mockHttpClient = createMockHttpClient({ responseText: JSON.stringify(SAMPLE_CLOSING_DATES_RESPONSE) });
      api = createApi(mockHttpClient, mockAuth);
      const result = await api.getClosingDates('00240691635');
      expect(result).toEqual(['2026-01-14', '2025-12-15', '2025-11-14', '2025-10-14', '2025-09-15']);
    });

    it('should filter out mostRecentTransactions key', async () => {
      mockHttpClient = createMockHttpClient({ responseText: JSON.stringify(SAMPLE_CLOSING_DATES_RESPONSE) });
      api = createApi(mockHttpClient, mockAuth);
      const result = await api.getClosingDates('00240691635');
      expect(result).not.toContain('mostRecentTransactions');
    });

    it('should filter out non-date keys', async () => {
      mockHttpClient = createMockHttpClient({
        responseText: JSON.stringify({
          closingDate: { mostRecentTransactions: 'x', '2025-12-15': 'Dec', invalidKey: 'val' },
        }),
      });
      api = createApi(mockHttpClient, mockAuth);
      const result = await api.getClosingDates('00240691635');
      expect(result).toEqual(['2025-12-15']);
    });

    it('should call correct URL', async () => {
      mockHttpClient = createMockHttpClient({ responseText: JSON.stringify(SAMPLE_CLOSING_DATES_RESPONSE) });
      api = createApi(mockHttpClient, mockAuth);
      await api.getClosingDates('00240691635');
      expect(mockHttpClient.request).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://service.mbna.ca/waw/mbna/accounts/statement/00240691635/closingdatedropdown' }),
      );
    });

    it('should throw when accountId is missing', async () => {
      await expect(api.getClosingDates('')).rejects.toThrow('Account ID is required');
    });

    it('should throw when closingDate object is missing', async () => {
      mockHttpClient = createMockHttpClient({ responseText: JSON.stringify({ status: 'success' }) });
      api = createApi(mockHttpClient, mockAuth);
      await expect(api.getClosingDates('00240691635')).rejects.toThrow('Unexpected closing dates format');
    });

    it('should return empty array when only mostRecentTransactions key exists', async () => {
      mockHttpClient = createMockHttpClient({
        responseText: JSON.stringify({ closingDate: { mostRecentTransactions: 'x' } }),
      });
      api = createApi(mockHttpClient, mockAuth);
      const result = await api.getClosingDates('00240691635');
      expect(result).toEqual([]);
    });

    it('should handle single closing date', async () => {
      mockHttpClient = createMockHttpClient({
        responseText: JSON.stringify({ closingDate: { mostRecentTransactions: 'x', '2025-06-15': 'June' } }),
      });
      api = createApi(mockHttpClient, mockAuth);
      const result = await api.getClosingDates('00240691635');
      expect(result).toEqual(['2025-06-15']);
    });
  });

  describe('getStatementByClosingDate', () => {
    it('should parse statement with transactions and balances', async () => {
      mockHttpClient = createMockHttpClient({ responseText: JSON.stringify(SAMPLE_STATEMENT_RESPONSE) });
      api = createApi(mockHttpClient, mockAuth);
      const result = await api.getStatementByClosingDate('00240691635', '2026-01-14');
      expect(result.statementBalance).toBe(158.41);
      expect(result.creditLimit).toBe(29900.00);
      expect(result.statementClosingDate).toBe('2026-01-14');
      expect(result.nextStatementClosingDate).toBe('2026-02-14');
      expect(result.transactions).toHaveLength(3);
      expect(result.transactions[0].referenceNumber).toBe('55490535351206796539264');
    });

    it('should call correct URL with account ID and closing date', async () => {
      mockHttpClient = createMockHttpClient({ responseText: JSON.stringify(SAMPLE_STATEMENT_RESPONSE) });
      api = createApi(mockHttpClient, mockAuth);
      await api.getStatementByClosingDate('00240691635', '2026-01-14');
      expect(mockHttpClient.request).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://service.mbna.ca/waw/mbna/accounts/00240691635/statement/closingdate/2026-01-14',
        }),
      );
    });

    it('should throw when accountId is missing', async () => {
      await expect(api.getStatementByClosingDate('', '2026-01-14')).rejects.toThrow('Account ID is required');
    });

    it('should throw when closingDate is missing', async () => {
      await expect(api.getStatementByClosingDate('00240691635', '')).rejects.toThrow('Closing date is required');
      await expect(api.getStatementByClosingDate('00240691635', null)).rejects.toThrow('Closing date is required');
    });

    it('should throw when statement object is missing', async () => {
      mockHttpClient = createMockHttpClient({ responseText: JSON.stringify({ errorCode: '', status: 'success' }) });
      api = createApi(mockHttpClient, mockAuth);
      await expect(api.getStatementByClosingDate('00240691635', '2026-01-14')).rejects.toThrow('Unexpected statement format');
    });

    it('should handle statement with no transactions', async () => {
      mockHttpClient = createMockHttpClient({
        responseText: JSON.stringify({ statement: { statementBalance: 0, statementClosingDate: '2026-01-14' } }),
      });
      api = createApi(mockHttpClient, mockAuth);
      const result = await api.getStatementByClosingDate('00240691635', '2026-01-14');
      expect(result.transactions).toEqual([]);
      expect(result.statementBalance).toBe(0);
    });

    it('should extract minPaymentDue fields', async () => {
      mockHttpClient = createMockHttpClient({ responseText: JSON.stringify(SAMPLE_STATEMENT_RESPONSE) });
      api = createApi(mockHttpClient, mockAuth);
      const result = await api.getStatementByClosingDate('00240691635', '2026-01-14');
      expect(result.minPaymentDue).toBe(10.00);
      expect(result.minPaymentDueDate).toBe('2026-02-04');
    });

    it('should fall back closingDate parameter when statementClosingDate missing', async () => {
      mockHttpClient = createMockHttpClient({
        responseText: JSON.stringify({ statement: { statementBalance: 50 } }),
      });
      api = createApi(mockHttpClient, mockAuth);
      const result = await api.getStatementByClosingDate('00240691635', '2025-11-14');
      expect(result.statementClosingDate).toBe('2025-11-14');
    });
  });

  describe('getTransactions', () => {
    /**
     * Helper to create a mock that returns different responses based on URL.
     * Maps URL patterns to response objects.
     */
    function createRoutedMockHttpClient(routes) {
      return {
        request: jest.fn().mockImplementation((opts) => {
          for (const [pattern, response] of Object.entries(routes)) {
            if (opts.url.includes(pattern)) {
              return Promise.resolve({
                status: 200,
                responseText: JSON.stringify(response),
                responseHeaders: '',
              });
            }
          }
          return Promise.resolve({ status: 404, responseText: '' });
        }),
      };
    }

    it('should throw when accountId is missing', async () => {
      await expect(api.getTransactions('', '2025-01-01')).rejects.toThrow('Account ID is required');
    });

    it('should combine current cycle and statement transactions', async () => {
      mockHttpClient = createRoutedMockHttpClient({
        '/snapshot': SAMPLE_SNAPSHOT_WITH_TRANSACTIONS,
        '/closingdatedropdown': SAMPLE_CLOSING_DATES_RESPONSE,
        '/closingdate/2026-01-14': SAMPLE_STATEMENT_RESPONSE,
        '/closingdate/2025-12-15': {
          statement: {
            statementBalance: 100,
            statementClosingDate: '2025-12-15',
            accountTransactions: [
              { transactionDate: '2025-11-20', description: 'COSTCO WHOLESALE', referenceNumber: 'REF001', amount: 55.00, endingIn: '4201' },
            ],
          },
        },
        '/closingdate/2025-11-14': {
          statement: {
            statementBalance: 200,
            statementClosingDate: '2025-11-14',
            accountTransactions: [
              { transactionDate: '2025-10-25', description: 'UBER *TRIP', referenceNumber: 'REF002', amount: 30.00, endingIn: '4201' },
            ],
          },
        },
      });
      api = createApi(mockHttpClient, mockAuth);

      const result = await api.getTransactions('00240691635', '2025-11-01');

      // Should have allPending from current cycle
      expect(result.allPending).toHaveLength(1);
      expect(result.allPending[0].referenceNumber).toBe('TEMP');

      // allSettled should contain unique settled transactions from current cycle + statements
      expect(result.allSettled.length).toBeGreaterThan(0);

      // Should include statements
      expect(result.statements.length).toBeGreaterThan(0);
    });

    it('should deduplicate transactions by referenceNumber', async () => {
      // Same transaction appears in both current cycle and statement
      const sharedRef = '55490535351206796539264';
      mockHttpClient = createRoutedMockHttpClient({
        '/snapshot': SAMPLE_SNAPSHOT_WITH_TRANSACTIONS, // contains sharedRef
        '/closingdatedropdown': { closingDate: { mostRecentTransactions: 'x', '2026-01-14': 'Jan' } },
        '/closingdate/2026-01-14': SAMPLE_STATEMENT_RESPONSE, // also contains sharedRef
      });
      api = createApi(mockHttpClient, mockAuth);

      const result = await api.getTransactions('00240691635', '2025-12-01');

      // Count how many times sharedRef appears
      const matchingRefs = result.allSettled.filter((tx) => tx.referenceNumber === sharedRef);
      expect(matchingRefs).toHaveLength(1);
    });

    it('should filter by startDate', async () => {
      mockHttpClient = createRoutedMockHttpClient({
        '/snapshot': {
          accountTransactions: {
            pendingTransactions: [],
            recentTransactions: [
              { transactionDate: '2026-02-15', referenceNumber: 'NEW1', amount: 10 },
            ],
          },
        },
        '/closingdatedropdown': { closingDate: { mostRecentTransactions: 'x', '2026-01-14': 'Jan' } },
        '/closingdate/2026-01-14': {
          statement: {
            statementBalance: 100,
            statementClosingDate: '2026-01-14',
            accountTransactions: [
              { transactionDate: '2025-12-17', referenceNumber: 'OLD1', amount: 50 },
              { transactionDate: '2026-01-10', referenceNumber: 'NEW2', amount: 20 },
            ],
          },
        },
      });
      api = createApi(mockHttpClient, mockAuth);

      const result = await api.getTransactions('00240691635', '2026-01-01');

      // Only transactions on or after 2026-01-01
      const refs = result.allSettled.map((tx) => tx.referenceNumber);
      expect(refs).toContain('NEW1');
      expect(refs).toContain('NEW2');
      expect(refs).not.toContain('OLD1');
    });

    it('should return only current cycle when closing dates fail', async () => {
      mockHttpClient = createRoutedMockHttpClient({
        '/snapshot': SAMPLE_SNAPSHOT_WITH_TRANSACTIONS,
        '/closingdatedropdown': { status: 'error' }, // Missing closingDate → throws
      });
      api = createApi(mockHttpClient, mockAuth);

      const result = await api.getTransactions('00240691635', '2025-01-01');

      expect(result.statements).toEqual([]);
      expect(result.allSettled).toHaveLength(2); // Only current cycle settled
      expect(result.allPending).toHaveLength(1);
    });

    it('should exclude TEMP referenceNumber from allSettled', async () => {
      mockHttpClient = createRoutedMockHttpClient({
        '/snapshot': SAMPLE_SNAPSHOT_WITH_TRANSACTIONS,
        '/closingdatedropdown': { closingDate: { mostRecentTransactions: 'x' } },
      });
      api = createApi(mockHttpClient, mockAuth);

      const result = await api.getTransactions('00240691635', '2025-01-01');

      const tempRefs = result.allSettled.filter((tx) => tx.referenceNumber === 'TEMP');
      expect(tempRefs).toHaveLength(0);
    });

    it('should only fetch statements with closing dates >= startDate', async () => {
      mockHttpClient = createRoutedMockHttpClient({
        '/snapshot': { accountTransactions: { pendingTransactions: [], recentTransactions: [] } },
        '/closingdatedropdown': SAMPLE_CLOSING_DATES_RESPONSE,
        // Only provide 2026-01-14 statement (the only one >= 2026-01-01)
        '/closingdate/2026-01-14': SAMPLE_STATEMENT_RESPONSE,
      });
      api = createApi(mockHttpClient, mockAuth);

      const result = await api.getTransactions('00240691635', '2026-01-01');

      // Should only have fetched 1 statement (2026-01-14 >= 2026-01-01)
      expect(result.statements).toHaveLength(1);
      expect(result.statements[0].closingDate).toBe('2026-01-14');
    });

    it('should include statement metadata', async () => {
      mockHttpClient = createRoutedMockHttpClient({
        '/snapshot': { accountTransactions: { pendingTransactions: [], recentTransactions: [] } },
        '/closingdatedropdown': { closingDate: { mostRecentTransactions: 'x', '2026-01-14': 'Jan' } },
        '/closingdate/2026-01-14': SAMPLE_STATEMENT_RESPONSE,
      });
      api = createApi(mockHttpClient, mockAuth);

      const result = await api.getTransactions('00240691635', '2025-12-01');

      expect(result.statements[0].statementBalance).toBe(158.41);
      expect(result.statements[0].closingDate).toBe('2026-01-14');
      expect(result.statements[0].transactions).toHaveLength(3);
    });

    it('should call onProgress callback for each statement fetched', async () => {
      mockHttpClient = createRoutedMockHttpClient({
        '/snapshot': { accountTransactions: { pendingTransactions: [], recentTransactions: [] } },
        '/closingdatedropdown': { closingDate: { mostRecentTransactions: 'x', '2026-01-14': 'Jan', '2025-12-15': 'Dec' } },
        '/closingdate/2026-01-14': SAMPLE_STATEMENT_RESPONSE,
        '/closingdate/2025-12-15': {
          statement: { statementBalance: 50, statementClosingDate: '2025-12-15', accountTransactions: [] },
        },
      });
      api = createApi(mockHttpClient, mockAuth);

      const onProgress = jest.fn();
      await api.getTransactions('00240691635', '2025-11-01', { onProgress });

      expect(onProgress).toHaveBeenCalledTimes(2);
      expect(onProgress).toHaveBeenNthCalledWith(1, 1, 2, '2026-01-14');
      expect(onProgress).toHaveBeenNthCalledWith(2, 2, 2, '2025-12-15');
    });

    it('should not fail when onProgress is not provided', async () => {
      mockHttpClient = createRoutedMockHttpClient({
        '/snapshot': { accountTransactions: { pendingTransactions: [], recentTransactions: [] } },
        '/closingdatedropdown': { closingDate: { mostRecentTransactions: 'x', '2026-01-14': 'Jan' } },
        '/closingdate/2026-01-14': SAMPLE_STATEMENT_RESPONSE,
      });
      api = createApi(mockHttpClient, mockAuth);

      // Should not throw when no onProgress option is passed
      await expect(api.getTransactions('00240691635', '2025-12-01')).resolves.toBeDefined();
    });

    it('should handle no startDate (fetch all available)', async () => {
      mockHttpClient = createRoutedMockHttpClient({
        '/snapshot': { accountTransactions: { pendingTransactions: [], recentTransactions: [] } },
        '/closingdatedropdown': { closingDate: { mostRecentTransactions: 'x', '2026-01-14': 'Jan', '2025-12-15': 'Dec' } },
        '/closingdate/2026-01-14': SAMPLE_STATEMENT_RESPONSE,
        '/closingdate/2025-12-15': {
          statement: { statementBalance: 50, statementClosingDate: '2025-12-15', accountTransactions: [] },
        },
      });
      api = createApi(mockHttpClient, mockAuth);

      const result = await api.getTransactions('00240691635', null);

      expect(result.statements).toHaveLength(2);
    });
  });
});
