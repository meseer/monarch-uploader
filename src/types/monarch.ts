/**
 * Shared Monarch Domain Types
 *
 * Canonical type definitions for Monarch Money domain objects that cross
 * layer boundaries (API → services → UI). All layers import from this
 * module instead of defining local interfaces.
 *
 * See ADR-006 for the decision record.
 *
 * @module types/monarch
 */

// ============================================================
// CATEGORY TYPES
// ============================================================

/**
 * A Monarch category as returned by getCategoriesAndGroups.
 * Used across the category mapper, category selector UI, and upload services.
 */
export interface MonarchCategory {
  id: string;
  name: string;
  icon?: string;
  isSystemCategory?: boolean;
  isDisabled?: boolean;
  order?: number;
  group?: CategoryGroupRef;
  /** Similarity score added by calculateAllCategorySimilarities */
  similarityScore?: number;
  [key: string]: unknown;
}

/**
 * Reference to a category group (embedded in a category object).
 */
export interface CategoryGroupRef {
  id: string;
  name?: string;
  type?: string;
  [key: string]: unknown;
}

/**
 * A category group containing its categories.
 * Produced by getCategoriesAndGroups + grouping logic in categorySelector and category mapper.
 */
export interface CategoryGroup {
  id: string;
  name: string;
  type?: string;
  order?: number;
  categories: MonarchCategory[];
  categoryCount: number;
  maxSimilarityScore?: number;
  [key: string]: unknown;
}

/**
 * Result of category similarity calculation.
 * Returned by calculateAllCategorySimilarities in the category mapper,
 * consumed by showMonarchCategorySelector in the UI.
 */
export interface SimilarityInfo {
  score?: number;
  bestMatch?: string;
  categoryGroups?: CategoryGroup[];
  [key: string]: unknown;
}

/**
 * Result from category selector callback.
 * Extends MonarchCategory with assignment metadata.
 */
export interface CategoryCallbackResult extends MonarchCategory {
  assignmentType?: string;
  skipped?: boolean;
  skipAll?: boolean;
}

/**
 * Callback type for category selection.
 */
export type CategoryCallback = (result: CategoryCallbackResult | null) => void;

// ============================================================
// BALANCE TYPES
// ============================================================

/**
 * Balance information used across balance upload, account display, and account creation.
 * Nullable amount variant — used in account creation dialogs and display contexts
 * where balance may not yet be known.
 */
export interface BalanceInfo {
  amount: number | null | undefined;
  currency?: string;
}

/**
 * Current balance as returned by fetchAccountBalances API calls.
 * Non-nullable amount — the balance is always known when fetched from the API.
 *
 * Canonical definition — replaces local CurrentBalance interfaces in:
 * - src/services/wealthsimple/balance.ts
 * - src/services/wealthsimple/account.ts
 * - src/services/wealthsimple-upload.ts
 */
export interface CurrentBalance {
  amount: number;
  currency?: string;
}

/**
 * A stored balance checkpoint used for incremental balance reconstruction.
 * Saved per-account after each successful sync to avoid full history rebuilds.
 *
 * Canonical definition — replaces local BalanceCheckpoint interfaces in:
 * - src/services/wealthsimple/balance.ts
 * - src/services/wealthsimple/account.ts
 */
export interface BalanceCheckpoint {
  date: string;
  amount: number;
}
