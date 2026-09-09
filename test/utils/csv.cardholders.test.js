/**
 * Tests for the shared Monarch tag builder and the Owner CSV column
 *
 * The Owner column is matched by Monarch against household member
 * `users[].name`; unrecognised values silently revert to the household
 * default, so an empty value is always safe.
 */

import {
  buildMonarchTags,
  MONARCH_CSV_COLUMNS,
  convertTransactionsToMonarchCSV,
  convertMbnaTransactionsToMonarchCSV,
} from '../../src/utils/csv';

jest.mock('../../src/core/utils', () => ({
  debugLog: jest.fn(),
}));

jest.mock('../../src/mappers/merchant', () => ({
  applyMerchantMapping: jest.fn((merchant) => merchant || 'Unknown Merchant'),
}));

jest.mock('../../src/mappers/category', () => ({
  applyCategoryMapping: jest.fn((category) => category || 'Uncategorized'),
}));

/**
 * Parse a data row into fields keyed by column name.
 *
 * Column-name based rather than positional: columns get appended over time
 * (`Owner`, then `Id`), and positional assertions like `endsWith(',Shared')`
 * silently become assertions about whichever column is last.
 *
 * Values here never contain embedded commas in quoted fields for these
 * fixtures, so a simple split is sufficient and keeps the test readable.
 */
const parseRowAt = (csv, rowIndex = 0) => {
  const [header, ...rows] = csv.split('\n');
  const cols = header.split(',');
  const values = rows[rowIndex].split(',');
  return Object.fromEntries(cols.map((c, i) => [c, values[i]]));
};

describe('MONARCH_CSV_COLUMNS', () => {
  it('ends with Owner followed by Id', () => {
    expect(MONARCH_CSV_COLUMNS.slice(-3)).toEqual(['Tags', 'Owner', 'Id']);
  });

  it('preserves the established column order', () => {
    // `Id` is appended last so every pre-existing index is unchanged. That
    // matters less than it used to — the columnMapping is now derived from the
    // uploaded CSV's header row — but keeping the order stable still avoids
    // gratuitous churn in the generated files.
    expect(MONARCH_CSV_COLUMNS).toEqual([
      'Date',
      'Merchant',
      'Category',
      'Account',
      'Original Statement',
      'Notes',
      'Amount',
      'Tags',
      'Owner',
      'Id',
    ]);
  });
});

describe('buildMonarchTags', () => {
  it('returns an empty string with no inputs', () => {
    expect(buildMonarchTags()).toBe('');
  });

  it('returns an empty string when nothing applies', () => {
    expect(buildMonarchTags({ isPending: false, cardholderTag: null, extraTags: [] })).toBe('');
  });

  it('emits only Pending for a pending transaction', () => {
    expect(buildMonarchTags({ isPending: true })).toBe('Pending');
  });

  it('emits only the cardholder tag for a settled transaction', () => {
    expect(buildMonarchTags({ cardholderTag: 'Mykhailo Delegan' })).toBe('Mykhailo Delegan');
  });

  it('emits Pending before the cardholder tag', () => {
    expect(buildMonarchTags({ isPending: true, cardholderTag: 'Mykhailo Delegan' }))
      .toBe('Pending,Mykhailo Delegan');
  });

  it('appends extra tags after the cardholder tag', () => {
    expect(buildMonarchTags({ isPending: true, cardholderTag: 'Mike', extraTags: ['EUR'] }))
      .toBe('Pending,Mike,EUR');
  });

  it('drops empty and nullish extra tags', () => {
    expect(buildMonarchTags({ isPending: true, extraTags: [null, undefined, '', 'USD'] }))
      .toBe('Pending,USD');
  });

  it('drops an empty cardholder tag', () => {
    expect(buildMonarchTags({ isPending: true, cardholderTag: '' })).toBe('Pending');
  });

  it('de-duplicates repeated tag values', () => {
    expect(buildMonarchTags({ cardholderTag: 'Mike', extraTags: ['Mike'] })).toBe('Mike');
  });
});

