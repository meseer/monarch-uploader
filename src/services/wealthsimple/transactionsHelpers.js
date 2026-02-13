/**
 * Wealthsimple Transactions - Shared Helpers
 * Common utility functions used across transaction processing modules
 */

import { debugLog, formatDate } from '../../core/utils';
import { applyMerchantMapping } from '../../mappers/merchant';
import { applyWealthsimpleCategoryMapping, saveUserWealthsimpleCategorySelection, calculateAllCategorySimilarities } from '../../mappers/category';
import { showMonarchCategorySelector } from '../../ui/components/categorySelector';
import monarchApi from '../../api/monarch';
import toast from '../../ui/toast';
import {
  formatOriginalStatement,
  formatSpendNotes,
  getTransactionId,
} from './transactionRules';

/**
 * Collect EFT transfer IDs from transactions for batch enrichment
 * Used by both cash and investment transaction processing
 * @param {Array} transactions - Array of raw transactions
 * @returns {Array} Array of EFT transfer externalCanonicalIds
 */
export function collectEftTransferIds(transactions) {
  const eftTransferIds = [];

  for (const tx of transactions) {
    if (
      (tx.subType === 'EFT' || tx.subType === 'EFT_RECURRING') &&
      tx.externalCanonicalId &&
      tx.externalCanonicalId.startsWith('funding_intent-')
    ) {
      eftTransferIds.push(tx.externalCanonicalId);
    }
  }

  return eftTransferIds;
}

/**
 * Convert ISO timestamp to local date in YYYY-MM-DD format
 * @param {string} isoTimestamp - ISO timestamp (e.g., "2025-12-31T21:39:22.000000+00:00")
 * @returns {string} Local date in YYYY-MM-DD format
 */
export function convertToLocalDate(isoTimestamp) {
  if (!isoTimestamp) return '';

  const date = new Date(isoTimestamp);
  return formatDate(date);
}

/**
 * Process credit card transaction to extract relevant data
 * @param {Object} transaction - Raw transaction from Wealthsimple API
 * @param {Object} options - Processing options
 * @param {boolean} options.stripStoreNumbers - Whether to strip store numbers from merchant names
 * @param {Map} options.spendDetailsMap - Map of transaction ID to spend details (for PURCHASE transactions)
 * @returns {Object} Processed transaction object
 */
export function processCreditCardTransaction(transaction, options = {}) {
  const { stripStoreNumbers = true, spendDetailsMap = null } = options;

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

  // Get spend details for PURCHASE transactions (foreign currency and reward info)
  let notes = '';
  if (transaction.subType === 'PURCHASE' && spendDetailsMap) {
    const spendDetails = spendDetailsMap.get(transaction.externalCanonicalId);
    if (spendDetails) {
      notes = formatSpendNotes(spendDetails);
    }
  }

  return {
    id: getTransactionId(transaction),
    date: convertToLocalDate(transaction.occurredAt),
    merchant: cleanedMerchant,
    originalMerchant: formatOriginalStatement(transaction.type, transaction.subType, merchantName),
    amount: finalAmount,
    type: transaction.type,
    subType: transaction.subType,
    status: transaction.status,
    // Notes from spend details (foreign currency, rewards)
    notes,
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
export function filterSyncableTransactions(transactions, includePending = true) {
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
export function getAutoMappingForSubType(subType) {
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
 * @param {boolean} options.skipCategorization - Skip manual category prompts, use empty category (optional)
 * @returns {Promise<Array>} Transactions with resolved Monarch categories
 */
export async function resolveCategoriesForTransactions(transactions, options = {}) {
  const { onProgress, skipCategorization = false } = options;
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

  // If skip categorization is enabled, set all unresolved transactions to 'Uncategorized'
  // and return immediately (no manual prompts)
  if (skipCategorization) {
    debugLog('Skip categorization enabled - setting Uncategorized for all unresolved transactions');
    return transactions.map((transaction) => {
      if (transaction.resolvedMonarchCategory) {
        return transaction; // Keep auto-categorized
      }
      return {
        ...transaction,
        resolvedMonarchCategory: 'Uncategorized',
      };
    });
  }

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

      // Handle "Skip (single transaction)" response - skip without saving a rule
      if (selectedCategory.skipped) {
        debugLog(`Skipped categorization for "${categoryToResolve.bankCategory}" (single transaction)`);
        categoriesToResolve.shift();
        resolvedCount += 1;
        if (onProgress) {
          onProgress(`Resolving categories (${resolvedCount}/${totalCategories})`);
        }
        continue;
      }

      // Handle "Skip All (this sync)" response
      if (selectedCategory.skipAll === true) {
        debugLog('User chose "Skip All" - setting Uncategorized for all remaining transactions');
        // Clear remaining categories and set all unresolved to Uncategorized
        categoriesToResolve.length = 0;
        return transactions.map((transaction) => {
          if (transaction.resolvedMonarchCategory) {
            return transaction; // Keep already-resolved
          }
          // Check one-time assignments already made
          if (oneTimeAssignments.has(transaction.id)) {
            return {
              ...transaction,
              resolvedMonarchCategory: oneTimeAssignments.get(transaction.id),
            };
          }
          // Check session mappings already made
          const upperKey = transaction.categoryKey ? transaction.categoryKey.toUpperCase() : '';
          if (sessionMappings.has(upperKey)) {
            return {
              ...transaction,
              resolvedMonarchCategory: sessionMappings.get(upperKey),
            };
          }
          return {
            ...transaction,
            resolvedMonarchCategory: 'Uncategorized',
          };
        });
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
