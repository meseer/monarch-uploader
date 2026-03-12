/**
 * Utility functions for the Questrade to Monarch balance uploader
 * This file will gradually replace inline utility functions in the original script
 */

import { STORAGE, TRANSACTION_RETENTION_DEFAULTS } from './config';
import { INTEGRATIONS } from './integrationCapabilities';
import { getSetting, setSetting } from '../services/common/configStore';
import toast from '../ui/toast';
import accountService from '../services/common/accountService';

/**
 * Gets the current date in local timezone
 */
export function getLocalToday(): Date {
  return new Date();
}

/**
 * Formats the current time as a timestamp string
 */
function formatTimestamp(): string {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  return `${hours}:${minutes}:${seconds}.${ms}`;
}

type LogLevel = 'debug' | 'info' | 'warning' | 'error';

/**
 * Debug logging function
 */
export function debugLog(...args: unknown[]): void {
  const level: LogLevel = args.length > 0 && typeof args[args.length - 1] === 'string'
    && ['debug', 'info', 'warning', 'error'].includes(args[args.length - 1] as string)
    ? args.pop() as LogLevel : 'debug';

  const currentLogLevel = GM_getValue('debug_log_level', 'info') as string;
  const logLevels: Record<string, number> = {
    debug: 0, info: 1, warning: 2, error: 3,
  };

  // Only log if the message level is at or above the current log level
  if (logLevels[level] >= logLevels[currentLogLevel]) {
    const timestamp = `[${formatTimestamp()}]`;
    const prefix = `${timestamp}[${level.toUpperCase()}][Monarch Uploader]`;

    if (level === 'error') {
      console.error(prefix, ...args);
    } else if (level === 'warning') {
      console.warn(prefix, ...args);
    } else if (level === 'info') {
      console.info(prefix, ...args);
    } else {
      console.log(prefix, ...args);
    }
  }
}

/**
 * Helper functions for specific log levels
 */
export const logInfo = (...args: unknown[]): void => debugLog(...args, 'info');
export const logWarning = (...args: unknown[]): void => debugLog(...args, 'warning');
export const logError = (...args: unknown[]): void => debugLog(...args, 'error');

/**
 * Formats a date object to YYYY-MM-DD string format using local timezone
 */
