/**
 * Post-Sync Update Stage
 *
 * A registry of the follow-up passes that run **after** transactions have been
 * uploaded to Monarch.
 *
 * ## Why a registry
 *
 * Monarch's CSV importer cannot express everything a transaction needs: it has no
 * owner column and no native pending flag. Each such gap is closed by a separate
 * GraphQL pass that finds the affected rows via a marker tag and fills in the
 * missing field. There will be more of these over time.
 *
 * Before this module, each pass was wired by hand in every upload service — its
 * step had to be declared in one place and executed in another, and adding a pass
 * meant editing both, in every integration. Declaring the passes as data fixes
 * that: `buildPostSyncSteps` and `runPostSyncUpdates` walk the *same* list, so a
 * declared step is always executed and an executed step is always declared.
 * Adding a pass is one array entry.
 *
 * ## Design notes
 *
 * - **Each pass keeps its own step.** They could be collapsed into one opaque
 *   "post-sync" row, but per-pass steps give the user a specific message
 *   ("3 owners set" vs "12 already pending") and keep existing step keys stable.
 * - **Passes are independent.** One failing pass never prevents another from
 *   running, and none of them can abort the sync — each returns a result rather
 *   than throwing.
 * - **Enablement is capability-driven.** A pass declares when it applies; callers
 *   supply facts about the account, not decisions about which passes to run.
 *
 * @module services/common/postSyncUpdates
 */

import { debugLog } from '../../core/utils';
import { syncTransactionOwners, buildOwnerResolver, formatOwnerSyncMessage, type OwnerSyncResult } from './ownerSync';
import { syncPendingStatuses, formatPendingStatusMessage, type PendingStatusSyncResult } from './pendingStatusSync';

// ── Types ───────────────────────────────────────────────────

/** A progress dialog step definition */
export interface PostSyncStep {
  key: string;
  name: string;
}

/** Everything a post-sync pass may need to decide whether and how to run */
export interface PostSyncContext {
  /** Source account ID, used as the progress dialog row key */
  accountId: string;
  /** Monarch account to update */
  monarchAccountId: string;
  /** Integration hash prefix (e.g. `rb-tx`); null when the integration has none */
  txIdPrefix: string | null;
  /** How many days back the passes should scan in Monarch */
  lookbackDays: number;
  /** Whether the account opted into cardholder → owner mapping */
  ownerSyncEnabled: boolean;
  /**
   * Whether to reconcile Monarch's native pending status from the `Pending` tag.
   *
   * Staged per integration: only enable it where the settle path also clears the
   * native flag, so a transaction is never left permanently pending.
   */
  pendingStatusEnabled: boolean;
  /** Notes hash id → Monarch user id, collected during the transaction step */
  ownerAssignments: Map<string, string>;
}

/** The minimal progress dialog surface these passes need */
export interface PostSyncProgressDialog {
  updateStepStatus: (accountId: string, step: string, status: string, message: string) => void;
}

/**
 * The minimum contract every pass result must satisfy so this module can report
 * it without knowing anything else about the pass.
 */
export interface PassOutcome {
  /** False only when the pass itself failed; an unsupported field is not a failure */
  success: boolean;
  /** True when the feature is unavailable rather than broken */
  unsupported?: boolean;
  /** Failure detail when `success` is false */
  error?: string | null;
}

/**
 * A registered post-sync pass.
 *
 * Generic in its result type so `run` and `format` are checked against each
 * other — a pass cannot be registered with a formatter that does not match its
 * own result shape.
 */
interface PostSyncPass<TResult extends PassOutcome> {
  key: string;
  name: string;
  isEnabled: (ctx: PostSyncContext) => boolean;
  run: (ctx: PostSyncContext) => Promise<TResult>;
  format: (result: TResult) => string;
  /** Status message shown while the pass is running */
  processingMessage: string;
}

/**
 * A pass with its result type erased, so passes with different result shapes can
 * live in one array.
 *
 * The erasure is applied by `definePass`, which type-checks `run` against
 * `format` first. That keeps the registry heterogeneous *and* type-safe, which a
 * plain `PostSyncPass<PassOutcome>[]` array cannot do — the results are only
 * ever produced and consumed by the same pass, never mixed.
 */
type ErasedPass = PostSyncPass<PassOutcome>;

/**
 * Register a pass, checking `run` and `format` agree before erasing the result
 * type for storage in the registry.
 */
