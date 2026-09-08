/**
 * Marker Tag Queue
 *
 * Monarch marker tags (`Pending`, `pendingOwnerUpdate`) are not just labels —
 * they are **work queues**. A CSV upload cannot set every field Monarch supports,
 * so rows needing follow-up are tagged at import time and picked up by a
 * post-upload pass that finds them by that tag.
 *
 * This module owns the shared mechanics of reading such a queue, so every
 * follow-up pass inherits the same two hard-won behaviours:
 *
 * - **Tag propagation tolerance.** The first pass after an import runs seconds
 *   after the tag was created, and Monarch's tag list is not guaranteed to show
 *   it immediately. A short bounded retry turns "silently deferred a whole sync"
 *   into "resolved now".
 * - **A forward-looking window.** Users can edit dates, so the scan looks a year
 *   ahead. Without that, a future-dated row would keep its marker forever and
 *   never be processed.
 *
 * Failing to resolve the tag is always safe: the rows keep their marker in
 * Monarch, so the next sync finds them. That is what lets every consumer treat
 * the queue as crash-safe and self-healing — see `core/markerTags` for the notes
 * retention invariant that makes the ids survive alongside the tags.
 *
 * @module services/common/markerTagQueue
 */

import { debugLog, formatDate } from '../../core/utils';
import monarchApi from '../../api/monarch';

/** A Monarch tag as returned by the tag lookup */
export interface MarkerTag {
  id: string;
  name: string;
}

/**
 * A Monarch transaction as returned by `getTransactionsList`.
 *
 * Deliberately loose: each consumer cares about different fields (owner sync
 * reads ownership, pending status reads `pending`), and narrowing here would
 * force every consumer to re-cast.
 */
export interface MarkerQueueRow {
  id?: string;
  notes?: string;
  pending?: boolean;
  tags?: Array<{ id: string; name?: string }>;
  ownedByUser?: { id?: string } | null;
  ownershipOverriddenAt?: string | null;
  [key: string]: unknown;
}

/** Result of reading a marker tag queue */
export interface MarkerQueue {
  /** The marker tag, or null when it could not be resolved this sync */
  markerTag: MarkerTag | null;
  /** Transactions currently carrying the marker (empty when tag is null) */
  rows: MarkerQueueRow[];
}

/** Parameters for `fetchMarkerQueue` */
export interface FetchMarkerQueueParams {
  /** Monarch account to scan */
  monarchAccountId: string;
  /** Name of the marker tag acting as the queue */
  tagName: string;
  /** How many days back to scan; should cover the retention window */
  lookbackDays: number;
  /** Injected delay, for tests. Defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Attempts made to resolve a marker tag before giving up for this sync.
 *
 * Kept deliberately short: failing is safe (the rows keep their marker and are
 * retried next sync), so blocking the sync any longer buys nothing.
 */
export const MARKER_TAG_LOOKUP_ATTEMPTS = 3;

/** Delay between marker tag lookup attempts (ms) */
export const MARKER_TAG_LOOKUP_DELAY_MS = 1000;

/** How far ahead to scan, in years, to catch user-edited future dates */
const LOOKAHEAD_YEARS = 1;

/** Default sleep used between marker tag lookup attempts */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Resolve a marker tag by name, retrying briefly while it may be propagating.
 *
 * @param tagName - Marker tag name to resolve
 * @param sleep - Delay function between attempts
 * @returns The tag, or null if it could not be resolved this sync
 */
export async function resolveMarkerTag(
  tagName: string,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<MarkerTag | null> {
  for (let attempt = 1; attempt <= MARKER_TAG_LOOKUP_ATTEMPTS; attempt += 1) {
    const tag = await monarchApi.getTagByName(tagName);
    if (tag) return tag as MarkerTag;

    if (attempt < MARKER_TAG_LOOKUP_ATTEMPTS) {
      debugLog(`[markerQueue] "${tagName}" tag not visible yet `
        + `(attempt ${attempt}/${MARKER_TAG_LOOKUP_ATTEMPTS}), retrying...`);
      await sleep(MARKER_TAG_LOOKUP_DELAY_MS);
    }
  }

  return null;
}

/**
 * Read the transactions currently queued under a marker tag.
 *
 * @param params - Queue parameters
 * @returns The marker tag and the rows carrying it (null/empty when there is
 *   nothing to do — including when the tag does not exist yet)
 */
export async function fetchMarkerQueue({
  monarchAccountId,
  tagName,
  lookbackDays,
  sleep = defaultSleep,
}: FetchMarkerQueueParams): Promise<MarkerQueue> {
  const markerTag = await resolveMarkerTag(tagName, sleep);

  if (!markerTag) {
    // Either the tag genuinely does not exist (nothing has ever been marked) or
    // it has not propagated. Either way the rows keep their marker in Monarch,
    // so the next sync finds them.
    debugLog(`[markerQueue] No "${tagName}" tag in Monarch yet — deferring to the next sync`);
    return { markerTag: null, rows: [] };
  }

  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - lookbackDays);

  // Look ahead: users can edit dates, and future-dated rows must not be orphaned
  // with a stuck marker tag.
  const endDate = new Date(today);
  endDate.setFullYear(endDate.getFullYear() + LOOKAHEAD_YEARS);

  const listResult = await monarchApi.getTransactionsList({
    accountIds: [monarchAccountId],
    tags: [markerTag.id],
    startDate: formatDate(startDate),
    endDate: formatDate(endDate),
  });

  return { markerTag, rows: (listResult.results || []) as unknown as MarkerQueueRow[] };
}

export default {
  resolveMarkerTag,
  fetchMarkerQueue,
};