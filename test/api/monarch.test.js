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
  checkTokenStatus,
  getToken,
} from '../../src/api/monarch';
import authService from '../../src/services/auth';
import stateManager from '../../src/core/state';
import { debugLog } from '../../src/core/utils';
import { showMonarchAccountSelector } from '../../src/ui/components/accountSelector';

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

jest.mock('../../src/ui/components/accountSelector', () => ({
  showMonarchAccountSelector: jest.fn(),
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
      showMonarchAccountSelector.mockImplementation((accounts, callback) => {
        callback(selectedAccount);
      });

      const result = await resolveMonarchAccountMapping('inst123', 'prefix_', 'brokerage');

      expect(result).toEqual(selectedAccount);
      expect(mockGMSetValue).toHaveBeenCalledWith(
        'prefix_inst123',
        JSON.stringify(selectedAccount),
      );
      expect(showMonarchAccountSelector).toHaveBeenCalled();
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

      showMonarchAccountSelector.mockImplementation((accounts, callback) => {
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
      showMonarchAccountSelector.mockImplementation((accounts, callback) => {
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
});
