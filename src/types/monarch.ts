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
// ACCOUNT TYPES
// ============================================================

/**
 * Account details returned from account selection/creation dialogs.
 * Used across account selector UI, upload services, and account mapping.
 */
export interface AccountDetails {
  id: string;
  displayName?: string;
  currentBalance?: number;
  signedBalance?: number;
  logoUrl?: string | null;
  type?: { name: string };
  subtype?: { name: string; display?: string };
  isManual?: boolean;
  icon?: string;
  limit?: number;
  /** Set when user created a new account in the dialog */
  newlyCreated?: boolean;
  /** Set when user chose to skip mapping */
  skipped?: boolean;
  [key: string]: unknown;
}

/**
 * Callback type for account selection.
 */
export type AccountCallback = (account: AccountDetails | null) => void;

// ============================================================
// BALANCE TYPES
// ============================================================

/**
 * Balance information used across balance upload, account display, and account creation.
 * The canonical definition — replaces BalanceInfo in core/utils and CurrentBalance in services.
 */
export interface BalanceInfo {
  amount: number | null | undefined;
  currency?: string;
}