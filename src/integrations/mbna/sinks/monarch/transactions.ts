/**
 * MBNA → Monarch Transaction Mapper
 *
 * Processes raw MBNA transactions into a format suitable for Monarch CSV upload.
 * Handles merchant sanitization, category resolution, and PAYMENT auto-categorization.
 *
 * Explicitly coupled to Monarch's data format — this is by design.
 *
 * @module integrations/mbna/sinks/monarch/transactions
 */

import { debugLog, stringSimilarity } from '../../../../core/utils';
import { applyMerchantMapping } from '../../../../mappers/merchant';
import { INTEGRATIONS } from '../../../../core/integrationCapabilities';
import { getCategoryMapping, setCategoryMapping } from '../../../../services/common/configStore';
import { calculateAllCategorySimilarities } from '../../../../mappers/category';
import { showMonarchCategorySelector } from '../../../../ui/components/categorySelector';
import monarchApi from '../../../../api/monarch';
import accountService from '../../../../services/common/accountService';
import type { MbnaRawTransaction } from '../../source/balanceReconstruction';
import type { StoredTransaction } from '../../../../utils/transactionStorage';

// ── Interfaces ──────────────────────────────────────────────

/** Auto-categorization rule for MBNA transactions */
interface AutoCategorizeRule {
  pattern: RegExp;
  category: string;
  merchant: string;
}

/** Processing options for processTransaction */
interface ProcessTransactionOptions {
  isPending?: boolean;
  pendingId?: string | null;
}

/** A processed MBNA transaction ready for CSV conversion */
export interface ProcessedMbnaTransaction {
  date: string;
  merchant: string;
  originalStatement: string;
  amount: number;
  referenceNumber: string;
  isPending: boolean;
  pendingId: string | null;
  autoCategory: string | null;
  resolvedMonarchCategory?: string;
}

/** Result of processMbnaTransactions */
export interface ProcessedTransactionsResult {
  settled: ProcessedMbnaTransaction[];
  pending: ProcessedMbnaTransaction[];
  all: ProcessedMbnaTransaction[];
}

/** Options for processMbnaTransactions */
interface ProcessMbnaOptions {
  includePending?: boolean;
}

/** Result of filterDuplicateSettledTransactions */
export interface DuplicateFilterResult {
  newTransactions: ProcessedMbnaTransaction[];
  duplicateCount: number;
}

/** Category selection result from the category selector UI */
interface CategorySelectionResult {
  name?: string;
  skipped?: boolean;
  skipAll?: boolean;
}

/** Monarch category object (from API) */
interface MonarchCategoryItem {
  name: string;
  [key: string]: unknown;
}

// ── Constants ───────────────────────────────────────────────

/**
 * Auto-categorization rules for MBNA transactions
 * Maps description patterns to { category, merchant } overrides
 */
const AUTO_CATEGORIZE_RULES: AutoCategorizeRule[] = [
  {
    pattern: /^PAYMENT$/i,
    category: 'Credit Card Payment',
    merchant: 'MBNA Credit Card Payment',
  },
];

// ── Internal Helpers ────────────────────────────────────────

/**
 * Apply auto-categorization rules to a transaction
 * @param description - Raw MBNA transaction description
 * @returns { category, merchant } if matched, null otherwise
 */
function applyAutoCategorization(description: string): { category: string; merchant: string } | null {
  if (!description) return null;

  for (const rule of AUTO_CATEGORIZE_RULES) {
    if (rule.pattern.test(description.trim())) {
      return { category: rule.category, merchant: rule.merchant };
    }
  }

  return null;
}

/**
 * Process a single MBNA transaction into Monarch-ready format
 *
 * @param tx - Raw MBNA transaction from API
 * @param options - Processing options
 * @returns Processed transaction ready for CSV conversion
 */
