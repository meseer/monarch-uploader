/**
 * Questrade Transactions Service
 * Handles fetching orders and activity transactions from Questrade and uploading them to Monarch
 *
 * This service uses TWO data sources:
 * 1. Orders API (v1) - For trade orders (buy/sell securities)
 * 2. Activity API (v3) - For non-trade transactions (dividends, fees, deposits, etc.)
 */

import { debugLog, getTodayLocal, saveLastUploadDate } from '../../core/utils';
import { INTEGRATIONS } from '../../core/integrationCapabilities';
import questradeApi from '../../api/questrade';
import monarchApi from '../../api/monarch';
import accountService from '../common/accountService';
import toast from '../../ui/toast';
import { convertQuestradeOrdersToMonarchCSV, convertQuestradeTransactionsToMonarchCSV } from '../../utils/csv';
import { applyCategoryMapping, saveUserCategorySelection, calculateAllCategorySimilarities } from '../../mappers/category';
import { showMonarchCategorySelector, type SimilarityInfo } from '../../ui/components/categorySelector';
import {
  getTransactionIdsFromArray,
  getRetentionSettingsFromAccount,
  mergeAndRetainTransactions,
} from '../../utils/transactionStorage';
import {
  applyTransactionRule,
  shouldFilterTransaction,
  getTransactionId,
} from './transactionRules';
import { showProgressDialog } from '../../ui/components/progressDialog';

/**
 * Save uploaded transaction IDs to consolidated storage
 * Uses accountService to update the uploadedTransactions field in questrade_accounts_list
 * Both orders and activity transactions share the same uploadedTransactions field
 * @param {string} accountId - Questrade account ID
 * @param {Array} newTransactions - Array of transaction objects with id and date
 */
function saveUploadedTransactionsToConsolidated(accountId, newTransactions) {
  // Get current account data
  const accountData = accountService.getAccountData(INTEGRATIONS.QUESTRADE, accountId);
  const existingTransactions = (accountData?.uploadedTransactions || []) as unknown[];

  // Get retention settings from account or use defaults
  const retentionSettings = getRetentionSettingsFromAccount(accountData);

  // Merge and apply retention limits
  const updatedTransactions = mergeAndRetainTransactions(
    existingTransactions,
    newTransactions,
    retentionSettings,
  );

  // Save back to consolidated storage
  accountService.updateAccountInList(INTEGRATIONS.QUESTRADE, accountId, {
    uploadedTransactions: updatedTransactions,
  });

  debugLog(`Saved ${newTransactions.length} new transactions to consolidated storage for account ${accountId}`);
}

/**
 * Filter out already uploaded orders
 * Uses consolidated storage (questrade_accounts_list[].uploadedTransactions)
 * @param {Array} orders - Array of orders
 * @param {string} accountId - Questrade account ID
 * @returns {Object} Filtered orders and statistics
 */
function filterDuplicateOrders(orders, accountId) {
  // Use consolidated storage via accountService
  const accountData = accountService.getAccountData(INTEGRATIONS.QUESTRADE, accountId);
  const uploadedUUIDs = getTransactionIdsFromArray((accountData?.uploadedTransactions || []) as unknown[]);
  const originalCount = orders.length;

  const newOrders = orders.filter(
    (order) => !uploadedUUIDs.has(order.orderUuid),
  );

  const duplicateCount = originalCount - newOrders.length;

  if (duplicateCount > 0) {
    debugLog(`Filtered out ${duplicateCount} duplicate orders`);
  }

  return {
    orders: newOrders,
    duplicateCount,
    originalCount,
  };
}

/**
 * Filter out already uploaded transactions (from activity API)
 * Uses consolidated storage (questrade_accounts_list[].uploadedTransactions)
 * Both orders and activity transactions share the same uploadedTransactions field
 * @param {Array} transactions - Array of transactions
 * @param {string} accountId - Questrade account ID
 * @returns {Object} Filtered transactions and statistics
 */
function filterDuplicateTransactions(transactions, accountId) {
  // Use consolidated storage via accountService (same field as orders)
  const accountData = accountService.getAccountData(INTEGRATIONS.QUESTRADE, accountId);
  const uploadedUUIDs = getTransactionIdsFromArray((accountData?.uploadedTransactions || []) as unknown[]);
  const originalCount = transactions.length;

  const newTransactions = transactions.filter((tx) => {
    const txId = getTransactionId(tx);
    return !uploadedUUIDs.has(txId);
  });

  const duplicateCount = originalCount - newTransactions.length;

  if (duplicateCount > 0) {
    debugLog(`Filtered out ${duplicateCount} duplicate transactions`);
  }

  return {
    transactions: newTransactions,
    duplicateCount,
    originalCount,
  };
}

/**
 * Filter orders to only include executed ones
 * @param {Array} orders - Array of orders
 * @returns {Array} Filtered orders with status="Executed"
 */
