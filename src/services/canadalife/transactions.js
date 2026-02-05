/**
 * Canada Life Transaction Service
 * Handles transaction/activity processing for Canada Life accounts
 */

import { debugLog, formatDate, parseLocalDate } from '../../core/utils';
import canadalife from '../../api/canadalife';
import toast from '../../ui/toast';

/**
 * Activity type to Monarch category mapping
 * Maps Canada Life activity types to corresponding Monarch categories
 */
const ACTIVITY_CATEGORY_MAP = {
  'New contribution': 'Buy',
  'New contribution (reversed)': 'Sell',
  'You switched from another subgroup/plan': 'Buy',
  'You switched to another subgroup/plan': 'Sell',
  'You switched from another investment': 'Buy',
  'You switched to another investment': 'Sell',
};

/**
 * Sanitize investment vehicle name by removing trailing suffixes like "-Member" or "-Employer"
 * @param {string} name - Investment vehicle name (e.g., "Canadian Equity Index (TDAM)-Member")
 * @returns {string} Sanitized name (e.g., "Canadian Equity Index (TDAM)")
 */
export function sanitizeInvestmentVehicleName(name) {
  if (!name || typeof name !== 'string') {
    return name || '';
  }

  // Split by hyphen and remove the last part if it's a known suffix
  const parts = name.split('-');
  if (parts.length > 1) {
    const lastPart = parts[parts.length - 1].toLowerCase();
    if (lastPart === 'member' || lastPart === 'employer') {
      return parts.slice(0, -1).join('-');
    }
  }

  return name;
}

/**
 * Map activity type to Monarch category
 * @param {string} activityType - Canada Life activity type
 * @returns {string} Monarch category name
 */
export function mapActivityToCategory(activityType) {
  if (!activityType || typeof activityType !== 'string') {
    return 'Uncategorized';
  }

  return ACTIVITY_CATEGORY_MAP[activityType] || 'Uncategorized';
}

/**
 * Generate a unique hash ID for an activity to enable deduplication
 * Uses SHA-256 hash of concatenated activity fields
 * @param {Object} activity - Canada Life activity object
 * @returns {Promise<string>} Hash ID string
 */
export async function generateActivityHash(activity) {
  // Concatenate key fields that uniquely identify an activity
  const hashInput = [
    activity.Date || '',
    activity.Activity || '',
    String(activity.Amount || 0),
    activity.InvestmentVehicleAndAccountLongName || '',
    String(activity.Units || 0),
  ].join('|');

  // Use Web Crypto API for SHA-256 hash
  const encoder = new TextEncoder();
  const data = encoder.encode(hashInput);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);

  // Convert buffer to hex string
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

  // Return first 16 characters for a shorter but still unique ID
  return `cl-${hashHex.substring(0, 16)}`;
}

/**
 * Convert ISO timestamp to local date in YYYY-MM-DD format
 * @param {string} isoTimestamp - ISO timestamp (e.g., "2026-01-30T00:00:00") or date string ("2026-01-30")
 * @returns {string} Local date in YYYY-MM-DD format
 */
function convertToLocalDate(isoTimestamp) {
  if (!isoTimestamp) return '';

  // If it's a date-only string (YYYY-MM-DD), use parseLocalDate to avoid timezone issues
  if (typeof isoTimestamp === 'string' && !isoTimestamp.includes('T')) {
    return formatDate(parseLocalDate(isoTimestamp));
  }

  const date = new Date(isoTimestamp);
  return formatDate(date);
}

/**
 * Generate transaction notes based on activity details
 * @param {Object} activity - Canada Life activity object
 * @returns {string} Formatted notes string
 */
function generateActivityNotes(activity) {
  const sanitizedName = sanitizeInvestmentVehicleName(activity.InvestmentVehicleAndAccountLongName);
  const units = activity.Units || 0;
  const price = activity.InterestRateOrUnitPrice || 0;
  const activityType = activity.Activity || 'Unknown activity';

  // Determine if this is a buy or sell based on amount sign
  const amount = activity.Amount || 0;
  const action = amount >= 0 ? 'Bought' : 'Sold';

  return `${activityType}: ${action} ${Math.abs(units).toFixed(6)} of ${sanitizedName} @ ${price.toFixed(6)}`;
}

