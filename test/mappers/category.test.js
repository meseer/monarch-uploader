/**
 * Comprehensive Tests for Category Mapper
 */

import {
  applyCategoryMapping,
  saveUserCategorySelection,
  isValidMonarchCategory,
  getClosestMonarchCategory,
  clearSavedCategoryMappings,
  getAllSavedCategoryMappings,
  calculateAllCategorySimilarities,
  applyCategoryMappingBatch,
  applyWealthsimpleCategoryMapping,
  saveUserWealthsimpleCategorySelection,
  clearSavedWealthsimpleCategoryMappings,
  getAllSavedWealthsimpleCategoryMappings,
} from '../../src/mappers/category';

// Mock dependencies
jest.mock('../../src/core/utils', () => ({
  debugLog: jest.fn(),
  stringSimilarity: jest.fn((str1, str2) => {
    // Simple mock similarity function
    if (str1 === str2) return 1.0;
    if (str1.includes(str2) || str2.includes(str1)) return 0.8;
    if (str1.toLowerCase() === str2.toLowerCase()) return 0.95;
    return 0.1;
  }),
}));

jest.mock('../../src/core/config', () => ({
  STORAGE: {
    ROGERSBANK_CATEGORY_MAPPINGS: 'rogersbank_category_mappings',
    WEALTHSIMPLE_CATEGORY_MAPPINGS: 'wealthsimple_category_mappings',
  },
}));

// Mock Greasemonkey functions
globalThis.GM_getValue = jest.fn();
globalThis.GM_setValue = jest.fn();

