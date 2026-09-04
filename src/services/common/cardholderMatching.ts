/**
 * Cardholder → Monarch Household Member Matching
 *
 * Pure matching strategies used to *suggest* which Monarch household member
 * corresponds to an institution-reported cardholder name.
 *
 * These functions never persist anything and never guess between ambiguous
 * candidates — they produce a suggestion that the user confirms in the
 * cardholder selector prompt. This keeps the automatic behaviour safe while
 * still making the common case (name matches exactly) a single click.
 *
 * @module services/common/cardholderMatching
 */

import { normalizePersonName } from '../../core/utils';
import type { HouseholdMember } from '../../api/monarchHousehold';

// ── Types ───────────────────────────────────────────────────

/**
 * How a cardholder was matched to a household member.
 *
 * Ordered from most to least confident. `manual` means the user explicitly
 * chose the mapping (including choosing "Shared"), and `unresolved` means no
 * candidate was found.
 */
export type CardholderMatchType =
  | 'exact-name'
  | 'exact-display'
  | 'initial'
  | 'first-name'
  | 'manual'
  | 'unresolved';

/** A suggested cardholder → member match */
export interface CardholderMatch {
  member: HouseholdMember;
  matchType: CardholderMatchType;
}

// ── Helpers ─────────────────────────────────────────────────

/**
 * Split a normalized name into its whitespace-separated parts.
 */
function nameParts(normalized: string): string[] {
  return normalized.split(' ').filter(Boolean);
}

/**
 * Build "firstname lastinitial" from a normalized full name.
 * Returns null when the name has fewer than two parts.
 *
 * "mykhailo delegan" → "mykhailo d"
 */
function firstNameWithLastInitial(normalized: string): string | null {
  const parts = nameParts(normalized);
  if (parts.length < 2) return null;
  const first = parts[0];
  const last = parts[parts.length - 1];
  return `${first} ${last.charAt(0)}`;
}

/**
 * Get the first name from a normalized full name.
 */
function firstName(normalized: string): string {
  return nameParts(normalized)[0] || '';
}

// ── Matching strategies ─────────────────────────────────────

/**
 * Find the best household member match for a raw cardholder name.
 *
 * Strategies are tried in order of confidence; the first hit wins:
 *  1. `exact-name`    — normalized cardholder name equals member `name`
 *  2. `exact-display` — normalized cardholder name equals member `displayName`
 *  3. `initial`       — first name + last initial matches in either direction
 *                       (e.g. "MYKHAILO D" ↔ "Mykhailo Delegan")
 *  4. `first-name`    — first names match AND exactly one member matches
 *
 * Ambiguous candidates are never resolved: if two members share a first name,
 * strategies 3 and 4 return no match rather than guessing.
 *
 * @param cardholderName - Raw institution cardholder name (e.g. "MYKHAILO DELEGAN")
 * @param members - Monarch household members
 * @returns Best match, or null when nothing matched confidently
 */
export function findBestMemberMatch(
  cardholderName: string | null | undefined,
  members: HouseholdMember[],
): CardholderMatch | null {
  const target = normalizePersonName(cardholderName);
  if (!target || !Array.isArray(members) || members.length === 0) {
    return null;
  }

  // 1. Exact match on full name
  const exactName = members.find((m) => normalizePersonName(m.name) === target);
  if (exactName) {
    return { member: exactName, matchType: 'exact-name' };
  }

  // 2. Exact match on display name
  const exactDisplay = members.find((m) => normalizePersonName(m.displayName) === target);
  if (exactDisplay) {
    return { member: exactDisplay, matchType: 'exact-display' };
  }

  // 3. First name + last initial, comparable in either direction.
  //    Handles both "MYKHAILO D" (cardholder abbreviated) and
  //    "MYKHAILO DELEGAN" vs a member stored as "Mykhailo D".
  const targetInitialForm = firstNameWithLastInitial(target) ?? target;
  const initialMatches = members.filter((m) => {
    const memberNormalized = normalizePersonName(m.name);
    const memberInitialForm = firstNameWithLastInitial(memberNormalized) ?? memberNormalized;
    return memberInitialForm === targetInitialForm;
  });
  if (initialMatches.length === 1) {
    return { member: initialMatches[0], matchType: 'initial' };
  }

  // 4. First-name-only match, but only when unambiguous
  const targetFirst = firstName(target);
  if (targetFirst) {
    const firstNameMatches = members.filter((m) => {
      const memberFirst = firstName(normalizePersonName(m.name));
      const displayFirst = firstName(normalizePersonName(m.displayName));
      return memberFirst === targetFirst || displayFirst === targetFirst;
    });
    if (firstNameMatches.length === 1) {
      return { member: firstNameMatches[0], matchType: 'first-name' };
    }
  }

  return null;
}

/**
 * Human-readable label for a match type, used in the selector prompt and
 * in the settings widget badge.
 */
export function describeMatchType(matchType: CardholderMatchType): string {
  switch (matchType) {
  case 'exact-name':
    return 'Exact name match';
  case 'exact-display':
    return 'Matched display name';
  case 'initial':
    return 'Matched first name + last initial';
  case 'first-name':
    return 'Matched first name';
  case 'manual':
    return 'Set manually';
  case 'unresolved':
  default:
    return 'Not mapped';
  }
}

export default {
  findBestMemberMatch,
  describeMatchType,
};