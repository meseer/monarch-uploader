/**
 * Wealthsimple Transaction Service
 * Handles transaction fetching, filtering, and processing for different account types
 *
 * This is the main entry point that re-exports all transaction functions.
 * Processing is split across files:
 * - transactionsHelpers.ts: Shared utility functions
 * - transactionsInvestment.ts: Investment account processing
 * - transactionsReconciliation.ts: Pending transaction reconciliation
 * - transactions.ts (this file): Credit card, cash, LOC processing + routing
 */

import { debugLog } from '../../core/utils';
import wealthsimpleApi from '../../api/wealthsimple';
import { showManualTransactionCategorization } from '../../ui/components/categorySelector';
import toast from '../../ui/toast';
import {
  applyTransactionRule,
  CASH_TRANSACTION_RULES,
  formatOriginalStatement,
  getTransactionId,
} from './transactionRules';
import { type WealthsimpleTransaction } from './transactionRulesHelpers';

// Import from sub-modules (used locally and re-exported)
import {
  collectEftTransferIds,
  convertToLocalDate,
  processCreditCardTransaction,
  filterSyncableTransactions,
  getAutoMappingForSubType,
  resolveCategoriesForTransactions,
  type ProcessedTransaction,
} from './transactionsHelpers';

import { fetchAndProcessInvestmentTransactions } from './transactionsInvestment';

import {
  formatTransactionIdForNotes,
  reconcilePendingTransactions,
  formatReconciliationMessage,
} from './transactionsReconciliation';

// Re-export helpers for consumers
export {
  collectEftTransferIds,
  convertToLocalDate,
  processCreditCardTransaction,
  filterSyncableTransactions,
  getAutoMappingForSubType,
  resolveCategoriesForTransactions,
};

// Re-export investment processing
export { fetchAndProcessInvestmentTransactions };

// Re-export reconciliation
export { formatTransactionIdForNotes, reconcilePendingTransactions, formatReconciliationMessage };

import type { ConsolidatedAccountBase } from '../../types/wealthsimple';

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Alias for the shared ConsolidatedAccountBase type from src/types/wealthsimple.ts.
 * Eliminates the former local duplicate of ConsolidatedAccount and WealthsimpleAccountData.
 */
type ConsolidatedAccount = ConsolidatedAccountBase;

interface FetchOptions {
  rawTransactions?: WealthsimpleTransaction[];
  uploadedTransactionIds?: Set<string>;
  onProgress?: (message: string) => void;
  skipCategorization?: boolean;
}

interface ManualCategorizationResult {
  merchant: string;
  category: { name: string };
}

interface LocRuleResult {
  merchant: string;
  originalStatement: string;
  category: string;
  ruleId: string;
}

// ── Helper functions ─────────────────────────────────────────────────────────

/**
 * Collect PURCHASE transaction IDs from credit card transactions that need spend details enrichment
 */
function collectCreditCardPurchaseIds(transactions: WealthsimpleTransaction[]): string[] {
  const purchaseIds: string[] = [];
  for (const tx of transactions) {
    if (tx.subType === 'PURCHASE' && tx.externalCanonicalId) {
      purchaseIds.push(tx.externalCanonicalId);
    }
  }
  return purchaseIds;
}

/**
 * Check if a transaction is a SPEND/PREPAID type (uses status field like credit cards)
 */
function isSpendPrepaidTransaction(transaction: WealthsimpleTransaction): boolean {
  return transaction.type === 'SPEND' && transaction.subType === 'PREPAID';
}

/**
 * Check if a transaction is an ATM fee reimbursement
 * These transactions may have null status fields but should always be synced
 */
function isAtmReimbursementTransaction(transaction: WealthsimpleTransaction): boolean {
  return transaction.type === 'REIMBURSEMENT' && transaction.subType === 'ATM';
}

/**
 * Filter CASH account transactions based on status
 * Different transaction types use different status fields:
 *
 * Regular CASH transactions (e-transfers, etc.):
 * - Use unifiedStatus field
 * - COMPLETED: Sync as normal
 * - IN_PROGRESS / PENDING: Sync with "Pending" tag
 * - Other: Exclude
 *
 * SPEND/PREPAID transactions (debit card purchases):
 * - Use status field (like credit cards)
 * - 'settled': Sync as normal
 * - 'authorized': Sync with "Pending" tag
 * - Other: Exclude (rejected/cancelled)
 *
 * ATM fee reimbursements (REIMBURSEMENT/ATM):
 * - Always sync regardless of status (status may be null)
 */
function filterCashSyncableTransactions(
  transactions: WealthsimpleTransaction[],
  includePending = true,
): WealthsimpleTransaction[] {
  return transactions.filter((transaction) => {
    // ATM reimbursements always sync (status may be null)
    if (isAtmReimbursementTransaction(transaction)) {
      return true;
    }

    // SPEND/PREPAID uses 'status' field (like credit cards)
    if (isSpendPrepaidTransaction(transaction)) {
      const status = transaction.status;
      if (status === 'settled') return true;
      if (includePending && status === 'authorized') return true;
      return false;
    }

    // Regular CASH transactions use 'unifiedStatus' field
    const status = (transaction as Record<string, unknown>).unifiedStatus as string | null | undefined;
    if (status === 'COMPLETED') return true;
    if (includePending && (status === 'IN_PROGRESS' || status === 'PENDING')) return true;
    return false;
  });
}