function filterExecutedOrders(orders) {
  if (!orders || !Array.isArray(orders)) {
    return [];
  }

  const executedOrders = orders.filter((order) => order.status === 'Executed');
  debugLog(`Filtered ${executedOrders.length} executed orders from ${orders.length} total`);
  return executedOrders;
}

/**
 * Filter transactions to exclude trades (handled by orders API)
 * @param {Array} transactions - Array of transactions from activity API
 * @returns {Array} Filtered transactions without trades
 */
function filterNonTradeTransactions(transactions) {
  if (!transactions || !Array.isArray(transactions)) {
    return [];
  }

  const nonTradeTransactions = transactions.filter((tx) => !shouldFilterTransaction(tx));
  const filteredCount = transactions.length - nonTradeTransactions.length;

  if (filteredCount > 0) {
    debugLog(`Filtered out ${filteredCount} trade transactions (handled by orders API)`);
  }

  debugLog(`Kept ${nonTradeTransactions.length} non-trade transactions`);
  return nonTradeTransactions;
}

/**
 * Resolve categories for orders, handling both automatic mapping and manual selection
 * @param {Array} orders - Array of orders to process
 * @param {Object} options - Options for category resolution
 * @param {boolean} options.skipCategorization - Skip manual category prompts, use empty category (optional)
 * @returns {Promise<Array>} Orders with resolved Monarch categories
 */
async function resolveCategoriesForOrders(orders, options: { skipCategorization?: boolean } = {}) {
  const { skipCategorization = false } = options;
  if (!orders || orders.length === 0) {
    return orders;
  }

  debugLog('Starting category resolution for orders');

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

  // If skip categorization is enabled, set Uncategorized for all orders
  // and return immediately (no manual prompts)
  if (skipCategorization) {
    debugLog('Skip categorization enabled - setting Uncategorized for all Questrade orders');
    return orders.map((order) => ({
      ...order,
      resolvedMonarchCategory: 'Uncategorized',
      originalAction: order.action || 'Unknown',
    }));
  }

  // Find all unique order actions that need resolution
  const uniqueActions = new Map(); // Use Map to store action with example order
  const actionsToResolve = [];

  orders.forEach((order) => {
    const action = order.action || 'Unknown';

    if (!uniqueActions.has(action)) {
      // Store the first order as an example for this action
      uniqueActions.set(action, order);

      // Test the action mapping with available categories
      const mappingResult = applyCategoryMapping(action, availableCategories);

      if (mappingResult && typeof mappingResult === 'object' && mappingResult.needsManualSelection) {
        // This action needs manual selection
        actionsToResolve.push({
          ...mappingResult,
          exampleOrder: order,
        });
      }
    }
  });

  debugLog(`Found ${uniqueActions.size} unique order actions, ${actionsToResolve.length} need manual selection`);

  // Handle actions that need manual selection
  if (actionsToResolve.length > 0) {
    toast.show(`Resolving ${actionsToResolve.length} order action categories...`, 'debug');

    for (let i = 0; i < actionsToResolve.length; i += 1) {
      const actionToResolve = actionsToResolve[i];

      debugLog(`Showing category selector for action: ${actionToResolve.bankCategory} (${i + 1}/${actionsToResolve.length})`);

      // Show progress in toast
      toast.show(`Selecting category ${i + 1} of ${actionsToResolve.length}: "${actionToResolve.bankCategory}"`, 'debug');

      // Calculate comprehensive similarity data for the UI
      const similarityData = calculateAllCategorySimilarities(actionToResolve.bankCategory, availableCategories);

      // Prepare order details for the selector
      const transactionDetails: Record<string, unknown> = {};
      if (actionToResolve.exampleOrder) {
        const exampleOrder = actionToResolve.exampleOrder;

        // Extract security name as merchant
        transactionDetails.merchant = exampleOrder.security?.displayName || 'Unknown Security';

        // Extract amount
        transactionDetails.amount = exampleOrder.filledQuantity * exampleOrder.averageFilledPrice || 0;

        // Extract and format date
        if (exampleOrder.updatedDateTime) {
          const date = new Date(exampleOrder.updatedDateTime);
          transactionDetails.date = date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          });
        }

        debugLog('Order details for category selector:', transactionDetails);
      }

      // Show the category selector with order details
      const selectedCategory = await new Promise((resolve) => {
        showMonarchCategorySelector(actionToResolve.bankCategory, resolve, similarityData as unknown as SimilarityInfo, transactionDetails);
      });

      if (!selectedCategory) {
        // User cancelled - this will abort the upload
        throw new Error(`Category selection cancelled for "${actionToResolve.bankCategory}". Upload aborted.`);
      }

      // Handle "Skip All (this sync)" response
      // Handle "Skip single" - don't save as rule, just continue to next
      const selCat = selectedCategory as Record<string, unknown>;
      if (selCat.skipped) {
        debugLog(`Skipped categorization for "${actionToResolve.bankCategory}" (single transaction)`);
        continue;
      }

      if (selCat.skipAll === true) {
        debugLog('User chose "Skip All" - setting Uncategorized for all remaining Questrade orders');
        return orders.map((order) => {
          const action = order.action || 'Unknown';
          const mappingResult = applyCategoryMapping(action, availableCategories);
          // Already-resolved categories keep their mapping, unresolved get Uncategorized
          const resolvedCategory = typeof mappingResult === 'string' ? mappingResult : 'Uncategorized';
          return {
            ...order,
            resolvedMonarchCategory: resolvedCategory,
            originalAction: action,
          };
        });
      }

      // Save the user's selection for future use
      saveUserCategorySelection(actionToResolve.bankCategory, selCat.name as string);
      debugLog(`User selected category mapping: ${actionToResolve.bankCategory} -> ${selCat.name}`);

      toast.show(`Mapped "${actionToResolve.bankCategory}" to "${selCat.name}"`, 'debug');
    }
  }

  // Now resolve all categories (they should all have mappings now)
  const resolvedOrders = orders.map((order) => {
    const action = order.action || 'Unknown';

    const mappingResult = applyCategoryMapping(action, availableCategories);

    // At this point, all actions should resolve to strings (Monarch category names)
    const resolvedCategory = typeof mappingResult === 'string' ? mappingResult : 'Uncategorized';

    return {
      ...order,
      resolvedMonarchCategory: resolvedCategory,
      originalAction: action,
    };
  });

  debugLog('Category resolution completed for all orders');
  return resolvedOrders;
}

