/**
 * Questrade Transactions Service
 * Handles fetching orders from Questrade and uploading them as transactions to Monarch
 */

import { debugLog, getTodayLocal, saveLastUploadDate } from '../../core/utils';
import { INTEGRATIONS } from '../../core/integrationCapabilities';
import questradeApi from '../../api/questrade';
import monarchApi from '../../api/monarch';
import accountService from '../common/accountService';
import toast from '../../ui/toast';
import { convertQuestradeOrdersToMonarchCSV } from '../../utils/csv';
import { applyCategoryMapping, saveUserCategorySelection, calculateAllCategorySimilarities } from '../../mappers/category';
import { showMonarchCategorySelector } from '../../ui/components/categorySelector';
import { getUploadedTransactionIds, saveUploadedTransactions } from '../../utils/transactionStorage';

/**
 * Filter out already uploaded orders
 * @param {Array} orders - Array of orders
 * @param {string} accountId - Questrade account ID
 * @returns {Object} Filtered orders and statistics
 */
function filterDuplicateOrders(orders, accountId) {
  // Use new transaction storage utility to get uploaded IDs
  const uploadedIds = getUploadedTransactionIds(accountId, 'questrade');
  const uploadedUUIDs = new Set(uploadedIds);
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
 * Resolve categories for orders, handling both automatic mapping and manual selection
 * @param {Array} orders - Array of orders to process
 * @returns {Promise<Array>} Orders with resolved Monarch categories
 */
async function resolveCategoriesForOrders(orders) {
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
      const transactionDetails = {};
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
        showMonarchCategorySelector(actionToResolve.bankCategory, resolve, similarityData, transactionDetails);
      });

      if (!selectedCategory) {
        // User cancelled - this will abort the upload
        throw new Error(`Category selection cancelled for "${actionToResolve.bankCategory}". Upload aborted.`);
      }

      // Save the user's selection for future use
      saveUserCategorySelection(actionToResolve.bankCategory, selectedCategory.name);
      debugLog(`User selected category mapping: ${actionToResolve.bankCategory} -> ${selectedCategory.name}`);

      toast.show(`Mapped "${actionToResolve.bankCategory}" to "${selectedCategory.name}"`, 'debug');
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
 * Process and upload transactions for a Questrade account
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

    if (progressDialog) {
      progressDialog.updateProgress(accountId, 'processing', 'Fetching orders from Questrade...');
    }

    // Fetch orders
    const allOrders = await fetchQuestradeOrders(accountId, fromDate);

    if (!allOrders || allOrders.length === 0) {
      debugLog('No orders found for the specified date range');
      if (progressDialog) {
        progressDialog.updateProgress(accountId, 'success', 'No orders found to upload');
      }
      return {
        success: true,
        message: 'No orders found',
        ordersProcessed: 0,
      };
    }

    if (progressDialog) {
      progressDialog.updateProgress(accountId, 'processing', `Processing ${allOrders.length} orders...`);
    }

    // Filter to only executed orders
    const executedOrders = filterExecutedOrders(allOrders);

    if (executedOrders.length === 0) {
      debugLog('No executed orders found');
      if (progressDialog) {
        progressDialog.updateProgress(accountId, 'success', 'No executed orders found to upload');
      }
      return {
        success: true,
        message: 'No executed orders found',
        ordersProcessed: 0,
      };
    }

    // Filter out duplicate orders
    if (progressDialog) {
      progressDialog.updateProgress(accountId, 'processing', `Checking for duplicate orders among ${executedOrders.length} executed orders...`);
    }

    const filterResult = filterDuplicateOrders(executedOrders, accountId);
    const ordersToUpload = filterResult.orders;

    if (ordersToUpload.length === 0) {
      const message = filterResult.duplicateCount > 0
        ? `All ${filterResult.duplicateCount} orders have already been uploaded`
        : 'No new orders to upload';
      debugLog(message);
      if (progressDialog) {
        progressDialog.updateProgress(accountId, 'success', message);
      }
      return {
        success: true,
        message,
        ordersProcessed: 0,
        skippedDuplicates: filterResult.duplicateCount,
      };
    }

    // Show info about duplicates if any
    if (filterResult.duplicateCount > 0) {
      debugLog(`Processing ${ordersToUpload.length} new orders (skipped ${filterResult.duplicateCount} duplicates)`);
      if (progressDialog) {
        progressDialog.updateProgress(accountId, 'processing', `Found ${ordersToUpload.length} new orders (${filterResult.duplicateCount} duplicates skipped)`);
      }
    } else if (progressDialog) {
      progressDialog.updateProgress(accountId, 'processing', `Found ${ordersToUpload.length} new orders to upload`);
    }

    // Resolve categories for all orders
    if (progressDialog) {
      progressDialog.updateProgress(accountId, 'processing', 'Resolving order categories...');
    }

    const ordersWithResolvedCategories = await resolveCategoriesForOrders(ordersToUpload);

    // Convert orders to Monarch CSV format
    if (progressDialog) {
      progressDialog.updateProgress(accountId, 'processing', `Converting ${ordersToUpload.length} orders to CSV format...`);
    }

    const csvData = convertQuestradeOrdersToMonarchCSV(ordersWithResolvedCategories, accountName);

    if (!csvData) {
      throw new Error('Failed to convert orders to CSV');
    }

    // Get Monarch account mapping from consolidated storage (or legacy fallback)
    const monarchAccount = accountService.getMonarchAccountMapping(INTEGRATIONS.QUESTRADE, accountId);

    if (!monarchAccount) {
      throw new Error('Account mapping cancelled or not found');
    }

    // Upload to Monarch
    const uploadMessage = filterResult.duplicateCount > 0
      ? `Uploading ${ordersToUpload.length} new orders to Monarch (${filterResult.duplicateCount} duplicates skipped)...`
      : `Uploading ${ordersToUpload.length} orders to Monarch...`;

    if (progressDialog) {
      progressDialog.updateProgress(accountId, 'processing', uploadMessage);
    }

    const toDate = getTodayLocal();
    const filename = `questrade_orders_${accountId}_${fromDate}_to_${toDate}.csv`;
    const uploadSuccess = await monarchApi.uploadTransactions(
      monarchAccount.id,
      csvData,
      filename,
      false, // shouldUpdateBalance = false (balance is handled separately)
      false, // skipCheckForDuplicates = false
    );

    if (uploadSuccess) {
      // Save order UUIDs with dates for successful uploads
      const orderUUIDs = ordersToUpload
        .map((order) => order.orderUuid)
        .filter((uuid) => uuid);

      if (orderUUIDs.length > 0) {
        // Extract dates for each order
        const transactionsWithDates = ordersToUpload.map((order) => {
          let date = toDate; // Default to today
          if (order.updatedDateTime) {
            const orderDate = new Date(order.updatedDateTime);
            date = orderDate.toISOString().split('T')[0];
          }
          return {
            id: order.orderUuid,
            date,
          };
        }).filter((t) => t.id); // Filter out any without IDs

        // Use new transaction storage utility with dates
        saveUploadedTransactions('questrade', accountId, transactionsWithDates);
      }

      // Save last upload date
      saveLastUploadDate(accountId, toDate, 'questrade');

      const successMessage = filterResult.duplicateCount > 0
        ? `Successfully uploaded ${ordersToUpload.length} new orders (${filterResult.duplicateCount} duplicates skipped)`
        : `Successfully uploaded ${ordersToUpload.length} orders`;

      debugLog(successMessage);
      if (progressDialog) {
        progressDialog.updateProgress(accountId, 'success', successMessage);
      }

      return {
        success: true,
        message: successMessage,
        ordersProcessed: ordersToUpload.length,
        skippedDuplicates: filterResult.duplicateCount,
      };
    }

    throw new Error('Upload to Monarch failed');
  } catch (error) {
    debugLog(`Error processing transactions for account ${accountId}:`, error);
    if (progressDialog) {
      progressDialog.updateProgress(accountId, 'error', `Transaction upload failed: ${error.message}`);
    }
    throw error;
  }
}

// Export default object
export default {
  processAndUploadTransactions,
  fetchQuestradeOrders,
  filterExecutedOrders,
  filterDuplicateOrders,
};
