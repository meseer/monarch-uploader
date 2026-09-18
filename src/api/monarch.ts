/**
 * Monarch Money API client
 * Handles all communication with Monarch Money's GraphQL API
 */

import { API } from '../core/config';
import { debugLog } from '../core/utils';
import { buildMonarchColumnMapping, extractCSVHeaderColumns } from '../utils/csv';
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

// ============================================================
// Interfaces
// ============================================================

interface MonarchAccount {
  id: string;
  displayName: string;
  deactivatedAt: string | null;
  isHidden: boolean;
  isAsset: boolean;
  isManual: boolean;
  mask: string | null;
  displayLastUpdatedAt: string;
  currentBalance: number;
  displayBalance: number;
  hideFromList: boolean;
  hideTransactionsFromReports: boolean;
  includeInNetWorth: boolean;
  order: number;
  icon: string;
  logoUrl: string | null;
  type: { name: string; display: string; group: string };
  subtype: { name: string; display: string } | null;
}

interface MonarchCategoryGroup {
  id: string;
  name: string;
  order: number;
  type: string;
  __typename?: string;
}

interface MonarchCategory {
  id: string;
  name: string;
  order: number;
  icon: string;
  isSystemCategory: boolean;
  systemCategory: string | null;
  isDisabled: boolean;
  group: {
    id: string;
    type: string;
    name: string;
    __typename?: string;
  };
  __typename?: string;
  [key: string]: unknown;
}

interface CategoriesAndGroupsResult {
  categoryGroups: MonarchCategoryGroup[];
  categories: MonarchCategory[];
}

interface MonarchSecurity {
  id: string;
  name: string;
  type: string;
  logo: string | null;
  ticker: string;
  typeDisplay: string;
  currentPrice: number | null;
  closingPrice: number | null;
  oneDayChangeDollars: number | null;
  oneDayChangePercent: number | null;
  __typename?: string;
}

interface SearchSecuritiesOptions {
  limit?: number;
  orderByPopularity?: boolean;
}

interface MonarchHoldingNode {
  id: string;
  quantity: number;
  basis: number | null;
  totalValue: number;
  securityPriceChangeDollars: number | null;
  securityPriceChangePercent: number | null;
  lastSyncedAt: string | null;
  holdings: Array<{
    id: string;
    type: string;
    typeDisplay: string;
    name: string;
    ticker: string;
    closingPrice: number | null;
    isManual: boolean;
    closingPriceUpdatedAt: string | null;
    costBasis: number | null;
    quantity: number;
    __typename?: string;
  }>;
  security: MonarchSecurity & {
    currentPriceUpdatedAt: string | null;
  };
  __typename?: string;
}

interface PortfolioResult {
  aggregateHoldings: {
    edges: Array<{
      node: MonarchHoldingNode;
      __typename?: string;
    }>;
    __typename?: string;
  };
  __typename?: string;
}

interface GetHoldingsOptions {
  includeHiddenHoldings?: boolean;
  startDate?: string | null;
  endDate?: string | null;
  topMoversLimit?: number;
}

interface MonarchCredentials {
  csrfToken: string;
  sessionExpiresAt: string | null;
}

interface AuthStatus {
  authenticated: boolean;
  credentials?: MonarchCredentials;
}

