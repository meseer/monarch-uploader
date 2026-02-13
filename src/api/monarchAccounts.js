/**
 * Monarch Money API - Account Management Operations
 * Functions for creating, updating, and querying accounts
 */

import { debugLog } from '../core/utils';
import { callMonarchGraphQL, searchSecurities } from './monarch';

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

