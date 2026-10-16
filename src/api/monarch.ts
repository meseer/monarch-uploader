/**
 * Monarch Money API client
 * Handles all communication with Monarch Money's GraphQL API
 */

import { API } from '../core/config';
import { debugLog } from '../core/utils';
import { extractResponseErrorDetail, parseJsonBody, unwrapGraphQLData } from '../core/httpResponse';
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
      // Everything this handler does sits inside one try/catch. The handler runs
      // asynchronously, outside the Promise executor's synchronous flow, so a
      // throw here escapes the Promise instead of rejecting it: neither `resolve`
      // nor `reject` ever runs, the promise never settles, and every awaiting
      // caller hangs forever with no error. No request timeout is configured, so
      // nothing ever breaks that hang. The catch is deliberately broad rather
      // than wrapped around the parse alone, because *any* throw has that effect
      // — an unexpected response shape or a throwing helper just as much as
      // `JSON.parse`. Calling `reject` after `resolve` is a harmless no-op, so
      // the net cannot corrupt an already-settled promise.
      onload: (res: Tampermonkey.Response<unknown>) => {
        try {
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
            const detail = extractResponseErrorDetail(res.responseText);
            reject(new Error(`Monarch API Error: ${res.status}${detail ? ` — ${detail}` : ''}`));
            return;
          }

          const source = `Monarch API Error: ${operation}`;
          resolve(unwrapGraphQLData(parseJsonBody(res.responseText, source), source));
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
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
 * Progress of Monarch's server-side processing of an uploaded statement,
 * reported after each status check so callers can show that the sync is
 * actively waiting on Monarch rather than stuck.
 */
export interface UploadProcessingUpdate {
  /** Status Monarch reported on the latest check (e.g. 'started', 'pending') */
  status: string;
  /** Number of status checks made so far */
  checks: number;
  /** Wall-clock time spent waiting for Monarch so far, in milliseconds */
  elapsedMs: number;
}

/** Options for uploadTransactionsToMonarch */
export interface UploadTransactionsOptions {
  /** Filename for the uploaded CSV (defaults to a dated name) */
  filename?: string | null;
  /** Whether Monarch should update the account balance from the import */
  shouldUpdateBalance?: boolean;
  /** Whether Monarch should skip its own duplicate detection */
  skipCheckForDuplicates?: boolean;
  /** Called after each status check while Monarch processes the upload */
  onProcessingUpdate?: (update: UploadProcessingUpdate) => void;
}

/**
 * Total time to keep polling for Monarch to finish processing an uploaded
 * statement.
 *
 * Monarch processes CSV imports asynchronously, and under load that can take
 * minutes. Giving up early is what makes a slow import dangerous: the sync
 * reports a failure and saves no dedup IDs, Monarch then finishes the import
 * anyway, and the next sync uploads the same transactions again as duplicates.
 * The budget counts only the waits between checks, so it is deterministic.
 */
const STATEMENT_PROCESSING_MAX_WAIT_MS = 10 * 60 * 1000;

/** Most imports finish within seconds, so the first checks come quickly. */
const STATEMENT_POLL_FAST_DELAY_MS = 2000;
const STATEMENT_POLL_FAST_CHECKS = 30;

/** After the first minute, check less often for the rest of the budget. */
const STATEMENT_POLL_SLOW_DELAY_MS = 5000;

/**
 * Consecutive failed status checks (network or GraphQL errors) tolerated before
 * giving up. A single blip must not abandon an upload Monarch is processing,
 * but a persistent failure (an expired session, say) should not spin for the
 * whole wait budget either.
 */
const STATEMENT_POLL_MAX_CONSECUTIVE_ERRORS = 5;

interface UploadStatementSession {
  status: string;
  errorMessage?: string | null;
  uploadedStatement?: { transactionCount?: number } | null;
}

/**
 * Error for an upload Monarch accepted but whose outcome could not be confirmed.
 *
 * The transactions may still land in Monarch, so the message tells the user to
 * check before syncing again — a blind retry is how duplicates get created.
 */
function unconfirmedUploadError(reason: string, cause?: unknown): Error {
  return new Error(
    `${reason} The upload may still complete in Monarch: check the account in Monarch `
    + 'before syncing again, or these transactions may be uploaded twice.',
    cause === undefined ? undefined : { cause },
  );
}

/**
 * Report a processing update without letting a failing callback abort the wait.
 * A throw here would surface as a failed upload for an import Monarch is still
 * processing — exactly the situation that produces duplicates on the next sync.
 */
function reportProcessingUpdate(
  onProcessingUpdate: UploadTransactionsOptions['onProcessingUpdate'],
  update: UploadProcessingUpdate,
): void {
  if (!onProcessingUpdate) return;
  try {
    onProcessingUpdate(update);
  } catch (error) {
    debugLog('Upload processing update callback failed (ignored):', error);
  }
}

/**
 * Fetch the current state of an upload statement session.
 *
 * @param sessionKey - Session key returned by the CSV upload
 * @returns The session
 */
async function fetchUploadStatementSession(sessionKey: string): Promise<UploadStatementSession> {
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
    { sessionKey },
  );
  return uploadStatementSession;
}

