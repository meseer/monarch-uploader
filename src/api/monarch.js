/**
 * Monarch Money API client
 * Handles all communication with Monarch Money's GraphQL API
 */

import { API } from '../core/config';
import { debugLog } from '../core/utils';
import stateManager from '../core/state';
import authService from '../services/auth';
import {
  getTransactionsList,
  getHouseholdTransactionTags,
  getTagByName,
  updateTransaction,
  setTransactionTags,
  deleteTransaction,
} from './monarchTransactions';
import {
  getAccountTypeOptions,
  createManualAccount,
  createManualInvestmentsAccount,
  setAccountLogo,
  getFilteredAccounts,
  updateAccount,
  getAccountsByType,
  validateAndRefreshAccountMapping,
  getCreditLimit,
  setCreditLimit,
} from './monarchAccounts';

/**
 * Construct GraphQL request options
 * @param {Object} data - GraphQL request data
 * @returns {Object} Request options for GM_xmlhttpRequest
 */
export function callGraphQL(data) {
  // Get token from auth service
  const authStatus = authService.checkMonarchAuth();
  if (!authStatus.authenticated) {
    throw new Error('Monarch token not found. Please log into Monarch Money in another tab.');
  }

  // MIGRATION: Use dynamic origin based on current domain
  return {
    mode: 'cors',
    method: 'POST',
    headers: {
      accept: '*/*',
      authorization: `Token ${authStatus.token}`,
      'content-type': 'application/json',
      origin: API.MONARCH_APP_URL,
    },
    body: JSON.stringify(data),
  };
}

/**
 * Execute a GraphQL query to the Monarch API
 * @param {string} operation - Operation name
 * @param {string} query - GraphQL query
 * @param {Object} variables - Query variables
 * @returns {Promise<Object>} Query result
 */
export function callMonarchGraphQL(operation, query, variables) {
  return new Promise((resolve, reject) => {
    // Get token from auth service
    const authStatus = authService.checkMonarchAuth();
    if (!authStatus.authenticated) {
      stateManager.setMonarchAuth(null);
      reject(new Error('Monarch token not found.'));
      return;
    }

    const data = { operationName: operation, query, variables };
    debugLog('Calling Monarch GraphQL:', data);

    // MIGRATION: Use dynamic origin based on current domain
    GM_xmlhttpRequest({
      mode: 'cors',
      method: 'POST',
      url: API.MONARCH_GRAPHQL_URL,
      headers: {
        accept: '*/*',
        'Content-Type': 'application/json',
        Authorization: `Token ${authStatus.token}`,
        origin: API.MONARCH_APP_URL,
      },
      data: JSON.stringify(data),
      onload: (res) => {
        debugLog('Monarch API response:', res);

        if (res.status === 401) {
          // Token is invalid or expired, clear auth state
          authService.saveMonarchToken(null);
          stateManager.setMonarchAuth(null);
          reject(new Error('Monarch Auth Error (401): Token was invalid or expired.'));
          return;
        }
        if (res.status !== 200) {
          reject(new Error(`Monarch API Error: ${res.status}`));
          return;
        }

        const responseData = JSON.parse(res.responseText);
        if (responseData.errors) {
          reject(new Error(JSON.stringify(responseData.errors)));
        } else {
          resolve(responseData.data);
        }
      },
      onerror: (err) => reject(err),
    });
  });
}

/**
 * Setup token capture for Monarch Money
 * Should be called when on Monarch's domain to capture authentication token
 */
export function setupMonarchTokenCapture() {
  // Delegate to auth service
  return authService.setupMonarchTokenCapture();
}

/**
 * List all Monarch accounts
 * @param {string} accountType - Account type to filter for ('brokerage' for investment, 'credit' for credit cards)
 * @returns {Promise<Array>} List of accounts
 */
