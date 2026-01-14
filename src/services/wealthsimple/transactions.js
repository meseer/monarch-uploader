/**
 * Wealthsimple Transaction Service
 * Handles transaction fetching, filtering, and processing for different account types
 */

import { debugLog, formatDate } from '../../core/utils';
import wealthsimpleApi from '../../api/wealthsimple';
import { applyMerchantMapping } from '../../mappers/merchant';
import { applyWealthsimpleCategoryMapping, saveUserWealthsimpleCategorySelection, calculateAllCategorySimilarities } from '../../mappers/category';
import { showMonarchCategorySelector, showManualTransactionCategorization } from '../../ui/components/categorySelector';
import monarchApi from '../../api/monarch';
import toast from '../../ui/toast';
import { applyTransactionRule, CASH_TRANSACTION_RULES } from './transactionRules';

/**
 * Convert ISO timestamp to local date in YYYY-MM-DD format
 * @param {string} isoTimestamp - ISO timestamp (e.g., "2025-12-31T21:39:22.000000+00:00")
 * @returns {string} Local date in YYYY-MM-DD format
 */
function convertToLocalDate(isoTimestamp) {
  if (!isoTimestamp) return '';

  const date = new Date(isoTimestamp);
  return formatDate(date);
}

/**
 * Process credit card transaction to extract relevant data
 * @param {Object} transaction - Raw transaction from Wealthsimple API
 * @param {Object} options - Processing options
 * @param {boolean} options.stripStoreNumbers - Whether to strip store numbers from merchant names
 * @returns {Object} Processed transaction object
 */
function processCreditCardTransaction(transaction, options = {}) {
  const { stripStoreNumbers = true } = options;

  // Check for auto-mapping first
  const autoMapping = getAutoMappingForSubType(transaction.subType);

  // Determine merchant name based on subType or auto-mapping
  let merchantName;
  if (autoMapping && autoMapping.merchant) {
    merchantName = autoMapping.merchant;
  } else if (transaction.subType === 'PAYMENT') {
    merchantName = 'Credit Card Payment';
  } else {
    merchantName = transaction.spendMerchant || 'Unknown Merchant';
  }

  // Apply merchant cleanup with store number stripping option
  const cleanedMerchant = applyMerchantMapping(merchantName, { stripStoreNumbers });

  // Determine amount sign (negative means debit/expense, positive means credit/payment)
  const isNegative = transaction.amountSign === 'negative';
  const finalAmount = isNegative ? -Math.abs(transaction.amount) : Math.abs(transaction.amount);

  return {
    id: transaction.externalCanonicalId,
    date: convertToLocalDate(transaction.occurredAt),
    merchant: cleanedMerchant,
    originalMerchant: merchantName,
    amount: finalAmount,
    type: transaction.type,
    subType: transaction.subType,
    status: transaction.status,
    // Store for category resolution
    categoryKey: cleanedMerchant,
  };
}

/**
 * Filter transactions for syncing
 * Note: Transaction type filtering is not needed here since transactions are fetched per account.
 * Each account's transactions will already be of the correct type.
 * @param {Array} transactions - Raw transactions from API
 * @param {boolean} includePending - Whether to include pending (authorized) transactions
 * @returns {Array} Filtered transactions (settled/completed, and optionally authorized)
 */
function filterSyncableTransactions(transactions, includePending = true) {
  return transactions.filter((transaction) => {
    // Accept both 'settled' (credit cards) and 'completed' (LOC, some CASH) as terminal success states
    if (transaction.status === 'settled' || transaction.status === 'completed') return true;
    if (includePending && transaction.status === 'authorized') return true;
    return false;
  });
}

/**
 * Get auto-category and merchant for specific transaction subtypes
 * @param {string} subType - Transaction subtype
 * @returns {Object|null} Object with category and optionally merchant, or null if should use mapping
 */
