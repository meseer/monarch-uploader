/**
 * Tests for Monarch API - Account & Holdings Functions
 *
 * Covers: setAccountLogo, getHoldings, getFilteredAccounts, updateAccount,
 * getCreditLimit, getTransactionsList, getHouseholdTransactionTags, getTagByName
 */

import { jest } from '@jest/globals';
import '../setup';
import {
  setAccountLogo,
  getHoldings,
  getFilteredAccounts,
  updateAccount,
  getCreditLimit,
  getTransactionsList,
  getHouseholdTransactionTags,
  getTagByName,
} from '../../src/api/monarch';
import authService from '../../src/services/auth';
import stateManager from '../../src/core/state';
import { debugLog } from '../../src/core/utils';

// Mock all external dependencies
jest.mock('../../src/services/auth', () => ({
  checkMonarchAuth: jest.fn(),
  getMonarchToken: jest.fn(),
  setupMonarchTokenCapture: jest.fn(),
  saveMonarchToken: jest.fn(),
}));

jest.mock('../../src/core/state', () => ({
  setMonarchAuth: jest.fn(),
  getState: jest.fn(),
}));

jest.mock('../../src/core/utils', () => ({
  debugLog: jest.fn(),
}));

jest.mock('../../src/ui/components/accountSelectorWithCreate', () => ({
  showMonarchAccountSelectorWithCreate: jest.fn(),
}));

