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

import { debugLog } from '../../core/utils';
import { MARKER_TAGS, OWNER_SYNC_MAX_UPDATES_PER_SYNC } from '../../core/config';
import monarchApi from '../../api/monarch';
import { computeSettledTagIds } from './pendingReconciliation';
import { shouldRetainTxIdInNotes, selectTagsByIds } from '../../core/markerTags';
import { fetchMarkerQueue, type MarkerQueueRow } from './markerTagQueue';

/** Identifier for this pass in pending-field probe diagnostics */
const PROBE_CONTEXT = 'ownerSync';

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
  /**
   * Rows whose Monarch-native `pending` flag was set as part of the same owner
   * mutation. Only ever non-zero when the caller opted in via `flagPending`.
   */
  pendingFlagged: number;
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
  /**
   * Also mark rows that still carry the `Pending` marker as Monarch-native
   * pending, in the *same* mutation that sets the owner.
   *
   * Opt-in per caller rather than automatic: a transaction should only be
   * flagged natively pending by an integration whose settle path also clears the
   * flag, and that rollout is staged. Callers that do not pass this stay
   * byte-identical to the pre-feature behaviour.
   */
  flagPending?: boolean;
  /** Injected delay, for tests. Defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

/** A Monarch transaction as returned by `getTransactionsList` */
type MonarchTransactionRow = MarkerQueueRow;

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
  pendingFlagged: 0,
  error: null,
};

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
 * Whether a row still carries the `Pending` marker tag.
 *
 * Read from the tags the row will keep *after* its owner marker is removed, so
 * the answer reflects the row's post-update state.
 */
function isStillPending(remainingTags: Array<{ name?: string }>): boolean {
  const pendingName = MARKER_TAGS.PENDING.toLowerCase();
  return remainingTags.some((tag) => (tag?.name || '').trim().toLowerCase() === pendingName);
}

/**
 * Apply the owner to one row and drop its marker tag.
 *
 * The notes keep the hash id whenever another marker (e.g. `Pending`) still
 * needs it — see `core/markerTags`.
 *
 * When `flagPending` is on and the row is still pending, the Monarch-native
 * `pending` flag rides along in the **same** mutation. Bundling it costs no extra
 * request and, because the write is defensive, cannot cost the owner update
 * either: if the field is rejected the owner is applied by the retry.
 *
 * @returns Whether the native pending flag was actually stored
 */
async function applyOwnerToRow({
  row, txIdPrefix, markerTagId, ownerUserId, flagPending,
}: {
  row: MonarchTransactionRow;
  txIdPrefix: string;
  markerTagId: string;
  ownerUserId: string;
  flagPending: boolean;
}): Promise<boolean> {
  const transactionId = row.id as string;
  const notes = row.notes || '';

  const remainingTagIds = computeSettledTagIds(row.tags, markerTagId);
  const remainingTags = selectTagsByIds(row.tags, remainingTagIds);
  const retainTxId = shouldRetainTxIdInNotes(remainingTags);
  const finalNotes = retainTxId ? notes : stripTxIdFromNotes(txIdPrefix, notes);

  const updates = { ownerUserId, notes: finalNotes };
  const shouldFlagPending = flagPending && isStillPending(remainingTags);
  let pendingApplied = false;

  if (shouldFlagPending) {
    const outcome = await monarchApi.updateTransactionWithPending(
      transactionId, updates, true, PROBE_CONTEXT,
    );
    pendingApplied = outcome.pendingApplied;
  } else {
    await monarchApi.updateTransaction(transactionId, updates);
  }

  // Drop the marker last: if this throws, the row keeps its marker and its id
  // and the next sync simply repeats the (idempotent) update.
  await monarchApi.setTransactionTags(transactionId, remainingTagIds);

  debugLog(`[ownerSync] Set owner ${ownerUserId} on ${transactionId}`, {
    retainedTxIdInNotes: retainTxId,
    remainingTagCount: remainingTagIds.length,
    pendingFlagRequested: shouldFlagPending,
    pendingFlagApplied: pendingApplied,
  });

  return pendingApplied;
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
  flagPending = false,
  sleep,
}: OwnerSyncParams): Promise<OwnerSyncResult> {
  const result: OwnerSyncResult = { ...EMPTY_RESULT };

  try {
    const { markerTag, rows } = await fetchMarkerQueue({
      monarchAccountId,
      tagName: MARKER_TAGS.PENDING_OWNER_UPDATE,
      lookbackDays,
      sleep,
    });

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

        const pendingApplied = await applyOwnerToRow({
          row, txIdPrefix, markerTagId: markerTag.id, ownerUserId, flagPending,
        });
        result.updated += 1;
        if (pendingApplied) result.pendingFlagged += 1;
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
  if (result.pendingFlagged > 0) parts.push(`${result.pendingFlagged} pending flagged`);
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