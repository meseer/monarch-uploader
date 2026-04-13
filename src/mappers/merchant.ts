/**
 * Merchant Name Mapper
 * Transforms merchant names according to predefined rules
 */

import { debugLog } from '../core/utils';

/**
 * Convert string to title case (proper capitalization)
 */
function toTitleCase(str: string): string {
  return str
    .toLowerCase()
    .split(' ')
    .map((word, index) => {
      // Keep small words lowercase unless they're the first word
      const smallWords = ['of', 'the', 'and', 'or', 'in', 'at', 'on', 'to', 'for'];
      if (smallWords.includes(word) && index !== 0) {
        return word;
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

interface PrefixConfig {
  prefix: string;
  description: string;
}

interface SuffixConfig {
  suffix: string;
  description: string;
}

/**
 * Configuration for prefixes to remove from merchant names
 * Each prefix should be lowercase for consistent matching
 */
const PREFIXES_TO_REMOVE: PrefixConfig[] = [
  { prefix: 'tst-', description: 'Toast transactions' },
  { prefix: 'sq *', description: 'Square transactions' },
  { prefix: 'sp ', description: 'SP transactions' },
  { prefix: 'ls ', description: 'Lightspeed transactions' },
  { prefix: 'str*', description: 'Stripe transactions' },
  { prefix: 'sportpy*', description: 'SportPay transactions' },
];

/**
 * Configuration for suffixes to remove from merchant names
 * Each suffix should be lowercase for consistent matching
 */
const SUFFIXES_TO_REMOVE: SuffixConfig[] = [
  { suffix: 'qps', description: 'QPS payment suffix' },
];

/**
 * Remove leading prefixes from merchant name
 */
function removeLeadingPrefixes(merchantName: string): string {
  let transformed = merchantName.trim();
  const lowerTransformed = transformed.toLowerCase();

  // Check each configured prefix
  for (const { prefix, description } of PREFIXES_TO_REMOVE) {
    if (lowerTransformed.startsWith(prefix)) {
      transformed = transformed.substring(prefix.length).trim();
      debugLog(`Removed ${prefix.toUpperCase()} prefix from merchant (${description}):`, {
        original: merchantName,
        transformed,
      });
      break; // Only remove the first matching prefix
    }
  }

  return transformed;
}

/**
 * Strip store numbers from merchant names
 * Handles various patterns:
 * - Numbers at end: "London Drugs 02" -> "London Drugs"
 * - Hash with numbers: "Shoppers Drug Mart #22" -> "Shoppers Drug Mart"
 * - Letters+numbers at end: "Mcdonald's F22821" -> "Mcdonald's"
 * - Numbers in middle: "Starbucks #1234 Vancouver BC" -> "Starbucks Vancouver BC"
 */
function stripStoreNumbers(merchantName: string, enabled: boolean = true): string {
  if (!enabled || !merchantName) {
    return merchantName;
  }

  let transformed = merchantName.trim();

  // Pattern 1: Remove hash with numbers anywhere in the string (e.g., "#22", "#3794", "#1234")
  // Matches: optional space, #, one or more digits, followed by space or end
  transformed = transformed.replace(/\s*#\d+(?=\s|$)/gi, '');

  // Pattern 2: Remove letter+number codes (e.g., "F22821", "5021002")
  // Matches: space, optional single letter, 2+ digits, followed by space or end
  // But preserve if it's part of the actual business name (like "7-Eleven")
  transformed = transformed.replace(/\s+[A-Z]?\d{2,}(?=\s|$)/gi, '');

  // Pattern 3: Remove standalone numbers (1+ digits when space-separated)
  // This catches cases like "Nesters Market 4556", "London Drugs 02", "Merchant 0"
  // Only if preceded by space (to avoid removing numbers that are part of name like "7-Eleven")
  transformed = transformed.replace(/\s+\d+(?=\s|$)/g, '');

  // Pattern 4: Remove masked account/card numbers at end of string
  // Matches: space + 2+ asterisks + digits at end (e.g., "ROGERS ******7091", "TELUS ****1234")
  transformed = transformed.replace(/\s+\*{2,}\d+$/, '');

  return transformed.trim();
}

/**
 * Remove trailing suffixes from merchant name
 */
function removeTrailingSuffixes(merchantName: string): string {
  let transformed = merchantName.trim();
  const lowerTransformed = transformed.toLowerCase();

  for (const { suffix, description } of SUFFIXES_TO_REMOVE) {
    if (lowerTransformed.endsWith(suffix)) {
      // Ensure it's a standalone suffix (preceded by space or is the whole string)
      const beforeSuffix = transformed.substring(0, transformed.length - suffix.length);
      if (beforeSuffix === '' || beforeSuffix.endsWith(' ')) {
        transformed = beforeSuffix.trim();
        debugLog(`Removed ${suffix.toUpperCase()} suffix from merchant (${description}):`, {
          original: merchantName,
          transformed,
        });
        break;
      }
    }
  }

  return transformed;
}

/**
 * Transform DoorDash merchant names from compact format to readable format
 * e.g., "DD/DOORDASHUNCLEFATIHS" -> "Door Dash - Unclefatihs"
 * e.g., "DD/DOORDASH UNCLE FATIHS" -> "Door Dash - Uncle Fatihs"
 */
function transformDoorDash(merchantName: string): { transformed: string; matched: boolean } {
  const match = merchantName.match(/^DD\/DOORDASH(.*)$/i);
  if (!match) {
    return { transformed: merchantName, matched: false };
  }

  const restaurantPart = match[1].trim();
  const transformed = restaurantPart ? `Door Dash - ${restaurantPart}` : 'Door Dash';

  debugLog('Transformed DoorDash merchant name:', {
    original: merchantName,
    transformed,
  });

  return { transformed, matched: true };
}

interface MerchantMappingOptions {
  stripStoreNumbers?: boolean;
}

/**
 * Apply merchant name transformations
 */
export function applyMerchantMapping(merchantName: string, options: MerchantMappingOptions = {}): string {
  if (!merchantName) {
    return '';
  }

  const { stripStoreNumbers: shouldStripStoreNumbers = true } = options;

  let transformed = merchantName.trim();

  // Rule 1: Remove leading prefixes (TST-, SQ *, LS, SP, STR*)
  transformed = removeLeadingPrefixes(transformed);

  // Rule 1b: Remove trailing suffixes (e.g., QPS)
  transformed = removeTrailingSuffixes(transformed);

  // Rule 1c: Strip asterisk suffix for Amazon/AMZN merchants only
  // e.g., "Amazon.ca*RA6HH70U3 TORONTO ON" -> "Amazon.ca"
  // e.g., "AMZN MKTP US*ABC123DEF" -> "AMZN MKTP US"
  // Only applies when the text before '*' starts with "amazon" or "amzn" (case-insensitive)
  const asteriskIndex = transformed.indexOf('*');
  if (asteriskIndex > 0) {
    const beforeAsterisk = transformed.substring(0, asteriskIndex).trim().toLowerCase();
    if (beforeAsterisk.startsWith('amazon') || beforeAsterisk.startsWith('amzn')) {
      transformed = transformed.substring(0, asteriskIndex).trim();
      debugLog('Stripped asterisk suffix from Amazon merchant:', {
        original: merchantName,
        transformed,
      });
    }
  }

  // Rule 1d: Transform DoorDash compact format to readable format
  const doorDashResult = transformDoorDash(transformed);
  if (doorDashResult.matched) {
    transformed = doorDashResult.transformed;
  }

  // Rule 2: Transform Impark variants to standardized name
  // Matches merchant names starting with "Impark" followed by alphanumeric codes
  if (/^impark/i.test(transformed)) {
    const originalImpark = transformed;
    transformed = 'Impark';
    debugLog('Transformed Impark variant to standardized name:', {
      original: originalImpark,
      transformed,
    });
  }

  // Rule 3: Transform Spotify variants to standardized name
  // Matches merchant names starting with "Spotify" followed by alphanumeric codes (e.g., "Spotify P3EAF45098")
  if (/^spotify/i.test(transformed)) {
    const originalSpotify = transformed;
    transformed = 'Spotify';
    debugLog('Transformed Spotify variant to standardized name:', {
      original: originalSpotify,
      transformed,
    });
  }

  // Rule 3b: Transform Coinbase variants to standardized name
  // Matches merchant names starting with "Coinbase" followed by transaction ref codes (e.g., "COINBASE RTL-KQP9WV9C")
  if (/^coinbase/i.test(transformed)) {
    const originalCoinbase = transformed;
    transformed = 'Coinbase';
    debugLog('Transformed Coinbase variant to standardized name:', {
      original: originalCoinbase,
      transformed,
    });
  }

  // Rule 4: Strip store numbers (configurable)
  transformed = stripStoreNumbers(transformed, shouldStripStoreNumbers);

  // Rule 5: Convert to title case (as last step to ensure proper capitalization)
  transformed = toTitleCase(transformed);

  // Rule 6: Specific merchant name corrections
  const merchantCorrections: Record<string, string> = {
    // 'OLD NAME': 'NEW NAME',
    // Add specific corrections as needed
  };

  if (merchantCorrections[transformed.toUpperCase()]) {
    transformed = merchantCorrections[transformed.toUpperCase()];
  }

  // Rule 7: Clean up extra spaces
  transformed = transformed.replace(/\s+/g, ' ').trim();

  debugLog('Merchant mapping applied:', { original: merchantName, transformed, options });
  return transformed;
}

/**
 * Batch apply merchant mappings to multiple transactions
 */
export function applyMerchantMappingBatch(transactions: Record<string, unknown>[]): Record<string, unknown>[] {
  return transactions.map((transaction) => ({
    ...transaction,
    mappedMerchantName: applyMerchantMapping(((transaction.merchant as Record<string, unknown>)?.name as string) || ''),
  }));
}

