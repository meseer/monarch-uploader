/**
 * Wealthsimple Transactions - Reconciliation
 * Handles pending transaction reconciliation and status tracking
 */

import { debugLog, formatDate } from '../../core/utils';
import monarchApi from '../../api/monarch';

/**
 * Custom prefix for Wealthsimple transaction IDs stored in Monarch notes
 * This prefix is used to identify and extract transaction IDs from notes
 * Format: ws-tx:{original_transaction_id}
 * Examples:
 * - ws-tx:funding_intent-DzO09kH88ikMLBaZ76BLXNE3rYM
 * - ws-tx:credit-transaction-527000993851-20260111-00-32943086
 * - ws-tx:credit-payment-123456
 * - ws-tx:user_bonus_9898300
 */
const WEALTHSIMPLE_TX_ID_PREFIX = 'ws-tx:';

/**
 * Format a Wealthsimple transaction ID for storage in Monarch notes
 * @param {string} transactionId - Original Wealthsimple transaction ID
 * @returns {string} Formatted ID with prefix (e.g., "ws-tx:funding_intent-xxx")
 */
export function formatTransactionIdForNotes(transactionId) {
  if (!transactionId) return '';
  return `${WEALTHSIMPLE_TX_ID_PREFIX}${transactionId}`;
}

/**
 * Regex pattern to extract Wealthsimple transaction ID from notes
 * Matches both formats:
 * - New format: ws-tx:{any_transaction_id}
 * - Legacy format: credit-transaction-{digits}-{digits}-{digits}-{digits}
 */
const WEALTHSIMPLE_TX_ID_PATTERN = /ws-tx:([\w-]+)|credit-transaction-[\w-]+/;

/**
 * Extract Wealthsimple transaction ID from Monarch transaction notes
 * Handles multiple formats:
 * - New format: "TYPE / ws-tx:xxx" or "ws-tx:xxx"
 * - Legacy format: "TYPE / credit-transaction-xxx" or "credit-transaction-xxx"
 * Also handles user-added notes anywhere in the string
 * @param {string} notes - Transaction notes from Monarch
 * @returns {string|null} Extracted transaction ID (without ws-tx: prefix) or null if not found
 */
function extractTransactionIdFromNotes(notes) {
  if (!notes || typeof notes !== 'string') {
    return null;
  }

  const match = notes.match(WEALTHSIMPLE_TX_ID_PATTERN);
  if (!match) {
    return null;
  }

  // If it matched the ws-tx: format, return the captured group (without prefix)
  if (match[1]) {
    return match[1];
  }

  // If it matched the legacy credit-transaction format, return the whole match
  return match[0];
}

/**
 * Remove Wealthsimple system notes (transaction ID) from notes
 * Preserves any user-added notes (memo, technical details)
 * Handles formats:
 * - "ws-tx:xxx" -> "" (current format)
 * - "memo\nws-tx:xxx" -> "memo"
 * - "memo\n\ntechnical\nws-tx:xxx" -> "memo\n\ntechnical"
 * - "TYPE / ws-tx:xxx" -> "" (legacy format)
 * - "credit-transaction-xxx" -> "" (legacy format)
 * @param {string} notes - Transaction notes
 * @returns {string} Cleaned notes (memo and technical details preserved)
 */
function cleanSystemNotesFromNotes(notes) {
  if (!notes || typeof notes !== 'string') {
    return '';
  }

  let cleaned = notes;

  // Remove "TYPE / ws-tx:xxx" pattern (legacy format)
  cleaned = cleaned.replace(/\w+\s*\/\s*ws-tx:[\w-]+/g, '');

  // Remove standalone "ws-tx:xxx" pattern (current format - just the transaction ID)
  cleaned = cleaned.replace(/ws-tx:[\w-]+/g, '');

  // Remove "TYPE / credit-transaction-xxx" pattern (legacy)
  cleaned = cleaned.replace(/\w+\s*\/\s*credit-transaction-[\w-]+/g, '');

  // Remove standalone "credit-transaction-xxx" pattern (legacy)
  cleaned = cleaned.replace(/credit-transaction-[\w-]+/g, '');

  // Clean up separators and whitespace
  // Remove leading/trailing separators like " / " or " | "
  cleaned = cleaned.replace(/^\s*[/|]\s*/g, '');
  cleaned = cleaned.replace(/\s*[/|]\s*$/g, '');

  // Clean up trailing newlines from removed transaction ID line
  cleaned = cleaned.replace(/\n+$/g, '');

  // Clean up multiple consecutive spaces (but preserve newlines for memo formatting)
  cleaned = cleaned.replace(/ +/g, ' ');

  return cleaned.trim();
}