export async function listMonarchAccounts(accountType = 'brokerage') {
  const { accounts } = await callMonarchGraphQL(
    'GetAccounts',
    `query GetAccounts {
      accounts {
        id
        displayName
        deactivatedAt
        isHidden
        isAsset
        isManual
        mask
        displayLastUpdatedAt
        currentBalance
        displayBalance
        hideFromList
        hideTransactionsFromReports
        includeInNetWorth
        order
        icon
        logoUrl
        deactivatedAt
        type {
          name
          display
          group
        }
        subtype {
          name
          display
        }
      }
    }`,
    {},
  );

  // Filter for specified account type
  return accounts.filter((acc) => acc.type.name === accountType
    && acc.isHidden === false
    && acc.hideFromList === false);
}

/**
 * Upload balance history to Monarch Money
 * @param {string} monarchAccountId - Monarch account ID to upload to
 * @param {string} csvData - CSV data containing balance history
 * @param {string} fromDate - Start date in YYYY-MM-DD format
 * @param {string} toDate - End date in YYYY-MM-DD format
 * @returns {Promise<boolean>} Success status
 */
export async function uploadBalanceToMonarch(monarchAccountId, csvData, fromDate, toDate) {
  try {
    debugLog('Starting Monarch balance upload process');

    // Get auth status
    const authStatus = authService.checkMonarchAuth();
    if (!authStatus.authenticated) {
      throw new Error('Monarch authentication required for uploading balance history');
    }

    if (!monarchAccountId) {
      throw new Error('Monarch account ID is required for balance upload');
    }

    // Create upload filename
    const accountName = stateManager.getState().currentAccount.nickname || 'account';
    const safeAccountName = accountName.replace(/[^a-z0-9_\-\s]/gi, '_').replace(/\s+/g, '_');
    const fileName = `balance_${safeAccountName}_${fromDate}_to_${toDate}.csv`;

    // Create form data
    const formData = new FormData();
    const fileBlob = new Blob([csvData], { type: 'text/csv' });
    formData.append('files', fileBlob, fileName);
    const accountMapping = { [fileName]: monarchAccountId };
    formData.append('account_files_mapping', JSON.stringify(accountMapping));
    formData.append('preview', 'true');

    // Submit the upload
    debugLog('Uploading CSV to Monarch (Step 1/2)');
    // MIGRATION: Use dynamic URLs based on current domain
    const previewResponse = await new Promise((resolve, reject) => GM_xmlhttpRequest({
      mode: 'cors',
      method: 'POST',
      url: API.MONARCH_BALANCE_UPLOAD_URL,
      headers: {
        accept: 'application/json',
        authorization: `Token ${authStatus.token}`,
        origin: API.MONARCH_APP_URL,
      },
      data: formData,
      onload: (res) => resolve(res),
      onerror: (err) => reject(err),
    }));

    if (previewResponse.status !== 200) {
      debugLog('Monarch upload failed with status:', previewResponse.status);
      debugLog('Response:', previewResponse.responseText);
      throw new Error(`Monarch upload failed: ${previewResponse.status} ${previewResponse.statusText}`);
    }

    const response = JSON.parse(previewResponse.responseText);
    debugLog('Monarch upload response:', response);

    if (!response.session_key) {
      debugLog('No session_key in response. Full response:', response);
      throw new Error('Upload failed: Monarch did not return a session key.');
    }

    // Log preview data if available
    if (response.previews && response.previews.length > 0) {
      debugLog(`Upload preview: ${response.previews[0].count} days of data will be uploaded`);
    }

    // Finalize the upload
    debugLog('Finalizing upload (Step 2/2)');
    await callMonarchGraphQL(
      'Web_ParseUploadBalanceHistorySession',
      `mutation Web_ParseUploadBalanceHistorySession($input: ParseBalanceHistoryInput!) {
        parseBalanceHistory(input: $input) {
          uploadBalanceHistorySession {
            ...UploadBalanceHistorySessionFields
            __typename
          }
          __typename
        }
      }
      
      fragment UploadBalanceHistorySessionFields on UploadBalanceHistorySession {
        sessionKey
        status
        __typename
      }`,
      { input: { sessionKey: response.session_key } },
    );

    // Poll for upload completion with retry logic
    debugLog('Waiting for upload processing to complete...');
    const maxRetries = 30; // Maximum number of attempts
    const retryDelay = 2000; // 2 seconds between attempts
    let attempts = 0;

    while (attempts < maxRetries) {
      attempts += 1;

      try {
        const { uploadBalanceHistorySession } = await callMonarchGraphQL(
          'Web_GetUploadBalanceHistorySession',
          `query Web_GetUploadBalanceHistorySession($sessionKey: String!) {
            uploadBalanceHistorySession(sessionKey: $sessionKey) {
              ...UploadBalanceHistorySessionFields
              __typename
            }
          }
          
          fragment UploadBalanceHistorySessionFields on UploadBalanceHistorySession {
            sessionKey
            status
            __typename
          }`,
          { sessionKey: response.session_key },
        );

        debugLog(`Upload status check ${attempts}/${maxRetries}: ${uploadBalanceHistorySession.status}`);

        if (uploadBalanceHistorySession.status === 'completed') {
          const dayCount = response.previews[0].count;
          debugLog(`Successfully uploaded ${dayCount} days of "${accountName}" balance history to Monarch`);
          return true;
        } if (uploadBalanceHistorySession.status === 'failed') {
          throw new Error('Monarch upload processing failed');
        } if (uploadBalanceHistorySession.status === 'started') {
          // Upload is still processing, wait and retry
          if (attempts < maxRetries) {
            debugLog(`Upload still processing, waiting ${retryDelay}ms before next check...`);
            await new Promise((resolve) => {
              setTimeout(resolve, retryDelay);
            });
          }
        } else {
          // Unknown status, treat as error
          throw new Error(`Unknown upload status: ${uploadBalanceHistorySession.status}`);
        }
      } catch (error) {
        // If this is a GraphQL/network error during status check, retry
        if (attempts < maxRetries) {
          debugLog(`Error checking upload status (attempt ${attempts}/${maxRetries}): ${error.message}, retrying...`);
          await new Promise((resolve) => {
            setTimeout(resolve, retryDelay);
          });
        } else {
          // Final attempt failed
          throw error;
        }
      }
    }

    // If we get here, we've exceeded max retries
    const timeoutMsg = `Upload processing timeout - exceeded maximum retry attempts (${maxRetries}). `
      + 'The upload may still be processing in Monarch.';
    throw new Error(timeoutMsg);
  } catch (error) {
    debugLog('Monarch upload failed:', error);
    throw error;
  }
}