describe('Category Mapper', () => {
  let mockAvailableCategories;
  let stringSimilarity;

  beforeEach(() => {
    jest.clearAllMocks();
    stringSimilarity = jest.requireMock('../../src/core/utils').stringSimilarity;

    // Mock available categories
    mockAvailableCategories = [
      { id: 1, name: 'Dining', group: { id: 'food', name: 'Food & Dining', order: 1 }, order: 1 },
      { id: 2, name: 'Restaurants', group: { id: 'food', name: 'Food & Dining', order: 1 }, order: 2 },
      { id: 3, name: 'Groceries', group: { id: 'food', name: 'Food & Dining', order: 1 }, order: 3 },
      { id: 4, name: 'Gas', group: { id: 'transport', name: 'Transportation', order: 2 }, order: 1 },
      { id: 5, name: 'Transportation', group: { id: 'transport', name: 'Transportation', order: 2 }, order: 2 },
      { id: 6, name: 'Shopping', group: { id: 'shopping', name: 'Shopping', order: 3 }, order: 1 },
      { id: 7, name: 'Entertainment', group: { id: 'entertainment', name: 'Entertainment', order: 4 }, order: 1 },
    ];

    // Default GM_getValue mock
    globalThis.GM_getValue.mockReturnValue('{}');
  });

  describe('applyCategoryMapping', () => {
    test('should return Uncategorized for null/undefined category', () => {
      expect(applyCategoryMapping(null, mockAvailableCategories)).toBe('Uncategorized');
      expect(applyCategoryMapping(undefined, mockAvailableCategories)).toBe('Uncategorized');
      expect(applyCategoryMapping('', mockAvailableCategories)).toBe('Uncategorized');
    });

    test('should return saved mapping when exists', () => {
      globalThis.GM_getValue.mockReturnValue(JSON.stringify({
        RESTAURANTS: 'Dining',
      }));

      const result = applyCategoryMapping('Restaurants', mockAvailableCategories);
      expect(result).toBe('Dining');
    });

    test('should apply automatic mapping for high similarity score', () => {
      stringSimilarity.mockReturnValue(0.97); // Above 0.95 threshold

      const result = applyCategoryMapping('Restaurant', mockAvailableCategories);

      expect(result).toBe('Dining');
      expect(globalThis.GM_setValue).toHaveBeenCalledWith(
        'rogersbank_category_mappings',
        expect.stringContaining('RESTAURANT'),
      );
    });

    test('should request manual selection for low similarity score', () => {
      stringSimilarity.mockReturnValue(0.5); // Below threshold

      const result = applyCategoryMapping('Unknown Category', mockAvailableCategories);

      expect(result).toMatchObject({
        needsManualSelection: true,
        bankCategory: 'Unknown Category',
        suggestedCategory: 'Dining',
        similarityScore: 0.5,
      });
    });

    test('should handle empty available categories gracefully', () => {
      const result = applyCategoryMapping('Test Category', []);
      expect(result).toMatchObject({
        needsManualSelection: true,
        bankCategory: 'Test Category',
        suggestedCategory: 'Uncategorized',
        similarityScore: 0,
      });
    });

    test('should handle trimming whitespace', () => {
      globalThis.GM_getValue.mockReturnValue(JSON.stringify({
        TEST: 'Shopping',
      }));

      const result = applyCategoryMapping('  Test  ', mockAvailableCategories);
      expect(result).toBe('Shopping');
    });

    test('should handle case-insensitive saved mappings', () => {
      globalThis.GM_getValue.mockReturnValue(JSON.stringify({
        DINING: 'Restaurants',
      }));

      const result = applyCategoryMapping('dining', mockAvailableCategories);
      expect(result).toBe('Restaurants');
    });

    test('should save automatic mappings to storage', () => {
      stringSimilarity.mockReturnValue(0.99);

      applyCategoryMapping('Gas Station', mockAvailableCategories);

      expect(globalThis.GM_setValue).toHaveBeenCalledWith(
        'rogersbank_category_mappings',
        expect.stringContaining('GAS STATION'),
      );
    });

    test('should handle JSON parse errors gracefully', () => {
      globalThis.GM_getValue.mockReturnValue('invalid json');
      stringSimilarity.mockReturnValue(0.5); // Low similarity to trigger manual selection

      const result = applyCategoryMapping('Test', mockAvailableCategories);
      // Should fall back to similarity scoring, which may return object for manual selection
      expect(result).toMatchObject({
        needsManualSelection: true,
        bankCategory: 'Test',
      });
    });
  });

  describe('saveUserCategorySelection', () => {
    test('should save user category selection', () => {
      globalThis.GM_getValue.mockReturnValue('{}');

      saveUserCategorySelection('Fast Food', 'Dining');

      expect(globalThis.GM_setValue).toHaveBeenCalledWith(
        'rogersbank_category_mappings',
        JSON.stringify({ 'FAST FOOD': 'Dining' }),
      );
    });

    test('should update existing mappings', () => {
      globalThis.GM_getValue.mockReturnValue(JSON.stringify({
        EXISTING: 'Old Category',
      }));

      saveUserCategorySelection('New Category', 'Shopping');

      const savedData = JSON.parse(globalThis.GM_setValue.mock.calls[0][1]);
      expect(savedData).toEqual({
        EXISTING: 'Old Category',
        'NEW CATEGORY': 'Shopping',
      });
    });

    test('should handle GM_setValue errors gracefully', () => {
      globalThis.GM_setValue.mockImplementation(() => {
        throw new Error('Storage error');
      });

      expect(() => {
        saveUserCategorySelection('Test', 'Category');
      }).not.toThrow();
    });
  });

  describe('isValidMonarchCategory', () => {
    test('should return true for valid string category', () => {
      const simpleCategories = ['Dining', 'Shopping', 'Gas'];
      expect(isValidMonarchCategory('Dining', simpleCategories)).toBe(true);
      expect(isValidMonarchCategory('Shopping', simpleCategories)).toBe(true);
    });

    test('should return false for invalid category', () => {
      const simpleCategories = ['Dining', 'Shopping', 'Gas'];
      expect(isValidMonarchCategory('Invalid', simpleCategories)).toBe(false);
      expect(isValidMonarchCategory('', simpleCategories)).toBe(false);
    });

    test('should work with object-based categories', () => {
      expect(isValidMonarchCategory('Dining', mockAvailableCategories)).toBe(true);
      expect(isValidMonarchCategory('Invalid', mockAvailableCategories)).toBe(false);
    });

    test('should return false for empty categories array', () => {
      expect(isValidMonarchCategory('Dining', [])).toBe(false);
      expect(isValidMonarchCategory('Dining', null)).toBe(false);
      expect(isValidMonarchCategory('Dining', undefined)).toBe(false);
    });
  });

  describe('getClosestMonarchCategory', () => {
    test('should return Uncategorized for null/empty category', () => {
      expect(getClosestMonarchCategory(null, mockAvailableCategories)).toBe('Uncategorized');
      expect(getClosestMonarchCategory('', mockAvailableCategories)).toBe('Uncategorized');
    });

    test('should return exact match if valid', () => {
      const result = getClosestMonarchCategory('Dining', mockAvailableCategories);
      expect(result).toBe('Dining');
    });

    test('should use similarity scoring for inexact matches', () => {
      stringSimilarity.mockImplementation((str1, str2) => {
        if (str1.includes('restaurant') && str2.includes('dining')) return 0.8;
        if (str1.includes('restaurant') && str2.includes('restaurants')) return 0.95;
        return 0.1;
      });

      const result = getClosestMonarchCategory('restaurant', mockAvailableCategories);
      expect(result).toBe('Restaurants'); // Should pick the higher similarity
    });

    test('should handle empty categories gracefully', () => {
      const result = getClosestMonarchCategory('test', []);
      expect(result).toBe('Uncategorized');
    });
  });

  describe('clearSavedCategoryMappings', () => {
    test('should clear all saved mappings', () => {
      clearSavedCategoryMappings();

      expect(globalThis.GM_setValue).toHaveBeenCalledWith(
        'rogersbank_category_mappings',
        '{}',
      );
    });

    test('should handle GM_setValue errors gracefully', () => {
      globalThis.GM_setValue.mockImplementation(() => {
        throw new Error('Storage error');
      });

      expect(() => {
        clearSavedCategoryMappings();
      }).not.toThrow();
    });
  });

  describe('getAllSavedCategoryMappings', () => {
    test('should return saved mappings', () => {
      const mockMappings = {
        DINING: 'Restaurants',
        GAS: 'Transportation',
      };
      globalThis.GM_getValue.mockReturnValue(JSON.stringify(mockMappings));

      const result = getAllSavedCategoryMappings();
      expect(result).toEqual(mockMappings);
    });

    test('should return empty object for no saved mappings', () => {
      globalThis.GM_getValue.mockReturnValue('{}');

      const result = getAllSavedCategoryMappings();
      expect(result).toEqual({});
    });

    test('should handle JSON parse errors', () => {
      globalThis.GM_getValue.mockReturnValue('invalid json');

      const result = getAllSavedCategoryMappings();
      expect(result).toEqual({});
    });
  });

  describe('calculateAllCategorySimilarities', () => {
    test('should calculate similarities for all categories', () => {
      stringSimilarity.mockImplementation((str1, str2) => {
        if (str1.includes('food') && str2.includes('dining')) return 0.7;
        if (str1.includes('food') && str2.includes('restaurants')) return 0.9;
        if (str1.includes('food') && str2.includes('groceries')) return 0.6;
        return 0.1;
      });

      const result = calculateAllCategorySimilarities('food', mockAvailableCategories);

      expect(result).toMatchObject({
        bankCategory: 'food',
        totalCategories: expect.any(Number),
        categoryGroups: expect.arrayContaining([
          expect.objectContaining({
            name: 'Food & Dining',
            categories: expect.arrayContaining([
              expect.objectContaining({
                name: 'Restaurants',
                similarityScore: 0.9,
              }),
            ]),
          }),
        ]),
      });
    });

    test('should sort categories by similarity score', () => {
      stringSimilarity.mockImplementation((str1, str2) => {
        if (str2.includes('restaurants')) return 0.9;
        if (str2.includes('dining')) return 0.7;
        if (str2.includes('groceries')) return 0.5;
        return 0.1;
      });

      const result = calculateAllCategorySimilarities('food', mockAvailableCategories);

      const foodGroup = result.categoryGroups.find((g) => g.name === 'Food & Dining');
      expect(foodGroup.categories[0].name).toBe('Restaurants'); // Highest score first
      expect(foodGroup.categories[0].similarityScore).toBe(0.9);
    });

    test('should sort groups by max similarity score', () => {
      stringSimilarity.mockImplementation((str1, str2) => {
        if (str2.includes('gas')) return 0.95; // Transportation group
        if (str2.includes('transportation')) return 0.8;
        if (str2.includes('dining')) return 0.7; // Food group
        return 0.1;
      });

      const result = calculateAllCategorySimilarities('gas station', mockAvailableCategories);

      expect(result.categoryGroups[0].name).toBe('Transportation'); // Should be first due to higher max similarity
      expect(result.categoryGroups[0].maxSimilarityScore).toBe(0.95);
    });

    test('should handle empty categories', () => {
      const result = calculateAllCategorySimilarities('test', []);

      expect(result).toEqual({
        bankCategory: 'test',
        categoryGroups: [],
        totalCategories: 0,
      });
    });

    test('should handle null/undefined bank category', () => {
      const result = calculateAllCategorySimilarities(null, mockAvailableCategories);

      expect(result).toMatchObject({
        bankCategory: null,
        categoryGroups: [],
        totalCategories: 0,
      });
    });

    test('should filter out disabled categories', () => {
      const categoriesWithDisabled = [
        ...mockAvailableCategories,
        { id: 99, name: 'Disabled Category', group: { id: 'test', name: 'Test' }, isDisabled: true },
      ];

      const result = calculateAllCategorySimilarities('test', categoriesWithDisabled);

      const hasDisabledCategory = result.categoryGroups.some((group) =>
        group.categories.some((cat) => cat.name === 'Disabled Category'),
      );
      expect(hasDisabledCategory).toBe(false);
    });

    test('should handle categories without groups', () => {
      const categoriesWithoutGroups = [
        { id: 1, name: 'No Group Category' },
      ];

      const result = calculateAllCategorySimilarities('test', categoriesWithoutGroups);

      expect(result.categoryGroups).toEqual([]);
    });
  });

  describe('applyCategoryMappingBatch', () => {
    test('should apply mappings to multiple transactions', () => {
      const transactions = [
        {
          id: 1,
          merchant: { categoryDescription: 'Restaurants' },
          amount: -25.00,
        },
        {
          id: 2,
          merchant: { category: 'Gas Stations' },
          amount: -45.00,
        },
        {
          id: 3,
          amount: -15.00,
          // No merchant category
        },
      ];

      stringSimilarity.mockImplementation((str1, str2) => {
        if (str1.includes('restaurant') && str2.includes('dining')) return 0.97;
        if (str1.includes('gas') && str2.includes('gas')) return 0.99;
        return 0.1;
      });

      const result = applyCategoryMappingBatch(transactions, mockAvailableCategories);

      expect(result).toHaveLength(3);
      expect(result[0]).toMatchObject({
        id: 1,
        originalCategory: 'Restaurants',
        mappedCategory: 'Dining', // High similarity, automatic mapping
      });
      expect(result[1]).toMatchObject({
        id: 2,
        originalCategory: 'Gas Stations',
        mappedCategory: 'Gas', // High similarity, automatic mapping
      });
      expect(result[2]).toMatchObject({
        id: 3,
        originalCategory: 'Uncategorized',
        mappedCategory: expect.objectContaining({
          needsManualSelection: true,
          bankCategory: 'Uncategorized',
        }),
      });
    });

    test('should handle transactions with manual selection needed', () => {
      const transactions = [
        {
          id: 1,
          merchant: { categoryDescription: 'Unknown Category' },
        },
      ];

      stringSimilarity.mockReturnValue(0.3); // Low similarity

      const result = applyCategoryMappingBatch(transactions, mockAvailableCategories);

      expect(result[0].mappedCategory).toMatchObject({
        needsManualSelection: true,
        bankCategory: 'Unknown Category',
      });
    });

    test('should handle empty transactions array', () => {
      const result = applyCategoryMappingBatch([], mockAvailableCategories);
      expect(result).toEqual([]);
    });

    test('should handle transactions without merchant info', () => {
      const transactions = [
        { id: 1, amount: -10.00 },
        { id: 2, merchant: {}, amount: -20.00 },
        { id: 3, merchant: null, amount: -30.00 },
      ];

      const result = applyCategoryMappingBatch(transactions, mockAvailableCategories);

      result.forEach((transaction) => {
        expect(transaction.originalCategory).toBe('Uncategorized');
        // When there's no merchant info, the category is "Uncategorized" which triggers manual selection
        expect(transaction.mappedCategory).toMatchObject({
          needsManualSelection: true,
          bankCategory: 'Uncategorized',
        });
      });
    });

    test('should preserve original transaction properties', () => {
      const transactions = [
        {
          id: 1,
          merchant: { categoryDescription: 'Restaurants' },
          amount: -25.00,
          date: '2024-01-15',
          description: 'Test Restaurant',
        },
      ];

      const result = applyCategoryMappingBatch(transactions, mockAvailableCategories);

      expect(result[0]).toMatchObject({
        id: 1,
        amount: -25.00,
        date: '2024-01-15',
        description: 'Test Restaurant',
        merchant: { categoryDescription: 'Restaurants' },
      });
    });
  });

  describe('Wealthsimple Category Mapping Functions', () => {
    describe('applyWealthsimpleCategoryMapping', () => {
      test('should return Uncategorized for null/undefined merchant', () => {
        expect(applyWealthsimpleCategoryMapping(null, mockAvailableCategories)).toBe('Uncategorized');
        expect(applyWealthsimpleCategoryMapping(undefined, mockAvailableCategories)).toBe('Uncategorized');
        expect(applyWealthsimpleCategoryMapping('', mockAvailableCategories)).toBe('Uncategorized');
      });

      test('should return saved mapping when exists', () => {
        globalThis.GM_getValue.mockImplementation((key, defaultVal) => {
          if (key === 'wealthsimple_category_mappings') {
            return JSON.stringify({ STARBUCKS: 'Dining' });
          }
          return defaultVal;
        });

        const result = applyWealthsimpleCategoryMapping('Starbucks', mockAvailableCategories);
        expect(result).toBe('Dining');
      });

      test('should apply automatic mapping for high similarity score', () => {
        globalThis.GM_getValue.mockImplementation((key, defaultVal) => {
          if (key === 'wealthsimple_category_mappings') {
            return '{}';
          }
          return defaultVal;
        });
        stringSimilarity.mockReturnValue(0.97);

        const result = applyWealthsimpleCategoryMapping('Coffee Shop', mockAvailableCategories);

        expect(result).toBe('Dining');
        expect(globalThis.GM_setValue).toHaveBeenCalledWith(
          'wealthsimple_category_mappings',
          expect.stringContaining('COFFEE SHOP'),
        );
      });

      test('should request manual selection for low similarity score', () => {
        globalThis.GM_getValue.mockImplementation((key, defaultVal) => {
          if (key === 'wealthsimple_category_mappings') {
            return '{}';
          }
          return defaultVal;
        });
        stringSimilarity.mockReturnValue(0.5);

        const result = applyWealthsimpleCategoryMapping('Unknown Merchant', mockAvailableCategories);

        expect(result).toMatchObject({
          needsManualSelection: true,
          bankCategory: 'Unknown Merchant',
          suggestedCategory: 'Dining',
          similarityScore: 0.5,
        });
      });
    });

    describe('saveUserWealthsimpleCategorySelection', () => {
      test('should save user category selection to Wealthsimple storage', () => {
        globalThis.GM_getValue.mockImplementation((key, defaultVal) => {
          if (key === 'wealthsimple_category_mappings') {
            return '{}';
          }
          return defaultVal;
        });

        saveUserWealthsimpleCategorySelection('Tim Hortons', 'Dining');

        expect(globalThis.GM_setValue).toHaveBeenCalledWith(
          'wealthsimple_category_mappings',
          JSON.stringify({ 'TIM HORTONS': 'Dining' }),
        );
      });

      test('should update existing mappings', () => {
        globalThis.GM_getValue.mockImplementation((key, defaultVal) => {
          if (key === 'wealthsimple_category_mappings') {
            return JSON.stringify({ EXISTING: 'Old Category' });
          }
          return defaultVal;
        });

        saveUserWealthsimpleCategorySelection('New Merchant', 'Shopping');

        const savedData = JSON.parse(globalThis.GM_setValue.mock.calls[0][1]);
        expect(savedData).toEqual({
          EXISTING: 'Old Category',
          'NEW MERCHANT': 'Shopping',
        });
      });
    });

    describe('clearSavedWealthsimpleCategoryMappings', () => {
      test('should clear all saved Wealthsimple mappings', () => {
        clearSavedWealthsimpleCategoryMappings();

        expect(globalThis.GM_setValue).toHaveBeenCalledWith(
          'wealthsimple_category_mappings',
          '{}',
        );
      });
    });

    describe('getAllSavedWealthsimpleCategoryMappings', () => {
      test('should return saved Wealthsimple mappings', () => {
        const mockMappings = {
          STARBUCKS: 'Dining',
          UBER: 'Transportation',
        };
        globalThis.GM_getValue.mockImplementation((key, defaultVal) => {
          if (key === 'wealthsimple_category_mappings') {
            return JSON.stringify(mockMappings);
          }
          return defaultVal;
        });

        const result = getAllSavedWealthsimpleCategoryMappings();
        expect(result).toEqual(mockMappings);
      });

      test('should return empty object for no saved mappings', () => {
        globalThis.GM_getValue.mockImplementation((key, defaultVal) => {
          if (key === 'wealthsimple_category_mappings') {
            return '{}';
          }
          return defaultVal;
        });

        const result = getAllSavedWealthsimpleCategoryMappings();
        expect(result).toEqual({});
      });

      test('should handle JSON parse errors', () => {
        globalThis.GM_getValue.mockImplementation((key, defaultVal) => {
          if (key === 'wealthsimple_category_mappings') {
            return 'invalid json';
          }
          return defaultVal;
        });

        const result = getAllSavedWealthsimpleCategoryMappings();
        expect(result).toEqual({});
      });
    });

    describe('Separation between Rogers Bank and Wealthsimple', () => {
      test('should store mappings in separate keys', () => {
        // Save Rogers Bank mapping
        globalThis.GM_getValue.mockReturnValue('{}');
        saveUserCategorySelection('Rogers Category', 'Dining');

        expect(globalThis.GM_setValue).toHaveBeenCalledWith(
          'rogersbank_category_mappings',
          expect.any(String),
        );

        jest.clearAllMocks();

        // Save Wealthsimple mapping
        globalThis.GM_getValue.mockImplementation((key, defaultVal) => {
          if (key === 'wealthsimple_category_mappings') {
            return '{}';
          }
          return defaultVal;
        });
        saveUserWealthsimpleCategorySelection('Wealthsimple Merchant', 'Shopping');

        expect(globalThis.GM_setValue).toHaveBeenCalledWith(
          'wealthsimple_category_mappings',
          expect.any(String),
        );
      });

      test('should retrieve mappings from correct keys', () => {
        const rogersMappings = { ROGERS_CAT: 'Dining' };
        const wealthsimpleMappings = { WS_MERCHANT: 'Shopping' };

        globalThis.GM_getValue.mockImplementation((key, defaultVal) => {
          if (key === 'rogersbank_category_mappings') {
            return JSON.stringify(rogersMappings);
          }
          if (key === 'wealthsimple_category_mappings') {
            return JSON.stringify(wealthsimpleMappings);
          }
          return defaultVal;
        });

        const rogersResult = getAllSavedCategoryMappings();
        const wealthsimpleResult = getAllSavedWealthsimpleCategoryMappings();

        expect(rogersResult).toEqual(rogersMappings);
        expect(wealthsimpleResult).toEqual(wealthsimpleMappings);
      });
    });
  });

  describe('Edge Cases and Error Handling', () => {
    test('should handle GM_getValue throwing errors', () => {
      globalThis.GM_getValue.mockImplementation(() => {
        throw new Error('Storage access error');
      });

      expect(() => {
        applyCategoryMapping('test', mockAvailableCategories);
      }).not.toThrow();
    });

    test('should handle malformed category objects', () => {
      const malformedCategories = [
        null,
        undefined,
        { name: 'Valid Category', group: { id: 'test', name: 'Test' } },
        { id: 'no-name' },
        'string-category',
      ];

      expect(() => {
        calculateAllCategorySimilarities('test', malformedCategories);
      }).not.toThrow();
    });

    test('should handle very long category names', () => {
      const longCategoryName = 'A'.repeat(1000);

      expect(() => {
        applyCategoryMapping(longCategoryName, mockAvailableCategories);
      }).not.toThrow();
    });

    test('should handle special characters in category names', () => {
      const specialCategories = [
        'Café & Restaurants',
        'Gas/Fuel Stations',
        'Bücher & Medien',
        '中文分类',
        'Category with 🚀 emoji',
      ];

      specialCategories.forEach((category) => {
        expect(() => {
          applyCategoryMapping(category, mockAvailableCategories);
        }).not.toThrow();
      });
    });

    test('should handle concurrent access to storage', () => {
      let callCount = 0;
      globalThis.GM_getValue.mockImplementation(() => {
        callCount++;
        return callCount === 1 ? '{}' : JSON.stringify({ TEST: 'Category' });
      });

      const result1 = applyCategoryMapping('test1', mockAvailableCategories);
      const result2 = applyCategoryMapping('test2', mockAvailableCategories);

      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
    });
  });
});
