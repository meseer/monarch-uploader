/**
 * Wealthsimple Transactions - Reconciliation
 * Handles pending transaction reconciliation and status tracking
 */

import { debugLog } from '../../core/utils';
import monarchApi from '../../api/monarch';
import wealthsimpleApi from '../../api/wealthsimple';
import { INVESTMENT_TRANSACTION_RULES } from './transactionsInvestment';
import { CASH_TRANSACTION_RULES } from './transactionRules';
import type { WealthsimpleTransaction } from './transactionRulesHelpers';

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
 * and removes the "Expected dividends: ..." line (no longer needed once settled).
 */
function updateSettledDividendNotes(notes: string): string {
  let updated = notes.replace(/^Upcoming dividend on /m, 'Dividend on ');
  updated = updated.replace(/^Expected dividends: .+\n?/m, '');
  // Clean up any resulting double newlines
  updated = updated.replace(/\n{2,}/g, '\n');
  return updated.trim();
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

// ── Notes regeneration ────────────────────────────────────────────────────────

/**
 * Transaction types that are investment buy/sell orders needing enrichment data.
 */
const INVESTMENT_BUY_SELL_TYPES = new Set([
  'MANAGED_BUY', 'DIY_BUY', 'MANAGED_SELL', 'DIY_SELL',
  'OPTIONS_BUY', 'OPTIONS_SELL', 'OPTIONS_ASSIGN', 'OPTIONS_SHORT_EXPIRY',
  'CRYPTO_BUY', 'CRYPTO_SELL',
]);

/** Static security IDs that don't need API fetching (cash currencies) */
const STATIC_SECURITY_IDS = new Set(['sec-s-cad', 'sec-s-usd']);

/**
 * Fetch enrichment data for a single settled transaction.
 * Mirrors the enrichment logic from transactionsInvestment.ts but for a single tx.
 *
 * @returns Enrichment map with 0 or 1 entries keyed by the transaction's canonical ID
 */
async function fetchEnrichmentForTransaction(
  wsTx: Record<string, unknown>,
): Promise<Map<string, unknown>> {
  const enrichmentMap = new Map<string, unknown>();
  const txType = wsTx.type as string | undefined;
  const externalCanonicalId = wsTx.externalCanonicalId as string | undefined;
  const canonicalId = wsTx.canonicalId as string | undefined;

  if (!txType) return enrichmentMap;

  // Buy/sell orders need extended order data
  if (INVESTMENT_BUY_SELL_TYPES.has(txType) && externalCanonicalId) {
    const isOrdersService = externalCanonicalId.startsWith('order-');

    if ((txType === 'MANAGED_BUY' || txType === 'MANAGED_SELL') && isOrdersService) {
      const accountId = wsTx.accountId as string;
      const activityData = await wealthsimpleApi.fetchActivityByOrdersServiceOrderId(accountId, externalCanonicalId);
      if (activityData) {
        enrichmentMap.set(externalCanonicalId, { ...(activityData as object), isManagedOrderData: true });
      }
    } else if ((txType === 'CRYPTO_BUY' || txType === 'CRYPTO_SELL') && isOrdersService) {
      const cryptoOrder = await wealthsimpleApi.fetchCryptoOrder(externalCanonicalId);
      if (cryptoOrder) {
        enrichmentMap.set(externalCanonicalId, { ...(cryptoOrder as object), isCryptoOrderData: true });
      }
    } else if (txType === 'OPTIONS_SHORT_EXPIRY' || txType === 'OPTIONS_ASSIGN') {
      const expiryDetail = await wealthsimpleApi.fetchShortOptionPositionExpiryDetail(externalCanonicalId);
      if (expiryDetail) {
        const securityCache = new Map<string, unknown>();
        const deliverables = (expiryDetail as Record<string, unknown>).deliverables;
        if (deliverables && Array.isArray(deliverables)) {
          for (const deliverable of deliverables) {
            const secId = (deliverable as Record<string, unknown>).securityId as string | undefined;
            if (secId && !STATIC_SECURITY_IDS.has(secId)) {
              const security = await wealthsimpleApi.fetchSecurity(secId);
              if (security) {
                securityCache.set(secId, security);
              }
            }
          }
        }
        enrichmentMap.set(externalCanonicalId, { expiryDetail, securityCache });
      }
    } else {
      // DIY orders and other types — FetchSoOrdersExtendedOrder
      const extendedOrder = await wealthsimpleApi.fetchExtendedOrder(externalCanonicalId);
      if (extendedOrder) {
        enrichmentMap.set(externalCanonicalId, extendedOrder);
      }
    }
  }

  // Corporate actions need child activities
  if (txType === 'CORPORATE_ACTION' && canonicalId) {
    const childActivities = await wealthsimpleApi.fetchCorporateActionChildActivities(canonicalId);
    if (childActivities && childActivities.length > 0) {
      enrichmentMap.set(canonicalId, childActivities);
    }
  }

  return enrichmentMap;
}

/**
 * Regenerate notes for a settled transaction using the same rules engine
 * that was used at upload time. Fetches enrichment data if needed.
 *
 * @param wsTx - Settled Wealthsimple transaction
 * @returns Regenerated notes string, or null if no rule matched or notes are empty
 */
export async function regenerateSettledNotes(
  wsTx: Record<string, unknown>,
): Promise<string | null> {
  const tx = wsTx as unknown as WealthsimpleTransaction;

  // Try investment rules first (more specific), then cash rules
  const allRules = [...INVESTMENT_TRANSACTION_RULES, ...CASH_TRANSACTION_RULES];

  let matchedRule: (typeof allRules)[number] | null = null;
  for (const rule of allRules) {
    if (rule.match(tx)) {
      matchedRule = rule;
      break;
    }
  }

  if (!matchedRule) {
    debugLog(`[ws-reconciliation:notes] No rule matched for type=${tx.type} subType=${tx.subType}`);
    return null;
  }

  debugLog(`[ws-reconciliation:notes] Matched rule "${matchedRule.id}" for type=${tx.type}, fetching enrichment...`);

  // Fetch enrichment data (e.g., extended order details for buy/sell)
  let enrichmentMap: Map<string, unknown>;
  try {
    enrichmentMap = await fetchEnrichmentForTransaction(wsTx);
  } catch (error) {
    debugLog('[ws-reconciliation:notes] Failed to fetch enrichment, proceeding without it:', error);
    enrichmentMap = new Map();
  }

  const result = matchedRule.process(tx, enrichmentMap);
  const notes = result.notes || '';

  if (!notes) {
    debugLog(`[ws-reconciliation:notes] Rule "${matchedRule.id}" produced empty notes`);
    return null;
  }

  debugLog(`[ws-reconciliation:notes] Regenerated notes via rule "${matchedRule.id}": "${notes.substring(0, 80)}..."`);
  return notes;
}

// ── Reconciliation ────────────────────────────────────────────────────────────

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

          // Regenerate notes using the rules engine with settled transaction data.
          // This updates fill prices/quantities that were 0 when the order was pending.
          // Only replaces when the regenerated notes actually differ from existing ones.
          try {
            const regeneratedNotes = await regenerateSettledNotes(wsTx);
            if (regeneratedNotes !== null && !cleanedNotes.includes(regeneratedNotes)) {
              debugLog(`[ws-reconciliation] Updating notes for ${wsTransactionId}: old="${cleanedNotes.substring(0, 60)}" new="${regeneratedNotes.substring(0, 60)}"`);
              cleanedNotes = regeneratedNotes;
            }
          } catch (notesError) {
            debugLog(`[ws-reconciliation] Failed to regenerate notes for ${wsTransactionId}, keeping cleaned notes:`, notesError);
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