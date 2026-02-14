/**
 * Tests for Wealthsimple API Client - Transactions
 *
 * Covers: fetchTransactions, fetchCreditCardAccountSummary, fetchFundingIntents
 */

import wealthsimpleApi from '../../src/api/wealthsimple';
import { STORAGE, API } from '../../src/core/config';

global.GM_getValue = jest.fn();
global.GM_setValue = jest.fn();
global.GM_deleteValue = jest.fn();
global.GM_xmlhttpRequest = jest.fn();

Object.defineProperty(document, 'cookie', {
  writable: true,
  value: '',
});

jest.mock('../../src/core/state', () => ({
  __esModule: true,
  default: {
    setWealthsimpleAuth: jest.fn(),
  },
}));

/**
 * Helper to set up GM_getValue mock with Wealthsimple auth in configStore format.
 */
function setupConfigStoreAuth(authData) {
  GM_getValue.mockImplementation((key, defaultValue) => {
    if (key === STORAGE.WEALTHSIMPLE_CONFIG) {
      if (!authData) return '{}';
      return JSON.stringify({ auth: authData });
    }
    if (key === 'debug_log_level') return 'info';
    return defaultValue !== undefined ? defaultValue : null;
  });
}

describe('Wealthsimple API Client - Transactions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    document.cookie = '';
    jest.clearAllTimers();
  });

  describe('fetchTransactions', () => {
    beforeEach(() => {
      // Mock Date.now() to return a consistent timestamp
      jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-01-03T16:00:00.000Z').getTime());

      const futureDate = new Date(Date.now() + 3600000).toISOString();
      setupConfigStoreAuth({
        accessToken: 'test-token',
        identityId: 'identity-123',
        expiresAt: futureDate,
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
      setupConfigStoreAuth({
        accessToken: 'test-token',
        identityId: 'identity-123',
        expiresAt: futureDate,
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

      // clearTokenData now clears via configStore
      expect(GM_setValue).toHaveBeenCalled();
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
      setupConfigStoreAuth({
        accessToken: 'test-token',
        identityId: 'identity-123',
        expiresAt: futureDate,
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

});