describe('Monarch API - Accounts', () => {
  let mockGMXmlHttpRequest;
  let mockGMSetValue;
  let mockGMGetValue;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGMXmlHttpRequest = jest.fn();
    mockGMSetValue = jest.fn();
    mockGMGetValue = jest.fn();
    globalThis.GM_xmlhttpRequest = mockGMXmlHttpRequest;
    globalThis.GM_setValue = mockGMSetValue;
    globalThis.GM_getValue = mockGMGetValue;
    authService.checkMonarchAuth.mockReturnValue({
      authenticated: true,
      token: 'test-token-123',
    });
    authService.getMonarchToken.mockReturnValue('test-token-123');
    stateManager.getState.mockReturnValue({
      currentAccount: { nickname: 'Test Account', name: 'Test Name' },
    });
    jest.spyOn(global, 'setTimeout').mockImplementation((callback) => {
      callback();
      return 1;
    });
  });

  afterEach(() => {
    global.setTimeout.mockRestore?.();
  });

  describe('getHoldings', () => {
    const mockPortfolio = {
      aggregateHoldings: {
        edges: [
          {
            node: {
              id: 'sec123',
              quantity: 100,
              basis: 150.25,
              totalValue: 15025.00,
              holdings: [
                {
                  id: 'holding123',
                  ticker: 'AMZN',
                  quantity: 100,
                  costBasis: 150.25,
                },
              ],
            },
          },
        ],
      },
    };

    test('retrieves holdings with default options', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        const data = JSON.parse(options.data);
        expect(data.variables.input.accountIds).toEqual(['account123']);
        expect(data.variables.input.includeHiddenHoldings).toBe(true);
        expect(data.variables.input.topMoversLimit).toBe(4);

        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({
            data: { portfolio: mockPortfolio },
          }),
        }), 0);
      });

      const result = await getHoldings(['account123']);

      expect(result).toEqual(mockPortfolio);
    });

    test('retrieves holdings with custom options', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        const data = JSON.parse(options.data);
        expect(data.variables.input).toEqual({
          accountIds: ['account123', 'account456'],
          includeHiddenHoldings: false,
          topMoversLimit: 10,
          startDate: '2024-01-01',
          endDate: '2024-12-31',
        });

        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({
            data: { portfolio: mockPortfolio },
          }),
        }), 0);
      });

      const result = await getHoldings(['account123', 'account456'], {
        includeHiddenHoldings: false,
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        topMoversLimit: 10,
      });

      expect(result).toEqual(mockPortfolio);
    });

    test('retrieves holdings with multiple accounts', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        const data = JSON.parse(options.data);
        expect(data.variables.input.accountIds).toEqual(['acc1', 'acc2', 'acc3']);

        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({
            data: { portfolio: mockPortfolio },
          }),
        }), 0);
      });

      const result = await getHoldings(['acc1', 'acc2', 'acc3']);

      expect(result).toEqual(mockPortfolio);
    });

    test('handles empty holdings result', async () => {
      const emptyPortfolio = {
        aggregateHoldings: {
          edges: [],
        },
      };

      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({
            data: { portfolio: emptyPortfolio },
          }),
        }), 0);
      });

      const result = await getHoldings(['account123']);

      expect(result).toEqual(emptyPortfolio);
    });

    test('handles authentication errors', async () => {
      authService.checkMonarchAuth.mockReturnValue({
        authenticated: false,
        token: null,
      });

      await expect(getHoldings(['account123']))
        .rejects
        .toThrow('Monarch token not found.');
    });

    test('handles GraphQL errors', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({
            errors: [{ message: 'Invalid account ID' }],
          }),
        }), 0);
      });

      await expect(getHoldings(['invalid']))
        .rejects
        .toThrow();
    });
  });

  describe('getFilteredAccounts', () => {
    const mockAccountsData = {
      accounts: [
        {
          id: '225927715198893500',
          createdAt: '2025-10-29T18:24:19.347081+00:00',
          displayName: 'Tangerine US$ Savings Account (...1187)',
          displayBalance: 0.0,
          displayLastUpdatedAt: '2026-01-04T06:46:53.151486+00:00',
          dataProvider: 'plaid',
          icon: 'dollar-sign',
          logoUrl: 'https://api.monarchmoney.com/cdn-cgi/image/width=128/images/institution/75103676797753434',
          order: 51,
          isAsset: true,
          includeBalanceInNetWorth: true,
          deactivatedAt: null,
          manualInvestmentsTrackingMethod: null,
          isManual: false,
          syncDisabled: false,
          type: { display: 'Cash', name: 'depository', __typename: 'AccountType' },
          credential: { updateRequired: false, syncDisabledAt: null, __typename: 'Credential' },
          institution: { status: 'DOWN', newConnectionsDisabled: false, __typename: 'Institution' },
          ownedByUser: null,
          __typename: 'Account',
        },
        {
          id: '231996536253873225',
          createdAt: '2026-01-04T18:05:38.118698+00:00',
          displayName: 'Wealthsimple CC',
          displayBalance: -0.0,
          displayLastUpdatedAt: '2026-01-04T18:05:45.363126+00:00',
          dataProvider: '',
          icon: 'credit-card',
          logoUrl: null,
          order: 34,
          isAsset: false,
          includeBalanceInNetWorth: true,
          deactivatedAt: null,
          manualInvestmentsTrackingMethod: null,
          isManual: true,
          syncDisabled: false,
          type: { display: 'Credit Cards', name: 'credit', __typename: 'AccountType' },
          credential: null,
          institution: null,
          ownedByUser: null,
          limit: 17000,
          __typename: 'Account',
        },
      ],
    };

    test('retrieves all accounts with empty filters', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        const data = JSON.parse(options.data);
        expect(data.operationName).toBe('Web_GetFilteredAccounts');
        expect(data.variables.filters).toEqual({});

        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({ data: mockAccountsData }),
        }), 0);
      });

      const result = await getFilteredAccounts({});

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('225927715198893500');
      expect(result[1].id).toBe('231996536253873225');
    });

    test('returns empty array when no accounts exist', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({ data: { accounts: [] } }),
        }), 0);
      });

      const result = await getFilteredAccounts({});

      expect(result).toEqual([]);
    });

    test('returns empty array when accounts is null', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({ data: { accounts: null } }),
        }), 0);
      });

      const result = await getFilteredAccounts({});

      expect(result).toEqual([]);
    });

    test('handles authentication errors', async () => {
      authService.checkMonarchAuth.mockReturnValue({
        authenticated: false,
        token: null,
      });

      await expect(getFilteredAccounts({}))
        .rejects
        .toThrow('Monarch token not found.');
    });

    test('handles network errors', async () => {
      const mockError = new Error('Network error');

      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onerror(mockError), 0);
      });

      await expect(getFilteredAccounts({}))
        .rejects
        .toThrow('Network error');
    });
  });

  describe('updateAccount', () => {
    const mockUpdatedAccount = {
      id: '231838722038464342',
      displayName: 'Wealthsimple CC',
      syncDisabled: false,
      deactivatedAt: null,
      isHidden: false,
      isAsset: false,
      mask: null,
      createdAt: '2026-01-03T00:17:14.753804+00:00',
      updatedAt: '2026-01-03T02:48:42.946842+00:00',
      displayLastUpdatedAt: '2026-01-03T02:48:42.946842+00:00',
      currentBalance: 0.0,
      displayBalance: 0.0,
      includeInNetWorth: true,
      hideFromList: false,
      hideTransactionsFromReports: false,
      includeBalanceInNetWorth: true,
      includeInGoalBalance: true,
      excludeFromDebtPaydown: false,
      dataProvider: '',
      dataProviderAccountId: null,
      isManual: true,
      transactionsCount: 0,
      holdingsCount: 0,
      manualInvestmentsTrackingMethod: null,
      order: 34,
      icon: 'credit-card',
      logoUrl: null,
      limit: 17000.0,
      apr: null,
      minimumPayment: null,
      plannedPayment: null,
      interestRate: null,
      type: { name: 'credit', display: 'Credit Cards', group: 'liability', __typename: 'AccountType' },
      subtype: { name: 'credit_card', display: 'Credit Card', __typename: 'AccountSubtype' },
      credential: null,
      institution: null,
      ownedByUser: null,
      connectionStatus: null,
      __typename: 'Account',
    };

    test('updates account successfully', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        const data = JSON.parse(options.data);
        expect(data.operationName).toBe('Common_UpdateAccount');
        expect(data.variables.input.id).toBe('231838722038464342');
        expect(data.variables.input.limit).toBe(17000);

        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({
            data: {
              updateAccount: {
                account: mockUpdatedAccount,
                errors: null,
              },
            },
          }),
        }), 0);
      });

      const result = await updateAccount({
        id: '231838722038464342',
        dataProvider: '',
        name: 'Wealthsimple CC',
        type: 'credit',
        subtype: 'credit_card',
        displayBalance: 0,
        limit: 17000,
        includeInNetWorth: true,
      });

      expect(result).toEqual(mockUpdatedAccount);
      expect(debugLog).toHaveBeenCalledWith('Updating account:', expect.objectContaining({
        id: '231838722038464342',
      }));
    });

    test('throws error when account ID is missing', async () => {
      await expect(updateAccount({ name: 'Test' }))
        .rejects
        .toThrow('Account ID is required for update');
    });

    test('throws error when input is null', async () => {
      await expect(updateAccount(null))
        .rejects
        .toThrow('Account ID is required for update');
    });

    test('throws error when API returns errors', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({
            data: {
              updateAccount: {
                account: null,
                errors: {
                  message: 'Invalid account type',
                  code: 'INVALID_TYPE',
                },
              },
            },
          }),
        }), 0);
      });

      await expect(updateAccount({ id: 'account123', type: 'invalid' }))
        .rejects
        .toThrow('Invalid account type');
    });

    test('throws default error when API errors have no message', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({
            data: {
              updateAccount: {
                account: null,
                errors: {
                  code: 'UNKNOWN_ERROR',
                },
              },
            },
          }),
        }), 0);
      });

      await expect(updateAccount({ id: 'account123' }))
        .rejects
        .toThrow('Failed to update account');
    });

    test('handles authentication errors', async () => {
      authService.checkMonarchAuth.mockReturnValue({
        authenticated: false,
        token: null,
      });

      await expect(updateAccount({ id: 'account123' }))
        .rejects
        .toThrow('Monarch token not found.');
    });

    test('handles network errors', async () => {
      const mockError = new Error('Network error');

      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onerror(mockError), 0);
      });

      await expect(updateAccount({ id: 'account123' }))
        .rejects
        .toThrow('Network error');
    });
  });

  describe('getCreditLimit', () => {
    const mockAccountsData = {
      accounts: [
        {
          id: 'account123',
          displayName: 'My Credit Card',
          type: { name: 'credit' },
          limit: 15000,
        },
        {
          id: 'account456',
          displayName: 'Savings',
          type: { name: 'depository' },
          limit: null,
        },
      ],
    };

    test('returns credit limit for existing account', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({ data: mockAccountsData }),
        }), 0);
      });

      const result = await getCreditLimit('account123');

      expect(result).toBe(15000);
      expect(debugLog).toHaveBeenCalledWith('Getting credit limit for account: account123');
    });

    test('returns null when limit is not set', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({
            data: {
              accounts: [
                { id: 'account123', displayName: 'Test', type: { name: 'credit' } },
              ],
            },
          }),
        }), 0);
      });

      const result = await getCreditLimit('account123');

      expect(result).toBeNull();
    });

    test('throws error when account ID is missing', async () => {
      await expect(getCreditLimit(null))
        .rejects
        .toThrow('Account ID is required');

      await expect(getCreditLimit(''))
        .rejects
        .toThrow('Account ID is required');
    });

    test('throws error when account not found', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({ data: mockAccountsData }),
        }), 0);
      });

      await expect(getCreditLimit('nonexistent'))
        .rejects
        .toThrow('Account not found: nonexistent');
    });

    test('handles authentication errors', async () => {
      authService.checkMonarchAuth.mockReturnValue({
        authenticated: false,
        token: null,
      });

      await expect(getCreditLimit('account123'))
        .rejects
        .toThrow('Monarch token not found.');
    });
  });

  describe('getTransactionsList', () => {
    const mockTransactionsResponse = {
      allTransactions: {
        totalCount: 5,
        totalSelectableCount: 5,
        results: [
          {
            id: '232004636869426225',
            amount: -52.5,
            pending: false,
            date: '2025-05-28',
            hideFromReports: true,
            hiddenByAccount: false,
            plaidName: 'Beta Chocolates',
            notes: 'Planning chocolates',
            isRecurring: false,
            reviewStatus: null,
            needsReview: false,
            isSplitTransaction: false,
            dataProviderDescription: 'Beta Chocolates',
            attachments: [],
            goal: null,
            savingsGoalEvent: null,
            category: {
              id: '162625045061467426',
              name: 'Restaurants & Bars',
              icon: '🍽',
              group: { id: '162625045019525029', type: 'expense' },
            },
            merchant: {
              name: 'Beta Chocolates',
              id: '162626687081152169',
              transactionsCount: 7,
              logoUrl: null,
              recurringTransactionStream: null,
            },
            tags: [
              {
                id: '162625044964998399',
                name: 'Reimburse',
                color: '#32AAF0',
                order: 1,
              },
            ],
            account: {
              id: '232004378673314879',
              displayName: 'Wealthsimple Credit Card (6903)',
              icon: 'credit-card',
              logoUrl: null,
            },
            ownedByUser: null,
          },
          {
            id: '232004636869426231',
            amount: -55.74,
            pending: false,
            date: '2025-05-27',
            hideFromReports: true,
            hiddenByAccount: false,
            plaidName: 'Bahar Cafe',
            notes: '',
            isRecurring: false,
            reviewStatus: null,
            needsReview: false,
            isSplitTransaction: false,
            dataProviderDescription: 'Bahar Cafe',
            attachments: [],
            goal: null,
            savingsGoalEvent: null,
            category: {
              id: '162625045061467426',
              name: 'Restaurants & Bars',
              icon: '🍽',
              group: { id: '162625045019525029', type: 'expense' },
            },
            merchant: {
              name: 'Bahar Cafe',
              id: '178398432126861126',
              transactionsCount: 4,
              logoUrl: null,
              recurringTransactionStream: null,
            },
            tags: [
              {
                id: '162625044964998399',
                name: 'Reimburse',
                color: '#32AAF0',
                order: 1,
              },
            ],
            account: {
              id: '232004378673314879',
              displayName: 'Wealthsimple Credit Card (6903)',
              icon: 'credit-card',
              logoUrl: null,
            },
            ownedByUser: null,
          },
        ],
      },
    };

    test('retrieves transactions with required filters', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        const data = JSON.parse(options.data);
        expect(data.operationName).toBe('Web_GetTransactionsList');
        expect(data.variables.filters.accounts).toEqual(['232004378673314879']);
        expect(data.variables.filters.startDate).toBe('2025-01-01');
        expect(data.variables.filters.endDate).toBe('2025-12-31');
        expect(data.variables.filters.transactionVisibility).toBe('all_transactions');
        expect(data.variables.limit).toBe(100);
        expect(data.variables.offset).toBe(0);
        expect(data.variables.orderBy).toBe('date');

        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({ data: mockTransactionsResponse }),
        }), 0);
      });

      const result = await getTransactionsList({
        accountIds: ['232004378673314879'],
        startDate: '2025-01-01',
        endDate: '2025-12-31',
      });

      expect(result.totalCount).toBe(5);
      expect(result.totalSelectableCount).toBe(5);
      expect(result.results).toHaveLength(2);
      expect(result.results[0].id).toBe('232004636869426225');
      expect(result.results[0].amount).toBe(-52.5);
      expect(result.results[0].merchant.name).toBe('Beta Chocolates');
    });

    test('retrieves transactions with tag filters', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        const data = JSON.parse(options.data);
        expect(data.variables.filters.tags).toEqual(['162625044964998399']);

        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({ data: mockTransactionsResponse }),
        }), 0);
      });

      const result = await getTransactionsList({
        accountIds: ['232004378673314879'],
        startDate: '2025-01-01',
        endDate: '2025-12-31',
        tags: ['162625044964998399'],
      });

      expect(result.totalCount).toBe(5);
      expect(result.results[0].tags[0].name).toBe('Reimburse');
    });

    test('retrieves transactions with pagination options', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        const data = JSON.parse(options.data);
        expect(data.variables.limit).toBe(20);
        expect(data.variables.offset).toBe(40);
        expect(data.variables.orderBy).toBe('amount');

        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({ data: mockTransactionsResponse }),
        }), 0);
      });

      const result = await getTransactionsList({
        accountIds: ['232004378673314879'],
        startDate: '2025-01-01',
        endDate: '2025-12-31',
        limit: 20,
        offset: 40,
        orderBy: 'amount',
      });

      expect(result.results).toHaveLength(2);
    });

    test('retrieves transactions with multiple account IDs', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        const data = JSON.parse(options.data);
        expect(data.variables.filters.accounts).toEqual(['acc1', 'acc2', 'acc3']);

        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({ data: mockTransactionsResponse }),
        }), 0);
      });

      const result = await getTransactionsList({
        accountIds: ['acc1', 'acc2', 'acc3'],
        startDate: '2025-01-01',
        endDate: '2025-12-31',
      });

      expect(result.totalCount).toBe(5);
    });

    test('retrieves transactions with custom visibility filter', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        const data = JSON.parse(options.data);
        expect(data.variables.filters.transactionVisibility).toBe('only_visible');

        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({ data: mockTransactionsResponse }),
        }), 0);
      });

      const result = await getTransactionsList({
        accountIds: ['232004378673314879'],
        startDate: '2025-01-01',
        endDate: '2025-12-31',
        transactionVisibility: 'only_visible',
      });

      expect(result.totalCount).toBe(5);
    });

    test('handles empty results gracefully', async () => {
      const emptyResponse = {
        allTransactions: {
          totalCount: 0,
          totalSelectableCount: 0,
          results: [],
        },
      };

      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({ data: emptyResponse }),
        }), 0);
      });

      const result = await getTransactionsList({
        accountIds: ['232004378673314879'],
        startDate: '2025-01-01',
        endDate: '2025-12-31',
      });

      expect(result.totalCount).toBe(0);
      expect(result.totalSelectableCount).toBe(0);
      expect(result.results).toEqual([]);
    });

    test('throws error when accountIds is missing', async () => {
      await expect(getTransactionsList({
        startDate: '2025-01-01',
        endDate: '2025-12-31',
      })).rejects.toThrow('accountIds is required and must be a non-empty array');
    });

    test('throws error when accountIds is empty array', async () => {
      await expect(getTransactionsList({
        accountIds: [],
        startDate: '2025-01-01',
        endDate: '2025-12-31',
      })).rejects.toThrow('accountIds is required and must be a non-empty array');
    });

    test('throws error when accountIds is not an array', async () => {
      await expect(getTransactionsList({
        accountIds: '232004378673314879',
        startDate: '2025-01-01',
        endDate: '2025-12-31',
      })).rejects.toThrow('accountIds is required and must be a non-empty array');
    });

    test('throws error when startDate is missing', async () => {
      await expect(getTransactionsList({
        accountIds: ['232004378673314879'],
        endDate: '2025-12-31',
      })).rejects.toThrow('startDate is required (format: YYYY-MM-DD)');
    });

    test('throws error when endDate is missing', async () => {
      await expect(getTransactionsList({
        accountIds: ['232004378673314879'],
        startDate: '2025-01-01',
      })).rejects.toThrow('endDate is required (format: YYYY-MM-DD)');
    });

    test('throws error when options is null', async () => {
      await expect(getTransactionsList(null))
        .rejects.toThrow('accountIds is required and must be a non-empty array');
    });

    test('throws error when options is undefined', async () => {
      await expect(getTransactionsList())
        .rejects.toThrow('accountIds is required and must be a non-empty array');
    });

    test('handles authentication errors', async () => {
      authService.checkMonarchAuth.mockReturnValue({
        authenticated: false,
        token: null,
      });

      await expect(getTransactionsList({
        accountIds: ['232004378673314879'],
        startDate: '2025-01-01',
        endDate: '2025-12-31',
      })).rejects.toThrow('Monarch token not found.');
    });

    test('handles network errors', async () => {
      const mockError = new Error('Network error');

      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onerror(mockError), 0);
      });

      await expect(getTransactionsList({
        accountIds: ['232004378673314879'],
        startDate: '2025-01-01',
        endDate: '2025-12-31',
      })).rejects.toThrow('Network error');
    });

    test('handles GraphQL errors', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({
            errors: [{ message: 'Invalid account ID' }],
          }),
        }), 0);
      });

      await expect(getTransactionsList({
        accountIds: ['invalid-account'],
        startDate: '2025-01-01',
        endDate: '2025-12-31',
      })).rejects.toThrow();
    });

    test('does not include tags filter when tags is null', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        const data = JSON.parse(options.data);
        expect(data.variables.filters.tags).toBeUndefined();

        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({ data: mockTransactionsResponse }),
        }), 0);
      });

      await getTransactionsList({
        accountIds: ['232004378673314879'],
        startDate: '2025-01-01',
        endDate: '2025-12-31',
        tags: null,
      });
    });

    test('does not include tags filter when tags is empty array', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        const data = JSON.parse(options.data);
        expect(data.variables.filters.tags).toBeUndefined();

        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({ data: mockTransactionsResponse }),
        }), 0);
      });

      await getTransactionsList({
        accountIds: ['232004378673314879'],
        startDate: '2025-01-01',
        endDate: '2025-12-31',
        tags: [],
      });
    });

    test('logs debug information', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({ data: mockTransactionsResponse }),
        }), 0);
      });

      await getTransactionsList({
        accountIds: ['232004378673314879'],
        startDate: '2025-01-01',
        endDate: '2025-12-31',
      });

      expect(debugLog).toHaveBeenCalledWith(
        'Getting transactions list with filters:',
        expect.objectContaining({
          accounts: ['232004378673314879'],
          startDate: '2025-01-01',
          endDate: '2025-12-31',
          transactionVisibility: 'all_transactions',
        }),
      );
      expect(debugLog).toHaveBeenCalledWith(
        'Retrieved 2 transactions (total: 5)',
      );
    });
  });

  describe('getHouseholdTransactionTags', () => {
    const mockTagsResponse = {
      householdTransactionTags: [
        {
          id: '162625044964998398',
          name: 'Tax',
          color: '#1E5AC3',
          order: 0,
          __typename: 'TransactionTag',
        },
        {
          id: '162625044964998399',
          name: 'Reimburse',
          color: '#32AAF0',
          order: 1,
          __typename: 'TransactionTag',
        },
        {
          id: '232589874561580130',
          name: 'Pending',
          color: '#7ce2fe',
          order: 13,
          __typename: 'TransactionTag',
        },
      ],
    };

    test('retrieves all tags with default options', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        const data = JSON.parse(options.data);
        expect(data.operationName).toBe('Common_GetHouseholdTransactionTags');
        expect(data.variables.includeTransactionCount).toBe(false);

        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({ data: mockTagsResponse }),
        }), 0);
      });

      const result = await getHouseholdTransactionTags();

      expect(result).toHaveLength(3);
      expect(result[0].name).toBe('Tax');
      expect(result[1].name).toBe('Reimburse');
      expect(result[2].name).toBe('Pending');
      expect(debugLog).toHaveBeenCalledWith(
        'Getting household transaction tags with options:',
        { includeTransactionCount: false },
      );
    });

    test('retrieves tags with search filter', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        const data = JSON.parse(options.data);
        expect(data.variables.search).toBe('Pending');

        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({
            data: {
              householdTransactionTags: [mockTagsResponse.householdTransactionTags[2]],
            },
          }),
        }), 0);
      });

      const result = await getHouseholdTransactionTags({ search: 'Pending' });

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Pending');
    });

    test('retrieves tags with limit', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        const data = JSON.parse(options.data);
        expect(data.variables.limit).toBe(2);

        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({
            data: {
              householdTransactionTags: mockTagsResponse.householdTransactionTags.slice(0, 2),
            },
          }),
        }), 0);
      });

      const result = await getHouseholdTransactionTags({ limit: 2 });

      expect(result).toHaveLength(2);
    });

    test('retrieves tags with transaction count', async () => {
      const tagsWithCount = mockTagsResponse.householdTransactionTags.map((tag) => ({
        ...tag,
        transactionCount: 10,
      }));

      mockGMXmlHttpRequest.mockImplementation((options) => {
        const data = JSON.parse(options.data);
        expect(data.variables.includeTransactionCount).toBe(true);

        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({
            data: { householdTransactionTags: tagsWithCount },
          }),
        }), 0);
      });

      const result = await getHouseholdTransactionTags({ includeTransactionCount: true });

      expect(result).toHaveLength(3);
      expect(result[0].transactionCount).toBe(10);
    });

    test('returns empty array when no tags exist', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({
            data: { householdTransactionTags: [] },
          }),
        }), 0);
      });

      const result = await getHouseholdTransactionTags();

      expect(result).toEqual([]);
    });

    test('returns empty array when householdTransactionTags is null', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({
            data: { householdTransactionTags: null },
          }),
        }), 0);
      });

      const result = await getHouseholdTransactionTags();

      expect(result).toEqual([]);
    });

    test('handles authentication errors', async () => {
      authService.checkMonarchAuth.mockReturnValue({
        authenticated: false,
        token: null,
      });

      await expect(getHouseholdTransactionTags())
        .rejects
        .toThrow('Monarch token not found.');
    });

    test('handles network errors', async () => {
      const mockError = new Error('Network error');

      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onerror(mockError), 0);
      });

      await expect(getHouseholdTransactionTags())
        .rejects
        .toThrow('Network error');
    });

    test('passes bulkParams when provided', async () => {
      const bulkParams = { someParam: 'value' };

      mockGMXmlHttpRequest.mockImplementation((options) => {
        const data = JSON.parse(options.data);
        expect(data.variables.bulkParams).toEqual(bulkParams);

        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({ data: mockTagsResponse }),
        }), 0);
      });

      await getHouseholdTransactionTags({ bulkParams });
    });

    test('logs retrieved tag count', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({ data: mockTagsResponse }),
        }), 0);
      });

      await getHouseholdTransactionTags();

      expect(debugLog).toHaveBeenCalledWith('Retrieved 3 transaction tags');
    });
  });

  describe('getTagByName', () => {
    const mockTagsResponse = {
      householdTransactionTags: [
        {
          id: '162625044964998398',
          name: 'Tax',
          color: '#1E5AC3',
          order: 0,
        },
        {
          id: '162625044964998399',
          name: 'Reimburse',
          color: '#32AAF0',
          order: 1,
        },
        {
          id: '232589874561580130',
          name: 'Pending',
          color: '#7ce2fe',
          order: 13,
        },
      ],
    };

    test('finds tag by exact name', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({ data: mockTagsResponse }),
        }), 0);
      });

      const result = await getTagByName('Pending');

      expect(result).not.toBeNull();
      expect(result.id).toBe('232589874561580130');
      expect(result.name).toBe('Pending');
      expect(debugLog).toHaveBeenCalledWith('Looking up tag by name: Pending');
      expect(debugLog).toHaveBeenCalledWith('Found tag: Pending (ID: 232589874561580130)');
    });

    test('finds tag case-insensitively', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({ data: mockTagsResponse }),
        }), 0);
      });

      const result = await getTagByName('pending');

      expect(result).not.toBeNull();
      expect(result.id).toBe('232589874561580130');
      expect(result.name).toBe('Pending');
    });

    test('finds tag with uppercase search', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({ data: mockTagsResponse }),
        }), 0);
      });

      const result = await getTagByName('PENDING');

      expect(result).not.toBeNull();
      expect(result.name).toBe('Pending');
    });

    test('trims whitespace from tag name', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({ data: mockTagsResponse }),
        }), 0);
      });

      const result = await getTagByName('  Pending  ');

      expect(result).not.toBeNull();
      expect(result.name).toBe('Pending');
    });

    test('returns null when tag not found', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({ data: mockTagsResponse }),
        }), 0);
      });

      const result = await getTagByName('NonexistentTag');

      expect(result).toBeNull();
      expect(debugLog).toHaveBeenCalledWith('Tag not found: NonexistentTag');
    });

    test('throws error when tagName is null', async () => {
      await expect(getTagByName(null))
        .rejects
        .toThrow('Tag name is required and must be a string');
    });

    test('throws error when tagName is undefined', async () => {
      await expect(getTagByName(undefined))
        .rejects
        .toThrow('Tag name is required and must be a string');
    });

    test('throws error when tagName is empty string', async () => {
      await expect(getTagByName(''))
        .rejects
        .toThrow('Tag name is required and must be a string');
    });

    test('throws error when tagName is not a string', async () => {
      await expect(getTagByName(123))
        .rejects
        .toThrow('Tag name is required and must be a string');

      await expect(getTagByName({}))
        .rejects
        .toThrow('Tag name is required and must be a string');
    });

    test('handles authentication errors', async () => {
      authService.checkMonarchAuth.mockReturnValue({
        authenticated: false,
        token: null,
      });

      await expect(getTagByName('Pending'))
        .rejects
        .toThrow('Monarch token not found.');
    });

    test('handles network errors', async () => {
      const mockError = new Error('Network error');

      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onerror(mockError), 0);
      });

      await expect(getTagByName('Pending'))
        .rejects
        .toThrow('Network error');
    });

    test('returns null when tags list is empty', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({
            data: { householdTransactionTags: [] },
          }),
        }), 0);
      });

      const result = await getTagByName('Pending');

      expect(result).toBeNull();
    });
  });

});
