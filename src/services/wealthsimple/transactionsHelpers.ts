/**
 * Wealthsimple Transactions - Shared Helpers
 * Common utility functions used across transaction processing modules
 */

import { debugLog, formatDate } from '../../core/utils';
import { applyMerchantMapping } from '../../mappers/merchant';
import { applyWealthsimpleCategoryMapping, saveUserWealthsimpleCategorySelection, calculateAllCategorySimilarities, type MonarchCategory, type ManualSelectionResult } from '../../mappers/category';
import { showMonarchCategorySelector } from '../../ui/components/categorySelector';
import monarchApi from '../../api/monarch';
import toast from '../../ui/toast';
import {
  formatOriginalStatement,
  formatSpendNotes,
  getTransactionId,
} from './transactionRules';
import { type WealthsimpleTransaction } from './transactionRulesHelpers';

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface ProcessedTransaction {
  id: string;
  date: string;
  merchant: string;
  originalMerchant: string;
  amount: number;
  type: string | null | undefined;
  subType: string | null | undefined;
  status: string | null | undefined;
  unifiedStatus?: string | null | undefined;
  notes: string;
  categoryKey: string;
  resolvedMonarchCategory?: string;
  isPending?: boolean;
  technicalDetails?: string;
  needsCategoryMapping?: boolean;
  aftDetails?: {
    aftTransactionCategory: string;
    aftTransactionType: string;
    aftOriginatorName: string;
  };
  billPayDetails?: {
    billPayCompanyName: string;
    billPayPayeeNickname: string;
    redactedExternalAccountNumber: string;
  };
  p2pDetails?: {
    type: string;
    subType: string;
    p2pHandle: string;
  };
  [key: string]: unknown;
}

export interface CategoryResolutionOptions {
  onProgress?: (message: string) => void;
  skipCategorization?: boolean;
}

export interface ProcessCreditCardOptions {
  stripStoreNumbers?: boolean;
  spendDetailsMap?: Map<string, unknown> | null;
}

// ── Functions ────────────────────────────────────────────────────────────────

/**
 * Collect EFT transfer IDs from transactions for batch enrichment
 */
export function collectEftTransferIds(transactions: WealthsimpleTransaction[]): string[] {
  const eftTransferIds: string[] = [];

  for (const tx of transactions) {
    if (
      (tx.subType === 'EFT' || tx.subType === 'EFT_RECURRING') &&
      tx.externalCanonicalId &&
      tx.externalCanonicalId.startsWith('funding_intent-')
    ) {
      eftTransferIds.push(tx.externalCanonicalId);
    }
  }

  return eftTransferIds;
}

/**
 * Convert ISO timestamp to local date in YYYY-MM-DD format
 */
export function convertToLocalDate(isoTimestamp: string | null | undefined): string {
  if (!isoTimestamp) return '';

  const date = new Date(isoTimestamp);
  return formatDate(date);
}

/**
 * Process credit card transaction to extract relevant data
 */
export function processCreditCardTransaction(
  transaction: WealthsimpleTransaction,
  options: ProcessCreditCardOptions = {},
): ProcessedTransaction {
  const { stripStoreNumbers = true, spendDetailsMap = null } = options;

  const autoMapping = getAutoMappingForSubType(transaction.subType);

  let merchantName: string;
  if (autoMapping && autoMapping.merchant) {
    merchantName = autoMapping.merchant;
  } else if (transaction.subType === 'PAYMENT') {
    merchantName = 'Credit Card Payment';
  } else {
    merchantName = (transaction.spendMerchant as string | null | undefined) || 'Unknown Merchant';
  }

  const cleanedMerchant = applyMerchantMapping(merchantName, { stripStoreNumbers });

  const isNegative = transaction.amountSign === 'negative';
  const finalAmount = isNegative ? -Math.abs(transaction.amount ?? 0) : Math.abs(transaction.amount ?? 0);

  let notes = '';
  if (transaction.subType === 'PURCHASE' && spendDetailsMap) {
    const spendDetails = spendDetailsMap.get(transaction.externalCanonicalId ?? '');
    if (spendDetails) {
      notes = formatSpendNotes(spendDetails as Parameters<typeof formatSpendNotes>[0]);
    }
  }

  return {
    id: getTransactionId(transaction),
    date: convertToLocalDate(transaction.occurredAt),
    merchant: cleanedMerchant,
    originalMerchant: formatOriginalStatement(transaction.type, transaction.subType, merchantName),
    amount: finalAmount,
    type: transaction.type,
    subType: transaction.subType,
    status: transaction.status as string | null | undefined,
    notes,
    categoryKey: cleanedMerchant,
  };
}

/**
 * Filter transactions for syncing
 */