/**
 * Process a single Canada Life activity into a transaction object
 * @param {Object} activity - Raw activity from Canada Life API
 * @param {string} accountName - Name of the account being synced
 * @returns {Promise<Object>} Processed transaction object
 */
export async function processCanadaLifeActivity(activity, accountName) {
  const transactionId = await generateActivityHash(activity);
  const sanitizedMerchant = sanitizeInvestmentVehicleName(activity.InvestmentVehicleAndAccountLongName);
  const category = mapActivityToCategory(activity.Activity);
  const notes = generateActivityNotes(activity);

  return {
    id: transactionId,
    date: convertToLocalDate(activity.Date),
    merchant: sanitizedMerchant,
    originalMerchant: activity.InvestmentVehicleAndAccountLongName || '',
    amount: activity.Amount || 0,
    category,
    notes,
    account: accountName,
    // Raw activity data for reference
    rawActivity: activity,
  };
}

/**
 * Generate date chunks for API calls (max 1 calendar year per call)
 * Uses calendar year chunks (e.g., 2023-02-04 → 2024-02-04) instead of 365-day chunks
 * to properly handle leap years and align with API's 1-year limit
 * @param {string} startDate - Start date in YYYY-MM-DD format
 * @param {string} endDate - End date in YYYY-MM-DD format
 * @returns {Array<{start: string, end: string}>} Array of date range chunks
 */
export function generateDateChunks(startDate, endDate) {
  const chunks = [];
  const start = parseLocalDate(startDate);
  const end = parseLocalDate(endDate);

  let currentStart = new Date(start);

  // Use <= to include the case where currentStart equals end (single day final chunk)
  while (currentStart <= end) {
    // Calculate chunk end date (1 calendar year from start or the final end date)
    const chunkEnd = new Date(currentStart);
    chunkEnd.setFullYear(chunkEnd.getFullYear() + 1);

    // Don't exceed the final end date
    const actualEnd = chunkEnd > end ? end : chunkEnd;

    chunks.push({
      start: formatDate(currentStart),
      end: formatDate(actualEnd),
    });

    // Move to next chunk (day after the current chunk end)
    currentStart = new Date(actualEnd);
    currentStart.setDate(currentStart.getDate() + 1);
  }

  return chunks;
}

/**
 * Fetch activities for a date range, handling the 1-year API limitation
 * @param {Object} account - Canada Life account object
 * @param {string} startDate - Start date in YYYY-MM-DD format
 * @param {string} endDate - End date in YYYY-MM-DD format
 * @param {Object} options - Options for fetching
 * @param {Function} options.onProgress - Progress callback (chunkIndex, totalChunks, chunkActivities)
 * @param {AbortSignal} options.signal - Abort signal for cancellation
 * @returns {Promise<Array>} Array of all activities in the date range
 */
export async function fetchActivitiesForDateRange(account, startDate, endDate, options = {}) {
  const { onProgress, signal } = options;

  // Generate date chunks (max 1 year each)
  const chunks = generateDateChunks(startDate, endDate);

  debugLog(`Fetching activities for ${account.EnglishShortName} in ${chunks.length} chunk(s)`, {
    startDate,
    endDate,
    chunks,
  });

  const allActivities = [];
  const seenHashes = new Set();

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];

    // Check for cancellation
    if (signal?.aborted) {
      throw new Error('Operation cancelled by user');
    }

    debugLog(`Fetching chunk ${i + 1}/${chunks.length}: ${chunk.start} to ${chunk.end}`);

    try {
      // Use the activity report API which returns activities for the date range
      const balanceData = await canadalife.loadAccountActivityReport(account, chunk.start, chunk.end, signal);

      // The balance API returns activities for the date range
      const chunkActivities = balanceData.activities || [];

      debugLog(`Chunk ${i + 1} returned ${chunkActivities.length} activities`);

      // Deduplicate activities using hash
      for (const activity of chunkActivities) {
        const hash = await generateActivityHash(activity);
        if (!seenHashes.has(hash)) {
          seenHashes.add(hash);
          allActivities.push(activity);
        }
      }

      // Report progress
      if (onProgress) {
        onProgress(i + 1, chunks.length, chunkActivities.length);
      }
    } catch (error) {
      debugLog(`Error fetching chunk ${i + 1}:`, error);
      toast.show(`Warning: Could not fetch activities for ${chunk.start} to ${chunk.end}`, 'warning');
    }
  }

  debugLog(`Total activities fetched: ${allActivities.length} (after deduplication)`);

  return allActivities;
}