/**
 * Upload transactions to Monarch Money
 * @param {string} monarchAccountId - Monarch account ID to upload transactions to
 * @param {string} csvData - CSV data containing transactions
 * @param {string} filename - Optional filename for the upload
 * @param {boolean} shouldUpdateBalance - Whether to update account balance (default: false)
 * @param {boolean} skipCheckForDuplicates - Whether to skip duplicate checking (default: false)
 * @returns {Promise<boolean>} Success status
 */
export async function uploadTransactionsToMonarch(
  monarchAccountId,
  csvData,
  filename = null,
  shouldUpdateBalance = false,
  skipCheckForDuplicates = false,
) {
  try {
    debugLog('Starting Monarch transactions upload process');

    // Get auth status
    const authStatus = authService.checkMonarchAuth();
    if (!authStatus.authenticated) {
      throw new Error('Monarch authentication required for uploading transactions');
    }

    // Generate filename if not provided
    const uploadFilename = filename || `transactions_${new Date().toISOString().split('T')[0]}.csv`;

    // Create form data
    const formData = new FormData();
    const fileBlob = new Blob([csvData], { type: 'text/csv' });
    formData.append('file', fileBlob, uploadFilename);

    // Submit the upload to get session key
    debugLog('Uploading CSV to Monarch transactions endpoint (Step 1/3)');
    // MIGRATION: Use dynamic URLs based on current domain
    const uploadResponse = await new Promise((resolve, reject) => GM_xmlhttpRequest({
      mode: 'cors',
      method: 'POST',
      url: API.MONARCH_TRANSACTIONS_UPLOAD_URL,
      headers: {
        accept: 'application/json',
        authorization: `Token ${authStatus.token}`,
        origin: API.MONARCH_APP_URL,
      },
      data: formData,
      onload: (res) => resolve(res),
      onerror: (err) => reject(err),
    }));

    if (uploadResponse.status !== 200) {
      throw new Error(`Monarch transactions upload failed: ${uploadResponse.statusText}`);
    }

    const response = JSON.parse(uploadResponse.responseText);
    if (!response.session_key) {
      throw new Error('Upload failed: Monarch did not return a session key.');
    }

    debugLog(`Received session key: ${response.session_key}`);

    // Parse the uploaded statement
    debugLog('Parsing uploaded statement (Step 2/3)');
    await callMonarchGraphQL(
      'Web_ParseUploadStatementSession',
      `mutation Web_ParseUploadStatementSession($input: ParseStatementInput!) {
        parseUploadStatementSession(input: $input) {
          uploadStatementSession {
            ...UploadStatementSessionFields
            __typename
          }
          __typename
        }
      }
      
      fragment UploadStatementSessionFields on UploadStatementSession {
        sessionKey
        status
        errorMessage
        skipCheckForDuplicates
        uploadedStatement {
          id
          transactionCount
          __typename
        }
        __typename
      }`,
      {
        input: {
          parserName: 'monarch_csv',
          sessionKey: response.session_key,
          accountId: monarchAccountId,
          skipCheckForDuplicates,
          shouldUpdateBalance,
          allowWarnings: true,
        },
      },
    );

    // Poll for upload completion
    debugLog('Waiting for transaction processing to complete (Step 3/3)...');
    const maxRetries = 30;
    const retryDelay = 2000;
    let attempts = 0;

    while (attempts < maxRetries) {
      attempts += 1;

      try {
        const { uploadStatementSession } = await callMonarchGraphQL(
          'Web_GetUploadStatementSession',
          `query Web_GetUploadStatementSession($sessionKey: String!) {
            uploadStatementSession(sessionKey: $sessionKey) {
              ...UploadStatementSessionFields
              __typename
            }
          }
          
          fragment UploadStatementSessionFields on UploadStatementSession {
            sessionKey
            status
            errorMessage
            skipCheckForDuplicates
            uploadedStatement {
              id
              transactionCount
              __typename
            }
            __typename
          }`,
          { sessionKey: response.session_key },
        );

        debugLog(`Upload status check ${attempts}/${maxRetries}: ${uploadStatementSession.status}`);

        if (uploadStatementSession.status === 'completed') {
          const transactionCount = uploadStatementSession.uploadedStatement?.transactionCount || 0;
          const successMsg = `Successfully uploaded ${transactionCount} transactions to Monarch account ${monarchAccountId}`;
          debugLog(successMsg);
          return true;
        }
        if (uploadStatementSession.status === 'failed') {
          const errorMsg = uploadStatementSession.errorMessage || 'Unknown error';
          throw new Error(`Monarch transaction upload processing failed: ${errorMsg}`);
        }
        if (uploadStatementSession.status === 'started' || uploadStatementSession.status === 'pending') {
          // Upload is still processing, wait and retry
          if (attempts < maxRetries) {
            debugLog(`Upload still processing, waiting ${retryDelay}ms before next check...`);
            await new Promise((resolve) => {
              setTimeout(resolve, retryDelay);
            });
          }
        } else {
          // Unknown status
          throw new Error(`Unknown upload status: ${uploadStatementSession.status}`);
        }
      } catch (error) {
        // If this is a GraphQL/network error during status check, retry
        if (attempts < maxRetries) {
          debugLog(`Error checking upload status (attempt ${attempts}/${maxRetries}): ${error.message}, retrying...`);
          await new Promise((resolve) => {
            setTimeout(resolve, retryDelay);
          });
        } else {
          // Final attempt failed
          throw error;
        }
      }
    }

    // If we get here, we've exceeded max retries
    const timeoutMsg = `Upload processing timeout - exceeded maximum retry attempts (${maxRetries}). `
      + 'The upload may still be processing in Monarch.';
    throw new Error(timeoutMsg);
  } catch (error) {
    debugLog('Monarch transaction upload failed:', error);
    throw error;
  }
}

