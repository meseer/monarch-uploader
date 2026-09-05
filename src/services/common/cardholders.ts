/**
 * Cardholder Service
 *
 * Generic, integration-agnostic logic for mapping institution cardholders to
 * Monarch transaction owners and/or cardholder tags.
 *
 * Two independent features are driven from a single discovered-cardholder map:
 *
 * - **Owner mapping** (`cardholderOwnerMode`: 'off' | 'on') — sets the Monarch
 *   transaction Owner. Monarch's CSV importer has **no owner column**, so this
 *   is applied by a post-upload GraphQL pass (`services/common/ownerSync`);
 *   this service resolves the mapping and marks the affected rows via
 *   `cardholderOwnerUserId`. The `Owner` CSV column is still emitted, but only
 *   as human-readable context in the generated file.
 *
 *   Cardholders that are unmapped or explicitly Shared are left **untouched** —
 *   no owner is assigned and no marker tag is emitted — so Monarch's
 *   account-level owner governs those transactions.
 * - **Cardholder tag** (`cardholderTagMode`: 'off' | 'auto' | 'always') — adds
 *   the cardholder's label to the Monarch `Tags` column. `auto` only tags once
 *   two or more distinct cardholders have ever been discovered for the account.
 *
 * ## Auto-mode tracking
 *
 * The discovered-cardholder map is **cumulative and persisted** on the
 * consolidated account entry — it is never derived from the current sync window
 * alone. Each sync: discover from all fetched transactions → merge & persist →
 * decide from the merged map. This means:
 * - a second cardholder is found even if all their transactions were uploaded
 *   on a previous sync (discovery reads all fetched transactions, not just new
 *   ones);
 * - the first sync that sees cardholder #2 already tags, with no one-sync lag;
 * - a sync window that happens to contain a single cardholder does not cause
 *   tagging to flip off again.
 *
 * ## Important invariants
 *
 * - The cardholder name is **never** added to pending-transaction ID hashing.
 *   Integrations already hash a card identifier (Rogers `cardNumber`, MBNA
 *   `endingIn`); adding the name would invalidate every stored dedup hash and
 *   cause mass duplicate uploads.
 * - Previously uploaded transactions are never re-tagged or re-owned.
 *
 * @module services/common/cardholders
 */

import { debugLog, toTitleCase } from '../../core/utils';
import { CARDHOLDER } from '../../core/config';
import { ACCOUNT_SETTINGS, getSettingDefault, hasCapability } from '../../core/integrationCapabilities';
import accountService from './accountService';
import { getHouseholdMembers, type HouseholdMember } from '../../api/monarchHousehold';
import { findBestMemberMatch, type CardholderMatchType } from './cardholderMatching';
import { resolveNotesTransactionId } from '../../core/markerTags';
import type { CardholderInfo, ExtractCardholderHook } from '../../integrations/types';

// ── Types ───────────────────────────────────────────────────

/** A persisted cardholder → Monarch member mapping entry */
export interface CardholderEntry {
  /** Human-friendly label (title-cased); drives the cardholder TAG value */
  label: string;
  /** Last 4 digits of the card, for display/disambiguation */
  cardLast4: string | null;
  /** ISO date (YYYY-MM-DD) this cardholder was first discovered */
  firstSeen: string;
  /** Stable Monarch user id; null when Shared or unresolved */
  monarchUserId: string | null;
  /**
   * Cached Monarch `users[].name`, used as the display label for the mapping.
   * Refreshed each sync from the live household list (keyed on monarchUserId)
   * so a member rename never leaves a stale name behind.
   */
  monarchUserName: string | null;
  /**
   * True when the user explicitly chose "Shared". Distinguishes a deliberate
   * Shared choice (don't prompt again) from "never asked" (do prompt).
   */
  isShared: boolean;
  /** How this mapping was established */
  matchType: CardholderMatchType;
}

/** Map of raw cardholder name → mapping entry */
export type CardholderMap = Record<string, CardholderEntry>;

/** Result of a user's choice in the cardholder selector prompt */
export interface CardholderSelection {
  /** Chosen member, or null when the user chose "Shared" */
  member: HouseholdMember | null;
}

/**
 * Prompt callback injected by the caller (UI layer).
 * Resolves with the user's selection, or null if cancelled.
 */
export type PromptForMemberFn = (params: {
  cardholderName: string;
  cardLast4: string | null;
  members: HouseholdMember[];
  /** Pre-selected suggestion, or null when nothing matched */
  suggestedMemberId: string | null;
  suggestedMatchType: CardholderMatchType | null;
}) => Promise<CardholderSelection | null>;

