/**
 * Category Mapper
 * Maps transaction categories to Monarch Money categories
 *
 * This module provides separate category mapping storage for different institutions:
 * - Rogers Bank: Uses merchant codes (stored in ROGERSBANK_CATEGORY_MAPPINGS)
 * - Wealthsimple: Uses merchant names only (stored in WEALTHSIMPLE_CATEGORY_MAPPINGS)
 */

import { debugLog, stringSimilarity } from '../core/utils';
import { STORAGE } from '../core/config';
import { INTEGRATIONS } from '../core/integrationCapabilities';
import {
  getCategoryMappings as getConfigCategoryMappings,
  setCategoryMapping as setConfigCategoryMapping,
  saveCategoryMappings as saveConfigCategoryMappings,
} from '../services/common/configStore';

// ============================================================================
// Types
// ============================================================================

/** Result returned when manual category selection is needed */
export interface ManualSelectionResult {
  needsManualSelection: true;
  bankCategory: string;
  suggestedCategory: string;
  similarityScore: number;
}

/** A Monarch category — either a plain string or an object with at least a name */
export type MonarchCategory = string | MonarchCategoryObject;

interface MonarchCategoryObject {
  id?: string;
  name: string;
  group?: CategoryGroup;
  order?: number;
  isDisabled?: boolean;
  [key: string]: unknown;
}

interface CategoryGroup {
  id: string;
  name?: string;
  order?: number;
  [key: string]: unknown;
}

/** Category with similarity score (used in similarity calculations) */
interface ScoredCategory extends MonarchCategoryObject {
  similarityScore: number;
}

/** Group with scored categories */
interface ScoredCategoryGroup {
  id: string;
  name?: string;
  order?: number;
  categories: ScoredCategory[];
  categoryCount: number;
  maxSimilarityScore: number;
  [key: string]: unknown;
}

/** Return type for calculateAllCategorySimilarities */
export interface CategorySimilarityData {
  bankCategory: string;
  categoryGroups: ScoredCategoryGroup[];
  totalCategories: number;
}

/** Match result from findBestMonarchCategoryMatch */
interface CategoryMatchResult {
  bestMatch: string;
  score: number;
}

// ============================================================================
// ROGERS BANK CATEGORY MAPPINGS
// ============================================================================

/**
 * Get saved Rogers Bank category mappings from storage
 * Reads from configStore first, falls back to legacy key
 */
function getSavedCategoryMappings(): Record<string, string> {
  try {
    // Read from configStore only
    const configMappings = getConfigCategoryMappings(INTEGRATIONS.ROGERSBANK);
    if (Object.keys(configMappings).length > 0) {
      return configMappings as Record<string, string>;
    }

    // Migrate-on-read: if configStore is empty, check legacy key and migrate
    const saved = GM_getValue(STORAGE.ROGERSBANK_CATEGORY_MAPPINGS, '{}') as string;
    const legacyMappings = JSON.parse(saved) as Record<string, string>;
    if (Object.keys(legacyMappings).length > 0) {
      debugLog('getSavedCategoryMappings: Migrating Rogers Bank legacy category mappings to configStore');
      saveConfigCategoryMappings(INTEGRATIONS.ROGERSBANK, legacyMappings);
      GM_deleteValue(STORAGE.ROGERSBANK_CATEGORY_MAPPINGS);
      debugLog('getSavedCategoryMappings: Deleted legacy key', STORAGE.ROGERSBANK_CATEGORY_MAPPINGS);
      return legacyMappings;
    }

    return {};
  } catch (error) {
    debugLog('Error loading saved Rogers Bank category mappings:', error);
    return {};
  }
}

/**
 * Save Rogers Bank category mapping to storage
 * Writes to configStore (primary) — migration completed, no dual-write
 */
function saveCategoryMapping(bankCategory: string, monarchCategory: string): void {
  try {
    const upperCategory = bankCategory.toUpperCase();

    // Write to configStore only — migration completed, no dual-write
    setConfigCategoryMapping(INTEGRATIONS.ROGERSBANK, upperCategory, monarchCategory);

    debugLog('Saved Rogers Bank category mapping:', { bankCategory, monarchCategory });
  } catch (error) {
    debugLog('Error saving Rogers Bank category mapping:', error);
  }
}

// ============================================================================
// WEALTHSIMPLE CATEGORY MAPPINGS
// ============================================================================

/**
 * Get saved Wealthsimple category mappings from storage
 * Reads from configStore (legacy migration completed)
 * Shared across all Wealthsimple accounts
 */
