/**
 * Post-Upload Owner Sync Service
 *
 * Applies cardholder → Monarch **Owner** mappings to transactions after they
 * have been uploaded.
 *
 * ## Why this exists
 *
 * Monarch's CSV importer has no owner column. Sending one fails the whole
 * upload:
 *
 *   "Invalid column mapping: 'owned_by_user' is not a valid column.
 *    Valid columns: ['account', 'amount', 'category',
 *    'data_provider_description', 'date', 'id', 'merchant_name', 'notes',
 *    'tags']"
 *
 * So the owner is set with one `updateTransaction` mutation per row, after the
 * import completes.
 *
 * ## Correlation
 *
 * The upload response returns only `uploadedStatement { id, transactionCount }`
 * — no per-transaction ids — and `getTransactionsList` has no statement-id
 * filter. Two handles are therefore written into each affected row at CSV time:
 *
 * 1. the `pendingOwnerUpdate` **marker tag**, which makes the rows findable, and
 * 2. the `{prefix}:{hash}` **transaction id in the notes**, which identifies
 *    *which* source transaction (and therefore which cardholder) each row is.
 *
 * ## Safety properties
 *
 * - **Idempotent.** Rows whose ownership was explicitly set are skipped, so
 *   re-running never disturbs a value the user chose by hand. Crucially that
 *   includes a deliberate **Shared** choice, which reports `ownedByUser: null`
 *   and is only distinguishable via `ownershipOverriddenAt`.
 * - **Crash-safe / self-healing.** The marker tag *is* the queue. Anything not
 *   finished — because the batch cap was hit, the row could not be matched, or
 *   the sync died mid-pass — keeps its tag and its id and is picked up next
 *   sync. See `core/markerTags` for the retention invariant that
 *   makes this work.
 * - **Non-fatal.** Every failure is logged and skipped; owner sync never aborts
 *   a sync.
 *
 * @module services/common/ownerSync
 */

import { debugLog, formatDate } from '../../core/utils';
import { MARKER_TAGS, OWNER_SYNC_MAX_UPDATES_PER_SYNC } from '../../core/config';
import monarchApi from '../../api/monarch';
import { computeSettledTagIds } from './pendingReconciliation';
import { shouldRetainTxIdInNotes, selectTagsByIds } from '../../core/markerTags';

// ── Types ───────────────────────────────────────────────────

/** Outcome of an owner sync pass */
export interface OwnerSyncResult {
  success: boolean;
  /** Rows whose owner was set */
  updated: number;
  /**
   * Rows skipped because ownership was already explicitly set — either owned by
   * a specific member, or deliberately Shared. Never overwritten.
   */
  alreadyOwned: number;
  /** Rows whose source cardholder could not be resolved — retried next sync */
  unmatched: number;
  /** Rows that errored individually */
  failed: number;
  /** Rows left for the next sync because the per-sync cap was reached */
  deferred: number;
  error: string | null;
  /** The `pendingOwnerUpdate` tag was absent, so nothing could be queued */
  noMarkerTag?: boolean;
  /** No transaction carried the marker tag */
  noPendingOwners?: boolean;
}

/** Resolves a source-transaction hash id to the Monarch user that owns it */
export type ResolveOwnerForTxIdFn = (txHashId: string) => string | null;

