/**
 * Tests for Monarch manual account API methods
 */

import { getAccountTypeOptions, createManualAccount } from '../../src/api/monarch';

// Mock dependencies
const mockGM_xmlhttpRequest = jest.fn();
global.GM_xmlhttpRequest = mockGM_xmlhttpRequest;

jest.mock('../../src/services/auth', () => ({
  checkMonarchAuth: jest.fn(() => ({
    authenticated: true,
    token: 'mock-token',
  })),
  saveMonarchToken: jest.fn(),
}));

jest.mock('../../src/core/state', () => ({
  setMonarchAuth: jest.fn(),
}));

jest.mock('../../src/core/utils', () => ({
  debugLog: jest.fn(),
}));

describe('Monarch Manual Account APIs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGM_xmlhttpRequest.mockClear();
  });

  describe('getAccountTypeOptions', () => {
    test('fetches account type options successfully', async () => {
      const mockResponse = {
        accountTypeOptions: [
          {
            type: {
              name: 'credit',
              display: 'Credit Cards',
              group: 'liability',
              possibleSubtypes: [
                {
                  display: 'Credit Card',
                  name: 'credit_card',
                  __typename: 'AccountSubtype',
                },
              ],
              __typename: 'AccountType',
            },
            subtype: {
              name: 'credit_card',
              display: 'Credit Card',
              __typename: 'AccountSubtype',
            },
            __typename: 'AccountTypeOption',
          },
          {
            type: {
              name: 'depository',
              display: 'Cash',
              group: 'asset',
              possibleSubtypes: [
                {
                  display: 'Checking',
                  name: 'checking',
                  __typename: 'AccountSubtype',
                },
                {
                  display: 'Savings',
                  name: 'savings',
                  __typename: 'AccountSubtype',
                },
              ],
              __typename: 'AccountType',
            },
            subtype: null,
            __typename: 'AccountTypeOption',
          },
        ],
      };

      // Mock successful response
      mockGM_xmlhttpRequest.mockImplementation((config) => {
        config.onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await getAccountTypeOptions();

      expect(result).toEqual(mockResponse.accountTypeOptions);
      expect(result).toHaveLength(2);
      expect(result[0].type.name).toBe('credit');
      expect(result[1].type.name).toBe('depository');
    });

    test('returns empty array when no options available', async () => {
      mockGM_xmlhttpRequest.mockImplementation((config) => {
        config.onload({
          status: 200,
          responseText: JSON.stringify({ data: { accountTypeOptions: [] } }),
        });
      });

      const result = await getAccountTypeOptions();

      expect(result).toEqual([]);
    });

    test('handles API errors', async () => {
      mockGM_xmlhttpRequest.mockImplementation((config) => {
        config.onerror(new Error('Network error'));
      });

      await expect(getAccountTypeOptions()).rejects.toThrow();
    });
  });

  describe('createManualAccount', () => {
    test('creates a credit card account successfully', async () => {
      const mockResponse = {
        createManualAccount: {
          account: {
            id: '123456789',
            __typename: 'Account',
          },
          errors: null,
          __typename: 'CreateManualAccountMutation',
        },
      };

      mockGM_xmlhttpRequest.mockImplementation((config) => {
        config.onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const accountData = {
        type: 'credit',
        subtype: 'credit_card',
        name: 'Test Credit Card',
        displayBalance: 0,
        includeInNetWorth: true,
      };

      const result = await createManualAccount(accountData);

      expect(result).toBe('123456789');
    });

    test('creates a checking account successfully', async () => {
      const mockResponse = {
        createManualAccount: {
          account: {
            id: '987654321',
            __typename: 'Account',
          },
          errors: null,
          __typename: 'CreateManualAccountMutation',
        },
      };

      mockGM_xmlhttpRequest.mockImplementation((config) => {
        config.onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const accountData = {
        type: 'depository',
        subtype: 'checking',
        name: 'Test Checking',
        displayBalance: 1000,
        includeInNetWorth: true,
      };

      const result = await createManualAccount(accountData);

      expect(result).toBe('987654321');
    });

    test('throws error when type is missing', async () => {
      const accountData = {
        subtype: 'credit_card',
        name: 'Test Card',
        displayBalance: 0,
        includeInNetWorth: true,
      };

      await expect(createManualAccount(accountData)).rejects.toThrow(
        'Missing required fields: type, subtype, name, displayBalance, and includeInNetWorth are required',
      );
    });

    test('throws error when subtype is missing', async () => {
      const accountData = {
        type: 'credit',
        name: 'Test Card',
        displayBalance: 0,
        includeInNetWorth: true,
      };

      await expect(createManualAccount(accountData)).rejects.toThrow(
        'Missing required fields',
      );
    });

    test('throws error when name is missing', async () => {
      const accountData = {
        type: 'credit',
        subtype: 'credit_card',
        displayBalance: 0,
        includeInNetWorth: true,
      };

      await expect(createManualAccount(accountData)).rejects.toThrow(
        'Missing required fields',
      );
    });

    test('throws error when displayBalance is missing', async () => {
      const accountData = {
        type: 'credit',
        subtype: 'credit_card',
        name: 'Test Card',
        includeInNetWorth: true,
      };

      await expect(createManualAccount(accountData)).rejects.toThrow(
        'Missing required fields',
      );
    });

    test('throws error when includeInNetWorth is missing', async () => {
      const accountData = {
        type: 'credit',
        subtype: 'credit_card',
        name: 'Test Card',
        displayBalance: 0,
      };

      await expect(createManualAccount(accountData)).rejects.toThrow(
        'Missing required fields',
      );
    });

    test('accepts displayBalance of 0', async () => {
      const mockResponse = {
        createManualAccount: {
          account: {
            id: '111111111',
            __typename: 'Account',
          },
          errors: null,
          __typename: 'CreateManualAccountMutation',
        },
      };

      mockGM_xmlhttpRequest.mockImplementation((config) => {
        config.onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const accountData = {
        type: 'credit',
        subtype: 'credit_card',
        name: 'Zero Balance Card',
        displayBalance: 0,
        includeInNetWorth: true,
      };

      const result = await createManualAccount(accountData);

      expect(result).toBe('111111111');
    });

    test('accepts negative displayBalance for liabilities', async () => {
      const mockResponse = {
        createManualAccount: {
          account: {
            id: '222222222',
            __typename: 'Account',
          },
          errors: null,
          __typename: 'CreateManualAccountMutation',
        },
      };

      mockGM_xmlhttpRequest.mockImplementation((config) => {
        config.onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const accountData = {
        type: 'loan',
        subtype: 'mortgage',
        name: 'Home Mortgage',
        displayBalance: -250000,
        includeInNetWorth: true,
      };

      const result = await createManualAccount(accountData);

      expect(result).toBe('222222222');
    });

    test('handles API errors from Monarch', async () => {
      const mockResponse = {
        createManualAccount: {
          account: null,
          errors: {
            message: 'Invalid account type',
            code: 'INVALID_TYPE',
            fieldErrors: [],
            __typename: 'PayloadError',
          },
          __typename: 'CreateManualAccountMutation',
        },
      };

      mockGM_xmlhttpRequest.mockImplementation((config) => {
        config.onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const accountData = {
        type: 'invalid',
        subtype: 'invalid',
        name: 'Test',
        displayBalance: 0,
        includeInNetWorth: true,
      };

      await expect(createManualAccount(accountData)).rejects.toThrow('Invalid account type');
    });

    test('handles network errors', async () => {
      mockGM_xmlhttpRequest.mockImplementation((config) => {
        config.onerror(new Error('Network error'));
      });

      const accountData = {
        type: 'credit',
        subtype: 'credit_card',
        name: 'Test Card',
        displayBalance: 0,
        includeInNetWorth: true,
      };

      await expect(createManualAccount(accountData)).rejects.toThrow();
    });

    test('handles GraphQL errors', async () => {
      mockGM_xmlhttpRequest.mockImplementation((config) => {
        config.onload({
          status: 200,
          responseText: JSON.stringify({ errors: [{ message: 'Token expired' }] }),
        });
      });

      const accountData = {
        type: 'credit',
        subtype: 'credit_card',
        name: 'Test Card',
        displayBalance: 0,
        includeInNetWorth: true,
      };

      await expect(createManualAccount(accountData)).rejects.toThrow();
    });

    test('creates brokerage account', async () => {
      const mockResponse = {
        createManualAccount: {
          account: {
            id: '333333333',
            __typename: 'Account',
          },
          errors: null,
          __typename: 'CreateManualAccountMutation',
        },
      };

      mockGM_xmlhttpRequest.mockImplementation((config) => {
        config.onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const accountData = {
        type: 'brokerage',
        subtype: 'brokerage',
        name: 'Investment Account',
        displayBalance: 50000,
        includeInNetWorth: true,
      };

      const result = await createManualAccount(accountData);

      expect(result).toBe('333333333');
    });

    test('creates account with includeInNetWorth false', async () => {
      const mockResponse = {
        createManualAccount: {
          account: {
            id: '444444444',
            __typename: 'Account',
          },
          errors: null,
          __typename: 'CreateManualAccountMutation',
        },
      };

      mockGM_xmlhttpRequest.mockImplementation((config) => {
        config.onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const accountData = {
        type: 'depository',
        subtype: 'checking',
        name: 'Joint Account',
        displayBalance: 5000,
        includeInNetWorth: false,
      };

      const result = await createManualAccount(accountData);

      expect(result).toBe('444444444');
    });
  });
});
