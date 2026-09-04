/**
 * Rogers Bank Cardholder Extractor
 *
 * Extracts cardholder identity from a raw Rogers Bank activity so the generic
 * cardholder service can map it to a Monarch owner and/or tag.
 *
 * Rogers Bank includes `name.nameOnCard` and `cardNumber` on both PENDING and
 * APPROVED activities, so no extra API calls or DOM scraping are needed:
 *
 * ```
 * {
 *   "name": { "nameOnCard": "MYKHAILO DELEGAN" },
 *   "cardNumber": "************8584",
 *   ...
 * }
 * ```
 *
 * IMPORTANT: `cardNumber` is already part of the pending-transaction dedup hash
 * (see `generatePendingTransactionId`). The cardholder name must NEVER be added
 * to that hash — doing so would invalidate every stored `rb-tx:` ID and cause
 * mass duplicate uploads.
 *
 * @module services/rogersbank/cardholderExtractor
 */

import type { CardholderInfo } from '../../integrations/types';

/**
 * Extract the last 4 digits from a masked Rogers card number.
 *
 * Rogers reports `"************8584"`; we keep only the trailing digits so the
 * value is safe to display. Returns null when no digits are present.
 *
 * @param cardNumber - Masked card number from the API
 * @returns Last 4 digits, or null
 */
export function extractCardLast4(cardNumber: unknown): string | null {
  if (!cardNumber || typeof cardNumber !== 'string') {
    return null;
  }

  const digits = cardNumber.replace(/\D/g, '');
  if (!digits) return null;

  return digits.slice(-4);
}

/**
 * Extract cardholder identity from a Rogers Bank activity.
 *
 * Returns null when the activity has no cardholder name (e.g. account-level
 * payments or adjustments), which the cardholder service treats as "no tag,
 * Shared owner".
 *
 * @param tx - Raw Rogers Bank activity
 * @returns Cardholder info, or null when unavailable
 */
export function extractRogersCardholder(tx: Record<string, unknown>): CardholderInfo | null {
  const nameObj = tx?.name as { nameOnCard?: unknown } | undefined;
  const rawName = nameObj?.nameOnCard;

  if (!rawName || typeof rawName !== 'string' || !rawName.trim()) {
    return null;
  }

  return {
    name: rawName.trim(),
    cardLast4: extractCardLast4(tx?.cardNumber),
  };
}

export default {
  extractRogersCardholder,
  extractCardLast4,
};