/**
 * Fetch and process all transactions for a Canada Life account
 * @param {Object} account - Canada Life account object
 * @param {string} startDate - Start date in YYYY-MM-DD format
 * @param {string} endDate - End date in YYYY-MM-DD format
 * @param {Object} options - Processing options
 * @param {Function} options.onProgress - Progress callback
 * @param {AbortSignal} options.signal - Abort signal
 * @param {Set<string>} options.uploadedTransactionIds - Set of already uploaded transaction IDs
 * @returns {Promise<Array>} Array of processed transaction objects
 */
export async function fetchAndProcessTransactions(account, startDate, endDate, options = {}) {
  const { onProgress, signal, uploadedTransactionIds = new Set() } = options;
  const accountName = account.LongNameEnglish || account.EnglishShortName;

  debugLog(`Processing transactions for ${accountName} from ${startDate} to ${endDate}`);

  // Fetch all activities for the date range
  const activities = await fetchActivitiesForDateRange(account, startDate, endDate, {
    onProgress: (chunk, total, count) => {
      if (onProgress) {
        onProgress(`Fetching activities (${chunk}/${total}): ${count} found`);
      }
    },
    signal,
  });

  if (activities.length === 0) {
    debugLog('No activities found in the date range');
    return [];
  }

  // Process each activity into a transaction
  const transactions = [];
  let skippedCount = 0;

  for (let i = 0; i < activities.length; i++) {
    const activity = activities[i];

    // Process the activity
    const transaction = await processCanadaLifeActivity(activity, accountName);

    // Skip if already uploaded
    if (uploadedTransactionIds.has(transaction.id)) {
      skippedCount++;
      continue;
    }

    transactions.push(transaction);
  }

  debugLog(`Processed ${transactions.length} transactions (${skippedCount} already uploaded)`);

  // Sort by date (oldest first)
  transactions.sort((a, b) => new Date(a.date) - new Date(b.date));

  return transactions;
}

/**
 * Convert processed transactions to Monarch CSV format
 * @param {Array} transactions - Array of processed transaction objects
 * @returns {string} CSV formatted string for Monarch upload
 */
export function convertTransactionsToCSV(transactions) {
  if (!transactions || transactions.length === 0) {
    throw new Error('No transactions to convert');
  }

  // Monarch transaction CSV format
  // Date, Merchant, Category, Account, Original Statement, Notes, Amount
  let csv = '"Date","Merchant","Category","Account","Original Statement","Notes","Amount"\n';

  for (const tx of transactions) {
    const row = [
      tx.date,
      tx.merchant,
      tx.category,
      tx.account,
      tx.originalMerchant,
      tx.notes,
      tx.amount.toFixed(2),
    ].map((field) => `"${String(field).replace(/"/g, '""')}"`).join(',');

    csv += `${row}\n`;
  }

  return csv;
}

export default {
  sanitizeInvestmentVehicleName,
  mapActivityToCategory,
  generateActivityHash,
  processCanadaLifeActivity,
  generateDateChunks,
  fetchActivitiesForDateRange,
  fetchAndProcessTransactions,
  convertTransactionsToCSV,
  ACTIVITY_CATEGORY_MAP,
};
