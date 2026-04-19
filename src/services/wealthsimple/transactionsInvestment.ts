/**
 * Wealthsimple Transactions - Investment Account Processing
 * Handles transaction fetching, filtering, and processing for investment accounts
 */

import { debugLog } from '../../core/utils';
import wealthsimpleApi from '../../api/wealthsimple';
import { showManualTransactionCategorization } from '../../ui/components/categorySelector';
import toast from '../../ui/toast';
import {
  CASH_TRANSACTION_RULES,
  INVESTMENT_BUY_SELL_TRANSACTION_RULES,
  INVESTMENT_CORPORATE_ACTION_TRANSACTION_RULES,
  INVESTMENT_DEPOSIT_TRANSACTION_RULES,
  INVESTMENT_DIVIDEND_TRANSACTION_RULES,
  INVESTMENT_FEE_TRANSACTION_RULES,
  INVESTMENT_INTEREST_TRANSACTION_RULES,
  INVESTMENT_INSTITUTIONAL_TRANSFER_RULES,
  INVESTMENT_NON_RESIDENT_TAX_TRANSACTION_RULES,
  INVESTMENT_REFUND_TRANSACTION_RULES,
  INVESTMENT_REIMBURSEMENT_TRANSACTION_RULES,
  INVESTMENT_RESP_GRANT_TRANSACTION_RULES,
  formatOriginalStatement,
  getTransactionId,
} from './transactionRules';
import { type WealthsimpleTransaction } from './transactionRulesHelpers';
import { collectEftTransferIds, convertToLocalDate, type ProcessedTransaction } from './transactionsHelpers';
import type { ConsolidatedAccountBase } from '../../types/wealthsimple';

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Alias for the shared ConsolidatedAccountBase type from src/types/wealthsimple.ts.
 * Eliminates the former local duplicate of WealthsimpleAccountData and ConsolidatedAccountForInvestment.
 */
type ConsolidatedAccountForInvestment = ConsolidatedAccountBase;

interface FetchInvestmentOptions {
  rawTransactions?: WealthsimpleTransaction[];
  uploadedTransactionIds?: Set<string>;
  onProgress?: (message: string) => void;
  skipCategorization?: boolean;
}

interface ManagedOrder {
  id: string;
  accountId: string;
}

interface BuySellOrderIds {
  managedOrders: ManagedOrder[];
  diyOrderIds: string[];
  cryptoOrderIds: string[];
}

interface ManualCategorizationResult {
  merchant: string;
  category: { name: string };
}

// ── Investment transaction rules ─────────────────────────────────────────────

/**
 * Investment account transaction rules
 * Combines:
 * 1. EFT transfer rule from CASH accounts (most specific - matches subType EFT before generic DEPOSIT)
 * 2. Internal transfer rule from CASH accounts
 * 3. Institutional transfer rules
 * 4. Deposit rules (generic DEPOSIT for non-EFT)
 * 5. Dividend rules
 * 6. Interest rules (including FPL_INTEREST)
 * 7. Fee rules (service fees, management fees, etc.)
 * 8. Refund rules (fee refunds, transfer fee refunds, etc.)
 * 9. RESP grant rules (government grants for RESP accounts)
 * 10. Non-resident tax rules (withholding tax on foreign income)
 * 11. Reimbursement rules (fee rebates, etc.)
 * 12. Corporate action rules (stock splits, consolidations, mergers, etc.)
 * 13. Buy/sell transaction rules specific to investment accounts
 * Other unknown types are handled via manual categorization
 */