function processTransaction(tx: MbnaRawTransaction, options: ProcessTransactionOptions = {}): ProcessedMbnaTransaction {
  const { isPending = false, pendingId = null } = options;
  const description = tx.description || '';

  // Check auto-categorization rules first
  const autoCategory = applyAutoCategorization(description);

  // Apply merchant mapping (includes asterisk stripping)
  const mappedMerchant = autoCategory?.merchant || applyMerchantMapping(description);

  return {
    date: tx.transactionDate || tx.postingDate || '',
    merchant: mappedMerchant,
    originalStatement: description,
    // Amount signs inverted for Monarch: MBNA positive (charge) → negative, MBNA negative (payment) → positive
    amount: tx.amount !== null && tx.amount !== undefined ? -tx.amount : 0,
    referenceNumber: tx.referenceNumber || '',
    isPending,
    pendingId: pendingId || null,
    // Category will be resolved later via resolveCategoriesForTransactions
    autoCategory: autoCategory?.category || null,
  };
}

/**
 * Check if a merchant has a high-confidence auto-match to a Monarch category
 * @param merchant - Merchant name to match
 * @param availableCategories - Available Monarch categories
 * @returns Auto-matched category name or null
 */
function findAutoMatch(merchant: string, availableCategories: MonarchCategoryItem[]): string | null {
  if (!merchant || !availableCategories || availableCategories.length === 0) return null;

  const normalizedMerchant = merchant.toLowerCase().trim();
  let bestMatch: string | null = null;
  let bestScore = 0;

  for (const category of availableCategories) {
    const categoryName = typeof category === 'string' ? category : category.name;
    if (!categoryName) continue;
    const score = stringSimilarity(normalizedMerchant, categoryName.toLowerCase());
    if (score > bestScore) {
      bestScore = score;
      bestMatch = categoryName;
    }
  }

  // Only auto-match at very high confidence
  if (bestScore > 0.95) {
    debugLog(`MBNA auto-match: "${merchant}" → "${bestMatch}" (score: ${bestScore.toFixed(3)})`);
    return bestMatch;
  }

  return null;
}

// ── Exported Functions ──────────────────────────────────────

/**
 * Process all MBNA transactions (settled + pending) into Monarch-ready format
 *
 * @param settledTransactions - Settled transactions from API
 * @param pendingTransactions - Pending transactions (with generatedId from dedup)
 * @param options - Processing options
 * @returns { settled, pending, all }
 */
export function processMbnaTransactions(
  settledTransactions: MbnaRawTransaction[],
  pendingTransactions: Array<MbnaRawTransaction & { generatedId?: string }>,
  options: ProcessMbnaOptions = {},
): ProcessedTransactionsResult {
  const { includePending = true } = options;

  const settled = settledTransactions.map((tx) => processTransaction(tx, { isPending: false }));

  const pending = includePending
    ? pendingTransactions.map((tx) => processTransaction(tx, {
      isPending: true,
      pendingId: tx.generatedId || null,
    }))
    : [];

  debugLog('Processed MBNA transactions:', {
    settledCount: settled.length,
    pendingCount: pending.length,
    autoCategorizedCount: [...settled, ...pending].filter((t) => t.autoCategory).length,
  });

  return {
    settled,
    pending,
    all: [...settled, ...pending],
  };
}

/**
 * Resolve categories for processed MBNA transactions
 *
 * Uses the common category resolution flow:
 * 1. Auto-categorized transactions (e.g., PAYMENT → Credit Card Payment) keep their category
 * 2. Stored category mappings are applied (merchant name → Monarch category)
 * 3. High-confidence similarity matches are applied automatically
 * 4. Remaining transactions prompt the user for manual categorization (unless skipCategorization)
 *
 * @param transactions - Processed MBNA transactions from processMbnaTransactions
 * @param mbnaAccountId - MBNA account ID (for per-account settings)
 * @returns Transactions with resolvedMonarchCategory set
 */
