/**
 * MBNA Sync Hooks
 *
 * Implementation of the SyncHooks interface for the MBNA integration.
 * These hooks provide the institution-specific logic that the generic
 * syncOrchestrator calls during the sync workflow.
 *
 * @module integrations/mbna/sinks/monarch/syncHooks
 */

import { debugLog, formatDate } from '../../../../core/utils';
import { processMbnaTransactions, resolveMbnaCategories, type ProcessedMbnaTransaction } from './transactions';
import { buildBalanceHistory, type MbnaRawTransaction, type MbnaStatementData } from '../../source/balanceReconstruction';
import { formatBalanceHistoryForMonarch, type MonarchBalanceEntry } from './balanceFormatter';
import type { SyncHooks, SyncCallbacks } from '../../../types';
import type { MbnaApiClient, MbnaTransactionResult } from '../../source/api';

// ── Interfaces ──────────────────────────────────────────────

/** Metadata returned alongside fetched transactions */
interface FetchMetadata {
  statements: MbnaStatementData[];
  currentCycle: MbnaTransactionResult['currentCycle'];
}

/** Result of fetchTransactions hook */
interface FetchTransactionsResult {
  settled: MbnaRawTransaction[];
  pending: MbnaRawTransaction[];
  metadata: FetchMetadata;
}

/** Parameters for buildBalanceHistory hook */
interface BuildBalanceHistoryParams {
  currentBalance: number;
  metadata: Record<string, unknown>;
  fromDate: string;
  invertBalance: boolean;
}

/** Account data passed to buildAccountEntry */
interface MbnaAccountData {
  accountId?: string;
  endingIn?: string;
  cardName?: string;
  displayName?: string;
  [key: string]: unknown;
}

// ── Hook Implementations ────────────────────────────────────

/**
 * Fetch raw transactions from the MBNA API.
 *
 * Aggregates transactions from the current cycle and past statements,
 * returns them as separate settled and pending arrays along with
 * metadata needed for balance reconstruction.
 */
async function fetchTransactions(
  api: MbnaApiClient,
  accountId: string,
  fromDate: string,
  { onProgress }: SyncCallbacks,
): Promise<FetchTransactionsResult> {
  onProgress('Fetching current cycle...');

  const txResult = await api.getTransactions(accountId, fromDate, {
    onProgress: (current: number, total: number) => {
      onProgress(`Loading statement ${current}/${total}...`);
    },
  });

  const { allSettled, allPending, statements, currentCycle } = txResult;

  debugLog(`[MBNA hooks] Fetched ${allSettled.length} settled, ${allPending.length} pending transactions`);

  // Map statement summaries to MbnaStatementData shape for balance reconstruction
  const statementData: MbnaStatementData[] = statements.map((s) => ({
    closingDate: s.closingDate,
    statementBalance: s.statementBalance,
    transactions: s.transactions,
  }));

  return {
    settled: allSettled,
    pending: allPending,
    metadata: { statements: statementData, currentCycle },
  };
}

/**
 * Process raw MBNA transactions into normalized shape.
 *
 * Delegates to the existing processMbnaTransactions function which handles:
 * - Merchant sanitization via applyMerchantMapping
 * - Amount sign inversion (MBNA positive charges → negative for Monarch)
 * - Auto-categorization (e.g., PAYMENT → Credit Card Payment)
 * - Pending ID attachment from generatedId
 */
function processTransactions(
  settled: MbnaRawTransaction[],
  pending: Array<MbnaRawTransaction & { generatedId?: string }>,
  options: { includePending: boolean },
): { settled: ProcessedMbnaTransaction[]; pending: ProcessedMbnaTransaction[] } {
  const result = processMbnaTransactions(settled, pending, options);
  return {
    settled: result.settled,
    pending: result.pending,
  };
}

/**
 * Extract dedup reference ID from a settled MBNA transaction.
 */
function getSettledRefId(tx: Record<string, unknown>): string {
  return (tx.referenceNumber as string) || '';
}

/**
 * Extract dedup reference ID from a pending MBNA transaction.
 */
function getPendingRefId(tx: Record<string, unknown>): string {
  return (tx.pendingId as string) || '';
}

/**
 * Resolve Monarch categories for MBNA transactions.
 *
 * Delegates to the existing resolveMbnaCategories function which handles:
 * - Auto-categorized transactions keep their category
 * - Stored category mappings (merchant → Monarch category)
 * - High-confidence similarity auto-matching
 * - Manual prompt for unresolved merchants
 * - skipCategorization per-account setting
 */
async function resolveCategories(
  transactions: ProcessedMbnaTransaction[],
  accountId: string,
): Promise<ProcessedMbnaTransaction[]> {
  return resolveMbnaCategories(transactions, accountId);
}

/**
 * Build notes string for an MBNA transaction CSV row.
 *
 * For settled transactions: includes referenceNumber if storeTransactionDetailsInNotes is enabled.
 * For pending transactions: always includes the generated pendingId for reconciliation.
 */