export function formatDate(date: Date): string {
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
 */
export function parseLocalDate(dateString: string): Date {
  if (!dateString || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    debugLog('Invalid date string passed to parseLocalDate:', dateString);
    return getLocalToday();
  }

  const [year, month, day] = dateString.split('-').map(Number);
  // Create date in local timezone (month is 0-indexed)
  return new Date(year, month - 1, day);
}

/**
 * Gets the current lookback period for an institution.
 * Reads from configStore. Rogers Bank still has legacy migrate-on-read;
 * Questrade, Canada Life, and Wealthsimple migration is complete.
 */
export function getLookbackForInstitution(institutionType: string): number {
  const defaultLookback = getDefaultLookbackDays(institutionType);

  // Integration ID mapping for legacy integrations.
  // Modular integrations (e.g., 'mbna') use their ID directly.
  const legacyIntegrationIdMap: Record<string, string> = {
    wealthsimple: INTEGRATIONS.WEALTHSIMPLE,
    questrade: INTEGRATIONS.QUESTRADE,
    canadalife: INTEGRATIONS.CANADALIFE,
    rogersbank: INTEGRATIONS.ROGERSBANK,
  };

  const integrationId = legacyIntegrationIdMap[institutionType] || institutionType;

  // Read from configStore
  const configValue = getSetting(integrationId, 'lookbackDays', undefined);
  if (configValue !== undefined) {
    return configValue as number;
  }

  // Rogers Bank: migrate-on-read from legacy key
  if (institutionType === 'rogersbank') {
    const legacyValue = GM_getValue(STORAGE.ROGERSBANK_LOOKBACK_DAYS, undefined);
    if (legacyValue !== undefined) {
      debugLog(`getLookbackForInstitution: Migrating legacy lookback for rogersbank: ${legacyValue} -> configStore`);
      setSetting(INTEGRATIONS.ROGERSBANK, 'lookbackDays', legacyValue);
      GM_deleteValue(STORAGE.ROGERSBANK_LOOKBACK_DAYS);
      debugLog(`getLookbackForInstitution: Deleted legacy key ${STORAGE.ROGERSBANK_LOOKBACK_DAYS}`);
      return legacyValue as number;
    }
  }

  // No value found  save default to configStore so the key is created
  setSetting(integrationId, 'lookbackDays', defaultLookback);
  return defaultLookback;
}

/**
 * Gets today's date formatted as YYYY-MM-DD in local timezone
 */
export function getTodayLocal(): string {
  return formatDate(getLocalToday());
}

/**
 * Gets yesterday's date in local timezone
 */
export function getLocalYesterday(): Date {
  const date = getLocalToday();
  date.setDate(date.getDate() - 1);
  return date;
}

/**
 * Gets yesterday's date formatted as YYYY-MM-DD in local timezone
 */
export function getYesterdayLocal(): string {
  return formatDate(getLocalYesterday());
}

/**
 * Creates a date N days ago from today in local timezone
 */
export function getDaysAgoLocal(days: number): Date {
  const date = getLocalToday();
  date.setDate(date.getDate() - days);
  return date;
}

/**
 * Formats a date N days ago as YYYY-MM-DD string
 */
export function formatDaysAgoLocal(days: number): string {
  return formatDate(getDaysAgoLocal(days));
}

/**
 * Creates a date N days before a specific date
 */
export function formatDaysBeforeDate(baseDate: string | Date, days: number): string {
  let date: Date;
  if (typeof baseDate === 'string') {
    date = parseLocalDate(baseDate);
  } else if (baseDate instanceof Date) {
    date = new Date(baseDate);
  } else {
    debugLog('Invalid base date provided to formatDaysBeforeDate:', baseDate);
    return formatDaysAgoLocal(days);
  }

  date.setDate(date.getDate() - days);
  return formatDate(date);
}

/**
 * Gets the default lookback period for an institution
 */
export function getDefaultLookbackDays(institutionType: string): number {
  switch (institutionType) {
  case 'questrade':
    return 0; // Uses exact last upload date
  case 'canadalife':
    return 1; // Day after last upload = 1 day lookback
  case 'rogersbank':
    return 7; // Current 7 day lookback behavior
  case 'wealthsimple':
    return 7; // 7 day lookback for balance checkpoints
  default: {
    // Check registry for modular integrations (e.g. 'mbna').
    // Lazy require to avoid circular dependency (integrationRegistry → utils).
    const reg = require('./integrationRegistry');
    const entry = reg.getIntegration ? reg.getIntegration(institutionType) : undefined;
    if (entry?.manifest?.defaultLookbackDays !== undefined) {
      return entry.manifest.defaultLookbackDays;
    }
    debugLog(`Unknown institution type: ${institutionType}, using 0 days`);
    return 0;
  }
  }
}

/**
 * Maps institution type string to integration ID for accountService
 */
function getIntegrationIdFromType(institutionType: string): string | null {
  switch (institutionType) {
  case 'questrade':
    return 'questrade';
  case 'canadalife':
    return 'canadalife';
  case 'rogersbank':
    return 'rogersbank';
  case 'wealthsimple':
    return 'wealthsimple';
  default: {
    // Check registry for modular integrations (e.g. 'mbna').
    // Lazy require to avoid circular dependency (integrationRegistry → utils).
    const reg = require('./integrationRegistry');
    const isRegistered = reg.isRegistered ? reg.isRegistered(institutionType) : false;
    if (isRegistered) {
      return institutionType;
    }
    return null;
  }
  }
}

/**
 * Gets the last update date for an account based on institution type.
 * Checks consolidated storage (accountService) first.
 * Falls back to legacy keys only for Rogers Bank (still dual-writing).
 * Questrade and Canada Life have completed migration — no legacy fallback.
 */
export function getLastUpdateDate(accountId: string, institutionType: string): string | null {
  // First try consolidated storage
  const integrationId = getIntegrationIdFromType(institutionType);
  if (integrationId) {
    const accountData = accountService.getAccountData(integrationId, accountId);
    if (accountData?.lastSyncDate) {
      debugLog(`getLastUpdateDate: Found lastSyncDate in consolidated storage for ${institutionType}/${accountId}: ${accountData.lastSyncDate}`);
      return accountData.lastSyncDate as string;
    }
  }

  if (institutionType !== 'questrade' && institutionType !== 'canadalife' && institutionType !== 'wealthsimple' && institutionType !== 'rogersbank') {
    debugLog(`Unknown institution type: ${institutionType}`);
  }
  return null;
}

/**
 * Calculates the from date for an upload based on last upload date and configurable lookback
 */
export function calculateFromDateWithLookback(institutionType: string, accountId: string): string | null {
  const lastUploadDate = getLastUpdateDate(accountId, institutionType);

  if (!lastUploadDate) {
    // No previous upload date - caller should handle showing date picker
    return null;
  }

  // Get configurable lookback period from configStore (with legacy migrate-on-read)
  const lookbackDays = getLookbackForInstitution(institutionType);

  debugLog(`Calculating from date for ${institutionType} account ${accountId}: lastUploadDate=${lastUploadDate}, lookback=${lookbackDays} days`);

  // Calculate: lastUploadDate - lookbackDays
  const fromDate = formatDaysBeforeDate(lastUploadDate, lookbackDays);

  debugLog(`Calculated from date: ${fromDate}`);
  return fromDate;
}

/**
 * Saves the last upload date for an account based on institution type.
 * Saves to consolidated storage first, then also to legacy keys for backward compatibility.
 */
export function saveLastUploadDate(accountId: string, uploadDate: string, institutionType: string): void {
  // Save to consolidated storage first
  const integrationId = getIntegrationIdFromType(institutionType);
  if (integrationId) {
    const success = accountService.updateAccountInList(integrationId, accountId, {
      lastSyncDate: uploadDate,
    });
    if (success) {
      debugLog(`saveLastUploadDate: Saved lastSyncDate to consolidated storage for ${institutionType}/${accountId}: ${uploadDate}`);
    } else {
      debugLog(`saveLastUploadDate: Account ${accountId} not found in consolidated storage for ${institutionType}, will create on next sync`);
    }
  }
}
/**
 * Extracts domain from a URL
 */
export function extractDomain(url: string): string {
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
  } catch {
    return '';
  }
}