interface GraphQLRequestOptions {
  mode: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

// ============================================================
// Functions
// ============================================================

/**
 * Cap on how much of an error response body is carried in the thrown error.
 *
 * Enough to hold a GraphQL errors array; short enough that an HTML error page
 * cannot flood the log.
 */
const ERROR_BODY_MAX_LENGTH = 500;

/**
 * Pull a readable explanation out of an error response body.
 *
 * Monarch answers a refused request with a GraphQL `errors` array, and that array
 * is frequently the *only* explanation of what it objected to. The `locations`
 * entry in particular identifies the offending part of the query, which is often
 * the only way to tell an unsupported field from a malformed value — the error
 * `message` itself can be entirely generic ("Something went wrong while
 * processing: None on request_id: None.").
 *
 * The serialized array is returned rather than just the message, so `locations`
 * survives into the thrown error.
 *
 * @param responseText - Raw response body, which may not be JSON at all
 * @returns Serialized errors, a trimmed body, or '' when there is nothing useful
 */
function extractGraphQLErrorText(responseText: string | undefined): string {
  if (!responseText) return '';

  try {
    const parsed = JSON.parse(responseText);
    if (parsed?.errors) return JSON.stringify(parsed.errors);
  } catch {
    // Not JSON (an HTML error page, say) — fall through to the raw text.
  }

  // Bounded: enough to diagnose, not enough to flood the log with an error page.
  return responseText.slice(0, ERROR_BODY_MAX_LENGTH);
}

/**
 * Construct GraphQL request options
 * @param data - GraphQL request data
 * @returns Request options for GM_xmlhttpRequest
 */
export function callGraphQL(data: Record<string, unknown>): GraphQLRequestOptions {
  // Get credentials from auth service
  const authStatus: AuthStatus = authService.checkMonarchAuth();
  if (!authStatus.authenticated || !authStatus.credentials) {
    throw new Error('Monarch session not found. Please open Monarch Money in another tab.');
  }

  return {
    mode: 'cors',
    method: 'POST',
    headers: {
      accept: '*/*',
      'content-type': 'application/json',
      'x-csrftoken': authStatus.credentials.csrfToken,
      origin: API.MONARCH_APP_URL,
    },
    body: JSON.stringify(data),
  };
}

/**
 * Execute a GraphQL query to the Monarch API
 * @param operation - Operation name
 * @param query - GraphQL query
 * @param variables - Query variables
 * @returns Query result
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function callMonarchGraphQL(operation: string, query: string, variables: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    // Get credentials from auth service
    const authStatus: AuthStatus = authService.checkMonarchAuth();
    if (!authStatus.authenticated || !authStatus.credentials) {
      stateManager.setMonarchAuth(null);
      reject(new Error('Monarch session not found. Please open Monarch Money in another tab.'));
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
        'x-csrftoken': authStatus.credentials.csrfToken,
        origin: API.MONARCH_APP_URL,
      },
      data: JSON.stringify(data),
      onload: (res: Tampermonkey.Response<unknown>) => {
        debugLog('Monarch API response:', res);

        if (res.status === 401 || res.status === 403) {
          // Session is invalid or expired, clear auth state
          authService.clearMonarchCredentials();
          reject(new Error('Monarch Auth Error: Session was invalid or expired. Please open Monarch Money to refresh.'));
          return;
        }
        if (res.status !== 200) {
          // Include the response body. Monarch returns GraphQL `errors` on 4xx,
          // and discarding them (as this used to) left every non-200 failure
          // undiagnosable — the status alone cannot distinguish "this field is
          // not accepted" from "the server is having a bad day".
          const detail = extractGraphQLErrorText(res.responseText);
          reject(new Error(`Monarch API Error: ${res.status}${detail ? ` — ${detail}` : ''}`));
          return;
        }

        const responseData = JSON.parse(res.responseText);
        if (responseData.errors) {
          reject(new Error(JSON.stringify(responseData.errors)));
        } else {
          resolve(responseData.data);
        }
      },
      onerror: (err: Error) => reject(err),
    });
  });
}

/**
 * Setup token capture for Monarch Money
 * Should be called when on Monarch's domain to capture authentication token
 */
export function setupMonarchTokenCapture(): void {
  // Delegate to auth service
  return authService.setupMonarchTokenCapture();
}

/**
 * List all Monarch accounts
 * @param accountType - Account type to filter for ('brokerage' for investment, 'credit' for credit cards)
 * @returns List of accounts
 */
export async function listMonarchAccounts(accountType: string = 'brokerage'): Promise<MonarchAccount[]> {
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
  return accounts.filter((acc: MonarchAccount) => acc.type.name === accountType
    && acc.isHidden === false
    && acc.hideFromList === false);
}

/**
 * Upload balance history to Monarch Money
 * @param monarchAccountId - Monarch account ID to upload to
 * @param csvData - CSV data containing balance history
 * @param fromDate - Start date in YYYY-MM-DD format
 * @param toDate - End date in YYYY-MM-DD format
 * @returns Success status
 */
export async function uploadBalanceToMonarch(
  monarchAccountId: string,
  csvData: string,
  fromDate: string,
  toDate: string,
): Promise<boolean> {
  try {
    debugLog('Starting Monarch balance upload process');

    // Get auth status
    const authStatus: AuthStatus = authService.checkMonarchAuth();
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
    const accountMapping: Record<string, string> = { [fileName]: monarchAccountId };
    formData.append('account_files_mapping', JSON.stringify(accountMapping));
    formData.append('preview', 'true');

    // Submit the upload
    debugLog('Uploading CSV to Monarch (Step 1/2)');
    const previewResponse = await new Promise<Tampermonkey.Response<unknown>>((resolve, reject) => GM_xmlhttpRequest({
      mode: 'cors',
      method: 'POST',
      url: API.MONARCH_BALANCE_UPLOAD_URL,
      headers: {
        accept: 'application/json',
        'x-csrftoken': authStatus.credentials!.csrfToken,
        origin: API.MONARCH_APP_URL,
      },
      data: formData as unknown as string,
      onload: (res: Tampermonkey.Response<unknown>) => resolve(res),
      onerror: (err: Error) => reject(err),
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
            await new Promise<void>((resolve) => {
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
          debugLog(`Error checking upload status (attempt ${attempts}/${maxRetries}): ${(error as Error).message}, retrying...`);
          await new Promise<void>((resolve) => {
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
 * @param monarchAccountId - Monarch account ID to upload transactions to
 * @param csvData - CSV data containing transactions
 * @param filename - Optional filename for the upload
 * @param shouldUpdateBalance - Whether to update account balance (default: false)
 * @param skipCheckForDuplicates - Whether to skip duplicate checking (default: false)
 * @returns Success status
 */
export async function uploadTransactionsToMonarch(
  monarchAccountId: string,
  csvData: string,
  filename: string | null = null,
  shouldUpdateBalance: boolean = false,
  skipCheckForDuplicates: boolean = false,
): Promise<boolean> {
  try {
    debugLog('Starting Monarch transactions upload process');

    // Get auth status
    const authStatus: AuthStatus = authService.checkMonarchAuth();
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
    const uploadResponse = await new Promise<Tampermonkey.Response<unknown>>((resolve, reject) => GM_xmlhttpRequest({
      mode: 'cors',
      method: 'POST',
      url: API.MONARCH_TRANSACTIONS_UPLOAD_URL,
      headers: {
        accept: 'application/json',
        'x-csrftoken': authStatus.credentials!.csrfToken,
        origin: API.MONARCH_APP_URL,
      },
      data: formData as unknown as string,
      onload: (res: Tampermonkey.Response<unknown>) => resolve(res),
      onerror: (err: Error) => reject(err),
    }));

    if (uploadResponse.status !== 200) {
      throw new Error(`Monarch transactions upload failed: ${uploadResponse.statusText}`);
    }

    const response = JSON.parse(uploadResponse.responseText);
    if (!response.session_key) {
      throw new Error('Upload failed: Monarch did not return a session key.');
    }

    debugLog(`Received session key: ${response.session_key}`);

    // Parse the uploaded statement.
    //
    // The columnMapping tells Monarch which CSV columns to read (anything not
    // named there is silently ignored) and it is INDEX-based, so it must
    // describe this CSV's columns — not a canonical list. Integrations emit
    // different column sets (Questrade has no Id column, for instance), so the
    // mapping is derived from the uploaded file's own header row. Deriving it
    // from a shared constant instead would silently point at wrong indices for
    // any CSV that does not use every column.
    const csvColumns = extractCSVHeaderColumns(csvData);
    if (!csvColumns) {
      debugLog('Could not read CSV header row — falling back to the canonical column list for columnMapping');
    }
    const columnMapping = csvColumns
      ? buildMonarchColumnMapping(csvColumns)
      : buildMonarchColumnMapping();
    debugLog('Parsing uploaded statement (Step 2/3) with columnMapping:', columnMapping);
    const parseResult = await callMonarchGraphQL(
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
          parserName: 'mint_csv',
          columnMapping,
          sessionKey: response.session_key,
          // DO NOT change this to 'transaction_id_matching' without re-testing.
          //
          // Monarch's own UI sends `importPriority: "transaction_id_matching"`
          // when importing with an id column, and we do send an `Id` column — so
          // this looks like an obvious thing to "fix". It is not, yet:
          //
          // Monarch does not appear to retain the id from the CSV. After an
          // upload it reports its own internally-assigned id for the
          // transaction, and id-based deduplication consequently does not work —
          // reproduced through Monarch's own UI, so the defect is upstream, not
          // in this request. Switching the value would therefore be unlikely to
          // help, while risking the loss of the fuzzy duplicate detection that
          // `all_transactions` gives us as a backstop behind our own dedup store.
          //
          // See docs/decisions/008-monarch-csv-transaction-id-matching-does-not-work.md
          importPriority: 'all_transactions',
          accountId: monarchAccountId,
          skipCheckForDuplicates,
          shouldUpdateBalance,
          allowWarnings: true,
        },
      },
    );

    // Log the full parse response. `allowWarnings: true` means an unrecognised
    // columnMapping key would NOT fail the upload, so any complaint about a key
    // only surfaces here.
    debugLog('Parse statement session response:', parseResult?.parseUploadStatementSession);

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
        if (uploadStatementSession.status === 'failed' || uploadStatementSession.status === 'errored') {
          const errorMsg = uploadStatementSession.errorMessage || 'Unknown error';
          throw new Error(`Monarch transaction upload processing failed: ${errorMsg}`);
        }
        if (uploadStatementSession.status === 'started' || uploadStatementSession.status === 'pending') {
          // Upload is still processing, wait and retry
          if (attempts < maxRetries) {
            debugLog(`Upload still processing, waiting ${retryDelay}ms before next check...`);
            await new Promise<void>((resolve) => {
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
          debugLog(`Error checking upload status (attempt ${attempts}/${maxRetries}): ${(error as Error).message}, retrying...`);
          await new Promise<void>((resolve) => {
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
 * @returns Object containing categoryGroups and categories arrays
 */
export async function getMonarchCategoriesAndGroups(): Promise<CategoriesAndGroupsResult> {
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
 * @param searchTerm - Search term (ticker or security name)
 * @param options - Search options
 * @returns Array of security objects
 */
export async function searchSecurities(searchTerm: string, options: SearchSecuritiesOptions = {}): Promise<MonarchSecurity[]> {
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
 * @param accountId - Monarch account ID
 * @param securityId - Security ID from Monarch
 * @param quantity - Quantity of shares/units
 * @returns Created holding object with id and ticker
 */
export async function createManualHolding(
  accountId: string,
  securityId: string,
  quantity: number,
): Promise<{ id: string; ticker: string; __typename?: string }> {
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

interface UpdateHoldingInput {
  quantity?: number;
  costBasis?: number;
  securityType?: string;
}

/**
 * Update an existing holding
 * @param holdingId - Holding ID to update
 * @param updates - Fields to update
 * @returns Updated holding ID
 */
export async function updateHolding(holdingId: string, updates: UpdateHoldingInput): Promise<string> {
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
 * @param holdingId - Holding ID to delete
 * @returns True if deleted successfully
 */
async function deleteHolding(holdingId: string): Promise<boolean> {
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
 * @param accountIds - Array of Monarch account IDs
 * @param options - Query options
 * @returns Portfolio holdings data
 */
export async function getHoldings(accountIds: string[], options: GetHoldingsOptions = {}): Promise<PortfolioResult> {
  const {
    includeHiddenHoldings = true,
    startDate = null,
    endDate = null,
    topMoversLimit = 4,
  } = options;

  const input: Record<string, unknown> = {
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
 * Check token status and update state
 * @returns Auth status information
 */
export function checkTokenStatus(): AuthStatus {
  return authService.checkMonarchAuth();
}

/**
 * Get CSRF token from auth service
 * @returns CSRF token if valid, null otherwise
 */
export function getToken(): string | null {
  const credentials = authService.getMonarchCredentials();
  return credentials?.csrfToken || null;
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
