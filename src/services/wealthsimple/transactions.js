/**
 * Wealthsimple Transaction Service
 * Handles transaction fetching, filtering, and processing for different account types
 *
 * This is the main entry point that re-exports all transaction functions.
 * Processing is split across files:
 * - transactionsHelpers.js: Shared utility functions
 * - transactionsInvestment.js: Investment account processing
 * - transactionsReconciliation.js: Pending transaction reconciliation
 * - transactions.js (this file): Credit card, cash, LOC processing + routing
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

// Import from sub-modules (used locally and re-exported)
import {
  collectEftTransferIds,
  convertToLocalDate,
  processCreditCardTransaction,
  filterSyncableTransactions,
  getAutoMappingForSubType,
  resolveCategoriesForTransactions,
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

/**
 * Fetch and process transactions for a credit card account
 *
 * Optimized flow:
 * 1. Fetch raw transactions (if not provided)
 * 2. Filter by status (settled + optionally authorized/pending)
 * 3. Filter out already-uploaded settled transactions (keep pending for reconciliation)
 * 4. Process transactions (merchant cleanup, amount conversion)
 * 5. Resolve categories (with potential user prompts)
 *
 * @param {Object} consolidatedAccount - Consolidated account object
 * @param {string} fromDate - Start date (YYYY-MM-DD)
 * @param {string} toDate - End date (YYYY-MM-DD)
 * @param {Object} options - Processing options
 * @param {Array} options.rawTransactions - Pre-fetched raw transactions (optional, will fetch if not provided)
 * @param {Set<string>} options.uploadedTransactionIds - Set of already-uploaded transaction IDs to skip
 * @returns {Promise<Array>} Processed transactions ready for upload
 */
