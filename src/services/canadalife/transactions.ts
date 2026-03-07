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
  'New contribution  - awaiting investment': 'Buy', // Pending activity - no Units yet
  'You switched from another subgroup/plan': 'Buy',
  'You switched to another subgroup/plan': 'Sell',
  'You switched from another investment': 'Buy',
  'You switched to another investment': 'Sell',
};

/**
 * Activity types that represent pending (not yet settled) transactions.
 * Pending activities have Units = null as the purchase hasn't happened yet.
 *
 * Trade-off: Canada Life pending activities produce a different hash than their
 * settled counterpart because both activity.Activity and activity.Units change
 * on settlement. Therefore reconciliation cannot detect settlement — when a
 * pending activity disappears from the Canada Life API (either settled or
 * cancelled), the Monarch pending transaction is always deleted. The settled
 * transaction is uploaded as a new independent entry. User tags and notes on
 * the pending entry are lost. This is an accepted trade-off since Canada Life
 * provides no stable ID linking pending to settled.
 */
const PENDING_ACTIVITY_TYPES = new Set([
  'New contribution  - awaiting investment',
]);

/**
 * Check if an activity type represents a pending transaction
 * @param {string} activityType - Canada Life activity type
 * @returns {boolean} True if the activity is pending
 */
export function isPendingActivity(activityType) {
  if (!activityType || typeof activityType !== 'string') {
    return false;
  }
  return PENDING_ACTIVITY_TYPES.has(activityType);
}

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
 * @returns {Promise<string>} Hash ID string in format cl-tx:{16 hex chars}
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
  // Format: cl-tx:{hash16} — colon separator required for extractPendingIdFromNotes regex compatibility
  return `cl-tx:${hashHex.substring(0, 16)}`;
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
  const activityType = activity.Activity || 'Unknown activity';
  const category = mapActivityToCategory(activityType);

  // For pending activities, Units is null — skip Units/price; show amount and target investment
  if (isPendingActivity(activityType)) {
    return `${activityType} of $${activity.Amount} into ${activity.InvestmentVehicleAndAccountLongName}`;
  }

  const units = activity.Units || 0;
  const price = activity.InterestRateOrUnitPrice || 0;

  // Determine if this is a buy or sell based on amount sign
  const amount = activity.Amount || 0;
  const action = amount >= 0 ? 'Bought' : 'Sold';

  let notes = `${activityType}: ${action} ${Math.abs(units).toFixed(6)} of ${sanitizedName} @ ${price.toFixed(6)}`;

  // For unknown activities, append the raw activity type for reference
  if (category === 'Uncategorized' && activityType) {
    notes += `\n'${activityType}'`;
  }

  return notes;
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
  const pending = isPendingActivity(activity.Activity);

  return {
    id: transactionId,
    date: convertToLocalDate(activity.Date),
    merchant: sanitizedMerchant,
    originalMerchant: activity.InvestmentVehicleAndAccountLongName || '',
    amount: activity.Amount || 0,
    category,
    notes,
    account: accountName,
    isPending: pending,
    pendingId: transactionId, // cl-tx:{hash} — used by CSV formatter for reconciliation notes
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
interface FetchActivitiesOptions {
  onProgress?: (chunkIndex: number, totalChunks: number, chunkActivities: number) => void;
  signal?: AbortSignal;
}

export async function fetchActivitiesForDateRange(account, startDate: string, endDate: string, options: FetchActivitiesOptions = {}) {
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
 * Process raw activities into transaction objects
 * @param {Array} activities - Raw activities from Canada Life API
 * @param {string} accountName - Name of the account being synced
 * @param {Object} options - Processing options
 * @param {Set<string>} options.uploadedTransactionIds - Set of already uploaded transaction IDs
 * @param {boolean} options.includePendingTransactions - Whether to include pending transactions (default: true)
 * @returns {Promise<Array>} Array of processed transaction objects, sorted oldest first
 */
interface ProcessActivitiesOptions {
  uploadedTransactionIds?: Set<string>;
  includePendingTransactions?: boolean;
}

export async function processActivities(activities, accountName: string, options: ProcessActivitiesOptions = {}) {
  const { uploadedTransactionIds = new Set<string>(), includePendingTransactions = true } = options;

  if (!activities || activities.length === 0) {
    return [];
  }

  const transactions = [];
  let skippedCount = 0;

  for (const activity of activities) {
    const transaction = await processCanadaLifeActivity(activity, accountName);

    // Skip if already uploaded
    if (uploadedTransactionIds.has(transaction.id)) {
      skippedCount++;
      continue;
    }

    // Skip pending transactions if disabled by user setting
    if (transaction.isPending && !includePendingTransactions) {
      debugLog(`Skipping pending transaction ${transaction.id} (includePendingTransactions=false)`);
      continue;
    }

    transactions.push(transaction);
  }

  debugLog(`Processed ${transactions.length} transactions (${skippedCount} already uploaded)`);

  // Sort by date (oldest first)
  transactions.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return transactions;
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
 * @param {boolean} options.includePendingTransactions - Whether to include pending transactions (default: true)
 * @returns {Promise<Array>} Array of processed transaction objects
 */
interface FetchAndProcessOptions {
  onProgress?: (message: string) => void;
  signal?: AbortSignal;
  uploadedTransactionIds?: Set<string>;
  includePendingTransactions?: boolean;
}

export async function fetchAndProcessTransactions(account, startDate: string, endDate: string, options: FetchAndProcessOptions = {}) {
  const {
    onProgress,
    signal,
    uploadedTransactionIds = new Set<string>(),
    includePendingTransactions = true,
  } = options;
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

  return processActivities(activities, accountName, { uploadedTransactionIds, includePendingTransactions });
}

export default {
  isPendingActivity,
  sanitizeInvestmentVehicleName,
  mapActivityToCategory,
  generateActivityHash,
  processCanadaLifeActivity,
  processActivities,
  generateDateChunks,
  fetchActivitiesForDateRange,
  fetchAndProcessTransactions,
  ACTIVITY_CATEGORY_MAP,
  PENDING_ACTIVITY_TYPES,
};