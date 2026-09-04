/**
 * Tests for the Rogers Bank cardholder extractor
 *
 * Fixtures mirror real Rogers Bank activity payloads, which carry
 * `name.nameOnCard` and a masked `cardNumber` on both PENDING and APPROVED
 * transactions.
 */

import { extractRogersCardholder, extractCardLast4 } from '../../../src/services/rogersbank/cardholderExtractor';

describe('extractCardLast4', () => {
  it('extracts the last 4 digits from a masked card number', () => {
    expect(extractCardLast4('************8584')).toBe('8584');
  });

  it('handles an unmasked card number', () => {
    expect(extractCardLast4('4519123456788584')).toBe('8584');
  });

  it('handles a card number with separators', () => {
    expect(extractCardLast4('**** **** **** 8584')).toBe('8584');
  });

  it('returns the available digits when fewer than four are present', () => {
    expect(extractCardLast4('***84')).toBe('84');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['fully masked with no digits', '****************'],
    ['a number instead of a string', 8584],
  ])('returns null for %s', (_label, value) => {
    expect(extractCardLast4(value)).toBeNull();
  });
});

describe('extractRogersCardholder', () => {
  it('extracts name and card last 4 from a PENDING activity', () => {
    const tx = {
      date: '2026-09-04',
      amount: { value: '26.94', currency: 'CAD' },
      activityStatus: 'PENDING',
      name: { nameOnCard: 'MYKHAILO DELEGAN' },
      cardNumber: '************8584',
    };

    expect(extractRogersCardholder(tx)).toEqual({
      name: 'MYKHAILO DELEGAN',
      cardLast4: '8584',
    });
  });

  it('extracts name and card last 4 from an APPROVED activity', () => {
    const tx = {
      date: '2026-09-03',
      amount: { value: '37.08', currency: 'CAD' },
      activityStatus: 'APPROVED',
      referenceNumber: '12305016246000016535079',
      name: { nameOnCard: 'MYKHAILO DELEGAN' },
      cardNumber: '************8584',
    };

    expect(extractRogersCardholder(tx)).toEqual({
      name: 'MYKHAILO DELEGAN',
      cardLast4: '8584',
    });
  });

  it('trims surrounding whitespace from the name', () => {
    const tx = { name: { nameOnCard: '  MYKHAILO DELEGAN  ' }, cardNumber: '************8584' };

    expect(extractRogersCardholder(tx).name).toBe('MYKHAILO DELEGAN');
  });

  it('returns a null cardLast4 when cardNumber is missing', () => {
    const tx = { name: { nameOnCard: 'MYKHAILO DELEGAN' } };

    expect(extractRogersCardholder(tx)).toEqual({ name: 'MYKHAILO DELEGAN', cardLast4: null });
  });

  it('distinguishes two cardholders on the same account', () => {
    const first = extractRogersCardholder({
      name: { nameOnCard: 'MYKHAILO DELEGAN' }, cardNumber: '************8584',
    });
    const second = extractRogersCardholder({
      name: { nameOnCard: 'LIUBOV MONSAR' }, cardNumber: '************2142',
    });

    expect(first).toEqual({ name: 'MYKHAILO DELEGAN', cardLast4: '8584' });
    expect(second).toEqual({ name: 'LIUBOV MONSAR', cardLast4: '2142' });
  });

  it.each([
    ['no name object', { cardNumber: '************8584' }],
    ['an empty name object', { name: {}, cardNumber: '************8584' }],
    ['a null nameOnCard', { name: { nameOnCard: null } }],
    ['an empty nameOnCard', { name: { nameOnCard: '' } }],
    ['a whitespace-only nameOnCard', { name: { nameOnCard: '   ' } }],
    ['a non-string nameOnCard', { name: { nameOnCard: 12345 } }],
    ['an empty transaction', {}],
  ])('returns null for a transaction with %s', (_label, tx) => {
    expect(extractRogersCardholder(tx)).toBeNull();
  });

  it('returns null for a null transaction', () => {
    expect(extractRogersCardholder(null)).toBeNull();
  });
});