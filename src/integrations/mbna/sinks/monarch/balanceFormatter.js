/**
 * MBNA → Monarch Balance Formatter
 *
 * Transforms raw MBNA balance history into Monarch-compatible format.
 * Handles the sign inversion: MBNA positive (owed) → Monarch negative (liability).
 *
 * @module integrations/mbna/sinks/monarch/balanceFormatter
 */

/**
 * Format balance history for Monarch API upload
 *
 * MBNA balances are inverted for Monarch: MBNA positive (owed) → Monarch negative (liability),
 * MBNA negative (credit/overpayment) → Monarch positive.
 *
 * @param {Array<{date: string, balance: number}>} balanceHistory - Balance entries (raw MBNA values)
 * @returns {Array<{date: string, amount: number}>} Formatted for Monarch API (negated)
 */
export function formatBalanceHistoryForMonarch(balanceHistory) {
  return balanceHistory.map((entry) => ({
    date: entry.date,
    amount: -entry.balance,
  }));
}

export default {
  formatBalanceHistoryForMonarch,
};