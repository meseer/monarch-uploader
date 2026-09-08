/**
 * Monarch Transaction ID Utilities
 *
 * Monarch's CSV importer accepts an `id` column and can use it to match an
 * incoming row against a transaction it already holds (its help centre calls
 * this *"Use transaction IDs to match transactions"*). That makes it a
 * first-class replacement for the `{prefix}:{hash}` id we currently smuggle
 * through the **notes** field.
 *
 * This module owns the single rule for deriving that id.
 *
 * ## The id is the notes id, promoted — not a new identifier
 *
 * Every integration that supports pending reconciliation already computes a
 * stable, namespaced id and writes it into the notes:
 *
 * | Integration   | id                  | Source                                   |
 * |---------------|---------------------|------------------------------------------|
 * | Rogers Bank   | `rb-tx:{hash16}`    | `txHashId` / `pendingId`                 |
 * | MBNA          | `mbna-tx:{hash16}`  | `txHashId` / `pendingId`                 |
 * | Wealthsimple  | `ws-tx:{id}`        | `externalCanonicalId` → notes id         |
 *
 * The `Id` CSV column carries **exactly that string**. Deliberately so: reusing
 * it means the column inherits whatever correlation properties the notes id
 * already has, and introduces no new id-stability risk. Inventing a second
 * identifier would mean two things to keep in sync and two migrations later.
 *
 * ## One difference from the notes rule
 *
 * `resolveNotesTransactionId` (see `core/markerTags`) writes an id for **pending**
 * rows only, plus settled rows that carry the owner-sync marker — so notes stay
 * byte-identical for users who have not opted into owner mapping. The `Id`
 * column has no such constraint: Monarch reads it as a column rather than
 * showing it to the user, so it is written unconditionally whenever an id
 * exists. The notes gating is untouched.
 *
 * @module core/transactionIds
 */

/** Inputs for deriving the Monarch `Id` column value */
export interface MonarchTransactionIdInputs {
  /**
   * Stable hash id, already prefixed (e.g. `rb-tx:abc…`). Present on both
   * settled and pending rows for hash-based integrations, which makes it the
   * preferred source.
   */
  txHashId?: string | null;
  /** Pending hash id, already prefixed. Equal to `txHashId` when both are set. */
  pendingId?: string | null;
  /**
   * Integration-specific id, already prefixed (e.g. `ws-tx:{externalCanonicalId}`).
   * Used by integrations that carry a provider id rather than a computed hash.
   */
  fallbackId?: string | null;
}

/** Return a trimmed non-empty string, or null */
function normalizeId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Resolve the value for the Monarch `Id` CSV column.
 *
 * Sources are tried in order of stability: `txHashId` first (present on settled
 * *and* pending rows, so it survives the pending → settled transition),
 * then `pendingId`, then the integration-specific `fallbackId`.
 *
 * @returns The id to write, or an empty string when the row has no usable id
 */
export function resolveMonarchTransactionId({
  txHashId = null,
  pendingId = null,
  fallbackId = null,
}: MonarchTransactionIdInputs = {}): string {
  return normalizeId(txHashId)
    ?? normalizeId(pendingId)
    ?? normalizeId(fallbackId)
    ?? '';
}

export default {
  resolveMonarchTransactionId,
};