/** Resolution applied to transactions for a single sync */
export interface CardholderResolution {
  /** The merged, persisted cardholder map */
  cardholders: CardholderMap;
  /** Whether cardholder tags should be emitted this sync */
  shouldTag: boolean;
  /** Whether owner mapping is active this sync */
  shouldMapOwner: boolean;
}

// ── Discovery ───────────────────────────────────────────────

/**
 * Run an integration extractor without letting a malformed transaction abort
 * the whole sync. Returns null on any failure.
 */
function safeExtract(
  extract: ExtractCardholderHook,
  tx: Record<string, unknown>,
): CardholderInfo | null {
  try {
    return extract(tx);
  } catch (error) {
    debugLog('[cardholders] Extractor threw for a transaction, skipping:', error);
    return null;
  }
}

/**
 * Discover cardholders present in a set of raw transactions.
 *
 * @param transactions - Raw institution transactions
 * @param extract - Integration-specific cardholder extractor
 * @returns Map of raw cardholder name → { name, cardLast4 }
 */
export function collectCardholders(
  transactions: unknown[],
  extract: ExtractCardholderHook,
): Record<string, CardholderInfo> {
  const discovered: Record<string, CardholderInfo> = {};

  if (!Array.isArray(transactions) || typeof extract !== 'function') {
    return discovered;
  }

  transactions.forEach((tx) => {
    const info = safeExtract(extract, tx as Record<string, unknown>);

    if (!info || !info.name || typeof info.name !== 'string') {
      return;
    }

    const key = info.name.trim();
    if (!key) return;

    // First occurrence wins; later ones may lack cardLast4
    if (!discovered[key]) {
      discovered[key] = { name: key, cardLast4: info.cardLast4 ?? null };
    } else if (!discovered[key].cardLast4 && info.cardLast4) {
      discovered[key].cardLast4 = info.cardLast4;
    }
  });

  return discovered;
}

/**
 * Additively merge newly discovered cardholders into the persisted map.
 *
 * Existing entries are preserved — a user-edited `label` or a `manual` mapping
 * is never overwritten. Only a missing `cardLast4` is backfilled.
 *
 * @param existing - Persisted cardholder map
 * @param discovered - Cardholders found in this sync
 * @param today - Today's date (YYYY-MM-DD) used for `firstSeen`
 * @returns New map and the list of newly added cardholder names
 */
export function mergeCardholders(
  existing: CardholderMap,
  discovered: Record<string, CardholderInfo>,
  today: string,
): { cardholders: CardholderMap; newlyDiscovered: string[] } {
  const merged: CardholderMap = { ...(existing || {}) };
  const newlyDiscovered: string[] = [];

  Object.values(discovered).forEach((info) => {
    const current = merged[info.name];

    if (!current) {
      merged[info.name] = {
        label: toTitleCase(info.name),
        cardLast4: info.cardLast4 ?? null,
        firstSeen: today,
        monarchUserId: null,
        monarchUserName: null,
        isShared: false,
        matchType: 'unresolved',
      };
      newlyDiscovered.push(info.name);
      return;
    }

    // Backfill card last4 only; never touch user-editable fields
    if (!current.cardLast4 && info.cardLast4) {
      merged[info.name] = { ...current, cardLast4: info.cardLast4 };
    }
  });

  return { cardholders: merged, newlyDiscovered };
}

// ── Mode decisions ──────────────────────────────────────────

/**
 * Read the effective owner mode for an account, falling back to the
 * integration's declared default.
 */
export function getOwnerMode(integrationId: string, accountId: string): string {
  const accountData = accountService.getAccountData(integrationId, accountId);
  const stored = accountData?.[ACCOUNT_SETTINGS.CARDHOLDER_OWNER_MODE] as string | undefined;
  if (stored) return stored;
  return (getSettingDefault(integrationId, ACCOUNT_SETTINGS.CARDHOLDER_OWNER_MODE) as string)
    ?? CARDHOLDER.OWNER_MODE.OFF;
}

/**
 * Read the effective tag mode for an account, falling back to the
 * integration's declared default.
 */
export function getTagMode(integrationId: string, accountId: string): string {
  const accountData = accountService.getAccountData(integrationId, accountId);
  const stored = accountData?.[ACCOUNT_SETTINGS.CARDHOLDER_TAG_MODE] as string | undefined;
  if (stored) return stored;
  return (getSettingDefault(integrationId, ACCOUNT_SETTINGS.CARDHOLDER_TAG_MODE) as string)
    ?? CARDHOLDER.TAG_MODE.OFF;
}

/**
 * Decide whether cardholder tags should be emitted.
 *
 * `always` → always. `auto` → only once 2+ distinct cardholders have ever been
 * discovered (using the cumulative persisted map). `off` → never.
 */
