/**
 * Wealthsimple Transactions - Reconciliation
 * Handles pending transaction reconciliation and status tracking
 */

import { debugLog } from '../../core/utils';
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
 * Update dividend notes when a pending dividend settles.
 * Replaces "Upcoming dividend on {symbol}" with "Dividend on {symbol}"
 * so the notes reflect the settled state.
 */
function updateSettledDividendNotes(notes: string): string {
  return notes.replace(/^Upcoming dividend on /m, 'Dividend on ');
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
/**
 * Phase 2: Reconcile pre-fetched Monarch pending transactions against Wealthsimple data.
 *
 * Uses externalCanonicalId-based matching (not hash-based like the common service).
 * Accepts pre-fetched pendingTag and monarchPendingTransactions from the shared Phase 1.
 *
 * @param pendingTag - Monarch "Pending" tag object
 * @param monarchPendingTransactions - Pre-fetched Monarch transactions with Pending tag
 * @param wealthsimpleTransactions - Current WS transactions (with extended date range)
 * @param accountType - WS account type for status determination
 * @returns Reconciliation result
 */
export async function reconcileWealthsimpleFetchedPending(
  pendingTag: { id: string; name: string },
  monarchPendingTransactions: Array<Record<string, unknown>>,
  wealthsimpleTransactions: Record<string, unknown>[],
  accountType = 'CREDIT_CARD',
): Promise<ReconciliationResult> {
  const result: ReconciliationResult = { success: true, settled: 0, cancelled: 0, failed: 0, error: null };

  try {
    debugLog('[ws-reconciliation:phase2] Starting reconciliation', {
      monarchPendingCount: monarchPendingTransactions.length,
      wsTransactionsCount: wealthsimpleTransactions?.length || 0,
      accountType,
    });

    const wsTransactionMap = new Map<string, Record<string, unknown>>();
    if (wealthsimpleTransactions && Array.isArray(wealthsimpleTransactions)) {
      wealthsimpleTransactions.forEach((tx) => {
        if (tx.externalCanonicalId) {
          wsTransactionMap.set(tx.externalCanonicalId as string, tx);
        }
      });
    }

    debugLog(`[ws-reconciliation:phase2] Lookup map: ${wsTransactionMap.size} WS transaction(s)`);

    for (const monarchTx of monarchPendingTransactions) {
      try {
        const monarchTxId = monarchTx.id as string;
        const notes = (monarchTx.notes as string) || '';

        const wsTransactionId = extractTransactionIdFromNotes(notes);

        if (!wsTransactionId) {
          debugLog(`[ws-reconciliation:phase2] Could not extract WS ID from notes: "${notes}", skipping`);
          continue;
        }

        const wsTx = wsTransactionMap.get(wsTransactionId);

        if (!wsTx) {
          debugLog(`[ws-reconciliation:phase2] ${wsTransactionId} not found in WS, deleting`);
          await monarchApi.deleteTransaction(monarchTxId);
          result.cancelled += 1;
          continue;
        }

        const statusInfo = getTransactionStatusForReconciliation(wsTx, accountType);

        if (statusInfo.isPending) {
          debugLog(`[ws-reconciliation:phase2] ${wsTransactionId} still pending, no action`);
          continue;
        }

        if (statusInfo.isSettled) {
          debugLog(`[ws-reconciliation:phase2] ${wsTransactionId} settled, updating`);

          const isNegative = wsTx.amountSign === 'negative';
          const settledAmount = isNegative ? -Math.abs(wsTx.amount as number) : Math.abs(wsTx.amount as number);

          let cleanedNotes = cleanSystemNotesFromNotes(notes);
          if (wsTx.type === 'DIVIDEND') {
            cleanedNotes = updateSettledDividendNotes(cleanedNotes);
          }

          const amountChanged = monarchTx.amount !== settledAmount;

          await monarchApi.updateTransaction(monarchTxId, {
            notes: cleanedNotes,
            ownerUserId: (monarchTx.ownedByUser as Record<string, unknown>)?.id || null,
          });

          if (amountChanged) {
            await monarchApi.updateTransaction(monarchTxId, {
              amount: settledAmount,
              ownerUserId: (monarchTx.ownedByUser as Record<string, unknown>)?.id || null,
            });
          }

          await monarchApi.setTransactionTags(monarchTxId, []);
          result.settled += 1;
          continue;
        }

        debugLog(`[ws-reconciliation:phase2] ${wsTransactionId} unknown status "${statusInfo.rawStatus}", deleting`);
        await monarchApi.deleteTransaction(monarchTxId);
        result.cancelled += 1;
      } catch (txError) {
        debugLog(`[ws-reconciliation:phase2] Error reconciling ${monarchTx.id}:`, txError);
        result.failed += 1;
      }
    }

    debugLog('[ws-reconciliation:phase2] Completed', result);
    return result;
  } catch (error) {
    debugLog('[ws-reconciliation:phase2] Error:', error);
    return { ...result, success: false, error: (error as Error).message };
  }
}

/**
 * Convenience wrapper: Reconcile pending transactions for a Wealthsimple account.
 *
 * Combines Phase 1 (shared fetchMonarchPendingTransactions) and Phase 2
 * (WS-specific reconcileWealthsimpleFetchedPending) in a single call.
 * Kept for backward compatibility with existing callers.
 */
export async function reconcilePendingTransactions(
  monarchAccountId: string,
  wealthsimpleTransactions: Record<string, unknown>[],
  lookbackDays: number,
  accountType = 'CREDIT_CARD',
): Promise<ReconciliationResult> {
  const emptyResult: ReconciliationResult = { success: true, settled: 0, cancelled: 0, failed: 0, error: null };

  try {
    // Import shared Phase 1 (lazy to avoid circular deps)
    const { fetchMonarchPendingTransactions } = await import('../common/pendingReconciliation');

    const phase1 = await fetchMonarchPendingTransactions(monarchAccountId, lookbackDays);

    if (phase1.noPendingTag) {
      return { ...emptyResult, noPendingTag: true };
    }
    if (phase1.noPendingTransactions || phase1.monarchPendingTransactions.length === 0) {
      return { ...emptyResult, noPendingTransactions: true };
    }

    return await reconcileWealthsimpleFetchedPending(
      phase1.pendingTag!,
      phase1.monarchPendingTransactions,
      wealthsimpleTransactions,
      accountType,
    );
  } catch (error) {
    debugLog('Error during pending transaction reconciliation:', error);
    return { ...emptyResult, success: false, error: (error as Error).message };
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
