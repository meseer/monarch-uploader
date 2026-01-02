/**
 * Wealthsimple to Monarch Account Type Mappings
 * Maps Wealthsimple account types to corresponding Monarch account type/subtype pairs
 */

/**
 * Map Wealthsimple account types to Monarch type/subtype
 * @type {Object.<string, {type: string, subtype: string}>}
 */
export const WEALTHSIMPLE_TO_MONARCH_ACCOUNT_TYPES = {
  // Investment accounts - Managed
  MANAGED_RESP_FAMILY: { type: 'brokerage', subtype: 'resp' },
  MANAGED_RESP: { type: 'brokerage', subtype: 'resp' },
  MANAGED_NON_REGISTERED: { type: 'brokerage', subtype: 'brokerage' },
  MANAGED_TFSA: { type: 'brokerage', subtype: 'tfsa' },
  MANAGED_RRSP: { type: 'brokerage', subtype: 'rrsp' },

  // Investment accounts - Self-directed
  SELF_DIRECTED_RESP_FAMILY: { type: 'brokerage', subtype: 'resp' },
  SELF_DIRECTED_RESP: { type: 'brokerage', subtype: 'resp' },
  SELF_DIRECTED_NON_REGISTERED: { type: 'brokerage', subtype: 'brokerage' },
  SELF_DIRECTED_TFSA: { type: 'brokerage', subtype: 'tfsa' },
  SELF_DIRECTED_RRSP: { type: 'brokerage', subtype: 'rrsp' },
  SELF_DIRECTED_CRYPTO: { type: 'brokerage', subtype: 'cryptocurrency' },

  // Cash accounts
  CASH: { type: 'depository', subtype: 'checking' },
  CASH_USD: { type: 'depository', subtype: 'checking' },

  // Credit cards
  CREDIT_CARD: { type: 'credit', subtype: 'credit_card' },

  // Loans
  PORTFOLIO_LINE_OF_CREDIT: { type: 'loan', subtype: 'line_of_credit' },
};

/**
 * Get Monarch account type mapping for a Wealthsimple account type
 * @param {string} wealthsimpleType - Wealthsimple account type
 * @returns {{type: string, subtype: string}|null} Monarch type/subtype or null if not mapped
 */
export function getMonarchAccountTypeMapping(wealthsimpleType) {
  return WEALTHSIMPLE_TO_MONARCH_ACCOUNT_TYPES[wealthsimpleType] || null;
}

/**
 * Check if a Wealthsimple account type has a known mapping
 * @param {string} wealthsimpleType - Wealthsimple account type
 * @returns {boolean} True if mapping exists
 */
export function hasAccountTypeMapping(wealthsimpleType) {
  return wealthsimpleType in WEALTHSIMPLE_TO_MONARCH_ACCOUNT_TYPES;
}

export default {
  WEALTHSIMPLE_TO_MONARCH_ACCOUNT_TYPES,
  getMonarchAccountTypeMapping,
  hasAccountTypeMapping,
};
