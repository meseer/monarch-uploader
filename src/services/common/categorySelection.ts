/**
 * Category Selection Helper
 *
 * Shared, layer-appropriate logic for interpreting a manual category-selector
 * result and resolving a transaction's category from the current sync session.
 *
 * The category selector UI (`showMonarchCategorySelector`) returns a result
 * carrying an `assignmentType`:
 * - `'rule'` — user clicked "Save as Rule": persist a permanent mapping AND
 *   apply it to all matching transactions this sync.
 * - `'once'` — user clicked "Assign Once": apply to all matching transactions
 *   THIS sync only, WITHOUT persisting a rule for future syncs.
 *
 * This module centralizes the rule-vs-once decision so every integration
 * behaves consistently. It intentionally stays in the services layer: it does
 * NOT touch the DOM or prompt the user (that remains the caller's job), and it
 * receives the integration-specific persistence via an injected callback.
 *
 * @module services/common/categorySelection
 */

import { debugLog } from '../../core/utils';

/** How a manual category selection should be applied. */
export type AssignmentType = 'rule' | 'once';

/** Minimal shape of a category selector result consumed by this helper. */
export interface CategorySelectionResult {
  name?: string;
  assignmentType?: string;
  skipped?: boolean;
  skipAll?: boolean;
  /** Legacy flag: when explicitly false, treat as one-time (no persistence). */
  rememberMapping?: boolean;
}

/** Outcome of interpreting a single selector result. */
export interface HandleSelectionOutcome {
  /** User skipped this single selection. */
  skipped?: boolean;
  /** User chose to skip all remaining selections this sync. */
  skipAll?: boolean;
  /** The assigned Monarch category name (present when a category was chosen). */
  assigned?: string;
  /** Whether the assignment was persisted as a permanent rule. */
  persisted?: boolean;
}

/** Parameters for {@link handleCategorySelection}. */
export interface HandleSelectionParams {
  /** The source key (merchant/category/action), normalized (e.g. upper-cased). */
  sourceKey: string;
  /** The selector result to interpret. */
  selection: CategorySelectionResult;
  /** Session map of rule selections made this sync (mutated in place). */
  sessionMappings: Map<string, string>;
  /** Session map of one-time selections made this sync (mutated in place). */
  oneTimeAssignments: Map<string, string>;
  /**
   * Integration-specific persistence callback. Called ONLY for `'rule'`
   * assignments. Receives the original (non-normalized) source key so each
   * integration can apply its own casing/storage convention.
   */
  persist: (sourceKey: string, category: string) => void;
  /**
   * The original (non-normalized) source key passed to `persist`.
   * Defaults to `sourceKey` when omitted.
   */
  persistKey?: string;
}

/**
 * Determine the assignment type from a selector result.
 *
 * Precedence:
 * 1. Explicit `assignmentType` ('rule' | 'once')
 * 2. Legacy `rememberMapping === false` → 'once'
 * 3. Default → 'rule' (preserve existing "save mapping" default)
 *
 * @param selection - Selector result
 * @returns Resolved assignment type
 */
export function getAssignmentType(selection: CategorySelectionResult): AssignmentType {
  if (selection.assignmentType === 'once' || selection.assignmentType === 'rule') {
    return selection.assignmentType;
  }
  return selection.rememberMapping === false ? 'once' : 'rule';
}

/**
 * Interpret a single category selector result for a source key.
 *
 * Handles skip / skipAll passthrough, and records the chosen category in the
 * appropriate session map. For `'rule'` assignments it also invokes the
 * integration's `persist` callback; for `'once'` it does NOT persist.
 *
 * Both maps are keyed by the normalized `sourceKey`. In the final resolution
 * pass, call {@link resolveFromSession} so every transaction sharing the key
 * receives the chosen category this sync.
 *
 * @param params - Selection handling parameters
 * @returns Outcome describing skip/skipAll or the assigned category
 */
export function handleCategorySelection({
  sourceKey,
  selection,
  sessionMappings,
  oneTimeAssignments,
  persist,
  persistKey,
}: HandleSelectionParams): HandleSelectionOutcome {
  if (selection.skipAll === true) {
    return { skipAll: true };
  }

  if (selection.skipped === true) {
    return { skipped: true };
  }

  const category = selection.name;
  if (!category) {
    // No category and not a skip — treat as skipped to avoid persisting noise.
    return { skipped: true };
  }

  const assignmentType = getAssignmentType(selection);
  const originalKey = persistKey ?? sourceKey;

  if (assignmentType === 'rule') {
    persist(originalKey, category);
    sessionMappings.set(sourceKey, category);
    debugLog(`[categorySelection] Saved rule: "${originalKey}" → "${category}"`);
    return { assigned: category, persisted: true };
  }

  // 'once' — apply this sync only, do NOT persist a rule.
  oneTimeAssignments.set(sourceKey, category);
  debugLog(`[categorySelection] Assigned once (no rule): "${originalKey}" → "${category}"`);
  return { assigned: category, persisted: false };
}

/** Parameters for {@link resolveFromSession}. */
export interface ResolveFromSessionParams {
  /** The normalized source key for the transaction being resolved. */
  sourceKey: string;
  /** Session map of one-time selections made this sync. */
  oneTimeAssignments: Map<string, string>;
  /** Session map of rule selections made this sync. */
  sessionMappings: Map<string, string>;
}

/**
 * Resolve a transaction's category from the current sync session maps.
 *
 * One-time assignments take precedence over rule selections (both were made
 * this sync; if a key somehow appears in both, the explicit one-time choice
 * wins). Returns null when the key was not resolved this sync, letting the
 * caller fall back to stored mappings / auto-match / 'Uncategorized'.
 *
 * @param params - Resolution parameters
 * @returns Monarch category name or null
 */
export function resolveFromSession({
  sourceKey,
  oneTimeAssignments,
  sessionMappings,
}: ResolveFromSessionParams): string | null {
  if (oneTimeAssignments.has(sourceKey)) {
    return oneTimeAssignments.get(sourceKey)!;
  }
  if (sessionMappings.has(sourceKey)) {
    return sessionMappings.get(sourceKey)!;
  }
  return null;
}

export default {
  getAssignmentType,
  handleCategorySelection,
  resolveFromSession,
};