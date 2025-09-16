/**
 * Monarch API Tests - Simplified version focusing on retry mechanism
 */

import { callMonarchGraphQL, uploadTransactionsToMonarch, getMonarchCategoriesAndGroups } from '../../src/api/monarch';
import authService from '../../src/services/auth';

// Mock dependencies
jest.mock('../../src/services/auth', () => ({
  checkMonarchAuth: jest.fn(),
  saveToken: jest.fn(),
}));

jest.mock('../../src/core/state', () => ({
  getState: jest.fn().mockReturnValue({
    currentAccount: { nickname: 'Test Account' }
  }),
  setMonarchAuth: jest.fn(),
}));

// Mock GM functions
global.GM_xmlhttpRequest = jest.fn();
global.GM_getValue = jest.fn();
global.GM_setValue = jest.fn();
global.console = { log: jest.fn() };

describe('Monarch API Retry Mechanism', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Default auth mock
    authService.checkMonarchAuth.mockReturnValue({
      authenticated: true,
      token: 'test-token'
    });
  });

  describe('callMonarchGraphQL', () => {
    test('should make successful GraphQL call', async () => {
      const mockResponse = {
        data: { uploadBalanceHistorySession: { status: 'completed' } }
      };

      GM_xmlhttpRequest.mockImplementationOnce(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify(mockResponse)
        });
      });

      const result = await callMonarchGraphQL('TestOperation', 'query { test }', {});
      
      expect(result).toEqual(mockResponse.data);
      expect(GM_xmlhttpRequest).toHaveBeenCalledTimes(1);
    });

    test('should handle 401 authentication error', async () => {
      GM_xmlhttpRequest.mockImplementationOnce(({ onload }) => {
        onload({
          status: 401,
          responseText: 'Unauthorized'
        });
      });

      await expect(callMonarchGraphQL('TestOperation', 'query { test }', {}))
        .rejects.toThrow('Monarch Auth Error (401): Token was invalid or expired.');
    });

    test('should handle non-200 status codes', async () => {
      GM_xmlhttpRequest.mockImplementationOnce(({ onload }) => {
        onload({
          status: 500,
          responseText: 'Server Error'
        });
      });

      await expect(callMonarchGraphQL('TestOperation', 'query { test }', {}))
        .rejects.toThrow('Monarch API Error: 500');
    });

    test('should handle GraphQL errors in response', async () => {
      const mockResponse = {
        errors: [{ message: 'GraphQL error' }]
      };

      GM_xmlhttpRequest.mockImplementationOnce(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify(mockResponse)
        });
      });

      await expect(callMonarchGraphQL('TestOperation', 'query { test }', {}))
        .rejects.toThrow();
    });

    test('should handle network errors', async () => {
      GM_xmlhttpRequest.mockImplementationOnce(({ onerror }) => {
        onerror(new Error('Network error'));
      });

      await expect(callMonarchGraphQL('TestOperation', 'query { test }', {}))
        .rejects.toThrow('Network error');
    });
  });

  describe('Upload Status Polling Simulation', () => {
    // This simulates the retry mechanism that would happen in uploadBalanceToMonarch
    const simulateUploadStatusPolling = async (statusSequence, maxRetries = 5, delay = 100) => {
      let attempt = 0;
      
      while (attempt < maxRetries) {
        attempt++;
        
        // Mock the status response for this attempt
        const expectedStatus = statusSequence[Math.min(attempt - 1, statusSequence.length - 1)];
        
        try {
          const mockResponse = {
            data: {
              uploadBalanceHistorySession: {
                sessionKey: 'test-session',
                status: expectedStatus
              }
            }
          };

          GM_xmlhttpRequest.mockImplementationOnce(({ onload }) => {
            onload({
              status: 200,
              responseText: JSON.stringify(mockResponse)
            });
          });

          const result = await callMonarchGraphQL(
            'Web_GetUploadBalanceHistorySession',
            'query { uploadBalanceHistorySession }',
            { sessionKey: 'test-session' }
          );

          const status = result.uploadBalanceHistorySession.status;

          if (status === 'completed') {
            return { success: true, attempts: attempt };
          } else if (status === 'failed') {
            throw new Error('Upload processing failed');
          } else if (status === 'started') {
            // Continue polling
            if (attempt >= maxRetries) {
              throw new Error('Max retries exceeded');
            }
            // In real implementation, we'd wait here
            continue;
          } else {
            throw new Error(`Unknown status: ${status}`);
          }
        } catch (error) {
          if (attempt >= maxRetries) {
            throw error;
          }
          // In real implementation, we'd wait here before retrying
          continue;
        }
      }
      
      throw new Error('Max retries exceeded');
    };

    test('should succeed immediately when status is completed', async () => {
      const result = await simulateUploadStatusPolling(['completed']);
      
      expect(result).toEqual({ success: true, attempts: 1 });
      expect(GM_xmlhttpRequest).toHaveBeenCalledTimes(1);
    });

    test('should retry when status is started then succeed', async () => {
      const result = await simulateUploadStatusPolling(['started', 'started', 'completed']);
      
      expect(result).toEqual({ success: true, attempts: 3 });
      expect(GM_xmlhttpRequest).toHaveBeenCalledTimes(3);
    });

    test('should fail immediately when status is failed', async () => {
      await expect(simulateUploadStatusPolling(['failed']))
        .rejects.toThrow('Upload processing failed');
    });

    test('should timeout after max retries with started status', async () => {
      // All responses return 'started', should timeout
      const statusSequence = Array(6).fill('started'); // More than maxRetries
      
      await expect(simulateUploadStatusPolling(statusSequence, 5))
        .rejects.toThrow('Max retries exceeded');
    });

    test('should handle unknown status as error', async () => {
      await expect(simulateUploadStatusPolling(['unknown-status']))
        .rejects.toThrow('Unknown status: unknown-status');
    });

    test('should retry on network errors then succeed', async () => {
      let callCount = 0;
      
      // First call fails with network error
      GM_xmlhttpRequest.mockImplementationOnce(({ onerror }) => {
        onerror(new Error('Network error'));
      });
      
      // Second call succeeds
      GM_xmlhttpRequest.mockImplementationOnce(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({
            data: {
              uploadBalanceHistorySession: {
                sessionKey: 'test-session',
                status: 'completed'
              }
            }
          })
        });
      });
      
      // Simulate the retry logic manually
      let attempt = 0;
      let result;
      const maxRetries = 3;
      
      while (attempt < maxRetries) {
        attempt++;
        try {
          const response = await callMonarchGraphQL(
            'Web_GetUploadBalanceHistorySession',
            'query { uploadBalanceHistorySession }',
            { sessionKey: 'test-session' }
          );
          
          if (response.uploadBalanceHistorySession.status === 'completed') {
            result = { success: true, attempts: attempt };
            break;
          }
        } catch (error) {
          if (attempt >= maxRetries) {
            throw error;
          }
          // Continue to retry
        }
      }
      
      expect(result).toEqual({ success: true, attempts: 2 });
      expect(GM_xmlhttpRequest).toHaveBeenCalledTimes(2);
    });
  });

  describe('uploadTransactionsToMonarch', () => {
    const mockCSVData = 'Date,Description,Amount\n2025-01-01,Test Transaction,100.00';
    const mockAccountId = '123456';
    
    beforeEach(() => {
      // Reset FormData mock
      global.FormData = jest.fn(() => ({
        append: jest.fn()
      }));
      global.Blob = jest.fn((content, options) => ({
        content: content[0],
        type: options.type
      }));
    });

    test('should successfully upload transactions with default parameters', async () => {
      // Mock upload response with session key
      GM_xmlhttpRequest.mockImplementationOnce(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({
            session_key: 'upload-statement-session-123'
          })
        });
      });

      // Mock parse mutation response
      GM_xmlhttpRequest.mockImplementationOnce(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({
            data: {
              parseUploadStatementSession: {
                uploadStatementSession: {
                  sessionKey: 'upload-statement-session-123',
                  status: 'started'
                }
              }
            }
          })
        });
      });

      // Mock status check - completed
      GM_xmlhttpRequest.mockImplementationOnce(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({
            data: {
              uploadStatementSession: {
                sessionKey: 'upload-statement-session-123',
                status: 'completed',
                uploadedStatement: {
                  id: 'stmt-123',
                  transactionCount: 1
                }
              }
            }
          })
        });
      });

      const result = await uploadTransactionsToMonarch(mockAccountId, mockCSVData);
      
      expect(result).toBe(true);
      expect(GM_xmlhttpRequest).toHaveBeenCalledTimes(3);
      
      // Check the parse mutation was called with correct default parameters
      const parseMutationCall = JSON.parse(GM_xmlhttpRequest.mock.calls[1][0].data);
      expect(parseMutationCall.variables.input).toEqual({
        parserName: 'monarch_csv',
        sessionKey: 'upload-statement-session-123',
        accountId: mockAccountId,
        skipCheckForDuplicates: false,
        shouldUpdateBalance: false,
        allowWarnings: true
      });
    });

    test('should use custom parameters when provided', async () => {
      // Mock upload response
      GM_xmlhttpRequest.mockImplementationOnce(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({
            session_key: 'upload-statement-session-456'
          })
        });
      });

      // Mock parse mutation response
      GM_xmlhttpRequest.mockImplementationOnce(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({
            data: {
              parseUploadStatementSession: {
                uploadStatementSession: {
                  sessionKey: 'upload-statement-session-456',
                  status: 'started'
                }
              }
            }
          })
        });
      });

      // Mock status check - completed
      GM_xmlhttpRequest.mockImplementationOnce(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({
            data: {
              uploadStatementSession: {
                sessionKey: 'upload-statement-session-456',
                status: 'completed',
                uploadedStatement: {
                  id: 'stmt-456',
                  transactionCount: 5
                }
              }
            }
          })
        });
      });

      const result = await uploadTransactionsToMonarch(
        mockAccountId,
        mockCSVData,
        'custom_transactions.csv',
        true,  // shouldUpdateBalance
        true   // skipCheckForDuplicates
      );
      
      expect(result).toBe(true);
      
      // Check custom parameters were used
      const parseMutationCall = JSON.parse(GM_xmlhttpRequest.mock.calls[1][0].data);
      expect(parseMutationCall.variables.input.shouldUpdateBalance).toBe(true);
      expect(parseMutationCall.variables.input.skipCheckForDuplicates).toBe(true);
    });

    test('should handle upload failure', async () => {
      // Mock failed upload response
      GM_xmlhttpRequest.mockImplementationOnce(({ onload }) => {
        onload({
          status: 500,
          statusText: 'Internal Server Error'
        });
      });

      await expect(uploadTransactionsToMonarch(mockAccountId, mockCSVData))
        .rejects.toThrow('Monarch transactions upload failed: Internal Server Error');
      
      expect(GM_xmlhttpRequest).toHaveBeenCalledTimes(1);
    });

    test('should handle missing session key in response', async () => {
      // Mock upload response without session key
      GM_xmlhttpRequest.mockImplementationOnce(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({})
        });
      });

      await expect(uploadTransactionsToMonarch(mockAccountId, mockCSVData))
        .rejects.toThrow('Upload failed: Monarch did not return a session key.');
    });

    test.skip('should handle failed status with error message', async () => {
      // Mock successful upload
      GM_xmlhttpRequest.mockImplementationOnce(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({
            session_key: 'upload-statement-session-789'
          })
        });
      });

      // Mock parse mutation
      GM_xmlhttpRequest.mockImplementationOnce(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({
            data: {
              parseUploadStatementSession: {
                uploadStatementSession: {
                  sessionKey: 'upload-statement-session-789',
                  status: 'started'
                }
              }
            }
          })
        });
      });

      // Mock status check - failed with error message
      GM_xmlhttpRequest.mockImplementationOnce(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({
            data: {
              uploadStatementSession: {
                sessionKey: 'upload-statement-session-789',
                status: 'failed',
                errorMessage: 'Invalid CSV format'
              }
            }
          })
        });
      });

      await expect(uploadTransactionsToMonarch(mockAccountId, mockCSVData))
        .rejects.toThrow('Monarch transaction upload processing failed: Invalid CSV format');
    });

    test('should retry on pending status', async () => {
      // Mock successful upload
      GM_xmlhttpRequest.mockImplementationOnce(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({
            session_key: 'upload-statement-session-999'
          })
        });
      });

      // Mock parse mutation
      GM_xmlhttpRequest.mockImplementationOnce(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({
            data: {
              parseUploadStatementSession: {
                uploadStatementSession: {
                  sessionKey: 'upload-statement-session-999',
                  status: 'started'
                }
              }
            }
          })
        });
      });

      // Mock first status check - pending
      GM_xmlhttpRequest.mockImplementationOnce(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({
            data: {
              uploadStatementSession: {
                sessionKey: 'upload-statement-session-999',
                status: 'pending'
              }
            }
          })
        });
      });

      // Mock second status check - completed
      GM_xmlhttpRequest.mockImplementationOnce(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({
            data: {
              uploadStatementSession: {
                sessionKey: 'upload-statement-session-999',
                status: 'completed',
                uploadedStatement: {
                  id: 'stmt-999',
                  transactionCount: 10
                }
              }
            }
          })
        });
      });

      const result = await uploadTransactionsToMonarch(mockAccountId, mockCSVData);
      
      expect(result).toBe(true);
      expect(GM_xmlhttpRequest).toHaveBeenCalledTimes(4); // upload + parse + 2 status checks
    });

    test('should throw error when authentication is not available', async () => {
      authService.checkMonarchAuth.mockReturnValueOnce({
        authenticated: false
      });

      await expect(uploadTransactionsToMonarch(mockAccountId, mockCSVData))
        .rejects.toThrow('Monarch authentication required for uploading transactions');
      
      expect(GM_xmlhttpRequest).not.toHaveBeenCalled();
    });
  });

  describe('getMonarchCategoriesAndGroups', () => {
    const mockCategoriesResponse = {
      data: {
        categoryGroups: [
          {
            id: "162625045019525024",
            name: "Income",
            order: 0,
            type: "income",
            __typename: "CategoryGroup"
          },
          {
            id: "162625045019525025",
            name: "Gifts & Donations",
            order: 1,
            type: "expense",
            __typename: "CategoryGroup"
          }
        ],
        categories: [
          {
            id: "162625045061467453",
            name: "Advertising & Promotion",
            order: 0,
            icon: "📣",
            isSystemCategory: true,
            systemCategory: "advertising_promotion",
            isDisabled: false,
            group: {
              id: "162625045019525037",
              type: "expense",
              name: "Business",
              __typename: "CategoryGroup"
            },
            __typename: "Category"
          },
          {
            id: "162625045061467411",
            name: "Auto Payment",
            order: 0,
            icon: "🚗",
            isSystemCategory: true,
            systemCategory: "auto_payment",
            isDisabled: false,
            group: {
              id: "162625045019525026",
              type: "expense",
              name: "Auto & Transport",
              __typename: "CategoryGroup"
            },
            __typename: "Category"
          }
        ]
      }
    };

    test('should successfully fetch categories and category groups', async () => {
      GM_xmlhttpRequest.mockImplementationOnce(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify(mockCategoriesResponse)
        });
      });

      const result = await getMonarchCategoriesAndGroups();
      
      expect(result).toEqual(mockCategoriesResponse.data);
      expect(GM_xmlhttpRequest).toHaveBeenCalledTimes(1);
      
      // Verify correct GraphQL query was used
      const callArgs = GM_xmlhttpRequest.mock.calls[0][0];
      const requestData = JSON.parse(callArgs.data);
      
      expect(requestData.operationName).toBe('ManageGetCategoryGroups');
      expect(requestData.variables).toEqual({});
      expect(requestData.query).toContain('query ManageGetCategoryGroups');
      expect(requestData.query).toContain('categoryGroups');
      expect(requestData.query).toContain('categories(includeDisabledSystemCategories: true)');
      expect(requestData.query).toContain('isSystemCategory');
      expect(requestData.query).toContain('systemCategory');
      expect(requestData.query).toContain('isDisabled');
    });

    test('should handle authentication error', async () => {
      authService.checkMonarchAuth.mockReturnValueOnce({
        authenticated: false
      });

      await expect(getMonarchCategoriesAndGroups())
        .rejects.toThrow('Monarch token not found.');
      
      expect(GM_xmlhttpRequest).not.toHaveBeenCalled();
    });

    test('should handle 401 unauthorized response', async () => {
      GM_xmlhttpRequest.mockImplementationOnce(({ onload }) => {
        onload({
          status: 401,
          responseText: 'Unauthorized'
        });
      });

      await expect(getMonarchCategoriesAndGroups())
        .rejects.toThrow('Monarch Auth Error (401): Token was invalid or expired.');
    });

    test('should handle non-200 status codes', async () => {
      GM_xmlhttpRequest.mockImplementationOnce(({ onload }) => {
        onload({
          status: 500,
          responseText: 'Internal Server Error'
        });
      });

      await expect(getMonarchCategoriesAndGroups())
        .rejects.toThrow('Monarch API Error: 500');
    });

    test('should handle GraphQL errors in response', async () => {
      const mockErrorResponse = {
        errors: [
          {
            message: 'Field error in categories',
            locations: [{ line: 10, column: 5 }],
            path: ['categories']
          }
        ]
      };

      GM_xmlhttpRequest.mockImplementationOnce(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify(mockErrorResponse)
        });
      });

      await expect(getMonarchCategoriesAndGroups())
        .rejects.toThrow();
    });

    test('should handle network errors', async () => {
      GM_xmlhttpRequest.mockImplementationOnce(({ onerror }) => {
        onerror(new Error('Network connection failed'));
      });

      await expect(getMonarchCategoriesAndGroups())
        .rejects.toThrow('Network connection failed');
    });

    test('should return empty arrays when no categories exist', async () => {
      const emptyResponse = {
        data: {
          categoryGroups: [],
          categories: []
        }
      };

      GM_xmlhttpRequest.mockImplementationOnce(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify(emptyResponse)
        });
      });

      const result = await getMonarchCategoriesAndGroups();
      
      expect(result).toEqual({
        categoryGroups: [],
        categories: []
      });
      expect(GM_xmlhttpRequest).toHaveBeenCalledTimes(1);
    });

    test('should handle partial response with missing fields', async () => {
      const partialResponse = {
        data: {
          categoryGroups: [
            {
              id: "162625045019525024",
              name: "Income",
              order: 0,
              type: "income",
              __typename: "CategoryGroup"
            }
          ],
          categories: [
            {
              id: "162625045061467453",
              name: "Advertising & Promotion",
              order: 0,
              // Missing some optional fields like icon, isSystemCategory, etc.
              group: {
                id: "162625045019525037",
                type: "expense",
                name: "Business",
                __typename: "CategoryGroup"
              },
              __typename: "Category"
            }
          ]
        }
      };

      GM_xmlhttpRequest.mockImplementationOnce(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify(partialResponse)
        });
      });

      const result = await getMonarchCategoriesAndGroups();
      
      expect(result).toEqual(partialResponse.data);
      expect(result.categoryGroups).toHaveLength(1);
      expect(result.categories).toHaveLength(1);
      expect(result.categories[0].name).toBe('Advertising & Promotion');
    });

    test('should use correct request headers and URL', async () => {
      GM_xmlhttpRequest.mockImplementationOnce(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify(mockCategoriesResponse)
        });
      });

      await getMonarchCategoriesAndGroups();
      
      const callArgs = GM_xmlhttpRequest.mock.calls[0][0];
      
      expect(callArgs.method).toBe('POST');
      expect(callArgs.url).toBe('https://api.monarchmoney.com/graphql');
      expect(callArgs.headers['Content-Type']).toBe('application/json');
      expect(callArgs.headers.Authorization).toBe('Token test-token');
      expect(callArgs.headers.origin).toBe('https://app.monarchmoney.com');
      expect(callArgs.mode).toBe('cors');
    });
  });
});
