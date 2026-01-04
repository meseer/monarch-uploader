/**
 * Wealthsimple Transaction Service
 * Handles transaction fetching, filtering, and processing for different account types
 */

import { debugLog, formatDate } from '../../core/utils';
import wealthsimpleApi from '../../api/wealthsimple';
import { applyMerchantMapping } from '../../mappers/merchant';
import { applyWealthsimpleCategoryMapping, saveUserWealthsimpleCategorySelection, calculateAllCategorySimilarities } from '../../mappers/category';
import { showMonarchCategorySelector } from '../../ui/components/categorySelector';
import monarchApi from '../../api/monarch';
import toast from '../../ui/toast';

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

  // Determine merchant name based on subType
  let merchantName;
  if (transaction.subType === 'PAYMENT') {
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
 * Filter credit card transactions (only settled transactions)
 * @param {Array} transactions - Raw transactions from API
 * @returns {Array} Filtered transactions
 */
function filterCreditCardTransactions(transactions) {
  return transactions.filter((transaction) => {
    // Only process settled transactions
    if (transaction.status !== 'settled') {
      return false;
    }

    // Must be credit card type
    if (transaction.type !== 'CREDIT_CARD') {
      return false;
    }

    return true;
  });
}

/**
 * Get auto-category for specific transaction subtypes
 * @param {string} subType - Transaction subtype
 * @returns {string|null} Category name or null if should use mapping
 */
function getAutoCategoryForSubType(subType) {
  switch (subType) {
  case 'PAYMENT':
    return 'Credit Card Payment';
  case 'CASH_WITHDRAWAL':
    return 'Cash & ATM';
  default:
    return null; // Use merchant-based category mapping
  }
}

/**
 * Resolve categories for transactions, handling both automatic and manual selection
 * Uses dynamic category mapping - after each user selection, re-checks remaining categories
 * to avoid duplicate prompts
 * @param {Array} transactions - Array of processed transactions
 * @returns {Promise<Array>} Transactions with resolved Monarch categories
 */
async function resolveCategoriesForTransactions(transactions) {
  if (!transactions || transactions.length === 0) {
    return transactions;
  }

  debugLog('Starting category resolution for Wealthsimple transactions');

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
    const autoCategory = getAutoCategoryForSubType(transaction.subType);
    if (autoCategory) {
      transaction.resolvedMonarchCategory = autoCategory;
    }
  });

  // Get list of categories that need resolution (not auto-categorized)
  const categoriesToResolve = [];
  const uniqueCategories = new Map();

  transactions.forEach((transaction) => {
    // Skip if already auto-categorized
    if (transaction.resolvedMonarchCategory) {
      return;
    }

    const categoryKey = transaction.categoryKey;
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

    // Process categories until all are resolved
    // Always process the first element and remove it when done
    while (categoriesToResolve.length > 0) {
      const categoryToResolve = categoriesToResolve[0];

      // Re-check if this category still needs manual selection
      // (it might have been automatically mapped after a previous selection)
      const recheckResult = applyWealthsimpleCategoryMapping(categoryToResolve.bankCategory, availableCategories);

      if (typeof recheckResult === 'string') {
        // Category is now automatically mapped, skip it
        debugLog(`Category "${categoryToResolve.bankCategory}" now has automatic mapping: ${recheckResult}`);
        categoriesToResolve.shift(); // Remove first element
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

        debugLog('Transaction details for category selector:', transactionDetails);
      }

      // Show the category selector with institution parameter
      const selectedCategory = await new Promise((resolve) => {
        showMonarchCategorySelector(categoryToResolve.bankCategory, resolve, similarityData, transactionDetails);
      });

      if (!selectedCategory) {
        throw new Error(`Category selection cancelled for "${categoryToResolve.bankCategory}". Upload aborted.`);
      }

      // Save the selection using Wealthsimple-specific function
      saveUserWealthsimpleCategorySelection(categoryToResolve.bankCategory, selectedCategory.name);
      debugLog(`User selected category mapping: ${categoryToResolve.bankCategory} -> ${selectedCategory.name}`);

      toast.show(`Mapped "${categoryToResolve.bankCategory}" to "${selectedCategory.name}"`, 'debug');

      // Remove this category from the list (dynamic re-checking will happen on next iteration)
      categoriesToResolve.shift(); // Remove first element
    }
  }

  // Now resolve all categories (should all be mapped now)
  const resolvedTransactions = transactions.map((transaction) => {
    // If already resolved (auto-category), skip
    if (transaction.resolvedMonarchCategory) {
      return transaction;
    }

    // Resolve based on merchant using Wealthsimple-specific function
    const categoryKey = transaction.categoryKey;
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
 * @param {Object} consolidatedAccount - Consolidated account object
 * @param {string} fromDate - Start date (YYYY-MM-DD)
 * @param {string} toDate - End date (YYYY-MM-DD)
 * @returns {Promise<Array>} Processed transactions ready for upload
 */
export async function fetchAndProcessCreditCardTransactions(consolidatedAccount, fromDate, toDate) {
  try {
    const accountId = consolidatedAccount.wealthsimpleAccount.id;
    const accountName = consolidatedAccount.wealthsimpleAccount.nickname;
    const stripStoreNumbers = consolidatedAccount.stripStoreNumbers !== false; // Default true

    debugLog(`Fetching credit card transactions for ${accountName} from ${fromDate} to ${toDate}`);
    debugLog(`Store number stripping: ${stripStoreNumbers ? 'enabled' : 'disabled'}`);

    // Fetch raw transactions from API
    const rawTransactions = await wealthsimpleApi.fetchTransactions(accountId, fromDate);

    debugLog(`Fetched ${rawTransactions.length} total transactions from API`);

    // Filter for credit card settled transactions
    const creditCardTransactions = filterCreditCardTransactions(rawTransactions);

    debugLog(`Filtered to ${creditCardTransactions.length} settled credit card transactions`);

    if (creditCardTransactions.length === 0) {
      return [];
    }

    // Process transactions with stripStoreNumbers option
    const processedTransactions = creditCardTransactions.map((transaction) =>
      processCreditCardTransaction(transaction, { stripStoreNumbers }),
    );

    debugLog(`Processed ${processedTransactions.length} credit card transactions`);

    // Resolve categories
    const transactionsWithCategories = await resolveCategoriesForTransactions(processedTransactions);

    return transactionsWithCategories;
  } catch (error) {
    debugLog('Error fetching and processing credit card transactions:', error);
    throw error;
  }
}

/**
 * Placeholder for cash account transaction processing
 * @param {Object} consolidatedAccount - Consolidated account object
 * @param {string} fromDate - Start date (YYYY-MM-DD)
 * @param {string} toDate - End date (YYYY-MM-DD)
 * @returns {Promise<Array>} Processed transactions
 */
export async function fetchAndProcessCashTransactions(consolidatedAccount, fromDate, toDate) {
  debugLog('Cash account transaction processing not yet implemented', {
    accountId: consolidatedAccount.wealthsimpleAccount.id,
    fromDate,
    toDate,
  });

  // TODO: Implement cash account transaction logic
  // Will need different filtering and categorization rules

  return [];
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
 * @returns {Promise<Array>} Processed transactions ready for upload
 */
export async function fetchAndProcessTransactions(consolidatedAccount, fromDate, toDate) {
  const accountType = consolidatedAccount.wealthsimpleAccount.type;

  debugLog(`Processing transactions for account type: ${accountType}`);

  // Route to appropriate processor based on account type
  if (accountType.includes('CREDIT')) {
    return fetchAndProcessCreditCardTransactions(consolidatedAccount, fromDate, toDate);
  }

  if (accountType.includes('CASH')) {
    return fetchAndProcessCashTransactions(consolidatedAccount, fromDate, toDate);
  }

  if (accountType.includes('LOAN')) {
    return fetchAndProcessLoanTransactions(consolidatedAccount, fromDate, toDate);
  }

  // Default to investment account processing for all other types
  return fetchAndProcessInvestmentTransactions(consolidatedAccount, fromDate, toDate);
}

export default {
  fetchAndProcessTransactions,
  fetchAndProcessCreditCardTransactions,
  fetchAndProcessCashTransactions,
  fetchAndProcessLoanTransactions,
  fetchAndProcessInvestmentTransactions,
};
