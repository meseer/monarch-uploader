/**
 * Post-Upload Pending Status Sync
 *
 * Marks transactions that our `Pending` marker tag identifies as pending with
 * Monarch's **native** `pending` status.
 *
 * ## Why this exists
 *
 * Pending transactions have always been tracked with a `Pending` **tag**, because
 * Monarch's CSV importer accepts tags but has no column for the native pending
 * flag. The tag works, but it is our own convention: Monarch's UI, filters and
 * reports know nothing about it, whereas they all understand `pending`.
 *
 * This pass closes that gap without disturbing anything that already works.
 *
 * ## The tag is the queue
 *
 * Exactly like `pendingOwnerUpdate` drives owner sync, the `Pending` tag drives
 * this pass — the same mechanism, via `markerTagQueue`. That choice is what makes
 * the migration safe:
 *
 * - **Robust.** The tag is written by the CSV import and removed by
 *   reconciliation when the transaction settles, so the queue is always an
 *   accurate, self-maintaining list of what should be pending.
 * - **Crash-safe.** Nothing needs to be remembered between syncs. A transaction
 *   missed for any reason — batch cap, transient failure, an interrupted sync —
 *   still carries its tag and is simply picked up next time.
 * - **Incremental.** No existing behaviour changes. The tag keeps being written
 *   and keeps being the source of truth; the native flag is layered on top. If
 *   the flag turns out to be unwritable, everything still works exactly as before.
 *
 * ## Defensive by design
 *
 * `pending` is not a documented part of Monarch's mutation contract, so this pass
 * assumes it might be rejected or silently dropped. The API client
 * (`updateTransactionWithPending`) latches the first failure, and this pass stops
 * as soon as that happens — so an unsupported field costs exactly **one** wasted
 * mutation per session, and is reported as "not supported" rather than an error.
 *
 * @module services/common/pendingStatusSync
 */

import { debugLog, logWarning } from '../../core/utils';
import { MARKER_TAGS, OWNER_SYNC_MAX_UPDATES_PER_SYNC } from '../../core/config';
import monarchApi from '../../api/monarch';
import { fetchMarkerQueue, type MarkerQueueRow } from './markerTagQueue';

/** Identifier for this pass in probe diagnostics */
const PROBE_CONTEXT = 'pendingStatusSync';

// ── Types ───────────────────────────────────────────────────

/** Outcome of a pending status sync pass */
export interface PendingStatusSyncResult {
  success: boolean;
  /** Rows newly marked natively pending */
  flagged: number;
  /** Rows already natively pending — the steady state, so usually the majority */
  alreadyPending: number;
  /** Rows Monarch accepted but did not actually mark pending */
  ignored: number;
  /** Rows that errored individually */
  failed: number;
  /** Rows left for the next sync because the per-sync cap was reached */
  deferred: number;
  /** Monarch does not accept the `pending` field; the pass stopped early */
  unsupported?: boolean;
  /**
   * The field was already proven unsupported *before* this pass ran, so this pass
   * issued no mutation and tested nothing itself.
   *
   * Kept distinct from `unsupported` so the log never implies this pass reached a
   * conclusion it did not: the deciding probe usually happens in an earlier pass
   * (owner sync, or the settle path), and saying otherwise sends debugging in the
   * wrong direction.
   */
  alreadyUnsupported?: boolean;
  /** The `Pending` tag does not exist, so nothing could be queued */
  noPendingTag?: boolean;
  /** No transaction carried the `Pending` tag */
  noPendingTransactions?: boolean;
  error: string | null;
}

