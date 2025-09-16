/**
 * Category Mapper
 * Maps transaction categories to Monarch Money categories
 */

import { debugLog, stringSimilarity } from '../core/utils';
import { STORAGE } from '../core/config';

/**
 * Monarch Money category list
 * These are the standard categories available in Monarch
 */

/**
 * Get saved category mappings from storage
 * @returns {Object} Saved category mappings
 */
function getSavedCategoryMappings() {
  try {
    const saved = GM_getValue(STORAGE.ROGERSBANK_CATEGORY_MAPPINGS, '{}');
    return JSON.parse(saved);
  } catch (error) {
    debugLog('Error loading saved category mappings:', error);
    return {};
  }
}

/**
 * Save category mapping to storage
 * @param {string} bankCategory - Bank category name
 * @param {string} monarchCategory - Monarch category name
 */
function saveCategoryMapping(bankCategory, monarchCategory) {
  try {
    const savedMappings = getSavedCategoryMappings();
    savedMappings[bankCategory.toUpperCase()] = monarchCategory;
    GM_setValue(STORAGE.ROGERSBANK_CATEGORY_MAPPINGS, JSON.stringify(savedMappings));
    debugLog('Saved category mapping:', { bankCategory, monarchCategory });
  } catch (error) {
    debugLog('Error saving category mapping:', error);
  }
}

/**
 * Find the best matching Monarch category using similarity scoring
 * @param {string} bankCategory - Bank category to match
 * @param {Array} availableCategories - Available Monarch categories to match against
 * @returns {Object} Result with bestMatch and score
 */
function findBestMonarchCategoryMatch(bankCategory, availableCategories = []) {
  if (!bankCategory) {
    return { bestMatch: 'Uncategorized', score: 0 };
  }

  // If no categories provided, return fallback
  if (!availableCategories || availableCategories.length === 0) {
    debugLog('No categories available for matching, using fallback');
    return { bestMatch: 'Uncategorized', score: 0 };
  }

  let bestMatch = 'Uncategorized';
  let bestScore = 0;

  const normalizedBankCategory = bankCategory.toLowerCase().trim();

  // Check each Monarch category for similarity using only Levenshtein distance
  availableCategories.forEach((monarchCategory) => {
    const categoryName = typeof monarchCategory === 'string' ? monarchCategory : monarchCategory.name;
    const normalizedMonarchCategory = categoryName.toLowerCase();

    // Calculate similarity using our improved Levenshtein distance function
    const score = stringSimilarity(normalizedBankCategory, normalizedMonarchCategory);

    debugLog(`Comparing "${bankCategory}" vs "${categoryName}": ${score.toFixed(3)}`, {
      bankCategory: normalizedBankCategory,
      monarchCategory: normalizedMonarchCategory,
      score,
    });

    if (score > bestScore) {
      bestScore = score;
      bestMatch = categoryName;
    }
  });

  return { bestMatch, score: bestScore };
}

/**
 * Apply category mapping with similarity scoring and user selection
 * @param {string} category - Original category from Rogers Bank
 * @param {Array} availableCategories - Available Monarch categories to match against
 * @returns {string|Object} Mapped category for Monarch, or object indicating manual selection needed
 */
export function applyCategoryMapping(category, availableCategories = []) {
  if (!category) {
    return 'Uncategorized';
  }

  const originalCategory = category.trim();
  const upperCategory = originalCategory.toUpperCase();

  // First, check if we have a saved mapping for this category
  const savedMappings = getSavedCategoryMappings();
  if (savedMappings[upperCategory]) {
    const mapped = savedMappings[upperCategory];
    debugLog('Using saved category mapping:', { original: originalCategory, mapped });
    return mapped;
  }

  // Find the best matching Monarch category using similarity
  const matchResult = findBestMonarchCategoryMatch(originalCategory, availableCategories);

  debugLog('Category similarity analysis:', {
    bankCategory: originalCategory,
    bestMatch: matchResult.bestMatch,
    score: matchResult.score,
  });

  // If similarity score is above 0.95, use it automatically
  if (matchResult.score > 0.95) {
    const mapped = matchResult.bestMatch;
    // Save this automatic mapping for future use
    saveCategoryMapping(originalCategory, mapped);
    debugLog('Automatic category mapping applied:', {
      original: originalCategory,
      mapped,
      score: matchResult.score,
    });
    return mapped;
  }

  // If similarity score is low, return a special object indicating manual selection is needed
  debugLog('Manual category selection needed:', {
    original: originalCategory,
    bestGuess: matchResult.bestMatch,
    score: matchResult.score,
  });

  return {
    needsManualSelection: true,
    bankCategory: originalCategory,
    suggestedCategory: matchResult.bestMatch,
    similarityScore: matchResult.score,
  };
}

/**
 * Save a user-selected category mapping
 * @param {string} bankCategory - Bank category name
 * @param {string} monarchCategory - Selected Monarch category name
 */
export function saveUserCategorySelection(bankCategory, monarchCategory) {
  saveCategoryMapping(bankCategory, monarchCategory);
  debugLog('User category selection saved:', { bankCategory, monarchCategory });
}

/**
 * Validate if a category is a valid Monarch category
 * @param {string} category - Category to validate
 * @param {Array} availableCategories - Available Monarch categories to validate against
 * @returns {boolean} True if valid Monarch category
 */
export function isValidMonarchCategory(category, availableCategories = []) {
  if (!availableCategories || availableCategories.length === 0) {
    return false;
  }
  return availableCategories.some((cat) => {
    const categoryName = typeof cat === 'string' ? cat : cat.name;
    return categoryName === category;
  });
}

/**
 * Get the closest matching Monarch category using similarity scoring
 * @param {string} category - Category to match
 * @param {Array} availableCategories - Available Monarch categories to match against
 * @returns {string} Best matching Monarch category
 */
export function getClosestMonarchCategory(category, availableCategories = []) {
  if (!category) {
    return 'Uncategorized';
  }

  // Check exact match first
  if (isValidMonarchCategory(category, availableCategories)) {
    return category;
  }

  // Use similarity scoring to find best match
  const matchResult = findBestMonarchCategoryMatch(category, availableCategories);
  return matchResult.bestMatch;
}

/**
 * Clear all saved category mappings
 */
export function clearSavedCategoryMappings() {
  try {
    GM_setValue(STORAGE.ROGERSBANK_CATEGORY_MAPPINGS, '{}');
    debugLog('Cleared all saved category mappings');
  } catch (error) {
    debugLog('Error clearing category mappings:', error);
  }
}

/**
 * Get all saved category mappings for display/management
 * @returns {Object} All saved category mappings
 */
export function getAllSavedCategoryMappings() {
  return getSavedCategoryMappings();
}

/**
 * Batch apply category mappings to multiple transactions
 * @param {Array} transactions - Array of transaction objects
 * @param {Array} availableCategories - Available Monarch categories to match against
 * @returns {Array} Transactions with mapped categories (some may need manual selection)
 */
export function applyCategoryMappingBatch(transactions, availableCategories = []) {
  return transactions.map((transaction) => {
    const originalCategory = transaction.merchant?.categoryDescription
      || transaction.merchant?.category
      || 'Uncategorized';

    const mappingResult = applyCategoryMapping(originalCategory, availableCategories);

    return {
      ...transaction,
      mappedCategory: mappingResult,
      originalCategory,
    };
  });
}

export default {
  applyCategoryMapping,
  applyCategoryMappingBatch,
  isValidMonarchCategory,
  getClosestMonarchCategory,
  saveUserCategorySelection,
  clearSavedCategoryMappings,
  getAllSavedCategoryMappings,
};
