/**
 * MBNA Cardholder Extractor
 *
 * Extracts cardholder identity from a raw MBNA transaction so the generic
 * cardholder service can map it to a Monarch owner and/or tag.
 *
 * MBNA includes `cardHolderName` and `endingIn` directly on transactions:
 *
 * ```
 * {
 *   "cardHolderName": "MYKHAILO DELEGAN",
 *   "endingIn": "4201",
 *   "primaryCardHolder": true,
 *   ...
 * }
 * ```
 *
 * ## Why we don't use the /cardholders endpoint
 *
 * MBNA exposes `/waw/mbna/{account}/cardholders`, which lists every authorized
 * cardholder on the account. We deliberately do NOT call it: an authorized user
 * who never transacts would still be listed, which would flip the `auto` tag
 * mode on for an account that is single-user in practice. Deriving cardholders
 * from transactions gives the intended behaviour and avoids an extra HTTP call
 * and a second code path.
 *
 * IMPORTANT: `endingIn` is already part of the pending-transaction dedup hash
 * (see `getPendingIdFields`). The cardholder name must NEVER be added to that
 * hash — doing so would invalidate every stored `mbna-tx:` ID and cause mass
 * duplicate uploads.
 *
 * @module integrations/mbna/source/cardholderExtractor
 */

import type { CardholderInfo } from '../../types';

/**
 * Extract cardholder identity from an MBNA transaction.
 *
 * `endingIn` is already bare digits (unlike Rogers' masked card number), so it
 * is used as-is after stripping any non-digit characters defensively.
 *
 * Returns null when the transaction has no cardholder name, which the cardholder
 * service treats as "no tag, Shared owner".
 *
 * @param tx - Raw MBNA transaction
 * @returns Cardholder info, or null when unavailable
 */
export function extractMbnaCardholder(tx: Record<string, unknown>): CardholderInfo | null {
  const rawName = tx?.cardHolderName;

  if (!rawName || typeof rawName !== 'string' || !rawName.trim()) {
    return null;
  }

  const endingIn = typeof tx?.endingIn === 'string' ? tx.endingIn.replace(/\D/g, '') : '';

  return {
    name: rawName.trim(),
    cardLast4: endingIn || null,
  };
}

export default {
  extractMbnaCardholder,
};