/** Parameters for `syncPendingStatuses` */
export interface PendingStatusSyncParams {
  /** Monarch account to scan */
  monarchAccountId: string;
  /** How many days back to scan; should cover the retention window */
  lookbackDays: number;
  /** Cap on mutations issued this sync (defaults to the configured limit) */
  maxUpdates?: number;
  /** Injected delay, for tests. Defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

const EMPTY_RESULT: PendingStatusSyncResult = {
  success: true,
  flagged: 0,
  alreadyPending: 0,
  ignored: 0,
  failed: 0,
  deferred: 0,
  error: null,
};

// ── Helpers ─────────────────────────────────────────────────

/**
 * Whether a row already carries Monarch's native pending status.
 *
 * Skipping these is what keeps the pass nearly free: once a transaction has been
 * flagged, every later sync sees it as already correct and issues no mutation, so
 * the steady-state cost of this pass is a single list query.
 */
function isAlreadyPending(row: MarkerQueueRow): boolean {
  return row.pending === true;
}

// ── Orchestration ───────────────────────────────────────────

/**
 * Mark `Pending`-tagged transactions as natively pending in Monarch.
 *
 * Must run **after** pending reconciliation, so transactions that have settled
 * have already had their tag removed and are correctly absent from the queue.
 *
 * @param params - Sync parameters
 * @returns Counts for the progress dialog; never throws
 */
export async function syncPendingStatuses({
  monarchAccountId,
  lookbackDays,
  maxUpdates = OWNER_SYNC_MAX_UPDATES_PER_SYNC,
  sleep,
}: PendingStatusSyncParams): Promise<PendingStatusSyncResult> {
  const result: PendingStatusSyncResult = { ...EMPTY_RESULT };

  try {
    const { markerTag, rows } = await fetchMarkerQueue({
      monarchAccountId,
      tagName: MARKER_TAGS.PENDING,
      lookbackDays,
      sleep,
    });

    if (!markerTag) {
      return { ...result, noPendingTag: true };
    }

    if (rows.length === 0) {
      debugLog('[pendingStatus] No transactions carry the Pending tag');
      return { ...result, noPendingTransactions: true };
    }

    debugLog(`[pendingStatus] ${rows.length} transaction(s) tagged Pending`);

    for (const row of rows) {
      // Bail out entirely once the field is known unusable: continuing would
      // issue pointless mutations for every remaining row.
      if (!monarchApi.isPendingFieldSupported()) {
        result.unsupported = true;
        // Nothing attempted yet ⇒ an earlier pass decided this, not this one.
        if (result.flagged === 0 && result.ignored === 0) {
          result.alreadyUnsupported = true;
        }
        break;
      }

      // Cap the burst; the tag keeps the remainder queued for next sync.
      if (result.flagged >= maxUpdates) {
        result.deferred += 1;
        continue;
      }

      try {
        if (!row.id) {
          result.failed += 1;
          continue;
        }

        if (isAlreadyPending(row)) {
          result.alreadyPending += 1;
          continue;
        }

        const { pendingApplied } = await monarchApi.updateTransactionWithPending(
          row.id, {}, true, PROBE_CONTEXT,
        );

        if (pendingApplied) {
          result.flagged += 1;
          debugLog(`[pendingStatus] Marked ${row.id} as natively pending`);
        } else {
          // The field was rejected or dropped. The latch is now set, so the next
          // loop iteration stops the pass — this is the one wasted mutation.
          result.ignored += 1;
        }
      } catch (rowError) {
        debugLog(`[pendingStatus] Error updating ${row.id}:`, rowError);
        result.failed += 1;
      }
    }

    if (result.unsupported) {
      // Report the actual evidence and where it came from. A bare "unsupported"
      // is unactionable, and actively misleading when the verdict was reached by
      // a different pass earlier in the sync.
      const probe = monarchApi.getPendingFieldProbe();
      const origin = result.alreadyUnsupported
        ? 'was proven unsupported earlier this session'
        : 'was proven unsupported by this pass';
      const evidence = probe
        ? `${probe.verdict} during ${probe.context} on transaction ${probe.transactionId}: ${probe.detail}`
        : 'no probe record available';

      logWarning(`[pendingStatus] Skipping ${rows.length} tagged transaction(s) — `
        + `the "pending" field ${origin} (${evidence})`);
    }

    if (result.deferred > 0) {
      debugLog(`[pendingStatus] Deferred ${result.deferred} update(s) to the next sync (cap ${maxUpdates})`);
    }

    debugLog('[pendingStatus] Completed', result);
    return result;
  } catch (error) {
    // A whole-pass failure must not abort the sync — the Pending tags survive,
    // so the work is simply retried.
    debugLog('[pendingStatus] Pending status sync failed, continuing:', error);
    return { ...result, success: false, error: (error as Error).message };
  }
}

/**
 * Format a pending status result for the progress dialog.
 *
 * An unsupported field is deliberately *not* phrased as a failure: it is an
 * expected outcome of a defensive probe, and surfacing it as an error would make
 * a perfectly healthy sync look broken.
 */
export function formatPendingStatusMessage(result: PendingStatusSyncResult): string {
  if (result.noPendingTag || result.noPendingTransactions) {
    return 'None pending';
  }

  if (result.unsupported) {
    return 'Not supported';
  }

  const parts: string[] = [];

  if (result.flagged > 0) parts.push(`${result.flagged} flagged`);
  if (result.alreadyPending > 0) parts.push(`${result.alreadyPending} already pending`);
  if (result.failed > 0) parts.push(`${result.failed} failed`);
  if (result.deferred > 0) parts.push(`${result.deferred} deferred`);

  return parts.length > 0 ? parts.join(', ') : 'Nothing to update';
}

export default {
  syncPendingStatuses,
  formatPendingStatusMessage,
};