/**
 * Get categories and category groups from Monarch Money
 * @returns {Promise<Object>} Object containing categoryGroups and categories arrays
 */
export async function getMonarchCategoriesAndGroups() {
  const query = `query ManageGetCategoryGroups {
    categoryGroups {
      id
      name
      order
      type
      __typename
    }
    categories(includeDisabledSystemCategories: true) {
      id
      name
      order
      icon
      isSystemCategory
      systemCategory
      isDisabled
      group {
        id
        type
        name
        __typename
      }
      __typename
    }
  }`;

  return callMonarchGraphQL('ManageGetCategoryGroups', query, {});
}

/**
 * Search for securities by ticker or name
 * @param {string} searchTerm - Search term (ticker or security name)
 * @param {Object} options - Search options
 * @param {number} options.limit - Maximum number of results (default: 5)
 * @param {boolean} options.orderByPopularity - Order results by popularity (default: true)
 * @returns {Promise<Array>} Array of security objects
 */
export async function searchSecurities(searchTerm, options = {}) {
  const { limit = 5, orderByPopularity = true } = options;

  const { securities } = await callMonarchGraphQL(
    'SecuritySearch',
    `query SecuritySearch($search: String!, $limit: Int, $orderByPopularity: Boolean) {
      securities(
        search: $search
        limit: $limit
        orderByPopularity: $orderByPopularity
      ) {
        id
        name
        type
        logo
        ticker
        typeDisplay
        currentPrice
        closingPrice
        oneDayChangeDollars
        oneDayChangePercent
        __typename
      }
    }`,
    {
      search: searchTerm,
      limit,
      orderByPopularity,
    },
  );

  return securities || [];
}

