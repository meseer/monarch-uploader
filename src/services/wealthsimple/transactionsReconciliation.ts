/**
 * Wealthsimple Transactions - Reconciliation
 * Handles pending transaction reconciliation and status tracking
 */

import { debugLog } from '../../core/utils';
import monarchApi from '../../api/monarch';
import wealthsimpleApi from '../../api/wealthsimple';
import { INVESTMENT_TRANSACTION_RULES } from './transactionsInvestment';
import { CASH_TRANSACTION_RULES, formatSpendNotes, getForeignCurrencyCode } from './transactionRules';
import { convertToLocalDate, processCreditCardTransaction } from './transactionsHelpers';
import { resolveWsTransactionByPendingId } from './transactionIdMatching';
import { cleanSystemNotesFromNotes, updateSettledDividendNotes, mergeSettledNotes } from './settledNotes';
import { computeSettledTagIds } from '../common/pendingReconciliation';
import type { WealthsimpleTransaction, ExtendedOrder, SpendDetails } from './transactionRulesHelpers';

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
 * Fetch spend/card-activity enrichment for a card transaction.
 *
 * Two distinct sources depending on the account type:
 * - CREDIT_CARD purchases → `FetchCreditCardActivity` (`FetchSpendTransactions`
 *   returns 403 for credit card accounts, and this is the only source of the
 *   precise `originalAmount`)
 * - CASH SPEND/PREPAID → `FetchSpendTransactions`
 *
 * Both are stored under the `spend:{id}` key so the rules engine and the note
 * formatter can consume either source interchangeably.
 *
 * @param wsTx - Settled Wealthsimple transaction
 * @param accountType - WS account type
 * @param enrichmentMap - Map to populate
 */
async function addCardEnrichment(
  wsTx: Record<string, unknown>,
  accountType: string,
  enrichmentMap: Map<string, unknown>,
): Promise<void> {
  const externalCanonicalId = wsTx.externalCanonicalId as string | undefined;
  if (!externalCanonicalId) return;

  if (accountType === 'CREDIT_CARD' && wsTx.subType === 'PURCHASE') {
    const activity = await wealthsimpleApi.fetchCreditCardActivity(externalCanonicalId);
    if (activity) {
      enrichmentMap.set(`spend:${externalCanonicalId}`, activity);
    }
    return;
  }

  if (wsTx.type === 'SPEND') {
    const accountId = wsTx.accountId as string | undefined;
    if (!accountId) return;
    const spendMap = await wealthsimpleApi.fetchSpendTransactions(accountId, [externalCanonicalId]);
    const details = spendMap.get(externalCanonicalId);
    if (details) {
      enrichmentMap.set(`spend:${externalCanonicalId}`, details);
    }
  }
}

/**
 * Fetch enrichment data for a single settled transaction.
 * Mirrors the enrichment logic from transactionsInvestment.ts but for a single tx.
 *
 * @param wsTx - Settled Wealthsimple transaction
 * @param accountType - WS account type (selects the card-activity API to use)
 * @returns Enrichment map keyed by the transaction's canonical ID (or `spend:{id}`)
 */