export const INVESTMENT_TRANSACTION_RULES = [
  // EFT transfer rule FIRST (more specific - matches subType EFT before generic DEPOSIT)
  ...CASH_TRANSACTION_RULES.filter((rule) => rule.id === 'eft-transfer'),
  // Internal transfer rule (same as CASH accounts)
  ...CASH_TRANSACTION_RULES.filter((rule) => rule.id === 'internal-transfer'),
  // Promotional incentive bonus rule (applies to all account types)
  ...CASH_TRANSACTION_RULES.filter((rule) => rule.id === 'promotion-incentive-bonus'),
  // Institutional transfer rules (transfers to/from external institutions)
  ...INVESTMENT_INSTITUTIONAL_TRANSFER_RULES,
  // Generic deposit rules (catches non-EFT deposits like recurring contributions)
  ...INVESTMENT_DEPOSIT_TRANSACTION_RULES,
  // Dividend rules
  ...INVESTMENT_DIVIDEND_TRANSACTION_RULES,
  // Interest rules (including FPL_INTEREST for stock lending)
  ...INVESTMENT_INTEREST_TRANSACTION_RULES,
  // Fee rules (service fees, management fees, etc.)
  ...INVESTMENT_FEE_TRANSACTION_RULES,
  // Refund rules (fee refunds, transfer fee refunds, etc.)
  ...INVESTMENT_REFUND_TRANSACTION_RULES,
  // RESP grant rules (government grants for RESP accounts)
  ...INVESTMENT_RESP_GRANT_TRANSACTION_RULES,
  // Non-resident tax rules (withholding tax on foreign income)
  ...INVESTMENT_NON_RESIDENT_TAX_TRANSACTION_RULES,
  // Reimbursement rules (fee rebates, etc.)
  ...INVESTMENT_REIMBURSEMENT_TRANSACTION_RULES,
  // Corporate action rules (stock splits, consolidations, mergers, etc.)
  ...INVESTMENT_CORPORATE_ACTION_TRANSACTION_RULES,
  // Investment buy/sell rules
  ...INVESTMENT_BUY_SELL_TRANSACTION_RULES,
];

// ── Helper functions ─────────────────────────────────────────────────────────

/**
 * Check if a transaction is a buy/sell order that uses unifiedStatus
 */
function isInvestmentBuySellTransaction(transaction: WealthsimpleTransaction): boolean {
  const buySellTypes = ['MANAGED_BUY', 'DIY_BUY', 'MANAGED_SELL', 'DIY_SELL', 'OPTIONS_BUY', 'OPTIONS_SELL', 'OPTIONS_ASSIGN', 'CRYPTO_BUY', 'CRYPTO_SELL'];
  return buySellTypes.includes(transaction.type ?? '');
}

/**
 * Check if a transaction type uses unifiedStatus for status tracking
 * Investment accounts have many transaction types that use unifiedStatus:
 * - Buy/sell orders (MANAGED_BUY, DIY_BUY, CRYPTO_BUY, CRYPTO_SELL, etc.)
 * - Deposits (DEPOSIT with subType EFT, EFT_RECURRING, or null)
 * - Dividends (DIVIDEND)
 * - Interest (INTEREST)
 * - Institutional transfers (INSTITUTIONAL_TRANSFER_INTENT)
 * - Any transaction with null status field (e.g., REFUND)
 */
function usesUnifiedStatus(transaction: WealthsimpleTransaction): boolean {
  const unifiedStatusTypes = [
    'MANAGED_BUY', 'DIY_BUY', 'MANAGED_SELL', 'DIY_SELL', 'OPTIONS_BUY', 'OPTIONS_SELL', 'OPTIONS_ASSIGN', 'OPTIONS_SHORT_EXPIRY',
    'CRYPTO_BUY', 'CRYPTO_SELL',
    'DEPOSIT', 'DIVIDEND', 'INTEREST', 'INSTITUTIONAL_TRANSFER_INTENT',
  ];
  // Known types that use unifiedStatus, OR any transaction with null status field
  return unifiedStatusTypes.includes(transaction.type ?? '') || transaction.status === null;
}

/**
 * Filter investment account transactions based on status
 * Different transaction types use different status fields:
 *
 * Transactions using unifiedStatus:
 * - Buy/sell orders (MANAGED_BUY, DIY_BUY, MANAGED_SELL, DIY_SELL, OPTIONS_BUY, OPTIONS_SELL)
 * - Deposits (type=DEPOSIT)
 * - Dividends (type=DIVIDEND)
 * - Interest (type=INTEREST)
 * - Institutional transfers (type=INSTITUTIONAL_TRANSFER_INTENT)
 * Status values: COMPLETED = sync, IN_PROGRESS/PENDING = pending, EXPIRED/REJECTED/CANCELLED = exclude
 *
 * Transactions using status field:
 * - Internal transfers (INTERNAL_TRANSFER)
 * Status values: 'settled'/'completed' = sync, 'authorized' = pending
 */