/**
 * Create a new manual holding
 * @param {string} accountId - Monarch account ID
 * @param {string} securityId - Security ID from Monarch
 * @param {number} quantity - Quantity of shares/units
 * @returns {Promise<Object>} Created holding object with id and ticker
 */
export async function createManualHolding(accountId, securityId, quantity) {
  const result = await callMonarchGraphQL(
    'Common_CreateManualHolding',
    `mutation Common_CreateManualHolding($input: CreateManualHoldingInput!) {
      createManualHolding(input: $input) {
        holding {
          id
          ticker
          __typename
        }
        errors {
          ...PayloadErrorFields
          __typename
        }
        __typename
      }
    }
    
    fragment PayloadErrorFields on PayloadError {
      fieldErrors {
        field
        messages
        __typename
      }
      message
      code
      __typename
    }`,
    {
      input: {
        accountId,
        securityId,
        quantity,
      },
    },
  );

  if (result.createManualHolding.errors) {
    const errorMsg = result.createManualHolding.errors.message || 'Failed to create manual holding';
    throw new Error(errorMsg);
  }

  return result.createManualHolding.holding;
}

/**
 * Update an existing holding
 * @param {string} holdingId - Holding ID to update
 * @param {Object} updates - Fields to update
 * @param {number} updates.quantity - Quantity of shares/units
 * @param {number} updates.costBasis - Cost basis per share/unit
 * @param {string} updates.securityType - Security type (equity, etf, cash, etc.)
 * @returns {Promise<string>} Updated holding ID
 */
export async function updateHolding(holdingId, updates) {
  const input = { id: holdingId, ...updates };

  const result = await callMonarchGraphQL(
    'Common_UpdateHolding',
    `mutation Common_UpdateHolding($input: UpdateHoldingInput!) {
      updateHolding(input: $input) {
        errors {
          ...PayloadErrorFields
          __typename
        }
        holding {
          id
          __typename
        }
        __typename
      }
    }
    
    fragment PayloadErrorFields on PayloadError {
      fieldErrors {
        field
        messages
        __typename
      }
      message
      code
      __typename
    }`,
    { input },
  );

  if (result.updateHolding.errors) {
    const errorMsg = result.updateHolding.errors.message || 'Failed to update holding';
    throw new Error(errorMsg);
  }

  return result.updateHolding.holding.id;
}