/**
 * Fetch Questrade orders for a given account
 * @param {string} accountId - Account Id
 * @param {string} fromDate - Start date in ISO format
 * @returns {Promise<Array>} Array of orders
 */
async function fetchQuestradeOrders(accountId, fromDate) {
  try {
    debugLog(`Fetching Questrade orders for account ${accountId} from ${fromDate}`);

    // Convert fromDate to ISO format if needed
    let isoFromDate = fromDate;
    if (!/T/.test(fromDate)) {
      // Date is in YYYY-MM-DD format, convert to ISO
      isoFromDate = `${fromDate}T00:00:00.000Z`;
    }

    const response = await questradeApi.fetchOrders(accountId, isoFromDate);

    if (!response || !response.data) {
      debugLog('Invalid API response:', response);
      throw new Error('Invalid API response: missing data');
    }

    const orders = response.data;
    debugLog(`Fetched ${orders.length} orders`);

    return orders;
  } catch (error) {
    debugLog('Error fetching Questrade orders:', error);
    throw error;
  }
}

/**
 * Fetch activity transactions and their details for an account
 * @param {string} accountId - Questrade account ID
 * @param {string} fromDate - Start date in YYYY-MM-DD format
 * @param {Object} progressDialog - Optional progress dialog
 * @returns {Promise<Array>} Array of processed transactions with details
 */
async function fetchAndProcessActivityTransactions(accountId, fromDate, progressDialog = null) {
  try {
    debugLog(`Fetching activity transactions for account ${accountId} from ${fromDate}`);

    if (progressDialog) {
      progressDialog.updateProgress(accountId, 'processing', 'Loading transactions from Questrade...');
    }

    // Fetch all transactions since the date
    const transactions = await questradeApi.fetchTransactionsSinceDate(accountId, fromDate);

    if (!transactions || transactions.length === 0) {
      debugLog('No activity transactions found');
      return [];
    }

    debugLog(`Fetched ${transactions.length} activity transactions`);

    // Filter out trades (handled by orders API)
    const nonTradeTransactions = filterNonTradeTransactions(transactions);

    if (nonTradeTransactions.length === 0) {
      debugLog('No non-trade transactions to process');
      return [];
    }

    if (progressDialog) {
      progressDialog.updateProgress(
        accountId,
        'processing',
        `Loading transaction details (0/${nonTradeTransactions.length})...`,
      );
    }

    // Fetch details for each transaction
    const processedTransactions = [];
    for (let i = 0; i < nonTradeTransactions.length; i += 1) {
      const tx = nonTradeTransactions[i];

      if (progressDialog && i % 5 === 0) {
        progressDialog.updateProgress(
          accountId,
          'processing',
          `Loading transaction details (${i + 1}/${nonTradeTransactions.length})...`,
        );
      }

      // Fetch full details using transactionUrl
      let details = null;
      if (tx.transactionUrl) {
        try {
          details = await questradeApi.fetchTransactionDetails(tx.transactionUrl);
        } catch (detailError) {
          debugLog(`Failed to fetch details for transaction ${getTransactionId(tx)}:`, detailError);
          // Continue without details - rules can still process with basic info
        }
      }

      // Apply transaction rules
      const ruleResult = applyTransactionRule(tx, details);

      processedTransactions.push({
        transaction: tx,
        details,
        ruleResult,
      });
    }

    debugLog(`Processed ${processedTransactions.length} transactions with details`);
    return processedTransactions;
  } catch (error) {
    debugLog('Error fetching activity transactions:', error);
    throw error;
  }
}

