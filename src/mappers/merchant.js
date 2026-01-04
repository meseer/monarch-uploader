/**
 * Merchant Name Mapper
 * Transforms merchant names according to predefined rules
 */

import { debugLog } from '../core/utils';

/**
 * Convert string to title case (proper capitalization)
 * @param {string} str - String to convert
 * @returns {string} Title-cased string
 */
function toTitleCase(str) {
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

/**
 * Configuration for prefixes to remove from merchant names
 * Each prefix should be lowercase for consistent matching
 */
const PREFIXES_TO_REMOVE = [
  { prefix: 'tst-', description: 'Toast transactions' },
  { prefix: 'sq *', description: 'Square transactions' },
  { prefix: 'sp ', description: 'SP transactions' },
  { prefix: 'ls ', description: 'Lightspeed transactions' },
  { prefix: 'str*', description: 'Stripe transactions' },
];

/**
 * Remove leading prefixes from merchant name
 * @param {string} merchantName - Merchant name to process
 * @returns {string} Merchant name with prefix removed (if found)
 */
function removeLeadingPrefixes(merchantName) {
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
 *
 * @param {string} merchantName - Merchant name to process
 * @param {boolean} enabled - Whether to apply store number stripping
 * @returns {string} Merchant name with store numbers removed
 */
function stripStoreNumbers(merchantName, enabled = true) {
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

  return transformed.trim();
}

/**
 * Apply merchant name transformations
 * @param {string} merchantName - Original merchant name
 * @param {Object} options - Optional configuration
 * @param {boolean} options.stripStoreNumbers - Whether to strip store numbers (default: true)
 * @returns {string} Transformed merchant name
 */
export function applyMerchantMapping(merchantName, options = {}) {
  if (!merchantName) {
    return '';
  }

  const { stripStoreNumbers: shouldStripStoreNumbers = true } = options;

  // Rule 1: Remove leading prefixes (TST-, Sq *, Ls, Str*)
  let transformed = removeLeadingPrefixes(merchantName);

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

  // Rule 3: Strip store numbers (configurable)
  transformed = stripStoreNumbers(transformed, shouldStripStoreNumbers);

  // Rule 4: Convert to title case (as last step to ensure proper capitalization)
  transformed = toTitleCase(transformed);

  // Rule 5: Specific merchant name corrections
  const merchantCorrections = {
    // 'OLD NAME': 'NEW NAME',
    // Add specific corrections as needed
  };

  if (merchantCorrections[transformed.toUpperCase()]) {
    transformed = merchantCorrections[transformed.toUpperCase()];
  }

  // Rule 6: Clean up extra spaces
  transformed = transformed.replace(/\s+/g, ' ').trim();

  debugLog('Merchant mapping applied:', { original: merchantName, transformed, options });
  return transformed;
}

/**
 * Batch apply merchant mappings to multiple transactions
 * @param {Array} transactions - Array of transaction objects
 * @returns {Array} Transactions with mapped merchant names
 */
export function applyMerchantMappingBatch(transactions) {
  return transactions.map((transaction) => ({
    ...transaction,
    mappedMerchantName: applyMerchantMapping(transaction.merchant?.name),
  }));
}

export default {
  applyMerchantMapping,
  applyMerchantMappingBatch,
  toTitleCase,
};