/**
 * Semantic keyword groups for category matching
 * Each group contains related terms that should be considered similar
 */
const SEMANTIC_KEYWORDS: Record<string, string[]> = {
  grocery: ['grocery', 'groceries', 'supermarket', 'food', 'market', 'store'],
  restaurant: ['restaurant', 'restaurants', 'dining', 'eatery', 'food', 'bar', 'bars', 'cafe', 'coffee'],
  gas: ['gas', 'fuel', 'petroleum', 'station', 'gasoline', 'petrol'],
  bank: ['bank', 'banking', 'financial', 'atm', 'credit', 'debit'],
  medical: ['medical', 'health', 'healthcare', 'doctor', 'clinic', 'hospital', 'pharmacy'],
  shopping: ['shopping', 'retail', 'store', 'mall', 'boutique', 'merchandise'],
  transport: ['transport', 'transportation', 'travel', 'transit', 'taxi', 'uber', 'lyft'],
  government: ['government', 'municipal', 'federal', 'tax', 'service', 'public'],
  entertainment: ['entertainment', 'movie', 'theater', 'game', 'recreation', 'fun'],
  education: ['education', 'school', 'university', 'college', 'learning', 'academic'],
};

/**
 * Common stop words to remove during tokenization
 */
const STOP_WORDS = new Set([
  'and', 'or', 'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
  'by', 'from', 'up', 'about', 'into', 'through', 'during', '&', 'plus',
]);