/**
 * Process and upload activity transactions for a Questrade account
 * @param {string} accountId - Questrade account ID
 * @param {string} accountName - Account name for display
 * @param {string} fromDate - Start date for transactions
 * @param {string} monarchAccountId - Monarch account ID to upload to
 * @param {Object} progressDialog - Optional progress dialog
 * @returns {Promise<Object>} Upload result
 */
async function processAndUploadActivityTransactions(accountId, accountName, fromDate, monarchAccountId, progressDialog = null) {
  try {
    debugLog(`Processing activity transactions for account ${accountName} (${accountId})`);

    // Fetch and process activity transactions
    const processedTransactions = await fetchAndProcessActivityTransactions(accountId, fromDate, progressDialog);

    if (processedTransactions.length === 0) {
      debugLog('No activity transactions to upload');
      return {
        success: true,
        message: 'No activity transactions found',
        transactionsProcessed: 0,
      };
    }

    // Filter out duplicates
    const transactionsForDedup = processedTransactions.map((pt) => pt.transaction);
    const filterResult = filterDuplicateTransactions(transactionsForDedup, accountId);

    // Create a set of IDs to keep
    const idsToKeep = new Set(filterResult.transactions.map((tx) => getTransactionId(tx)));

    // Filter the processed transactions
    const newProcessedTransactions = processedTransactions.filter((pt) => idsToKeep.has(getTransactionId(pt.transaction)));

    if (newProcessedTransactions.length === 0) {
      const message = filterResult.duplicateCount > 0
        ? `All ${filterResult.duplicateCount} activity transactions have already been uploaded`
        : 'No new activity transactions to upload';
      debugLog(message);
      return {
        success: true,
        message,
        transactionsProcessed: 0,
        skippedDuplicates: filterResult.duplicateCount,
      };
    }

    if (progressDialog) {
      const dupMsg = filterResult.duplicateCount > 0
        ? ` (${filterResult.duplicateCount} duplicates skipped)`
        : '';
      progressDialog.updateProgress(
        accountId,
        'processing',
        `Converting ${newProcessedTransactions.length} transactions to CSV${dupMsg}...`,
      );
    }

    // Convert to Monarch CSV format
    const csvData = convertQuestradeTransactionsToMonarchCSV(newProcessedTransactions, accountName);

    if (!csvData) {
      throw new Error('Failed to convert transactions to CSV');
    }

    // Upload to Monarch
    const toDate = getTodayLocal();
    const filename = `questrade_activity_${accountId}_${fromDate}_to_${toDate}.csv`;

    if (progressDialog) {
      progressDialog.updateProgress(accountId, 'processing', `Uploading ${newProcessedTransactions.length} activity transactions...`);
    }

    const uploadSuccess = await monarchApi.uploadTransactions(
      monarchAccountId,
      csvData,
      filename,
      false, // shouldUpdateBalance
      false, // skipCheckForDuplicates
    );

    if (uploadSuccess) {
      // Save transaction IDs for deduplication
      const transactionsWithDates = newProcessedTransactions.map((pt) => {
        const txId = getTransactionId(pt.transaction);
        const date = pt.details?.transactionDate || pt.transaction?.transactionDate || toDate;
        return {
          id: txId,
          date: date.includes('T') ? date.split('T')[0] : date,
        };
      });

      // Save to consolidated storage (shared with orders)
      saveUploadedTransactionsToConsolidated(accountId, transactionsWithDates);

      const successMessage = filterResult.duplicateCount > 0
        ? `Successfully uploaded ${newProcessedTransactions.length} activity transactions (${filterResult.duplicateCount} duplicates skipped)`
        : `Successfully uploaded ${newProcessedTransactions.length} activity transactions`;

      debugLog(successMessage);
      return {
        success: true,
        message: successMessage,
        transactionsProcessed: newProcessedTransactions.length,
        skippedDuplicates: filterResult.duplicateCount,
      };
    }

    throw new Error('Upload to Monarch failed');
  } catch (error) {
    debugLog(`Error processing activity transactions for account ${accountId}:`, error);
    throw error;
  }
}

/**
 * Process and upload orders (trades) for a Questrade account
 * @param {string} accountId - Questrade account ID (key)
 * @param {string} accountName - Account name for display
 * @param {string} fromDate - Start date for transactions
 * @param {string} monarchAccountId - Monarch account ID to upload to
 * @param {Object} progressDialog - Optional progress dialog
 * @returns {Promise<Object>} Upload result
 */