export function shouldTagCardholders(tagMode: string, cardholders: CardholderMap): boolean {
  if (tagMode === CARDHOLDER.TAG_MODE.ALWAYS) return true;
  if (tagMode === CARDHOLDER.TAG_MODE.AUTO) {
    return Object.keys(cardholders || {}).length >= 2;
  }
  return false;
}

// ── Resolution ──────────────────────────────────────────────

/**
 * Refresh cached Monarch member names from the live household list.
 *
 * `monarchUserId` is the stable key; `monarchUserName` is only a cache. If a
 * household member renames themselves in Monarch, a stale cached name would
 * no longer match and Monarch would silently revert the Owner value — so we
 * re-read it on every sync.
 *
 * @returns Updated map and whether anything changed
 */
export function refreshMemberNames(
  cardholders: CardholderMap,
  members: HouseholdMember[],
): { cardholders: CardholderMap; changed: boolean } {
  const byId = new Map(members.map((m) => [m.id, m]));
  const updated: CardholderMap = { ...cardholders };
  let changed = false;

  Object.entries(updated).forEach(([key, entry]) => {
    if (!entry.monarchUserId) return;

    const member = byId.get(entry.monarchUserId);
    if (!member) {
      // Member no longer exists in the household — revert to unresolved so we
      // never try to assign an owner Monarch would reject. The transaction is
      // then left untouched and the account-level owner governs it.
      debugLog(`[cardholders] Mapped member ${entry.monarchUserId} for "${key}" no longer in household, reverting to unresolved`);
      updated[key] = {
        ...entry, monarchUserId: null, monarchUserName: null, isShared: false, matchType: 'unresolved',
      };
      changed = true;
      return;
    }

    if (entry.monarchUserName !== member.name) {
      debugLog(`[cardholders] Refreshing cached member name for "${key}": "${entry.monarchUserName}" → "${member.name}"`);
      updated[key] = { ...entry, monarchUserName: member.name };
      changed = true;
    }
  });

  return { cardholders: updated, changed };
}

/**
 * Determine which cardholders still need a user mapping decision.
 *
 * A cardholder needs prompting when it has neither a resolved member nor an
 * explicit "Shared" choice.
 */
export function getUnmappedCardholders(cardholders: CardholderMap): string[] {
  return Object.entries(cardholders || {})
    .filter(([, entry]) => !entry.monarchUserId && !entry.isShared)
    .map(([key]) => key);
}

/**
 * Prompt the user to map each unmapped cardholder to a household member.
 *
 * Prompts sequentially (one modal at a time), pre-selecting the best automatic
 * match so the common case is a single confirmation. Cancelling a prompt leaves
 * the cardholder unmapped and unpersisted, so the user is asked again next sync
 * rather than being silently locked into a wrong mapping.
 *
 * @returns Updated map (only persisted-worthy changes applied)
 */
export async function promptForUnmappedCardholders(
  cardholders: CardholderMap,
  members: HouseholdMember[],
  promptForMember: PromptForMemberFn,
): Promise<{ cardholders: CardholderMap; changed: boolean }> {
  const unmapped = getUnmappedCardholders(cardholders);
  if (unmapped.length === 0) {
    return { cardholders, changed: false };
  }

  const updated: CardholderMap = { ...cardholders };
  let changed = false;

  for (const cardholderName of unmapped) {
    const entry = updated[cardholderName];
    const suggestion = findBestMemberMatch(cardholderName, members);

    // A prompt failure must not abort the sync — skip this cardholder and
    // leave it unmapped so it is asked about again next time.
    const selection = await promptForMember({
      cardholderName,
      cardLast4: entry.cardLast4,
      members,
      suggestedMemberId: suggestion?.member.id ?? null,
      suggestedMatchType: suggestion?.matchType ?? null,
    }).catch((error) => {
      debugLog(`[cardholders] Prompt failed for "${cardholderName}":`, error);
      return null;
    });

    if (!selection) {
      // Cancelled — leave unmapped and do NOT persist, so the user is asked
      // again next time rather than being silently locked into a wrong mapping.
      // No owner is assigned for this cardholder in the meantime.
      debugLog(`[cardholders] Mapping prompt cancelled for "${cardholderName}", leaving unmapped`);
      continue;
    }

    if (selection.member) {
      updated[cardholderName] = {
        ...entry,
        monarchUserId: selection.member.id,
        monarchUserName: selection.member.name,
        isShared: false,
        matchType: 'manual',
      };
    } else {
      updated[cardholderName] = {
        ...entry,
        monarchUserId: null,
        monarchUserName: null,
        isShared: true,
        matchType: 'manual',
      };
    }
    changed = true;
  }

  return { cardholders: updated, changed };
}