/**
 * Collect e-transfer IDs from transactions that need funding intent enrichment
 */
function collectETransferIds(transactions: WealthsimpleTransaction[]): string[] {
  const eTransferIds: string[] = [];
  for (const tx of transactions) {
    if (
      tx.subType === 'E_TRANSFER' &&
      tx.externalCanonicalId &&
      tx.externalCanonicalId.startsWith('funding_intent-')
    ) {
      eTransferIds.push(tx.externalCanonicalId);
    }
  }
  return eTransferIds;
}

/**
 * Collect internal transfer IDs from transactions that need enrichment
 */
function collectInternalTransferIds(transactions: WealthsimpleTransaction[]): string[] {
  const internalTransferIds: string[] = [];
  for (const tx of transactions) {
    if (
      tx.type === 'INTERNAL_TRANSFER' &&
      (tx.subType === 'SOURCE' || tx.subType === 'DESTINATION') &&
      tx.externalCanonicalId &&
      tx.externalCanonicalId.startsWith('funding_intent-')
    ) {
      internalTransferIds.push(tx.externalCanonicalId);
    }
  }
  return internalTransferIds;
}

/**
 * Collect bill pay funding intent IDs from transactions that need status summary enrichment
 */
function collectBillPayFundingIntentIds(transactions: WealthsimpleTransaction[]): string[] {
  const billPayIds: string[] = [];
  for (const tx of transactions) {
    if (
      tx.type === 'WITHDRAWAL' &&
      tx.subType === 'BILL_PAY' &&
      tx.externalCanonicalId &&
      tx.externalCanonicalId.startsWith('funding_intent-')
    ) {
      billPayIds.push(tx.externalCanonicalId);
    }
  }
  return billPayIds;
}

/**
 * Collect SPEND transaction IDs from CASH account transactions that need spend details enrichment
 */
function collectSpendTransactionIds(
  transactions: WealthsimpleTransaction[],
  idField: keyof WealthsimpleTransaction = 'externalCanonicalId',
): string[] {
  const spendIds: string[] = [];
  for (const tx of transactions) {
    if (tx.type === 'SPEND' && tx[idField]) {
      const id = tx[idField] as string;
      if (id && !spendIds.includes(id)) {
        spendIds.push(id);
      }
    }
  }
  return spendIds;
}

/**
 * Process a CASH account transaction using the rules engine
 */
function processCashTransaction(
  transaction: WealthsimpleTransaction,
  enrichmentMap: Map<string, unknown> | null = null,
): ProcessedTransaction {
  const ruleResult = applyTransactionRule(transaction, enrichmentMap);

  const isNegative = transaction.amountSign === 'negative';
  const finalAmount = isNegative ? -Math.abs(transaction.amount ?? 0) : Math.abs(transaction.amount ?? 0);
  const transactionId = getTransactionId(transaction);
  const uStatus = (transaction as Record<string, unknown>).unifiedStatus as string | null | undefined;

  if (!ruleResult) {
    // No rule matched — return transaction needing manual categorization
    debugLog(`CASH transaction ${transactionId} needs manual categorization - no matching rule`, {
      type: transaction.type,
      subType: transaction.subType,
    });

    const isPending = uStatus === 'IN_PROGRESS' || uStatus === 'PENDING';

    return {
      id: transactionId,
      date: convertToLocalDate(transaction.occurredAt),
      merchant: '',
      originalMerchant: '',
      amount: finalAmount,
      type: transaction.type,
      subType: transaction.subType,
      status: transaction.status,
      unifiedStatus: uStatus,
      isPending,
      resolvedMonarchCategory: undefined,
      ruleId: undefined,
      notes: '',
      technicalDetails: '',
      needsManualCategorization: true,
      rawTransaction: transaction,
      needsCategoryMapping: false,
      categoryKey: '',
    };
  }

  // Determine pending status — SPEND/PREPAID uses 'status', others use 'unifiedStatus'
  let isPending: boolean;
  if (isSpendPrepaidTransaction(transaction)) {
    isPending = transaction.status === 'authorized';
  } else {
    isPending = uStatus === 'IN_PROGRESS' || uStatus === 'PENDING';
  }

  return {
    id: transactionId,
    date: convertToLocalDate(transaction.occurredAt),
    merchant: ruleResult.merchant,
    originalMerchant: ruleResult.originalStatement,
    amount: finalAmount,
    type: transaction.type,
    subType: transaction.subType,
    status: transaction.status,
    unifiedStatus: uStatus,
    isPending,
    resolvedMonarchCategory: ruleResult.category,
    ruleId: ruleResult.ruleId,
    notes: ruleResult.notes || '',
    technicalDetails: ruleResult.technicalDetails || '',
    needsCategoryMapping: ruleResult.needsCategoryMapping || false,
    categoryKey: ruleResult.categoryKey || ruleResult.merchant,
    aftDetails: ruleResult.aftDetails || null,
  };
}