async function fetchEnrichmentForTransaction(
  wsTx: Record<string, unknown>,
  accountType: string = 'CREDIT_CARD',
): Promise<Map<string, unknown>> {
  const enrichmentMap = new Map<string, unknown>();
  const txType = wsTx.type as string | undefined;
  const externalCanonicalId = wsTx.externalCanonicalId as string | undefined;
  const canonicalId = wsTx.canonicalId as string | undefined;

  if (!txType) return enrichmentMap;

  // Card spend transactions need FX/reward details
  await addCardEnrichment(wsTx, accountType, enrichmentMap);

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
 * @param prefetchedEnrichment - Optional pre-fetched enrichment map to avoid duplicate API calls.
 *   When provided, the function skips the enrichment fetch and uses this map directly.
 * @returns Regenerated notes string, or null if no rule matched or notes are empty
 */
export async function regenerateSettledNotes(
  wsTx: Record<string, unknown>,
  prefetchedEnrichment?: Map<string, unknown>,
): Promise<string | null> {
  const ruleResult = await applySettledTransactionRules(wsTx, prefetchedEnrichment);

  if (!ruleResult) {
    return null;
  }

  const notes = ruleResult.notes || '';

  if (!notes) {
    debugLog(`[ws-reconciliation:notes] Rule "${ruleResult.ruleId}" produced empty notes`);
    return null;
  }

  debugLog(`[ws-reconciliation:notes] Regenerated notes via rule "${ruleResult.ruleId}": "${notes.substring(0, 80)}..."`);
  return notes;
}

/** Result of running the rules engine against a settled transaction */
interface SettledRuleResult {
  ruleId: string;
  merchant?: string;
  notes?: string;
}

/**
 * Run the transaction rules engine against a settled transaction.
 *
 * Shared by notes regeneration and merchant-name refresh so the rules
 * engine is only matched once per settled transaction.
 *
 * @param wsTx - Settled Wealthsimple transaction
 * @param prefetchedEnrichment - Optional pre-fetched enrichment map
 * @returns Rule result (id, merchant, notes) or null when no rule matched
 */
async function applySettledTransactionRules(
  wsTx: Record<string, unknown>,
  prefetchedEnrichment?: Map<string, unknown>,
): Promise<SettledRuleResult | null> {
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

  // Fetch enrichment data (e.g., extended order details for buy/sell) unless caller pre-fetched
  let enrichmentMap: Map<string, unknown>;
  if (prefetchedEnrichment) {
    enrichmentMap = prefetchedEnrichment;
    debugLog(`[ws-reconciliation:notes] Matched rule "${matchedRule.id}" for type=${tx.type}, using prefetched enrichment`);
  } else {
    debugLog(`[ws-reconciliation:notes] Matched rule "${matchedRule.id}" for type=${tx.type}, fetching enrichment...`);
    try {
      enrichmentMap = await fetchEnrichmentForTransaction(wsTx);
    } catch (error) {
      debugLog('[ws-reconciliation:notes] Failed to fetch enrichment, proceeding without it:', error);
      enrichmentMap = new Map();
    }
  }

  const result = matchedRule.process(tx, enrichmentMap);

  return {
    ruleId: matchedRule.id,
    merchant: result.merchant,
    notes: result.notes,
  };
}

/**
 * Resolve the merchant name for a settled transaction.
 *
 * Wealthsimple frequently changes `spendMerchant` between the authorization
 * and settlement records (e.g. a generic acquirer descriptor becomes the real
 * merchant name), so the Monarch merchant name is refreshed on settle.
 *
 * Deliberately narrow: only card spend activity (the transactions whose
 * `spendMerchant` actually changes at settlement) is considered. Transactions
 * without a `spendMerchant` derive their merchant deterministically from
 * type/subType, which do not change, so refreshing them would only risk
 * overwriting a good name with a placeholder.
 *
 * Credit card purchases have no rules-engine entry — they are processed by
 * `processCreditCardTransaction`, so that path is used for CREDIT_CARD accounts.
 *
 * @param wsTx - Settled Wealthsimple transaction
 * @param accountType - WS account type
 * @param ruleResult - Rules-engine result (null when no rule matched)
 * @param stripStoreNumbers - Account setting for merchant name cleanup
 * @returns Merchant name, or null when it should not be refreshed
 */
function resolveSettledMerchantName(
  wsTx: Record<string, unknown>,
  accountType: string,
  ruleResult: SettledRuleResult | null,
  stripStoreNumbers: boolean,
): string | null {
  const spendMerchant = wsTx.spendMerchant;
  if (typeof spendMerchant !== 'string' || spendMerchant.trim() === '') {
    return null;
  }

  if (ruleResult?.merchant) {
    return ruleResult.merchant;
  }

  if (accountType === 'CREDIT_CARD') {
    const processed = processCreditCardTransaction(
      wsTx as unknown as WealthsimpleTransaction,
      { stripStoreNumbers },
    );
    return processed.merchant || null;
  }

  return null;
}

/**
 * Resolve settled notes and currency tag for a card spend transaction.
 *
 * Credit card purchases have no rules-engine entry (they are processed by
 * `processCreditCardTransaction`), so their FX/reward notes must be built
 * directly from the card-activity enrichment here.
 *
 * @param wsTx - Settled Wealthsimple transaction
 * @param enrichmentMap - Enrichment map containing `spend:{id}` details
 * @returns Notes string and currency code (either may be empty/null)
 */
function resolveSettledCardDetails(
  wsTx: Record<string, unknown>,
  enrichmentMap: Map<string, unknown>,
): { notes: string; foreignCurrency: string | null } {
  const externalCanonicalId = wsTx.externalCanonicalId as string | undefined;
  const details = externalCanonicalId
    ? (enrichmentMap.get(`spend:${externalCanonicalId}`) as SpendDetails | undefined)
    : undefined;

  if (!details) {
    return { notes: '', foreignCurrency: null };
  }

  return {
    notes: formatSpendNotes(details),
    foreignCurrency: getForeignCurrencyCode(details),
  };
}

/**
 * Apply the settled tag set: remove "Pending", keep every user-applied tag, and
 * add the ISO currency code when the transaction turns out to be foreign.
 *
 * The "Pending" tag must always be removed once a transaction settles. When the
 * transaction is foreign, the ISO currency code is added so the transaction
 * remains filterable in Monarch — matching what the CSV import does for
 * transactions that were already settled on first upload.
 *
 * Tags the user applied while the transaction was pending are preserved:
 * `setTransactionTags` replaces the whole tag list, so the full desired set is
 * computed by `computeSettledTagIds` rather than sent as a bare array.
 *
 * A tag that does not yet exist in the household cannot be created through this
 * mutation, so in that case only "Pending" is removed and the gap is logged.
 *
 * @param monarchTxId - Monarch transaction ID
 * @param existingTags - Tags currently on the Monarch transaction
 * @param pendingTagId - ID of the Monarch "Pending" tag
 * @param foreignCurrency - ISO currency code, or null for domestic transactions
 */
async function applySettledTags({
  monarchTxId,
  existingTags,
  pendingTagId,
  foreignCurrency,
}: {
  monarchTxId: string;
  existingTags: Array<{ id: string }> | undefined;
  pendingTagId: string;
  foreignCurrency: string | null;
}): Promise<void> {
  let currencyTagId: string | null = null;

  if (foreignCurrency) {
    const currencyTag = await monarchApi.getTagByName(foreignCurrency);

    if (currencyTag) {
      debugLog(`[ws-reconciliation] Applying currency tag "${foreignCurrency}" to ${monarchTxId}`);
      currencyTagId = currencyTag.id;
    } else {
      debugLog(`[ws-reconciliation] Monarch tag "${foreignCurrency}" does not exist — removing "Pending" only`);
    }
  }

  const tagIds = computeSettledTagIds(existingTags, pendingTagId, currencyTagId);
  await monarchApi.setTransactionTags(monarchTxId, tagIds);
}

/**
 * Transaction types whose settlement date comes from `extendedOrder.filledAt` (DIY/options orders).
 */
const FILLED_AT_DATE_TYPES = new Set([
  'DIY_BUY', 'DIY_SELL',
  'OPTIONS_BUY', 'OPTIONS_SELL', 'OPTIONS_ASSIGN', 'OPTIONS_SHORT_EXPIRY',
]);

/**
 * Compute the settlement date for a settled Wealthsimple transaction.
 *
 * Priority:
 * 1. DIVIDEND → `payableDate` (matches upload-time logic in transactionsInvestment.ts)
 * 2. DIY/Options orders → `extendedOrder.filledAt` from enrichment (if available)
 * 3. Fallback → `occurredAt` (managed orders, crypto orders, transfers, deposits, etc.)
 *
 * @param wsTx - Settled Wealthsimple transaction
 * @param enrichmentMap - Enrichment map keyed by externalCanonicalId
 * @returns Settlement date in YYYY-MM-DD format, or null if no date can be derived
 */
export function getSettlementDate(
  wsTx: Record<string, unknown>,
  enrichmentMap: Map<string, unknown>,
): string | null {
  const type = wsTx.type as string | undefined;

  // Dividends: use payableDate (matches upload-time behavior)
  if (type === 'DIVIDEND') {
    const payableDate = wsTx.payableDate as string | undefined;
    if (payableDate) {
      return payableDate;
    }
  }

  // DIY/Options orders: use extendedOrder.filledAt when available
  if (type && FILLED_AT_DATE_TYPES.has(type)) {
    const externalId = wsTx.externalCanonicalId as string | undefined;
    if (externalId) {
      const enrichment = enrichmentMap.get(externalId) as ExtendedOrder | undefined;
      const filledAt = enrichment?.filledAt as string | undefined;
      if (filledAt) {
        return convertToLocalDate(filledAt) || null;
      }
    }
  }

  // Fallback: occurredAt (managed orders, crypto, transfers, deposits, withdrawals, etc.)
  const occurredAt = wsTx.occurredAt as string | undefined;
  if (occurredAt) {
    return convertToLocalDate(occurredAt) || null;
  }

  return null;
}

// ── Reconciliation ────────────────────────────────────────────────────────────

export interface ReconciliationResult {
  success: boolean;
  settled: number;
  cancelled: number;
  failed: number;
  error: string | null;
  /**
   * Current (settled) Wealthsimple transaction IDs for every reconciled transaction.
   * The caller persists these to the dedup store so the settled version is not
   * re-uploaded as a new transaction. Mirrors the common reconciliation contract.
   */
  settledRefIds: string[];
  noPendingTag?: boolean;
  noPendingTransactions?: boolean;
}

/** Options for reconcileWealthsimpleFetchedPending */
export interface WealthsimpleReconcileOptions {
  /** Account setting controlling merchant name cleanup (default: true) */
  stripStoreNumbers?: boolean;
}

/** Build an empty reconciliation result */
function emptyReconciliationResult(): ReconciliationResult {
  return { success: true, settled: 0, cancelled: 0, failed: 0, error: null, settledRefIds: [] };
}

/**
 * Update a Monarch pending transaction to reflect its settled Wealthsimple counterpart.
 *
 * Applies (in this order): notes + date, merchant name, amount, then tag removal.
 * Amount/date/merchant are only sent when they actually changed to keep the
 * number of Monarch mutations minimal.
 *
 * @param params - Settle parameters
 * @returns void
 */
async function settleMonarchTransaction({
  monarchTx,
  wsTx,
  wsTransactionId,
  accountType,
  stripStoreNumbers,
  pendingTagId,
}: {
  monarchTx: Record<string, unknown>;
  wsTx: Record<string, unknown>;
  wsTransactionId: string;
  accountType: string;
  stripStoreNumbers: boolean;
  pendingTagId: string;
}): Promise<void> {
  const monarchTxId = monarchTx.id as string;
  const notes = (monarchTx.notes as string) || '';
  const ownerUserId = (monarchTx.ownedByUser as Record<string, unknown>)?.id || null;

  const isNegative = wsTx.amountSign === 'negative';
  const settledAmount = isNegative ? -Math.abs(wsTx.amount as number) : Math.abs(wsTx.amount as number);

  let cleanedNotes = cleanSystemNotesFromNotes(notes);
  if (wsTx.type === 'DIVIDEND') {
    cleanedNotes = updateSettledDividendNotes(cleanedNotes);
  }

  // Fetch enrichment data once and share it between rules processing
  // and settlement date computation to avoid duplicate API calls.
  let enrichmentMap: Map<string, unknown> = new Map();
  try {
    enrichmentMap = await fetchEnrichmentForTransaction(wsTx, accountType);
  } catch (enrichError) {
    debugLog(`[ws-reconciliation] Failed to fetch enrichment for ${wsTransactionId}:`, enrichError);
  }

  // Run the rules engine once for both notes and merchant name.
  // Fill prices/quantities that were 0 while pending become available on settle.
  let ruleResult: SettledRuleResult | null = null;
  try {
    ruleResult = await applySettledTransactionRules(wsTx, enrichmentMap);
  } catch (ruleError) {
    debugLog(`[ws-reconciliation] Failed to apply rules for ${wsTransactionId}:`, ruleError);
  }

  // Credit card purchases have no rules-engine entry, so their FX/reward notes
  // come straight from the card-activity enrichment.
  const cardDetails = resolveSettledCardDetails(wsTx, enrichmentMap);

  // Merge (never overwrite): the Notes field may contain a memo the user typed
  // while the transaction was pending, and that must survive settlement.
  const regeneratedNotes = ruleResult?.notes || cardDetails.notes || null;
  if (regeneratedNotes) {
    const mergedNotes = mergeSettledNotes({
      existingNotes: cleanedNotes,
      settledNotes: regeneratedNotes,
    });

    if (mergedNotes !== cleanedNotes) {
      debugLog(`[ws-reconciliation] Updating notes for ${wsTransactionId}: old="${cleanedNotes.substring(0, 60)}" new="${mergedNotes.substring(0, 60)}"`);
      cleanedNotes = mergedNotes;
    }
  }

  // Compute settlement date — may differ from submission date for limit orders, options, etc.
  const settledDate = getSettlementDate(wsTx, enrichmentMap);
  const currentDate = monarchTx.date as string | undefined;
  const dateChanged = settledDate !== null && settledDate !== currentDate;

  const notesUpdatePayload: Record<string, unknown> = {
    notes: cleanedNotes,
    ownerUserId,
  };
  if (dateChanged) {
    notesUpdatePayload.date = settledDate;
    debugLog(`[ws-reconciliation] Updating date for ${wsTransactionId}: ${currentDate} → ${settledDate}`);
  }

  await monarchApi.updateTransaction(monarchTxId, notesUpdatePayload);

  // Wealthsimple often replaces a generic authorization descriptor with the real
  // merchant name once the transaction settles, so refresh it in Monarch.
  const settledMerchant = resolveSettledMerchantName(wsTx, accountType, ruleResult, stripStoreNumbers);
  const currentMerchant = (monarchTx.merchant as Record<string, unknown> | undefined)?.name as string | undefined;
  if (settledMerchant && settledMerchant !== currentMerchant) {
    debugLog(`[ws-reconciliation] Updating merchant for ${wsTransactionId}: "${currentMerchant}" → "${settledMerchant}"`);
    await monarchApi.updateTransaction(monarchTxId, {
      name: settledMerchant,
      ownerUserId,
    });
  }

  if (monarchTx.amount !== settledAmount) {
    await monarchApi.updateTransaction(monarchTxId, {
      amount: settledAmount,
      ownerUserId,
    });
  }

  // Removes the "Pending" tag, keeps user-applied tags, and adds the currency
  // tag when the settled transaction turns out to be foreign
  await applySettledTags({
    monarchTxId,
    existingTags: monarchTx.tags as Array<{ id: string }> | undefined,
    pendingTagId,
    foreignCurrency: cardDetails.foreignCurrency,
  });
}

/**
 * Phase 2: Reconcile pre-fetched Monarch pending transactions against Wealthsimple data.
 *
 * Uses externalCanonicalId-based matching (not hash-based like the common service).
 * Because Wealthsimple appends a suffix segment to the ID when card activity
 * settles, lookups fall back to a conservative pending → settled variant match
 * (see `transactionIdMatching`).
 *
 * @param pendingTag - Monarch "Pending" tag object
 * @param monarchPendingTransactions - Pre-fetched Monarch transactions with Pending tag
 * @param wealthsimpleTransactions - Current WS transactions (with extended date range)
 * @param accountType - WS account type for status determination
 * @param options - Reconciliation options (merchant cleanup settings)
 * @returns Reconciliation result including settledRefIds
 */
export async function reconcileWealthsimpleFetchedPending(
  pendingTag: { id: string; name: string },
  monarchPendingTransactions: Array<Record<string, unknown>>,
  wealthsimpleTransactions: Record<string, unknown>[],
  accountType = 'CREDIT_CARD',
  options: WealthsimpleReconcileOptions = {},
): Promise<ReconciliationResult> {
  const result = emptyReconciliationResult();
  const stripStoreNumbers = options.stripStoreNumbers !== false;

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

        const pendingId = extractTransactionIdFromNotes(notes);

        if (!pendingId) {
          debugLog(`[ws-reconciliation:phase2] Could not extract WS ID from notes: "${notes}", skipping`);
          continue;
        }

        // Resolve exactly, or via the pending → settled ID suffix variant
        const match = resolveWsTransactionByPendingId(wsTransactionMap, pendingId);

        if (!match) {
          debugLog(`[ws-reconciliation:phase2] ${pendingId} not found in WS, deleting`);
          await monarchApi.deleteTransaction(monarchTxId);
          result.cancelled += 1;
          continue;
        }

        const { transactionId: wsTransactionId, transaction: wsTx } = match;
        const statusInfo = getTransactionStatusForReconciliation(wsTx, accountType);

        if (statusInfo.isPending) {
          debugLog(`[ws-reconciliation:phase2] ${wsTransactionId} still pending, no action`);
          continue;
        }

        if (statusInfo.isSettled) {
          debugLog(`[ws-reconciliation:phase2] ${wsTransactionId} settled, updating`);

          await settleMonarchTransaction({
            monarchTx,
            wsTx,
            wsTransactionId,
            accountType,
            stripStoreNumbers,
            pendingTagId: pendingTag.id,
          });

          // Record the CURRENT (settled) ID so the caller can persist it to the
          // dedup store — otherwise the settled version is uploaded as a duplicate.
          result.settledRefIds.push(wsTransactionId);
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
  options: WealthsimpleReconcileOptions = {},
): Promise<ReconciliationResult> {
  const emptyResult = emptyReconciliationResult();

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
      options,
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