/**
 * Resolve the display value for the informational `Owner` CSV column.
 *
 * Returns the mapped member's name, or an **empty string** when the cardholder
 * is unmapped, explicitly Shared, or absent.
 *
 * Empty rather than `"Shared"` on purpose. Three distinct states collapse here:
 *
 * | State | Owner column | What happens in Monarch |
 * |-------|--------------|-------------------------|
 * | Mapped to a member | member name | owner assigned post-upload |
 * | Explicitly Shared | empty | left alone → account default applies |
 * | Never mapped | empty | left alone → account default applies |
 *
 * Only the first case is ever assigned. For the other two we deliberately do
 * nothing, so Monarch's account-level owner (which the user can now choose at
 * account-creation time) governs. Printing `"Shared"` implied we were setting
 * something, which was misleading — nothing is sent for these rows at all.
 */
export function resolveOwner(
  tx: Record<string, unknown>,
  cardholders: CardholderMap,
  extract: ExtractCardholderHook,
): string {
  const info = safeExtract(extract, tx);

  if (!info?.name) {
    return '';
  }

  const entry = cardholders[info.name.trim()];
  return entry?.monarchUserName || '';
}

/**
 * Resolve the Monarch user id a transaction's cardholder maps to.
 *
 * Returns null when the cardholder is absent, unmapped, or explicitly Shared —
 * in all of those cases there is no owner to set, so nothing needs to be queued
 * for the post-upload owner pass.
 */
export function resolveOwnerUserId(
  tx: Record<string, unknown>,
  cardholders: CardholderMap,
  extract: ExtractCardholderHook,
): string | null {
  const info = safeExtract(extract, tx);

  if (!info?.name) return null;

  const entry = cardholders[info.name.trim()];
  return entry?.monarchUserId || null;
}

/**
 * Resolve the cardholder tag value for a single transaction.
 * Returns an empty string when there is no cardholder to tag.
 */
export function resolveTag(
  tx: Record<string, unknown>,
  cardholders: CardholderMap,
  extract: ExtractCardholderHook,
): string {
  const info = safeExtract(extract, tx);

  if (!info?.name) return '';

  const key = info.name.trim();
  const entry = cardholders[key];
  return entry?.label || toTitleCase(key);
}

/**
 * Annotate transactions with the cardholder fields the CSV stage consumes.
 *
 * Three fields may be added:
 * - `cardholderTag` — the label for the Tags column
 * - `cardholderOwner` — the household member name, informational only (Monarch's
 *   CSV importer has no owner column)
 * - `cardholderOwnerUserId` — the Monarch user id to assign after upload
 *
 * `cardholderOwnerUserId` is the single source of truth for the owner feature
 * downstream: the CSV layer derives the `pendingOwnerUpdate` marker from its
 * presence, and the post-upload pass reads it to know what to assign.
 *
 * It is set **only** when the cardholder resolves to an actual household member.
 * Rows resolving to Shared or left unmapped have no owner to apply, so marking
 * them would queue work that could never complete and would leave the marker
 * tag (and the id in the notes) stuck on them forever.
 *
 * Mutation-free: returns new transaction objects.
 */
export function applyCardholderFields<T extends Record<string, unknown>>(
  transactions: T[],
  {
    cardholders, extract, shouldTag, shouldMapOwner,
  }: {
    cardholders: CardholderMap;
    extract: ExtractCardholderHook;
    shouldTag: boolean;
    shouldMapOwner: boolean;
  },
): T[] {
  if (!Array.isArray(transactions) || (!shouldTag && !shouldMapOwner)) {
    return transactions;
  }

  return transactions.map((tx) => {
    const annotated: Record<string, unknown> = { ...tx };
    if (shouldMapOwner) {
      annotated.cardholderOwner = resolveOwner(tx, cardholders, extract);
      annotated.cardholderOwnerUserId = resolveOwnerUserId(tx, cardholders, extract);
    }
    if (shouldTag) {
      annotated.cardholderTag = resolveTag(tx, cardholders, extract);
    }
    return annotated as T;
  });
}

/**
 * Build the `{prefix}:{hash}` id → Monarch user id map the post-upload owner
 * pass needs.
 *
 * Keyed on exactly the id the CSV wrote into the notes (via
 * `resolveNotesTransactionId`), so a row found in Monarch resolves back to the
 * same owner decision that was made here. Rows without an owner or without an
 * id contribute nothing.
 *
 * @param transactions - Transactions as handed to the CSV converter
 * @returns Map of notes id → Monarch user id
 */