/**
 * Check if a transaction is a SPEND/PREPAID type (uses status field like credit cards)
 * @param {Object} transaction - Raw transaction from API
 * @returns {boolean} True if SPEND/PREPAID transaction
 */
function isSpendPrepaidTransaction(transaction) {
  return transaction.type === 'SPEND' && transaction.subType === 'PREPAID';
}

/**
 * Investment account types for status field determination
 */
const INVESTMENT_ACCOUNT_TYPES = new Set([
  'MANAGED_RESP_FAMILY',
  'MANAGED_RESP',
  'MANAGED_NON_REGISTERED',
  'MANAGED_TFSA',
  'MANAGED_RRSP',
  'SELF_DIRECTED_RESP_FAMILY',
  'SELF_DIRECTED_RESP',
  'SELF_DIRECTED_NON_REGISTERED',
  'SELF_DIRECTED_TFSA',
  'SELF_DIRECTED_RRSP',
  'SELF_DIRECTED_CRYPTO',
]);

/**
 * Get the transaction status for reconciliation based on account type and transaction type
 * Credit cards use 'status' field, CASH accounts use 'unifiedStatus' field,
 * EXCEPT for SPEND/PREPAID transactions in CASH accounts which use 'status' field.
 * Investment accounts use 'unifiedStatus' for most transactions, but 'status' for internal transfers.
 *
 * @param {Object} transaction - Raw Wealthsimple transaction
 * @param {string} accountType - Account type (CREDIT_CARD, CASH, CASH_USD, investment types, etc.)
 * @returns {Object} Status info { isPending, isSettled, rawStatus }
 */
function getTransactionStatusForReconciliation(transaction, accountType) {
  const isCashAccount = accountType === 'CASH' || accountType === 'CASH_USD';
  const isInvestmentAccountType = INVESTMENT_ACCOUNT_TYPES.has(accountType);

  if (isCashAccount) {
    // SPEND/PREPAID transactions use 'status' field (like credit cards)
    if (isSpendPrepaidTransaction(transaction)) {
      const status = transaction.status;
      return {
        isPending: status === 'authorized',
        isSettled: status === 'settled',
        rawStatus: status,
      };
    }

    // Regular CASH transactions use unifiedStatus field
    const status = transaction.unifiedStatus;
    return {
      isPending: status === 'IN_PROGRESS' || status === 'PENDING',
      isSettled: status === 'COMPLETED',
      rawStatus: status,
    };
  }

  if (isInvestmentAccountType) {
    // Internal transfers in investment accounts use 'status' field
    if (transaction.type === 'INTERNAL_TRANSFER') {
      const status = transaction.status;
      return {
        isPending: status === 'authorized',
        isSettled: status === 'settled' || status === 'completed',
        rawStatus: status,
      };
    }

    // Most investment transactions use unifiedStatus field
    // This includes buy/sell orders, deposits, dividends, etc.
    const status = transaction.unifiedStatus;
    return {
      isPending: status === 'IN_PROGRESS' || status === 'PENDING',
      isSettled: status === 'COMPLETED',
      rawStatus: status,
    };
  }

  // Credit cards and other accounts use status field
  const status = transaction.status;
  return {
    isPending: status === 'authorized',
    isSettled: status === 'settled',
    rawStatus: status,
  };
}

