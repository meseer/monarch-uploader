/**
 * Monarch Money API - Account Management Operations
 * Functions for creating, updating, and querying accounts
 */

import { debugLog } from '../core/utils';
import { callMonarchGraphQL, searchSecurities } from './monarch';

// ============================================================
// Interfaces
// ============================================================

interface AccountTypeSubtype {
  display: string;
  name: string;
  __typename?: string;
}

interface AccountType {
  name: string;
  display: string;
  group: string;
  possibleSubtypes: AccountTypeSubtype[];
  __typename?: string;
}

interface AccountTypeOption {
  type: AccountType;
  subtype: AccountTypeSubtype | null;
  __typename?: string;
}

interface CreateManualAccountInput {
  type: string;
  subtype: string;
  name: string;
  displayBalance: number;
  includeInNetWorth: boolean;
}

interface InitialHolding {
  securityId: string;
  quantity: number;
}

interface CreateManualInvestmentsAccountInput {
  name: string;
  subtype: string;
  initialHoldings?: InitialHolding[];
}

interface SetAccountLogoResult {
  id: string;
  name: string;
  logoUrl: string;
  hasCustomizedLogo: boolean;
  __typename?: string;
}

interface FilteredAccountType {
  display: string;
  name: string;
  __typename?: string;
}

interface FilteredAccount {
  id: string;
  createdAt: string;
  displayName: string;
  displayBalance: number;
  displayLastUpdatedAt: string;
  dataProvider: string;
  icon: string;
  logoUrl: string | null;
  order: number;
  isAsset: boolean;
  includeBalanceInNetWorth: boolean;
  deactivatedAt: string | null;
  manualInvestmentsTrackingMethod: string | null;
  isManual: boolean;
  syncDisabled: boolean;
  type: FilteredAccountType;
  subtype?: { name: string; display: string; __typename?: string } | null;
  invertSyncedBalance?: boolean;
  useAvailableBalance?: boolean;
  hideFromList?: boolean;
  hideTransactionsFromReports?: boolean;
  excludeFromDebtPaydown?: boolean;
  apr?: number | null;
  interestRate?: number | null;
  plannedPayment?: number | null;
  minimumPayment?: number | null;
  credential: {
    updateRequired: boolean;
    syncDisabledAt: string | null;
    __typename?: string;
  } | null;
  institution: {
    status: string;
    newConnectionsDisabled: boolean;
    __typename?: string;
  } | null;
  ownedByUser: {
    id: string;
    displayName: string;
    profilePictureUrl: string | null;
    __typename?: string;
  } | null;
  limit?: number | null;
  __typename?: string;
}

interface AccountFilters {
  includeDeleted?: boolean;
  accountType?: string;
}

interface UpdateAccountInput {
  id: string;
  dataProvider?: string;
  dataProviderAccountId?: string | null;
  name?: string;
  type?: string;
  subtype?: string;
  displayBalance?: number;
  invertSyncedBalance?: boolean;
  useAvailableBalance?: boolean;
  hideFromList?: boolean;
  hideTransactionsFromReports?: boolean;
  synced?: boolean;
  apr?: number | null;
  interestRate?: number | null;
  excludeFromDebtPaydown?: boolean;
  deactivatedAt?: string | null;
  includeInNetWorth?: boolean;
  limit?: number | null;
  plannedPayment?: number | null;
  minimumPayment?: number | null;
  recurrence?: Record<string, unknown>;
  ownerUserId?: string | null;
}

interface UpdatedAccountResult {
  id: string;
  displayName: string;
  syncDisabled: boolean;
  deactivatedAt: string | null;
  isHidden: boolean;
  isAsset: boolean;
  mask: string | null;
  createdAt: string;
  updatedAt: string;
  displayLastUpdatedAt: string;
  currentBalance: number;
  displayBalance: number;
  includeInNetWorth: boolean;
  hideFromList: boolean;
  hideTransactionsFromReports: boolean;
  includeBalanceInNetWorth: boolean;
  includeInGoalBalance: boolean;
  excludeFromDebtPaydown: boolean;
  dataProvider: string;
  dataProviderAccountId: string | null;
  isManual: boolean;
  transactionsCount: number;
  holdingsCount: number;
  manualInvestmentsTrackingMethod: string | null;
  order: number;
  icon: string;
  logoUrl: string | null;
  limit: number | null;
  apr: number | null;
  minimumPayment: number | null;
  plannedPayment: number | null;
  interestRate: number | null;
  type: { name: string; display: string; group: string; __typename?: string };
  subtype: { name: string; display: string; __typename?: string } | null;
  credential: Record<string, unknown> | null;
  institution: Record<string, unknown> | null;
  ownedByUser: { id: string; displayName: string; profilePictureUrl: string | null; __typename?: string } | null;
  connectionStatus: { connectionStatusCode: string; __typename?: string } | null;
  __typename?: string;
}

