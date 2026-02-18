/**
 * Transaction Upload Service
 *
 * Generic transaction upload logic for any integration. Handles the common
 * pattern of uploading transaction CSV to Monarch and saving dedup references
 * to consolidated account storage.
 *
 * @module services/common/transactionUpload
 */

import { getTodayLocal, saveLastUploadDate } from '../../core/utils';
import monarchApi from '../../api/monarch';
import accountService from './accountService';
import {
  mergeAndRetainTransactions,
  getRetentionSettingsFromAccount,
} from '../../utils/transactionStorage';

/**
 * Upload transaction CSV to Monarch and save dedup references.
 *
 * This is the final step in the transaction sync pipeline, after
 * deduplication, category resolution, and CSV conversion are complete.
 *
 * @param {Object} params - Upload parameters
 * @param {string} params.integrationId - Integration identifier
 * @param {string} params.sourceAccountId - Source institution account ID
 * @param {string} params.monarchAccountId - Monarch account ID
 * @param {string} params.csvData - CSV content ready for upload
 * @param {string} params.filename - Filename for the upload
 * @param {Array<string>} params.transactionRefs - Reference IDs for dedup storage
 * @param {Array} params.transactions - Transactions (used to determine latest date)
 * @returns {Promise<boolean>} True if upload succeeded
 */
export async function uploadTransactionsAndSaveRefs({
  integrationId,
  sourceAccountId,
  monarchAccountId,
  csvData,
  filename,
  transactionRefs,
  transactions,
}) {
  const uploadSuccess = await monarchApi.uploadTransactions(monarchAccountId, csvData, filename, false, false);

  if (!uploadSuccess) {
    return false;
  }

  // Save transaction IDs to dedup store
  if (transactionRefs.length > 0) {
    let txDate = getTodayLocal();
    const withDates = transactions.filter((tx) => tx.date);
    if (withDates.length > 0) {
      withDates.sort((a, b) => b.date.localeCompare(a.date));
      txDate = withDates[0].date;
    }

    const accountData = accountService.getAccountData(integrationId, sourceAccountId);
    const existingTransactions = accountData?.uploadedTransactions || [];
    const retentionSettings = getRetentionSettingsFromAccount(accountData);
    const updatedTransactions = mergeAndRetainTransactions(
      existingTransactions,
      transactionRefs,
      retentionSettings,
      txDate,
    );

    accountService.updateAccountInList(integrationId, sourceAccountId, {
      uploadedTransactions: updatedTransactions,
    });
  }

  saveLastUploadDate(sourceAccountId, getTodayLocal(), integrationId);

  return true;
}

/**
 * Build a human-readable transaction count message for progress display.
 *
 * @param {number} settledCount - Number of new settled transactions uploaded
 * @param {number} pendingCount - Number of new pending transactions uploaded
 * @param {number} duplicateCount - Number of transactions skipped (already uploaded)
 * @returns {string} Formatted message
 */
export function formatTransactionUploadMessage(settledCount, pendingCount, duplicateCount) {
  const parts = [];
  if (settledCount > 0) parts.push(`${settledCount} settled`);
  if (pendingCount > 0) parts.push(`${pendingCount} pending`);
  const uploadedMsg = parts.join(', ');

  if (uploadedMsg && duplicateCount > 0) {
    return `${uploadedMsg} uploaded (${duplicateCount} skipped)`;
  }
  if (uploadedMsg) {
    return `${uploadedMsg} uploaded`;
  }
  if (duplicateCount > 0) {
    return `${duplicateCount} already uploaded`;
  }
  return 'No new';
}

export default {
  uploadTransactionsAndSaveRefs,
  formatTransactionUploadMessage,
};