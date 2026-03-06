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
import { collectEftTransferIds, convertToLocalDate } from './transactionsHelpers';

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
const INVESTMENT_TRANSACTION_RULES = [
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

/**
 * Check if a transaction is a buy/sell order that uses unifiedStatus
 * @param {Object} transaction - Raw transaction from API
 * @returns {boolean} True if buy/sell transaction type
 */
function isInvestmentBuySellTransaction(transaction) {
  const buySellTypes = ['MANAGED_BUY', 'DIY_BUY', 'MANAGED_SELL', 'DIY_SELL', 'OPTIONS_BUY', 'OPTIONS_SELL', 'CRYPTO_BUY', 'CRYPTO_SELL'];
  return buySellTypes.includes(transaction.type);
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
 *
 * @param {Object} transaction - Raw transaction from API
 * @returns {boolean} True if transaction uses unifiedStatus
 */
function usesUnifiedStatus(transaction) {
  const unifiedStatusTypes = [
    'MANAGED_BUY', 'DIY_BUY', 'MANAGED_SELL', 'DIY_SELL', 'OPTIONS_BUY', 'OPTIONS_SELL', 'OPTIONS_SHORT_EXPIRY',
    'CRYPTO_BUY', 'CRYPTO_SELL',
    'DEPOSIT', 'DIVIDEND', 'INTEREST', 'INSTITUTIONAL_TRANSFER_INTENT',
  ];
  // Known types that use unifiedStatus, OR any transaction with null status field
  return unifiedStatusTypes.includes(transaction.type) || transaction.status === null;
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
 *
 * @param {Array} transactions - Raw transactions from API
 * @param {boolean} includePending - Whether to include pending transactions
 * @returns {Array} Filtered transactions ready for processing
 */
function filterInvestmentSyncableTransactions(transactions, includePending = true) {
  const includedTransactions = [];
  const excludedTransactions = [];

  for (const transaction of transactions) {
    let included = false;

    // Transactions that use unifiedStatus field
    if (usesUnifiedStatus(transaction)) {
      const status = transaction.unifiedStatus;
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
      debugLog(`  Excluded ${index + 1}:`, {
        externalCanonicalId: tx.externalCanonicalId,
        type: tx.type,
        subType: tx.subType,
        status: tx.status,
        unifiedStatus: tx.unifiedStatus,
        amount: tx.amount,
        amountSign: tx.amountSign,
        occurredAt: tx.occurredAt,
        assetSymbol: tx.assetSymbol,
        reason: usesUnifiedStatus(tx)
          ? `unifiedStatus="${tx.unifiedStatus}" not in [COMPLETED${includePending ? ', IN_PROGRESS, PENDING' : ''}]`
          : `status="${tx.status}" not in [settled, completed${includePending ? ', authorized' : ''}]`,
      });
    });
  }

  return includedTransactions;
}

/**
 * Collect corporate action canonical IDs from transactions that need child activities
 * Returns only canonicalIds from CORPORATE_ACTION transactions
 *
 * @param {Array} transactions - Raw transactions from Wealthsimple API
 * @returns {Array<string>} Array of canonical IDs for fetchCorporateActionChildActivities
 */
function collectCorporateActionIds(transactions) {
  const corporateActionIds = [];

  for (const tx of transactions) {
    if (tx.type === 'CORPORATE_ACTION' && tx.canonicalId) {
      corporateActionIds.push(tx.canonicalId);
    }
  }

  return corporateActionIds;
}

/**
 * Collect short option expiry IDs from transactions that need expiry details
 * Returns externalCanonicalIds from OPTIONS_SHORT_EXPIRY transactions
 *
 * @param {Array} transactions - Raw transactions from Wealthsimple API
 * @returns {Array<string>} Array of expiry detail IDs for fetchShortOptionPositionExpiryDetail
 */
function collectShortOptionExpiryIds(transactions) {
  const expiryIds = [];

  for (const tx of transactions) {
    if (tx.type === 'OPTIONS_SHORT_EXPIRY' && tx.externalCanonicalId) {
      expiryIds.push(tx.externalCanonicalId);
    }
  }

  return expiryIds;
}

/**
 * Check if an external order ID is an Orders Service order ID
 * Orders Service order IDs start with "order-" prefix
 * These orders use the FetchActivityByOrdersServiceOrderId API instead of FetchSoOrdersExtendedOrder
 *
 * @param {string} externalId - External canonical ID
 * @returns {boolean} True if starts with "order-"
 */
function isOrdersServiceOrderId(externalId) {
  return externalId && externalId.startsWith('order-');
}

/**
 * Check if a transaction is a crypto buy/sell order
 * @param {Object} transaction - Raw transaction from API
 * @returns {boolean} True if crypto buy/sell transaction type
 */
function isCryptoBuySellTransaction(transaction) {
  return transaction.type === 'CRYPTO_BUY' || transaction.type === 'CRYPTO_SELL';
}

/**
 * Collect order IDs from buy/sell transactions that need extended order data
 * Separates into three groups:
 * - Managed orders (MANAGED_BUY/SELL with order- prefix) → FetchActivityByOrdersServiceOrderId
 * - Crypto orders (CRYPTO_BUY/SELL with order- prefix) → FetchCryptoOrder
 * - DIY orders (all others) → FetchSoOrdersExtendedOrder
 *
 * @param {Array} transactions - Raw transactions from Wealthsimple API
 * @returns {Object} Object with { managedOrders: Array<{id, accountId}>, diyOrderIds: Array<string>, cryptoOrderIds: Array<string> }
 */
function collectBuySellOrderIds(transactions) {
  const managedOrders = [];
  const diyOrderIds = [];
  const cryptoOrderIds = [];

  for (const tx of transactions) {
    if (isInvestmentBuySellTransaction(tx) && tx.externalCanonicalId) {
      // Managed orders (MANAGED_BUY, MANAGED_SELL) with "order-" prefix need the managed API
      if ((tx.type === 'MANAGED_BUY' || tx.type === 'MANAGED_SELL') && isOrdersServiceOrderId(tx.externalCanonicalId)) {
        managedOrders.push({
          id: tx.externalCanonicalId,
          accountId: tx.accountId,
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
 * @param {Array} transactions - Raw transactions from Wealthsimple API
 * @returns {Array<string>} Array of internal transfer IDs
 */
function collectInvestmentInternalTransferIds(transactions) {
  const internalTransferIds = [];

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
 * @param {Object} transaction - Raw transaction from Wealthsimple API
 * @param {Map<string, Object>} enrichmentMap - Optional map of enrichment data (internal transfers, extended orders, etc.)
 * @returns {Object} Processed transaction object (may include needsManualCategorization flag)
 */
function processInvestmentTransaction(transaction, enrichmentMap = null) {
  // Try to apply a matching rule from the investment rules
  for (const rule of INVESTMENT_TRANSACTION_RULES) {
    if (rule.match(transaction)) {
      debugLog(`Investment transaction ${getTransactionId(transaction)} matched rule: ${rule.id}`);
      const ruleResult = rule.process(transaction, enrichmentMap);

      // Determine amount sign
      const isNegative = transaction.amountSign === 'negative';
      const finalAmount = isNegative ? -Math.abs(transaction.amount) : Math.abs(transaction.amount);

      // Determine pending status based on transaction type
      // Most investment transactions use unifiedStatus; only INTERNAL_TRANSFER uses status
      let isPending;
      if (usesUnifiedStatus(transaction)) {
        isPending = transaction.unifiedStatus === 'IN_PROGRESS' || transaction.unifiedStatus === 'PENDING';
      } else {
        isPending = transaction.status === 'authorized';
      }

      return {
        id: getTransactionId(transaction),
        date: convertToLocalDate(transaction.occurredAt),
        merchant: ruleResult.merchant,
        originalMerchant: ruleResult.originalStatement,
        amount: finalAmount,
        type: transaction.type,
        subType: transaction.subType,
        status: transaction.status,
        unifiedStatus: transaction.unifiedStatus,
        isPending,
        resolvedMonarchCategory: ruleResult.category,
        ruleId: ruleResult.ruleId || rule.id,
        notes: ruleResult.notes || '',
        technicalDetails: ruleResult.technicalDetails || '',
        needsCategoryMapping: ruleResult.needsCategoryMapping || false,
        categoryKey: ruleResult.categoryKey || ruleResult.merchant,
        // Include asset symbol for investment context
        assetSymbol: transaction.assetSymbol || null,
      };
    }
  }

  // No rule matched - return null to indicate manual categorization needed
  return null;
}

/**
 * Fetch and process transactions for an investment account
 * Uses rules engine for INTERNAL_TRANSFER transactions (auto-categorized as "Transfer"),
 * and manual categorization for all other unknown transaction types.
 *
 * @param {Object} consolidatedAccount - Consolidated account object
 * @param {string} fromDate - Start date (YYYY-MM-DD)
 * @param {string} toDate - End date (YYYY-MM-DD)
 * @param {Object} options - Processing options
 * @param {Array} options.rawTransactions - Pre-fetched raw transactions (optional, will fetch if not provided)
 * @param {Set<string>} options.uploadedTransactionIds - Set of already-uploaded transaction IDs to skip
 * @param {Function} options.onProgress - Callback for progress updates (optional)
 * @returns {Promise<Array>} Processed transactions ready for upload
 */
export async function fetchAndProcessInvestmentTransactions(consolidatedAccount, fromDate, toDate, options = {}) {
  try {
    const accountId = consolidatedAccount.wealthsimpleAccount.id;
    const accountName = consolidatedAccount.wealthsimpleAccount.nickname;
    const { rawTransactions: providedTransactions, uploadedTransactionIds = new Set(), onProgress } = options;

    // Get pending transactions setting (default true)
    const includePendingTransactions = consolidatedAccount.includePendingTransactions !== false;

    debugLog(`Processing investment transactions for ${accountName} from ${fromDate} to ${toDate}`);
    debugLog(`Include pending transactions: ${includePendingTransactions ? 'enabled' : 'disabled'}`);
    debugLog(`Already uploaded transactions to skip: ${uploadedTransactionIds.size}`);

    // Step 1: Use provided transactions or fetch from API
    let rawTransactions;
    if (providedTransactions && Array.isArray(providedTransactions)) {
      rawTransactions = providedTransactions;
      debugLog(`Using ${rawTransactions.length} pre-fetched transactions`);
    } else {
      rawTransactions = await wealthsimpleApi.fetchTransactions(accountId, fromDate);
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
        unifiedStatus: tx.unifiedStatus,
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
      let isCompleted;
      if (usesUnifiedStatus(tx)) {
        isCompleted = tx.unifiedStatus === 'COMPLETED';
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
    const transactionsWithRules = [];
    const transactionsWithoutRules = [];

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
    const enrichmentMap = new Map();

    // Fetch internal transfer data for annotations (individual calls with progress)
    if (internalTransferIds.length > 0) {
      debugLog(`Fetching ${internalTransferIds.length} internal transfer(s) for annotations...`);
      for (let i = 0; i < internalTransferIds.length; i++) {
        const id = internalTransferIds[i];
        const progressNum = i + 1;
        debugLog(`Fetching internal transfer details (${progressNum}/${internalTransferIds.length}): ${id}`);

        // Update progress callback for UI
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

    // Fetch EFT funds transfer data for bank account details (individual calls with progress)
    if (eftTransferIds.length > 0) {
      debugLog(`Fetching ${eftTransferIds.length} EFT transfer(s) for bank account details...`);
      for (let i = 0; i < eftTransferIds.length; i++) {
        const id = eftTransferIds[i];
        const progressNum = i + 1;
        debugLog(`Fetching EFT transfer details (${progressNum}/${eftTransferIds.length}): ${id}`);

        // Update progress callback for UI
        if (onProgress) {
          onProgress(`EFT transfers (${progressNum}/${eftTransferIds.length})`);
        }

        const fundsTransfer = await wealthsimpleApi.fetchFundsTransfer(id);
        if (fundsTransfer) {
          enrichmentMap.set(id, fundsTransfer);
        }
      }
      debugLog(`Fetched ${eftTransferIds.length} EFT transfer(s)`);
    }

    // Fetch extended order data for buy/sell transactions
    // Managed orders use fetchActivityByOrdersServiceOrderId, DIY orders use fetchExtendedOrder, crypto orders use fetchCryptoOrder
    const { managedOrders, diyOrderIds, cryptoOrderIds } = buySellOrderIds;
    const totalOrderCount = managedOrders.length + diyOrderIds.length + cryptoOrderIds.length;

    if (totalOrderCount > 0) {
      debugLog(`Fetching order details: ${managedOrders.length} managed, ${diyOrderIds.length} DIY, ${cryptoOrderIds.length} crypto order(s)...`);
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
          enrichmentMap.set(orderId, { ...activityData, isManagedOrderData: true });
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
          enrichmentMap.set(orderId, { ...cryptoOrder, isCryptoOrderData: true });
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

        // Update progress callback for UI
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

        // Update progress callback for UI
        if (onProgress) {
          onProgress(`Option expiries (${progressNum}/${shortOptionExpiryIds.length})`);
        }

        const expiryDetail = await wealthsimpleApi.fetchShortOptionPositionExpiryDetail(expiryId);
        if (expiryDetail) {
          // Fetch security names for deliverables
          const securityCache = new Map();
          // Static security IDs that don't need to be fetched (cash currencies)
          const STATIC_SECURITY_IDS = new Set(['sec-s-cad', 'sec-s-usd']);
          if (expiryDetail.deliverables && Array.isArray(expiryDetail.deliverables)) {
            for (const deliverable of expiryDetail.deliverables) {
              const secId = deliverable.securityId;
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
    const processedTransactions = [];

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
          const finalAmount = isNegative ? -Math.abs(rawTransaction.amount) : Math.abs(rawTransaction.amount);

          let isPending;
          if (usesUnifiedStatus(rawTransaction)) {
            isPending = rawTransaction.unifiedStatus === 'IN_PROGRESS' || rawTransaction.unifiedStatus === 'PENDING';
          } else {
            isPending = rawTransaction.status === 'authorized';
          }

          const transactionId = getTransactionId(rawTransaction);

          const skippedTransaction = {
            id: transactionId,
            date: convertToLocalDate(rawTransaction.occurredAt),
            merchant: formatOriginalStatement(rawTransaction.type, rawTransaction.subType, rawTransaction.assetSymbol || 'Unknown'),
            originalMerchant: formatOriginalStatement(rawTransaction.type, rawTransaction.subType, rawTransaction.assetSymbol || 'Unknown'),
            amount: finalAmount,
            type: rawTransaction.type,
            subType: rawTransaction.subType,
            status: rawTransaction.status,
            unifiedStatus: rawTransaction.unifiedStatus,
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
          const manualResult = await new Promise((resolve) => {
            showManualTransactionCategorization(rawTransaction, resolve);
          });

          if (!manualResult) {
            // User cancelled - abort the upload
            throw new Error(`Manual categorization cancelled for transaction ${rawTransaction.externalCanonicalId}. Upload aborted.`);
          }

          // Determine amount sign
          const isNegative = rawTransaction.amountSign === 'negative';
          const finalAmount = isNegative ? -Math.abs(rawTransaction.amount) : Math.abs(rawTransaction.amount);

          // Determine pending status based on transaction type
          // Most investment transactions use unifiedStatus; only INTERNAL_TRANSFER uses status
          let isPending;
          if (usesUnifiedStatus(rawTransaction)) {
            isPending = rawTransaction.unifiedStatus === 'IN_PROGRESS' || rawTransaction.unifiedStatus === 'PENDING';
          } else {
            isPending = rawTransaction.status === 'authorized';
          }

          // Get transaction ID (handles null externalCanonicalId)
          const transactionId = getTransactionId(rawTransaction);

          // Create processed transaction with user-provided data
          const manuallyProcessed = {
            id: transactionId,
            date: convertToLocalDate(rawTransaction.occurredAt),
            merchant: manualResult.merchant,
            originalMerchant: formatOriginalStatement(rawTransaction.type, rawTransaction.subType, manualResult.merchant),
            amount: finalAmount,
            type: rawTransaction.type,
            subType: rawTransaction.subType,
            status: rawTransaction.status,
            unifiedStatus: rawTransaction.unifiedStatus,
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
  } catch (error) {
    debugLog('Error fetching and processing investment transactions:', error);
    throw error;
  }
}