function getSavedWealthsimpleCategoryMappings(): Record<string, string> {
  try {
    return getConfigCategoryMappings(INTEGRATIONS.WEALTHSIMPLE) as Record<string, string>;
  } catch (error) {
    debugLog('Error loading saved Wealthsimple category mappings:', error);
    return {};
  }
}

/**
 * Save Wealthsimple category mapping to storage
 * Writes to configStore (primary) — migration completed, no dual-write
 */
function saveWealthsimpleCategoryMapping(merchantName: string, monarchCategory: string): void {
  try {
    const upperMerchant = merchantName.toUpperCase();

    // Write to configStore only — migration completed, no dual-write
    setConfigCategoryMapping(INTEGRATIONS.WEALTHSIMPLE, upperMerchant, monarchCategory);

    debugLog('Saved Wealthsimple category mapping:', { merchantName, monarchCategory });
  } catch (error) {
    debugLog('Error saving Wealthsimple category mapping:', error);
  }
}

// ============================================================================
// SHARED UTILITY FUNCTIONS
// ============================================================================

/**
 * Find the best matching Monarch category using similarity scoring
 */
function findBestMonarchCategoryMatch(bankCategory: string, availableCategories: MonarchCategory[] = []): CategoryMatchResult {
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
 * Apply category mapping with similarity scoring and user selection (Rogers Bank)
 */
export function applyCategoryMapping(category: string, availableCategories: MonarchCategory[] = []): string | ManualSelectionResult {
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
 * Save a user-selected category mapping (Rogers Bank)
 */
export function saveUserCategorySelection(bankCategory: string, monarchCategory: string): void {
  saveCategoryMapping(bankCategory, monarchCategory);
  debugLog('Rogers Bank user category selection saved:', { bankCategory, monarchCategory });
}

/**
 * Apply Wealthsimple category mapping with similarity scoring
 * Uses merchant names for matching (no merchant codes available)
 */
export function applyWealthsimpleCategoryMapping(merchantName: string, availableCategories: MonarchCategory[] = []): string | ManualSelectionResult {
  if (!merchantName) {
    return 'Uncategorized';
  }

  const cleanedMerchant = merchantName.trim();
  const upperMerchant = cleanedMerchant.toUpperCase();

  // First, check if we have a saved mapping for this merchant
  const savedMappings = getSavedWealthsimpleCategoryMappings();
  if (savedMappings[upperMerchant]) {
    const mapped = savedMappings[upperMerchant];
    debugLog('Using saved Wealthsimple category mapping:', { original: cleanedMerchant, mapped });
    return mapped;
  }

  // Find the best matching Monarch category using similarity
  const matchResult = findBestMonarchCategoryMatch(cleanedMerchant, availableCategories);

  debugLog('Wealthsimple category similarity analysis:', {
    merchantName: cleanedMerchant,
    bestMatch: matchResult.bestMatch,
    score: matchResult.score,
  });

  // If similarity score is above 0.95, use it automatically
  if (matchResult.score > 0.95) {
    const mapped = matchResult.bestMatch;
    // Save this automatic mapping for future use
    saveWealthsimpleCategoryMapping(cleanedMerchant, mapped);
    debugLog('Automatic Wealthsimple category mapping applied:', {
      original: cleanedMerchant,
      mapped,
      score: matchResult.score,
    });
    return mapped;
  }

  // If similarity score is low, return a special object indicating manual selection is needed
  debugLog('Manual Wealthsimple category selection needed:', {
    original: cleanedMerchant,
    bestGuess: matchResult.bestMatch,
    score: matchResult.score,
  });

  return {
    needsManualSelection: true,
    bankCategory: cleanedMerchant,
    suggestedCategory: matchResult.bestMatch,
    similarityScore: matchResult.score,
  };
}

/**
 * Save a user-selected Wealthsimple category mapping
 */
export function saveUserWealthsimpleCategorySelection(merchantName: string, monarchCategory: string): void {
  saveWealthsimpleCategoryMapping(merchantName, monarchCategory);
  debugLog('Wealthsimple user category selection saved:', { merchantName, monarchCategory });
}

/**
 * Validate if a category is a valid Monarch category
 */
export function isValidMonarchCategory(category: string, availableCategories: MonarchCategory[] = []): boolean {
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
 */
export function getClosestMonarchCategory(category: string, availableCategories: MonarchCategory[] = []): string {
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
 * Clear all saved Rogers Bank category mappings
 * Clears from configStore — migration completed
 */
export function clearSavedCategoryMappings(): void {
  try {
    // Clear from configStore only — migration completed
    saveConfigCategoryMappings(INTEGRATIONS.ROGERSBANK, {});
    debugLog('Cleared all saved Rogers Bank category mappings');
  } catch (error) {
    debugLog('Error clearing Rogers Bank category mappings:', error);
  }
}

/**
 * Get all saved Rogers Bank category mappings for display/management
 */
export function getAllSavedCategoryMappings(): Record<string, string> {
  return getSavedCategoryMappings();
}

/**
 * Clear all saved Wealthsimple category mappings
 * Clears from configStore — migration completed
 */
export function clearSavedWealthsimpleCategoryMappings(): void {
  try {
    // Clear from configStore only — migration completed
    saveConfigCategoryMappings(INTEGRATIONS.WEALTHSIMPLE, {});
    debugLog('Cleared all saved Wealthsimple category mappings');
  } catch (error) {
    debugLog('Error clearing Wealthsimple category mappings:', error);
  }
}

/**
 * Get all saved Wealthsimple category mappings for display/management
 */
export function getAllSavedWealthsimpleCategoryMappings(): Record<string, string> {
  return getSavedWealthsimpleCategoryMappings();
}

/**
 * Calculate comprehensive similarity data for all categories and groups
 */
export function calculateAllCategorySimilarities(bankCategory: string, availableCategories: MonarchCategoryObject[] = []): CategorySimilarityData {
  if (!bankCategory || !availableCategories || availableCategories.length === 0) {
    return {
      bankCategory,
      categoryGroups: [],
      totalCategories: 0,
    };
  }

  debugLog('Calculating similarities for all categories against:', bankCategory);

  // Group categories by their group and calculate similarities
  const categoriesByGroup: Record<string, { group: CategoryGroup; categories: ScoredCategory[] }> = {};

  availableCategories.forEach((category) => {
    if (category && !category.isDisabled && category.group) {
      const groupId = category.group.id;
      if (!categoriesByGroup[groupId]) {
        categoriesByGroup[groupId] = {
          group: category.group,
          categories: [],
        };
      }

      // Calculate similarity score for this category
      const similarityScore = stringSimilarity(bankCategory.toLowerCase().trim(), category.name.toLowerCase());

      // Add category with its score
      categoriesByGroup[groupId].categories.push({
        ...category,
        similarityScore,
      });
    }
  });

  // Calculate max similarity for each group and structure the data
  const categoryGroups: ScoredCategoryGroup[] = Object.values(categoriesByGroup)
    .map((groupData) => {
      // Sort categories within group by similarity score (descending)
      const sortedCategories = groupData.categories
        .sort((a, b) => {
          if (b.similarityScore !== a.similarityScore) {
            return b.similarityScore - a.similarityScore;
          }
          // Fall back to original sorting
          if ((a.order ?? 0) !== (b.order ?? 0)) {
            return (a.order ?? 0) - (b.order ?? 0);
          }
          return a.name.localeCompare(b.name);
        });

      // Calculate max similarity score for the group
      const maxSimilarityScore = sortedCategories.length > 0
        ? Math.max(...sortedCategories.map((cat) => cat.similarityScore))
        : 0;

      return {
        ...groupData.group,
        categories: sortedCategories,
        categoryCount: sortedCategories.length,
        maxSimilarityScore,
      };
    })
    .filter((group) => group.categoryCount > 0)
    .sort((a, b) => {
      // Sort groups by max similarity score (descending)
      if (b.maxSimilarityScore !== a.maxSimilarityScore) {
        return b.maxSimilarityScore - a.maxSimilarityScore;
      }
      // Fall back to original sorting
      return (a.order ?? 0) - (b.order ?? 0);
    });

  const totalCategories = categoryGroups.reduce((sum, group) => sum + group.categoryCount, 0);

  debugLog(`Calculated similarities for ${totalCategories} categories across ${categoryGroups.length} groups`);

  return {
    bankCategory,
    categoryGroups,
    totalCategories,
  };
}

/**
 * Batch apply category mappings to multiple transactions
 */
export function applyCategoryMappingBatch(transactions: Record<string, unknown>[], availableCategories: MonarchCategory[] = []): Record<string, unknown>[] {
  return transactions.map((transaction) => {
    const merchant = transaction.merchant as Record<string, unknown> | undefined;
    const originalCategory = (merchant?.categoryDescription as string)
      || (merchant?.category as string)
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
  // Rogers Bank functions
  applyCategoryMapping,
  applyCategoryMappingBatch,
  saveUserCategorySelection,
  clearSavedCategoryMappings,
  getAllSavedCategoryMappings,
  // Wealthsimple functions
  applyWealthsimpleCategoryMapping,
  saveUserWealthsimpleCategorySelection,
  clearSavedWealthsimpleCategoryMappings,
  getAllSavedWealthsimpleCategoryMappings,
  // Shared utility functions
  isValidMonarchCategory,
  getClosestMonarchCategory,
  calculateAllCategorySimilarities,
};