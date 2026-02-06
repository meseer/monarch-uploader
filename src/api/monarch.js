/**
 * Monarch Money API client
 * Handles all communication with Monarch Money's GraphQL API
 */

import { API } from '../core/config';
import { debugLog } from '../core/utils';
import stateManager from '../core/state';
import authService from '../services/auth';
import { showMonarchAccountSelectorWithCreate } from '../ui/components/accountSelectorWithCreate';

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
 * Get institution settings and account data from Monarch
 * @returns {Promise<Object>} Institution settings and account data
 */
export async function getMonarchInstitutionSettings() {
  const query = `query Web_GetInstitutionSettings {
    credentials {
      id
      ...CredentialSettingsCardFields
      __typename
    }
    accounts(filters: {includeDeleted: true}) {
      id
      displayName
      subtype {
        display
        __typename
      }
      mask
      credential {
        id
        __typename
      }
      deletedAt
      __typename
    }
    subscription {
      isOnFreeTrial
      hasPremiumEntitlement
      __typename
    }
  }
  
  fragment InstitutionLogoWithStatusFields on Credential {
    dataProvider
    updateRequired
    institution {
      hasIssuesReported
      logo
      status
      balanceStatus
      transactionsStatus
      __typename
    }
    __typename
  }
  
  fragment InstitutionInfoFields on Credential {
    id
    displayLastUpdatedAt
    dataProvider
    updateRequired
    disconnectedFromDataProviderAt
    syncDisabledAt
    syncDisabledReason
    ...InstitutionLogoWithStatusFields
    institution {
      id
      name
      newConnectionsDisabled
      hasIssuesReported
      hasIssuesReportedMessage
      __typename
    }
    __typename
  }
  
  fragment CredentialSettingsCardFields on Credential {
    id
    updateRequired
    disconnectedFromDataProviderAt
    syncDisabledAt
    syncDisabledReason
    ...InstitutionInfoFields
    institution {
      id
      name
      logo
      url
      newConnectionsDisabled
      __typename
    }
    __typename
  }`;

  const variables = {};
  const data = await callMonarchGraphQL('Web_GetInstitutionSettings', query, variables);
  return data;
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
 * Resolve Monarch account mapping for an institution account
 * @param {string} institutionAccountId - The institution's account ID (Questrade, Rogers, etc.)
 * @param {string} storagePrefix - Storage prefix for the mapping (e.g., STORAGE.ACCOUNT_MAPPING_PREFIX)
 * @param {string} accountType - Account type ('brokerage', 'credit', etc.)
 * @returns {Promise<Object|null>} Monarch account object, or null if cancelled
 */
export async function resolveMonarchAccountMapping(institutionAccountId, storagePrefix, accountType = 'brokerage') {
  try {
    debugLog(`Resolving Monarch account mapping for ${institutionAccountId} with type ${accountType}`);

    // Check for existing mapping
    const existingMapping = GM_getValue(`${storagePrefix}${institutionAccountId}`, null);
    if (existingMapping) {
      try {
        const monarchAccount = JSON.parse(existingMapping);
        debugLog(`Found existing mapping: ${institutionAccountId} -> ${monarchAccount.displayName}`);
        return monarchAccount;
      } catch (error) {
        debugLog('Error parsing existing account mapping, will prompt for new one:', error);
        // Fall through to create new mapping
      }
    }

    debugLog('No existing mapping found, showing account selector');

    // Fetch Monarch accounts of the specified type
    const monarchAccounts = await listMonarchAccounts(accountType);
    if (!monarchAccounts || monarchAccounts.length === 0) {
      const accountTypeDisplay = accountType === 'credit' ? 'credit card' : accountType;
      throw new Error(`No ${accountTypeDisplay} accounts found in Monarch. Please ensure you have ${accountTypeDisplay} accounts in Monarch.`);
    }

    // Show account selector and wait for user selection
    const monarchAccount = await new Promise((resolve) => {
      showMonarchAccountSelectorWithCreate(monarchAccounts, resolve, null, accountType, {});
    });

    if (!monarchAccount) {
      // User cancelled selection
      debugLog('User cancelled account mapping selection');
      return null;
    }

    // Save the mapping for future use
    GM_setValue(`${storagePrefix}${institutionAccountId}`, JSON.stringify(monarchAccount));

    const { currentAccount } = stateManager.getState();
    const institutionAccountName = currentAccount.nickname || currentAccount.name || 'Account';

    debugLog(`Saved account mapping: ${institutionAccountName} (${institutionAccountId}) -> ${monarchAccount.displayName} (${monarchAccount.id})`);

    return monarchAccount;
  } catch (error) {
    debugLog('Error resolving Monarch account mapping:', error);
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
 * Get transactions list from Monarch
 * Uses the Web_GetTransactionsList operation to retrieve filtered transactions.
 * @param {GetTransactionsListOptions} options - Query options
 * @returns {Promise<TransactionListResult>} Transaction list with totalCount and results
 * @throws {Error} If required parameters are missing or API call fails
 * @example
 * // Get all transactions for an account in a date range
 * const result = await getTransactionsList({
 *   accountIds: ['232004378673314879'],
 *   startDate: '2025-01-01',
 *   endDate: '2025-12-31'
 * });
 *
 * @example
 * // Get transactions with specific tags
 * const result = await getTransactionsList({
 *   accountIds: ['232004378673314879'],
 *   startDate: '2025-01-01',
 *   endDate: '2025-12-31',
 *   tags: ['162625044964998399'],
 *   limit: 20
 * });
 */
export async function getTransactionsList(options) {
  const {
    accountIds,
    startDate,
    endDate,
    tags = null,
    limit = 100,
    offset = 0,
    orderBy = 'date',
    transactionVisibility = 'all_transactions',
  } = options || {};

  // Validate required parameters
  if (!accountIds || !Array.isArray(accountIds) || accountIds.length === 0) {
    throw new Error('accountIds is required and must be a non-empty array');
  }

  if (!startDate) {
    throw new Error('startDate is required (format: YYYY-MM-DD)');
  }

  if (!endDate) {
    throw new Error('endDate is required (format: YYYY-MM-DD)');
  }

  // Build filters object
  const filters = {
    accounts: accountIds,
    startDate,
    endDate,
    transactionVisibility,
  };

  // Add optional tags filter
  if (tags && Array.isArray(tags) && tags.length > 0) {
    filters.tags = tags;
  }

  debugLog('Getting transactions list with filters:', filters);

  const query = `query Web_GetTransactionsList($offset: Int, $limit: Int, $filters: TransactionFilterInput, $orderBy: TransactionOrdering) {
  allTransactions(filters: $filters) {
    totalCount
    totalSelectableCount
    results(offset: $offset, limit: $limit, orderBy: $orderBy) {
      id
      ...TransactionOverviewFields
      __typename
    }
    __typename
  }
}

fragment TransactionOverviewFields on Transaction {
  id
  amount
  pending
  date
  hideFromReports
  hiddenByAccount
  plaidName
  notes
  isRecurring
  reviewStatus
  needsReview
  isSplitTransaction
  dataProviderDescription
  attachments {
    id
    __typename
  }
  goal {
    id
    name
    __typename
  }
  savingsGoalEvent {
    id
    goal {
      id
      name
      __typename
    }
    __typename
  }
  category {
    id
    name
    icon
    group {
      id
      type
      __typename
    }
    __typename
  }
  merchant {
    name
    id
    transactionsCount
    logoUrl
    recurringTransactionStream {
      frequency
      isActive
      __typename
    }
    __typename
  }
  tags {
    id
    name
    color
    order
    __typename
  }
  account {
    id
    displayName
    icon
    logoUrl
    __typename
  }
  ownedByUser {
    id
    displayName
    profilePictureUrl
    __typename
  }
  __typename
}`;

  const variables = {
    offset,
    limit,
    filters,
    orderBy,
  };

  const data = await callMonarchGraphQL('Web_GetTransactionsList', query, variables);

  debugLog(`Retrieved ${data.allTransactions.results.length} transactions (total: ${data.allTransactions.totalCount})`);

  return {
    totalCount: data.allTransactions.totalCount,
    totalSelectableCount: data.allTransactions.totalSelectableCount,
    results: data.allTransactions.results,
  };
}

/**
 * @typedef {Object} HouseholdTransactionTag
 * @property {string} id - Tag ID
 * @property {string} name - Tag name
 * @property {string} color - Tag color hex code
 * @property {number} order - Tag display order
 * @property {number} [transactionCount] - Number of transactions with this tag (if includeTransactionCount is true)
 */

/**
 * @typedef {Object} GetHouseholdTransactionTagsOptions
 * @property {string} [search] - Search term to filter tags by name
 * @property {number} [limit] - Maximum number of tags to return
 * @property {Object} [bulkParams] - Bulk transaction data params
 * @property {boolean} [includeTransactionCount=false] - Whether to include transaction count for each tag
 */

/**
 * Get household transaction tags from Monarch
 * @param {GetHouseholdTransactionTagsOptions} options - Query options
 * @returns {Promise<HouseholdTransactionTag[]>} Array of transaction tags
 * @example
 * // Get all tags
 * const tags = await getHouseholdTransactionTags();
 *
 * @example
 * // Search for tags
 * const tags = await getHouseholdTransactionTags({ search: 'Pending', limit: 5 });
 *
 * @example
 * // Include transaction counts
 * const tags = await getHouseholdTransactionTags({ includeTransactionCount: true });
 */
export async function getHouseholdTransactionTags(options = {}) {
  const {
    search = null,
    limit = null,
    bulkParams = null,
    includeTransactionCount = false,
  } = options;

  const variables = {
    includeTransactionCount,
  };

  if (search !== null) {
    variables.search = search;
  }

  if (limit !== null) {
    variables.limit = limit;
  }

  if (bulkParams !== null) {
    variables.bulkParams = bulkParams;
  }

  debugLog('Getting household transaction tags with options:', variables);

  const query = `query Common_GetHouseholdTransactionTags($search: String, $limit: Int, $bulkParams: BulkTransactionDataParams, $includeTransactionCount: Boolean = false) {
  householdTransactionTags(
    search: $search
    limit: $limit
    bulkParams: $bulkParams
  ) {
    id
    name
    color
    order
    transactionCount @include(if: $includeTransactionCount)
    __typename
  }
}`;

  const data = await callMonarchGraphQL('Common_GetHouseholdTransactionTags', query, variables);

  debugLog(`Retrieved ${data.householdTransactionTags?.length || 0} transaction tags`);

  return data.householdTransactionTags || [];
}

/**
 * Get a tag by name (case-insensitive)
 * @param {string} tagName - Tag name to search for
 * @returns {Promise<HouseholdTransactionTag|null>} Tag object or null if not found
 * @example
 * // Find the "Pending" tag
 * const pendingTag = await getTagByName('Pending');
 * if (pendingTag) {
 *   console.log(`Found tag with ID: ${pendingTag.id}`);
 * }
 */
export async function getTagByName(tagName) {
  if (!tagName || typeof tagName !== 'string') {
    throw new Error('Tag name is required and must be a string');
  }

  debugLog(`Looking up tag by name: ${tagName}`);

  const tags = await getHouseholdTransactionTags();
  const normalizedSearchName = tagName.toLowerCase().trim();

  const matchingTag = tags.find(
    (tag) => tag.name.toLowerCase().trim() === normalizedSearchName,
  );

  if (matchingTag) {
    debugLog(`Found tag: ${matchingTag.name} (ID: ${matchingTag.id})`);
  } else {
    debugLog(`Tag not found: ${tagName}`);
  }

  return matchingTag || null;
}

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

/**
 * @typedef {Object} AccountSubtype
 * @property {string} name - Subtype name (e.g., 'credit_card', 'checking')
 * @property {string} display - Display name (e.g., 'Credit Card', 'Checking')
 * @property {string} __typename - GraphQL typename
 */

/**
 * @typedef {Object} AccountType
 * @property {string} name - Type name (e.g., 'credit', 'depository', 'brokerage')
 * @property {string} display - Display name (e.g., 'Credit Cards', 'Cash', 'Investments')
 * @property {string} group - Group classification ('asset' or 'liability')
 * @property {AccountSubtype[]} possibleSubtypes - Array of possible subtypes for this type
 * @property {string} __typename - GraphQL typename
 */

/**
 * @typedef {Object} AccountTypeOption
 * @property {AccountType} type - Account type details
 * @property {AccountSubtype|null} subtype - Default subtype if applicable, null otherwise
 * @property {string} __typename - GraphQL typename
 */

/**
 * @typedef {Object} AccountTypeOptionsResponse
 * @property {AccountTypeOption[]} accountTypeOptions - Array of all available account type options
 */

/**
 * Get available account type options from Monarch
 * Returns all account types (Cash, Investments, Real Estate, Vehicles, Valuables, Credit Cards, Loans, etc.)
 * along with their possible subtypes. Useful for displaying account type dropdowns when creating manual accounts.
 * @returns {Promise<AccountTypeOption[]>} Array of account type options with their subtypes
 * @example
 * const options = await getAccountTypeOptions();
 * // Find credit card type
 * const creditOption = options.find(opt => opt.type.name === 'credit');
 * // creditOption.type.possibleSubtypes will contain ['credit_card']
 */
export async function getAccountTypeOptions() {
  const data = await callMonarchGraphQL(
    'Common_GetAccountTypeOptions',
    `query Common_GetAccountTypeOptions {
      accountTypeOptions {
        type {
          name
          display
          group
          possibleSubtypes {
            display
            name
            __typename
          }
          __typename
        }
        subtype {
          name
          display
          __typename
        }
        __typename
      }
    }`,
    {},
  );

  return data.accountTypeOptions;
}

/**
 * @typedef {Object} CreateManualAccountInput
 * @property {string} type - Account type (e.g., 'credit', 'depository', 'brokerage', 'loan')
 * @property {string} subtype - Account subtype (e.g., 'credit_card', 'checking', 'mortgage')
 * @property {string} name - Display name for the account
 * @property {number} displayBalance - Initial balance (use 0 for new accounts, negative for liabilities)
 * @property {boolean} includeInNetWorth - Whether to include this account in net worth calculations
 */

/**
 * @typedef {Object} InitialHolding
 * @property {string} securityId - Security ID from Monarch
 * @property {number} quantity - Quantity of shares/units
 */

/**
 * @typedef {Object} CreateManualInvestmentsAccountInput
 * @property {string} name - Display name for the account
 * @property {string} subtype - Account subtype (e.g., 'rrsp', 'tfsa', 'brokerage')
 * @property {Array<InitialHolding>} [initialHoldings] - Optional initial holdings array
 */

/**
 * @typedef {Object} PayloadError
 * @property {Array} fieldErrors - Field-specific errors
 * @property {string} message - Error message
 * @property {string} code - Error code
 * @property {string} __typename - GraphQL typename
 */

/**
 * @typedef {Object} CreatedAccount
 * @property {string} id - Created account ID
 * @property {string} __typename - GraphQL typename
 */

/**
 * @typedef {Object} CreateManualAccountResult
 * @property {CreatedAccount} account - Created account information
 * @property {PayloadError|null} errors - Any errors that occurred
 * @property {string} __typename - GraphQL typename
 */

/**
 * Create a new manual account in Monarch
 * @param {CreateManualAccountInput} accountData - Account configuration
 * @returns {Promise<string>} The ID of the created account
 * @throws {Error} If account creation fails or validation errors occur
 * @example
 * // Create a credit card account
 * const accountId = await createManualAccount({
 *   type: 'credit',
 *   subtype: 'credit_card',
 *   name: 'My Credit Card',
 *   displayBalance: 0,
 *   includeInNetWorth: true
 * });
 *
 * @example
 * // Create a checking account
 * const accountId = await createManualAccount({
 *   type: 'depository',
 *   subtype: 'checking',
 *   name: 'My Checking',
 *   displayBalance: 1000,
 *   includeInNetWorth: true
 * });
 */
export async function createManualAccount(accountData) {
  const { type, subtype, name, displayBalance, includeInNetWorth } = accountData;

  // Validate required fields
  if (!type || !subtype || !name || displayBalance === undefined || includeInNetWorth === undefined) {
    throw new Error('Missing required fields: type, subtype, name, displayBalance, and includeInNetWorth are required');
  }

  debugLog('Creating manual account:', accountData);

  const result = await callMonarchGraphQL(
    'Web_CreateManualAccount',
    `mutation Web_CreateManualAccount($input: CreateManualAccountMutationInput!) {
      createManualAccount(input: $input) {
        account {
          id
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
        type,
        subtype,
        name,
        displayBalance,
        includeInNetWorth,
      },
    },
  );

  if (result.createManualAccount.errors) {
    const errorMsg = result.createManualAccount.errors.message || 'Failed to create manual account';
    throw new Error(errorMsg);
  }

  debugLog(`Successfully created manual account: ${name} (ID: ${result.createManualAccount.account.id})`);
  return result.createManualAccount.account.id;
}

/**
 * Create a new manual investments account with holdings tracking
 * This creates an investment account that tracks individual holdings instead of just balance.
 * @param {CreateManualInvestmentsAccountInput} accountData - Account configuration
 * @returns {Promise<string>} The ID of the created account
 * @throws {Error} If account creation fails or validation errors occur
 * @example
 * // Create an RRSP account with holdings tracking
 * const accountId = await createManualInvestmentsAccount({
 *   name: 'RRSP M1',
 *   subtype: 'rrsp'
 * });
 *
 * @example
 * // Create a TFSA account with initial holdings
 * const accountId = await createManualInvestmentsAccount({
 *   name: 'My TFSA',
 *   subtype: 'tfsa',
 *   initialHoldings: [{ securityId: '207550709334431626', quantity: 1 }]
 * });
 */
export async function createManualInvestmentsAccount(accountData) {
  const { name, subtype, initialHoldings } = accountData;

  // Validate required fields
  if (!name || !subtype) {
    throw new Error('Missing required fields: name and subtype are required');
  }

  debugLog('Creating manual investments account:', accountData);

  // If no initial holdings provided, search for CAD cash security to use as placeholder
  let holdingsToUse = initialHoldings;
  if (!holdingsToUse || holdingsToUse.length === 0) {
    debugLog('No initial holdings provided, searching for CAD cash security...');
    const cadSecurities = await searchSecurities('CUR:CAD', { limit: 1 });
    if (!cadSecurities || cadSecurities.length === 0) {
      throw new Error('Could not find CAD cash security (CUR:CAD) for initial holding');
    }
    const cadSecurity = cadSecurities[0];
    debugLog(`Found CAD security: ${cadSecurity.name} (ID: ${cadSecurity.id})`);
    holdingsToUse = [{ securityId: cadSecurity.id, quantity: 1 }];
  }

  const result = await callMonarchGraphQL(
    'Common_CreateManualInvestmentsAccount',
    `mutation Common_CreateManualInvestmentsAccount($input: CreateManualInvestmentsAccountInput!) {
      createManualInvestmentsAccount(input: $input) {
        account {
          id
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
        name,
        subtype,
        manualInvestmentsTrackingMethod: 'holdings',
        initialHoldings: holdingsToUse,
      },
    },
  );

  if (result.createManualInvestmentsAccount.errors) {
    const errorMsg = result.createManualInvestmentsAccount.errors.message || 'Failed to create manual investments account';
    throw new Error(errorMsg);
  }

  debugLog(`Successfully created manual investments account: ${name} (ID: ${result.createManualInvestmentsAccount.account.id})`);
  return result.createManualInvestmentsAccount.account.id;
}

/**
 * @typedef {Object} SetAccountLogoInput
 * @property {string} accountId - Monarch account ID
 * @property {string} cloudinaryPublicId - Cloudinary public ID for the logo image
 */

/**
 * @typedef {Object} SetAccountLogoResult
 * @property {string} id - Account ID
 * @property {string} name - Account name
 * @property {string} logoUrl - URL of the set logo
 * @property {boolean} hasCustomizedLogo - Whether the account has a customized logo
 */

/**
 * Set logo for a Monarch account using a pre-uploaded Cloudinary image
 * @param {string} accountId - Monarch account ID
 * @param {string} cloudinaryPublicId - Cloudinary public ID for the logo
 * @returns {Promise<SetAccountLogoResult>} Updated account with logo information
 * @throws {Error} If logo setting fails
 * @example
 * // Set Wealthsimple logo for an account
 * const result = await setAccountLogo(
 *   '231963875890199554',
 *   'production/account_logos/7f697890-7cb5-4294-9354-faf58db54b69/qpy5muxbdwcuzpq2krap'
 * );
 * console.log(result.logoUrl); // https://res.cloudinary.com/...
 */
export async function setAccountLogo(accountId, cloudinaryPublicId) {
  if (!accountId) {
    throw new Error('Account ID is required');
  }

  if (!cloudinaryPublicId) {
    throw new Error('Cloudinary public ID is required');
  }

  debugLog('Setting account logo:', { accountId, cloudinaryPublicId });

  const result = await callMonarchGraphQL(
    'Common_SetAccountLogo',
    `mutation Common_SetAccountLogo($input: SetAccountLogoInput!) {
      setAccountLogo(input: $input) {
        account {
          id
          name
          logoUrl
          hasCustomizedLogo
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
        cloudinaryPublicId,
      },
    },
  );

  if (result.setAccountLogo.errors) {
    const errorMsg = result.setAccountLogo.errors.message || 'Failed to set account logo';
    throw new Error(errorMsg);
  }

  const account = result.setAccountLogo.account;
  debugLog(`Successfully set logo for account ${account.name} (ID: ${account.id})`);

  return account;
}

/**
 * @typedef {Object} FilteredAccount
 * @property {string} id - Account ID
 * @property {string} createdAt - Account creation timestamp
 * @property {string} displayName - Display name for the account
 * @property {number} displayBalance - Current display balance
 * @property {string} displayLastUpdatedAt - Last update timestamp
 * @property {string} dataProvider - Data provider (e.g., 'plaid', '')
 * @property {string} icon - Icon identifier
 * @property {string|null} logoUrl - Logo URL if available
 * @property {number} order - Display order
 * @property {boolean} isAsset - Whether account is an asset
 * @property {boolean} includeBalanceInNetWorth - Include in net worth calculation
 * @property {string|null} deactivatedAt - Deactivation timestamp if deactivated
 * @property {string|null} manualInvestmentsTrackingMethod - Investment tracking method
 * @property {boolean} isManual - Whether account is manual
 * @property {boolean} syncDisabled - Whether sync is disabled
 * @property {Object} type - Account type info
 * @property {string} type.display - Type display name
 * @property {string} type.name - Type internal name
 * @property {Object|null} credential - Credential info if connected
 * @property {Object|null} institution - Institution info if connected
 * @property {Object|null} ownedByUser - Owner info if shared
 */

/**
 * @typedef {Object} AccountFilters
 * @property {boolean} [includeDeleted] - Include deleted accounts
 * @property {string} [accountType] - Filter by account type
 */

/**
 * Get filtered accounts from Monarch
 * Uses the Web_GetFilteredAccounts operation to retrieve detailed account information.
 * @param {AccountFilters} filters - Optional filters for the query (default: {} for all accounts)
 * @returns {Promise<FilteredAccount[]>} Array of account objects
 * @example
 * // Get all accounts
 * const allAccounts = await getFilteredAccounts({});
 *
 * // Find a specific account by ID
 * const allAccounts = await getFilteredAccounts({});
 * const account = allAccounts.find(acc => acc.id === '123456789');
 */
export async function getFilteredAccounts(filters = {}) {
  const query = `query Web_GetFilteredAccounts($filters: AccountFilters) {
  accounts(filters: $filters) {
    id
    createdAt
    displayName
    displayBalance
    displayLastUpdatedAt
    dataProvider
    icon
    logoUrl
    order
    isAsset
    includeBalanceInNetWorth
    deactivatedAt
    manualInvestmentsTrackingMethod
    isManual
    syncDisabled
    type {
      display
      name
      __typename
    }
    credential {
      updateRequired
      syncDisabledAt
      __typename
    }
    institution {
      status
      newConnectionsDisabled
      __typename
    }
    ownedByUser {
      id
      displayName
      profilePictureUrl
      __typename
    }
    __typename
  }
}`;

  const data = await callMonarchGraphQL('Web_GetFilteredAccounts', query, { filters });
  return data.accounts || [];
}

/**
 * @typedef {Object} UpdateAccountInput
 * @property {string} id - Account ID (required)
 * @property {string} [dataProvider] - Data provider
 * @property {string|null} [dataProviderAccountId] - External account ID
 * @property {string} [name] - Account name
 * @property {string} [type] - Account type (e.g., 'credit', 'depository')
 * @property {string} [subtype] - Account subtype (e.g., 'credit_card', 'checking')
 * @property {number} [displayBalance] - Current balance
 * @property {boolean} [invertSyncedBalance] - Invert synced balance
 * @property {boolean} [useAvailableBalance] - Use available balance
 * @property {boolean} [hideFromList] - Hide from account list
 * @property {boolean} [hideTransactionsFromReports] - Hide transactions from reports
 * @property {boolean} [synced] - Whether account is synced
 * @property {number|null} [apr] - Annual percentage rate
 * @property {number|null} [interestRate] - Interest rate
 * @property {boolean} [excludeFromDebtPaydown] - Exclude from debt paydown
 * @property {string|null} [deactivatedAt] - Deactivation timestamp
 * @property {boolean} [includeInNetWorth] - Include in net worth
 * @property {number|null} [limit] - Credit limit (for credit accounts)
 * @property {number|null} [plannedPayment] - Planned payment amount
 * @property {number|null} [minimumPayment] - Minimum payment amount
 * @property {Object} [recurrence] - Recurrence settings
 * @property {string|null} [ownerUserId] - Owner user ID
 */

/**
 * @typedef {Object} UpdatedAccountResult
 * @property {string} id - Account ID
 * @property {string} displayName - Display name
 * @property {boolean} syncDisabled - Sync disabled status
 * @property {string|null} deactivatedAt - Deactivation timestamp
 * @property {boolean} isHidden - Hidden status
 * @property {boolean} isAsset - Asset status
 * @property {string|null} mask - Account mask
 * @property {string} createdAt - Creation timestamp
 * @property {string} updatedAt - Update timestamp
 * @property {string} displayLastUpdatedAt - Last updated display timestamp
 * @property {number} currentBalance - Current balance
 * @property {number} displayBalance - Display balance
 * @property {boolean} includeInNetWorth - Include in net worth
 * @property {boolean} hideFromList - Hidden from list
 * @property {boolean} hideTransactionsFromReports - Hide transactions from reports
 * @property {boolean} includeBalanceInNetWorth - Include balance in net worth
 * @property {boolean} includeInGoalBalance - Include in goal balance
 * @property {boolean} excludeFromDebtPaydown - Exclude from debt paydown
 * @property {string} dataProvider - Data provider
 * @property {string|null} dataProviderAccountId - External account ID
 * @property {boolean} isManual - Manual account status
 * @property {number} transactionsCount - Transaction count
 * @property {number} holdingsCount - Holdings count
 * @property {string|null} manualInvestmentsTrackingMethod - Investment tracking method
 * @property {number} order - Display order
 * @property {string} icon - Icon identifier
 * @property {string|null} logoUrl - Logo URL
 * @property {number|null} limit - Credit limit
 * @property {number|null} apr - APR
 * @property {number|null} minimumPayment - Minimum payment
 * @property {number|null} plannedPayment - Planned payment
 * @property {number|null} interestRate - Interest rate
 * @property {Object} type - Account type
 * @property {Object|null} subtype - Account subtype
 * @property {Object|null} credential - Credential info
 * @property {Object|null} institution - Institution info
 * @property {Object|null} ownedByUser - Owner info
 * @property {Object|null} connectionStatus - Connection status
 */

/**
 * Update an existing account in Monarch
 * Uses the Common_UpdateAccount mutation to modify account properties.
 * @param {UpdateAccountInput} input - Account update input with id and fields to update
 * @returns {Promise<UpdatedAccountResult>} Updated account object
 * @throws {Error} If account ID is missing or update fails
 * @example
 * // Update credit limit for a credit card account
 * const updatedAccount = await updateAccount({
 *   id: '231838722038464342',
 *   dataProvider: '',
 *   name: 'My Credit Card',
 *   type: 'credit',
 *   subtype: 'credit_card',
 *   displayBalance: 0,
 *   limit: 20000,
 *   includeInNetWorth: true
 * });
 */
export async function updateAccount(input) {
  if (!input || !input.id) {
    throw new Error('Account ID is required for update');
  }

  debugLog('Updating account:', input);

  const query = `mutation Common_UpdateAccount($input: UpdateAccountMutationInput!) {
  updateAccount(input: $input) {
    account {
      ...AccountFields
      __typename
    }
    errors {
      ...PayloadErrorFields
      __typename
    }
    __typename
  }
}

fragment AccountFields on Account {
  id
  displayName
  syncDisabled
  deactivatedAt
  isHidden
  isAsset
  mask
  createdAt
  updatedAt
  displayLastUpdatedAt
  currentBalance
  displayBalance
  includeInNetWorth
  hideFromList
  hideTransactionsFromReports
  includeBalanceInNetWorth
  includeInGoalBalance
  excludeFromDebtPaydown
  dataProvider
  dataProviderAccountId
  isManual
  transactionsCount
  holdingsCount
  manualInvestmentsTrackingMethod
  order
  icon
  logoUrl
  deactivatedAt
  limit
  apr
  minimumPayment
  plannedPayment
  interestRate
  type {
    name
    display
    group
    __typename
  }
  subtype {
    name
    display
    __typename
  }
  credential {
    id
    updateRequired
    syncDisabledAt
    syncDisabledReason
    dataProvider
    institution {
      id
      newConnectionsDisabled
      plaidInstitutionId
      name
      status
      logo
      __typename
    }
    __typename
  }
  institution {
    id
    name
    logo
    primaryColor
    url
    __typename
  }
  ownedByUser {
    id
    displayName
    profilePictureUrl
    __typename
  }
  connectionStatus {
    connectionStatusCode
    __typename
  }
  __typename
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
}`;

  const result = await callMonarchGraphQL('Common_UpdateAccount', query, { input });

  if (result.updateAccount.errors) {
    const errorMsg = result.updateAccount.errors.message || 'Failed to update account';
    throw new Error(errorMsg);
  }

  debugLog(`Successfully updated account: ${result.updateAccount.account.displayName} (ID: ${result.updateAccount.account.id})`);
  return result.updateAccount.account;
}

/**
 * @typedef {Object} UpdateTransactionInput
 * @property {string} id - Transaction ID (required)
 * @property {number} [amount] - Transaction amount (negative for expenses)
 * @property {string} [notes] - Transaction notes
 * @property {string} [date] - Transaction date in YYYY-MM-DD format
 * @property {string} [category] - Category ID
 * @property {string} [merchant] - Merchant ID
 * @property {string[]} [tags] - Array of tag IDs
 * @property {boolean} [hideFromReports] - Hide transaction from reports
 * @property {boolean} [needsReview] - Mark transaction as needing review
 * @property {string|null} [ownerUserId] - Owner user ID (for shared accounts)
 * @property {string} [goal] - Goal ID
 * @property {string} [reviewStatus] - Review status
 */

/**
 * @typedef {Object} UpdatedTransactionCategory
 * @property {string} id - Category ID
 * @property {string} name - Category name
 * @property {string} icon - Category icon emoji
 * @property {Object} group - Category group info
 * @property {string} group.id - Group ID
 * @property {string} group.type - Group type (expense, income, etc.)
 */

/**
 * @typedef {Object} UpdatedTransactionMerchant
 * @property {string} id - Merchant ID
 * @property {string} name - Merchant name
 * @property {number} transactionCount - Number of transactions
 * @property {number} transactionsCount - Number of transactions (alias)
 * @property {string|null} logoUrl - Merchant logo URL
 * @property {boolean} hasActiveRecurringStreams - Has active recurring streams
 * @property {Object|null} recurringTransactionStream - Recurring transaction info
 */

/**
 * @typedef {Object} UpdatedTransactionAccount
 * @property {string} id - Account ID
 * @property {string} displayName - Account display name
 * @property {string} icon - Account icon
 * @property {string|null} logoUrl - Account logo URL
 * @property {boolean} hideTransactionsFromReports - Hide transactions from reports
 * @property {Object|null} ownedByUser - Owner info
 */

/**
 * @typedef {Object} UpdatedTransaction
 * @property {string} id - Transaction ID
 * @property {number} amount - Transaction amount
 * @property {boolean} pending - Whether transaction is pending
 * @property {boolean} isRecurring - Whether transaction is recurring
 * @property {string} date - Transaction date in YYYY-MM-DD format
 * @property {string} originalDate - Original transaction date
 * @property {boolean} hideFromReports - Hidden from reports
 * @property {boolean} needsReview - Whether transaction needs review
 * @property {string|null} reviewedAt - Review timestamp
 * @property {Object|null} reviewedByUser - Reviewer info
 * @property {string} plaidName - Original name from Plaid
 * @property {string} notes - User notes
 * @property {boolean} hasSplitTransactions - Has split transactions
 * @property {boolean} isSplitTransaction - Is a split transaction
 * @property {boolean} isManual - Is a manual transaction
 * @property {boolean} updatedByRetailSync - Updated by retail sync
 * @property {Array} splitTransactions - Split transaction details
 * @property {Object|null} originalTransaction - Original transaction if split
 * @property {Array} attachments - Attached files
 * @property {UpdatedTransactionAccount} account - Transaction account
 * @property {UpdatedTransactionCategory} category - Transaction category
 * @property {Object|null} goal - Associated goal
 * @property {Object|null} savingsGoalEvent - Savings goal event
 * @property {UpdatedTransactionMerchant} merchant - Transaction merchant
 * @property {Array} tags - Transaction tags
 * @property {Object|null} needsReviewByUser - User who needs to review
 * @property {Object|null} ownedByUser - Owner info
 * @property {string|null} ownershipOverriddenAt - Ownership override timestamp
 * @property {boolean} hiddenByAccount - Hidden by account setting
 * @property {string|null} reviewStatus - Review status
 * @property {string} dataProviderDescription - Description from data provider
 */

/**
 * Update a transaction's details
 * Uses the Web_TransactionDrawerUpdateTransaction mutation to modify transaction properties.
 * @param {string} transactionId - Transaction ID to update (required)
 * @param {UpdateTransactionInput} updates - Fields to update
 * @returns {Promise<UpdatedTransaction>} Updated transaction object
 * @throws {Error} If transaction ID is missing or update fails
 * @example
 * // Update transaction amount and notes
 * const updated = await updateTransaction('232589874618203361', {
 *   amount: -5.6,
 *   notes: 'Updated note'
 * });
 *
 * @example
 * // Update transaction category
 * const updated = await updateTransaction('232589874618203361', {
 *   category: '162625045061467415'
 * });
 *
 * @example
 * // Mark transaction as hidden from reports
 * const updated = await updateTransaction('232589874618203361', {
 *   hideFromReports: true
 * });
 */
export async function updateTransaction(transactionId, updates = {}) {
  if (!transactionId) {
    throw new Error('Transaction ID is required');
  }

  const input = {
    id: transactionId,
    ...updates,
  };

  debugLog('Updating transaction:', input);

  const query = `mutation Web_TransactionDrawerUpdateTransaction($input: UpdateTransactionMutationInput!) {
  updateTransaction(input: $input) {
    transaction {
      id
      ...TransactionDrawerFields
      __typename
    }
    errors {
      ...PayloadErrorFields
      __typename
    }
    __typename
  }
}

fragment TransactionDrawerSplitMessageFields on Transaction {
  id
  amount
  merchant {
    id
    name
    __typename
  }
  category {
    id
    icon
    name
    __typename
  }
  __typename
}

fragment OriginalTransactionFields on Transaction {
  id
  date
  amount
  merchant {
    id
    name
    __typename
  }
  __typename
}

fragment AccountLinkFields on Account {
  id
  displayName
  icon
  logoUrl
  id
  __typename
}

fragment TransactionOverviewFields on Transaction {
  id
  amount
  pending
  date
  hideFromReports
  hiddenByAccount
  plaidName
  notes
  isRecurring
  reviewStatus
  needsReview
  isSplitTransaction
  dataProviderDescription
  attachments {
    id
    __typename
  }
  goal {
    id
    name
    __typename
  }
  savingsGoalEvent {
    id
    goal {
      id
      name
      __typename
    }
    __typename
  }
  category {
    id
    name
    icon
    group {
      id
      type
      __typename
    }
    __typename
  }
  merchant {
    name
    id
    transactionsCount
    logoUrl
    recurringTransactionStream {
      frequency
      isActive
      __typename
    }
    __typename
  }
  tags {
    id
    name
    color
    order
    __typename
  }
  account {
    id
    displayName
    icon
    logoUrl
    __typename
  }
  ownedByUser {
    id
    displayName
    profilePictureUrl
    __typename
  }
  __typename
}

fragment TransactionDrawerFields on Transaction {
  id
  amount
  pending
  isRecurring
  date
  originalDate
  hideFromReports
  needsReview
  reviewedAt
  reviewedByUser {
    id
    name
    __typename
  }
  plaidName
  notes
  hasSplitTransactions
  isSplitTransaction
  isManual
  updatedByRetailSync
  splitTransactions {
    id
    ...TransactionDrawerSplitMessageFields
    __typename
  }
  originalTransaction {
    id
    updatedByRetailSync
    ...OriginalTransactionFields
    __typename
  }
  attachments {
    id
    extension
    sizeBytes
    filename
    originalAssetUrl
    __typename
  }
  account {
    id
    hideTransactionsFromReports
    ownedByUser {
      id
      __typename
    }
    ...AccountLinkFields
    __typename
  }
  category {
    id
    __typename
  }
  goal {
    id
    __typename
  }
  savingsGoalEvent {
    id
    goal {
      id
      __typename
    }
    account {
      id
      __typename
    }
    __typename
  }
  merchant {
    id
    name
    transactionCount
    logoUrl
    hasActiveRecurringStreams
    recurringTransactionStream {
      id
      frequency
      __typename
    }
    __typename
  }
  tags {
    id
    name
    color
    order
    __typename
  }
  needsReviewByUser {
    id
    __typename
  }
  ownedByUser {
    id
    __typename
  }
  ownershipOverriddenAt
  ...TransactionOverviewFields
  __typename
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
}`;

  const result = await callMonarchGraphQL('Web_TransactionDrawerUpdateTransaction', query, { input });

  if (result.updateTransaction.errors) {
    const errorMsg = result.updateTransaction.errors.message || 'Failed to update transaction';
    throw new Error(errorMsg);
  }

  debugLog(`Successfully updated transaction: ${result.updateTransaction.transaction.id}`);
  return result.updateTransaction.transaction;
}

/**
 * @typedef {Object} SetTransactionTagsResult
 * @property {string} id - Transaction ID
 * @property {Array<{id: string}>} tags - Array of tag objects with their IDs
 */

/**
 * Set tags on a transaction (replaces all existing tags)
 * Use this to add, update, or remove tags from a transaction.
 * To remove all tags, pass an empty array.
 * @param {string} transactionId - Transaction ID to update
 * @param {string[]} tagIds - Array of tag IDs (empty array to remove all tags)
 * @returns {Promise<SetTransactionTagsResult>} Updated transaction object with tags
 * @throws {Error} If transactionId is missing or API call fails
 * @example
 * // Remove all tags from a transaction
 * const result = await setTransactionTags('232589874618203361', []);
 * console.log(result.tags); // []
 *
 * @example
 * // Set specific tags on a transaction
 * const result = await setTransactionTags('232589874618203361', ['tag-id-1', 'tag-id-2']);
 * console.log(result.tags); // [{ id: 'tag-id-1' }, { id: 'tag-id-2' }]
 */
export async function setTransactionTags(transactionId, tagIds = []) {
  if (!transactionId) {
    throw new Error('Transaction ID is required');
  }

  if (!Array.isArray(tagIds)) {
    throw new Error('tagIds must be an array');
  }

  debugLog('Setting transaction tags:', { transactionId, tagIds });

  const query = `mutation Web_SetTransactionTags($input: SetTransactionTagsInput!) {
  setTransactionTags(input: $input) {
    errors {
      ...PayloadErrorFields
      __typename
    }
    transaction {
      id
      tags {
        id
        __typename
      }
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
}`;

  const result = await callMonarchGraphQL('Web_SetTransactionTags', query, {
    input: {
      transactionId,
      tagIds,
    },
  });

  if (result.setTransactionTags.errors) {
    const errorMsg = result.setTransactionTags.errors.message || 'Failed to set transaction tags';
    throw new Error(errorMsg);
  }

  debugLog(`Successfully set tags for transaction: ${transactionId}`);
  return result.setTransactionTags.transaction;
}

/**
 * Delete a transaction
 * @param {string} transactionId - Transaction ID to delete
 * @returns {Promise<boolean>} True if deleted successfully
 * @throws {Error} If transactionId is missing or deletion fails
 * @example
 * // Delete a transaction
 * const deleted = await deleteTransaction('232663379465502547');
 * console.log(deleted); // true
 */
export async function deleteTransaction(transactionId) {
  if (!transactionId) {
    throw new Error('Transaction ID is required');
  }

  debugLog(`Deleting transaction: ${transactionId}`);

  const result = await callMonarchGraphQL(
    'Common_DeleteTransactionMutation',
    `mutation Common_DeleteTransactionMutation($input: DeleteTransactionMutationInput!) {
      deleteTransaction(input: $input) {
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
    { input: { transactionId } },
  );

  if (result.deleteTransaction.errors) {
    const errorMsg = result.deleteTransaction.errors.message || 'Failed to delete transaction';
    throw new Error(errorMsg);
  }

  debugLog(`Successfully deleted transaction: ${transactionId}`);
  return result.deleteTransaction.deleted;
}

/**
 * @typedef {Object} AccountTypeInfo
 * @property {string} name - Type name (e.g., 'credit', 'depository', 'brokerage', 'loan')
 * @property {string} display - Display name (e.g., 'Credit Cards', 'Cash', 'Investments', 'Loans')
 * @property {string} group - Group classification ('asset' or 'liability')
 */

/**
 * @typedef {Object} AccountCredentialInfo
 * @property {string} id - Credential ID
 * @property {Object} institution - Institution details
 * @property {string} institution.id - Institution ID
 * @property {string} institution.name - Institution name
 * @property {boolean} updateRequired - Whether credential needs update
 * @property {string} dataProvider - Data provider (e.g., 'PLAID', 'MX', 'FINICITY')
 * @property {string|null} disconnectedFromDataProviderAt - Disconnection timestamp
 * @property {string|null} syncDisabledAt - Sync disabled timestamp
 * @property {string|null} syncDisabledReason - Reason for sync being disabled
 */

/**
 * @typedef {Object} AccountConnectionStatus
 * @property {string} connectionStatusCode - Status code (e.g., 'MFA_REQUIRED', 'USER_NEEDS_REAUTH')
 * @property {string} copyTitle - Title for the status message
 * @property {string} inAppSmallCopy - Short in-app message
 * @property {string} inAppCopy - Full in-app message
 * @property {string} helpCenterUrl - Help center URL for this status
 */

/**
 * @typedef {Object} AccountInstitutionInfo
 * @property {string} id - Institution ID
 * @property {string} logo - Institution logo URL
 * @property {string} name - Institution name
 * @property {string|null} status - Institution status
 * @property {Object|null} plaidStatus - Plaid status details
 * @property {boolean} newConnectionsDisabled - Whether new connections are disabled
 * @property {boolean} hasIssuesReported - Whether issues are reported
 * @property {string} url - Institution website URL
 * @property {string} hasIssuesReportedMessage - Issues reported message
 * @property {string|null} transactionsStatus - Transactions sync status
 * @property {string|null} balanceStatus - Balance sync status
 */

/**
 * @typedef {Object} AccountByType
 * @property {string} id - Account ID
 * @property {AccountCredentialInfo|null} credential - Credential info (null for manual accounts)
 * @property {AccountConnectionStatus|null} connectionStatus - Connection status info
 * @property {boolean} syncDisabled - Whether sync is disabled
 * @property {boolean} isHidden - Whether account is hidden
 * @property {boolean} isAsset - Whether account is an asset
 * @property {boolean} includeInNetWorth - Include in net worth calculations
 * @property {number} order - Display order
 * @property {Object} type - Account type info
 * @property {string} type.name - Type name
 * @property {string} type.display - Type display name
 * @property {string} displayName - Account display name
 * @property {number} displayBalance - Current display balance (positive value)
 * @property {number} signedBalance - Signed balance (negative for liabilities)
 * @property {string} updatedAt - Last update timestamp
 * @property {string|null} dataProviderDeactivatedAt - Deactivation timestamp
 * @property {string} icon - Account icon identifier
 * @property {string|null} logoUrl - Account logo URL
 * @property {boolean} includeBalanceInNetWorth - Include balance in net worth
 * @property {string} displayLastUpdatedAt - Last updated display timestamp
 * @property {number|null} limit - Credit limit (for credit accounts)
 * @property {string|null} mask - Account mask (last 4 digits)
 * @property {Object} subtype - Account subtype
 * @property {string} subtype.display - Subtype display name
 * @property {AccountInstitutionInfo|null} institution - Institution info
 * @property {Object|null} ownedByUser - Owner info if shared
 * @property {Object|null} businessEntity - Business entity info
 */

/**
 * @typedef {Object} AccountTypeSummary
 * @property {AccountTypeInfo} type - Account type information
 * @property {AccountByType[]} accounts - Array of accounts of this type
 * @property {boolean} isAsset - Whether this type is an asset
 * @property {number} totalDisplayBalance - Total balance for this type
 */

/**
 * @typedef {Object} HouseholdPreferences
 * @property {string} id - Preferences ID
 * @property {string[]} accountGroupOrder - Order of account groups
 * @property {boolean} collaborationToolsEnabled - Whether collaboration is enabled
 */

/**
 * @typedef {Object} GetAccountsByTypeResult
 * @property {boolean} hasAccounts - Whether user has any accounts
 * @property {AccountTypeSummary[]} accountTypeSummaries - Accounts grouped by type
 * @property {HouseholdPreferences} householdPreferences - Household preferences
 */

/**
 * Get all accounts grouped by type
 * Returns accounts organized by type (Cash, Credit Cards, Investments, Loans, Vehicles, etc.)
 * with summaries per type including total balances. Manual accounts have null credential.
 * @param {Object} filters - Optional account filters
 * @returns {Promise<GetAccountsByTypeResult>} Accounts grouped by type with summaries
 * @example
 * // Get all accounts grouped by type
 * const result = await getAccountsByType();
 * console.log(`Has accounts: ${result.hasAccounts}`);
 * console.log(`Account groups: ${result.accountTypeSummaries.length}`);
 *
 * // Find all credit card accounts
 * const creditCards = result.accountTypeSummaries.find(s => s.type.name === 'credit');
 * console.log(`Credit cards total: $${creditCards.totalDisplayBalance}`);
 *
 * // Find manual accounts (no credential)
 * const allAccounts = result.accountTypeSummaries.flatMap(s => s.accounts);
 * const manualAccounts = allAccounts.filter(a => a.credential === null);
 * console.log(`Manual accounts: ${manualAccounts.length}`);
 */
export async function getAccountsByType(filters = {}) {
  const query = `query Web_GetAccountsPage($filters: AccountFilters) {
  hasAccounts
  accountTypeSummaries(filters: $filters) {
    type {
      name
      display
      group
      __typename
    }
    accounts {
      id
      credential {
        id
        institution {
          id
          name
          __typename
        }
        __typename
      }
      connectionStatus {
        connectionStatusCode
        copyTitle
        inAppSmallCopy
        inAppCopy
        helpCenterUrl
        __typename
      }
      ...AccountsListFields
      __typename
    }
    isAsset
    totalDisplayBalance
    __typename
  }
  householdPreferences {
    id
    accountGroupOrder
    collaborationToolsEnabled
    __typename
  }
}

fragment AccountMaskFields on Account {
  id
  mask
  subtype {
    display
    __typename
  }
  __typename
}

fragment InstitutionStatusTooltipFields on Institution {
  id
  logo
  name
  status
  plaidStatus
  newConnectionsDisabled
  hasIssuesReported
  url
  hasIssuesReportedMessage
  transactionsStatus
  balanceStatus
  __typename
}

fragment AccountListItemFields on Account {
  id
  displayName
  displayBalance
  signedBalance
  updatedAt
  syncDisabled
  dataProviderDeactivatedAt
  icon
  logoUrl
  isHidden
  isAsset
  includeInNetWorth
  includeBalanceInNetWorth
  displayLastUpdatedAt
  limit
  type {
    name
    __typename
  }
  ...AccountMaskFields
  credential {
    id
    updateRequired
    dataProvider
    disconnectedFromDataProviderAt
    syncDisabledAt
    syncDisabledReason
    __typename
  }
  connectionStatus {
    connectionStatusCode
    copyTitle
    inAppSmallCopy
    inAppCopy
    helpCenterUrl
    __typename
  }
  institution {
    id
    ...InstitutionStatusTooltipFields
    __typename
  }
  ownedByUser {
    id
    displayName
    profilePictureUrl
    __typename
  }
  businessEntity {
    id
    name
    logoUrl
    color
    __typename
  }
  __typename
}

fragment AccountsListFields on Account {
  id
  syncDisabled
  isHidden
  isAsset
  includeInNetWorth
  order
  type {
    name
    display
    __typename
  }
  ...AccountListItemFields
  __typename
}`;

  debugLog('Getting accounts by type with filters:', filters);

  const data = await callMonarchGraphQL('Web_GetAccountsPage', query, { filters });

  const totalAccounts = data.accountTypeSummaries.reduce(
    (sum, summary) => sum + summary.accounts.length,
    0,
  );

  debugLog(`Retrieved ${totalAccounts} accounts across ${data.accountTypeSummaries.length} types`);

  return {
    hasAccounts: data.hasAccounts,
    accountTypeSummaries: data.accountTypeSummaries,
    householdPreferences: data.householdPreferences,
  };
}

/**
 * Validate and refresh a Monarch account mapping
 * Checks if the mapped Monarch account still exists and refreshes stored data
 * @param {string} monarchAccountId - The stored Monarch account ID
 * @param {string} storageKey - The full storage key for this mapping
 * @param {string} previousAccountName - Name of the previously mapped account (for warning message)
 * @returns {Promise<{valid: boolean, account: Object|null, wasDeleted: boolean, warningMessage: string|null}>}
 *   - valid=true: Account exists, mapping updated with fresh data
 *   - valid=false: Account deleted/not found, mapping cleared
 */
export async function validateAndRefreshAccountMapping(monarchAccountId, storageKey, previousAccountName = null) {
  debugLog('[validateAndRefreshAccountMapping] Called with:', {
    monarchAccountId,
    storageKey,
    previousAccountName,
  });

  if (!monarchAccountId) {
    debugLog('[validateAndRefreshAccountMapping] No monarchAccountId provided, returning invalid');
    return { valid: false, account: null, wasDeleted: false, warningMessage: null };
  }

  debugLog(`Validating account mapping for ${monarchAccountId}`);

  const allAccounts = await getFilteredAccounts({});
  const account = allAccounts.find((acc) => acc.id === monarchAccountId);

  if (account) {
    // Account exists - update stored mapping with fresh data
    const refreshedMapping = {
      id: account.id,
      displayName: account.displayName,
      logoUrl: account.logoUrl,
      currentBalance: account.displayBalance,
      type: account.type,
      isManual: account.isManual,
      icon: account.icon,
      limit: account.limit,
    };
    // Only update storage if a storageKey was provided (legacy flow)
    if (storageKey) {
      GM_setValue(storageKey, JSON.stringify(refreshedMapping));
    }
    debugLog(`Account mapping refreshed: ${account.displayName}`);
    return { valid: true, account: refreshedMapping, wasDeleted: false, warningMessage: null };
  }

  // Account no longer exists - clear mapping if we have a storageKey
  if (storageKey) {
    GM_deleteValue(storageKey);
  }
  const accountDesc = previousAccountName || 'The previously mapped account';
  const warningMessage = `${accountDesc} was not found in Monarch and may have been deleted. Please select or create a new account.`;
  debugLog(`Account not found, mapping cleared: ${monarchAccountId}`);

  return { valid: false, account: null, wasDeleted: true, warningMessage };
}

/**
 * Get the credit limit for a credit card account
 * @param {string} accountId - Monarch account ID
 * @returns {Promise<number|null>} Credit limit value, or null if not set
 * @throws {Error} If account ID is missing or account not found
 * @example
 * const limit = await getCreditLimit('231838722038464342');
 * console.log(`Credit limit: $${limit}`); // Credit limit: $17000
 */
export async function getCreditLimit(accountId) {
  if (!accountId) {
    throw new Error('Account ID is required');
  }

  debugLog(`Getting credit limit for account: ${accountId}`);

  const accounts = await getFilteredAccounts({});
  const account = accounts.find((acc) => acc.id === accountId);

  if (!account) {
    throw new Error(`Account not found: ${accountId}`);
  }

  debugLog(`Found account ${account.displayName}, credit limit: ${account.limit}`);
  return account.limit !== undefined ? account.limit : null;
}

/**
 * Set a new credit limit for a credit card account
 * Fetches current account configuration and updates only the credit limit.
 * @param {string} accountId - Monarch account ID
 * @param {number} newLimit - New credit limit value
 * @returns {Promise<UpdatedAccountResult>} Updated account object
 * @throws {Error} If account ID is missing, newLimit is invalid, or account not found
 * @example
 * const updatedAccount = await setCreditLimit('231838722038464342', 20000);
 * console.log(`New credit limit: $${updatedAccount.limit}`); // New credit limit: $20000
 */
export async function setCreditLimit(accountId, newLimit) {
  if (!accountId) {
    throw new Error('Account ID is required');
  }

  if (newLimit === undefined || newLimit === null || typeof newLimit !== 'number') {
    throw new Error('Valid credit limit value is required');
  }

  debugLog(`Setting credit limit for account ${accountId} to ${newLimit}`);

  // Get current account configuration
  const accounts = await getFilteredAccounts({});
  const account = accounts.find((acc) => acc.id === accountId);

  if (!account) {
    throw new Error(`Account not found: ${accountId}`);
  }

  // Verify this is a credit account
  if (account.type.name !== 'credit') {
    throw new Error(`Account ${accountId} is not a credit account (type: ${account.type.name})`);
  }

  // Build update input based on current account configuration
  const updateInput = {
    id: accountId,
    dataProvider: account.dataProvider || '',
    dataProviderAccountId: null,
    name: account.displayName,
    type: account.type.name,
    subtype: 'credit_card', // Default for credit accounts
    displayBalance: account.displayBalance,
    invertSyncedBalance: false,
    useAvailableBalance: false,
    hideFromList: false,
    hideTransactionsFromReports: false,
    synced: !account.isManual,
    apr: null,
    interestRate: null,
    excludeFromDebtPaydown: false,
    deactivatedAt: account.deactivatedAt,
    includeInNetWorth: account.includeBalanceInNetWorth,
    limit: newLimit,
    plannedPayment: null,
    minimumPayment: null,
    recurrence: {},
    ownerUserId: account.ownedByUser ? account.ownedByUser.id : null,
  };

  const updatedAccount = await updateAccount(updateInput);
  debugLog(`Successfully set credit limit for ${updatedAccount.displayName} to ${updatedAccount.limit}`);

  return updatedAccount;
}

// Export as default object
export default {
  callGraphQL,
  callGraphQLOperation: callMonarchGraphQL,
  setupTokenCapture: setupMonarchTokenCapture,
  listAccounts: listMonarchAccounts,
  getInstitutionSettings: getMonarchInstitutionSettings,
  uploadBalance: uploadBalanceToMonarch,
  uploadTransactions: uploadTransactionsToMonarch,
  getCategoriesAndGroups: getMonarchCategoriesAndGroups,
  resolveAccountMapping: resolveMonarchAccountMapping,
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