export function filterSyncableTransactions(
  transactions: WealthsimpleTransaction[],
  includePending = true,
): WealthsimpleTransaction[] {
  return transactions.filter((transaction) => {
    if (transaction.status === 'settled' || transaction.status === 'completed') return true;
    if (includePending && transaction.status === 'authorized') return true;
    return false;
  });
}

interface AutoMapping {
  category: string;
  merchant?: string;
}

/**
 * Get auto-category and merchant for specific transaction subtypes
 */
export function getAutoMappingForSubType(subType: string | null | undefined): AutoMapping | null {
  switch (subType) {
  case 'PAYMENT':
    return { category: 'Credit Card Payment' };
  case 'CASH_WITHDRAWAL':
    return { category: 'Cash & ATM' };
  case 'INTEREST':
    return { category: 'Financial Fees', merchant: 'Cash Advance Interest' };
  default:
    return null;
  }
}

/**
 * Resolve categories for transactions, handling both automatic and manual selection
 */
export async function resolveCategoriesForTransactions(
  transactions: ProcessedTransaction[],
  options: CategoryResolutionOptions = {},
): Promise<ProcessedTransaction[]> {
  const { onProgress, skipCategorization = false } = options;
  if (!transactions || transactions.length === 0) {
    return transactions;
  }

  debugLog('Starting category resolution for Wealthsimple transactions');

  const sessionMappings = new Map<string, string>();
  const oneTimeAssignments = new Map<string, string>();

  let availableCategories: MonarchCategory[] = [];
  try {
    debugLog('Fetching categories from Monarch for similarity scoring');
    const categoryData = await monarchApi.getCategoriesAndGroups();
    availableCategories = categoryData.categories || [];
    debugLog(`Fetched ${availableCategories.length} categories from Monarch`);
  } catch (error) {
    debugLog('Failed to fetch categories from Monarch, will use manual selection for all:', error);
  }

  transactions.forEach((transaction) => {
    const autoMapping = getAutoMappingForSubType(transaction.subType);
    if (autoMapping && autoMapping.category) {
      transaction.resolvedMonarchCategory = autoMapping.category;
    }
  });

  if (skipCategorization) {
    debugLog('Skip categorization enabled - setting Uncategorized for all unresolved transactions');
    return transactions.map((transaction) => {
      if (transaction.resolvedMonarchCategory) {
        return transaction;
      }
      return { ...transaction, resolvedMonarchCategory: 'Uncategorized' };
    });
  }

  const categoriesToResolve: Array<{
    bankCategory: string;
    exampleTransaction: ProcessedTransaction;
    [key: string]: unknown;
  }> = [];
  const uniqueCategories = new Map<string, ProcessedTransaction>();
  const transactionsByCategoryKey = new Map<string, string[]>();

  transactions.forEach((transaction) => {
    if (transaction.resolvedMonarchCategory) {
      return;
    }

    const categoryKey = transaction.categoryKey;
    const upperCategoryKey = categoryKey ? categoryKey.toUpperCase() : '';

    if (!transactionsByCategoryKey.has(upperCategoryKey)) {
      transactionsByCategoryKey.set(upperCategoryKey, []);
    }
    transactionsByCategoryKey.get(upperCategoryKey)!.push(transaction.id);

    if (!uniqueCategories.has(categoryKey)) {
      uniqueCategories.set(categoryKey, transaction);

      const mappingResult = applyWealthsimpleCategoryMapping(categoryKey, availableCategories);

      if (mappingResult && typeof mappingResult === 'object' && (mappingResult as ManualSelectionResult).needsManualSelection) {
        const mr = mappingResult as ManualSelectionResult;
        categoriesToResolve.push({
          ...mr,
          bankCategory: mr.bankCategory as string,
          exampleTransaction: transaction,
        });
      }
    }
  });

  debugLog(`Found ${uniqueCategories.size} unique merchants, ${categoriesToResolve.length} need manual selection`);

  if (categoriesToResolve.length > 0) {
    const totalCategories = categoriesToResolve.length;
    toast.show(`Resolving ${totalCategories} categories that need manual selection...`, 'debug');

    if (onProgress) {
      onProgress(`Resolving categories (0/${totalCategories})`);
    }

    let resolvedCount = 0;
    while (categoriesToResolve.length > 0) {
      const categoryToResolve = categoriesToResolve[0];

      const recheckResult = applyWealthsimpleCategoryMapping(categoryToResolve.bankCategory, availableCategories);

      if (typeof recheckResult === 'string') {
        debugLog(`Category "${categoryToResolve.bankCategory}" now has automatic mapping: ${recheckResult}`);
        categoriesToResolve.shift();
        resolvedCount += 1;
        if (onProgress) {
          onProgress(`Resolving categories (${resolvedCount}/${totalCategories})`);
        }
        continue;
      }

      const remainingCount = categoriesToResolve.length;
      const progressNum = totalCategories - remainingCount + 1;

      debugLog(`Showing category selector for: ${categoryToResolve.bankCategory} (${progressNum}/${totalCategories})`);
      toast.show(`Selecting category ${progressNum} of ${totalCategories}: "${categoryToResolve.bankCategory}"`, 'debug');

      const similarityData = calculateAllCategorySimilarities(categoryToResolve.bankCategory, availableCategories as unknown as Parameters<typeof calculateAllCategorySimilarities>[1]);

      const transactionDetails: Record<string, unknown> = {};
      if (categoryToResolve.exampleTransaction) {
        const exampleTx = categoryToResolve.exampleTransaction;
        transactionDetails.merchant = exampleTx.merchant;
        transactionDetails.amount = exampleTx.amount;
        transactionDetails.date = exampleTx.date;
        transactionDetails.institution = 'wealthsimple';

        if (exampleTx.aftDetails) {
          transactionDetails.aftDetails = exampleTx.aftDetails;
        }

        debugLog('Transaction details for category selector:', transactionDetails);
      }

      const selectedCategory = await new Promise<Record<string, unknown> | null>((resolve) => {
        showMonarchCategorySelector(categoryToResolve.bankCategory, resolve as (cat: unknown) => void, similarityData, transactionDetails);
      });

      if (!selectedCategory) {
        throw new Error(`Category selection cancelled for "${categoryToResolve.bankCategory}". Upload aborted.`);
      }

      if ((selectedCategory as Record<string, unknown>).skipped) {
        debugLog(`Skipped categorization for "${categoryToResolve.bankCategory}" (single transaction)`);
        categoriesToResolve.shift();
        resolvedCount += 1;
        if (onProgress) {
          onProgress(`Resolving categories (${resolvedCount}/${totalCategories})`);
        }
        continue;
      }

      if ((selectedCategory as Record<string, unknown>).skipAll === true) {
        debugLog('User chose "Skip All" - setting Uncategorized for all remaining transactions');
        categoriesToResolve.length = 0;
        return transactions.map((transaction) => {
          if (transaction.resolvedMonarchCategory) {
            return transaction;
          }
          if (oneTimeAssignments.has(transaction.id)) {
            return { ...transaction, resolvedMonarchCategory: oneTimeAssignments.get(transaction.id) };
          }
          const upperKey = transaction.categoryKey ? transaction.categoryKey.toUpperCase() : '';
          if (sessionMappings.has(upperKey)) {
            return { ...transaction, resolvedMonarchCategory: sessionMappings.get(upperKey) };
          }
          return { ...transaction, resolvedMonarchCategory: 'Uncategorized' };
        });
      }

      const upperBankCategory = categoryToResolve.bankCategory.toUpperCase();
      const sel = selectedCategory as Record<string, unknown>;
      const assignmentType = (sel.assignmentType as string) || (sel.rememberMapping !== false ? 'rule' : 'once');

      if (assignmentType === 'rule') {
        saveUserWealthsimpleCategorySelection(categoryToResolve.bankCategory, sel.name as string);
        sessionMappings.set(upperBankCategory, sel.name as string);
        debugLog(`User selected category mapping (saved as rule): ${categoryToResolve.bankCategory} -> ${sel.name}`);
        toast.show(`Saved rule: "${categoryToResolve.bankCategory}" → "${sel.name}"`, 'debug');
      } else {
        const transactionId = categoryToResolve.exampleTransaction?.id;
        if (transactionId) {
          oneTimeAssignments.set(transactionId, sel.name as string);
          debugLog(`User selected category mapping (one-time for ${transactionId}): ${categoryToResolve.bankCategory} -> ${sel.name}`);
        }
        toast.show(`Assigned once: "${categoryToResolve.bankCategory}" → "${sel.name}"`, 'debug');
      }

      categoriesToResolve.shift();
      resolvedCount += 1;
      if (onProgress) {
        onProgress(`Resolving categories (${resolvedCount}/${totalCategories})`);
      }
    }
  }

  const resolvedTransactions = transactions.map((transaction) => {
    if (transaction.resolvedMonarchCategory) {
      return transaction;
    }

    if (oneTimeAssignments.has(transaction.id)) {
      return { ...transaction, resolvedMonarchCategory: oneTimeAssignments.get(transaction.id) };
    }

    const categoryKey = transaction.categoryKey;
    const upperCategoryKey = categoryKey ? categoryKey.toUpperCase() : '';

    if (sessionMappings.has(upperCategoryKey)) {
      return { ...transaction, resolvedMonarchCategory: sessionMappings.get(upperCategoryKey) };
    }

    const mappingResult = applyWealthsimpleCategoryMapping(categoryKey, availableCategories);
    const resolvedCategory = typeof mappingResult === 'string' ? mappingResult : 'Uncategorized';

    return { ...transaction, resolvedMonarchCategory: resolvedCategory };
  });

  debugLog('Category resolution completed for all transactions');
  return resolvedTransactions;
}