function buildTransactionNotes(
  tx: Record<string, unknown>,
  { storeTransactionDetailsInNotes = false }: { storeTransactionDetailsInNotes: boolean } = { storeTransactionDetailsInNotes: false },
): string {
  const notesParts: string[] = [];

  // Include reference number if setting is enabled (for settled transactions)
  if (storeTransactionDetailsInNotes && !tx.isPending && tx.referenceNumber) {
    notesParts.push(tx.referenceNumber as string);
  }

  // For pending transactions, always include the generated hash ID for reconciliation
  if (tx.isPending && tx.pendingId) {
    notesParts.push(tx.pendingId as string);
  }

  return notesParts.join('\n');
}

/**
 * Get stable field values for pending transaction ID hashing.
 *
 * Fields used:
 * - transactionDate: Transaction date (YYYY-MM-DD)
 * - description: Sanitized merchant name (asterisk suffix stripped)
 * - amount: Transaction amount
 * - endingIn: Card last 4 digits
 */
function getPendingIdFields(tx: Record<string, unknown>): string[] {
  // Strip asterisk suffix from description for consistent hashing
  // "Amazon.ca*RA6HH70U3 TORONTO ON" → "Amazon.ca"
  let sanitizedDescription = ((tx.description as string) || '').trim();
  const asteriskIndex = sanitizedDescription.indexOf('*');
  if (asteriskIndex > 0) {
    sanitizedDescription = sanitizedDescription.substring(0, asteriskIndex).trim();
  }

  return [
    (tx.transactionDate as string) || '',
    sanitizedDescription,
    tx.amount !== undefined && tx.amount !== null ? String(tx.amount) : '',
    (tx.endingIn as string) || '',
  ];
}

/**
 * Get the Monarch-normalized settled amount for a raw MBNA transaction.
 *
 * MBNA amounts: positive = charge, negative = payment
 * Monarch expects: negative = charge, positive = payment
 * So we negate.
 */
function getSettledAmount(settledTx: Record<string, unknown>): number {
  const rawAmount = parseFloat(String(settledTx.amount)) || 0;
  return -rawAmount;
}

/**
 * Build balance history for first-sync reconstruction.
 *
 * Uses the MBNA balance reconstruction module to compute daily balances
 * from statement data, then formats for Monarch (negates by default
 * for credit card liability convention; skips negation if invertBalance is on).
 */
function buildBalanceHistoryHook({ currentBalance, metadata, fromDate, invertBalance }: BuildBalanceHistoryParams): MonarchBalanceEntry[] | null {
  const typedMetadata = metadata as unknown as FetchMetadata;
  const rawHistory = buildBalanceHistory({
    currentBalance,
    statements: typedMetadata.statements,
    currentCycleSettled: typedMetadata.currentCycle?.settled || [],
    startDate: fromDate,
  });

  if (!rawHistory || rawHistory.length === 0) return null;

  // formatBalanceHistoryForMonarch negates by default; if invertBalance is on, skip that negation
  return invertBalance
    ? rawHistory.map((e) => ({ date: e.date, amount: e.balance }))
    : formatBalanceHistoryForMonarch(rawHistory);
}

/**
 * Suggest a start date for first sync based on MBNA statement closing dates.
 *
 * Fetches available closing dates and returns 30 days before the oldest one,
 * giving users a reasonable default that covers their full statement history.
 */
async function suggestStartDate(
  api: MbnaApiClient,
  accountId: string,
): Promise<{ date: string; description: string } | null> {
  try {
    const closingDates = await api.getClosingDates(accountId);
    if (closingDates.length > 0) {
      const oldest = closingDates[closingDates.length - 1]; // sorted newest-first
      const d = new Date(`${oldest}T00:00:00`);
      d.setDate(d.getDate() - 30);
      const suggestedDate = formatDate(d);
      debugLog(`[MBNA hooks] Suggested start date: ${suggestedDate} (30 days before oldest closing date ${oldest})`);
      return { date: suggestedDate, description: '30 days before oldest statement' };
    }
  } catch (error) {
    debugLog('[MBNA hooks] Could not fetch closing dates for start date suggestion:', (error as Error).message);
  }
  return null;
}

/**
 * Build the institution-specific portion of the account storage entry.
 *
 * Returns the fields stored under the manifest's `accountKeyName` ('mbnaAccount')
 * in the consolidated accounts list.
 */
function buildAccountEntry(account: Record<string, unknown>): Record<string, unknown> {
  const acct = account as unknown as MbnaAccountData;
  return {
    id: acct.accountId,
    endingIn: acct.endingIn,
    cardName: acct.cardName,
    nickname: acct.displayName || `MBNA Card (${acct.endingIn})`,
  };
}

/** MBNA sync hooks implementation */
const mbnaSyncHooks: SyncHooks = {
  // Required hooks
  fetchTransactions: fetchTransactions as unknown as SyncHooks['fetchTransactions'],
  processTransactions: processTransactions as unknown as SyncHooks['processTransactions'],
  getSettledRefId,
  getPendingRefId,
  resolveCategories: resolveCategories as unknown as SyncHooks['resolveCategories'],
  buildTransactionNotes,

  // Optional hooks
  getPendingIdFields,
  getSettledAmount,
  buildBalanceHistory: buildBalanceHistoryHook as SyncHooks['buildBalanceHistory'],
  suggestStartDate: suggestStartDate as unknown as SyncHooks['suggestStartDate'],
  buildAccountEntry,
};

export default mbnaSyncHooks;