export function collectOwnerAssignments(
  transactions: Array<Record<string, unknown>>,
): Map<string, string> {
  const assignments = new Map<string, string>();

  if (!Array.isArray(transactions)) return assignments;

  transactions.forEach((tx) => {
    const ownerUserId = tx.cardholderOwnerUserId as string | null | undefined;
    if (!ownerUserId) return;

    const notesId = resolveNotesTransactionId({
      isPending: tx.isPending === true,
      pendingId: tx.pendingId as string | null | undefined,
      txHashId: tx.txHashId as string | null | undefined,
      ownerSyncPending: true,
    });

    if (notesId) {
      assignments.set(notesId, ownerUserId);
    }
  });

  return assignments;
}

// ── Orchestration ───────────────────────────────────────────

/**
 * Run the full cardholder workflow for one account's sync.
 *
 * 1. Discover cardholders from **all** fetched transactions
 * 2. Merge additively into the persisted map and save
 * 3. Fetch household members (only when owner mapping is on and needed)
 * 4. Refresh cached member names, then prompt for any unmapped cardholders
 * 5. Return the mode decisions for the CSV stage
 *
 * A household fetch failure is non-fatal: no owner updates are queued for this
 * sync (so the account-level owner governs) and the sync continues.
 *
 * @returns Resolution containing the merged map and mode decisions
 */
export async function syncCardholders({
  integrationId,
  accountId,
  transactions,
  extract,
  today,
  promptForMember,
}: {
  integrationId: string;
  accountId: string;
  transactions: unknown[];
  extract: ExtractCardholderHook;
  today: string;
  promptForMember?: PromptForMemberFn;
}): Promise<CardholderResolution> {
  const inactive: CardholderResolution = { cardholders: {}, shouldTag: false, shouldMapOwner: false };

  if (!hasCapability(integrationId, 'hasCardholders') || typeof extract !== 'function') {
    return inactive;
  }

  const ownerMode = getOwnerMode(integrationId, accountId);
  const tagMode = getTagMode(integrationId, accountId);

  // Nothing to do at all — skip discovery entirely to avoid pointless writes.
  if (ownerMode === CARDHOLDER.OWNER_MODE.OFF && tagMode === CARDHOLDER.TAG_MODE.OFF) {
    debugLog(`[cardholders] Owner and tag modes both off for ${integrationId}/${accountId}, skipping`);
    return inactive;
  }

  // 1 & 2. Discover and merge
  const accountData = accountService.getAccountData(integrationId, accountId);
  const existing = (accountData?.cardholders as CardholderMap) || {};
  const discovered = collectCardholders(transactions, extract);
  const mergeResult = mergeCardholders(existing, discovered, today);
  const { newlyDiscovered } = mergeResult;
  let { cardholders } = mergeResult;

  debugLog(`[cardholders] ${Object.keys(discovered).length} discovered this sync, `
    + `${Object.keys(cardholders).length} total known, ${newlyDiscovered.length} new`);

  // 3 & 4. Owner resolution (household fetch + name refresh + prompts)
  if (ownerMode === CARDHOLDER.OWNER_MODE.ON) {
    try {
      const { members } = await getHouseholdMembers();

      const refreshed = refreshMemberNames(cardholders, members);
      cardholders = refreshed.cardholders;

      if (promptForMember) {
        const prompted = await promptForUnmappedCardholders(cardholders, members, promptForMember);
        cardholders = prompted.cardholders;
      }
    } catch (error) {
      debugLog('[cardholders] Failed to fetch Monarch household members, '
        + 'skipping owner assignment for this sync:', error);
    }
  }

  // Persist the merged/resolved map
  accountService.updateAccountInList(integrationId, accountId, { cardholders });

  const shouldTag = shouldTagCardholders(tagMode, cardholders);
  const shouldMapOwner = ownerMode === CARDHOLDER.OWNER_MODE.ON;

  debugLog(`[cardholders] Resolution for ${integrationId}/${accountId}: `
    + `ownerMode=${ownerMode}, tagMode=${tagMode}, shouldTag=${shouldTag}, shouldMapOwner=${shouldMapOwner}`);

  return { cardholders, shouldTag, shouldMapOwner };
}

export default {
  collectCardholders,
  mergeCardholders,
  getOwnerMode,
  getTagMode,
  shouldTagCardholders,
  refreshMemberNames,
  getUnmappedCardholders,
  promptForUnmappedCardholders,
  resolveOwner,
  resolveOwnerUserId,
  resolveTag,
  applyCardholderFields,
  collectOwnerAssignments,
  syncCardholders,
};