/**
 * Reconcile pending transactions for a Wealthsimple account (credit card or CASH)
 * This function:
 * 1. Finds all Monarch transactions with "Pending" tag for the account
 * 2. For each pending transaction, extracts the Wealthsimple transaction ID from notes
 * 3. Checks the status in the loaded Wealthsimple transactions:
 *    - Credit cards: 'authorized' = pending, 'settled' = completed
 *    - CASH accounts: 'IN_PROGRESS'/'PENDING' = pending, 'COMPLETED' = completed
 *    - Other status or not found: Delete from Monarch (cancelled)
 *
 * @param {string} monarchAccountId - Monarch account ID
 * @param {Array} wealthsimpleTransactions - Array of raw transactions from Wealthsimple API
 * @param {number} lookbackDays - Number of days to look back for pending transactions
 * @param {string} accountType - Account type for status field interpretation (default: 'CREDIT_CARD')
 * @returns {Promise<Object>} Reconciliation result { success, settled, cancelled, error }
 */
export async function reconcilePendingTransactions(monarchAccountId, wealthsimpleTransactions, lookbackDays, accountType = 'CREDIT_CARD') {
  const result = { success: true, settled: 0, cancelled: 0, failed: 0, error: null };

  try {
    debugLog('Starting pending transaction reconciliation', {
      monarchAccountId,
      transactionsLoaded: wealthsimpleTransactions?.length || 0,
      lookbackDays,
    });

    // Step 1: Get the "Pending" tag from Monarch
    debugLog('Fetching "Pending" tag from Monarch...');
    const pendingTag = await monarchApi.getTagByName('Pending');

    if (!pendingTag) {
      debugLog('No "Pending" tag found in Monarch, skipping reconciliation');
      return { ...result, noPendingTag: true };
    }

    debugLog(`Found "Pending" tag with ID: ${pendingTag.id}`);

    // Step 2: Calculate date range (local timezone)
    // Start date: lookbackDays in the past
    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - lookbackDays);

    // End date: 1 year in the future to catch transactions with user-modified future dates
    // This handles cases where users adjust transaction dates in Monarch to be in the future
    const endDate = new Date(today);
    endDate.setFullYear(endDate.getFullYear() + 1);

    const startDateStr = formatDate(startDate);
    const endDateStr = formatDate(endDate);

    debugLog(`Searching for pending transactions from ${startDateStr} to ${endDateStr}`);

    // Step 3: Fetch all Monarch transactions with Pending tag for this account
    const pendingTransactionsResult = await monarchApi.getTransactionsList({
      accountIds: [monarchAccountId],
      tags: [pendingTag.id],
      startDate: startDateStr,
      endDate: endDateStr,
    });

    const pendingMonarchTransactions = pendingTransactionsResult.results || [];

    if (pendingMonarchTransactions.length === 0) {
      debugLog('No pending transactions found in Monarch for this account');
      return { ...result, noPendingTransactions: true };
    }

    debugLog(`Found ${pendingMonarchTransactions.length} pending transaction(s) in Monarch to reconcile`);

    // Step 4: Create a map of Wealthsimple transactions by ID for quick lookup
    const wsTransactionMap = new Map();
    if (wealthsimpleTransactions && Array.isArray(wealthsimpleTransactions)) {
      wealthsimpleTransactions.forEach((tx) => {
        if (tx.externalCanonicalId) {
          wsTransactionMap.set(tx.externalCanonicalId, tx);
        }
      });
    }

    debugLog(`Created lookup map with ${wsTransactionMap.size} Wealthsimple transaction(s)`);

    // Step 5: Process each pending Monarch transaction
    for (const monarchTx of pendingMonarchTransactions) {
      try {
        const monarchTxId = monarchTx.id;
        const notes = monarchTx.notes || '';

        debugLog(`Processing pending Monarch transaction ${monarchTxId}`, {
          amount: monarchTx.amount,
          date: monarchTx.date,
          notes,
        });

        // Extract Wealthsimple transaction ID from notes
        const wsTransactionId = extractTransactionIdFromNotes(notes);

        if (!wsTransactionId) {
          debugLog(`Could not extract Wealthsimple transaction ID from notes: "${notes}", skipping`);
          continue;
        }

        debugLog(`Extracted Wealthsimple transaction ID: ${wsTransactionId}`);

        // Look up the transaction in Wealthsimple data
        const wsTx = wsTransactionMap.get(wsTransactionId);

        if (!wsTx) {
          // Transaction not found in Wealthsimple - likely cancelled
          debugLog(`Transaction ${wsTransactionId} not found in Wealthsimple, deleting from Monarch`);

          await monarchApi.deleteTransaction(monarchTxId);
          result.cancelled += 1;

          debugLog(`Deleted cancelled transaction ${monarchTxId} from Monarch`);
          continue;
        }

        // Check transaction status using account-type-aware helper
        const statusInfo = getTransactionStatusForReconciliation(wsTx, accountType);
        debugLog(`Wealthsimple transaction ${wsTransactionId} status:`, {
          rawStatus: statusInfo.rawStatus,
          isPending: statusInfo.isPending,
          isSettled: statusInfo.isSettled,
          accountType,
        });

        if (statusInfo.isPending) {
          // Still pending, no action needed
          debugLog(`Transaction ${wsTransactionId} is still pending, no action needed`);
          continue;
        }

        if (statusInfo.isSettled) {
          // Transaction has settled - update amount (if changed), clean notes, remove Pending tag
          debugLog(`Transaction ${wsTransactionId} has settled, updating Monarch transaction`);

          // Calculate the settled amount (negative for expenses)
          const isNegative = wsTx.amountSign === 'negative';
          const settledAmount = isNegative ? -Math.abs(wsTx.amount) : Math.abs(wsTx.amount);

          // Clean the notes - remove system info but keep user notes
          const cleanedNotes = cleanSystemNotesFromNotes(notes);

          // Check if amount has changed
          const amountChanged = monarchTx.amount !== settledAmount;

          debugLog(`Updating transaction ${monarchTxId}:`, {
            oldAmount: monarchTx.amount,
            newAmount: settledAmount,
            amountChanged,
            oldNotes: notes,
            newNotes: cleanedNotes,
          });

          // Update notes (clean system notes) - separate call to avoid 400 error
          // Include ownerUserId from the original transaction as Monarch requires it
          await monarchApi.updateTransaction(monarchTxId, {
            notes: cleanedNotes,
            ownerUserId: monarchTx.ownedByUser?.id || null,
          });

          // Update amount only if it changed
          if (amountChanged) {
            debugLog(`Updating amount for transaction ${monarchTxId}: ${monarchTx.amount} -> ${settledAmount}`);
            await monarchApi.updateTransaction(monarchTxId, {
              amount: settledAmount,
              ownerUserId: monarchTx.ownedByUser?.id || null,
            });
          }

          // Remove Pending tag
          debugLog(`Removing Pending tag from transaction ${monarchTxId}`);
          await monarchApi.setTransactionTags(monarchTxId, []);

          result.settled += 1;
          debugLog(`Successfully reconciled settled transaction ${monarchTxId}`);
          continue;
        }

        // Unknown status - treat as cancelled (not pending or settled)
        debugLog(`Transaction ${wsTransactionId} has unknown status "${statusInfo.rawStatus}", deleting from Monarch`);
        await monarchApi.deleteTransaction(monarchTxId);
        result.cancelled += 1;
        debugLog(`Deleted transaction ${monarchTxId} with unknown status from Monarch`);
      } catch (txError) {
        debugLog(`Error reconciling transaction ${monarchTx.id}:`, txError);
        result.failed += 1;
        // Continue with other transactions
      }
    }

    debugLog('Pending transaction reconciliation completed', {
      settled: result.settled,
      cancelled: result.cancelled,
      failed: result.failed,
    });

    return result;
  } catch (error) {
    debugLog('Error during pending transaction reconciliation:', error);
    return { ...result, success: false, error: error.message };
  }
}

/**
 * Format reconciliation result message for progress dialog
 * @param {Object} result - Reconciliation result from reconcilePendingTransactions
 * @returns {string} Formatted message
 */
export function formatReconciliationMessage(result) {
  if (result.noPendingTag || result.noPendingTransactions) {
    return 'No pending transactions';
  }

  const parts = [];

  if (result.settled > 0) {
    parts.push(`${result.settled} settled`);
  }

  if (result.cancelled > 0) {
    parts.push(`${result.cancelled} cancelled`);
  }

  if (result.failed > 0) {
    parts.push(`${result.failed} failed`);
  }

  if (parts.length === 0) {
    return 'No pending transactions';
  }

  return parts.join(', ');
}