function getAutoMappingForSubType(subType) {
  switch (subType) {
  case 'PAYMENT':
    return { category: 'Credit Card Payment' };
  case 'CASH_WITHDRAWAL':
    return { category: 'Cash & ATM' };
  case 'INTEREST':
    return { category: 'Financial Fees', merchant: 'Cash Advance Interest' };
  default:
    return null; // Use merchant-based category mapping
  }
}

/**
 * Resolve categories for transactions, handling both automatic and manual selection
 * Uses dynamic category mapping - after each user selection, re-checks remaining categories
 * to avoid duplicate prompts
 *
 * Assignment types:
 * - 'rule': Save to persistent storage AND apply to all matching merchants in batch
 * - 'once': Apply ONLY to the specific transaction (not to other matching merchants)
 *
 * @param {Array} transactions - Array of processed transactions
 * @param {Object} options - Options for category resolution
 * @param {Function} options.onProgress - Callback for progress updates (optional)
 * @returns {Promise<Array>} Transactions with resolved Monarch categories
 */
async function resolveCategoriesForTransactions(transactions, options = {}) {
  const { onProgress } = options;
  if (!transactions || transactions.length === 0) {
    return transactions;
  }

  debugLog('Starting category resolution for Wealthsimple transactions');

  // Session mappings for 'rule' assignments (apply to all matching merchants in batch)
  // These are saved to persistent storage AND used for all matching merchants
  const sessionMappings = new Map();

  // One-time assignments for 'once' assignments (apply only to specific transaction)
  // Key: transaction ID, Value: category name
  const oneTimeAssignments = new Map();

  // Fetch categories from Monarch for similarity scoring
  let availableCategories = [];
  try {
    debugLog('Fetching categories from Monarch for similarity scoring');
    const categoryData = await monarchApi.getCategoriesAndGroups();
    availableCategories = categoryData.categories || [];
    debugLog(`Fetched ${availableCategories.length} categories from Monarch`);
  } catch (error) {
    debugLog('Failed to fetch categories from Monarch, will use manual selection for all:', error);
  }

  // Auto-categorize transactions with specific subTypes
  transactions.forEach((transaction) => {
    const autoMapping = getAutoMappingForSubType(transaction.subType);
    if (autoMapping && autoMapping.category) {
      transaction.resolvedMonarchCategory = autoMapping.category;
    }
  });

  // Get list of categories that need resolution (not auto-categorized)
  // Build a map of categoryKey -> transactions that need this category
  const categoriesToResolve = [];
  const uniqueCategories = new Map(); // categoryKey -> first transaction with that key
  const transactionsByCategoryKey = new Map(); // categoryKey -> array of transaction IDs

  transactions.forEach((transaction) => {
    // Skip if already auto-categorized
    if (transaction.resolvedMonarchCategory) {
      return;
    }

    const categoryKey = transaction.categoryKey;
    const upperCategoryKey = categoryKey ? categoryKey.toUpperCase() : '';

    // Track all transactions that need this category
    if (!transactionsByCategoryKey.has(upperCategoryKey)) {
      transactionsByCategoryKey.set(upperCategoryKey, []);
    }
    transactionsByCategoryKey.get(upperCategoryKey).push(transaction.id);

    if (!uniqueCategories.has(categoryKey)) {
      uniqueCategories.set(categoryKey, transaction);

      // Test the category mapping using Wealthsimple-specific function
      const mappingResult = applyWealthsimpleCategoryMapping(categoryKey, availableCategories);

      if (mappingResult && typeof mappingResult === 'object' && mappingResult.needsManualSelection) {
        categoriesToResolve.push({
          ...mappingResult,
          exampleTransaction: transaction,
        });
      }
    }
  });

  debugLog(`Found ${uniqueCategories.size} unique merchants, ${categoriesToResolve.length} need manual selection`);

  // Handle categories that need manual selection with dynamic re-checking
  if (categoriesToResolve.length > 0) {
    const totalCategories = categoriesToResolve.length;
    toast.show(`Resolving ${totalCategories} categories that need manual selection...`, 'debug');

    // Report initial progress
    if (onProgress) {
      onProgress(`Resolving categories (0/${totalCategories})`);
    }

    // Process categories until all are resolved
    // Always process the first element and remove it when done
    let resolvedCount = 0;
    while (categoriesToResolve.length > 0) {
      const categoryToResolve = categoriesToResolve[0];

      // Re-check if this category still needs manual selection
      // (it might have been automatically mapped after a previous selection)
      const recheckResult = applyWealthsimpleCategoryMapping(categoryToResolve.bankCategory, availableCategories);

      if (typeof recheckResult === 'string') {
        // Category is now automatically mapped, skip it
        debugLog(`Category "${categoryToResolve.bankCategory}" now has automatic mapping: ${recheckResult}`);
        categoriesToResolve.shift(); // Remove first element
        resolvedCount += 1;
        if (onProgress) {
          onProgress(`Resolving categories (${resolvedCount}/${totalCategories})`);
        }
        continue;
      }

      // Still needs manual selection
      const remainingCount = categoriesToResolve.length;
      const progressNum = totalCategories - remainingCount + 1;

      debugLog(`Showing category selector for: ${categoryToResolve.bankCategory} (${progressNum}/${totalCategories})`);

      toast.show(`Selecting category ${progressNum} of ${totalCategories}: "${categoryToResolve.bankCategory}"`, 'debug');

      // Calculate similarity data
      const similarityData = calculateAllCategorySimilarities(categoryToResolve.bankCategory, availableCategories);

      // Prepare transaction details for the selector
      const transactionDetails = {};
      if (categoryToResolve.exampleTransaction) {
        const exampleTx = categoryToResolve.exampleTransaction;

        transactionDetails.merchant = exampleTx.merchant;
        transactionDetails.amount = exampleTx.amount;
        transactionDetails.date = exampleTx.date;
        transactionDetails.institution = 'wealthsimple'; // Add institution identifier

        // Pass AFT details if available (for DEPOSIT/AFT transactions)
        if (exampleTx.aftDetails) {
          transactionDetails.aftDetails = exampleTx.aftDetails;
        }

        debugLog('Transaction details for category selector:', transactionDetails);
      }

      // Show the category selector with institution parameter
      const selectedCategory = await new Promise((resolve) => {
        showMonarchCategorySelector(categoryToResolve.bankCategory, resolve, similarityData, transactionDetails);
      });

      if (!selectedCategory) {
        throw new Error(`Category selection cancelled for "${categoryToResolve.bankCategory}". Upload aborted.`);
      }

      const upperBankCategory = categoryToResolve.bankCategory.toUpperCase();

      // Handle based on assignmentType (new two-button UI)
      // For backward compatibility, also check rememberMapping
      const assignmentType = selectedCategory.assignmentType || (selectedCategory.rememberMapping !== false ? 'rule' : 'once');

      if (assignmentType === 'rule') {
        // Save as Rule: persist to storage AND apply to all matching merchants in batch
        saveUserWealthsimpleCategorySelection(categoryToResolve.bankCategory, selectedCategory.name);
        sessionMappings.set(upperBankCategory, selectedCategory.name);
        debugLog(`User selected category mapping (saved as rule): ${categoryToResolve.bankCategory} -> ${selectedCategory.name}`);
        toast.show(`Saved rule: "${categoryToResolve.bankCategory}" → "${selectedCategory.name}"`, 'debug');
      } else {
        // Assign Once: apply ONLY to this specific transaction (not to other matching merchants)
        // Store by transaction ID, not by category key
        const transactionId = categoryToResolve.exampleTransaction?.id;
        if (transactionId) {
          oneTimeAssignments.set(transactionId, selectedCategory.name);
          debugLog(`User selected category mapping (one-time for ${transactionId}): ${categoryToResolve.bankCategory} -> ${selectedCategory.name}`);
        }
        toast.show(`Assigned once: "${categoryToResolve.bankCategory}" → "${selectedCategory.name}"`, 'debug');
      }

      // Remove this category from the list (dynamic re-checking will happen on next iteration)
      categoriesToResolve.shift(); // Remove first element
      resolvedCount += 1;
      if (onProgress) {
        onProgress(`Resolving categories (${resolvedCount}/${totalCategories})`);
      }
    }
  }

  // Now resolve all categories (should all be mapped now)
  const resolvedTransactions = transactions.map((transaction) => {
    // If already resolved (auto-category), skip
    if (transaction.resolvedMonarchCategory) {
      return transaction;
    }

    // First check one-time assignments by transaction ID
    // This takes priority to ensure "Assign Once" truly applies only to this transaction
    if (oneTimeAssignments.has(transaction.id)) {
      return {
        ...transaction,
        resolvedMonarchCategory: oneTimeAssignments.get(transaction.id),
      };
    }

    // Resolve based on merchant
    const categoryKey = transaction.categoryKey;
    const upperCategoryKey = categoryKey ? categoryKey.toUpperCase() : '';

    // Check session mappings (from "Save as Rule" selections in this batch)
    if (sessionMappings.has(upperCategoryKey)) {
      return {
        ...transaction,
        resolvedMonarchCategory: sessionMappings.get(upperCategoryKey),
      };
    }

    // Fall back to persistent storage via Wealthsimple-specific function
    const mappingResult = applyWealthsimpleCategoryMapping(categoryKey, availableCategories);
    const resolvedCategory = typeof mappingResult === 'string' ? mappingResult : 'Uncategorized';

    return {
      ...transaction,
      resolvedMonarchCategory: resolvedCategory,
    };
  });

  debugLog('Category resolution completed for all transactions');
  return resolvedTransactions;
}

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

    // Step 4: Process transactions with stripStoreNumbers option
    const processedTransactions = notYetUploadedTransactions.map((transaction) =>
      processCreditCardTransaction(transaction, { stripStoreNumbers }),
    );

    debugLog(`Processed ${processedTransactions.length} credit card transactions`);

    // Step 5: Resolve categories (will prompt user for unknown merchants)
    const transactionsWithCategories = await resolveCategoriesForTransactions(processedTransactions);

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

  if (!ruleResult) {
    // No rule matched - return transaction needing manual categorization
    debugLog(`CASH transaction ${transaction.externalCanonicalId} needs manual categorization - no matching rule`, {
      type: transaction.type,
      subType: transaction.subType,
    });

    // Determine pending status - SPEND/PREPAID uses 'status', others use 'unifiedStatus'
    const isPending = transaction.unifiedStatus === 'IN_PROGRESS' || transaction.unifiedStatus === 'PENDING';

    return {
      id: transaction.externalCanonicalId,
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
    id: transaction.externalCanonicalId,
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
 * Collect EFT transfer IDs from transactions that need funds transfer enrichment
 * Returns only externalCanonicalIds from EFT transactions (DEPOSIT/EFT and WITHDRAWAL/EFT)
 *
 * @param {Array} transactions - Raw transactions from Wealthsimple API
 * @returns {Array<string>} Array of EFT transfer IDs
 */
function collectEftTransferIds(transactions) {
  const eftTransferIds = [];

  for (const tx of transactions) {
    if (
      tx.subType === 'EFT' &&
      tx.externalCanonicalId &&
      tx.externalCanonicalId.startsWith('funding_intent-')
    ) {
      eftTransferIds.push(tx.externalCanonicalId);
    }
  }

  return eftTransferIds;
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
    const eTransferIds = collectETransferIds(transactionsWithRules);
    const internalTransferIds = collectInternalTransferIds(transactionsWithRules);
    const eftTransferIds = collectEftTransferIds(transactionsWithRules);

    // Create a combined enrichment map for the rules engine
    // The rules engine expects a single map that can contain funding intents, internal transfers, and funds transfers
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

    // Step 7: Handle transactions without rules - show manual categorization UI
    if (transactionsWithoutRules.length > 0) {
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
          originalMerchant: manualResult.merchant, // User-provided merchant
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

    debugLog(`Processed ${processedTransactions.length} total CASH transactions (${uploadedSkipCount} already uploaded)`);

    // Step 8: Check if any transactions need category resolution (e.g., SPEND/PREPAID)
    const transactionsNeedingCategoryMapping = processedTransactions.filter((tx) => tx.needsCategoryMapping);

    if (transactionsNeedingCategoryMapping.length > 0) {
      debugLog(`${transactionsNeedingCategoryMapping.length} transactions need category mapping (SPEND/PREPAID)`);
      // Run category resolution for transactions that need it
      const resolvedTransactions = await resolveCategoriesForTransactions(processedTransactions);
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
    return {
      merchant: `Borrow from ${accountName}`,
      originalStatement: `Borrow from ${accountName}`,
      category: 'Transfer',
      ruleId: 'loc-borrow',
    };
  }

  // INTERNAL_TRANSFER/DESTINATION = repayment to the LOC
  if (type === 'INTERNAL_TRANSFER' && subType === 'DESTINATION') {
    return {
      merchant: `Repayment to ${accountName}`,
      originalStatement: `Repayment to ${accountName}`,
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

    // Step 6: Handle transactions without rules - show manual categorization UI
    if (transactionsWithoutRules.length > 0) {
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
          originalMerchant: manualResult.merchant,
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

    debugLog(`Processed ${processedTransactions.length} total Line of Credit transactions (${uploadedSkipCount} already uploaded)`);
    return processedTransactions;
  } catch (error) {
    debugLog('Error fetching and processing Line of Credit transactions:', error);
    throw error;
  }
}

/**
 * Placeholder for investment account transaction processing
 * @param {Object} consolidatedAccount - Consolidated account object
 * @param {string} fromDate - Start date (YYYY-MM-DD)
 * @param {string} toDate - End date (YYYY-MM-DD)
 * @returns {Promise<Array>} Processed transactions
 */
export async function fetchAndProcessInvestmentTransactions(consolidatedAccount, fromDate, toDate) {
  debugLog('Investment account transaction processing not yet implemented', {
    accountId: consolidatedAccount.wealthsimpleAccount.id,
    fromDate,
    toDate,
  });

  // TODO: Implement investment account transaction logic
  // Will need different filtering and categorization rules

  return [];
}

/**
 * Main entry point - fetch and process transactions based on account type
 * @param {Object} consolidatedAccount - Consolidated account object
 * @param {string} fromDate - Start date (YYYY-MM-DD)
 * @param {string} toDate - End date (YYYY-MM-DD)
 * @param {Object} options - Processing options
 * @param {Array} options.rawTransactions - Pre-fetched raw transactions (optional)
 * @param {Set<string>} options.uploadedTransactionIds - Set of already-uploaded transaction IDs to skip
 * @returns {Promise<Array>} Processed transactions ready for upload
 */
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
  return fetchAndProcessInvestmentTransactions(consolidatedAccount, fromDate, toDate);
}

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
 * Get the transaction status for reconciliation based on account type and transaction type
 * Credit cards use 'status' field, CASH accounts use 'unifiedStatus' field,
 * EXCEPT for SPEND/PREPAID transactions in CASH accounts which use 'status' field.
 *
 * @param {Object} transaction - Raw Wealthsimple transaction
 * @param {string} accountType - Account type (CREDIT_CARD, CASH, CASH_USD, etc.)
 * @returns {Object} Status info { isPending, isSettled, rawStatus }
 */
function getTransactionStatusForReconciliation(transaction, accountType) {
  const isCashAccount = accountType === 'CASH' || accountType === 'CASH_USD';

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
    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - lookbackDays);

    const startDateStr = formatDate(startDate);
    const endDateStr = formatDate(today);

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