/**
 * Delete a holding
 * @param {string} holdingId - Holding ID to delete
 * @returns {Promise<boolean>} True if deleted successfully
 */
export async function deleteHolding(holdingId) {
  const result = await callMonarchGraphQL(
    'Common_DeleteHolding',
    `mutation Common_DeleteHolding($id: ID!) {
      deleteHolding(id: $id) {
        deleted
        errors {
          ...PayloadErrorFields
          __typename
        }
        __typename
      }
    }
    
    fragment PayloadErrorFields on PayloadError {
      fieldErrors {
        field
        messages
        __typename
      }
      message
      code
      __typename
    }`,
    { id: holdingId },
  );

  if (result.deleteHolding.errors) {
    const errorMsg = result.deleteHolding.errors.message || 'Failed to delete holding';
    throw new Error(errorMsg);
  }

  return result.deleteHolding.deleted;
}

/**
 * Get holdings for specified accounts
 * @param {Array<string>} accountIds - Array of Monarch account IDs
 * @param {Object} options - Query options
 * @param {boolean} options.includeHiddenHoldings - Include hidden holdings (default: true)
 * @param {string} options.startDate - Start date in YYYY-MM-DD format
 * @param {string} options.endDate - End date in YYYY-MM-DD format
 * @param {number} options.topMoversLimit - Limit for top movers (default: 4)
 * @returns {Promise<Object>} Portfolio holdings data
 */
export async function getHoldings(accountIds, options = {}) {
  const {
    includeHiddenHoldings = true,
    startDate = null,
    endDate = null,
    topMoversLimit = 4,
  } = options;

  const input = {
    accountIds,
    includeHiddenHoldings,
    topMoversLimit,
  };

  if (startDate) input.startDate = startDate;
  if (endDate) input.endDate = endDate;

  const { portfolio } = await callMonarchGraphQL(
    'Web_GetHoldings',
    `query Web_GetHoldings($input: PortfolioInput) {
      portfolio(input: $input) {
        aggregateHoldings {
          edges {
            node {
              id
              quantity
              basis
              totalValue
              securityPriceChangeDollars
              securityPriceChangePercent
              lastSyncedAt
              holdings {
                id
                type
                typeDisplay
                name
                ticker
                closingPrice
                isManual
                closingPriceUpdatedAt
                costBasis
                quantity
                __typename
              }
              security {
                id
                name
                type
                ticker
                typeDisplay
                currentPrice
                currentPriceUpdatedAt
                closingPrice
                oneDayChangePercent
                oneDayChangeDollars
                __typename
              }
              __typename
            }
            __typename
          }
          __typename
        }
        __typename
      }
    }`,
    { input },
  );

  return portfolio;
}

/**
 * @typedef {Object} TransactionFilters
 * @property {string[]} [accounts] - Array of account IDs to filter by
 * @property {string[]} [tags] - Array of tag IDs to filter by
 * @property {string} [startDate] - Start date in YYYY-MM-DD format
 * @property {string} [endDate] - End date in YYYY-MM-DD format
 * @property {string} [transactionVisibility] - Visibility filter ('all_transactions', etc.)
 */

/**
 * @typedef {Object} TransactionCategory
 * @property {string} id - Category ID
 * @property {string} name - Category name
 * @property {string} icon - Category icon emoji
 * @property {Object} group - Category group info
 * @property {string} group.id - Group ID
 * @property {string} group.type - Group type (expense, income, etc.)
 */

/**
 * @typedef {Object} TransactionMerchant
 * @property {string} id - Merchant ID
 * @property {string} name - Merchant name
 * @property {number} transactionsCount - Number of transactions with this merchant
 * @property {string|null} logoUrl - Merchant logo URL
 * @property {Object|null} recurringTransactionStream - Recurring transaction info
 */

/**
 * @typedef {Object} TransactionTag
 * @property {string} id - Tag ID
 * @property {string} name - Tag name
 * @property {string} color - Tag color hex code
 * @property {number} order - Tag display order
 */

/**
 * @typedef {Object} TransactionAccount
 * @property {string} id - Account ID
 * @property {string} displayName - Account display name
 * @property {string} icon - Account icon
 * @property {string|null} logoUrl - Account logo URL
 */