export async function fetchAndProcessCreditCardTransactions(consolidatedAccount, fromDate, toDate, options = {}) {
  try {
    const accountId = consolidatedAccount.wealthsimpleAccount.id;
    const accountName = consolidatedAccount.wealthsimpleAccount.nickname;
    const stripStoreNumbers = consolidatedAccount.stripStoreNumbers !== false; // Default true
    const { rawTransactions: providedTransactions, uploadedTransactionIds = new Set() } = options;

    // Get pending transactions setting (default true)
    const includePendingTransactions = consolidatedAccount.includePendingTransactions !== false;

    debugLog(`Processing credit card transactions for ${accountName} from ${fromDate} to ${toDate}`);
    debugLog(`Store number stripping: ${stripStoreNumbers ? 'enabled' : 'disabled'}`);
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

    // Step 2: Filter for syncable transactions (settled + optionally authorized/pending)
    const syncableTransactions = filterSyncableTransactions(rawTransactions, includePendingTransactions);
    debugLog(`Filtered to ${syncableTransactions.length} syncable transactions (includePending: ${includePendingTransactions})`);

    if (syncableTransactions.length === 0) {
      return [];
    }

    // Step 3: Filter out already-uploaded settled transactions
    // Keep pending transactions (authorized) - they may need to be re-processed if status changed
    const notYetUploadedTransactions = syncableTransactions.filter((tx) => {
      const isSettled = tx.status === 'settled';
      const isAlreadyUploaded = uploadedTransactionIds.has(tx.externalCanonicalId);

      // Skip only settled transactions that are already uploaded
      if (isSettled && isAlreadyUploaded) {
        return false;
      }
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

    // Step 4: Fetch spend details for PURCHASE transactions (foreign currency and reward info)
    const purchaseTransactionIds = collectCreditCardPurchaseIds(notYetUploadedTransactions);
    let spendDetailsMap = new Map();

    if (purchaseTransactionIds.length > 0) {
      debugLog(`Fetching spend transaction details for ${purchaseTransactionIds.length} PURCHASE transaction(s)...`);
      spendDetailsMap = await wealthsimpleApi.fetchSpendTransactions(accountId, purchaseTransactionIds);
      debugLog(`Fetched ${spendDetailsMap.size} spend transaction detail(s)`);
    }

    // Step 5: Process transactions with stripStoreNumbers option and spend details
    const processedTransactions = notYetUploadedTransactions.map((transaction) =>
      processCreditCardTransaction(transaction, { stripStoreNumbers, spendDetailsMap }),
    );

    debugLog(`Processed ${processedTransactions.length} credit card transactions`);

    // Step 6: Resolve categories (will prompt user for unknown merchants)
    // skipCategorization can be forced via options (e.g., balance reconstruction) or set per-account
    const skipCategorization = options.skipCategorization === true || consolidatedAccount.skipCategorization === true;
    const transactionsWithCategories = await resolveCategoriesForTransactions(processedTransactions, { skipCategorization });

    debugLog(`Category resolution complete, returning ${transactionsWithCategories.length} transactions (${uploadedSkipCount} already uploaded)`);

    return transactionsWithCategories;
  } catch (error) {
    debugLog('Error fetching and processing credit card transactions:', error);
    throw error;
  }
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
 * Check if a transaction is an ATM fee reimbursement
 * These transactions may have null status fields but should always be synced
 * @param {Object} transaction - Raw transaction from API
 * @returns {boolean} True if ATM fee reimbursement
 */
function isAtmReimbursementTransaction(transaction) {
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
 *
 * @param {Array} transactions - Raw transactions from API
 * @param {boolean} includePending - Whether to include pending transactions
 * @returns {Array} Filtered transactions ready for processing
 */
function filterCashSyncableTransactions(transactions, includePending = true) {
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
    const status = transaction.unifiedStatus;
    if (status === 'COMPLETED') return true;
    if (includePending && (status === 'IN_PROGRESS' || status === 'PENDING')) return true;
    return false;
  });
}

/**
 * Process a CASH account transaction using the rules engine
 * @param {Object} transaction - Raw transaction from Wealthsimple API
 * @param {Map<string, Object>} fundingIntentMap - Optional map of funding intent ID to details
 * @returns {Object} Processed transaction object (may include needsManualCategorization flag)
 */
function processCashTransaction(transaction, fundingIntentMap = null) {
  // Apply the matching rule from the rules engine
  const ruleResult = applyTransactionRule(transaction, fundingIntentMap);

  // Determine amount sign (based on amountSign field, NOT inverted like credit cards)
  const isNegative = transaction.amountSign === 'negative';
  const finalAmount = isNegative ? -Math.abs(transaction.amount) : Math.abs(transaction.amount);

  // Get a unique transaction ID (handles null externalCanonicalId)
  const transactionId = getTransactionId(transaction);

  if (!ruleResult) {
    // No rule matched - return transaction needing manual categorization
    debugLog(`CASH transaction ${transactionId} needs manual categorization - no matching rule`, {
      type: transaction.type,
      subType: transaction.subType,
    });

    // Determine pending status - SPEND/PREPAID uses 'status', others use 'unifiedStatus'
    const isPending = transaction.unifiedStatus === 'IN_PROGRESS' || transaction.unifiedStatus === 'PENDING';

    return {
      id: transactionId,
      date: convertToLocalDate(transaction.occurredAt),
      merchant: null, // Will be set by user
      originalMerchant: null,
      amount: finalAmount,
      type: transaction.type,
      subType: transaction.subType,
      status: transaction.status,
      unifiedStatus: transaction.unifiedStatus,
      isPending,
      resolvedMonarchCategory: null, // Will be set by user
      ruleId: null,
      notes: '',
      technicalDetails: '',
      // Flag for manual categorization
      needsManualCategorization: true,
      // Store the raw transaction for display to user
      rawTransaction: transaction,
    };
  }

  // Determine pending status - SPEND/PREPAID uses 'status', others use 'unifiedStatus'
  let isPending;
  if (isSpendPrepaidTransaction(transaction)) {
    // SPEND/PREPAID uses credit card-style status field
    isPending = transaction.status === 'authorized';
  } else {
    // Regular CASH transactions use unifiedStatus
    isPending = transaction.unifiedStatus === 'IN_PROGRESS' || transaction.unifiedStatus === 'PENDING';
  }

  return {
    id: transactionId,
    date: convertToLocalDate(transaction.occurredAt),
    merchant: ruleResult.merchant,
    originalMerchant: ruleResult.originalStatement,
    amount: finalAmount,
    type: transaction.type,
    subType: transaction.subType,
    status: transaction.status, // For SPEND/PREPAID reconciliation
    unifiedStatus: transaction.unifiedStatus, // For regular CASH reconciliation
    isPending,
    // Category comes from the rule (auto-assigned), or null if needs mapping
    resolvedMonarchCategory: ruleResult.category,
    // Rule metadata for debugging
    ruleId: ruleResult.ruleId,
    // Notes from rule - memo only (e.g., Interac memo)
    notes: ruleResult.notes || '',
    // Technical details from rule (e.g., auto-deposit status, reference number)
    technicalDetails: ruleResult.technicalDetails || '',
    // Category mapping flags for SPEND/PREPAID and AFT transactions
    needsCategoryMapping: ruleResult.needsCategoryMapping || false,
    categoryKey: ruleResult.categoryKey || ruleResult.merchant,
    // AFT details for category selector display (if available)
    aftDetails: ruleResult.aftDetails || null,
  };
}

/**
 * Collect e-transfer IDs from transactions that need funding intent enrichment
 * Returns only externalCanonicalIds from E_TRANSFER transactions
 *
 * @param {Array} transactions - Raw transactions from Wealthsimple API
 * @returns {Array<string>} Array of e-transfer funding intent IDs
 */
function collectETransferIds(transactions) {
  const eTransferIds = [];

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
 * Returns only externalCanonicalIds from INTERNAL_TRANSFER transactions
 *
 * @param {Array} transactions - Raw transactions from Wealthsimple API
 * @returns {Array<string>} Array of internal transfer IDs
 */
function collectInternalTransferIds(transactions) {
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
 * Collect SPEND transaction IDs from transactions that need spend details enrichment
 * For CASH accounts: type=SPEND transactions
 * For CREDIT_CARD accounts: subType=PURCHASE transactions
 *
 * @param {Array} transactions - Raw transactions from Wealthsimple API
 * @param {string} idField - Field to use for ID ('externalCanonicalId' or other)
 * @returns {Array<string>} Array of spend transaction IDs
 */
function collectSpendTransactionIds(transactions, idField = 'externalCanonicalId') {
  const spendIds = [];

  for (const tx of transactions) {
    // CASH accounts: type=SPEND transactions
    if (tx.type === 'SPEND' && tx[idField]) {
      // For spend transactions, the ID is a numeric string
      // Extract just the numeric part for the API call
      const id = tx[idField];
      // The spend API uses simple numeric IDs like "549257972"
      // Extract from externalCanonicalId format if needed
      if (id && !spendIds.includes(id)) {
        spendIds.push(id);
      }
    }
  }

  return spendIds;
}

/**
 * Collect PURCHASE transaction IDs from credit card transactions that need spend details enrichment
 * For CREDIT_CARD accounts: subType=PURCHASE transactions
 *
 * @param {Array} transactions - Raw transactions from Wealthsimple API
 * @returns {Array<string>} Array of spend transaction IDs (using full externalCanonicalId)
 */
function collectCreditCardPurchaseIds(transactions) {
  const purchaseIds = [];

  for (const tx of transactions) {
    // CREDIT_CARD accounts: subType=PURCHASE transactions
    if (tx.subType === 'PURCHASE' && tx.externalCanonicalId) {
      purchaseIds.push(tx.externalCanonicalId);
    }
  }

  return purchaseIds;
}

/**
 * Fetch and process transactions for a CASH account
 * Uses the transaction rules engine to categorize and format transactions
 * Fetches funding intent data to enrich e-transfer transactions with memos
 *
 * Optimized flow:
 * 1. Fetch raw transactions (if not provided)
 * 2. Filter by status (COMPLETED, IN_PROGRESS, PENDING)
 * 3. Filter out already-uploaded COMPLETED transactions (keep pending for reconciliation)
 * 4. Filter by rules engine match (only process supported transaction types)
 * 5. Fetch funding intents only for transactions that will be processed
 * 6. Process transactions through rules engine
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
export async function fetchAndProcessCashTransactions(consolidatedAccount, fromDate, toDate, options = {}) {
  try {
    const accountId = consolidatedAccount.wealthsimpleAccount.id;
    const accountName = consolidatedAccount.wealthsimpleAccount.nickname;
    const { rawTransactions: providedTransactions, uploadedTransactionIds = new Set(), onProgress } = options;

    // Get pending transactions setting (default true)
    const includePendingTransactions = consolidatedAccount.includePendingTransactions !== false;

    debugLog(`Processing CASH transactions for ${accountName} from ${fromDate} to ${toDate}`);
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

    // Step 2: Filter for syncable transactions based on unifiedStatus
    const syncableTransactions = filterCashSyncableTransactions(rawTransactions, includePendingTransactions);
    debugLog(`Filtered to ${syncableTransactions.length} syncable transactions (includePending: ${includePendingTransactions})`);

    if (syncableTransactions.length === 0) {
      return [];
    }

    // Step 3: Filter out already-uploaded COMPLETED transactions
    // Keep pending transactions (IN_PROGRESS/PENDING) - they may need to be re-processed if status changed
    const notYetUploadedTransactions = syncableTransactions.filter((tx) => {
      const isCompleted = tx.unifiedStatus === 'COMPLETED';
      const isAlreadyUploaded = uploadedTransactionIds.has(tx.externalCanonicalId);

      // Skip only COMPLETED transactions that are already uploaded
      if (isCompleted && isAlreadyUploaded) {
        return false;
      }
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

    // Step 4: Separate transactions with/without rules
    // Transactions with rules get funding intent enrichment, those without need manual categorization
    const transactionsWithRules = [];
    const transactionsWithoutRules = [];

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

    // Step 5: Collect IDs for enrichment data
    // - E-transfers need funding intent data for memos
    // - Internal transfers need internal transfer data for annotations
    // - EFT transfers need funds transfer data for bank account details
    // - SPEND transactions need spend details for foreign currency and reward info
    const eTransferIds = collectETransferIds(transactionsWithRules);
    const internalTransferIds = collectInternalTransferIds(transactionsWithRules);
    const eftTransferIds = collectEftTransferIds(transactionsWithRules);
    const spendTransactionIds = collectSpendTransactionIds(transactionsWithRules);

    // Create a combined enrichment map for the rules engine
    // The rules engine expects a single map that can contain funding intents, internal transfers, funds transfers, and spend details
    const enrichmentMap = new Map();

    // Fetch funding intent data for e-transfers (batch API - single call)
    if (eTransferIds.length > 0) {
      debugLog(`Fetching ${eTransferIds.length} funding intent(s) for e-transfer memos...`);
      const fundingIntentMap = await wealthsimpleApi.fetchFundingIntents(eTransferIds);
      debugLog(`Fetched ${fundingIntentMap.size} funding intent(s)`);

      // Add to combined map
      for (const [id, data] of fundingIntentMap) {
        enrichmentMap.set(id, data);
      }
    }

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

    // Fetch spend transaction details for foreign currency and reward info (batch API - single call)
    if (spendTransactionIds.length > 0) {
      debugLog(`Fetching spend transaction details for ${spendTransactionIds.length} transaction(s)...`);
      const spendDetailsMap = await wealthsimpleApi.fetchSpendTransactions(accountId, spendTransactionIds);
      debugLog(`Fetched ${spendDetailsMap.size} spend transaction detail(s)`);

      // Add spend details to enrichment map with a prefix to distinguish them
      for (const [id, data] of spendDetailsMap) {
        enrichmentMap.set(`spend:${id}`, data);
      }
    }

    debugLog(`Combined enrichment map has ${enrichmentMap.size} entries`);

    // Step 6: Process transactions through the rules engine
    const processedTransactions = [];

    for (const transaction of transactionsWithRules) {
      const processed = processCashTransaction(transaction, enrichmentMap);
      if (processed) {
        processedTransactions.push(processed);
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
        debugLog(`Skip categorization enabled - auto-assigning ${transactionsWithoutRules.length} transactions without rules`);
        for (const rawTransaction of transactionsWithoutRules) {
          const isNegative = rawTransaction.amountSign === 'negative';
          const finalAmount = isNegative ? -Math.abs(rawTransaction.amount) : Math.abs(rawTransaction.amount);
          const isPending = rawTransaction.unifiedStatus === 'IN_PROGRESS' || rawTransaction.unifiedStatus === 'PENDING';

          const skippedTransaction = {
            id: rawTransaction.externalCanonicalId,
            date: convertToLocalDate(rawTransaction.occurredAt),
            merchant: formatOriginalStatement(rawTransaction.type, rawTransaction.subType, rawTransaction.spendMerchant || 'Unknown'),
            originalMerchant: formatOriginalStatement(rawTransaction.type, rawTransaction.subType, rawTransaction.spendMerchant || 'Unknown'),
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

          // Determine pending status
          const isPending = rawTransaction.unifiedStatus === 'IN_PROGRESS' || rawTransaction.unifiedStatus === 'PENDING';

          // Create processed transaction with user-provided data
          const manuallyProcessed = {
            id: rawTransaction.externalCanonicalId,
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
            ruleId: 'manual', // Indicate it was manually categorized
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

    // Step 8: Check if any transactions need category resolution (e.g., SPEND/PREPAID)
    const transactionsNeedingCategoryMapping = processedTransactions.filter((tx) => tx.needsCategoryMapping);

    if (transactionsNeedingCategoryMapping.length > 0) {
      debugLog(`${transactionsNeedingCategoryMapping.length} transactions need category mapping (SPEND/PREPAID)`);
      // Run category resolution for transactions that need it
      const resolvedTransactions = await resolveCategoriesForTransactions(processedTransactions, { skipCategorization });
      return resolvedTransactions;
    }

    return processedTransactions;
  } catch (error) {
    debugLog('Error fetching and processing CASH transactions:', error);
    throw error;
  }
}

/**
 * Placeholder for loan account transaction processing
 * @param {Object} consolidatedAccount - Consolidated account object
 * @param {string} fromDate - Start date (YYYY-MM-DD)
 * @param {string} toDate - End date (YYYY-MM-DD)
 * @returns {Promise<Array>} Processed transactions
 */
export async function fetchAndProcessLoanTransactions(consolidatedAccount, fromDate, toDate) {
  debugLog('Loan account transaction processing not yet implemented', {
    accountId: consolidatedAccount.wealthsimpleAccount.id,
    fromDate,
    toDate,
  });

  // TODO: Implement loan account transaction logic
  // Will need different filtering and categorization rules

  return [];
}

/**
 * Apply Line of Credit transaction rules
 * Rules for classifying LOC transactions:
 * - INTERNAL_TRANSFER/SOURCE (borrow): "Borrow from {accountName}" → Transfer
 * - INTERNAL_TRANSFER/DESTINATION (repay): "Repayment to {accountName}" → Loan Repayment
 *
 * @param {Object} transaction - Raw transaction from Wealthsimple API
 * @param {string} accountName - Name of the LOC account
 * @returns {Object|null} Processed transaction object, or null if no rule matches
 */
function applyLineOfCreditRule(transaction, accountName) {
  const { type, subType } = transaction;

  // INTERNAL_TRANSFER/SOURCE = borrowing from the LOC
  if (type === 'INTERNAL_TRANSFER' && subType === 'SOURCE') {
    const statementText = `Borrow from ${accountName}`;
    return {
      merchant: statementText,
      originalStatement: formatOriginalStatement(type, subType, statementText),
      category: 'Transfer',
      ruleId: 'loc-borrow',
    };
  }

  // INTERNAL_TRANSFER/DESTINATION = repayment to the LOC
  if (type === 'INTERNAL_TRANSFER' && subType === 'DESTINATION') {
    const statementText = `Repayment to ${accountName}`;
    return {
      merchant: statementText,
      originalStatement: formatOriginalStatement(type, subType, statementText),
      category: 'Loan Repayment',
      ruleId: 'loc-repay',
    };
  }

  // No rule matched
  return null;
}

/**
 * Fetch and process transactions for a Portfolio Line of Credit account
 * Uses automatic classification rules for known transaction types:
 * - Borrow (INTERNAL_TRANSFER/SOURCE) → "Transfer" category
 * - Repayment (INTERNAL_TRANSFER/DESTINATION) → "Loan Repayment" category
 * Falls back to manual categorization for unrecognized transaction types.
 *
 * @param {Object} consolidatedAccount - Consolidated account object
 * @param {string} fromDate - Start date (YYYY-MM-DD)
 * @param {string} toDate - End date (YYYY-MM-DD)
 * @param {Object} options - Processing options
 * @param {Array} options.rawTransactions - Pre-fetched raw transactions (optional, will fetch if not provided)
 * @param {Set<string>} options.uploadedTransactionIds - Set of already-uploaded transaction IDs to skip
 * @returns {Promise<Array>} Processed transactions ready for upload
 */
export async function fetchAndProcessLineOfCreditTransactions(consolidatedAccount, fromDate, toDate, options = {}) {
  try {
    const accountId = consolidatedAccount.wealthsimpleAccount.id;
    const accountName = consolidatedAccount.wealthsimpleAccount.nickname;
    const { rawTransactions: providedTransactions, uploadedTransactionIds = new Set() } = options;

    // Get pending transactions setting (default true)
    const includePendingTransactions = consolidatedAccount.includePendingTransactions !== false;

    debugLog(`Processing Line of Credit transactions for ${accountName} from ${fromDate} to ${toDate}`);
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
    debugLog('Line of Credit raw transactions (before filtering):');
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
      });
    });

    // Step 2: Filter for syncable transactions (settled/completed + optionally authorized)
    const syncableTransactions = filterSyncableTransactions(rawTransactions, includePendingTransactions);
    debugLog(`Filtered to ${syncableTransactions.length} syncable transactions (includePending: ${includePendingTransactions})`);

    if (syncableTransactions.length === 0) {
      return [];
    }

    // Step 3: Filter out already-uploaded completed transactions
    const notYetUploadedTransactions = syncableTransactions.filter((tx) => {
      const isCompleted = tx.status === 'settled' || tx.status === 'completed';
      const isAlreadyUploaded = uploadedTransactionIds.has(tx.externalCanonicalId);

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

    // Step 4: Separate transactions with rules from those needing manual categorization
    const transactionsWithRules = [];
    const transactionsWithoutRules = [];

    notYetUploadedTransactions.forEach((tx) => {
      const ruleResult = applyLineOfCreditRule(tx, accountName);
      if (ruleResult) {
        transactionsWithRules.push({ raw: tx, rule: ruleResult });
      } else {
        transactionsWithoutRules.push(tx);
      }
    });

    debugLog(`Transactions: ${transactionsWithRules.length} with rules, ${transactionsWithoutRules.length} need manual categorization`);

    const processedTransactions = [];

    // Step 5: Process transactions with matching rules
    for (const { raw: rawTransaction, rule: ruleResult } of transactionsWithRules) {
      // Determine amount sign
      const isNegative = rawTransaction.amountSign === 'negative';
      const finalAmount = isNegative ? -Math.abs(rawTransaction.amount) : Math.abs(rawTransaction.amount);

      // Determine pending status
      const isPending = rawTransaction.status === 'authorized';

      const processed = {
        id: rawTransaction.externalCanonicalId,
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

    // Read skip categorization setting
    // skipCategorization can be forced via options (e.g., balance reconstruction) or set per-account
    const skipCategorization = options.skipCategorization === true || consolidatedAccount.skipCategorization === true;

    // Step 6: Handle transactions without rules - show manual categorization UI
    if (transactionsWithoutRules.length > 0) {
      if (skipCategorization) {
        // Skip manual categorization - assign Uncategorized for Monarch
        debugLog(`Skip categorization enabled - auto-assigning ${transactionsWithoutRules.length} LOC transactions without rules`);
        for (const rawTransaction of transactionsWithoutRules) {
          const isNegative = rawTransaction.amountSign === 'negative';
          const finalAmount = isNegative ? -Math.abs(rawTransaction.amount) : Math.abs(rawTransaction.amount);
          const isPending = rawTransaction.status === 'authorized';

          const skippedTransaction = {
            id: rawTransaction.externalCanonicalId,
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

          // Determine pending status
          const isPending = rawTransaction.status === 'authorized';

          // Create processed transaction with user-provided data
          const manuallyProcessed = {
            id: rawTransaction.externalCanonicalId,
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
  } catch (error) {
    debugLog('Error fetching and processing Line of Credit transactions:', error);
    throw error;
  }
}

export async function fetchAndProcessTransactions(consolidatedAccount, fromDate, toDate, options = {}) {
  const accountType = consolidatedAccount.wealthsimpleAccount.type;

  debugLog(`Processing transactions for account type: ${accountType}`);

  // Route CASH and CASH_USD accounts to the CASH transaction processor
  // These accounts have different transaction structure (unifiedStatus, type/subType rules)
  if (accountType === 'CASH' || accountType === 'CASH_USD') {
    return fetchAndProcessCashTransactions(consolidatedAccount, fromDate, toDate, options);
  }

  // Route credit card accounts to credit card processor
  if (accountType === 'CREDIT_CARD') {
    return fetchAndProcessCreditCardTransactions(consolidatedAccount, fromDate, toDate, options);
  }

  // Route Portfolio Line of Credit to dedicated processor
  // Uses manual categorization for all transactions until rules are established
  if (accountType === 'PORTFOLIO_LINE_OF_CREDIT') {
    return fetchAndProcessLineOfCreditTransactions(consolidatedAccount, fromDate, toDate, options);
  }

  // Default to investment account processing for all other types
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