/** Parameters for `syncTransactionOwners` */
export interface OwnerSyncParams {
  /** Monarch account to scan */
  monarchAccountId: string;
  /** Integration hash prefix (e.g. `rb-tx`), used to read ids out of notes */
  txIdPrefix: string;
  /** Maps a `{prefix}:{hash}` id to a Monarch user id (null when unknown) */
  resolveOwnerForTxId: ResolveOwnerForTxIdFn;
  /** How many days back to scan; should cover the retention window */
  lookbackDays: number;
  /** Cap on mutations issued this sync (defaults to the configured limit) */
  maxUpdates?: number;
  /** Injected delay, for tests. Defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

/** A Monarch transaction as returned by `getTransactionsList` */
interface MonarchTransactionRow {
  id?: string;
  notes?: string;
  tags?: Array<{ id: string; name?: string }>;
  ownedByUser?: { id?: string } | null;
  /** Set when ownership was chosen explicitly; null when inherited */
  ownershipOverriddenAt?: string | null;
  [key: string]: unknown;
}

/**
 * Whether a row's ownership was explicitly decided and must not be overwritten.
 *
 * Two cases, and the second is easy to miss:
 *
 * 1. `ownedByUser` is set — owned by a specific household member.
 * 2. `ownershipOverriddenAt` is set but `ownedByUser` is null — the user
 *    deliberately chose **Shared**.
 *
 * Case 2 is why checking `ownedByUser` alone is not enough: a deliberate Shared
 * choice is indistinguishable from "never touched" by that field, so relying on
 * it would silently overwrite the user's decision with the cardholder's owner.
 *
 * Treating any explicit override as off-limits also means ownership Monarch set
 * for its own reasons (a rule, say) is respected. That is the safer default:
 * we would rather leave a transaction alone than fight the user or the platform
 * over it.
 */
function hasExplicitOwnership(row: MonarchTransactionRow): boolean {
  return Boolean(row.ownedByUser?.id) || Boolean(row.ownershipOverriddenAt);
}

const EMPTY_RESULT: OwnerSyncResult = {
  success: true,
  updated: 0,
  alreadyOwned: 0,
  unmatched: 0,
  failed: 0,
  deferred: 0,
  error: null,
};

/**
 * Attempts made to resolve the marker tag before giving up for this sync.
 *
 * The very first owner sync runs seconds after the import that *created* the
 * `pendingOwnerUpdate` tag, and the tag list is not guaranteed to reflect it
 * immediately. A short bounded retry converts the common case from "silently
 * deferred a whole sync" into "resolved now". Failing after these attempts is
 * still safe — the rows keep their marker and are picked up next sync — so the
 * retry stays deliberately short rather than blocking the sync.
 */
const MARKER_TAG_LOOKUP_ATTEMPTS = 3;

/** Delay between marker tag lookup attempts (ms) */
const MARKER_TAG_LOOKUP_DELAY_MS = 1000;

/** Default sleep used between marker tag lookup attempts */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Resolve the marker tag, retrying briefly while it may still be propagating.
 *
 * @returns The tag, or null if it could not be resolved this sync
 */
async function resolveMarkerTag(
  sleep: (ms: number) => Promise<void>,
): Promise<{ id: string; name: string } | null> {
  for (let attempt = 1; attempt <= MARKER_TAG_LOOKUP_ATTEMPTS; attempt += 1) {
    const tag = await monarchApi.getTagByName(MARKER_TAGS.PENDING_OWNER_UPDATE);
    if (tag) return tag;

    if (attempt < MARKER_TAG_LOOKUP_ATTEMPTS) {
      debugLog(`[ownerSync] "${MARKER_TAGS.PENDING_OWNER_UPDATE}" tag not visible yet `
        + `(attempt ${attempt}/${MARKER_TAG_LOOKUP_ATTEMPTS}), retrying...`);
      await sleep(MARKER_TAG_LOOKUP_DELAY_MS);
    }
  }

  return null;
}

// ── Helpers ─────────────────────────────────────────────────

/**
 * Extract the `{prefix}:{hash}` id from a notes field.
 *
 * Deliberately independent of `extractPendingIdFromNotes`: that helper is about
 * *pending* ids, whereas by this point the id may sit on an already-settled row.
 * The pattern is the same but the meaning differs, so they are kept apart.
 */
export function extractTxIdFromNotes(txIdPrefix: string, notes: string | null | undefined): string | null {
  if (!notes || typeof notes !== 'string' || !txIdPrefix) return null;

  const escaped = txIdPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = notes.match(new RegExp(`${escaped}:([a-f0-9]{16})`));

  return match ? `${txIdPrefix}:${match[1]}` : null;
}

/**
 * Remove the `{prefix}:{hash}` id from notes, tidying up the leftover blank
 * lines so the user never sees stray whitespace.
 */
export function stripTxIdFromNotes(txIdPrefix: string, notes: string | null | undefined): string {
  if (!notes || typeof notes !== 'string') return '';

  const escaped = txIdPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return notes
    .replace(new RegExp(`${escaped}:[a-f0-9]{16}`, 'g'), '')
    .replace(/\n{2,}/g, '\n')
    .replace(/^\n+|\n+$/g, '')
    .replace(/ +/g, ' ')
    .trim();
}

/**
 * Fetch the transactions currently queued for an owner update.
 *
 * @returns The marker tag and the rows carrying it (both null/empty when
 *   there is nothing to do)
 */
async function fetchOwnerUpdateQueue(
  monarchAccountId: string,
  lookbackDays: number,
  sleep: (ms: number) => Promise<void>,
): Promise<{
  markerTag: { id: string; name: string } | null;
  rows: MonarchTransactionRow[];
}> {
  const markerTag = await resolveMarkerTag(sleep);

  if (!markerTag) {
    // Reached when the tag genuinely does not exist (no row has ever been
    // marked) or when it has not propagated after the retries. Either way the
    // rows keep their marker in Monarch, so the next sync finds them.
    debugLog(`[ownerSync] No "${MARKER_TAGS.PENDING_OWNER_UPDATE}" tag in Monarch yet — deferring to the next sync`);
    return { markerTag: null, rows: [] };
  }

  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - lookbackDays);

