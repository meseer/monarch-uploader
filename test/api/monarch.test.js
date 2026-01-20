/**
 * @fileoverview Tests for Monarch Money API client
 */

import { jest } from '@jest/globals';
import '../setup';
import {
  callGraphQL,
  callMonarchGraphQL,
  setupMonarchTokenCapture,
  listMonarchAccounts,
  getMonarchInstitutionSettings,
  uploadBalanceToMonarch,
  uploadTransactionsToMonarch,
  resolveMonarchAccountMapping,
  getMonarchCategoriesAndGroups,
  searchSecurities,
  createManualHolding,
  updateHolding,
  getHoldings,
  getTransactionsList,
  getHouseholdTransactionTags,
  getTagByName,
  checkTokenStatus,
  getToken,
  setAccountLogo,
  getFilteredAccounts,
  updateAccount,
  updateTransaction,
  setTransactionTags,
  deleteTransaction,
  getCreditLimit,
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

describe('Monarch API', () => {
  let mockGMXmlHttpRequest;
  let mockGMSetValue;
  let mockGMGetValue;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Setup Greasemonkey mocks
    mockGMXmlHttpRequest = jest.fn();
    mockGMSetValue = jest.fn();
    mockGMGetValue = jest.fn();

    globalThis.GM_xmlhttpRequest = mockGMXmlHttpRequest;
    globalThis.GM_setValue = mockGMSetValue;
    globalThis.GM_getValue = mockGMGetValue;

    // Setup default auth service responses
    authService.checkMonarchAuth.mockReturnValue({
      authenticated: true,
      token: 'test-token-123',
    });
    authService.getMonarchToken.mockReturnValue('test-token-123');

    // Setup default state
    stateManager.getState.mockReturnValue({
      currentAccount: { nickname: 'Test Account', name: 'Test Name' },
    });

    // Mock setTimeout globally to prevent actual delays in timeout tests
    jest.spyOn(global, 'setTimeout').mockImplementation((callback) => {
      callback();
      return 1;
    });
  });

  afterEach(() => {
    // Restore setTimeout
    global.setTimeout.mockRestore?.();
  });

  describe('callGraphQL', () => {
    test('constructs GraphQL request options with authentication', () => {
      const data = { query: 'test query', variables: {} };

      const result = callGraphQL(data);

      expect(authService.checkMonarchAuth).toHaveBeenCalled();
      expect(result).toEqual({
        mode: 'cors',
        method: 'POST',
        headers: {
          accept: '*/*',
          authorization: 'Token test-token-123',
          'content-type': 'application/json',
          origin: 'https://app.monarch.com',
        },
        body: JSON.stringify(data),
      });
    });

    test('throws error when not authenticated', () => {
      authService.checkMonarchAuth.mockReturnValue({
        authenticated: false,
        token: null,
      });

      expect(() => callGraphQL({})).toThrow('Monarch token not found. Please log into Monarch Money in another tab.');
    });
  });

  describe('callMonarchGraphQL', () => {
    test('makes successful GraphQL request', async () => {
      const mockResponse = {
        status: 200,
        responseText: JSON.stringify({ data: { test: 'success' } }),
      };

      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload(mockResponse), 0);
      });

      const result = await callMonarchGraphQL('TestOperation', 'query test', {});

      expect(result).toEqual({ test: 'success' });
      expect(debugLog).toHaveBeenCalledWith('Calling Monarch GraphQL:', {
        operationName: 'TestOperation',
        query: 'query test',
        variables: {},
      });
    });

    test('handles 401 authentication error', async () => {
      const mockResponse = { status: 401 };

      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload(mockResponse), 0);
      });

      await expect(callMonarchGraphQL('TestOperation', 'query test', {}))
        .rejects
        .toThrow('Monarch Auth Error (401): Token was invalid or expired.');

      expect(authService.saveMonarchToken).toHaveBeenCalledWith(null);
      expect(stateManager.setMonarchAuth).toHaveBeenCalledWith(null);
    });

    test('handles non-200 status codes', async () => {
      const mockResponse = { status: 500, statusText: 'Internal Server Error' };

      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload(mockResponse), 0);
      });

      await expect(callMonarchGraphQL('TestOperation', 'query test', {}))
        .rejects
        .toThrow('Monarch API Error: 500');
    });

    test('handles GraphQL errors in response', async () => {
      const mockResponse = {
        status: 200,
        responseText: JSON.stringify({ errors: [{ message: 'GraphQL error' }] }),
      };

      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload(mockResponse), 0);
      });

      await expect(callMonarchGraphQL('TestOperation', 'query test', {}))
        .rejects
        .toThrow('[{"message":"GraphQL error"}]');
    });

    test('handles network errors', async () => {
      const mockError = new Error('Network error');

      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onerror(mockError), 0);
      });

      await expect(callMonarchGraphQL('TestOperation', 'query test', {}))
        .rejects
        .toThrow('Network error');
    });

    test('rejects when not authenticated', async () => {
      authService.checkMonarchAuth.mockReturnValue({
        authenticated: false,
        token: null,
      });

      await expect(callMonarchGraphQL('TestOperation', 'query test', {}))
        .rejects
        .toThrow('Monarch token not found.');

      expect(stateManager.setMonarchAuth).toHaveBeenCalledWith(null);
    });
  });

  describe('setupMonarchTokenCapture', () => {
    test('delegates to auth service', () => {
      authService.setupMonarchTokenCapture.mockReturnValue('test-result');

      const result = setupMonarchTokenCapture();

      expect(authService.setupMonarchTokenCapture).toHaveBeenCalled();
      expect(result).toBe('test-result');
    });
  });

  describe('listMonarchAccounts', () => {
    const mockAccountsResponse = {
      accounts: [
        {
          id: 'account1',
          displayName: 'Brokerage Account',
          type: { name: 'brokerage' },
          isHidden: false,
          hideFromList: false,
        },
        {
          id: 'account2',
          displayName: 'Credit Card',
          type: { name: 'credit' },
          isHidden: false,
          hideFromList: false,
        },
        {
          id: 'account3',
          displayName: 'Hidden Account',
          type: { name: 'brokerage' },
          isHidden: true,
          hideFromList: false,
        },
      ],
    };

    test('lists brokerage accounts by default', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({ data: mockAccountsResponse }),
        }), 0);
      });

      const result = await listMonarchAccounts();

      expect(result).toHaveLength(1);
      expect(result[0].displayName).toBe('Brokerage Account');
      expect(result[0].type.name).toBe('brokerage');
    });

    test('filters accounts by specified type', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({ data: mockAccountsResponse }),
        }), 0);
      });

      const result = await listMonarchAccounts('credit');

      expect(result).toHaveLength(1);
      expect(result[0].displayName).toBe('Credit Card');
      expect(result[0].type.name).toBe('credit');
    });

    test('excludes hidden accounts', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({ data: mockAccountsResponse }),
        }), 0);
      });

      const result = await listMonarchAccounts('brokerage');

      // Should only return the non-hidden brokerage account
      expect(result).toHaveLength(1);
      expect(result[0].displayName).toBe('Brokerage Account');
    });
  });

  describe('getMonarchInstitutionSettings', () => {
    test('retrieves institution settings successfully', async () => {
      const mockData = {
        credentials: [{ id: 'cred1', institution: { name: 'Test Bank' } }],
        accounts: [{ id: 'account1', displayName: 'Test Account' }],
        subscription: { isOnFreeTrial: false },
      };

      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({ data: mockData }),
        }), 0);
      });

      const result = await getMonarchInstitutionSettings();

      expect(result).toEqual(mockData);
      expect(mockGMXmlHttpRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Token test-token-123',
          }),
        }),
      );
    });
  });

  describe('uploadBalanceToMonarch', () => {
    const mockUploadResponse = {
      session_key: 'test-session-key',
      previews: [{ count: 30 }],
    };

    beforeEach(() => {
      // Mock FormData globally
      globalThis.FormData = jest.fn().mockImplementation(() => ({
        append: jest.fn(),
      }));
      globalThis.Blob = jest.fn();
    });

    test('uploads balance successfully', async () => {
      // Mock upload response
      mockGMXmlHttpRequest
        .mockImplementationOnce((options) => {
          setTimeout(() => options.onload({
            status: 200,
            responseText: JSON.stringify(mockUploadResponse),
          }), 0);
        })
        // Mock GraphQL calls for parsing and status checks
        .mockImplementation((options) => {
          const data = JSON.parse(options.data);
          if (data.operationName === 'Web_ParseUploadBalanceHistorySession') {
            setTimeout(() => options.onload({
              status: 200,
              responseText: JSON.stringify({ data: {} }),
            }), 0);
          } else if (data.operationName === 'Web_GetUploadBalanceHistorySession') {
            setTimeout(() => options.onload({
              status: 200,
              responseText: JSON.stringify({
                data: {
                  uploadBalanceHistorySession: { status: 'completed' },
                },
              }),
            }), 0);
          }
        });

      const result = await uploadBalanceToMonarch(
        'monarch123',
        'date,balance\n2024-01-01,1000',
        '2024-01-01',
        '2024-01-31',
      );

      expect(result).toBe(true);
      expect(debugLog).toHaveBeenCalledWith('Starting Monarch balance upload process');
    });

    test('handles upload failure', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 500,
          statusText: 'Server Error',
        }), 0);
      });

      await expect(uploadBalanceToMonarch(
        'monarch123',
        'date,balance\n2024-01-01,1000',
        '2024-01-01',
        '2024-01-31',
      )).rejects.toThrow('Monarch upload failed: 500 Server Error');
    });

    test('throws error when not authenticated', async () => {
      authService.checkMonarchAuth.mockReturnValue({
        authenticated: false,
        token: null,
      });

      await expect(uploadBalanceToMonarch(
        'monarch123',
        'csv-data',
        '2024-01-01',
        '2024-01-31',
      )).rejects.toThrow('Monarch authentication required for uploading balance history');
    });

    test('throws error when no account ID provided', async () => {
      await expect(uploadBalanceToMonarch(
        null,
        'csv-data',
        '2024-01-01',
        '2024-01-31',
      )).rejects.toThrow('Monarch account ID is required for balance upload');
    });

    test('handles processing timeout', async () => {
      // Mock upload response
      mockGMXmlHttpRequest
        .mockImplementationOnce((options) => {
          options.onload({
            status: 200,
            responseText: JSON.stringify(mockUploadResponse),
          });
        })
        // Mock parse call
        .mockImplementationOnce((options) => {
          options.onload({
            status: 200,
            responseText: JSON.stringify({ data: {} }),
          });
        })
        // Mock status checks that always return 'started' (simulating timeout)
        .mockImplementation((options) => {
          options.onload({
            status: 200,
            responseText: JSON.stringify({
              data: {
                uploadBalanceHistorySession: { status: 'started' },
              },
            }),
          });
        });

      await expect(uploadBalanceToMonarch(
        'monarch123',
        'csv-data',
        '2024-01-01',
        '2024-01-31',
      )).rejects.toThrow('Upload processing timeout');
    }, 70000); // Increase timeout to allow for actual retry logic
  });

  describe('uploadTransactionsToMonarch', () => {
    const mockUploadResponse = {
      session_key: 'test-session-key',
    };

    beforeEach(() => {
      // Mock FormData and Blob globally
      globalThis.FormData = jest.fn().mockImplementation(() => ({
        append: jest.fn(),
      }));
      globalThis.Blob = jest.fn();
    });

    test('uploads transactions successfully', async () => {
      // Mock upload response
      mockGMXmlHttpRequest
        .mockImplementationOnce((options) => {
          setTimeout(() => options.onload({
            status: 200,
            responseText: JSON.stringify(mockUploadResponse),
          }), 0);
        })
        // Mock GraphQL calls
        .mockImplementation((options) => {
          const data = JSON.parse(options.data);
          if (data.operationName === 'Web_ParseUploadStatementSession') {
            setTimeout(() => options.onload({
              status: 200,
              responseText: JSON.stringify({ data: {} }),
            }), 0);
          } else if (data.operationName === 'Web_GetUploadStatementSession') {
            setTimeout(() => options.onload({
              status: 200,
              responseText: JSON.stringify({
                data: {
                  uploadStatementSession: {
                    status: 'completed',
                    uploadedStatement: { transactionCount: 5 },
                  },
                },
              }),
            }), 0);
          }
        });

      const result = await uploadTransactionsToMonarch(
        'monarch123',
        'date,description,amount\n2024-01-01,Test,100',
      );

      expect(result).toBe(true);
      expect(debugLog).toHaveBeenCalledWith('Starting Monarch transactions upload process');
    });

    test('handles transaction upload with custom options', async () => {
      // Mock successful responses
      mockGMXmlHttpRequest
        .mockImplementationOnce((options) => {
          setTimeout(() => options.onload({
            status: 200,
            responseText: JSON.stringify(mockUploadResponse),
          }), 0);
        })
        .mockImplementation((options) => {
          const data = JSON.parse(options.data);
          if (data.operationName === 'Web_ParseUploadStatementSession') {
            // Verify the options were passed correctly
            expect(data.variables.input.skipCheckForDuplicates).toBe(true);
            expect(data.variables.input.shouldUpdateBalance).toBe(true);
            setTimeout(() => options.onload({
              status: 200,
              responseText: JSON.stringify({ data: {} }),
            }), 0);
          } else if (data.operationName === 'Web_GetUploadStatementSession') {
            setTimeout(() => options.onload({
              status: 200,
              responseText: JSON.stringify({
                data: {
                  uploadStatementSession: {
                    status: 'completed',
                    uploadedStatement: { transactionCount: 3 },
                  },
                },
              }),
            }), 0);
          }
        });

      const result = await uploadTransactionsToMonarch(
        'monarch123',
        'csv-data',
        'custom-filename.csv',
        true, // shouldUpdateBalance
        true, // skipCheckForDuplicates
      );

      expect(result).toBe(true);
    });

    test('handles upload processing failure', async () => {
      // Mock upload response
      mockGMXmlHttpRequest
        .mockImplementationOnce((options) => {
          options.onload({
            status: 200,
            responseText: JSON.stringify(mockUploadResponse),
          });
        })
        // Mock parse call
        .mockImplementationOnce((options) => {
          options.onload({
            status: 200,
            responseText: JSON.stringify({ data: {} }),
          });
        })
        // Mock failed status check
        .mockImplementation((options) => {
          options.onload({
            status: 200,
            responseText: JSON.stringify({
              data: {
                uploadStatementSession: {
                  status: 'failed',
                  errorMessage: 'Processing failed',
                },
              },
            }),
          });
        });

      await expect(uploadTransactionsToMonarch(
        'monarch123',
        'csv-data',
      )).rejects.toThrow('Monarch transaction upload processing failed: Processing failed');
    });
  });

  describe('resolveMonarchAccountMapping', () => {
    test('returns existing mapping when found', async () => {
      const existingMapping = { id: 'monarch123', displayName: 'Existing Account' };
      mockGMGetValue.mockReturnValue(JSON.stringify(existingMapping));

      const result = await resolveMonarchAccountMapping('inst123', 'prefix_', 'brokerage');

      expect(result).toEqual(existingMapping);
      expect(debugLog).toHaveBeenCalledWith(
        'Found existing mapping: inst123 -> Existing Account',
      );
      expect(mockGMSetValue).not.toHaveBeenCalled();
    });

    test('creates new mapping when none exists', async () => {
      mockGMGetValue.mockReturnValue(null);

      // Mock successful accounts list
      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({
            data: {
              accounts: [{
                id: 'monarch123',
                displayName: 'New Account',
                type: { name: 'brokerage' },
                isHidden: false,
                hideFromList: false,
              }],
            },
          }),
        }), 0);
      });

      const selectedAccount = { id: 'monarch123', displayName: 'Selected Account' };
      const showMonarchAccountSelectorWithCreate = jest.requireMock('../../src/ui/components/accountSelectorWithCreate').showMonarchAccountSelectorWithCreate;
      showMonarchAccountSelectorWithCreate.mockImplementation((accounts, callback) => {
        callback(selectedAccount);
      });

      const result = await resolveMonarchAccountMapping('inst123', 'prefix_', 'brokerage');

      expect(result).toEqual(selectedAccount);
      expect(mockGMSetValue).toHaveBeenCalledWith(
        'prefix_inst123',
        JSON.stringify(selectedAccount),
      );
      expect(showMonarchAccountSelectorWithCreate).toHaveBeenCalled();
    });

    test('returns null when user cancels selection', async () => {
      mockGMGetValue.mockReturnValue(null);

      // Mock successful accounts list
      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({
            data: {
              accounts: [{
                id: 'monarch123',
                displayName: 'Account',
                type: { name: 'brokerage' },
                isHidden: false,
                hideFromList: false,
              }],
            },
          }),
        }), 0);
      });

      const showMonarchAccountSelectorWithCreate = jest.requireMock('../../src/ui/components/accountSelectorWithCreate').showMonarchAccountSelectorWithCreate;
      showMonarchAccountSelectorWithCreate.mockImplementation((accounts, callback) => {
        callback(null); // User cancelled
      });

      const result = await resolveMonarchAccountMapping('inst123', 'prefix_', 'brokerage');

      expect(result).toBeNull();
      expect(debugLog).toHaveBeenCalledWith('User cancelled account mapping selection');
    });

    test('handles error when no accounts found', async () => {
      mockGMGetValue.mockReturnValue(null);

      // Mock empty accounts list
      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({
            data: { accounts: [] },
          }),
        }), 0);
      });

      await expect(resolveMonarchAccountMapping('inst123', 'prefix_', 'credit'))
        .rejects
        .toThrow('No credit card accounts found in Monarch');
    });

    test('handles JSON parsing error for existing mapping', async () => {
      mockGMGetValue.mockReturnValue('invalid-json');

      // Mock successful accounts list
      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({
            data: {
              accounts: [{
                id: 'monarch123',
                displayName: 'Account',
                type: { name: 'brokerage' },
                isHidden: false,
                hideFromList: false,
              }],
            },
          }),
        }), 0);
      });

      const selectedAccount = { id: 'monarch123', displayName: 'Selected Account' };
      const showMonarchAccountSelectorWithCreate = jest.requireMock('../../src/ui/components/accountSelectorWithCreate').showMonarchAccountSelectorWithCreate;
      showMonarchAccountSelectorWithCreate.mockImplementation((accounts, callback) => {
        callback(selectedAccount);
      });

      const result = await resolveMonarchAccountMapping('inst123', 'prefix_', 'brokerage');

      expect(debugLog).toHaveBeenCalledWith(
        'Error parsing existing account mapping, will prompt for new one:',
        expect.any(Error),
      );
      expect(result).toEqual(selectedAccount);
    });
  });

  describe('getMonarchCategoriesAndGroups', () => {
    test('retrieves categories and groups successfully', async () => {
      const mockData = {
        categoryGroups: [{ id: 'group1', name: 'Group 1' }],
        categories: [{ id: 'cat1', name: 'Category 1' }],
      };

      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({ data: mockData }),
        }), 0);
      });

      const result = await getMonarchCategoriesAndGroups();

      expect(result).toEqual(mockData);
      expect(mockGMXmlHttpRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Token test-token-123',
          }),
        }),
      );
    });
  });

  describe('checkTokenStatus', () => {
    test('delegates to auth service', () => {
      const mockStatus = { authenticated: true, token: 'test-token' };
      authService.checkMonarchAuth.mockReturnValue(mockStatus);

      const result = checkTokenStatus();

      expect(authService.checkMonarchAuth).toHaveBeenCalled();
      expect(result).toEqual(mockStatus);
    });
  });

  describe('getToken', () => {
    test('delegates to auth service', () => {
      authService.getMonarchToken.mockReturnValue('test-token');

      const result = getToken();

      expect(authService.getMonarchToken).toHaveBeenCalled();
      expect(result).toBe('test-token');
    });
  });

  describe('Error Handling', () => {
    test('handles missing session key in upload response', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({}), // No session_key
        }), 0);
      });

      await expect(uploadBalanceToMonarch(
        'monarch123',
        'csv-data',
        '2024-01-01',
        '2024-01-31',
      )).rejects.toThrow('Upload failed: Monarch did not return a session key.');
    });

    test('handles unknown upload status', async () => {
      const mockUploadResponse = { session_key: 'test-key', previews: [{ count: 1 }] };

      mockGMXmlHttpRequest
        .mockImplementationOnce((options) => {
          options.onload({
            status: 200,
            responseText: JSON.stringify(mockUploadResponse),
          });
        })
        .mockImplementationOnce((options) => {
          options.onload({
            status: 200,
            responseText: JSON.stringify({ data: {} }),
          });
        })
        .mockImplementation((options) => {
          options.onload({
            status: 200,
            responseText: JSON.stringify({
              data: {
                uploadBalanceHistorySession: { status: 'unknown_status' },
              },
            }),
          });
        });

      await expect(uploadBalanceToMonarch(
        'monarch123',
        'csv-data',
        '2024-01-01',
        '2024-01-31',
      )).rejects.toThrow('Unknown upload status: unknown_status');
    });
  });

  describe('searchSecurities', () => {
    test('searches for securities with default options', async () => {
      const mockSecurities = [
        {
          id: 'sec123',
          name: 'Test Company',
          type: 'equity',
          ticker: 'TEST',
          currentPrice: 100.50,
        },
      ];

      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({
            data: { securities: mockSecurities },
          }),
        }), 0);
      });

      const result = await searchSecurities('TEST');

      expect(result).toEqual(mockSecurities);
      expect(mockGMXmlHttpRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          data: expect.stringContaining('SecuritySearch'),
        }),
      );
    });

    test('searches for securities with custom options', async () => {
      const mockSecurities = [
        { id: 'sec1', ticker: 'AMZN', name: 'Amazon.com Inc.' },
        { id: 'sec2', ticker: 'AMZY', name: 'YieldMax AMZN ETF' },
      ];

      mockGMXmlHttpRequest.mockImplementation((options) => {
        const data = JSON.parse(options.data);
        expect(data.variables.limit).toBe(10);
        expect(data.variables.orderByPopularity).toBe(false);
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({
            data: { securities: mockSecurities },
          }),
        }), 0);
      });

      const result = await searchSecurities('AMZN', {
        limit: 10,
        orderByPopularity: false,
      });

      expect(result).toEqual(mockSecurities);
    });

    test('returns empty array when no securities found', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({
            data: { securities: [] },
          }),
        }), 0);
      });

      const result = await searchSecurities('NONEXISTENT');

      expect(result).toEqual([]);
    });

    test('handles authentication errors', async () => {
      authService.checkMonarchAuth.mockReturnValue({
        authenticated: false,
        token: null,
      });

      await expect(searchSecurities('TEST'))
        .rejects
        .toThrow('Monarch token not found.');
    });
  });

  describe('createManualHolding', () => {
    test('creates manual holding successfully', async () => {
      const mockHolding = {
        id: 'holding123',
        ticker: 'AMZN',
      };

      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({
            data: {
              createManualHolding: {
                holding: mockHolding,
                errors: null,
              },
            },
          }),
        }), 0);
      });

      const result = await createManualHolding('account123', 'security456', 100);

      expect(result).toEqual(mockHolding);
      expect(mockGMXmlHttpRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          data: expect.stringContaining('Common_CreateManualHolding'),
        }),
      );
    });

    test('throws error when creation fails with errors', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({
            data: {
              createManualHolding: {
                holding: null,
                errors: {
                  message: 'Invalid security ID',
                  code: 'INVALID_SECURITY',
                },
              },
            },
          }),
        }), 0);
      });

      await expect(createManualHolding('account123', 'invalid', 100))
        .rejects
        .toThrow('Invalid security ID');
    });

    test('handles network errors', async () => {
      const mockError = new Error('Network error');

      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onerror(mockError), 0);
      });

      await expect(createManualHolding('account123', 'security456', 100))
        .rejects
        .toThrow('Network error');
    });

    test('handles authentication errors', async () => {
      authService.checkMonarchAuth.mockReturnValue({
        authenticated: false,
        token: null,
      });

      await expect(createManualHolding('account123', 'security456', 100))
        .rejects
        .toThrow('Monarch token not found.');
    });
  });

  describe('updateHolding', () => {
    test('updates holding successfully with all fields', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        const data = JSON.parse(options.data);
        expect(data.variables.input).toEqual({
          id: 'holding123',
          quantity: 150,
          costBasis: 200.50,
          securityType: 'equity',
        });

        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({
            data: {
              updateHolding: {
                holding: { id: 'holding123' },
                errors: null,
              },
            },
          }),
        }), 0);
      });

      const result = await updateHolding('holding123', {
        quantity: 150,
        costBasis: 200.50,
        securityType: 'equity',
      });

      expect(result).toBe('holding123');
    });

    test('updates holding with partial fields', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        const data = JSON.parse(options.data);
        expect(data.variables.input).toEqual({
          id: 'holding123',
          quantity: 150,
        });

        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({
            data: {
              updateHolding: {
                holding: { id: 'holding123' },
                errors: null,
              },
            },
          }),
        }), 0);
      });

      const result = await updateHolding('holding123', { quantity: 150 });

      expect(result).toBe('holding123');
    });

    test('throws error when update fails with errors', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({
            data: {
              updateHolding: {
                holding: null,
                errors: {
                  message: 'Invalid quantity',
                  code: 'INVALID_QUANTITY',
                },
              },
            },
          }),
        }), 0);
      });

      await expect(updateHolding('holding123', { quantity: -10 }))
        .rejects
        .toThrow('Invalid quantity');
    });

    test('handles authentication errors', async () => {
      authService.checkMonarchAuth.mockReturnValue({
        authenticated: false,
        token: null,
      });

      await expect(updateHolding('holding123', { quantity: 150 }))
        .rejects
        .toThrow('Monarch token not found.');
    });
  });

  describe('setAccountLogo', () => {
    test('sets account logo successfully', async () => {
      const mockResponse = {
        id: 'account123',
        name: 'Test Account',
        logoUrl: 'https://res.cloudinary.com/monarch-money/image/authenticated/test-logo',
        hasCustomizedLogo: true,
      };

      mockGMXmlHttpRequest.mockImplementation((options) => {
        const data = JSON.parse(options.data);
        expect(data.operationName).toBe('Common_SetAccountLogo');
        expect(data.variables.input.accountId).toBe('account123');
        expect(data.variables.input.cloudinaryPublicId).toBe('production/account_logos/test-logo');

        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({
            data: {
              setAccountLogo: {
                account: mockResponse,
                errors: null,
              },
            },
          }),
        }), 0);
      });

      const result = await setAccountLogo('account123', 'production/account_logos/test-logo');

      expect(result).toEqual(mockResponse);
      expect(debugLog).toHaveBeenCalledWith('Setting account logo:', {
        accountId: 'account123',
        cloudinaryPublicId: 'production/account_logos/test-logo',
      });
      expect(debugLog).toHaveBeenCalledWith(
        'Successfully set logo for account Test Account (ID: account123)',
      );
    });

    test('throws error when accountId is missing', async () => {
      await expect(setAccountLogo(null, 'production/account_logos/test-logo'))
        .rejects
        .toThrow('Account ID is required');
    });

    test('throws error when cloudinaryPublicId is missing', async () => {
      await expect(setAccountLogo('account123', null))
        .rejects
        .toThrow('Cloudinary public ID is required');
    });

    test('throws error when cloudinaryPublicId is empty string', async () => {
      await expect(setAccountLogo('account123', ''))
        .rejects
        .toThrow('Cloudinary public ID is required');
    });

    test('throws error when API returns errors', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({
            data: {
              setAccountLogo: {
                account: null,
                errors: {
                  message: 'Invalid cloudinary public ID',
                  code: 'INVALID_CLOUDINARY_ID',
                },
              },
            },
          }),
        }), 0);
      });

      await expect(setAccountLogo('account123', 'invalid-logo-id'))
        .rejects
        .toThrow('Invalid cloudinary public ID');
    });

    test('throws default error message when API errors have no message', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 200,
          responseText: JSON.stringify({
            data: {
              setAccountLogo: {
                account: null,
                errors: {
                  code: 'UNKNOWN_ERROR',
                },
              },
            },
          }),
        }), 0);
      });

      await expect(setAccountLogo('account123', 'some-logo-id'))
        .rejects
        .toThrow('Failed to set account logo');
    });

    test('handles network errors', async () => {
      const mockError = new Error('Network error');

      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onerror(mockError), 0);
      });

      await expect(setAccountLogo('account123', 'production/account_logos/test-logo'))
        .rejects
        .toThrow('Network error');
    });

    test('handles authentication errors', async () => {
      authService.checkMonarchAuth.mockReturnValue({
        authenticated: false,
        token: null,
      });

      await expect(setAccountLogo('account123', 'production/account_logos/test-logo'))
        .rejects
        .toThrow('Monarch token not found.');
    });

    test('handles 401 authentication error', async () => {
      mockGMXmlHttpRequest.mockImplementation((options) => {
        setTimeout(() => options.onload({
          status: 401,
        }), 0);
      });

      await expect(setAccountLogo('account123', 'production/account_logos/test-logo'))
        .rejects
        .toThrow('Monarch Auth Error (401): Token was invalid or expired.');

      expect(authService.saveMonarchToken).toHaveBeenCalledWith(null);
      expect(stateManager.setMonarchAuth).toHaveBeenCalledWith(null);
    });
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
