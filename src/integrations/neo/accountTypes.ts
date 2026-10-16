/**
 * Supported Neo deposit account types.
 *
 * Shared by account discovery (`source/api`) and the Monarch account defaults
 * in the manifest, so display names and Monarch subtypes cannot drift apart.
 * Kept free of runtime imports: the manifest is a declaration, and loading it
 * must not pull in the API client.
 */

export interface NeoDepositProduct {
  displayName: string;
  accountSubtype: 'checking' | 'savings';
}

/**
 * Supported deposit products, keyed by the API's `program.productName`.
 * Anything not on this list is skipped in `getAccounts()` and never reaches
 * account mapping.
 */
export const SUPPORTED_DEPOSIT_PRODUCTS: Record<string, NeoDepositProduct> = {
  EVERYDAY: { displayName: 'Neo Everyday', accountSubtype: 'checking' },
  SAVINGS: { displayName: 'Neo Savings', accountSubtype: 'savings' },
  HISA: { displayName: 'Neo High-Interest Savings', accountSubtype: 'savings' },
};

/** Deposit account categories that discovery accepts. */
export const SUPPORTED_DEPOSIT_CATEGORIES = ['EVERYDAY', 'HISA'];

/**
 * Look up a supported deposit product.
 *
 * @param productName - The API's `program.productName`
 * @returns Product info, or undefined when the product is not supported
 */
export function getDepositProductInfo(productName: string): NeoDepositProduct | undefined {
  return SUPPORTED_DEPOSIT_PRODUCTS[productName];
}