function definePass<TResult extends PassOutcome>(pass: PostSyncPass<TResult>): ErasedPass {
  return pass as ErasedPass;
}

// ── Registry ────────────────────────────────────────────────

/**
 * The post-sync passes, in execution order.
 *
 * Owner sync runs first so that when both passes apply, the owner mutation can
 * carry the pending flag with it (`flagPending`) — leaving the pending pass with
 * nothing to do for those rows. Reversing the order would work, but would cost a
 * second mutation per row.
 */
const POST_SYNC_PASSES: ErasedPass[] = [
  definePass<OwnerSyncResult>({
    key: 'ownerSync',
    name: 'Owner sync',
    processingMessage: 'Applying owners...',
    isEnabled: (ctx) => ctx.ownerSyncEnabled && Boolean(ctx.txIdPrefix),
    run: (ctx) => syncTransactionOwners({
      monarchAccountId: ctx.monarchAccountId,
      txIdPrefix: ctx.txIdPrefix as string,
      resolveOwnerForTxId: buildOwnerResolver(ctx.ownerAssignments),
      lookbackDays: ctx.lookbackDays,
      // Bundle the native pending flag into the owner mutation, but only where
      // the pending feature is active for this integration.
      flagPending: ctx.pendingStatusEnabled,
    }),
    format: formatOwnerSyncMessage,
  }),
  definePass<PendingStatusSyncResult>({
    key: 'pendingStatus',
    name: 'Pending status',
    processingMessage: 'Marking pending...',
    isEnabled: (ctx) => ctx.pendingStatusEnabled,
    run: (ctx) => syncPendingStatuses({
      monarchAccountId: ctx.monarchAccountId,
      lookbackDays: ctx.lookbackDays,
    }),
    format: formatPendingStatusMessage,
  }),
];

// ── Public API ──────────────────────────────────────────────

/**
 * Build the progress dialog steps for the post-sync stage.
 *
 * Call while assembling an integration's step list, positioned after the
 * transaction upload step.
 *
 * @param ctx - Post-sync context (only the enablement fields are read)
 * @returns Step definitions for the passes that apply
 */
export function buildPostSyncSteps(ctx: PostSyncContext): PostSyncStep[] {
  return POST_SYNC_PASSES
    .filter((pass) => pass.isEnabled(ctx))
    .map((pass) => ({ key: pass.key, name: pass.name }));
}

/**
 * Resolve the progress dialog status for a pass outcome.
 *
 * An unsupported feature reports as `skipped`, not `error`: the field simply is
 * not available, and colouring that as a failure would make a healthy sync look
 * broken.
 */
function resolveStatus(result: PassOutcome): string {
  if (result.unsupported) return 'skipped';
  return result.success === false ? 'error' : 'success';
}

/**
 * Run every applicable post-sync pass, reporting each on its own step.
 *
 * Must be called **after** the transaction upload (the rows being updated are the
 * ones the upload created) and **after** pending reconciliation (so settled rows
 * have already lost their marker tags).
 *
 * Never throws: a pass that fails is reported on its step and the remaining
 * passes still run.
 *
 * @param ctx - Post-sync context
 * @param progressDialog - Progress dialog instance
 * @returns Each executed pass's result, keyed by pass key
 */
export async function runPostSyncUpdates(
  ctx: PostSyncContext,
  progressDialog: PostSyncProgressDialog,
): Promise<Record<string, PassOutcome>> {
  const results: Record<string, PassOutcome> = {};

  for (const pass of POST_SYNC_PASSES) {
    if (!pass.isEnabled(ctx)) continue;

    progressDialog.updateStepStatus(ctx.accountId, pass.key, 'processing', pass.processingMessage);

    try {
      const result = await pass.run(ctx);
      results[pass.key] = result;

      progressDialog.updateStepStatus(
        ctx.accountId,
        pass.key,
        resolveStatus(result),
        pass.format(result),
      );
      debugLog(`[postSync] ${pass.key} result:`, result);
    } catch (error) {
      // The passes are written not to throw, so this is a belt-and-braces guard:
      // an unexpected failure in one pass must not skip the others.
      const message = (error as Error).message || 'Failed';
      debugLog(`[postSync] ${pass.key} threw unexpectedly:`, error);
      results[pass.key] = { success: false, error: message };
      progressDialog.updateStepStatus(ctx.accountId, pass.key, 'error', message);
    }
  }

  return results;
}

export default {
  buildPostSyncSteps,
  runPostSyncUpdates,
};