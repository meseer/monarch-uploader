/**
 * Marker Tag Utilities
 *
 * Monarch tags used as internal processing markers (`Pending`,
 * `pendingOwnerUpdate`) queue follow-up work that cannot be completed during a
 * CSV upload. This module owns the single rule that keeps those follow-up passes
 * safe:
 *
 * > Keep the `{prefix}:{hash}` transaction id in the notes while **any** marker
 * > tag is still present. Strip it only when the last marker is removed.
 *
 * Two properties follow, and both were failure modes in earlier designs:
 *
 * - **Crash-safe.** A transaction whose follow-up was interrupted keeps both its
 *   marker and its id, so a later sync can still find it and finish the work.
 * - **Order-independent.** Pending reconciliation and owner sync can run in any
 *   order, in any sync, without either knowing about the other — each only asks
 *   "are any markers left?" before deciding whether to strip the id.
 *
 * Both consumers import the rule from here rather than reimplementing it, so
 * they cannot drift apart.
 *
 * @module core/markerTags
 */

import { ALL_MARKER_TAGS } from './config';

/** A tag as either a bare name or a Monarch tag object */
export type MarkerTagLike = string | { name?: string | null } | null | undefined;

/** Inputs for deciding whether to write a transaction id into the notes */
export interface NotesIdInputs {
  /** Whether the transaction is pending */
  isPending?: boolean;
  /** Pending hash id, already prefixed (e.g. `rb-tx:abc…`) */
  pendingId?: string | null;
  /** Stable hash id for a settled transaction, already prefixed */
  txHashId?: string | null;
  /** Whether this row carries the owner-sync marker tag */
  ownerSyncPending?: boolean;
}

/** Normalize a tag name for comparison (Monarch tag names are case-insensitive) */
function normalizeTagName(name: string | null | undefined): string {
  return (name || '').trim().toLowerCase();
}

/** Read the name from either a bare string or a Monarch tag object */
function readTagName(tag: MarkerTagLike): string {
  if (typeof tag === 'string') return tag;
  return tag?.name || '';
}

/**
 * Whether a tag is one of the internal processing markers.
 *
 * Deliberately internal: callers should ask the higher-level question
 * (`shouldRetainTxIdInNotes`) rather than classify tags themselves, so the
 * retention rule stays the single decision point.
 *
 * @param tag - Tag name or Monarch tag object
 * @returns True when the tag is a marker tag
 */
function isMarkerTag(tag: MarkerTagLike): boolean {
  const name = normalizeTagName(readTagName(tag));
  if (!name) return false;
  return ALL_MARKER_TAGS.some((marker) => normalizeTagName(marker) === name);
}

/**
 * Whether the `{prefix}:{hash}` transaction id must stay in the notes.
 *
 * Call this with the tags the transaction will carry **after** the current step
 * removes its own marker. Returns true while any other marker remains, meaning
 * another pass still needs the id to find this transaction.
 *
 * @param remainingTags - Tags left on the transaction after this step
 * @returns True when the id must be retained
 */
export function shouldRetainTxIdInNotes(remainingTags: MarkerTagLike[] | null | undefined): boolean {
  return (remainingTags || []).some((tag) => isMarkerTag(tag));
}

/**
 * Select the tag objects matching a set of tag IDs.
 *
 * Tag computation (`computeSettledTagIds`) works in IDs while the retention rule
 * works in names, so callers need to map one to the other before asking whether
 * to retain the id.
 *
 * @param allTags - Every tag currently on the Monarch transaction
 * @param tagIds - IDs to keep
 * @returns The matching tag objects, in their original order
 */
export function selectTagsByIds<T extends { id?: string }>(
  allTags: T[] | null | undefined,
  tagIds: string[] | null | undefined,
): T[] {
  const keep = new Set(tagIds || []);
  return (allTags || []).filter((tag) => Boolean(tag?.id) && keep.has(tag.id as string));
}

/**
 * Resolve the `{prefix}:{hash}` transaction id to write into the notes, if any.
 *
 * The mirror image of `shouldRetainTxIdInNotes`: that decides when to *keep* an
 * existing id, this decides when to *write* one in the first place. Both live
 * here so the two halves of the invariant cannot drift.
 *
 * Pending rows always carry their id — reconciliation needs it. Settled rows
 * normally carry nothing, but they DO need an id when they arrive already
 * carrying the owner-sync marker: without it, a transaction that settled before
 * its first upload could never be matched back to its cardholder.
 *
 * Gating the settled case on `ownerSyncPending` keeps notes byte-identical for
 * every user who has not enabled owner mapping.
 *
 * @returns The id to append to the notes, or an empty string
 */
export function resolveNotesTransactionId({
  isPending = false,
  pendingId = null,
  txHashId = null,
  ownerSyncPending = false,
}: NotesIdInputs = {}): string {
  if (isPending) {
    return pendingId || txHashId || '';
  }

  if (ownerSyncPending) {
    return txHashId || pendingId || '';
  }

  return '';
}

