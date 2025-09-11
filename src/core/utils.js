/**
 * Utility functions for the Questrade to Monarch balance uploader
 * This file will gradually replace inline utility functions in the original script
 */

import { DEBUG_LOG } from './config';

/**
 * Gets the current date in local timezone
 * @returns {Date} Current date in local timezone
 */
export function getLocalToday() {
  return new Date();
}

/**
 * Gets yesterday's date in local timezone
 * @returns {Date} Yesterday's date in local timezone
 */
export function getLocalYesterday() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return yesterday;
}

/**
 * Formats a date object to YYYY-MM-DD string format using local timezone
 * @param {Date} date - The date to format
 * @returns {string} Formatted date string in local timezone
 */
export function formatDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    debugLog('Invalid date passed to formatDate:', date);
    const fallbackDate = new Date(Date.now() - 12096e5); // Fallback to 2 weeks ago
    date = fallbackDate;
  }
  
  // Use local timezone methods to avoid UTC conversion
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Creates a Date object from YYYY-MM-DD string in local timezone
 * @param {string} dateString - Date string in YYYY-MM-DD format
 * @returns {Date} Date object in local timezone
 */
export function parseLocalDate(dateString) {
  if (!dateString || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    debugLog('Invalid date string passed to parseLocalDate:', dateString);
    return getLocalToday();
  }
  
  const [year, month, day] = dateString.split('-').map(Number);
  // Create date in local timezone (month is 0-indexed)
  return new Date(year, month - 1, day);
}

/**
 * Gets today's date formatted as YYYY-MM-DD in local timezone
 * @returns {string} Today's date string
 */
export function getTodayLocal() {
  return formatDate(getLocalToday());
}

/**
 * Gets yesterday's date formatted as YYYY-MM-DD in local timezone
 * @returns {string} Yesterday's date string
 */
export function getYesterdayLocal() {
  return formatDate(getLocalYesterday());
}

/**
 * Creates a date N days ago from today in local timezone
 * @param {number} days - Number of days to go back
 * @returns {Date} Date object N days ago
 */
export function getDaysAgoLocal(days) {
  const date = getLocalToday();
  date.setDate(date.getDate() - days);
  return date;
}

/**
 * Formats a date N days ago as YYYY-MM-DD string
 * @param {number} days - Number of days to go back
 * @returns {string} Formatted date string N days ago
 */
export function formatDaysAgoLocal(days) {
  return formatDate(getDaysAgoLocal(days));
}

/**
 * Debug logging function with support for objects
 * @param {string} message - The message to log
 * @param {any} obj - Optional object to log
 */
export function debugLog(message, obj) {
  if (!DEBUG_LOG) return;

  const prefix = '[Balance Uploader]';

  if (obj) {
    console.log(`${prefix} ${message}`, obj);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

/**
 * Extracts domain from a URL
 * @param {string} url - The URL to extract domain from
 * @returns {string} Extracted domain (e.g., amazon.com from subdomain.amazon.com)
 */
export function extractDomain(url) {
  if (!url) return '';

  try {
    // Remove protocol and get hostname
    const hostname = url.replace(/^(?:https?:\/\/)?(?:www\.)?/i, '').split('/')[0];

    // Get the domain (e.g., amazon.com from subdomain.amazon.com)
    const parts = hostname.split('.');
    if (parts.length >= 2) {
      return `${parts[parts.length - 2]}.${parts[parts.length - 1]}`.toLowerCase();
    }
    return hostname.toLowerCase();
  } catch (e) {
    return '';
  }
}

/**
 * Calculate similarity between two strings
 * Returns a score from 0 (no similarity) to 1 (identical)
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} Similarity score (0-1)
 */
export function stringSimilarity(str1, str2) {
  if (!str1 && !str2) return 1; // Both empty = identical
  if (!str1 || !str2) return 0; // One empty = no similarity

  // Convert both to lowercase for case-insensitive comparison
  str1 = str1.toLowerCase();
  str2 = str2.toLowerCase();

  // If exact match
  if (str1 === str2) return 1;

  // Simple partial matching
  if (str1.includes(str2) || str2.includes(str1)) {
    return 0.8;
  }

  // Calculate Levenshtein distance for more complex comparison
  const len1 = str1.length;
  const len2 = str2.length;

  // Create distance matrix
  const matrix = Array(len1 + 1).fill().map(() => Array(len2 + 1).fill(0));

  // Initialize first row and column
  for (let i = 0; i <= len1; i++) matrix[i][0] = i;
  for (let j = 0; j <= len2; j++) matrix[0][j] = j;

  // Fill the matrix
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // deletion
        matrix[i][j - 1] + 1, // insertion
        matrix[i - 1][j - 1] + cost, // substitution
      );
    }
  }

  // The last cell contains the Levenshtein distance
  const distance = matrix[len1][len2];

  // Convert to a similarity score between 0 and 1
  const maxLen = Math.max(len1, len2);
  if (maxLen === 0) return 1; // Handle edge case of empty strings
  return 1 - distance / maxLen;
}

/**
 * Gets account ID from current URL
 * @returns {string|null} Account ID from URL or null if not found
 */
export function getAccountIdFromUrl() {
  const matches = window.location.pathname.match(/\/accounts\/([^\/]+)/);
  return matches ? matches[1] : null;
}

/**
 * Checks if current page is the Questrade all accounts page
 * @returns {boolean} True if on all accounts page
 */
export function isQuestradeAllAccountsPage() {
  // Check that we're on the Questrade domain
  const isQuestradeDomain = window.location.hostname.endsWith('questrade.com');
  // Match the 'all accounts' page URL path (with or without trailing slash)
  const pathname = window.location.pathname;
  const isAllAccountsPath = pathname === '/investing/summary' || pathname === '/investing/summary/';

  return isQuestradeDomain && isAllAccountsPath;
}

export async function clearAllGmStorage() {
  try {
    const keys = await GM_listValues();
    await Promise.all(keys.map((key) => GM_deleteValue(key)));
    debugLog('Cleared all storage and token cache');
  } catch (error) {
    debugLog('Failed to clear Tampermonkey storage:', error);
  }
}

// Default export with all utility functions
export default {
  formatDate,
  getLocalToday,
  getLocalYesterday,
  parseLocalDate,
  getTodayLocal,
  getYesterdayLocal,
  getDaysAgoLocal,
  formatDaysAgoLocal,
  debugLog,
  extractDomain,
  stringSimilarity,
  getAccountIdFromUrl,
  isQuestradeAllAccountsPage,
  clearAllGmStorage,
};