function filterInvestmentSyncableTransactions(
  transactions: WealthsimpleTransaction[],
  includePending = true,
): WealthsimpleTransaction[] {
  const includedTransactions: WealthsimpleTransaction[] = [];
  const excludedTransactions: WealthsimpleTransaction[] = [];

  for (const transaction of transactions) {
    let included = false;

    // Transactions that use unifiedStatus field
    if (usesUnifiedStatus(transaction)) {
      const status = transaction.unifiedStatus as string | null | undefined;
      if (status === 'COMPLETED') {
        included = true;
      } else if (includePending && (status === 'IN_PROGRESS' || status === 'PENDING')) {
        included = true;
      }
    } else {
      // Internal transfers and other types use status field (like credit cards)
      const status = transaction.status;
      if (status === 'settled' || status === 'completed') {
        included = true;
      } else if (includePending && status === 'authorized') {
        included = true;
      }
    }

    if (included) {
      includedTransactions.push(transaction);
    } else {
      excludedTransactions.push(transaction);
    }
  }

  // Log excluded transactions for debugging
  if (excludedTransactions.length > 0) {
    debugLog(`Filtered out ${excludedTransactions.length} investment transaction(s) (will NOT sync):`);
    excludedTransactions.forEach((tx, index) => {
      const uStatus = (tx as Record<string, unknown>).unifiedStatus;
      debugLog(`  Excluded ${index + 1}:`, {
        externalCanonicalId: tx.externalCanonicalId,
        type: tx.type,
        subType: tx.subType,
        status: tx.status,
        unifiedStatus: uStatus,
        amount: tx.amount,
        amountSign: tx.amountSign,
        occurredAt: tx.occurredAt,
        assetSymbol: tx.assetSymbol,
        reason: usesUnifiedStatus(tx)
          ? `unifiedStatus="${uStatus}" not in [COMPLETED${includePending ? ', IN_PROGRESS, PENDING' : ''}]`
          : `status="${tx.status}" not in [settled, completed${includePending ? ', authorized' : ''}]`,
      });
    });
  }

  return includedTransactions;
}

/**
 * Collect corporate action canonical IDs from transactions that need child activities
 */
function collectCorporateActionIds(transactions: WealthsimpleTransaction[]): string[] {
  const corporateActionIds: string[] = [];

  for (const tx of transactions) {
    const canonicalId = (tx as Record<string, unknown>).canonicalId as string | undefined;
    if (tx.type === 'CORPORATE_ACTION' && canonicalId) {
      corporateActionIds.push(canonicalId);
    }
  }

  return corporateActionIds;
}

/**
 * Collect short option expiry IDs from transactions that need expiry details
 */
function collectShortOptionExpiryIds(transactions: WealthsimpleTransaction[]): string[] {
  const expiryIds: string[] = [];

  for (const tx of transactions) {
    if ((tx.type === 'OPTIONS_SHORT_EXPIRY' || tx.type === 'OPTIONS_ASSIGN') && tx.externalCanonicalId) {
      expiryIds.push(tx.externalCanonicalId);
    }
  }

  return expiryIds;
}

/**
 * Check if an external order ID is an Orders Service order ID
 * Orders Service order IDs start with "order-" prefix
 */
function isOrdersServiceOrderId(externalId: string | null | undefined): boolean {
  return !!(externalId && externalId.startsWith('order-'));
}

/**
 * Check if a transaction is a crypto buy/sell order
 */
function isCryptoBuySellTransaction(transaction: WealthsimpleTransaction): boolean {
  return transaction.type === 'CRYPTO_BUY' || transaction.type === 'CRYPTO_SELL';
}

/**
 * Collect order IDs from buy/sell transactions that need extended order data
 * Separates into three groups:
 * - Managed orders (MANAGED_BUY/SELL with order- prefix) → FetchActivityByOrdersServiceOrderId
 * - Crypto orders (CRYPTO_BUY/SELL with order- prefix) → FetchCryptoOrder
 * - DIY orders (all others) → FetchSoOrdersExtendedOrder
 */
