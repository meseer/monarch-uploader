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
import monarchApi, { type UploadProcessingUpdate } from '../../api/monarch';
import accountService from './accountService';
import {
  mergeAndRetainTransactions,
  getRetentionSettingsFromAccount,
  type StoredTransaction,
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
 * @param {Array<string|Object>} params.transactionRefs - References for dedup storage.
 *   Either bare ID strings or `{ id, date, merchant }` records. MUST be ordered
 *   oldest-first, matching the oldest-first `uploadedTransactions` storage invariant.
 * @param {Array} params.transactions - Transactions (used to determine the fallback date)
 * @param {Function} [params.onProcessingUpdate] - Progress callback while Monarch processes the upload
 * @returns {Promise<boolean>} True if upload succeeded
 */
interface UploadTransactionsParams {
  integrationId: string;
  sourceAccountId: string;
  monarchAccountId: string;
  csvData: string;
  filename: string;
  transactionRefs: Array<string | StoredTransaction>;
  transactions: Array<{ date?: string; [key: string]: unknown }>;
  onProcessingUpdate?: (update: UploadProcessingUpdate) => void;
}

export async function uploadTransactionsAndSaveRefs({
  integrationId,
  sourceAccountId,
  monarchAccountId,
  csvData,
  filename,
  transactionRefs,
  transactions,
  onProcessingUpdate,
}: UploadTransactionsParams): Promise<boolean> {
  const uploadSuccess = await monarchApi.uploadTransactions(monarchAccountId, csvData, { filename, onProcessingUpdate });

  if (!uploadSuccess) {
    return false;
  }

  // Save transaction IDs to dedup store
  if (transactionRefs.length > 0) {
    // Fallback date, used only for refs that arrive as bare strings (no date of
    // their own). Record refs carry their real transaction date.
    let txDate = getTodayLocal();
    const withDates = transactions.filter((tx) => tx.date);
    if (withDates.length > 0) {
      const sortedDates = [...withDates].sort((a, b) => b.date.localeCompare(a.date));
      txDate = sortedDates[0].date;
    }

    const accountData = accountService.getAccountData(integrationId, sourceAccountId);
    const existingTransactions = (accountData?.uploadedTransactions as unknown[]) || [];
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
export function formatTransactionUploadMessage(settledCount: number, pendingCount: number, duplicateCount: number): string {
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

/**
 * After this long, the processing message says Monarch is slow and asks the
 * user to keep the tab open, so a slow import is not mistaken for a stuck sync
 * and retried — the retry is what uploads the transactions a second time.
 */
const SLOW_PROCESSING_NOTICE_MS = 60 * 1000;

/**
 * Format elapsed milliseconds as m:ss.
 *
 * @param {number} elapsedMs - Elapsed time in milliseconds
 * @returns {string} Elapsed time, e.g. "1:05"
 */
function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Build a progress message for the wait while Monarch processes an upload.
 *
 * The elapsed time and check count change on every status check, so the user
 * can see the sync is actively waiting on Monarch rather than stuck.
 *
 * @param {UploadProcessingUpdate} update - Latest processing update
 * @returns {string} Formatted message
 */
export function formatMonarchProcessingMessage({ elapsedMs, checks }: UploadProcessingUpdate): string {
  const elapsed = formatElapsed(elapsedMs);
  if (elapsedMs < SLOW_PROCESSING_NOTICE_MS) {
    return `Waiting for Monarch to process... ${elapsed} (check ${checks})`;
  }
  return `Monarch is taking a while... ${elapsed} (check ${checks}), keep this tab open`;
}