/**
 * Common abbreviations and their expansions
 */
const ABBREVIATIONS: Record<string, string> = {
  st: 'street',
  ave: 'avenue',
  blvd: 'boulevard',
  dr: 'drive',
  rd: 'road',
  govt: 'government',
  gov: 'government',
  dept: 'department',
  svcs: 'services',
  svc: 'service',
  co: 'company',
  corp: 'corporation',
  inc: 'incorporated',
  ltd: 'limited',
  llc: 'company',
};

/**
 * Normalize and clean a string for comparison
 */
function normalizeString(str: string): string {
  if (!str) return '';

  return str
    .toLowerCase()
    .trim()
    // Remove special characters and punctuation, keep spaces and alphanumeric
    .replace(/[^\w\s]/g, ' ')
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tokenize a string into words with preprocessing
 */
function tokenizeString(str: string): string[] {
  if (!str) return [];

  const normalized = normalizeString(str);

  // Split into words
  let words = normalized.split(/\s+/).filter((word) => word.length > 0);

  // Expand abbreviations
  words = words.map((word) => ABBREVIATIONS[word] || word);

  // Remove stop words
  words = words.filter((word) => !STOP_WORDS.has(word));

  // Apply simple stemming for common plurals
  words = words.map((word) => {
    if (word.endsWith('ies') && word.length > 4) {
      return `${word.slice(0, -3)}y`; // groceries -> grocery
    }
    if (word.endsWith('s') && word.length > 3 && !word.endsWith('ss')) {
      return word.slice(0, -1); // stores -> store, but not 'business' -> 'busines'
    }
    return word;
  });

  return words.filter((word) => word.length > 1); // Remove single character words
}

/**
 * Expand word tokens with semantic synonyms
 */
function expandWithSynonyms(words: string[]): Set<string> {
  const expandedWords = new Set(words);

  // For each word, check if it belongs to any semantic group
  words.forEach((word) => {
    Object.entries(SEMANTIC_KEYWORDS).forEach(([, synonyms]) => {
      if (synonyms.includes(word)) {
        // Add all synonyms from this group
        synonyms.forEach((synonym) => expandedWords.add(synonym));
      }
    });
  });

  return expandedWords;
}

/**
 * Calculate Jaccard similarity between two sets
 */
function calculateJaccardSimilarity(set1: Set<string>, set2: Set<string>): number {
  if (set1.size === 0 && set2.size === 0) return 1;
  if (set1.size === 0 || set2.size === 0) return 0;

  const intersection = new Set([...set1].filter((x) => set2.has(x)));
  const union = new Set([...set1, ...set2]);

  return intersection.size / union.size;
}

/**
 * Calculate enhanced similarity between two strings using Jaccard similarity with semantic expansion
 * Returns a score from 0 (no similarity) to 1 (identical)
 */
export function stringSimilarity(str1: string, str2: string): number {
  if (!str1 && !str2) return 1; // Both empty = identical
  if (!str1 || !str2) return 0; // One empty = no similarity

  // Quick exact match check after normalization
  const norm1 = normalizeString(str1);
  const norm2 = normalizeString(str2);
  if (norm1 === norm2) return 1;

  // Tokenize both strings
  const words1 = tokenizeString(str1);
  const words2 = tokenizeString(str2);

  // If either has no meaningful words after processing, return 0
  if (words1.length === 0 || words2.length === 0) return 0;

  // Calculate base Jaccard similarity with original words
  const baseSet1 = new Set(words1);
  const baseSet2 = new Set(words2);
  const baseSimilarity = calculateJaccardSimilarity(baseSet1, baseSet2);

  // Calculate enhanced similarity with semantic expansion
  const expandedSet1 = expandWithSynonyms(words1);
  const expandedSet2 = expandWithSynonyms(words2);
  const expandedSimilarity = calculateJaccardSimilarity(expandedSet1, expandedSet2);

  // Use the higher of the two similarities, but give preference to exact word matches
  // If we have exact word matches, weight them more heavily
  const exactWordMatches = [...baseSet1].filter((word) => baseSet2.has(word)).length;
  const hasExactMatches = exactWordMatches > 0;

  let finalSimilarity: number;
  if (hasExactMatches) {
    // If we have exact word matches, prioritize base similarity but boost with semantic expansion
    finalSimilarity = Math.max(baseSimilarity, expandedSimilarity * 0.8);

    // Apply significant boost for exact matches
    const matchRatio = exactWordMatches / Math.min(baseSet1.size, baseSet2.size);
    finalSimilarity = Math.min(1, finalSimilarity + (matchRatio * 0.3));
  } else {
    // No exact matches, rely primarily on semantic expansion
    finalSimilarity = expandedSimilarity;

    // Apply a moderate boost if semantic expansion found good matches
    if (expandedSimilarity > 0.5) {
      finalSimilarity = Math.min(1, finalSimilarity * 1.2);
    }
  }

  // Only log detailed similarity calculations in debug mode
  const currentLogLevel = GM_getValue('debug_log_level', 'info') as string;
  if (currentLogLevel === 'debug') {
    debugLog(`Similarity calculation for "${str1}" vs "${str2}":`, {
      words1,
      words2,
      baseSimilarity: baseSimilarity.toFixed(3),
      expandedSimilarity: expandedSimilarity.toFixed(3),
      exactWordMatches,
      finalSimilarity: finalSimilarity.toFixed(3),
    });
  }

  return Math.min(1, Math.max(0, finalSimilarity));
}

/**
 * Gets account ID from URL
 */
export function getAccountIdFromUrl(location: Location = window.location): string | null {
  const matches = location.pathname.match(/\/accounts\/([^/]+)/);
  return matches ? matches[1] : null;
}

/**
 * Checks if page is the Questrade all accounts page
 */
export function isQuestradeAllAccountsPage(location: Location = window.location): boolean {
  // Check that we're on the Questrade domain
  const isQuestradeDomain = location.hostname.endsWith('questrade.com');
  // Match the 'all accounts' page URL path (with or without trailing slash)
  const { pathname } = location;
  const isAllAccountsPath = pathname === '/investing/summary' || pathname === '/investing/summary/';

  return isQuestradeDomain && isAllAccountsPath;
}

export async function clearAllGmStorage(): Promise<void> {
  try {
    const keys = await GM_listValues();
    await Promise.all(keys.map((key) => GM_deleteValue(key)));
    debugLog('Cleared all storage and token cache');
    toast.show('All cached data cleared', 'info');
  } catch (error) {
    debugLog('Failed to clear Tampermonkey storage:', error);
    toast.show('Failed to clear cached data', 'error');
  }
}

/**
 * Gets the financial institution from hostname
 */
export function getCurrentInstitution(location: Location = window.location): string {
  const { hostname } = location;
  if (hostname.includes('questrade.com')) return 'questrade';
  if (hostname.includes('canadalife.com')) return 'canadalife';
  if (hostname.includes('rogersbank.com')) return 'rogersbank';
  if (hostname.includes('wealthsimple.com')) return 'wealthsimple';
  if (hostname.includes('monarch.com')) return 'monarch';
  return 'unknown';
}

/**
 * Clears transaction upload history (currently only Rogers Bank has this)
 */
export async function clearTransactionUploadHistory(location: Location = window.location): Promise<void> {
  try {
    const institution = getCurrentInstitution(location);
    const keys = await GM_listValues();
    // Currently only Rogers Bank has uploaded transaction references
    if (institution === 'rogersbank') {
      const keysToDelete = keys.filter((key) => key.startsWith(STORAGE.ROGERSBANK_UPLOADED_REFS_PREFIX));
      await Promise.all(keysToDelete.map((key) => GM_deleteValue(key)));
      debugLog(`Cleared ${keysToDelete.length} Rogers Bank transaction upload history keys`);
      toast.show('Transaction upload history cleared', 'info');
    } else {
      debugLog('No transaction upload history to clear for this institution');
      toast.show('No transaction history to clear', 'debug');
    }
  } catch (error) {
    debugLog('Failed to clear transaction upload history:', error);
    toast.show('Failed to clear transaction history', 'error');
  }
}

/**
 * Clears category mappings for the financial institution
 */
export async function clearCategoryMappings(location: Location = window.location): Promise<void> {
  try {
    const institution = getCurrentInstitution(location);
    let institutionName = '';

    switch (institution) {
    case 'rogersbank': {
      // Clear from both configStore and legacy key
      const { saveCategoryMappings: saveRBMappings } = await import('../services/common/configStore');
      saveRBMappings(INTEGRATIONS.ROGERSBANK, {});
      await GM_deleteValue(STORAGE.ROGERSBANK_CATEGORY_MAPPINGS);
      institutionName = 'Rogers Bank';
      break;
    }
    case 'wealthsimple': {
      // Clear from configStore only  legacy migration completed
      const { saveCategoryMappings } = await import('../services/common/configStore');
      saveCategoryMappings(INTEGRATIONS.WEALTHSIMPLE, {});
      institutionName = 'Wealthsimple';
      break;
    }
    default:
      debugLog('No category mappings to clear for this institution');
      toast.show('No category mappings to clear', 'debug');
      return;
    }

    debugLog(`Cleared ${institutionName} category mappings`);
    toast.show(`${institutionName} category mappings cleared`, 'info');
  } catch (error) {
    debugLog('Failed to clear category mappings:', error);
    toast.show('Failed to clear category mappings', 'error');
  }
}

/**
 * Clears account mapping for the financial institution
 */
export async function clearAccountMapping(location: Location = window.location): Promise<void> {
  try {
    const institution = getCurrentInstitution(location);
    const keys = await GM_listValues();
    let prefix: string | null = null;
    let institutionName = '';

    switch (institution) {
    case 'rogersbank':
      prefix = STORAGE.ROGERSBANK_ACCOUNT_MAPPING_PREFIX;
      institutionName = 'Rogers Bank';
      break;
    default:
      debugLog('Not on a supported financial institution site or no legacy account mapping keys');
      toast.show('No legacy account mappings to clear', 'info');
      return;
    }

    const keysToDelete = keys.filter((key) => key.startsWith(prefix));
    await Promise.all(keysToDelete.map((key) => GM_deleteValue(key)));

    debugLog(`Cleared ${keysToDelete.length} ${institutionName} account mapping keys`);
    toast.show(`${institutionName} account mappings cleared`, 'info');
  } catch (error) {
    debugLog('Failed to clear account mapping:', error);
    toast.show('Failed to clear account mappings', 'error');
  }
}

/**
 * Clears last uploaded date for the financial institution
 */
export async function clearLastUploadedDate(location: Location = window.location): Promise<void> {
  try {
    const institution = getCurrentInstitution(location);
    const keys = await GM_listValues();
    const keysToDelete: string[] = [];
    let institutionName = '';

    switch (institution) {
    case 'rogersbank':
      institutionName = 'Rogers Bank';
      keysToDelete.push(...keys.filter((key) => key.startsWith(STORAGE.ROGERSBANK_LAST_UPLOAD_DATE_PREFIX)));
      break;
    default:
      debugLog('Not on a supported financial institution site or no legacy upload date keys');
      toast.show('No legacy upload dates to clear', 'info');
      return;
    }

    await Promise.all(keysToDelete.map((key) => GM_deleteValue(key)));

    debugLog(`Cleared ${keysToDelete.length} ${institutionName} last uploaded date keys`);
    toast.show(`${institutionName} last uploaded dates cleared`, 'info');
  } catch (error) {
    debugLog('Failed to clear last uploaded date:', error);
    toast.show('Failed to clear last uploaded dates', 'error');
  }
}

/**
 * Format a numeric amount by removing trailing zeros
 */
export function formatAmount(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined) return '0';

  // Convert to number if string
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;

  // Handle NaN
  if (isNaN(num)) return '0';

  // Convert to string, which automatically removes trailing zeros for integers
  // For decimals, we need to ensure trailing zeros are removed
  return String(parseFloat(num.toFixed(10)));
}