/**
 * @typedef {Object} Transaction
 * @property {string} id - Transaction ID
 * @property {number} amount - Transaction amount (negative for expenses)
 * @property {boolean} pending - Whether transaction is pending
 * @property {string} date - Transaction date in YYYY-MM-DD format
 * @property {boolean} hideFromReports - Hidden from reports
 * @property {boolean} hiddenByAccount - Hidden by account setting
 * @property {string} plaidName - Original name from Plaid
 * @property {string} notes - User notes
 * @property {boolean} isRecurring - Whether transaction is recurring
 * @property {string|null} reviewStatus - Review status
 * @property {boolean} needsReview - Whether transaction needs review
 * @property {boolean} isSplitTransaction - Whether transaction is split
 * @property {string} dataProviderDescription - Description from data provider
 * @property {Array} attachments - Attached files
 * @property {Object|null} goal - Associated goal
 * @property {Object|null} savingsGoalEvent - Savings goal event
 * @property {TransactionCategory} category - Transaction category
 * @property {TransactionMerchant} merchant - Transaction merchant
 * @property {TransactionTag[]} tags - Transaction tags
 * @property {TransactionAccount} account - Transaction account
 * @property {Object|null} ownedByUser - Owner info if shared
 */

/**
 * @typedef {Object} TransactionListResult
 * @property {number} totalCount - Total number of matching transactions
 * @property {number} totalSelectableCount - Number of selectable transactions
 * @property {Transaction[]} results - Array of transaction objects
 */

/**
 * @typedef {Object} GetTransactionsListOptions
 * @property {string[]} accountIds - Array of account IDs to filter by (required)
 * @property {string} startDate - Start date in YYYY-MM-DD format (required)
 * @property {string} endDate - End date in YYYY-MM-DD format (required)
 * @property {string[]} [tags] - Array of tag IDs to filter by
 * @property {number} [limit=100] - Maximum results to return
 * @property {number} [offset=0] - Offset for pagination
 * @property {string} [orderBy='date'] - Field to order by
 * @property {string} [transactionVisibility='all_transactions'] - Visibility filter
 */

/**
 * Check token status and update state
 * @returns {Object} Auth status information
 */
export function checkTokenStatus() {
  return authService.checkMonarchAuth();
}

/**
 * Get token from auth service
 * @returns {string|null} Token if valid
 */
export function getToken() {
  return authService.getMonarchToken();
}

// Re-export functions from sub-modules for named import consumers
export {
  getTransactionsList,
  getHouseholdTransactionTags,
  getTagByName,
  updateTransaction,
  setTransactionTags,
  deleteTransaction,
} from './monarchTransactions';

export {
  getAccountTypeOptions,
  createManualAccount,
  createManualInvestmentsAccount,
  setAccountLogo,
  getFilteredAccounts,
  updateAccount,
  getAccountsByType,
  validateAndRefreshAccountMapping,
  getCreditLimit,
  setCreditLimit,
} from './monarchAccounts';

// Export as default object
export default {
  callGraphQL,
  callGraphQLOperation: callMonarchGraphQL,
  setupTokenCapture: setupMonarchTokenCapture,
  listAccounts: listMonarchAccounts,
  uploadBalance: uploadBalanceToMonarch,
  uploadTransactions: uploadTransactionsToMonarch,
  getCategoriesAndGroups: getMonarchCategoriesAndGroups,
  searchSecurities,
  createManualHolding,
  updateHolding,
  deleteHolding,
  getHoldings,
  getTransactionsList,
  getHouseholdTransactionTags,
  getTagByName,
  checkTokenStatus,
  getToken,
  getAccountTypeOptions,
  createManualAccount,
  createManualInvestmentsAccount,
  setAccountLogo,
  getFilteredAccounts,
  getAccountsByType,
  updateAccount,
  updateTransaction,
  setTransactionTags,
  deleteTransaction,
  getCreditLimit,
  setCreditLimit,
  validateAndRefreshAccountMapping,
};
