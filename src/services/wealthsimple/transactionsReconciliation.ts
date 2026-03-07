/**
 * Wealthsimple Transactions - Reconciliation
 * Handles pending transaction reconciliation and status tracking
 */

import { debugLog, formatDate } from '../../core/utils';
import monarchApi from '../../api/monarch';

/**
 * Custom prefix for Wealthsimple transaction IDs stored in Monarch notes
 * Format: ws-tx:{original_transaction_id}
 */
const WEALTHSIMPLE_TX_ID_PREFIX = 'ws-tx:';

/**
 * Format a Wealthsimple transaction ID for storage in Monarch notes
 */
export function formatTransactionIdForNotes(transactionId: string | null | undefined): string {
  if (!transactionId) return '';
  return `${WEALTHSIMPLE_TX_ID_PREFIX}${transactionId}`;
}

/**
 * Regex pattern to extract Wealthsimple transaction ID from notes
 */
const WEALTHSIMPLE_TX_ID_PATTERN = /ws-tx:([\w-]+)|credit-transaction-[\w-]+/;

/**
 * Extract Wealthsimple transaction ID from Monarch transaction notes
 */
function extractTransactionIdFromNotes(notes: string | null | undefined): string | null {
  if (!notes || typeof notes !== 'string') {
    return null;
  }

  const match = notes.match(WEALTHSIMPLE_TX_ID_PATTERN);
  if (!match) {
    return null;
  }

  if (match[1]) {
    return match[1];
  }

  return match[0];
}

/**
 * Remove Wealthsimple system notes (transaction ID) from notes
 * Preserves any user-added notes (memo, technical details)
 */
function cleanSystemNotesFromNotes(notes: string | null | undefined): string {
  if (!notes || typeof notes !== 'string') {
    return '';
  }

  let cleaned = notes;

  cleaned = cleaned.replace(/\w+\s*\/\s*ws-tx:[\w-]+/g, '');
  cleaned = cleaned.replace(/ws-tx:[\w-]+/g, '');
  cleaned = cleaned.replace(/\w+\s*\/\s*credit-transaction-[\w-]+/g, '');
  cleaned = cleaned.replace(/credit-transaction-[\w-]+/g, '');

  cleaned = cleaned.replace(/^\s*[/|]\s*/g, '');
  cleaned = cleaned.replace(/\s*[/|]\s*$/g, '');
  cleaned = cleaned.replace(/\n+$/g, '');
  cleaned = cleaned.replace(/ +/g, ' ');

  return cleaned.trim();
}

/**
 * Check if a transaction is a SPEND/PREPAID type (uses status field like credit cards)
 */