/**
 * Apply Line of Credit transaction rules
 */
function applyLineOfCreditRule(
  transaction: WealthsimpleTransaction,
  accountName: string | undefined,
): LocRuleResult | null {
  const { type, subType } = transaction;
  const name = accountName || 'LOC';

  if (type === 'INTERNAL_TRANSFER' && subType === 'SOURCE') {
    const statementText = `Borrow from ${name}`;
    return {
      merchant: statementText,
      originalStatement: formatOriginalStatement(type, subType, statementText),
      category: 'Transfer',
      ruleId: 'loc-borrow',
    };
  }

  if (type === 'INTERNAL_TRANSFER' && subType === 'DESTINATION') {
    const statementText = `Repayment to ${name}`;
    return {
      merchant: statementText,
      originalStatement: formatOriginalStatement(type, subType, statementText),
      category: 'Loan Repayment',
      ruleId: 'loc-repay',
    };
  }

  return null;
}

// ── Credit card transactions ─────────────────────────────────────────────────

/**
 * Fetch and process transactions for a credit card account
 */
export async function fetchAndProcessCreditCardTransactions(
  consolidatedAccount: ConsolidatedAccount,
  fromDate: string,
  toDate: string,
  options: FetchOptions = {},
): Promise<ProcessedTransaction[]> {
  try {
    const accountId = consolidatedAccount.wealthsimpleAccount.id;
    const accountName = consolidatedAccount.wealthsimpleAccount.nickname;
    const stripStoreNumbers = consolidatedAccount.stripStoreNumbers !== false;
    const { rawTransactions: providedTransactions, uploadedTransactionIds = new Set<string>() } = options;

    const includePendingTransactions = consolidatedAccount.includePendingTransactions !== false;

    debugLog(`Processing credit card transactions for ${accountName} from ${fromDate} to ${toDate}`);
    debugLog(`Store number stripping: ${stripStoreNumbers ? 'enabled' : 'disabled'}`);
    debugLog(`Include pending transactions: ${includePendingTransactions ? 'enabled' : 'disabled'}`);
    debugLog(`Already uploaded transactions to skip: ${uploadedTransactionIds.size}`);

    let rawTransactions: WealthsimpleTransaction[];
    if (providedTransactions && Array.isArray(providedTransactions)) {
      rawTransactions = providedTransactions;
      debugLog(`Using ${rawTransactions.length} pre-fetched transactions`);
    } else {
      rawTransactions = (await wealthsimpleApi.fetchTransactions(accountId, fromDate)) as unknown as WealthsimpleTransaction[];
      debugLog(`Fetched ${rawTransactions.length} total transactions from API`);
    }

    const syncableTransactions = filterSyncableTransactions(rawTransactions, includePendingTransactions);
    debugLog(`Filtered to ${syncableTransactions.length} syncable transactions (includePending: ${includePendingTransactions})`);

    if (syncableTransactions.length === 0) {
      return [];
    }

    const notYetUploadedTransactions = syncableTransactions.filter((tx) => {
      const isSettled = tx.status === 'settled';
      const isAlreadyUploaded = uploadedTransactionIds.has(tx.externalCanonicalId ?? '');
      if (isSettled && isAlreadyUploaded) return false;
      return true;
    });

    const uploadedSkipCount = syncableTransactions.length - notYetUploadedTransactions.length;
    if (uploadedSkipCount > 0) {
      debugLog(`Skipped ${uploadedSkipCount} already-uploaded settled transactions`);
    }

    if (notYetUploadedTransactions.length === 0) {
      debugLog('No new transactions to process after filtering already-uploaded');
      return [];
    }

    const purchaseTransactionIds = collectCreditCardPurchaseIds(notYetUploadedTransactions);
    let spendDetailsMap = new Map<string, unknown>();

    if (purchaseTransactionIds.length > 0) {
      debugLog(`Fetching spend transaction details for ${purchaseTransactionIds.length} PURCHASE transaction(s)...`);
      spendDetailsMap = (await wealthsimpleApi.fetchSpendTransactions(accountId, purchaseTransactionIds)) as Map<string, unknown>;
      debugLog(`Fetched ${spendDetailsMap.size} spend transaction detail(s)`);
    }

    const processedTransactions = notYetUploadedTransactions.map((transaction) =>
      processCreditCardTransaction(transaction, { stripStoreNumbers, spendDetailsMap }),
    );

    debugLog(`Processed ${processedTransactions.length} credit card transactions`);

    const skipCategorization = options.skipCategorization === true || consolidatedAccount.skipCategorization === true;
    const transactionsWithCategories = await resolveCategoriesForTransactions(processedTransactions, { skipCategorization });

    debugLog(`Category resolution complete, returning ${transactionsWithCategories.length} transactions (${uploadedSkipCount} already uploaded)`);
    return transactionsWithCategories;
  } catch (error: unknown) {
    debugLog('Error fetching and processing credit card transactions:', error);
    throw error;
  }
}

