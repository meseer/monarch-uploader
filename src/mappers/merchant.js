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
  { prefix: 'ls ', description: 'Lightspeed transactions' },
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
 * Apply merchant name transformations
 * @param {string} merchantName - Original merchant name
 * @returns {string} Transformed merchant name
 */
export function applyMerchantMapping(merchantName) {
  if (!merchantName) {
    return '';
  }

  // Rule 1: Remove leading prefixes (TST-, Sq *, Ls )
  let transformed = removeLeadingPrefixes(merchantName);

  // Rule 3: Convert to title case (as last step to ensure proper capitalization)
  transformed = toTitleCase(transformed);

  // Future rules can be added here
  // Example structure for additional rules:

  // Rule 3: Specific merchant name corrections
  const merchantCorrections = {
    // 'OLD NAME': 'NEW NAME',
    // Add specific corrections as needed
  };

  if (merchantCorrections[transformed.toUpperCase()]) {
    transformed = merchantCorrections[transformed.toUpperCase()];
  }

  // Rule 4: Remove trailing store numbers (e.g., "#1234" at the end)
  // Uncomment if needed:
  // transformed = transformed.replace(/\s*#\d+$/, '');

  // Rule 5: Clean up extra spaces
  transformed = transformed.replace(/\s+/g, ' ').trim();

  debugLog('Merchant mapping applied:', { original: merchantName, transformed });
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