async function processAndUploadOrders(accountId, accountName, fromDate, monarchAccountId, progressDialog = null) {
  try {
    debugLog(`Processing orders for account ${accountName} (${accountId})`);

    if (progressDialog) {
      progressDialog.updateProgress(accountId, 'processing', 'Loading orders from Questrade...');
    }

    // Fetch orders
    const allOrders = await fetchQuestradeOrders(accountId, fromDate);

    if (!allOrders || allOrders.length === 0) {
      debugLog('No orders found for the specified date range');
      return {
        success: true,
        message: 'No orders found',
        ordersProcessed: 0,
      };
    }

    // Filter to only executed orders
    const executedOrders = filterExecutedOrders(allOrders);

    if (executedOrders.length === 0) {
      debugLog('No executed orders found');
      return {
        success: true,
        message: 'No executed orders found',
        ordersProcessed: 0,
      };
    }

    // Filter out duplicate orders
    const filterResult = filterDuplicateOrders(executedOrders, accountId);
    const ordersToUpload = filterResult.orders;

    if (ordersToUpload.length === 0) {
      const message = filterResult.duplicateCount > 0
        ? `All ${filterResult.duplicateCount} orders have already been uploaded`
        : 'No new orders to upload';
      debugLog(message);
      return {
        success: true,
        message,
        ordersProcessed: 0,
        skippedDuplicates: filterResult.duplicateCount,
      };
    }

    if (progressDialog) {
      progressDialog.updateProgress(accountId, 'processing', 'Resolving order categories...');
    }

    // Resolve categories for all orders
    const accountData = accountService.getAccountData(INTEGRATIONS.QUESTRADE, accountId);
    const skipCategorization = accountData?.skipCategorization === true;
    const ordersWithResolvedCategories = await resolveCategoriesForOrders(ordersToUpload, { skipCategorization });

    // Convert orders to Monarch CSV format
    if (progressDialog) {
      progressDialog.updateProgress(accountId, 'processing', `Converting ${ordersToUpload.length} orders to CSV...`);
    }

    const csvData = convertQuestradeOrdersToMonarchCSV(ordersWithResolvedCategories, accountName);

    if (!csvData) {
      throw new Error('Failed to convert orders to CSV');
    }

    // Upload to Monarch
    const toDate = getTodayLocal();
    const filename = `questrade_orders_${accountId}_${fromDate}_to_${toDate}.csv`;

    if (progressDialog) {
      progressDialog.updateProgress(accountId, 'processing', `Uploading ${ordersToUpload.length} orders...`);
    }

    const uploadSuccess = await monarchApi.uploadTransactions(
      monarchAccountId,
      csvData,
      filename,
      false, // shouldUpdateBalance
      false, // skipCheckForDuplicates
    );

    if (uploadSuccess) {
      // Save order UUIDs with dates for successful uploads
      const transactionsWithDates = ordersToUpload.map((order) => {
        let date = toDate;
        if (order.updatedDateTime) {
          const orderDate = new Date(order.updatedDateTime);
          date = orderDate.toISOString().split('T')[0];
        }
        return {
          id: order.orderUuid,
          date,
        };
      }).filter((t) => t.id);

      // Save to consolidated storage (shared with activity transactions)
      saveUploadedTransactionsToConsolidated(accountId, transactionsWithDates);
      saveLastUploadDate(accountId, toDate, 'questrade');

      const successMessage = filterResult.duplicateCount > 0
        ? `Successfully uploaded ${ordersToUpload.length} orders (${filterResult.duplicateCount} duplicates skipped)`
        : `Successfully uploaded ${ordersToUpload.length} orders`;

      debugLog(successMessage);
      return {
        success: true,
        message: successMessage,
        ordersProcessed: ordersToUpload.length,
        skippedDuplicates: filterResult.duplicateCount,
      };
    }

    throw new Error('Upload to Monarch failed');
  } catch (error) {
    debugLog(`Error processing orders for account ${accountId}:`, error);
    throw error;
  }
}

/**
 * Process and upload all transactions (both orders and activity) for a Questrade account
 * @param {string} accountId - Questrade account ID (key)
 * @param {string} accountName - Account name for display
 * @param {string} fromDate - Start date for transactions
 * @param {Object} progressDialog - Optional progress dialog
 * @returns {Promise<Object>} Upload result
 */