// ── CASH account transactions ────────────────────────────────────────────────

/**
 * Fetch and process transactions for a CASH account
 */
export async function fetchAndProcessCashTransactions(
  consolidatedAccount: ConsolidatedAccount,
  fromDate: string,
  toDate: string,
  options: FetchOptions = {},
): Promise<ProcessedTransaction[]> {
  try {
    const accountId = consolidatedAccount.wealthsimpleAccount.id;
    const accountName = consolidatedAccount.wealthsimpleAccount.nickname;
    const { rawTransactions: providedTransactions, uploadedTransactionIds = new Set<string>(), onProgress } = options;

    const includePendingTransactions = consolidatedAccount.includePendingTransactions !== false;

    debugLog(`Processing CASH transactions for ${accountName} from ${fromDate} to ${toDate}`);
    debugLog(`Include pending transactions: ${includePendingTransactions ? 'enabled' : 'disabled'}`);
    debugLog(`Already uploaded transactions to skip: ${uploadedTransactionIds.size}`);

    let rawTransactions: WealthsimpleTransaction[];
    if (providedTransactions && Array.isArray(providedTransactions)) {
      rawTransactions = providedTransactions;
      debugLog(`Using ${rawTransactions.length} pre-fetched transactions`);
    } else {
      rawTransactions = (await wealthsimpleApi.fetchTransactions(accountId, fromDate)) as unknown as WealthsimpleTransaction[];
      debugLog(`Fetched ${rawTransactions.length} total transactions from API`);
    }

    const syncableTransactions = filterCashSyncableTransactions(rawTransactions, includePendingTransactions);
    debugLog(`Filtered to ${syncableTransactions.length} syncable transactions (includePending: ${includePendingTransactions})`);

    if (syncableTransactions.length === 0) {
      return [];
    }

    const notYetUploadedTransactions = syncableTransactions.filter((tx) => {
      const uStatus = (tx as Record<string, unknown>).unifiedStatus as string | null | undefined;
      const isCompleted = uStatus === 'COMPLETED';
      const isAlreadyUploaded = uploadedTransactionIds.has(tx.externalCanonicalId ?? '');
      if (isCompleted && isAlreadyUploaded) return false;
      return true;
    });

    const uploadedSkipCount = syncableTransactions.length - notYetUploadedTransactions.length;
    if (uploadedSkipCount > 0) {
      debugLog(`Skipped ${uploadedSkipCount} already-uploaded COMPLETED transactions`);
    }

    if (notYetUploadedTransactions.length === 0) {
      debugLog('No new transactions to process after filtering already-uploaded');
      return [];
    }

    const transactionsWithRules: WealthsimpleTransaction[] = [];
    const transactionsWithoutRules: WealthsimpleTransaction[] = [];

    notYetUploadedTransactions.forEach((tx) => {
      if (CASH_TRANSACTION_RULES.some((rule) => rule.match(tx))) {
        transactionsWithRules.push(tx);
      } else {
        transactionsWithoutRules.push(tx);
      }
    });

    debugLog(`Transactions: ${transactionsWithRules.length} with rules, ${transactionsWithoutRules.length} need manual categorization`);

    if (transactionsWithRules.length === 0 && transactionsWithoutRules.length === 0) {
      debugLog('No transactions to process');
      return [];
    }

    const eTransferIds = collectETransferIds(transactionsWithRules);
    const internalTransferIds = collectInternalTransferIds(transactionsWithRules);
    const eftTransferIds = collectEftTransferIds(transactionsWithRules);
    const billPayFundingIntentIds = collectBillPayFundingIntentIds(transactionsWithRules);
    const spendTransactionIds = collectSpendTransactionIds(transactionsWithRules);

    const enrichmentMap = new Map<string, unknown>();

    // Fetch funding intent data for e-transfers (batch API)
    // Deprecated (2026-03-06): The memo field is no longer populated. Kept as fallback.
    if (eTransferIds.length > 0) {
      debugLog(`Fetching ${eTransferIds.length} funding intent(s) for e-transfer memos...`);
      const fundingIntentMap = (await wealthsimpleApi.fetchFundingIntents(eTransferIds)) as Map<string, unknown>;
      debugLog(`Fetched ${fundingIntentMap.size} funding intent(s)`);
      for (const [id, data] of fundingIntentMap) {
        enrichmentMap.set(id, data);
      }
    }

    // Fetch FundingIntentStatusSummary for e-transfers (primary source as of 2026-03-06)
    if (eTransferIds.length > 0) {
      debugLog(`Fetching ${eTransferIds.length} status summary(ies) for e-transfer annotations...`);
      for (let i = 0; i < eTransferIds.length; i++) {
        const id = eTransferIds[i];
        const progressNum = i + 1;
        debugLog(`Fetching e-transfer status summary (${progressNum}/${eTransferIds.length}): ${id}`);
        if (onProgress) onProgress(`E-transfer annotations (${progressNum}/${eTransferIds.length})`);
        const statusSummary = await wealthsimpleApi.fetchFundingIntentStatusSummary(id);
        if (statusSummary) {
          enrichmentMap.set(`status-summary:${id}`, statusSummary);
        }
      }
      debugLog(`Fetched status summaries for ${eTransferIds.length} e-transfer(s)`);
    }

    // Fetch FundingIntentStatusSummary for bill payments (annotations/notes)
    if (billPayFundingIntentIds.length > 0) {
      debugLog(`Fetching ${billPayFundingIntentIds.length} status summary(ies) for bill payment annotations...`);
      for (let i = 0; i < billPayFundingIntentIds.length; i++) {
        const id = billPayFundingIntentIds[i];
        const progressNum = i + 1;
        debugLog(`Fetching bill payment status summary (${progressNum}/${billPayFundingIntentIds.length}): ${id}`);
        if (onProgress) onProgress(`Bill payment annotations (${progressNum}/${billPayFundingIntentIds.length})`);
        const statusSummary = await wealthsimpleApi.fetchFundingIntentStatusSummary(id);
        if (statusSummary) {
          enrichmentMap.set(`status-summary:${id}`, statusSummary);
        }
      }
      debugLog(`Fetched status summaries for ${billPayFundingIntentIds.length} bill payment(s)`);
    }

    // Fetch internal transfer data for annotations
    if (internalTransferIds.length > 0) {
      debugLog(`Fetching ${internalTransferIds.length} internal transfer(s) for annotations...`);
      for (let i = 0; i < internalTransferIds.length; i++) {
        const id = internalTransferIds[i];
        const progressNum = i + 1;
        debugLog(`Fetching internal transfer details (${progressNum}/${internalTransferIds.length}): ${id}`);
        if (onProgress) onProgress(`Internal transfers (${progressNum}/${internalTransferIds.length})`);
        const internalTransfer = await wealthsimpleApi.fetchInternalTransfer(id);
        if (internalTransfer) enrichmentMap.set(id, internalTransfer);
      }
      debugLog(`Fetched ${internalTransferIds.length} internal transfer(s)`);
    }

    // Fetch EFT funds transfer data for bank account details
    if (eftTransferIds.length > 0) {
      debugLog(`Fetching ${eftTransferIds.length} EFT transfer(s) for bank account details...`);
      for (let i = 0; i < eftTransferIds.length; i++) {
        const id = eftTransferIds[i];
        const progressNum = i + 1;
        debugLog(`Fetching EFT transfer details (${progressNum}/${eftTransferIds.length}): ${id}`);
        if (onProgress) onProgress(`EFT transfers (${progressNum}/${eftTransferIds.length})`);
        const fundsTransfer = await wealthsimpleApi.fetchFundsTransfer(id);
        if (fundsTransfer) enrichmentMap.set(id, fundsTransfer);
      }
      debugLog(`Fetched ${eftTransferIds.length} EFT transfer(s)`);
    }

    // Fetch spend transaction details for foreign currency and reward info
    if (spendTransactionIds.length > 0) {
      debugLog(`Fetching spend transaction details for ${spendTransactionIds.length} transaction(s)...`);
      const spendDetailsMap = (await wealthsimpleApi.fetchSpendTransactions(accountId, spendTransactionIds)) as Map<string, unknown>;
      debugLog(`Fetched ${spendDetailsMap.size} spend transaction detail(s)`);
      for (const [id, data] of spendDetailsMap) {
        enrichmentMap.set(`spend:${id}`, data);
      }
    }

    debugLog(`Combined enrichment map has ${enrichmentMap.size} entries`);

    const processedTransactions: ProcessedTransaction[] = [];

    for (const transaction of transactionsWithRules) {
      const processed = processCashTransaction(transaction, enrichmentMap);
      if (processed) {
        processedTransactions.push(processed);
      }
    }

    debugLog(`Processed ${processedTransactions.length} transactions with rules`);

    const skipCategorization = options.skipCategorization === true || consolidatedAccount.skipCategorization === true;

    // Handle transactions without rules — manual categorization UI
    if (transactionsWithoutRules.length > 0) {
      if (skipCategorization) {
        debugLog(`Skip categorization enabled - auto-assigning ${transactionsWithoutRules.length} transactions without rules`);
        for (const rawTransaction of transactionsWithoutRules) {
          const isNegative = rawTransaction.amountSign === 'negative';
          const finalAmount = isNegative ? -Math.abs(rawTransaction.amount ?? 0) : Math.abs(rawTransaction.amount ?? 0);
          const uStatus = (rawTransaction as Record<string, unknown>).unifiedStatus as string | null | undefined;
          const isPending = uStatus === 'IN_PROGRESS' || uStatus === 'PENDING';

          const skippedTransaction: ProcessedTransaction = {
            id: rawTransaction.externalCanonicalId ?? getTransactionId(rawTransaction),
            date: convertToLocalDate(rawTransaction.occurredAt),
            merchant: formatOriginalStatement(rawTransaction.type, rawTransaction.subType, (rawTransaction.spendMerchant as string | null | undefined) || 'Unknown'),
            originalMerchant: formatOriginalStatement(rawTransaction.type, rawTransaction.subType, (rawTransaction.spendMerchant as string | null | undefined) || 'Unknown'),
            amount: finalAmount,
            type: rawTransaction.type,
            subType: rawTransaction.subType,
            status: rawTransaction.status,
            unifiedStatus: uStatus,
            isPending,
            resolvedMonarchCategory: 'Uncategorized',
            ruleId: 'skip-categorization',
            notes: '',
            technicalDetails: '',
            needsCategoryMapping: false,
            categoryKey: '',
          };

          processedTransactions.push(skippedTransaction);
        }
      } else {
        debugLog(`Processing ${transactionsWithoutRules.length} transactions that need manual categorization`);
        toast.show(`${transactionsWithoutRules.length} transaction(s) need manual categorization...`, 'info');

        for (let i = 0; i < transactionsWithoutRules.length; i++) {
          const rawTransaction = transactionsWithoutRules[i];
          const progressNum = i + 1;

          debugLog(`Showing manual categorization for transaction ${progressNum}/${transactionsWithoutRules.length}`, {
            id: rawTransaction.externalCanonicalId,
            type: rawTransaction.type,
            subType: rawTransaction.subType,
          });

          toast.show(`Manual categorization ${progressNum}/${transactionsWithoutRules.length}`, 'debug');

          const manualResult = await new Promise<ManualCategorizationResult | null>((resolve) => {
            showManualTransactionCategorization(rawTransaction, resolve as (result: unknown) => void);
          });

          if (!manualResult) {
            throw new Error(`Manual categorization cancelled for transaction ${rawTransaction.externalCanonicalId}. Upload aborted.`);
          }

          const isNegative = rawTransaction.amountSign === 'negative';
          const finalAmount = isNegative ? -Math.abs(rawTransaction.amount ?? 0) : Math.abs(rawTransaction.amount ?? 0);
          const uStatus = (rawTransaction as Record<string, unknown>).unifiedStatus as string | null | undefined;
          const isPending = uStatus === 'IN_PROGRESS' || uStatus === 'PENDING';

          const manuallyProcessed: ProcessedTransaction = {
            id: rawTransaction.externalCanonicalId ?? getTransactionId(rawTransaction),
            date: convertToLocalDate(rawTransaction.occurredAt),
            merchant: manualResult.merchant,
            originalMerchant: formatOriginalStatement(rawTransaction.type, rawTransaction.subType, manualResult.merchant),
            amount: finalAmount,
            type: rawTransaction.type,
            subType: rawTransaction.subType,
            status: rawTransaction.status,
            unifiedStatus: uStatus,
            isPending,
            resolvedMonarchCategory: manualResult.category.name,
            ruleId: 'manual',
            notes: '',
            technicalDetails: '',
            needsCategoryMapping: false,
            categoryKey: manualResult.merchant,
          };

          processedTransactions.push(manuallyProcessed);
          debugLog(`Manually categorized transaction: ${manualResult.merchant} -> ${manualResult.category.name}`);
        }

        toast.show(`Completed manual categorization for ${transactionsWithoutRules.length} transaction(s)`, 'info');
      }
    }

    debugLog(`Processed ${processedTransactions.length} total CASH transactions (${uploadedSkipCount} already uploaded)`);

    const transactionsNeedingCategoryMapping = processedTransactions.filter((tx) => tx.needsCategoryMapping);
    if (transactionsNeedingCategoryMapping.length > 0) {
      debugLog(`${transactionsNeedingCategoryMapping.length} transactions need category mapping (SPEND/PREPAID)`);
      return resolveCategoriesForTransactions(processedTransactions, { skipCategorization });
    }

    return processedTransactions;
  } catch (error: unknown) {
    debugLog('Error fetching and processing CASH transactions:', error);
    throw error;
  }
}

