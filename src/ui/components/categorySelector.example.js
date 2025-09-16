/**
 * Category Selector Usage Examples
 * This file demonstrates how to use the category selector component
 */

import categorySelector from './categorySelector';

/**
 * Example 1: Basic inline selector usage
 * Use this when you have a pre-filtered list of categories
 */
export function createInlineCategorySelectorExample() {
  // Sample categories (in real use, these come from Monarch API)
  const categories = [
    {
      id: 'cat-1',
      name: 'Restaurants',
      icon: '🍽️',
      isSystemCategory: false,
      group: { id: 'group-1', name: 'Food & Dining', type: 'expense' },
    },
    {
      id: 'cat-2',
      name: 'Groceries',
      icon: '🛒',
      isSystemCategory: false,
      group: { id: 'group-1', name: 'Food & Dining', type: 'expense' },
    },
    {
      id: 'cat-3',
      name: 'Fast Food',
      icon: '🍔',
      isSystemCategory: false,
      group: { id: 'group-1', name: 'Food & Dining', type: 'expense' },
    },
  ];

  const bankCategory = 'RESTAURANTS';

  // Create the selector
  const selector = categorySelector.create({
    bankCategory,
    categories,
    onChange: (selectedCategory) => {
      if (selectedCategory) {
        console.log('User selected category:', selectedCategory);
        // In real usage, you would:
        // 1. Save the mapping to storage
        // 2. Update the UI to show the mapping
        // 3. Use this for future transaction categorization
        saveCategoryMapping(bankCategory, selectedCategory);
      }
    },
    placeholderText: 'Choose matching Monarch category...',
  });

  return selector;
}

/**
 * Example 2: Modal selector usage
 * Use this when you want the full sophisticated UI with category groups
 */
export function showModalCategorySelectorExample() {
  const bankCategory = 'GROCERY_STORES';

  // Show the modal selector
  categorySelector.showMonarchCategorySelector(bankCategory, (selectedCategory) => {
    if (selectedCategory) {
      console.log('User selected category from modal:', selectedCategory);
      // selectedCategory contains the full category object:
      // {
      //   id: 'cat-123',
      //   name: 'Groceries',
      //   icon: '🛒',
      //   isSystemCategory: false,
      //   group: { id: 'group-1', name: 'Food & Dining', type: 'expense' }
      // }

      saveCategoryMapping(bankCategory, selectedCategory);
      updateUIWithMapping(bankCategory, selectedCategory);
    } else {
      console.log('User cancelled category selection');
    }
  });
}

/**
 * Example 3: Integration with transaction processing
 * Show how this might be used in a real transaction upload flow
 */
export function integrateWithTransactionFlow() {
  // Sample transaction data from bank
  const bankTransactions = [
    {
      id: 'txn-1',
      description: 'STARBUCKS COFFEE #123',
      amount: -4.75,
      category: 'RESTAURANTS', // This is the bank's category
    },
    {
      id: 'txn-2',
      description: 'WHOLE FOODS MARKET',
      amount: -85.20,
      category: 'GROCERY_STORES', // This needs mapping
    },
  ];

  // Process each unique bank category
  const uniqueBankCategories = [...new Set(bankTransactions.map((txn) => txn.category))];

  uniqueBankCategories.forEach((bankCategory) => {
    // Check if we already have a mapping for this bank category
    const existingMapping = getCategoryMapping();

    if (!existingMapping) {
      // No mapping exists, show selector to user
      console.log(`Need to map bank category: ${bankCategory}`);

      // Show the modal selector for this bank category
      categorySelector.showMonarchCategorySelector(bankCategory, (selectedCategory) => {
        if (selectedCategory) {
          // Save the mapping for future use
          saveCategoryMapping(bankCategory, selectedCategory);

          // Update all transactions with this bank category
          updateTransactionsWithMapping(bankTransactions, bankCategory, selectedCategory);

          console.log(`Mapped ${bankCategory} to ${selectedCategory.name}`);
        }
      });
    } else {
      // We already have a mapping, use it
      updateTransactionsWithMapping(bankTransactions, bankCategory, existingMapping);
    }
  });
}

/**
 * Helper functions for the examples
 */

function saveCategoryMapping(bankCategory, monarchCategory) {
  // In real implementation, this would save to GM_setValue or similar storage
  const mappingData = {
    bankCategory,
    monarchCategory,
    createdAt: new Date().toISOString(),
  };

  // GM_setValue(`category_mapping_${bankCategory}`, JSON.stringify(mappingData));
  console.log('Saved category mapping:', mappingData);
}

function getCategoryMapping() {
  // In real implementation, this would read from GM_getValue or similar storage

  // const storedMapping = GM_getValue(`category_mapping_${bankCategory}`, null);
  // return storedMapping ? JSON.parse(storedMapping).monarchCategory : null;

  // For example purposes, return null (no existing mapping)
  return null;
}

function updateUIWithMapping(bankCategory, monarchCategory) {
  console.log(`UI updated: ${bankCategory} → ${monarchCategory.name}`);
  // In real implementation, this would update the UI to show the mapping
}

function updateTransactionsWithMapping(transactions, bankCategory, monarchCategory) {
  const updatedTransactions = transactions.map((txn) => {
    if (txn.category === bankCategory) {
      return {
        ...txn,
        monarchCategory: monarchCategory.name,
        monarchCategoryId: monarchCategory.id,
      };
    }
    return txn;
  });

  console.log('Updated transactions with mapping:', updatedTransactions);
  return updatedTransactions;
}

/**
 * Example 4: Bulk category mapping
 * For setting up multiple category mappings at once
 */
export function bulkCategoryMappingExample() {
  const bankCategories = [
    'RESTAURANTS',
    'GROCERY_STORES',
    'GAS_STATIONS',
    'DEPARTMENT_STORES',
    'PHARMACIES',
  ];

  let currentIndex = 0;

  function mapNextCategory() {
    if (currentIndex >= bankCategories.length) {
      console.log('All categories mapped!');
      return;
    }

    const bankCategory = bankCategories[currentIndex];

    categorySelector.showMonarchCategorySelector(bankCategory, (selectedCategory) => {
      if (selectedCategory) {
        saveCategoryMapping(bankCategory, selectedCategory);
        console.log(`✓ Mapped ${bankCategory} to ${selectedCategory.name}`);
      } else {
        console.log(`✗ Skipped ${bankCategory}`);
      }

      currentIndex += 1;
      // Small delay before showing next selector
      setTimeout(mapNextCategory, 500);
    });
  }

  // Start the bulk mapping process
  mapNextCategory();
}

// Export all examples
export default {
  createInlineCategorySelectorExample,
  showModalCategorySelectorExample,
  integrateWithTransactionFlow,
  bulkCategoryMappingExample,
};
