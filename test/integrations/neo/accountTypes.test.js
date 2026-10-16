/**
 * Tests for the shared Neo deposit account types table.
 */

import {
  getDepositProductInfo,
  SUPPORTED_DEPOSIT_CATEGORIES,
} from '../../../src/integrations/neo/accountTypes';
import manifest from '../../../src/integrations/neo/manifest';

// The manifest is a declaration and must load without the API client. If it
// imports source/api again, importing it in this file throws.
jest.mock('../../../src/integrations/neo/source/api', () => {
  throw new Error('neo/manifest must not import source/api');
});

describe('Neo deposit account types', () => {
  it.each([
    ['EVERYDAY', 'Neo Everyday', 'checking'],
    ['SAVINGS', 'Neo Savings', 'savings'],
    ['HISA', 'Neo High-Interest Savings', 'savings'],
  ])('describes the %s product', (productName, displayName, accountSubtype) => {
    expect(getDepositProductInfo(productName)).toEqual({ displayName, accountSubtype });
  });

  it('returns undefined for an unsupported product', () => {
    expect(getDepositProductInfo('US_DOLLAR')).toBeUndefined();
  });

  it('accepts the Everyday and HISA categories', () => {
    expect(SUPPORTED_DEPOSIT_CATEGORIES).toEqual(['EVERYDAY', 'HISA']);
  });

  it('lets the manifest load and resolve defaults without the API client', () => {
    expect(manifest.accountDefaultsForAccount({ accountType: 'depository', category: 'HISA', productName: 'SAVINGS' }))
      .toEqual(expect.objectContaining({
        accountCreateDefaults: expect.objectContaining({ defaultSubtype: 'savings' }),
      }));
  });
});