/**
 * Format currency amount with proper thousands separators
 */
export function formatCurrencyAmount(amount: number): string {
  return new Intl.NumberFormat('en-CA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export interface BalanceInfo {
  amount: number | null | undefined;
  currency?: string;
}

/**
 * Format balance with currency and amount
 */
export function formatBalance(balance: BalanceInfo | null): string {
  if (!balance || balance.amount === null || balance.amount === undefined) {
    return 'Unknown';
  }
  return `${balance.currency} $${formatCurrencyAmount(balance.amount)}`;
}

/**
 * Validates that the lookback period is less than the retention period.
 * The lookback period must be smaller than retention to avoid losing transaction IDs
 * that were recently uploaded but haven't been evicted yet.
 */
export function validateLookbackVsRetention(lookbackDays: number, retentionDays: number): { valid: boolean; error?: string } {
  // If retention is 0 (unlimited), any lookback value is valid
  if (retentionDays === 0) {
    return { valid: true };
  }

  // Lookback must be strictly less than retention
  if (lookbackDays >= retentionDays) {
    return {
      valid: false,
      error: `Lookback period (${lookbackDays} days) must be less than retention period (${retentionDays} days). ` +
        'This ensures transaction IDs are retained long enough to detect duplicates during the lookback window.',
    };
  }

  return { valid: true };
}

/**
 * Gets the minimum retention period across all accounts for an institution.
 * Used to validate that global lookback doesn't exceed any account's retention.
 * Reads from consolidated accounts_list storage for all integrations.
 */
export function getMinRetentionForInstitution(institutionType: string): number {
  const storageKeyMap: Record<string, string> = {
    wealthsimple: STORAGE.WEALTHSIMPLE_ACCOUNTS_LIST,
    questrade: STORAGE.ACCOUNTS_LIST,
    rogersbank: STORAGE.ROGERSBANK_ACCOUNTS_LIST,
  };

  const accountKeyMap: Record<string, string> = {
    wealthsimple: 'wealthsimpleAccount',
    questrade: 'questradeAccount',
    rogersbank: 'rogersbankAccount',
  };

  const storageKey = storageKeyMap[institutionType];
  if (!storageKey) {
    return TRANSACTION_RETENTION_DEFAULTS.DAYS;
  }

  try {
    const accounts = JSON.parse(GM_getValue(storageKey, '[]') as string) as Record<string, unknown>[];
    if (accounts.length === 0) {
      return TRANSACTION_RETENTION_DEFAULTS.DAYS;
    }

    const accountKey = accountKeyMap[institutionType];
    let minRetention = Infinity;
    let hasRelevantAccounts = false;

    accounts.forEach((account) => {
      // For Wealthsimple, only credit card accounts have transaction dedup
      if (institutionType === 'wealthsimple') {
        const accountType = ((account[accountKey] as Record<string, unknown>)?.type || '') as string;
        if (!accountType.includes('CREDIT')) {
          return;
        }
      }

      hasRelevantAccounts = true;
      const retention = (account.transactionRetentionDays as number | undefined) ?? TRANSACTION_RETENTION_DEFAULTS.DAYS;
      // 0 means unlimited, so skip it when finding minimum
      if (retention > 0 && retention < minRetention) {
        minRetention = retention;
      }
    });

    if (!hasRelevantAccounts || minRetention === Infinity) {
      return TRANSACTION_RETENTION_DEFAULTS.DAYS;
    }

    return minRetention;
  } catch (error) {
    debugLog(`Error getting min retention for ${institutionType}:`, error);
    return TRANSACTION_RETENTION_DEFAULTS.DAYS;
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
  getCurrentInstitution,
  clearTransactionUploadHistory,
  clearCategoryMappings,
  clearAccountMapping,
  clearLastUploadedDate,
  formatCurrencyAmount,
  formatBalance,
};
