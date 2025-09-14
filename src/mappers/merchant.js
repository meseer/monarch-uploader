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
 * Apply merchant name transformations
 * @param {string} merchantName - Original merchant name
 * @returns {string} Transformed merchant name
 */
export function applyMerchantMapping(merchantName) {
  if (!merchantName) {
    return '';
  }

  let transformed = merchantName.trim();

  // Rule 1: Remove leading "TST-" prefix (Toast transactions)
  if (transformed.startsWith('TST-')) {
    transformed = transformed.substring(4).trim();
    debugLog('Removed TST- prefix from merchant:', { original: merchantName, transformed });
  }

  // Rule 2: Remove leading "Sq *" prefix (Square transactions)
  if (transformed.startsWith('Sq *')) {
    transformed = transformed.substring(4).trim();
    debugLog('Removed Sq * prefix from merchant:', { original: merchantName, transformed });
  }

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