function collectBuySellOrderIds(transactions: WealthsimpleTransaction[]): BuySellOrderIds {
  const managedOrders: ManagedOrder[] = [];
  const diyOrderIds: string[] = [];
  const cryptoOrderIds: string[] = [];

  for (const tx of transactions) {
    if (isInvestmentBuySellTransaction(tx) && tx.externalCanonicalId) {
      // Managed orders (MANAGED_BUY, MANAGED_SELL) with "order-" prefix need the managed API
      if ((tx.type === 'MANAGED_BUY' || tx.type === 'MANAGED_SELL') && isOrdersServiceOrderId(tx.externalCanonicalId)) {
        managedOrders.push({
          id: tx.externalCanonicalId,
          accountId: (tx as Record<string, unknown>).accountId as string,
        });
      } else if (isCryptoBuySellTransaction(tx) && isOrdersServiceOrderId(tx.externalCanonicalId)) {
        // Crypto orders with "order-" prefix need the FetchCryptoOrder API
        cryptoOrderIds.push(tx.externalCanonicalId);
      } else {
        // DIY orders and other types use the standard API
        diyOrderIds.push(tx.externalCanonicalId);
      }
    }
  }

  return { managedOrders, diyOrderIds, cryptoOrderIds };
}

/**
 * Collect internal transfer IDs from investment transactions that need enrichment
 */
