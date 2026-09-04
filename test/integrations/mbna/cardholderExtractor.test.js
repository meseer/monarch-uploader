/**
 * Tests for the MBNA cardholder extractor
 *
 * Fixtures mirror real MBNA transaction payloads, which carry `cardHolderName`
 * and a bare `endingIn` (unlike Rogers' masked card number).
 */

import { extractMbnaCardholder } from '../../../src/integrations/mbna/source/cardholderExtractor';

describe('extractMbnaCardholder', () => {
  it('extracts name and endingIn from a settled transaction', () => {
    const tx = {
      transactionDate: '2026-05-05',
      postingDate: '2026-05-05',
      description: 'PAYMENT',
      referenceNumber: '00000406124000533681201',
      cardHolderName: 'MYKHAILO DELEGAN',
      cardHolderNameFr: 'MYKHAILO DELEGAN',
      amount: -257.38,
      primaryCardHolder: true,
      endingIn: '4201',
    };

    expect(extractMbnaCardholder(tx)).toEqual({
      name: 'MYKHAILO DELEGAN',
      cardLast4: '4201',
    });
  });

  it('extracts a secondary cardholder', () => {
    const tx = {
      transactionDate: '2026-05-06',
      description: 'GROCERY STORE',
      cardHolderName: 'LIUBOV MONSAR',
      amount: 42.10,
      primaryCardHolder: false,
      endingIn: '2142',
    };

    expect(extractMbnaCardholder(tx)).toEqual({
      name: 'LIUBOV MONSAR',
      cardLast4: '2142',
    });
  });

  it('trims surrounding whitespace from the name', () => {
    const tx = { cardHolderName: '  MYKHAILO DELEGAN  ', endingIn: '4201' };

    expect(extractMbnaCardholder(tx).name).toBe('MYKHAILO DELEGAN');
  });

  it('strips non-digit characters from endingIn defensively', () => {
    const tx = { cardHolderName: 'MYKHAILO DELEGAN', endingIn: '*4201' };

    expect(extractMbnaCardholder(tx).cardLast4).toBe('4201');
  });

  it('uses the English cardHolderName rather than the French variant', () => {
    const tx = {
      cardHolderName: 'MYKHAILO DELEGAN',
      cardHolderNameFr: 'NOM FRANCAIS',
      endingIn: '4201',
    };

    expect(extractMbnaCardholder(tx).name).toBe('MYKHAILO DELEGAN');
  });

  it.each([
    ['endingIn is missing', { cardHolderName: 'MYKHAILO DELEGAN' }],
    ['endingIn is empty', { cardHolderName: 'MYKHAILO DELEGAN', endingIn: '' }],
    ['endingIn has no digits', { cardHolderName: 'MYKHAILO DELEGAN', endingIn: '****' }],
    ['endingIn is a number', { cardHolderName: 'MYKHAILO DELEGAN', endingIn: 4201 }],
  ])('returns a null cardLast4 when %s', (_label, tx) => {
    expect(extractMbnaCardholder(tx)).toEqual({ name: 'MYKHAILO DELEGAN', cardLast4: null });
  });

  it.each([
    ['no cardHolderName', { endingIn: '4201' }],
    ['a null cardHolderName', { cardHolderName: null, endingIn: '4201' }],
    ['an empty cardHolderName', { cardHolderName: '', endingIn: '4201' }],
    ['a whitespace-only cardHolderName', { cardHolderName: '   ', endingIn: '4201' }],
    ['a non-string cardHolderName', { cardHolderName: 12345, endingIn: '4201' }],
    ['an empty transaction', {}],
  ])('returns null for a transaction with %s', (_label, tx) => {
    expect(extractMbnaCardholder(tx)).toBeNull();
  });

  it('returns null for a null transaction', () => {
    expect(extractMbnaCardholder(null)).toBeNull();
  });
});