  // Look ahead a year: users can edit dates, and future-dated rows must not be
  // orphaned with a stuck marker tag.
  const endDate = new Date(today);
  endDate.setFullYear(endDate.getFullYear() + 1);

  const listResult = await monarchApi.getTransactionsList({
    accountIds: [monarchAccountId],
    tags: [markerTag.id],
    startDate: formatDate(startDate),
    endDate: formatDate(endDate),
  });

  return { markerTag, rows: (listResult.results || []) as unknown as MonarchTransactionRow[] };
}

/**
 * Apply the owner to one row and drop its marker tag.
 *
 * The notes keep the hash id whenever another marker (e.g. `Pending`) still
 * needs it — see `core/markerTags`.
 */
async function applyOwnerToRow({
  row, txIdPrefix, markerTagId, ownerUserId,
}: {
  row: MonarchTransactionRow;
  txIdPrefix: string;
  markerTagId: string;
  ownerUserId: string;
}): Promise<void> {
  const transactionId = row.id as string;
  const notes = row.notes || '';

  const remainingTagIds = computeSettledTagIds(row.tags, markerTagId);
  const retainTxId = shouldRetainTxIdInNotes(selectTagsByIds(row.tags, remainingTagIds));
  const finalNotes = retainTxId ? notes : stripTxIdFromNotes(txIdPrefix, notes);

  await monarchApi.updateTransaction(transactionId, {
    ownerUserId,
    notes: finalNotes,
  });

  // Drop the marker last: if this throws, the row keeps its marker and its id
  // and the next sync simply repeats the (idempotent) update.
  await monarchApi.setTransactionTags(transactionId, remainingTagIds);

  debugLog(`[ownerSync] Set owner ${ownerUserId} on ${transactionId}`, {
    retainedTxIdInNotes: retainTxId,
    remainingTagCount: remainingTagIds.length,
  });
}

// ── Orchestration ───────────────────────────────────────────

/**
 * Apply pending owner updates for one Monarch account.
 *
 * Runs immediately after the transaction upload in the same sync, so a
 * cardholder's transactions are attributed on the sync that uploads them
 * rather than the one after.
 *
 * @returns Counts for the progress dialog; never throws
 */