interface AccountTypeSummary {
  type: { name: string; display: string; group: string; __typename?: string };
  accounts: Array<Record<string, unknown>>;
  isAsset: boolean;
  totalDisplayBalance: number;
  __typename?: string;
}

interface GetAccountsByTypeResult {
  hasAccounts: boolean;
  accountTypeSummaries: AccountTypeSummary[];
  householdPreferences: {
    id: string;
    accountGroupOrder: string[];
    collaborationToolsEnabled: boolean;
    __typename?: string;
  };
}

interface ValidateAccountMappingResult {
  valid: boolean;
  account: RefreshedAccountMapping | null;
  wasDeleted: boolean;
  warningMessage: string | null;
}

interface RefreshedAccountMapping {
  id: string;
  displayName: string;
  logoUrl: string | null;
  currentBalance: number;
  type: FilteredAccountType;
  isManual: boolean;
  icon: string;
  limit?: number | null;
}

// ============================================================
// Functions
// ============================================================

/**
 * Get available account type options from Monarch
 * Returns all account types (Cash, Investments, Real Estate, Vehicles, Valuables, Credit Cards, Loans, etc.)
 * along with their possible subtypes.
 * @returns Array of account type options with their subtypes
 */
export async function getAccountTypeOptions(): Promise<AccountTypeOption[]> {
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
 * Create a new manual account in Monarch
 * @param accountData - Account configuration
 * @returns The ID of the created account
 * @throws If account creation fails or validation errors occur
 */
export async function createManualAccount(accountData: CreateManualAccountInput): Promise<string> {
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
 * @param accountData - Account configuration
 * @returns The ID of the created account
 * @throws If account creation fails or validation errors occur
 */
export async function createManualInvestmentsAccount(accountData: CreateManualInvestmentsAccountInput): Promise<string> {
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
 * Set logo for a Monarch account using a pre-uploaded Cloudinary image
 * @param accountId - Monarch account ID
 * @param cloudinaryPublicId - Cloudinary public ID for the logo
 * @returns Updated account with logo information
 * @throws If logo setting fails
 */
export async function setAccountLogo(accountId: string, cloudinaryPublicId: string): Promise<SetAccountLogoResult> {
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
 * Get filtered accounts from Monarch
 * Uses the Web_GetFilteredAccounts operation to retrieve detailed account information.
 * @param filters - Optional filters for the query (default: {} for all accounts)
 * @returns Array of account objects
 */
export async function getFilteredAccounts(filters: AccountFilters = {}): Promise<FilteredAccount[]> {
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
    invertSyncedBalance
    useAvailableBalance
    hideFromList
    hideTransactionsFromReports
    excludeFromDebtPaydown
    apr
    interestRate
    plannedPayment
    minimumPayment
    limit
    type {
      display
      name
      __typename
    }
    subtype {
      name
      display
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
 * Update an existing account in Monarch
 * Uses the Common_UpdateAccount mutation to modify account properties.
 * @param input - Account update input with id and fields to update
 * @returns Updated account object
 * @throws If account ID is missing or update fails
 */
export async function updateAccount(input: UpdateAccountInput): Promise<UpdatedAccountResult> {
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
 * Get all accounts grouped by type
 * Returns accounts organized by type (Cash, Credit Cards, Investments, Loans, Vehicles, etc.)
 * with summaries per type including total balances.
 * @param filters - Optional account filters
 * @returns Accounts grouped by type with summaries
 */
export async function getAccountsByType(filters: AccountFilters = {}): Promise<GetAccountsByTypeResult> {
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
    (sum: number, summary: AccountTypeSummary) => sum + summary.accounts.length,
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
 * @param monarchAccountId - The stored Monarch account ID
 * @param storageKey - The full storage key for this mapping
 * @param previousAccountName - Name of the previously mapped account (for warning message)
 * @returns Validation result with account data or warning
 */
export async function validateAndRefreshAccountMapping(
  monarchAccountId: string,
  storageKey: string,
  previousAccountName: string | null = null,
): Promise<ValidateAccountMappingResult> {
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
    const refreshedMapping: RefreshedAccountMapping = {
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
 * @param accountId - Monarch account ID
 * @returns Credit limit value, or null if not set
 * @throws If account ID is missing or account not found
 */
export async function getCreditLimit(accountId: string): Promise<number | null> {
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
 * Build an `UpdateAccountInput` payload preserving all existing account configuration.
 * @param account - Current filtered account from Monarch
 * @param overrides - Fields to override
 * @returns Input object for `Common_UpdateAccount`
 */
function buildUpdateAccountInput(
  account: FilteredAccount,
  overrides: Partial<UpdateAccountInput> = {},
): UpdateAccountInput {
  const input: UpdateAccountInput = {
    id: account.id,
    dataProvider: account.dataProvider || '',
    dataProviderAccountId: null,
    name: account.displayName,
    type: account.type.name,
    displayBalance: account.displayBalance,
    invertSyncedBalance: account.invertSyncedBalance ?? false,
    useAvailableBalance: account.useAvailableBalance ?? false,
    hideFromList: account.hideFromList ?? false,
    hideTransactionsFromReports: account.hideTransactionsFromReports ?? false,
    synced: !account.isManual,
    apr: account.apr ?? null,
    interestRate: account.interestRate ?? null,
    excludeFromDebtPaydown: account.excludeFromDebtPaydown ?? false,
    deactivatedAt: account.deactivatedAt,
    includeInNetWorth: account.includeBalanceInNetWorth,
    limit: account.limit ?? null,
    plannedPayment: account.plannedPayment ?? null,
    minimumPayment: account.minimumPayment ?? null,
    recurrence: {},
    ownerUserId: account.ownedByUser ? account.ownedByUser.id : null,
  };

  if (account.subtype?.name) {
    input.subtype = account.subtype.name;
  }

  return {
    ...input,
    ...overrides,
  };
}

/**
 * Close/deactivate a Monarch account as of the given `YYYY-MM-DD` date.
 * Monarch automatically sets `syncDisabled: true`, `isHidden: true`,
 * `currentBalance: 0`, `displayBalance: 0`, and `includeBalanceInNetWorth: false`.
 * @param accountId - Monarch account ID
 * @param deactivatedAt - Closure date in `YYYY-MM-DD` format
 * @returns Updated account object
 * @throws If account ID is missing, date is malformed, or the update fails
 */
export async function closeAccount(
  accountId: string,
  deactivatedAt: string,
): Promise<UpdatedAccountResult> {
  if (!accountId) {
    throw new Error('Account ID is required');
  }

  if (!deactivatedAt || !/^\d{4}-\d{2}-\d{2}$/.test(deactivatedAt)) {
    throw new Error('Closure date must be in YYYY-MM-DD format');
  }

  debugLog(`Closing Monarch account ${accountId} as of ${deactivatedAt}`);

  const updatedAccount = await updateAccount({
    id: accountId,
    deactivatedAt,
  });
  debugLog(`Successfully closed Monarch account ${updatedAccount.displayName} (deactivatedAt=${updatedAccount.deactivatedAt})`);

  return updatedAccount;
}

/**
 * Set a new credit limit for a credit card account
 * Fetches current account configuration and updates only the credit limit.
 * @param accountId - Monarch account ID
 * @param newLimit - New credit limit value
 * @returns Updated account object
 * @throws If account ID is missing, newLimit is invalid, or account not found
 */
export async function setCreditLimit(accountId: string, newLimit: number): Promise<UpdatedAccountResult> {
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

  // Only `limit` is intentionally changed; everything else comes from the
  // current account state so user settings are not silently reset to defaults.
  const updateInput = buildUpdateAccountInput(account, {
    subtype: account.subtype?.name ?? 'credit_card',
    limit: newLimit,
  });

  const updatedAccount = await updateAccount(updateInput);
  debugLog(`Successfully set credit limit for ${updatedAccount.displayName} to ${updatedAccount.limit}`);

  return updatedAccount;
}