export async function resolveMbnaCategories(
  transactions: ProcessedMbnaTransaction[],
  mbnaAccountId: string,
): Promise<ProcessedMbnaTransaction[]> {
  if (!transactions || transactions.length === 0) return [];

  // Read skipCategorization setting from account data
  const accountData = accountService.getAccountData(INTEGRATIONS.MBNA, mbnaAccountId) as Record<string, unknown> | null;
  const skipCategorization = accountData?.skipCategorization === true;

  // Separate auto-categorized from those needing resolution
  const autoCategorized = new Set<ProcessedMbnaTransaction>();
  for (const tx of transactions) {
    if (tx.autoCategory) {
      autoCategorized.add(tx);
    }
  }

  // If skipCategorization, set Uncategorized for all non-auto-categorized and return
  if (skipCategorization) {
    debugLog('MBNA: skipCategorization enabled — setting Uncategorized for non-auto-categorized');
    const result = transactions.map((tx) => {
      if (autoCategorized.has(tx)) {
        return { ...tx, resolvedMonarchCategory: tx.autoCategory! };
      }
      return { ...tx, resolvedMonarchCategory: 'Uncategorized' };
    });
    debugLog('MBNA category resolution complete (skipped):', {
      total: transactions.length,
      autoCategorized: autoCategorized.size,
    });
    return result;
  }

  // Fetch available Monarch categories for similarity matching and manual selection
  let availableCategories: MonarchCategoryItem[] = [];
  try {
    const categoryData = await monarchApi.getCategoriesAndGroups();
    availableCategories = (categoryData.categories || []) as MonarchCategoryItem[];
  } catch (error) {
    debugLog('MBNA: Failed to fetch Monarch categories:', error);
  }

  // Resolve categories: stored mappings → auto-match → collect for manual prompt
  const resolvedMap = new Map<number, string>(); // tx index → resolvedMonarchCategory
  const uniqueMerchants = new Map<string, { resolved?: string; needsManual?: boolean; exampleTx?: ProcessedMbnaTransaction }>();

  for (let i = 0; i < transactions.length; i += 1) {
    const tx = transactions[i];

    if (autoCategorized.has(tx)) {
      resolvedMap.set(i, tx.autoCategory!);
      continue;
    }

    const merchant = tx.merchant || '';
    if (uniqueMerchants.has(merchant)) {
      // Already resolved or queued for this merchant — skip
      continue;
    }

    // 1. Check stored mapping
    const storedMapping = getCategoryMapping(INTEGRATIONS.MBNA, merchant) as string | null;
    if (storedMapping) {
      uniqueMerchants.set(merchant, { resolved: storedMapping });
      continue;
    }

    // 2. Check high-confidence auto-match
    const autoMatch = findAutoMatch(merchant, availableCategories);
    if (autoMatch) {
      setCategoryMapping(INTEGRATIONS.MBNA, merchant, autoMatch);
      uniqueMerchants.set(merchant, { resolved: autoMatch });
      continue;
    }

    // 3. Needs manual resolution
    uniqueMerchants.set(merchant, { needsManual: true, exampleTx: tx });
  }

  // Collect merchants needing manual categorization
  const merchantsNeedingManual: Array<{ merchant: string; exampleTx?: ProcessedMbnaTransaction }> = [];
  for (const [merchant, info] of uniqueMerchants) {
    if (info.needsManual) {
      merchantsNeedingManual.push({ merchant, exampleTx: info.exampleTx });
    }
  }

  // Prompt user for each unresolved merchant
  let skipAllTriggered = false;

  if (merchantsNeedingManual.length > 0 && availableCategories.length > 0) {
    debugLog(`MBNA: ${merchantsNeedingManual.length} merchants need manual categorization`);

    for (const { merchant, exampleTx } of merchantsNeedingManual) {
      if (skipAllTriggered) {
        uniqueMerchants.set(merchant, { resolved: 'Uncategorized' });
        continue;
      }

      const similarityData = calculateAllCategorySimilarities(merchant, availableCategories);

      const transactionDetails: Record<string, unknown> = {};
      if (exampleTx) {
        transactionDetails.merchant = exampleTx.originalStatement || merchant;
        transactionDetails.amount = exampleTx.amount || 0;
        if (exampleTx.date) {
          transactionDetails.date = exampleTx.date;
        }
      }

      const selectedCategory = await new Promise<CategorySelectionResult | null>((resolve) => {
        showMonarchCategorySelector(merchant, resolve, similarityData, transactionDetails);
      });

      if (!selectedCategory) {
        throw new Error(`Category selection cancelled for "${merchant}".`);
      }

      if (selectedCategory.skipAll === true) {
        debugLog('MBNA: User chose "Skip All" — setting Uncategorized for remaining');
        skipAllTriggered = true;
        uniqueMerchants.set(merchant, { resolved: 'Uncategorized' });
        continue;
      }

      if (selectedCategory.skipped) {
        debugLog(`MBNA: Skipped categorization for "${merchant}"`);
        uniqueMerchants.set(merchant, { resolved: 'Uncategorized' });
        continue;
      }

      // Save user selection for future syncs
      setCategoryMapping(INTEGRATIONS.MBNA, merchant, selectedCategory.name!);
      uniqueMerchants.set(merchant, { resolved: selectedCategory.name });
    }
  } else if (merchantsNeedingManual.length > 0) {
    // No categories available — set Uncategorized
    for (const { merchant } of merchantsNeedingManual) {
      uniqueMerchants.set(merchant, { resolved: 'Uncategorized' });
    }
  }

  // Build final result array preserving original order
  const result = transactions.map((tx, i) => {
    // Already resolved (auto-categorized)
    if (resolvedMap.has(i)) {
      return { ...tx, resolvedMonarchCategory: resolvedMap.get(i)! };
    }

    const merchant = tx.merchant || '';
    const merchantInfo = uniqueMerchants.get(merchant);
    const category = merchantInfo?.resolved || 'Uncategorized';
    return { ...tx, resolvedMonarchCategory: category };
  });

  debugLog('MBNA category resolution complete:', {
    total: transactions.length,
    autoCategorized: autoCategorized.size,
    storedMappings: [...uniqueMerchants.values()].filter((v) => v.resolved && !v.needsManual).length,
    manuallyResolved: merchantsNeedingManual.length,
    skipAllTriggered,
  });

  return result;
}

