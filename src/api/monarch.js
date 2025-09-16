/**
 * Monarch Money API client
 * Handles all communication with Monarch Money's GraphQL API
 */

import { API, STORAGE } from '../core/config';
import { debugLog } from '../core/utils';
import stateManager from '../core/state';
import authService from '../services/auth';
import { showMonarchAccountSelector } from '../ui/components/accountSelector';

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

  return {
    mode: 'cors',
    method: 'POST',
    headers: {
      accept: '*/*',
      authorization: `Token ${authStatus.token}`,
      'content-type': 'application/json',
      origin: 'https://app.monarchmoney.com',
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

    GM_xmlhttpRequest({
      mode: 'cors',
      method: 'POST',
      url: API.MONARCH_GRAPHQL_URL,
      headers: {
        accept: '*/*',
        'Content-Type': 'application/json',
        Authorization: `Token ${authStatus.token}`,
        origin: 'https://app.monarchmoney.com',
      },
      data: JSON.stringify(data),
      onload: (res) => {
        debugLog('Monarch API response:', res);

        if (res.status === 401) {
          // Token is invalid or expired, clear auth state
          authService.saveToken('monarch', null);
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
    'query GetAccounts {\n accounts {\n id\n displayName\n deactivatedAt\n isHidden\n isAsset\n isManual\n mask\n displayLastUpdatedAt\n currentBalance\n displayBalance\n hideFromList\n hideTransactionsFromReports\n includeInNetWorth\n order\n icon\n logoUrl\n deactivatedAt \n type {\n  name\n  display\n  group\n  }\n subtype {\n name\n display\n }\n }}\n',
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
 * @param {string} accountId - Questrade account ID
 * @param {string} csvData - CSV data containing balance history
 * @param {string} fromDate - Start date in YYYY-MM-DD format
 * @param {string} toDate - End date in YYYY-MM-DD format
 * @returns {Promise<boolean>} Success status
 */
export async function uploadBalanceToMonarch(accountId, csvData, fromDate, toDate) {
  try {
    debugLog('Starting Monarch upload process');

    // Get auth status
    const authStatus = authService.checkMonarchAuth();
    if (!authStatus.authenticated) {
      throw new Error('Monarch authentication required for uploading balance history');
    }

    // Get Monarch account mapping
    let monarchAccount = JSON.parse(GM_getValue(`${STORAGE.ACCOUNT_MAPPING_PREFIX}${accountId}`, null));
    if (!monarchAccount) {
      debugLog('No Monarch account mapping found, showing account selector');

      // Fetch Monarch investment accounts
      const investmentAccounts = await listMonarchAccounts();
      if (!investmentAccounts.length) {
        throw new Error('No investment accounts found in Monarch.');
      }

      // Show account selector and wait for user selection
      monarchAccount = await new Promise((resolve) => {
        showMonarchAccountSelector(investmentAccounts, resolve);
      });

      if (!monarchAccount) {
        // User cancelled selection
        throw new Error('Account selection cancelled by user');
      }

      // Save the mapping for future use
      GM_setValue(`${STORAGE.ACCOUNT_MAPPING_PREFIX}${accountId}`, JSON.stringify(monarchAccount));
      debugLog(`Saved account mapping: ${accountId} -> ${monarchAccount.displayName}`);
    }

    // Create upload filename
    const accountName = stateManager.getState().currentAccount.nickname || 'account';
    const safeAccountName = accountName.replace(/[^a-z0-9_\-\s]/gi, '_').replace(/\s+/g, '_');
    const fileName = `balance_${safeAccountName}_${fromDate}_to_${toDate}.csv`;

    // Create form data
    const formData = new FormData();
    const fileBlob = new Blob([csvData], { type: 'text/csv' });
    formData.append('files', fileBlob, fileName);
    const accountMapping = { [fileName]: monarchAccount.id };
    formData.append('account_files_mapping', JSON.stringify(accountMapping));
    formData.append('preview', 'true');

    // Submit the upload
    debugLog('Uploading CSV to Monarch (Step 1/2)');
    const previewResponse = await new Promise((resolve, reject) => GM_xmlhttpRequest({
      mode: 'cors',
      method: 'POST',
      url: API.MONARCH_UPLOAD_URL || 'https://api.monarchmoney.com/account-balance-history/upload/',
      headers: {
        accept: 'application/json',
        authorization: `Token ${authStatus.token}`,
        origin: 'https://app.monarchmoney.com',
      },
      data: formData,
      onload: (res) => resolve(res),
      onerror: (err) => reject(err),
    }));

    if (previewResponse.status !== 200) {
      throw new Error(`Monarch upload failed: ${previewResponse.statusText}`);
    }

    const response = JSON.parse(previewResponse.responseText);
    if (!response.session_key) {
      throw new Error('Upload failed: Monarch did not return a session key.');
    }

    // Finalize the upload
    debugLog('Finalizing upload (Step 2/2)');
    await callMonarchGraphQL(
      'Web_ParseUploadBalanceHistorySession',
      'mutation Web_ParseUploadBalanceHistorySession($input: ParseBalanceHistoryInput!) {\n  parseBalanceHistory(input: $input) {\n    uploadBalanceHistorySession {\n      ...UploadBalanceHistorySessionFields\n      __typename\n    }\n    __typename\n  }\n}\n\nfragment UploadBalanceHistorySessionFields on UploadBalanceHistorySession {\n  sessionKey\n  status\n  __typename\n}',
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
          'query Web_GetUploadBalanceHistorySession($sessionKey: String!) {\n  uploadBalanceHistorySession(sessionKey: $sessionKey) {\n    ...UploadBalanceHistorySessionFields\n    __typename\n  }\n}\n\nfragment UploadBalanceHistorySessionFields on UploadBalanceHistorySession {\n  sessionKey\n  status\n  __typename\n}',
          { sessionKey: response.session_key },
        );

        debugLog(`Upload status check ${attempts}/${maxRetries}: ${uploadBalanceHistorySession.status}`);

        if (uploadBalanceHistorySession.status === 'completed') {
          debugLog(`Successfully uploaded ${response.previews[0].count} days of "${accountName}" balance history to Monarch`);
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
    throw new Error(`Upload processing timeout - exceeded maximum retry attempts (${maxRetries}). The upload may still be processing in Monarch.`);
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
    const uploadResponse = await new Promise((resolve, reject) => GM_xmlhttpRequest({
      mode: 'cors',
      method: 'POST',
      url: API.MONARCH_TRANSACTIONS_UPLOAD_URL,
      headers: {
        accept: 'application/json',
        authorization: `Token ${authStatus.token}`,
        origin: 'https://app.monarchmoney.com',
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
      'mutation Web_ParseUploadStatementSession($input: ParseStatementInput!) {\n  parseUploadStatementSession(input: $input) {\n    uploadStatementSession {\n      ...UploadStatementSessionFields\n      __typename\n    }\n    __typename\n  }\n}\n\nfragment UploadStatementSessionFields on UploadStatementSession {\n  sessionKey\n  status\n  errorMessage\n  skipCheckForDuplicates\n  uploadedStatement {\n    id\n    transactionCount\n    __typename\n  }\n  __typename\n}',
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
          'query Web_GetUploadStatementSession($sessionKey: String!) {\n  uploadStatementSession(sessionKey: $sessionKey) {\n    ...UploadStatementSessionFields\n    __typename\n  }\n}\n\nfragment UploadStatementSessionFields on UploadStatementSession {\n  sessionKey\n  status\n  errorMessage\n  skipCheckForDuplicates\n  uploadedStatement {\n    id\n    transactionCount\n    __typename\n  }\n  __typename\n}',
          { sessionKey: response.session_key },
        );

        debugLog(`Upload status check ${attempts}/${maxRetries}: ${uploadStatementSession.status}`);

        if (uploadStatementSession.status === 'completed') {
          const transactionCount = uploadStatementSession.uploadedStatement?.transactionCount || 0;
          debugLog(`Successfully uploaded ${transactionCount} transactions to Monarch account ${monarchAccountId}`);
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
    throw new Error(`Upload processing timeout - exceeded maximum retry attempts (${maxRetries}). The upload may still be processing in Monarch.`);
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
  checkTokenStatus,
  getToken,
};
