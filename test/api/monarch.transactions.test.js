/**
 * Tests for Monarch API - Transaction & Type Functions
 *
 * Covers: updateTransaction, setTransactionTags, deleteTransaction,
 * getAccountsByType, setCreditLimit
 */

import { jest } from '@jest/globals';
import '../setup';
import {
  updateTransaction,
  setTransactionTags,
  deleteTransaction,
  getAccountsByType,
  setCreditLimit,
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

describe('Monarch API - Transactions', () => {
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

  describe('updateTransaction', () => {
    const mockUpdatedTransaction = {
      id: '232589874618203361',
      amount: -5.6,
      pending: false,
      isRecurring: false,
      date: '2026-01-10',
      originalDate: '2026-01-10',
      hideFromReports: false,
      needsReview: false,
      reviewedAt: null,
      reviewedByUser: null,
      plaidName: 'Impark00011928U',
      notes: 'Updated note',
      hasSplitTransactions: false,
      isSplitTransaction: false,
      isManual: true,
      updatedByRetailSync: false,
      splitTransactions: [],
      originalTransaction: null,
      attachments: [],
      account: {
        id: '232004378673314879',
        hideTransactionsFromReports: false,
        ownedByUser: null,
        displayName: 'Wealthsimple Credit Card (6903)',
        icon: 'credit-card',
        logoUrl: null,
        __typename: 'Account',
      },
      category: {
        id: '162625045061467415',
        __typename: 'Category',
      },
      goal: null,
      savingsGoalEvent: null,
      merchant: {
        id: '162626669064519255',
        name: 'Impark',
        transactionCount: 14,
        logoUrl: null,
        hasActiveRecurringStreams: false,
        recurringTransactionStream: null,
        transactionsCount: 14,
        __typename: 'Merchant',
      },
      tags: [],
      needsReviewByUser: null,
      ownedByUser: null,
      ownershipOverriddenAt: null,
      hiddenByAccount: false,
      reviewStatus: null,
      dataProviderDescription: 'Impark00011928U',
      __typename: 'Transaction',
    };

    test('updates transaction amount successfully', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        const data = JSON.parse(options.data);
        expect(data.operationName).toBe('Web_TransactionDrawerUpdateTransaction');
        expect(data.variables.input.id).toBe('232589874618203361');
        expect(data.variables.input.amount).toBe(-5.6);

        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({
            data: {
              updateTransaction: {
                transaction: mockUpdatedTransaction,
                errors: null,
              },
            },
          }),
        }), 0);
      });

      const result = await updateTransaction('232589874618203361', { amount: -5.6 });

      expect(result.id).toBe('232589874618203361');
      expect(result.amount).toBe(-5.6);
      expect(debugLog).toHaveBeenCalledWith('Updating transaction:', {
        id: '232589874618203361',
        amount: -5.6,
      });
      expect(debugLog).toHaveBeenCalledWith('Successfully updated transaction: 232589874618203361');
    });

    test('updates transaction notes successfully', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        const data = JSON.parse(options.data);
        expect(data.variables.input.notes).toBe('Updated note');

        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({
            data: {
              updateTransaction: {
                transaction: mockUpdatedTransaction,
                errors: null,
              },
            },
          }),
        }), 0);
      });

      const result = await updateTransaction('232589874618203361', { notes: 'Updated note' });

      expect(result.notes).toBe('Updated note');
    });

    test('updates multiple fields at once', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        const data = JSON.parse(options.data);
        expect(data.variables.input.id).toBe('232589874618203361');
        expect(data.variables.input.amount).toBe(-10.5);
        expect(data.variables.input.notes).toBe('New note');
        expect(data.variables.input.hideFromReports).toBe(true);

        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({
            data: {
              updateTransaction: {
                transaction: {
                  ...mockUpdatedTransaction,
                  amount: -10.5,
                  notes: 'New note',
                  hideFromReports: true,
                },
                errors: null,
              },
            },
          }),
        }), 0);
      });

      const result = await updateTransaction('232589874618203361', {
        amount: -10.5,
        notes: 'New note',
        hideFromReports: true,
      });

      expect(result.amount).toBe(-10.5);
      expect(result.notes).toBe('New note');
      expect(result.hideFromReports).toBe(true);
    });

    test('updates transaction with ownerUserId null', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        const data = JSON.parse(options.data);
        expect(data.variables.input.ownerUserId).toBeNull();

        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({
            data: {
              updateTransaction: {
                transaction: mockUpdatedTransaction,
                errors: null,
              },
            },
          }),
        }), 0);
      });

      const result = await updateTransaction('232589874618203361', { ownerUserId: null });

      expect(result.id).toBe('232589874618203361');
    });

    test('throws error when transaction ID is missing', async () => {
      await expect(updateTransaction(null, { amount: -5.6 }))
        .rejects
        .toThrow('Transaction ID is required');
    });

    test('throws error when transaction ID is empty string', async () => {
      await expect(updateTransaction('', { amount: -5.6 }))
        .rejects
        .toThrow('Transaction ID is required');
    });

    test('throws error when transaction ID is undefined', async () => {
      await expect(updateTransaction(undefined, { amount: -5.6 }))
        .rejects
        .toThrow('Transaction ID is required');
    });

    test('throws error when API returns validation errors', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({
            data: {
              updateTransaction: {
                transaction: null,
                errors: {
                  message: 'Invalid transaction amount',
                  code: 'INVALID_AMOUNT',
                },
              },
            },
          }),
        }), 0);
      });

      await expect(updateTransaction('232589874618203361', { amount: 'invalid' }))
        .rejects
        .toThrow('Invalid transaction amount');
    });

    test('throws default error message when API errors have no message', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({
            data: {
              updateTransaction: {
                transaction: null,
                errors: {
                  code: 'UNKNOWN_ERROR',
                },
              },
            },
          }),
        }), 0);
      });

      await expect(updateTransaction('232589874618203361', { amount: -5 }))
        .rejects
        .toThrow('Failed to update transaction');
    });

    test('handles authentication errors', async () => {
      authService.checkMonarchAuth.mockReturnValue({
        authenticated: false,
        token: null,
      });

      await expect(updateTransaction('232589874618203361', { amount: -5.6 }))
        .rejects
        .toThrow('Monarch token not found.');
    });

    test('handles 401 authentication error', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 401,
        }), 0);
      });

      await expect(updateTransaction('232589874618203361', { amount: -5.6 }))
        .rejects
        .toThrow('Monarch Auth Error (401): Token was invalid or expired.');

      expect(authService.saveMonarchToken).toHaveBeenCalledWith(null);
      expect(stateManager.setMonarchAuth).toHaveBeenCalledWith(null);
    });

    test('handles network errors', async () => {
      const mockError = new Error('Network error');

      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onerror(mockError), 0);
      });

      await expect(updateTransaction('232589874618203361', { amount: -5.6 }))
        .rejects
        .toThrow('Network error');
    });

    test('works with empty updates object', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        const data = JSON.parse(options.data);
        expect(data.variables.input).toEqual({ id: '232589874618203361' });

        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({
            data: {
              updateTransaction: {
                transaction: mockUpdatedTransaction,
                errors: null,
              },
            },
          }),
        }), 0);
      });

      const result = await updateTransaction('232589874618203361');

      expect(result.id).toBe('232589874618203361');
    });

    test('returns full transaction object', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({
            data: {
              updateTransaction: {
                transaction: mockUpdatedTransaction,
                errors: null,
              },
            },
          }),
        }), 0);
      });

      const result = await updateTransaction('232589874618203361', { amount: -5.6 });

      // Verify full transaction object is returned
      expect(result.id).toBe('232589874618203361');
      expect(result.amount).toBe(-5.6);
      expect(result.pending).toBe(false);
      expect(result.date).toBe('2026-01-10');
      expect(result.plaidName).toBe('Impark00011928U');
      expect(result.notes).toBe('Updated note');
      expect(result.account.displayName).toBe('Wealthsimple Credit Card (6903)');
      expect(result.merchant.name).toBe('Impark');
    });
  });

  describe('setTransactionTags', () => {
    const mockResponse = {
      id: '232589874618203361',
      tags: [],
      __typename: 'Transaction',
    };

    test('removes all tags successfully (empty array)', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        const data = JSON.parse(options.data);
        expect(data.operationName).toBe('Web_SetTransactionTags');
        expect(data.variables.input.transactionId).toBe('232589874618203361');
        expect(data.variables.input.tagIds).toEqual([]);

        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({
            data: {
              setTransactionTags: {
                transaction: mockResponse,
                errors: null,
              },
            },
          }),
        }), 0);
      });

      const result = await setTransactionTags('232589874618203361', []);

      expect(result.id).toBe('232589874618203361');
      expect(result.tags).toEqual([]);
      expect(debugLog).toHaveBeenCalledWith('Setting transaction tags:', {
        transactionId: '232589874618203361',
        tagIds: [],
      });
      expect(debugLog).toHaveBeenCalledWith('Successfully set tags for transaction: 232589874618203361');
    });

    test('sets multiple tags successfully', async () => {
      const responseWithTags = {
        id: '232589874618203361',
        tags: [
          { id: 'tag-id-1', __typename: 'TransactionTag' },
          { id: 'tag-id-2', __typename: 'TransactionTag' },
        ],
        __typename: 'Transaction',
      };

      mockGMXmlHttpRequest.mockImplementation((options) => {
        const data = JSON.parse(options.data);
        expect(data.variables.input.tagIds).toEqual(['tag-id-1', 'tag-id-2']);

        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({
            data: {
              setTransactionTags: {
                transaction: responseWithTags,
                errors: null,
              },
            },
          }),
        }), 0);
      });

      const result = await setTransactionTags('232589874618203361', ['tag-id-1', 'tag-id-2']);

      expect(result.id).toBe('232589874618203361');
      expect(result.tags).toHaveLength(2);
      expect(result.tags[0].id).toBe('tag-id-1');
      expect(result.tags[1].id).toBe('tag-id-2');
    });

    test('sets single tag successfully', async () => {
      const responseWithOneTag = {
        id: '232589874618203361',
        tags: [{ id: 'pending-tag-id', __typename: 'TransactionTag' }],
        __typename: 'Transaction',
      };

      mockGMXmlHttpRequest.mockImplementation((options) => {
        const data = JSON.parse(options.data);
        expect(data.variables.input.tagIds).toEqual(['pending-tag-id']);

        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({
            data: {
              setTransactionTags: {
                transaction: responseWithOneTag,
                errors: null,
              },
            },
          }),
        }), 0);
      });

      const result = await setTransactionTags('232589874618203361', ['pending-tag-id']);

      expect(result.tags).toHaveLength(1);
      expect(result.tags[0].id).toBe('pending-tag-id');
    });

    test('uses empty array as default when tagIds not provided', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        const data = JSON.parse(options.data);
        expect(data.variables.input.tagIds).toEqual([]);

        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({
            data: {
              setTransactionTags: {
                transaction: mockResponse,
                errors: null,
              },
            },
          }),
        }), 0);
      });

      const result = await setTransactionTags('232589874618203361');

      expect(result.tags).toEqual([]);
    });

    test('throws error when transaction ID is missing', async () => {
      await expect(setTransactionTags(null, []))
        .rejects
        .toThrow('Transaction ID is required');
    });

    test('throws error when transaction ID is empty string', async () => {
      await expect(setTransactionTags('', []))
        .rejects
        .toThrow('Transaction ID is required');
    });

    test('throws error when transaction ID is undefined', async () => {
      await expect(setTransactionTags(undefined, []))
        .rejects
        .toThrow('Transaction ID is required');
    });

    test('throws error when tagIds is not an array', async () => {
      await expect(setTransactionTags('232589874618203361', 'not-an-array'))
        .rejects
        .toThrow('tagIds must be an array');

      await expect(setTransactionTags('232589874618203361', { id: 'tag' }))
        .rejects
        .toThrow('tagIds must be an array');

      await expect(setTransactionTags('232589874618203361', 123))
        .rejects
        .toThrow('tagIds must be an array');
    });

    test('throws error when API returns errors', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({
            data: {
              setTransactionTags: {
                transaction: null,
                errors: {
                  message: 'Invalid transaction ID',
                  code: 'INVALID_TRANSACTION',
                },
              },
            },
          }),
        }), 0);
      });

      await expect(setTransactionTags('invalid-id', []))
        .rejects
        .toThrow('Invalid transaction ID');
    });

    test('throws default error message when API errors have no message', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({
            data: {
              setTransactionTags: {
                transaction: null,
                errors: {
                  code: 'UNKNOWN_ERROR',
                },
              },
            },
          }),
        }), 0);
      });

      await expect(setTransactionTags('232589874618203361', []))
        .rejects
        .toThrow('Failed to set transaction tags');
    });

    test('handles authentication errors', async () => {
      authService.checkMonarchAuth.mockReturnValue({
        authenticated: false,
        token: null,
      });

      await expect(setTransactionTags('232589874618203361', []))
        .rejects
        .toThrow('Monarch token not found.');
    });

    test('handles 401 authentication error', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 401,
        }), 0);
      });

      await expect(setTransactionTags('232589874618203361', []))
        .rejects
        .toThrow('Monarch Auth Error (401): Token was invalid or expired.');

      expect(authService.saveMonarchToken).toHaveBeenCalledWith(null);
      expect(stateManager.setMonarchAuth).toHaveBeenCalledWith(null);
    });

    test('handles network errors', async () => {
      const mockError = new Error('Network error');

      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onerror(mockError), 0);
      });

      await expect(setTransactionTags('232589874618203361', []))
        .rejects
        .toThrow('Network error');
    });

    test('handles GraphQL errors', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({
            errors: [{ message: 'GraphQL error' }],
          }),
        }), 0);
      });

      await expect(setTransactionTags('232589874618203361', []))
        .rejects
        .toThrow();
    });
  });

  describe('deleteTransaction', () => {
    test('deletes transaction successfully', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        const data = JSON.parse(options.data);
        expect(data.operationName).toBe('Common_DeleteTransactionMutation');
        expect(data.variables.input.transactionId).toBe('232663379465502547');

        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({
            data: {
              deleteTransaction: {
                deleted: true,
                errors: null,
              },
            },
          }),
        }), 0);
      });

      const result = await deleteTransaction('232663379465502547');

      expect(result).toBe(true);
      expect(debugLog).toHaveBeenCalledWith('Deleting transaction: 232663379465502547');
      expect(debugLog).toHaveBeenCalledWith('Successfully deleted transaction: 232663379465502547');
    });

    test('throws error when transaction ID is missing', async () => {
      await expect(deleteTransaction(null))
        .rejects
        .toThrow('Transaction ID is required');
    });

    test('throws error when transaction ID is empty string', async () => {
      await expect(deleteTransaction(''))
        .rejects
        .toThrow('Transaction ID is required');
    });

    test('throws error when transaction ID is undefined', async () => {
      await expect(deleteTransaction(undefined))
        .rejects
        .toThrow('Transaction ID is required');
    });

    test('throws error when API returns errors', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({
            data: {
              deleteTransaction: {
                deleted: false,
                errors: {
                  message: 'Transaction not found',
                  code: 'NOT_FOUND',
                },
              },
            },
          }),
        }), 0);
      });

      await expect(deleteTransaction('nonexistent'))
        .rejects
        .toThrow('Transaction not found');
    });

    test('throws default error message when API errors have no message', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({
            data: {
              deleteTransaction: {
                deleted: false,
                errors: {
                  code: 'UNKNOWN_ERROR',
                },
              },
            },
          }),
        }), 0);
      });

      await expect(deleteTransaction('232663379465502547'))
        .rejects
        .toThrow('Failed to delete transaction');
    });

    test('handles authentication errors', async () => {
      authService.checkMonarchAuth.mockReturnValue({
        authenticated: false,
        token: null,
      });

      await expect(deleteTransaction('232663379465502547'))
        .rejects
        .toThrow('Monarch token not found.');
    });

    test('handles 401 authentication error', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 401,
        }), 0);
      });

      await expect(deleteTransaction('232663379465502547'))
        .rejects
        .toThrow('Monarch Auth Error (401): Token was invalid or expired.');

      expect(authService.saveMonarchToken).toHaveBeenCalledWith(null);
      expect(stateManager.setMonarchAuth).toHaveBeenCalledWith(null);
    });

    test('handles network errors', async () => {
      const mockError = new Error('Network error');

      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onerror(mockError), 0);
      });

      await expect(deleteTransaction('232663379465502547'))
        .rejects
        .toThrow('Network error');
    });

    test('handles GraphQL errors', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({
            errors: [{ message: 'GraphQL error' }],
          }),
        }), 0);
      });

      await expect(deleteTransaction('232663379465502547'))
        .rejects
        .toThrow();
    });
  });

  describe('getAccountsByType', () => {
    const mockAccountsByTypeResponse = {
      hasAccounts: true,
      accountTypeSummaries: [
        {
          type: { name: 'depository', display: 'Cash', group: 'asset', __typename: 'AccountType' },
          accounts: [
            {
              id: '225927715198893500',
              displayName: 'Tangerine Savings',
              displayBalance: 1500.0,
              signedBalance: 1500.0,
              credential: { id: 'cred123', institution: { id: 'inst1', name: 'Tangerine', __typename: 'Institution' }, __typename: 'Credential' },
              connectionStatus: null,
              syncDisabled: false,
              isHidden: false,
              isAsset: true,
              includeInNetWorth: true,
              order: 1,
              type: { name: 'depository', display: 'Cash', __typename: 'AccountType' },
              icon: 'dollar-sign',
              logoUrl: 'https://example.com/tangerine.png',
              limit: null,
              mask: '1234',
              subtype: { display: 'Savings', __typename: 'AccountSubtype' },
              institution: { id: 'inst1', name: 'Tangerine', logo: 'logo.png', status: 'HEALTHY', __typename: 'Institution' },
              ownedByUser: null,
              businessEntity: null,
              __typename: 'Account',
            },
          ],
          isAsset: true,
          totalDisplayBalance: 1500.0,
          __typename: 'AccountTypeSummary',
        },
        {
          type: { name: 'credit', display: 'Credit Cards', group: 'liability', __typename: 'AccountType' },
          accounts: [
            {
              id: '231996536253873225',
              displayName: 'Wealthsimple CC',
              displayBalance: 500.0,
              signedBalance: -500.0,
              credential: null, // Manual account
              connectionStatus: null,
              syncDisabled: false,
              isHidden: false,
              isAsset: false,
              includeInNetWorth: true,
              order: 2,
              type: { name: 'credit', display: 'Credit Cards', __typename: 'AccountType' },
              icon: 'credit-card',
              logoUrl: null,
              limit: 17000,
              mask: null,
              subtype: { display: 'Credit Card', __typename: 'AccountSubtype' },
              institution: null,
              ownedByUser: null,
              businessEntity: null,
              __typename: 'Account',
            },
          ],
          isAsset: false,
          totalDisplayBalance: 500.0,
          __typename: 'AccountTypeSummary',
        },
      ],
      householdPreferences: {
        id: 'pref123',
        accountGroupOrder: ['depository', 'credit', 'brokerage', 'loan'],
        collaborationToolsEnabled: false,
        __typename: 'HouseholdPreferences',
      },
    };

    test('retrieves accounts grouped by type with default empty filters', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        const data = JSON.parse(options.data);
        expect(data.operationName).toBe('Web_GetAccountsPage');
        expect(data.variables.filters).toEqual({});

        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({ data: mockAccountsByTypeResponse }),
        }), 0);
      });

      const result = await getAccountsByType({});

      expect(result.hasAccounts).toBe(true);
      expect(result.accountTypeSummaries).toHaveLength(2);
      expect(result.householdPreferences.id).toBe('pref123');
    });

    test('returns proper structure with accountTypeSummaries containing accounts', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({ data: mockAccountsByTypeResponse }),
        }), 0);
      });

      const result = await getAccountsByType();

      // Check depository (Cash) summary
      const cashSummary = result.accountTypeSummaries.find((s) => s.type.name === 'depository');
      expect(cashSummary).toBeDefined();
      expect(cashSummary.type.display).toBe('Cash');
      expect(cashSummary.isAsset).toBe(true);
      expect(cashSummary.totalDisplayBalance).toBe(1500.0);
      expect(cashSummary.accounts).toHaveLength(1);
      expect(cashSummary.accounts[0].displayName).toBe('Tangerine Savings');

      // Check credit (Credit Cards) summary
      const creditSummary = result.accountTypeSummaries.find((s) => s.type.name === 'credit');
      expect(creditSummary).toBeDefined();
      expect(creditSummary.type.display).toBe('Credit Cards');
      expect(creditSummary.isAsset).toBe(false);
      expect(creditSummary.totalDisplayBalance).toBe(500.0);
      expect(creditSummary.accounts).toHaveLength(1);
      expect(creditSummary.accounts[0].displayName).toBe('Wealthsimple CC');
    });

    test('identifies manual accounts by null credential', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({ data: mockAccountsByTypeResponse }),
        }), 0);
      });

      const result = await getAccountsByType();

      // Find all accounts across all types
      const allAccounts = result.accountTypeSummaries.flatMap((s) => s.accounts);

      // Connected account has credential
      const connectedAccount = allAccounts.find((a) => a.id === '225927715198893500');
      expect(connectedAccount.credential).not.toBeNull();
      expect(connectedAccount.credential.institution.name).toBe('Tangerine');

      // Manual account has null credential
      const manualAccount = allAccounts.find((a) => a.id === '231996536253873225');
      expect(manualAccount.credential).toBeNull();
    });

    test('returns householdPreferences with accountGroupOrder', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({ data: mockAccountsByTypeResponse }),
        }), 0);
      });

      const result = await getAccountsByType();

      expect(result.householdPreferences).toBeDefined();
      expect(result.householdPreferences.accountGroupOrder).toEqual(['depository', 'credit', 'brokerage', 'loan']);
      expect(result.householdPreferences.collaborationToolsEnabled).toBe(false);
    });

    test('logs debug information about retrieved accounts', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({ data: mockAccountsByTypeResponse }),
        }), 0);
      });

      await getAccountsByType();

      expect(debugLog).toHaveBeenCalledWith('Getting accounts by type with filters:', {});
      expect(debugLog).toHaveBeenCalledWith('Retrieved 2 accounts across 2 types');
    });

    test('handles empty account response', async () => {
      const emptyResponse = {
        hasAccounts: false,
        accountTypeSummaries: [],
        householdPreferences: {
          id: 'pref123',
          accountGroupOrder: [],
          collaborationToolsEnabled: false,
          __typename: 'HouseholdPreferences',
        },
      };

      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({ data: emptyResponse }),
        }), 0);
      });

      const result = await getAccountsByType();

      expect(result.hasAccounts).toBe(false);
      expect(result.accountTypeSummaries).toEqual([]);
    });

    test('handles authentication errors', async () => {
      authService.checkMonarchAuth.mockReturnValue({
        authenticated: false,
        token: null,
      });

      await expect(getAccountsByType())
        .rejects
        .toThrow('Monarch token not found.');
    });

    test('handles network errors', async () => {
      const mockError = new Error('Network error');

      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onerror(mockError), 0);
      });

      await expect(getAccountsByType())
        .rejects
        .toThrow('Network error');
    });

    test('handles 401 authentication error', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 401,
        }), 0);
      });

      await expect(getAccountsByType())
        .rejects
        .toThrow('Monarch Auth Error (401): Token was invalid or expired.');

      expect(authService.saveMonarchToken).toHaveBeenCalledWith(null);
      expect(stateManager.setMonarchAuth).toHaveBeenCalledWith(null);
    });

    test('uses provided filters in request', async () => {
      const customFilters = { includeDeleted: true };

      mockGMXmlHttpRequest.mockImplementation((options) => {
        const data = JSON.parse(options.data);
        expect(data.variables.filters).toEqual(customFilters);

        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({ data: mockAccountsByTypeResponse }),
        }), 0);
      });

      await getAccountsByType(customFilters);
    });
  });

  describe('setCreditLimit', () => {
    const mockCreditAccount = {
      id: 'account123',
      displayName: 'My Credit Card',
      displayBalance: -500,
      dataProvider: '',
      isManual: true,
      deactivatedAt: null,
      includeBalanceInNetWorth: true,
      type: { name: 'credit', display: 'Credit Cards' },
      ownedByUser: null,
      limit: 15000,
    };

    const mockUpdatedAccount = {
      ...mockCreditAccount,
      limit: 20000,
    };

    test('sets new credit limit successfully', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        const data = JSON.parse(options.data);

        if (data.operationName === 'Web_GetFilteredAccounts') {
          // First call - get accounts
          setTimeout(() => options.onload({
            status: 200,
            responseText: JSON.stringify({
              data: { accounts: [mockCreditAccount] },
            }),
          }), 0);
        } else if (data.operationName === 'Common_UpdateAccount') {
          // Second call - update account
          expect(data.variables.input.id).toBe('account123');
          expect(data.variables.input.limit).toBe(20000);
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
        }
      });

      const result = await setCreditLimit('account123', 20000);

      expect(result.limit).toBe(20000);
      expect(debugLog).toHaveBeenCalledWith('Setting credit limit for account account123 to 20000');
    });

    test('throws error when account ID is missing', async () => {
      await expect(setCreditLimit(null, 20000))
        .rejects
        .toThrow('Account ID is required');

      await expect(setCreditLimit('', 20000))
        .rejects
        .toThrow('Account ID is required');
    });

    test('throws error when newLimit is invalid', async () => {
      await expect(setCreditLimit('account123', undefined))
        .rejects
        .toThrow('Valid credit limit value is required');

      await expect(setCreditLimit('account123', null))
        .rejects
        .toThrow('Valid credit limit value is required');

      await expect(setCreditLimit('account123', 'not-a-number'))
        .rejects
        .toThrow('Valid credit limit value is required');
    });

    test('throws error when account not found', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({ data: { accounts: [] } }),
        }), 0);
      });

      await expect(setCreditLimit('nonexistent', 20000))
        .rejects
        .toThrow('Account not found: nonexistent');
    });

    test('throws error when account is not a credit account', async () => {
      const depositoryAccount = {
        id: 'account123',
        displayName: 'Savings',
        type: { name: 'depository', display: 'Cash' },
      };

      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({
            data: { accounts: [depositoryAccount] },
          }),
        }), 0);
      });

      await expect(setCreditLimit('account123', 20000))
        .rejects
        .toThrow('Account account123 is not a credit account (type: depository)');
    });

    test('handles authentication errors', async () => {
      authService.checkMonarchAuth.mockReturnValue({
        authenticated: false,
        token: null,
      });

      await expect(setCreditLimit('account123', 20000))
        .rejects
        .toThrow('Monarch token not found.');
    });

    test('sets limit to zero', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        const data = JSON.parse(options.data);

        if (data.operationName === 'Web_GetFilteredAccounts') {
          setTimeout(() => options.onload({
            status: 200,
            responseText: JSON.stringify({
              data: { accounts: [mockCreditAccount] },
            }),
          }), 0);
        } else if (data.operationName === 'Common_UpdateAccount') {
          expect(data.variables.input.limit).toBe(0);
          setTimeout(() => options.onload({
            status: 200,
            responseText: JSON.stringify({
              data: {
                updateAccount: {
                  account: { ...mockUpdatedAccount, limit: 0 },
                  errors: null,
                },
              },
            }),
          }), 0);
        }
      });

      const result = await setCreditLimit('account123', 0);

      expect(result.limit).toBe(0);
    });
  });
});