// ── Loan account placeholder ─────────────────────────────────────────────────

/**
 * Placeholder for loan account transaction processing
 */
export async function fetchAndProcessLoanTransactions(
  consolidatedAccount: ConsolidatedAccount,
  fromDate: string,
  toDate: string,
): Promise<ProcessedTransaction[]> {
  debugLog('Loan account transaction processing not yet implemented', {
    accountId: consolidatedAccount.wealthsimpleAccount.id,
    fromDate,
    toDate,
  });
  return [];
}

// ── Line of Credit transactions ──────────────────────────────────────────────

/**
 * Fetch and process transactions for a Portfolio Line of Credit account
 */
export async function fetchAndProcessLineOfCreditTransactions(
  consolidatedAccount: ConsolidatedAccount,
  fromDate: string,
  toDate: string,
  options: FetchOptions = {},
): Promise<ProcessedTransaction[]> {
  try {
    const accountId = consolidatedAccount.wealthsimpleAccount.id;
    const accountName = consolidatedAccount.wealthsimpleAccount.nickname;
    const { rawTransactions: providedTransactions, uploadedTransactionIds = new Set<string>() } = options;

    const includePendingTransactions = consolidatedAccount.includePendingTransactions !== false;

    debugLog(`Processing Line of Credit transactions for ${accountName} from ${fromDate} to ${toDate}`);
    debugLog(`Include pending transactions: ${includePendingTransactions ? 'enabled' : 'disabled'}`);
    debugLog(`Already uploaded transactions to skip: ${uploadedTransactionIds.size}`);

    let rawTransactions: WealthsimpleTransaction[];
    if (providedTransactions && Array.isArray(providedTransactions)) {
      rawTransactions = providedTransactions;
      debugLog(`Using ${rawTransactions.length} pre-fetched transactions`);
    } else {
      rawTransactions = (await wealthsimpleApi.fetchTransactions(accountId, fromDate)) as unknown as WealthsimpleTransaction[];
      debugLog(`Fetched ${rawTransactions.length} total transactions from API`);
    }

    debugLog('Line of Credit raw transactions (before filtering):');
    rawTransactions.forEach((tx, index) => {
      debugLog(`  Transaction ${index + 1}:`, {
        externalCanonicalId: tx.externalCanonicalId,
        type: tx.type,
        subType: tx.subType,
        status: tx.status,
        unifiedStatus: (tx as Record<string, unknown>).unifiedStatus,
        amount: tx.amount,
        amountSign: tx.amountSign,
        occurredAt: tx.occurredAt,
      });
    });

    const syncableTransactions = filterSyncableTransactions(rawTransactions, includePendingTransactions);
    debugLog(`Filtered to ${syncableTransactions.length} syncable transactions (includePending: ${includePendingTransactions})`);

    if (syncableTransactions.length === 0) return [];

    const notYetUploadedTransactions = syncableTransactions.filter((tx) => {
      const isCompleted = tx.status === 'settled' || tx.status === 'completed';
      const isAlreadyUploaded = uploadedTransactionIds.has(tx.externalCanonicalId ?? '');
      if (isCompleted && isAlreadyUploaded) return false;
      return true;
    });

    const uploadedSkipCount = syncableTransactions.length - notYetUploadedTransactions.length;
    if (uploadedSkipCount > 0) debugLog(`Skipped ${uploadedSkipCount} already-uploaded completed transactions`);

    if (notYetUploadedTransactions.length === 0) {
      debugLog('No new transactions to process after filtering already-uploaded');
      return [];
    }

    const transactionsWithRules: Array<{ raw: WealthsimpleTransaction; rule: LocRuleResult }> = [];
    const transactionsWithoutRules: WealthsimpleTransaction[] = [];

    notYetUploadedTransactions.forEach((tx) => {
      const ruleResult = applyLineOfCreditRule(tx, accountName);
      if (ruleResult) {
        transactionsWithRules.push({ raw: tx, rule: ruleResult });
      } else {
        transactionsWithoutRules.push(tx);
      }
    });

    debugLog(`Transactions: ${transactionsWithRules.length} with rules, ${transactionsWithoutRules.length} need manual categorization`);

    const processedTransactions: ProcessedTransaction[] = [];

    for (const { raw: rawTransaction, rule: ruleResult } of transactionsWithRules) {
      const isNegative = rawTransaction.amountSign === 'negative';
      const finalAmount = isNegative ? -Math.abs(rawTransaction.amount ?? 0) : Math.abs(rawTransaction.amount ?? 0);
      const isPending = rawTransaction.status === 'authorized';

      const processed: ProcessedTransaction = {
        id: rawTransaction.externalCanonicalId ?? getTransactionId(rawTransaction),
        date: convertToLocalDate(rawTransaction.occurredAt),
        merchant: ruleResult.merchant,
        originalMerchant: ruleResult.originalStatement,
        amount: finalAmount,
        type: rawTransaction.type,
        subType: rawTransaction.subType,
        status: rawTransaction.status,
        isPending,
        resolvedMonarchCategory: ruleResult.category,
        ruleId: ruleResult.ruleId,
        notes: '',
        technicalDetails: '',
        needsCategoryMapping: false,
        categoryKey: ruleResult.merchant,
      };

      processedTransactions.push(processed);
      debugLog(`Auto-categorized LOC transaction: ${ruleResult.merchant} -> ${ruleResult.category}`);
    }

    const skipCategorization = options.skipCategorization === true || consolidatedAccount.skipCategorization === true;

    if (transactionsWithoutRules.length > 0) {
      if (skipCategorization) {
        debugLog(`Skip categorization enabled - auto-assigning ${transactionsWithoutRules.length} LOC transactions without rules`);
        for (const rawTransaction of transactionsWithoutRules) {
          const isNegative = rawTransaction.amountSign === 'negative';
          const finalAmount = isNegative ? -Math.abs(rawTransaction.amount ?? 0) : Math.abs(rawTransaction.amount ?? 0);
          const isPending = rawTransaction.status === 'authorized';

          const skippedTransaction: ProcessedTransaction = {
            id: rawTransaction.externalCanonicalId ?? getTransactionId(rawTransaction),
            date: convertToLocalDate(rawTransaction.occurredAt),
            merchant: formatOriginalStatement(rawTransaction.type, rawTransaction.subType, 'Unknown'),
            originalMerchant: formatOriginalStatement(rawTransaction.type, rawTransaction.subType, 'Unknown'),
            amount: finalAmount,
            type: rawTransaction.type,
            subType: rawTransaction.subType,
            status: rawTransaction.status,
            isPending,
            resolvedMonarchCategory: 'Uncategorized',
            ruleId: 'skip-categorization',
            notes: '',
            technicalDetails: '',
            needsCategoryMapping: false,
            categoryKey: '',
          };
          processedTransactions.push(skippedTransaction);
        }
      } else {
        debugLog(`Processing ${transactionsWithoutRules.length} transactions that need manual categorization`);
        toast.show(`${transactionsWithoutRules.length} Line of Credit transaction(s) need manual categorization...`, 'info');

        for (let i = 0; i < transactionsWithoutRules.length; i++) {
          const rawTransaction = transactionsWithoutRules[i];
          const progressNum = i + 1;

          debugLog(`Showing manual categorization for transaction ${progressNum}/${transactionsWithoutRules.length}`, {
            id: rawTransaction.externalCanonicalId,
            type: rawTransaction.type,
            subType: rawTransaction.subType,
          });

          toast.show(`Manual categorization ${progressNum}/${transactionsWithoutRules.length}`, 'debug');

          const manualResult = await new Promise<ManualCategorizationResult | null>((resolve) => {
            showManualTransactionCategorization(rawTransaction, resolve as (result: unknown) => void);
          });

          if (!manualResult) {
            throw new Error(`Manual categorization cancelled for transaction ${rawTransaction.externalCanonicalId}. Upload aborted.`);
          }

          const isNegative = rawTransaction.amountSign === 'negative';
          const finalAmount = isNegative ? -Math.abs(rawTransaction.amount ?? 0) : Math.abs(rawTransaction.amount ?? 0);
          const isPending = rawTransaction.status === 'authorized';

          const manuallyProcessed: ProcessedTransaction = {
            id: rawTransaction.externalCanonicalId ?? getTransactionId(rawTransaction),
            date: convertToLocalDate(rawTransaction.occurredAt),
            merchant: manualResult.merchant,
            originalMerchant: formatOriginalStatement(rawTransaction.type, rawTransaction.subType, manualResult.merchant),
            amount: finalAmount,
            type: rawTransaction.type,
            subType: rawTransaction.subType,
            status: rawTransaction.status,
            isPending,
            resolvedMonarchCategory: manualResult.category.name,
            ruleId: 'manual',
            notes: '',
            technicalDetails: '',
            needsCategoryMapping: false,
            categoryKey: manualResult.merchant,
          };

          processedTransactions.push(manuallyProcessed);
          debugLog(`Manually categorized transaction: ${manualResult.merchant} -> ${manualResult.category.name}`);
        }

        toast.show(`Completed manual categorization for ${transactionsWithoutRules.length} transaction(s)`, 'info');
      }
    }

    debugLog(`Processed ${processedTransactions.length} total Line of Credit transactions (${uploadedSkipCount} already uploaded)`);
    return processedTransactions;
  } catch (error: unknown) {
    debugLog('Error fetching and processing Line of Credit transactions:', error);
    throw error;
  }
}

