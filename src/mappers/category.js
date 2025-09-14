/**
 * Category Mapper
 * Maps transaction categories to Monarch Money categories
 */

import { debugLog } from '../core/utils';

/**
 * Monarch Money category list
 * These are the standard categories available in Monarch
 * Future implementation will map Rogers categories to these
 */
const MONARCH_CATEGORIES = [
  'Auto & Transport',
  'Bills & Utilities',
  'Business Services',
  'Education',
  'Entertainment',
  'Fees & Charges',
  'Financial',
  'Food & Dining',
  'Gifts & Donations',
  'Health & Fitness',
  'Home',
  'Income',
  'Kids',
  'Personal Care',
  'Pets',
  'Shopping',
  'Taxes',
  'Transfer',
  'Travel',
  'Uncategorized',
];

/**
 * Category mapping rules
 * Maps Rogers Bank categories to Monarch categories
 * Currently a pass-through, but structured for future mapping
 */
const CATEGORY_MAPPINGS = {
  // Example mappings (currently inactive):
  // 'RESTAURANTS': 'Food & Dining',
  // 'GASOLINE': 'Auto & Transport',
  // 'GROCERY': 'Food & Dining',
  // 'MERCHANDISE': 'Shopping',
  // Add more mappings as needed
};

/**
 * Apply category mapping
 * @param {string} category - Original category from Rogers Bank
 * @returns {string} Mapped category for Monarch
 */
export function applyCategoryMapping(category) {
  if (!category) {
    return 'Uncategorized';
  }

  // For now, this is a pass-through function
  // Future implementation will use CATEGORY_MAPPINGS
  const originalCategory = category.trim();

  // Check if we have a specific mapping
  const upperCategory = originalCategory.toUpperCase();
  if (CATEGORY_MAPPINGS[upperCategory]) {
    const mapped = CATEGORY_MAPPINGS[upperCategory];
    debugLog('Category mapping applied:', { original: originalCategory, mapped });
    return mapped;
  }

  // Pass through the original category
  debugLog('Category pass-through (no mapping):', originalCategory);
  return originalCategory;
}

/**
 * Validate if a category is a valid Monarch category
 * @param {string} category - Category to validate
 * @returns {boolean} True if valid Monarch category
 */
export function isValidMonarchCategory(category) {
  return MONARCH_CATEGORIES.includes(category);
}

/**
 * Get the closest matching Monarch category
 * Future enhancement: Use fuzzy matching to find best category
 * @param {string} category - Category to match
 * @returns {string} Best matching Monarch category
 */
export function getClosestMonarchCategory(category) {
  if (!category) {
    return 'Uncategorized';
  }

  // Check exact match first
  if (isValidMonarchCategory(category)) {
    return category;
  }

  // For now, return the original category
  // Future: Implement fuzzy matching logic
  return category;
}

/**
 * Batch apply category mappings to multiple transactions
 * @param {Array} transactions - Array of transaction objects
 * @returns {Array} Transactions with mapped categories
 */
export function applyCategoryMappingBatch(transactions) {
  return transactions.map((transaction) => {
    const originalCategory = transaction.merchant?.categoryDescription
      || transaction.merchant?.category
      || 'Uncategorized';

    return {
      ...transaction,
      mappedCategory: applyCategoryMapping(originalCategory),
    };
  });
}

export default {
  applyCategoryMapping,
  applyCategoryMappingBatch,
  isValidMonarchCategory,
  getClosestMonarchCategory,
  MONARCH_CATEGORIES,
};