/**
 * Filter already-uploaded transactions using deduplication store
 *
 * Uses referenceNumber for settled transactions to detect duplicates.
 * Pending transactions are always re-uploaded (reconciliation handles them).
 *
 * @param settledTransactions - Processed settled transactions
 * @param uploadedTransactions - Previously uploaded transaction records from account storage
 * @returns { newTransactions, duplicateCount }
 */
export function filterDuplicateSettledTransactions(
  settledTransactions: ProcessedMbnaTransaction[],
  uploadedTransactions: StoredTransaction[],
): DuplicateFilterResult {
  if (!uploadedTransactions || uploadedTransactions.length === 0) {
    return { newTransactions: settledTransactions, duplicateCount: 0 };
  }

  const uploadedRefSet = new Set(uploadedTransactions.map((t) => t.id));
  const newTransactions: ProcessedMbnaTransaction[] = [];
  let duplicateCount = 0;

  for (const tx of settledTransactions) {
    if (tx.referenceNumber && uploadedRefSet.has(tx.referenceNumber)) {
      duplicateCount += 1;
    } else {
      newTransactions.push(tx);
    }
  }

  if (duplicateCount > 0) {
    debugLog(`Filtered ${duplicateCount} duplicate MBNA settled transactions`);
  }

  return { newTransactions, duplicateCount };
}

export default {
  processMbnaTransactions,
  resolveMbnaCategories,
  filterDuplicateSettledTransactions,
};