describe('Rogers Bank CSV — Owner and cardholder tag', () => {
  const rogersTx = (overrides = {}) => ({
    date: '2026-09-03',
    merchant: { name: 'Klarna* Airbnb CA', categoryDescription: 'Shopping' },
    amount: { value: 37.08 },
    activityType: 'TRANS',
    referenceNumber: '12305016246000016535079',
    resolvedMonarchCategory: 'Shopping',
    ...overrides,
  });

  const parseRow = (csv) => parseRowAt(csv, 0);

  it('writes the resolved Monarch member name into the Owner column', () => {
    const csv = convertTransactionsToMonarchCSV(
      [rogersTx({ cardholderOwner: 'Mykhailo Delegan' })],
      'Rogers Mastercard',
    );

    expect(parseRow(csv).Owner).toBe('Mykhailo Delegan');
  });

  it('writes Shared into the Owner column when the service resolved Shared', () => {
    const csv = convertTransactionsToMonarchCSV(
      [rogersTx({ cardholderOwner: 'Shared' })],
      'Rogers Mastercard',
    );

    expect(parseRow(csv).Owner).toBe('Shared');
  });

  it('leaves Owner empty when owner mapping is disabled', () => {
    const csv = convertTransactionsToMonarchCSV([rogersTx()], 'Rogers Mastercard');

    expect(parseRow(csv).Owner).toBe('');
  });

  it('writes the cardholder label into the Tags column', () => {
    const csv = convertTransactionsToMonarchCSV(
      [rogersTx({ cardholderTag: 'Mykhailo Delegan' })],
      'Rogers Mastercard',
    );

    expect(parseRow(csv).Tags).toBe('Mykhailo Delegan');
  });

  it('emits both Pending and the cardholder tag for a pending transaction', () => {
    const csv = convertTransactionsToMonarchCSV(
      [rogersTx({ isPending: true, pendingId: 'rb-tx:abc123', cardholderTag: 'Mike' })],
      'Rogers Mastercard',
    );

    expect(csv).toContain('"Pending,Mike"');
  });

  it('leaves Tags empty for a settled transaction with no cardholder tag', () => {
    const csv = convertTransactionsToMonarchCSV([rogersTx()], 'Rogers Mastercard');

    expect(parseRow(csv).Tags).toBe('');
  });

  it('tags two cardholders independently', () => {
    const csv = convertTransactionsToMonarchCSV([
      rogersTx({ cardholderTag: 'Mykhailo Delegan', cardholderOwner: 'Mykhailo Delegan' }),
      rogersTx({ cardholderTag: 'Liubov Monsar', cardholderOwner: 'Shared' }),
    ], 'Rogers Mastercard');

    expect(parseRowAt(csv, 0).Tags).toBe('Mykhailo Delegan');
    expect(parseRowAt(csv, 0).Owner).toBe('Mykhailo Delegan');
    expect(parseRowAt(csv, 1).Tags).toBe('Liubov Monsar');
    expect(parseRowAt(csv, 1).Owner).toBe('Shared');
  });
});

describe('MBNA CSV — Owner and cardholder tag', () => {
  const mbnaTx = (overrides = {}) => ({
    date: '2026-05-05',
    merchant: 'Grocery Store',
    originalStatement: 'GROCERY STORE',
    amount: -42.10,
    referenceNumber: '00000406124000533681201',
    resolvedMonarchCategory: 'Groceries',
    ...overrides,
  });

  it('writes the Owner column', () => {
    const csv = convertMbnaTransactionsToMonarchCSV(
      [mbnaTx({ cardholderOwner: 'Mykhailo Delegan' })],
      'MBNA Card',
    );

    expect(parseRowAt(csv).Owner).toBe('Mykhailo Delegan');
  });

  it('writes the cardholder tag', () => {
    const csv = convertMbnaTransactionsToMonarchCSV(
      [mbnaTx({ cardholderTag: 'Liubov Monsar' })],
      'MBNA Card',
    );

    const row = parseRowAt(csv);
    expect(row.Tags).toBe('Liubov Monsar');
    expect(row.Owner).toBe('');
  });

  it('leaves both columns empty when the feature is disabled', () => {
    const csv = convertMbnaTransactionsToMonarchCSV([mbnaTx()], 'MBNA Card');

    const row = parseRowAt(csv);
    expect(row.Tags).toBe('');
    expect(row.Owner).toBe('');
  });

  it('emits both Pending and the cardholder tag for a pending transaction', () => {
    const csv = convertMbnaTransactionsToMonarchCSV(
      [mbnaTx({ isPending: true, pendingId: 'mbna-tx:abc', cardholderTag: 'Mike' })],
      'MBNA Card',
    );

    expect(csv).toContain('"Pending,Mike"');
  });
});