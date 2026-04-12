/**
 * Wealthsimple to Monarch Account Type Mappings
 * Maps Wealthsimple account types to corresponding Monarch account type/subtype pairs
 * Also provides human-readable display names for account types
 */

interface MonarchAccountTypeMapping {
  type: string;
  subtype: string;
}

/**
 * Map Wealthsimple account types to human-readable display names
 * Used when generating default account names when user hasn't set a nickname
 */
const WEALTHSIMPLE_ACCOUNT_TYPE_DISPLAY_NAMES = {
  // Investment accounts - Managed
  MANAGED_RESP_FAMILY: 'Managed Family RESP',
  MANAGED_RESP: 'Managed RESP',
  MANAGED_NON_REGISTERED: 'Managed Non-Registered',
  MANAGED_TFSA: 'Managed TFSA',
  MANAGED_RRSP: 'Managed RRSP',

  // Investment accounts - Self-directed
  SELF_DIRECTED_RESP_FAMILY: 'Self Directed Family RESP',
  SELF_DIRECTED_RESP: 'Self Directed RESP',
  SELF_DIRECTED_NON_REGISTERED: 'Self Directed Non-Registered',
  SELF_DIRECTED_TFSA: 'Self Directed TFSA',
  SELF_DIRECTED_RRSP: 'Self Directed RRSP',
  SELF_DIRECTED_CRYPTO: 'Self Directed Crypto',

  // Cash accounts
  CASH: 'Cash',
  CASH_USD: 'Cash USD',

  // Credit cards
  CREDIT_CARD: 'Credit Card',

  // Loans
  PORTFOLIO_LINE_OF_CREDIT: 'Portfolio Line of Credit',
} as const;

/**
 * Map Wealthsimple account types to Monarch type/subtype
 */
const WEALTHSIMPLE_TO_MONARCH_ACCOUNT_TYPES: Record<string, MonarchAccountTypeMapping> = {
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
 */
export function getMonarchAccountTypeMapping(wealthsimpleType: string): MonarchAccountTypeMapping | null {
  return WEALTHSIMPLE_TO_MONARCH_ACCOUNT_TYPES[wealthsimpleType] || null;
}

/**
 * Get human-readable display name for a Wealthsimple account type
 * Falls back to the raw type if no mapping exists
 */
export function getAccountTypeDisplayName(wealthsimpleType: string): string {
  return (WEALTHSIMPLE_ACCOUNT_TYPE_DISPLAY_NAMES as Record<string, string>)[wealthsimpleType] || wealthsimpleType;
}