function isSpendPrepaidTransaction(transaction: Record<string, unknown>): boolean {
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

interface TransactionStatusInfo {
  isPending: boolean;
  isSettled: boolean;
  rawStatus: string | null | undefined;
}

/**
 * Get the transaction status for reconciliation based on account type and transaction type
 */
function getTransactionStatusForReconciliation(
  transaction: Record<string, unknown>,
  accountType: string,
): TransactionStatusInfo {
  const isCashAccount = accountType === 'CASH' || accountType === 'CASH_USD';
  const isInvestmentAccountType = INVESTMENT_ACCOUNT_TYPES.has(accountType);

  if (isCashAccount) {
    if (isSpendPrepaidTransaction(transaction)) {
      const status = transaction.status as string | null | undefined;
      return {
        isPending: status === 'authorized',
        isSettled: status === 'settled',
        rawStatus: status,
      };
    }

    const status = transaction.unifiedStatus as string | null | undefined;
    return {
      isPending: status === 'IN_PROGRESS' || status === 'PENDING',
      isSettled: status === 'COMPLETED',
      rawStatus: status,
    };
  }

  if (isInvestmentAccountType) {
    if (transaction.type === 'INTERNAL_TRANSFER') {
      const status = transaction.status as string | null | undefined;
      return {
        isPending: status === 'authorized',
        isSettled: status === 'settled' || status === 'completed',
        rawStatus: status,
      };
    }

    const status = transaction.unifiedStatus as string | null | undefined;
    return {
      isPending: status === 'IN_PROGRESS' || status === 'PENDING',
      isSettled: status === 'COMPLETED',
      rawStatus: status,
    };
  }

  const status = transaction.status as string | null | undefined;
  return {
    isPending: status === 'authorized',
    isSettled: status === 'settled',
    rawStatus: status,
  };
}

export interface ReconciliationResult {
  success: boolean;
  settled: number;
  cancelled: number;
  failed: number;
  error: string | null;
  noPendingTag?: boolean;
  noPendingTransactions?: boolean;
}

/**
 * Reconcile pending transactions for a Wealthsimple account
 */
export async function reconcilePendingTransactions(
  monarchAccountId: string,
  wealthsimpleTransactions: Record<string, unknown>[],
  lookbackDays: number,
  accountType = 'CREDIT_CARD',
): Promise<ReconciliationResult> {
  const result: ReconciliationResult = { success: true, settled: 0, cancelled: 0, failed: 0, error: null };

  try {
    debugLog('Starting pending transaction reconciliation', {
      monarchAccountId,
      transactionsLoaded: wealthsimpleTransactions?.length || 0,
      lookbackDays,
    });

    debugLog('Fetching "Pending" tag from Monarch...');
    const pendingTag = await monarchApi.getTagByName('Pending');

    if (!pendingTag) {
      debugLog('No "Pending" tag found in Monarch, skipping reconciliation');
      return { ...result, noPendingTag: true };
    }

    debugLog(`Found "Pending" tag with ID: ${pendingTag.id}`);

    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - lookbackDays);

    const endDate = new Date(today);
    endDate.setFullYear(endDate.getFullYear() + 1);

    const startDateStr = formatDate(startDate);
    const endDateStr = formatDate(endDate);

    debugLog(`Searching for pending transactions from ${startDateStr} to ${endDateStr}`);

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

    const wsTransactionMap = new Map<string, Record<string, unknown>>();
    if (wealthsimpleTransactions && Array.isArray(wealthsimpleTransactions)) {
      wealthsimpleTransactions.forEach((tx) => {
        if (tx.externalCanonicalId) {
          wsTransactionMap.set(tx.externalCanonicalId as string, tx);
        }
      });
    }

    debugLog(`Created lookup map with ${wsTransactionMap.size} Wealthsimple transaction(s)`);

    for (const monarchTx of pendingMonarchTransactions) {
      try {
        const monarchTxId = monarchTx.id;
        const notes = (monarchTx.notes as string) || '';

        debugLog(`Processing pending Monarch transaction ${monarchTxId}`, {
          amount: monarchTx.amount,
          date: monarchTx.date,
          notes,
        });

        const wsTransactionId = extractTransactionIdFromNotes(notes);

        if (!wsTransactionId) {
          debugLog(`Could not extract Wealthsimple transaction ID from notes: "${notes}", skipping`);
          continue;
        }

        debugLog(`Extracted Wealthsimple transaction ID: ${wsTransactionId}`);

        const wsTx = wsTransactionMap.get(wsTransactionId);

        if (!wsTx) {
          debugLog(`Transaction ${wsTransactionId} not found in Wealthsimple, deleting from Monarch`);
          await monarchApi.deleteTransaction(monarchTxId);
          result.cancelled += 1;
          debugLog(`Deleted cancelled transaction ${monarchTxId} from Monarch`);
          continue;
        }

        const statusInfo = getTransactionStatusForReconciliation(wsTx, accountType);
        debugLog(`Wealthsimple transaction ${wsTransactionId} status:`, {
          rawStatus: statusInfo.rawStatus,
          isPending: statusInfo.isPending,
          isSettled: statusInfo.isSettled,
          accountType,
        });

        if (statusInfo.isPending) {
          debugLog(`Transaction ${wsTransactionId} is still pending, no action needed`);
          continue;
        }

        if (statusInfo.isSettled) {
          debugLog(`Transaction ${wsTransactionId} has settled, updating Monarch transaction`);

          const isNegative = wsTx.amountSign === 'negative';
          const settledAmount = isNegative ? -Math.abs(wsTx.amount as number) : Math.abs(wsTx.amount as number);

          const cleanedNotes = cleanSystemNotesFromNotes(notes);
          const amountChanged = monarchTx.amount !== settledAmount;

          debugLog(`Updating transaction ${monarchTxId}:`, {
            oldAmount: monarchTx.amount,
            newAmount: settledAmount,
            amountChanged,
            oldNotes: notes,
            newNotes: cleanedNotes,
          });

          await monarchApi.updateTransaction(monarchTxId, {
            notes: cleanedNotes,
            ownerUserId: (monarchTx.ownedByUser as Record<string, unknown>)?.id || null,
          });

          if (amountChanged) {
            debugLog(`Updating amount for transaction ${monarchTxId}: ${monarchTx.amount} -> ${settledAmount}`);
            await monarchApi.updateTransaction(monarchTxId, {
              amount: settledAmount,
              ownerUserId: (monarchTx.ownedByUser as Record<string, unknown>)?.id || null,
            });
          }

          debugLog(`Removing Pending tag from transaction ${monarchTxId}`);
          await monarchApi.setTransactionTags(monarchTxId, []);

          result.settled += 1;
          debugLog(`Successfully reconciled settled transaction ${monarchTxId}`);
          continue;
        }

        debugLog(`Transaction ${wsTransactionId} has unknown status "${statusInfo.rawStatus}", deleting from Monarch`);
        await monarchApi.deleteTransaction(monarchTxId);
        result.cancelled += 1;
        debugLog(`Deleted transaction ${monarchTxId} with unknown status from Monarch`);
      } catch (txError) {
        debugLog(`Error reconciling transaction ${monarchTx.id}:`, txError);
        result.failed += 1;
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
    return { ...result, success: false, error: (error as Error).message };
  }
}

/**
 * Format reconciliation result message for progress dialog
 */
export function formatReconciliationMessage(result: ReconciliationResult): string {
  if (result.noPendingTag || result.noPendingTransactions) {
    return 'No pending transactions';
  }

  const parts: string[] = [];

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
    return 'Nothing settled or cancelled';
  }

  return parts.join(', ');
}
