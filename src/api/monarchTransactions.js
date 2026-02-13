/**
 * Monarch Money API - Transaction Operations
 * Functions for querying, updating, and deleting transactions
 */

import { debugLog } from '../core/utils';
import { callMonarchGraphQL } from './monarch';

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