/**
 * Poll until Monarch finishes processing an uploaded statement.
 *
 * Terminal statuses end the wait immediately: 'completed' resolves, and
 * 'failed' / 'errored' throw without retrying. Any other status (including one
 * Monarch adds later) is treated as still processing. Failed status checks are
 * retried up to STATEMENT_POLL_MAX_CONSECUTIVE_ERRORS times in a row.
 *
 * @param sessionKey - Session key returned by the CSV upload
 * @param onProcessingUpdate - Called after each successful status check
 * @returns Number of transactions Monarch imported
 * @throws When processing fails, or when the outcome cannot be confirmed
 */
async function waitForStatementProcessing(
  sessionKey: string,
  onProcessingUpdate: UploadTransactionsOptions['onProcessingUpdate'],
): Promise<number> {
  const startedAt = Date.now();
  let waitedMs = 0;
  let checks = 0;
  let consecutiveErrors = 0;

  while (waitedMs < STATEMENT_PROCESSING_MAX_WAIT_MS) {
    if (checks > 0) {
      const delay = checks < STATEMENT_POLL_FAST_CHECKS ? STATEMENT_POLL_FAST_DELAY_MS : STATEMENT_POLL_SLOW_DELAY_MS;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, delay);
      });
      waitedMs += delay;
    }
    checks += 1;

    let session: UploadStatementSession;
    try {
      session = await fetchUploadStatementSession(sessionKey);
      consecutiveErrors = 0;
    } catch (error) {
      consecutiveErrors += 1;
      debugLog(`Error checking upload status (check ${checks}, ${consecutiveErrors} in a row): ${(error as Error).message}`);
      if (consecutiveErrors >= STATEMENT_POLL_MAX_CONSECUTIVE_ERRORS) {
        throw unconfirmedUploadError(`Could not confirm the upload with Monarch (${(error as Error).message}).`, error);
      }
      continue;
    }

    debugLog(`Upload status check ${checks}: ${session.status}`);
    if (session.status === 'completed') {
      return session.uploadedStatement?.transactionCount || 0;
    }
    if (session.status === 'failed' || session.status === 'errored') {
      throw new Error(`Monarch transaction upload processing failed: ${session.errorMessage || 'Unknown error'}`);
    }
    if (session.status !== 'started' && session.status !== 'pending') {
      debugLog(`Unrecognized upload status "${session.status}", treating it as still processing`);
    }

    reportProcessingUpdate(onProcessingUpdate, {
      status: session.status,
      checks,
      elapsedMs: Date.now() - startedAt,
    });
  }

  const minutes = Math.round(STATEMENT_PROCESSING_MAX_WAIT_MS / 60000);
  throw unconfirmedUploadError(`Monarch was still processing the upload after ${minutes} minutes.`);
}

/**
 * Upload transactions to Monarch Money
 * @param monarchAccountId - Monarch account ID to upload transactions to
 * @param csvData - CSV data containing transactions
 * @param options - Filename, import flags and a processing-progress callback
 * @returns Success status
 */
export async function uploadTransactionsToMonarch(
  monarchAccountId: string,
  csvData: string,
  options: UploadTransactionsOptions = {},
): Promise<boolean> {
  const {
    filename = null,
    shouldUpdateBalance = false,
    skipCheckForDuplicates = false,
    onProcessingUpdate,
  } = options;

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

    debugLog('Waiting for transaction processing to complete (Step 3/3)...');
    const transactionCount = await waitForStatementProcessing(response.session_key, onProcessingUpdate);
    debugLog(`Successfully uploaded ${transactionCount} transactions to Monarch account ${monarchAccountId}`);
    return true;
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