// ── Main router ──────────────────────────────────────────────────────────────

export async function fetchAndProcessTransactions(
  consolidatedAccount: ConsolidatedAccount,
  fromDate: string,
  toDate: string,
  options: FetchOptions = {},
): Promise<ProcessedTransaction[]> {
  const accountType = consolidatedAccount.wealthsimpleAccount.type;
  debugLog(`Processing transactions for account type: ${accountType}`);

  if (accountType === 'CASH' || accountType === 'CASH_USD') {
    return fetchAndProcessCashTransactions(consolidatedAccount, fromDate, toDate, options);
  }
  if (accountType === 'CREDIT_CARD') {
    return fetchAndProcessCreditCardTransactions(consolidatedAccount, fromDate, toDate, options);
  }
  if (accountType === 'PORTFOLIO_LINE_OF_CREDIT') {
    return fetchAndProcessLineOfCreditTransactions(consolidatedAccount, fromDate, toDate, options);
  }
  return fetchAndProcessInvestmentTransactions(consolidatedAccount, fromDate, toDate, options);
}

export default {
  fetchAndProcessTransactions,
  fetchAndProcessCreditCardTransactions,
  fetchAndProcessCashTransactions,
  fetchAndProcessLineOfCreditTransactions,
  fetchAndProcessLoanTransactions,
  fetchAndProcessInvestmentTransactions,
  reconcilePendingTransactions,
  formatReconciliationMessage,
};