export async function syncTransactionOwners({
  monarchAccountId,
  txIdPrefix,
  resolveOwnerForTxId,
  lookbackDays,
  maxUpdates = OWNER_SYNC_MAX_UPDATES_PER_SYNC,
  sleep = defaultSleep,
}: OwnerSyncParams): Promise<OwnerSyncResult> {
  const result: OwnerSyncResult = { ...EMPTY_RESULT };

  try {
    const { markerTag, rows } = await fetchOwnerUpdateQueue(monarchAccountId, lookbackDays, sleep);

    if (!markerTag) {
      return { ...result, noMarkerTag: true };
    }

    if (rows.length === 0) {
      debugLog('[ownerSync] No transactions awaiting an owner update');
      return { ...result, noPendingOwners: true };
    }

    debugLog(`[ownerSync] ${rows.length} transaction(s) awaiting an owner update`);

    for (const row of rows) {
      // Cap the burst; the marker tag keeps the remainder queued for next sync.
      if (result.updated >= maxUpdates) {
        result.deferred += 1;
        continue;
      }

      try {
        if (!row.id) {
          result.failed += 1;
          continue;
        }

        // Never overwrite an explicit choice — including a deliberate "Shared",
        // which looks unowned but carries ownershipOverriddenAt. Also what makes
        // the pass idempotent.
        if (hasExplicitOwnership(row)) {
          debugLog(`[ownerSync] ${row.id} ownership already set explicitly `
            + `(owner=${row.ownedByUser?.id ?? 'Shared'}, overriddenAt=${row.ownershipOverriddenAt ?? 'n/a'}), leaving as-is`);
          result.alreadyOwned += 1;
          continue;
        }

        const txHashId = extractTxIdFromNotes(txIdPrefix, row.notes);
        const ownerUserId = txHashId ? resolveOwnerForTxId(txHashId) : null;

        if (!ownerUserId) {
          // Keep the marker so a later sync — with a wider window or a
          // completed mapping — can finish the job.
          debugLog(`[ownerSync] Could not resolve an owner for ${row.id} (id in notes: ${txHashId || 'none'}), retrying next sync`);
          result.unmatched += 1;
          continue;
        }

        await applyOwnerToRow({
          row, txIdPrefix, markerTagId: markerTag.id, ownerUserId,
        });
        result.updated += 1;
      } catch (rowError) {
        debugLog(`[ownerSync] Error updating ${row.id}:`, rowError);
        result.failed += 1;
      }
    }

    if (result.deferred > 0) {
      debugLog(`[ownerSync] Deferred ${result.deferred} update(s) to the next sync (cap ${maxUpdates})`);
    }

    debugLog('[ownerSync] Completed', result);
    return result;
  } catch (error) {
    // A whole-pass failure must not abort the sync — the marker tags survive,
    // so the work is simply retried.
    debugLog('[ownerSync] Owner sync failed, continuing:', error);
    return { ...result, success: false, error: (error as Error).message };
  }
}

/**
 * Build a resolver mapping `{prefix}:{hash}` ids to Monarch user ids.
 *
 * @param ownerByTxId - Hash id → Monarch user id
 * @returns Resolver suitable for `syncTransactionOwners`
 */
export function buildOwnerResolver(ownerByTxId: Map<string, string>): ResolveOwnerForTxIdFn {
  return (txHashId: string) => ownerByTxId.get(txHashId) || null;
}

/**
 * Format an owner sync result for the progress dialog.
 */
export function formatOwnerSyncMessage(result: OwnerSyncResult): string {
  if (result.noMarkerTag || result.noPendingOwners) {
    return 'None pending';
  }

  const parts: string[] = [];

  if (result.updated > 0) parts.push(`${result.updated} owner${result.updated === 1 ? '' : 's'} set`);
  if (result.alreadyOwned > 0) parts.push(`${result.alreadyOwned} already set`);
  if (result.unmatched > 0) parts.push(`${result.unmatched} unmatched`);
  if (result.deferred > 0) parts.push(`${result.deferred} deferred`);
  if (result.failed > 0) parts.push(`${result.failed} failed`);

  return parts.length > 0 ? parts.join(', ') : 'Nothing to update';
}

export default {
  syncTransactionOwners,
  buildOwnerResolver,
  formatOwnerSyncMessage,
  extractTxIdFromNotes,
  stripTxIdFromNotes,
};