function collectInvestmentInternalTransferIds(transactions: WealthsimpleTransaction[]): string[] {
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
 * Process an investment account transaction using the rules engine
 */
function processInvestmentTransaction(
  transaction: WealthsimpleTransaction,
  enrichmentMap: Map<string, unknown> | null = null,
): ProcessedTransaction | null {
  // Try to apply a matching rule from the investment rules
  for (const rule of INVESTMENT_TRANSACTION_RULES) {
    if (rule.match(transaction)) {
      debugLog(`Investment transaction ${getTransactionId(transaction)} matched rule: ${rule.id}`);
      const ruleResult = rule.process(transaction, enrichmentMap);

      const baseAmount = transaction.amount ?? 0;
      const isNegative = transaction.amountSign === 'negative';
      const finalAmount = isNegative ? -Math.abs(baseAmount) : Math.abs(baseAmount);

      // Determine pending status based on transaction type
      // Most investment transactions use unifiedStatus; only INTERNAL_TRANSFER uses status
      let isPending: boolean;
      if (usesUnifiedStatus(transaction)) {
        const uStatus = (transaction as Record<string, unknown>).unifiedStatus as string | undefined;
        isPending = uStatus === 'IN_PROGRESS' || uStatus === 'PENDING';
      } else {
        isPending = transaction.status === 'authorized';
      }

      const uStatus = (transaction as Record<string, unknown>).unifiedStatus as string | null | undefined;

      // For dividends, use payableDate (when money appears in account) if available
      // payableDate is already YYYY-MM-DD format, so use directly (no timezone conversion needed)
      const transactionDate = transaction.type === 'DIVIDEND' && transaction.payableDate
        ? transaction.payableDate
        : convertToLocalDate(transaction.occurredAt);

      return {
        id: getTransactionId(transaction),
        date: transactionDate,
        merchant: ruleResult.merchant,
        originalMerchant: ruleResult.originalStatement,
        amount: finalAmount,
        type: transaction.type,
        subType: transaction.subType,
        status: transaction.status,
        unifiedStatus: uStatus,
        isPending,
        resolvedMonarchCategory: ruleResult.category,
        ruleId: rule.id,
        notes: ruleResult.notes || '',
        technicalDetails: ruleResult.technicalDetails || '',
        needsCategoryMapping: false,
        categoryKey: ruleResult.merchant,
        // Include asset symbol for investment context
        assetSymbol: transaction.assetSymbol || null,
      };
    }
  }

  // No rule matched - return null to indicate manual categorization needed
  return null;
}

// ── Exported function ────────────────────────────────────────────────────────

/**
 * Fetch and process transactions for an investment account
 * Uses rules engine for INTERNAL_TRANSFER transactions (auto-categorized as "Transfer"),
 * and manual categorization for all other unknown transaction types.
 *
 * @param consolidatedAccount - Consolidated account object
 * @param fromDate - Start date (YYYY-MM-DD)
 * @param toDate - End date (YYYY-MM-DD)
 * @param options - Processing options
 * @returns Processed transactions ready for upload
 */
export async function fetchAndProcessInvestmentTransactions(
  consolidatedAccount: ConsolidatedAccountForInvestment,
  fromDate: string,
  toDate: string,
  options: FetchInvestmentOptions = {},
): Promise<ProcessedTransaction[]> {
  try {
    const accountId = consolidatedAccount.wealthsimpleAccount.id;
    const accountName = consolidatedAccount.wealthsimpleAccount.nickname;
    const { rawTransactions: providedTransactions, uploadedTransactionIds = new Set<string>(), onProgress } = options;

    // Get pending transactions setting (default true)
    const includePendingTransactions = consolidatedAccount.includePendingTransactions !== false;

    debugLog(`Processing investment transactions for ${accountName} from ${fromDate} to ${toDate}`);
    debugLog(`Include pending transactions: ${includePendingTransactions ? 'enabled' : 'disabled'}`);
    debugLog(`Already uploaded transactions to skip: ${uploadedTransactionIds.size}`);

    // Step 1: Use provided transactions or fetch from API
    let rawTransactions: WealthsimpleTransaction[];
    if (providedTransactions && Array.isArray(providedTransactions)) {
      rawTransactions = providedTransactions;
      debugLog(`Using ${rawTransactions.length} pre-fetched transactions`);
    } else {
      rawTransactions = (await wealthsimpleApi.fetchTransactions(accountId, fromDate)) as unknown as WealthsimpleTransaction[];
      debugLog(`Fetched ${rawTransactions.length} total transactions from API`);
    }

    // Debug log: Show raw transaction details
    debugLog('Investment account raw transactions (before filtering):');
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
        assetSymbol: tx.assetSymbol,
      });
    });

    // Step 2: Filter for syncable transactions using investment-specific filter
    // This handles both status field (for internal transfers) and unifiedStatus (for buy/sell)
    const syncableTransactions = filterInvestmentSyncableTransactions(rawTransactions, includePendingTransactions);
    debugLog(`Filtered to ${syncableTransactions.length} syncable transactions (includePending: ${includePendingTransactions})`);

    if (syncableTransactions.length === 0) {
      return [];
    }

    // Step 3: Filter out already-uploaded completed transactions
    // Most investment transactions use unifiedStatus; only INTERNAL_TRANSFER uses status
    const notYetUploadedTransactions = syncableTransactions.filter((tx) => {
      const txId = getTransactionId(tx);
      const isAlreadyUploaded = uploadedTransactionIds.has(txId);

      // Determine if transaction is completed based on type
      let isCompleted: boolean;
      if (usesUnifiedStatus(tx)) {
        isCompleted = (tx as Record<string, unknown>).unifiedStatus === 'COMPLETED';
      } else {
        isCompleted = tx.status === 'settled' || tx.status === 'completed';
      }

      // Skip only completed transactions that are already uploaded
      if (isCompleted && isAlreadyUploaded) {
        return false;
      }
      return true;
    });

    const uploadedSkipCount = syncableTransactions.length - notYetUploadedTransactions.length;
    if (uploadedSkipCount > 0) {
      debugLog(`Skipped ${uploadedSkipCount} already-uploaded completed transactions`);
    }

    if (notYetUploadedTransactions.length === 0) {
      debugLog('No new transactions to process after filtering already-uploaded');
      return [];
    }

    // Step 4: Separate transactions with/without rules
    // Transactions with rules get auto-categorized, those without need manual categorization
    const transactionsWithRules: WealthsimpleTransaction[] = [];
    const transactionsWithoutRules: WealthsimpleTransaction[] = [];

    notYetUploadedTransactions.forEach((tx) => {
      if (INVESTMENT_TRANSACTION_RULES.some((rule) => rule.match(tx))) {
        transactionsWithRules.push(tx);
      } else {
        transactionsWithoutRules.push(tx);
      }
    });

    debugLog(`Investment transactions: ${transactionsWithRules.length} with rules, ${transactionsWithoutRules.length} need manual categorization`);

    if (transactionsWithRules.length === 0 && transactionsWithoutRules.length === 0) {
      debugLog('No transactions to process');
      return [];
    }

    // Step 5: Collect IDs for enrichment data
    // - Internal transfers need annotation fetching
    // - EFT transfers need funds transfer data for bank account details
    // - Buy/sell orders need extended order data for notes
    // - Corporate actions need child activities for notes
    const internalTransferIds = collectInvestmentInternalTransferIds(transactionsWithRules);
    const eftTransferIds = collectEftTransferIds(transactionsWithRules);
    const buySellOrderIds = collectBuySellOrderIds(transactionsWithRules);
    const corporateActionIds = collectCorporateActionIds(transactionsWithRules);

    // Create enrichment map for the rules engine
    const enrichmentMap = new Map<string, unknown>();

    // Fetch internal transfer data for annotations (individual calls with progress)
    if (internalTransferIds.length > 0) {
      debugLog(`Fetching ${internalTransferIds.length} internal transfer(s) for annotations...`);
      for (let i = 0; i < internalTransferIds.length; i++) {
        const id = internalTransferIds[i];
        const progressNum = i + 1;
        debugLog(`Fetching internal transfer details (${progressNum}/${internalTransferIds.length}): ${id}`);

        if (onProgress) {
          onProgress(`Internal transfers (${progressNum}/${internalTransferIds.length})`);
        }

        const internalTransfer = await wealthsimpleApi.fetchInternalTransfer(id);
        if (internalTransfer) {
          enrichmentMap.set(id, internalTransfer);
        }
      }
      debugLog(`Fetched ${internalTransferIds.length} internal transfer(s)`);
    }

    // Fetch EFT transfer data for bank account details (individual calls)
    if (eftTransferIds.length > 0) {
      debugLog(`Fetching ${eftTransferIds.length} EFT transfer(s) for bank account details...`);
      for (let i = 0; i < eftTransferIds.length; i++) {
        const eftId = eftTransferIds[i];
        const progressNum = i + 1;
        debugLog(`Fetching EFT transfer details (${progressNum}/${eftTransferIds.length}): ${eftId}`);

        if (onProgress) {
          onProgress(`EFT transfers (${progressNum}/${eftTransferIds.length})`);
        }

        const fundsTransfer = await wealthsimpleApi.fetchFundsTransfer(eftId);
        if (fundsTransfer) {
          enrichmentMap.set(eftId, fundsTransfer);
        }
      }
      debugLog(`Fetched ${eftTransferIds.length} EFT transfer(s)`);
    }

    // Fetch buy/sell order enrichment data
    const { managedOrders, diyOrderIds, cryptoOrderIds } = buySellOrderIds;
    const totalOrderCount = managedOrders.length + diyOrderIds.length + cryptoOrderIds.length;

    if (totalOrderCount > 0) {
      debugLog(`Fetching ${totalOrderCount} order(s) (${managedOrders.length} managed, ${diyOrderIds.length} DIY, ${cryptoOrderIds.length} crypto)...`);
      let orderProgressNum = 0;

      // Fetch managed orders using FetchActivityByOrdersServiceOrderId API
      for (let i = 0; i < managedOrders.length; i++) {
        const { id: orderId, accountId: orderAccountId } = managedOrders[i];
        orderProgressNum += 1;
        debugLog(`Fetching managed order details (${orderProgressNum}/${totalOrderCount}): ${orderId}`);

        if (onProgress) {
          onProgress(`Order details (${orderProgressNum}/${totalOrderCount})`);
        }

        const activityData = await wealthsimpleApi.fetchActivityByOrdersServiceOrderId(orderAccountId, orderId);
        if (activityData) {
          enrichmentMap.set(orderId, { ...(activityData as object), isManagedOrderData: true });
        }
      }

      // Fetch DIY orders using FetchSoOrdersExtendedOrder API
      for (let i = 0; i < diyOrderIds.length; i++) {
        const orderId = diyOrderIds[i];
        orderProgressNum += 1;
        debugLog(`Fetching DIY order details (${orderProgressNum}/${totalOrderCount}): ${orderId}`);

        if (onProgress) {
          onProgress(`Order details (${orderProgressNum}/${totalOrderCount})`);
        }

        const extendedOrder = await wealthsimpleApi.fetchExtendedOrder(orderId);
        if (extendedOrder) {
          enrichmentMap.set(orderId, extendedOrder);
        }
      }

      // Fetch crypto orders using FetchCryptoOrder API
      for (let i = 0; i < cryptoOrderIds.length; i++) {
        const orderId = cryptoOrderIds[i];
        orderProgressNum += 1;
        debugLog(`Fetching crypto order details (${orderProgressNum}/${totalOrderCount}): ${orderId}`);

        if (onProgress) {
          onProgress(`Order details (${orderProgressNum}/${totalOrderCount})`);
        }

        const cryptoOrder = await wealthsimpleApi.fetchCryptoOrder(orderId);
        if (cryptoOrder) {
          // Store with isCryptoOrderData marker for the rules engine
          enrichmentMap.set(orderId, { ...(cryptoOrder as object), isCryptoOrderData: true });
        }
      }

      debugLog(`Fetched ${totalOrderCount} order(s) (${managedOrders.length} managed, ${diyOrderIds.length} DIY, ${cryptoOrderIds.length} crypto)`);
    }

    // Fetch corporate action child activities (individual calls with progress)
    if (corporateActionIds.length > 0) {
      debugLog(`Fetching ${corporateActionIds.length} corporate action child activities...`);
      for (let i = 0; i < corporateActionIds.length; i++) {
        const canonicalId = corporateActionIds[i];
        const progressNum = i + 1;
        debugLog(`Fetching corporate action details (${progressNum}/${corporateActionIds.length}): ${canonicalId}`);

        if (onProgress) {
          onProgress(`Corporate actions (${progressNum}/${corporateActionIds.length})`);
        }

        const childActivities = await wealthsimpleApi.fetchCorporateActionChildActivities(canonicalId);
        if (childActivities && childActivities.length > 0) {
          enrichmentMap.set(canonicalId, childActivities);
        }
      }
      debugLog(`Fetched ${corporateActionIds.length} corporate action(s)`);
    }

    // Fetch short option expiry details (individual calls with progress)
    const shortOptionExpiryIds = collectShortOptionExpiryIds(transactionsWithRules);
    if (shortOptionExpiryIds.length > 0) {
      debugLog(`Fetching ${shortOptionExpiryIds.length} short option expiry details...`);
      for (let i = 0; i < shortOptionExpiryIds.length; i++) {
        const expiryId = shortOptionExpiryIds[i];
        const progressNum = i + 1;
        debugLog(`Fetching short option expiry details (${progressNum}/${shortOptionExpiryIds.length}): ${expiryId}`);

        if (onProgress) {
          onProgress(`Option expiries (${progressNum}/${shortOptionExpiryIds.length})`);
        }

        const expiryDetail = await wealthsimpleApi.fetchShortOptionPositionExpiryDetail(expiryId);
        if (expiryDetail) {
          // Fetch security names for deliverables
          const securityCache = new Map<string, unknown>();
          // Static security IDs that don't need to be fetched (cash currencies)
          const STATIC_SECURITY_IDS = new Set(['sec-s-cad', 'sec-s-usd']);
          const deliverables = (expiryDetail as Record<string, unknown>).deliverables;
          if (deliverables && Array.isArray(deliverables)) {
            for (const deliverable of deliverables) {
              const secId = (deliverable as Record<string, unknown>).securityId as string | undefined;
              // Skip only static cash security mappings (sec-s-cad, sec-s-usd)
              if (secId && !STATIC_SECURITY_IDS.has(secId)) {
                const security = await wealthsimpleApi.fetchSecurity(secId);
                if (security) {
                  securityCache.set(secId, security);
                }
              }
            }
          }
          enrichmentMap.set(expiryId, { expiryDetail, securityCache });
        }
      }
      debugLog(`Fetched ${shortOptionExpiryIds.length} short option expiry detail(s)`);
    }

    debugLog(`Enrichment map has ${enrichmentMap.size} entries`);

    // Step 6: Process transactions with rules through the rules engine
    const processedTransactions: ProcessedTransaction[] = [];

    for (const transaction of transactionsWithRules) {
      const processed = processInvestmentTransaction(transaction, enrichmentMap);
      if (processed) {
        processedTransactions.push(processed);
        debugLog(`Auto-categorized investment transaction: ${processed.merchant} -> ${processed.resolvedMonarchCategory}`);
      }
    }

    debugLog(`Processed ${processedTransactions.length} transactions with rules`);

    // Read skip categorization setting
    // skipCategorization can be forced via options (e.g., balance reconstruction) or set per-account
    const skipCategorization = options.skipCategorization === true || consolidatedAccount.skipCategorization === true;

    // Step 7: Handle transactions without rules - show manual categorization UI
    if (transactionsWithoutRules.length > 0) {
      if (skipCategorization) {
        // Skip manual categorization - assign Uncategorized for Monarch
        debugLog(`Skip categorization enabled - auto-assigning ${transactionsWithoutRules.length} investment transactions without rules`);
        for (const rawTransaction of transactionsWithoutRules) {
          const isNegative = rawTransaction.amountSign === 'negative';
          const finalAmount = isNegative ? -Math.abs(rawTransaction.amount ?? 0) : Math.abs(rawTransaction.amount ?? 0);

          let isPending: boolean;
          if (usesUnifiedStatus(rawTransaction)) {
            const uStatus = (rawTransaction as Record<string, unknown>).unifiedStatus as string | undefined;
            isPending = uStatus === 'IN_PROGRESS' || uStatus === 'PENDING';
          } else {
            isPending = rawTransaction.status === 'authorized';
          }

          const transactionId = getTransactionId(rawTransaction);
          const uStatus = (rawTransaction as Record<string, unknown>).unifiedStatus as string | null | undefined;

          const skippedTransaction: ProcessedTransaction = {
            id: transactionId,
            date: convertToLocalDate(rawTransaction.occurredAt),
            merchant: formatOriginalStatement(rawTransaction.type, rawTransaction.subType, rawTransaction.assetSymbol || 'Unknown'),
            originalMerchant: formatOriginalStatement(rawTransaction.type, rawTransaction.subType, rawTransaction.assetSymbol || 'Unknown'),
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
            assetSymbol: rawTransaction.assetSymbol || null,
          };

          processedTransactions.push(skippedTransaction);
        }
      } else {
        debugLog(`Processing ${transactionsWithoutRules.length} transactions that need manual categorization`);
        toast.show(`${transactionsWithoutRules.length} investment transaction(s) need manual categorization...`, 'info');

        for (let i = 0; i < transactionsWithoutRules.length; i++) {
          const rawTransaction = transactionsWithoutRules[i];
          const progressNum = i + 1;

          debugLog(`Showing manual categorization for transaction ${progressNum}/${transactionsWithoutRules.length}`, {
            id: rawTransaction.externalCanonicalId,
            type: rawTransaction.type,
            subType: rawTransaction.subType,
          });

          toast.show(`Manual categorization ${progressNum}/${transactionsWithoutRules.length}`, 'debug');

          // Show the manual categorization dialog
          const manualResult = await new Promise<ManualCategorizationResult | null>((resolve) => {
            showManualTransactionCategorization(rawTransaction, resolve as (result: unknown) => void);
          });

          if (!manualResult) {
            // User cancelled - abort the upload
            throw new Error(`Manual categorization cancelled for transaction ${rawTransaction.externalCanonicalId}. Upload aborted.`);
          }

          // Determine amount sign
          const isNegative = rawTransaction.amountSign === 'negative';
          const finalAmount = isNegative ? -Math.abs(rawTransaction.amount ?? 0) : Math.abs(rawTransaction.amount ?? 0);

          // Determine pending status based on transaction type
          // Most investment transactions use unifiedStatus; only INTERNAL_TRANSFER uses status
          let isPending: boolean;
          if (usesUnifiedStatus(rawTransaction)) {
            const uStatus = (rawTransaction as Record<string, unknown>).unifiedStatus as string | undefined;
            isPending = uStatus === 'IN_PROGRESS' || uStatus === 'PENDING';
          } else {
            isPending = rawTransaction.status === 'authorized';
          }

          // Get transaction ID (handles null externalCanonicalId)
          const transactionId = getTransactionId(rawTransaction);
          const uStatus = (rawTransaction as Record<string, unknown>).unifiedStatus as string | null | undefined;

          // Create processed transaction with user-provided data
          const manuallyProcessed: ProcessedTransaction = {
            id: transactionId,
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
            // Include asset symbol for investment context
            assetSymbol: rawTransaction.assetSymbol || null,
          };

          processedTransactions.push(manuallyProcessed);
          debugLog(`Manually categorized transaction: ${manualResult.merchant} -> ${manualResult.category.name}`);
        }

        toast.show(`Completed manual categorization for ${transactionsWithoutRules.length} transaction(s)`, 'info');
      }
    }

    debugLog(`Processed ${processedTransactions.length} total investment transactions (${uploadedSkipCount} already uploaded)`);
    return processedTransactions;
  } catch (error: unknown) {
    debugLog('Error fetching and processing investment transactions:', error);
    throw error;
  }
}
