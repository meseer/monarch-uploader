/**
 * Transaction Deduplication Service
 *
 * Generic transaction deduplication logic for any integration that supports
 * transaction upload with dedup tracking (hasDeduplication capability).
 * Filters out already-uploaded settled and pending transactions using
 * stored transaction IDs from the consolidated account storage.
 *
 * @module services/common/deduplication
 */

import { debugLog } from '../../core/utils';
import accountService from './accountService';
import { getTransactionIdsFromArray } from '../../utils/transactionStorage';

/**
 * Filter out already-uploaded settled transactions.
 *
 * Compares each transaction's reference number against the set of
 * previously uploaded transaction IDs stored in the account's
 * uploadedTransactions array.
 *
 * @param {string} integrationId - Integration identifier
 * @param {string} accountId - Source account ID
 * @param {Array} transactions - Array of settled transactions
 * @param {Function} getRefId - Function to extract the reference ID from a transaction
 * @returns {{newTransactions: Array, duplicateCount: number}} Filtered result
 */
export function filterDuplicateSettledTransactions(integrationId, accountId, transactions, getRefId) {
  const accountData = accountService.getAccountData(integrationId, accountId);
  const uploadedRefs = getTransactionIdsFromArray(accountData?.uploadedTransactions || []);
  const originalCount = transactions.length;

  debugLog(`[${integrationId}] Dedup: checking ${originalCount} settled transactions against ${uploadedRefs.size} stored IDs`);

  const newTransactions = transactions.filter((tx) => {
    const refId = getRefId(tx);
    return !uploadedRefs.has(refId);
  });

  const duplicateCount = originalCount - newTransactions.length;

  if (duplicateCount > 0) {
    debugLog(`[${integrationId}] Filtered out ${duplicateCount} duplicate settled transactions`);
  }

  return { newTransactions, duplicateCount };
}

/**
 * Filter out already-uploaded pending transactions.
 *
 * Compares each pending transaction's generated hash ID against
 * the set of previously uploaded transaction IDs.
 *
 * @param {string} integrationId - Integration identifier
 * @param {string} accountId - Source account ID
 * @param {Array} transactions - Array of pending transactions
 * @param {Function} getRefId - Function to extract the hash/reference ID from a pending transaction
 * @returns {{newTransactions: Array, duplicateCount: number}} Filtered result
 */
export function filterDuplicatePendingTransactions(integrationId, accountId, transactions, getRefId) {
  const accountData = accountService.getAccountData(integrationId, accountId);
  const uploadedRefs = getTransactionIdsFromArray(accountData?.uploadedTransactions || []);
  const originalCount = transactions.length;

  const newTransactions = transactions.filter((tx) => {
    const refId = getRefId(tx);
    return !refId || !uploadedRefs.has(refId);
  });

  const duplicateCount = originalCount - newTransactions.length;

  if (duplicateCount > 0) {
    debugLog(`[${integrationId}] Filtered out ${duplicateCount} duplicate pending transactions`);
  }

  return { newTransactions, duplicateCount };
}

/**
 * Get the set of already-uploaded transaction IDs for an account.
 *
 * Convenience function for integrations that need direct access
 * to the uploaded ID set (e.g., for custom filtering logic).
 *
 * @param {string} integrationId - Integration identifier
 * @param {string} accountId - Source account ID
 * @returns {Set<string>} Set of uploaded transaction IDs
 */
export function getUploadedTransactionIds(integrationId, accountId) {
  const accountData = accountService.getAccountData(integrationId, accountId);
  return getTransactionIdsFromArray(accountData?.uploadedTransactions || []);
}

export default {
  filterDuplicateSettledTransactions,
  filterDuplicatePendingTransactions,
  getUploadedTransactionIds,
};