export async function processAndUploadTransactions(accountId, accountName, fromDate, progressDialog = null) {
  try {
    debugLog(`Starting transaction processing for account ${accountName} (${accountId})`);

    // Validate account exists
    const account = questradeApi.getAccount(accountId);
    if (!account) {
      throw new Error(`Account not found: ${accountId}`);
    }

    // Get Monarch account mapping
    const monarchAccount = accountService.getMonarchAccountMapping(INTEGRATIONS.QUESTRADE, accountId);

    if (!monarchAccount) {
      throw new Error('Account mapping cancelled or not found');
    }

    const results = {
      orders: null,
      activity: null,
    };

    // Process orders (trades)
    try {
      results.orders = await processAndUploadOrders(accountId, accountName, fromDate, monarchAccount.id, progressDialog);
    } catch (orderError) {
      debugLog('Error processing orders:', orderError);
      results.orders = {
        success: false,
        message: `Orders failed: ${orderError.message}`,
        ordersProcessed: 0,
      };
    }

    // Process activity transactions (non-trades)
    try {
      results.activity = await processAndUploadActivityTransactions(accountId, accountName, fromDate, monarchAccount.id, progressDialog);
    } catch (activityError) {
      debugLog('Error processing activity transactions:', activityError);
      results.activity = {
        success: false,
        message: `Activity transactions failed: ${activityError.message}`,
        transactionsProcessed: 0,
      };
    }

    // Combine results
    const totalProcessed = (results.orders?.ordersProcessed || 0) + (results.activity?.transactionsProcessed || 0);
    const totalDuplicates = (results.orders?.skippedDuplicates || 0) + (results.activity?.skippedDuplicates || 0);

    const overallSuccess = (results.orders?.success ?? true) && (results.activity?.success ?? true);

    // Build summary message
    const messageParts = [];
    if (results.orders?.ordersProcessed > 0) {
      messageParts.push(`${results.orders.ordersProcessed} orders`);
    }
    if (results.activity?.transactionsProcessed > 0) {
      messageParts.push(`${results.activity.transactionsProcessed} activity transactions`);
    }

    let summaryMessage;
    if (totalProcessed === 0) {
      if (totalDuplicates > 0) {
        summaryMessage = `No new transactions (${totalDuplicates} duplicates skipped)`;
      } else {
        summaryMessage = 'No transactions found to upload';
      }
    } else {
      summaryMessage = `Uploaded ${messageParts.join(' and ')}`;
      if (totalDuplicates > 0) {
        summaryMessage += ` (${totalDuplicates} duplicates skipped)`;
      }
    }

    if (progressDialog) {
      progressDialog.updateProgress(
        accountId,
        overallSuccess ? 'success' : 'error',
        summaryMessage,
      );
    }

    return {
      success: overallSuccess,
      message: summaryMessage,
      ordersProcessed: results.orders?.ordersProcessed || 0,
      transactionsProcessed: results.activity?.transactionsProcessed || 0,
      skippedDuplicates: totalDuplicates,
      results,
    };
  } catch (error) {
    debugLog(`Error processing transactions for account ${accountId}:`, error);
    if (progressDialog) {
      progressDialog.updateProgress(accountId, 'error', `Transaction upload failed: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Fetch and process ALL activity transactions for an account (no date filter)
 * @param {string} accountId - Questrade account ID
 * @param {Object} progressDialog - Optional progress dialog
 * @returns {Promise<Array>} Array of processed transactions with details
 */
async function fetchAndProcessAllActivityTransactions(accountId, progressDialog = null) {
  try {
    debugLog(`Fetching ALL activity transactions for account ${accountId}`);

    if (progressDialog) {
      progressDialog.updateProgress(accountId, 'processing', 'Loading all transactions from Questrade...');
    }

    // Fetch ALL transactions (no date filter)
    const transactions = await questradeApi.fetchAllTransactions(accountId);

    if (!transactions || transactions.length === 0) {
      debugLog('No activity transactions found');
      return [];
    }

    debugLog(`Fetched ${transactions.length} total activity transactions`);

    // Filter out trades (handled by orders API)
    const nonTradeTransactions = filterNonTradeTransactions(transactions);

    if (nonTradeTransactions.length === 0) {
      debugLog('No non-trade transactions to process');
      return [];
    }

    if (progressDialog) {
      progressDialog.updateProgress(
        accountId,
        'processing',
        `Loading transaction details (0/${nonTradeTransactions.length})...`,
      );
    }

    // Fetch details for each transaction
    const processedTransactions = [];
    for (let i = 0; i < nonTradeTransactions.length; i += 1) {
      const tx = nonTradeTransactions[i];

      if (progressDialog && i % 10 === 0) {
        progressDialog.updateProgress(
          accountId,
          'processing',
          `Loading transaction details (${i + 1}/${nonTradeTransactions.length})...`,
        );
      }

      // Fetch full details using transactionUrl
      let details = null;
      if (tx.transactionUrl) {
        try {
          details = await questradeApi.fetchTransactionDetails(tx.transactionUrl);
        } catch (detailError) {
          debugLog(`Failed to fetch details for transaction ${getTransactionId(tx)}:`, detailError);
          // Continue without details - rules can still process with basic info
        }
      }

      // Apply transaction rules
      const ruleResult = applyTransactionRule(tx, details);

      processedTransactions.push({
        transaction: tx,
        details,
        ruleResult,
      });
    }

    debugLog(`Processed ${processedTransactions.length} transactions with details`);
    return processedTransactions;
  } catch (error) {
    debugLog('Error fetching all activity transactions:', error);
    throw error;
  }
}

/**
 * Upload all activity transactions for a single account (no date filter - full history)
 * @param {string} accountId - Questrade account ID
 * @param {string} accountName - Account name for display
 * @param {string} monarchAccountId - Monarch account ID to upload to
 * @param {Object} progressDialog - Optional progress dialog
 * @returns {Promise<Object>} Upload result
 */
async function uploadActivityForAccount(accountId, accountName, monarchAccountId, progressDialog = null) {
  try {
    debugLog(`Uploading all activity for account ${accountName} (${accountId})`);

    // Fetch and process ALL activity transactions
    const processedTransactions = await fetchAndProcessAllActivityTransactions(accountId, progressDialog);

    if (processedTransactions.length === 0) {
      debugLog('No activity transactions to upload');
      return {
        success: true,
        message: 'No activity transactions found',
        transactionsProcessed: 0,
      };
    }

    // Filter out duplicates
    const transactionsForDedup = processedTransactions.map((pt) => pt.transaction);
    const filterResult = filterDuplicateTransactions(transactionsForDedup, accountId);

    // Create a set of IDs to keep
    const idsToKeep = new Set(filterResult.transactions.map((tx) => getTransactionId(tx)));

    // Filter the processed transactions
    const newProcessedTransactions = processedTransactions.filter((pt) => idsToKeep.has(getTransactionId(pt.transaction)));

    if (newProcessedTransactions.length === 0) {
      const message = filterResult.duplicateCount > 0
        ? `All ${filterResult.duplicateCount} activity transactions have already been uploaded`
        : 'No new activity transactions to upload';
      debugLog(message);
      return {
        success: true,
        message,
        transactionsProcessed: 0,
        skippedDuplicates: filterResult.duplicateCount,
      };
    }

    if (progressDialog) {
      const dupMsg = filterResult.duplicateCount > 0
        ? ` (${filterResult.duplicateCount} duplicates skipped)`
        : '';
      progressDialog.updateProgress(
        accountId,
        'processing',
        `Converting ${newProcessedTransactions.length} transactions to CSV${dupMsg}...`,
      );
    }

    // Convert to Monarch CSV format
    const csvData = convertQuestradeTransactionsToMonarchCSV(newProcessedTransactions, accountName);

    if (!csvData) {
      throw new Error('Failed to convert transactions to CSV');
    }

    // Upload to Monarch
    const toDate = getTodayLocal();
    const filename = `questrade_all_activity_${accountId}_${toDate}.csv`;

    if (progressDialog) {
      progressDialog.updateProgress(accountId, 'processing', `Uploading ${newProcessedTransactions.length} activity transactions...`);
    }

    const uploadSuccess = await monarchApi.uploadTransactions(
      monarchAccountId,
      csvData,
      filename,
      false, // shouldUpdateBalance
      false, // skipCheckForDuplicates
    );

    if (uploadSuccess) {
      // Save transaction IDs for deduplication
      const transactionsWithDates = newProcessedTransactions.map((pt) => {
        const txId = getTransactionId(pt.transaction);
        const date = pt.details?.transactionDate || pt.transaction?.transactionDate || toDate;
        return {
          id: txId,
          date: date.includes('T') ? date.split('T')[0] : date,
        };
      });

      // Save to consolidated storage (shared with orders)
      saveUploadedTransactionsToConsolidated(accountId, transactionsWithDates);

      const successMessage = filterResult.duplicateCount > 0
        ? `Uploaded ${newProcessedTransactions.length} (${filterResult.duplicateCount} skipped)`
        : `Uploaded ${newProcessedTransactions.length} transactions`;

      debugLog(successMessage);
      return {
        success: true,
        message: successMessage,
        transactionsProcessed: newProcessedTransactions.length,
        skippedDuplicates: filterResult.duplicateCount,
      };
    }

    throw new Error('Upload to Monarch failed');
  } catch (error) {
    debugLog(`Error uploading activity for account ${accountId}:`, error);
    throw error;
  }
}

/**
 * Upload all activity transactions for a single Questrade account to Monarch
 * This is a testing/development function for uploading all activity history for one account
 * @param {string} accountId - Questrade account ID
 * @param {string} accountName - Account name for display
 * @returns {Promise<Object>} Upload result
 */
export async function uploadSingleAccountActivityToMonarch(accountId, accountName) {
  try {
    debugLog(`Starting single account activity upload for ${accountName} (${accountId})`);

    // Show loading toast
    toast.show(`Loading activity for ${accountName}...`, 'debug');

    // Get Monarch account mapping
    const monarchAccount = accountService.getMonarchAccountMapping(INTEGRATIONS.QUESTRADE, accountId);

    if (!monarchAccount) {
      toast.show(`No Monarch mapping for ${accountName}`, 'error');
      return {
        success: false,
        message: 'No Monarch account mapping found',
        accountId,
        accountName,
      };
    }

    // Create progress dialog for single account
    const progressDialog = showProgressDialog(
      [{ key: accountId, nickname: accountName }],
      `Uploading Activity for ${accountName}`,
    );

    try {
      // Upload activity for this account
      const result = await uploadActivityForAccount(accountId, accountName, monarchAccount.id, progressDialog);

      progressDialog.updateProgress(accountId, result.success ? 'success' : 'error', result.message);

      // Show final toast
      if (result.success) {
        if (result.transactionsProcessed > 0) {
          const skipMsg = result.skippedDuplicates > 0
            ? ` (${result.skippedDuplicates} duplicates skipped)`
            : '';
          toast.show(`Uploaded ${result.transactionsProcessed} transactions${skipMsg}`, 'info');
        } else {
          toast.show(result.message, 'info');
        }
      } else {
        toast.show(`Upload failed: ${result.message}`, 'error');
      }

      return {
        ...result,
        accountId,
        accountName,
      };
    } catch (error) {
      debugLog(`Error uploading activity for ${accountId}:`, error);
      progressDialog.updateProgress(accountId, 'error', `Error: ${error.message}`);
      toast.show(`Upload failed: ${error.message}`, 'error');
      return {
        success: false,
        message: error.message,
        accountId,
        accountName,
      };
    }
  } catch (error) {
    debugLog('Error in uploadSingleAccountActivityToMonarch:', error);
    toast.show(`Upload failed: ${error.message}`, 'error');
    return {
      success: false,
      message: error.message,
      accountId,
      accountName,
    };
  }
}

/**
 * Upload all activity transactions for ALL Questrade accounts to Monarch
 * This is a testing/development function for bulk uploading all activity history
 * @returns {Promise<Object>} Combined results for all accounts
 */
export async function uploadAllAccountsActivityToMonarch() {
  try {
    // Show loading toast
    toast.show('Loading Questrade accounts...', 'debug');

    // Fetch all accounts
    const accounts = await questradeApi.fetchAccounts();

    if (!accounts || accounts.length === 0) {
      toast.show('No Questrade accounts found', 'error');
      return { success: false, message: 'No accounts found' };
    }

    debugLog(`Found ${accounts.length} Questrade accounts for activity upload`);

    // Create progress dialog
    const progressDialog = showProgressDialog(
      (accounts as unknown as Record<string, unknown>[]).map((acc) => ({
        key: acc.key as string,
        nickname: (acc.nickname as string) || (acc.key as string),
      })),
      'Uploading All Activity',
    );

    const results = [];
    let totalTransactions = 0;
    let totalSkipped = 0;

    for (const account of (accounts as unknown as Record<string, unknown>[])) {
      const accountId = account.key as string;
      const accountName = (account.nickname as string) || accountId;

      try {
        progressDialog.updateProgress(accountId, 'processing', 'Getting Monarch mapping...');

        // Get Monarch account mapping
        const monarchAccount = accountService.getMonarchAccountMapping(INTEGRATIONS.QUESTRADE, accountId);

        if (!monarchAccount) {
          progressDialog.updateProgress(accountId, 'skipped', 'No Monarch mapping');
          results.push({
            accountId,
            accountName,
            success: false,
            message: 'No Monarch account mapping',
          });
          continue;
        }

        // Upload activity for this account
        const result = await uploadActivityForAccount(accountId, accountName, monarchAccount.id, progressDialog);

        progressDialog.updateProgress(accountId, result.success ? 'success' : 'error', result.message);

        results.push({
          accountId,
          accountName,
          ...result,
        });

        totalTransactions += result.transactionsProcessed || 0;
        totalSkipped += result.skippedDuplicates || 0;
      } catch (error) {
        debugLog(`Error processing account ${accountId}:`, error);
        progressDialog.updateProgress(accountId, 'error', `Error: ${error.message}`);
        results.push({
          accountId,
          accountName,
          success: false,
          message: error.message,
        });
      }
    }

    // Summary
    const successCount = results.filter((r) => r.success).length;
    const summaryMessage = `Completed: ${successCount}/${accounts.length} accounts, ${totalTransactions} transactions uploaded`;

    if (totalSkipped > 0) {
      toast.show(`${summaryMessage} (${totalSkipped} duplicates skipped)`, 'info');
    } else {
      toast.show(summaryMessage, 'info');
    }

    return {
      success: successCount > 0,
      message: summaryMessage,
      results,
      totalTransactions,
      totalSkipped,
    };
  } catch (error) {
    debugLog('Error uploading all accounts activity:', error);
    toast.show(`Upload failed: ${error.message}`, 'error');
    return { success: false, message: error.message };
  }
}

// Export default object
export default {
  processAndUploadTransactions,
  processAndUploadOrders,
  processAndUploadActivityTransactions,
  uploadAllAccountsActivityToMonarch,
  uploadSingleAccountActivityToMonarch,
  fetchQuestradeOrders,
  fetchAndProcessActivityTransactions,
  fetchAndProcessAllActivityTransactions,
  filterExecutedOrders,
  filterDuplicateOrders,
  filterDuplicateTransactions,
  filterNonTradeTransactions,
};
