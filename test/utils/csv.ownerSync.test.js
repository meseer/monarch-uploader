/**
 * Tests for the CSV-side half of the owner sync feature
 *
 * Two things must be emitted for a row that needs a post-upload owner update:
 *
 *  1. the `pendingOwnerUpdate` marker tag — how the pass FINDS the row
 *  2. the `{prefix}:{hash}` id in the notes — how the pass IDENTIFIES the row
 *
 * Equally important is the negative case: a user who has not enabled owner
 * mapping must see byte-identical output to before the feature existed.
 */

import {
  buildMonarchTags,
  convertTransactionsToMonarchCSV,
  convertMbnaTransactionsToMonarchCSV,
} from '../../src/utils/csv';

jest.mock('../../src/core/utils', () => ({
  debugLog: jest.fn(),
}));

jest.mock('../../src/mappers/merchant', () => ({
  applyMerchantMapping: jest.fn((m) => m || 'Unknown Merchant'),
}));

jest.mock('../../src/mappers/category', () => ({
  applyCategoryMapping: jest.fn((c) => c || 'Uncategorized'),
}));

const OWNER_ID = '162625044845828370';
const HASH = 'rb-tx:abcdef0123456789';

/**
 * Parse a CSV into rows of field values.
 *
 * Must be quote-aware for BOTH commas and newlines: the Notes column legitimately
 * contains embedded newlines (FX details and the transaction id sit on their own
 * lines), so naively splitting on '\n' would tear a single row apart.
 */
const parseCsv = (csv) => {
  const rows = [];
  let values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < csv.length; i += 1) {
    const ch = csv[i];

    if (ch === '"') {
      if (inQuotes && csv[i + 1] === '"') {
        current += '"';
        i += 1; // escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      values.push(current);
      current = '';
    } else if (ch === '\n' && !inQuotes) {
      values.push(current);
      rows.push(values);
      values = [];
      current = '';
    } else {
      current += ch;
    }
  }

  values.push(current);
  rows.push(values);

  return { header: rows[0], rows: rows.slice(1) };
};

/** Read one named column out of a data row */
const field = (csv, rowIndex, columnName) => {
  const { header, rows } = parseCsv(csv);
  return rows[rowIndex][header.indexOf(columnName)];
};

describe('buildMonarchTags — owner marker', () => {
  it('emits no marker when no owner update is queued', () => {
    expect(buildMonarchTags({ isPending: false })).toBe('');
  });

  it('emits the marker when an owner update is queued', () => {
    expect(buildMonarchTags({ ownerSyncPending: true })).toBe('pendingOwnerUpdate');
  });

  it('emits both markers for a pending row that also needs an owner', () => {
    expect(buildMonarchTags({ isPending: true, ownerSyncPending: true }))
      .toBe('Pending,pendingOwnerUpdate');
  });

  it('keeps the cardholder tag alongside both markers', () => {
    expect(buildMonarchTags({
      isPending: true,
      ownerSyncPending: true,
      cardholderTag: 'Mykhailo Delegan',
    })).toBe('Pending,pendingOwnerUpdate,Mykhailo Delegan');
  });

  it('keeps currency and other extra tags alongside the markers', () => {
    expect(buildMonarchTags({ ownerSyncPending: true, extraTags: ['EUR'] }))
      .toBe('pendingOwnerUpdate,EUR');
  });

  it('does not duplicate the marker', () => {
    expect(buildMonarchTags({ ownerSyncPending: true, extraTags: ['pendingOwnerUpdate'] }))
      .toBe('pendingOwnerUpdate');
  });
});

describe('Rogers Bank CSV — owner sync emission', () => {
  const rogersTx = (overrides = {}) => ({
    date: '2026-09-03',
    merchant: { name: 'Klarna* Airbnb CA', categoryDescription: 'Shopping' },
    amount: { value: 37.08 },
    activityType: 'TRANS',
    referenceNumber: '12305016246000016535079',
    resolvedMonarchCategory: 'Shopping',
    txHashId: HASH,
    ...overrides,
  });

  describe('when owner mapping is off (the default)', () => {
    it('emits no marker tag', () => {
      const csv = convertTransactionsToMonarchCSV([rogersTx()], 'Rogers Mastercard');

      expect(field(csv, 0, 'Tags')).toBe('');
    });

    it('writes NO id into the notes of a settled row', () => {
      // The critical no-regression case: users who have not opted in must see
      // exactly the notes they saw before this feature existed.
      const csv = convertTransactionsToMonarchCSV([rogersTx()], 'Rogers Mastercard');

      expect(field(csv, 0, 'Notes')).toBe('');
      expect(csv).not.toContain(HASH);
    });

    it('still writes the pending id for a pending row', () => {
      const csv = convertTransactionsToMonarchCSV(
        [rogersTx({ isPending: true, pendingId: HASH })],
        'Rogers Mastercard',
      );

      expect(field(csv, 0, 'Notes')).toBe(HASH);
      expect(field(csv, 0, 'Tags')).toBe('Pending');
    });
  });

  describe('when a cardholder resolves to a household member', () => {
    const owned = (extra = {}) => rogersTx({ cardholderOwnerUserId: OWNER_ID, ...extra });

    it('emits the marker tag', () => {
      const csv = convertTransactionsToMonarchCSV([owned()], 'Rogers Mastercard');

      expect(field(csv, 0, 'Tags')).toBe('pendingOwnerUpdate');
    });

    it('writes the hash id into the notes of a SETTLED row', () => {
      // Without this a transaction that settled before its first upload could
      // never be matched back to its cardholder
      const csv = convertTransactionsToMonarchCSV([owned()], 'Rogers Mastercard');

      expect(field(csv, 0, 'Notes')).toBe(HASH);
    });

    it('emits both markers and the id for a PENDING row', () => {
      const csv = convertTransactionsToMonarchCSV(
        [owned({ isPending: true, pendingId: HASH })],
        'Rogers Mastercard',
      );

      expect(field(csv, 0, 'Tags')).toBe('Pending,pendingOwnerUpdate');
      expect(field(csv, 0, 'Notes')).toBe(HASH);
    });

    it('appends the id after existing notes content', () => {
      const csv = convertTransactionsToMonarchCSV(
        [owned()],
        'Rogers Mastercard',
        { storeTransactionDetailsInNotes: true },
      );

      const notes = field(csv, 0, 'Notes');
      expect(notes).toBe(`TRANS / 12305016246000016535079\n${HASH}`);
    });

    it('keeps the Owner column populated for human inspection', () => {
      // Monarch ignores this column; it exists so the generated CSV is readable
      const csv = convertTransactionsToMonarchCSV(
        [owned({ cardholderOwner: 'Mykhailo Delegan' })],
        'Rogers Mastercard',
      );

      expect(field(csv, 0, 'Owner')).toBe('Mykhailo Delegan');
    });

    it('emits the cardholder tag alongside the marker', () => {
      const csv = convertTransactionsToMonarchCSV(
        [owned({ cardholderTag: 'Mykhailo Delegan' })],
        'Rogers Mastercard',
      );

      expect(field(csv, 0, 'Tags')).toBe('pendingOwnerUpdate,Mykhailo Delegan');
    });
  });

  describe('when a cardholder resolves to Shared or is unmapped', () => {
    it('emits NO marker for a Shared cardholder', () => {
      // Shared has no owner to apply, so marking it would queue work that could
      // never complete and would strand the marker forever
      const csv = convertTransactionsToMonarchCSV(
        [rogersTx({ cardholderOwner: 'Shared', cardholderOwnerUserId: null })],
        'Rogers Mastercard',
      );

      expect(field(csv, 0, 'Tags')).toBe('');
      expect(csv).not.toContain(HASH);
    });

    it('still tags a Shared cardholder when tagging is enabled', () => {
      const csv = convertTransactionsToMonarchCSV(
        [rogersTx({ cardholderOwner: 'Shared', cardholderOwnerUserId: null, cardholderTag: 'Liubov Monsar' })],
        'Rogers Mastercard',
      );

      expect(field(csv, 0, 'Tags')).toBe('Liubov Monsar');
    });
  });

  it('marks only the rows that resolved to a member', () => {
    const csv = convertTransactionsToMonarchCSV([
      rogersTx({ cardholderOwnerUserId: OWNER_ID }),
      rogersTx({ cardholderOwnerUserId: null }),
    ], 'Rogers Mastercard');

    expect(field(csv, 0, 'Tags')).toBe('pendingOwnerUpdate');
    expect(field(csv, 1, 'Tags')).toBe('');
  });
});

describe('MBNA CSV — owner sync emission', () => {
  const mbnaTx = (overrides = {}) => ({
    date: '2026-05-05',
    merchant: 'Grocery Store',
    originalStatement: 'GROCERY STORE',
    amount: -42.10,
    referenceNumber: '00000406124000533681201',
    resolvedMonarchCategory: 'Groceries',
    txHashId: 'mbna-tx:abcdef0123456789',
    ...overrides,
  });

  it('emits no marker and no id when owner mapping is off', () => {
    const csv = convertMbnaTransactionsToMonarchCSV([mbnaTx()], 'MBNA Card');

    expect(field(csv, 0, 'Tags')).toBe('');
    expect(field(csv, 0, 'Notes')).toBe('');
  });

  it('emits the marker and the id for an owned settled row', () => {
    const csv = convertMbnaTransactionsToMonarchCSV(
      [mbnaTx({ cardholderOwnerUserId: OWNER_ID })],
      'MBNA Card',
    );

    expect(field(csv, 0, 'Tags')).toBe('pendingOwnerUpdate');
    expect(field(csv, 0, 'Notes')).toBe('mbna-tx:abcdef0123456789');
  });

  it('emits both markers for an owned pending row', () => {
    const csv = convertMbnaTransactionsToMonarchCSV(
      [mbnaTx({ isPending: true, pendingId: 'mbna-tx:abcdef0123456789', cardholderOwnerUserId: OWNER_ID })],
      'MBNA Card',
    );

    expect(field(csv, 0, 'Tags')).toBe('Pending,pendingOwnerUpdate');
  });

  it('emits no marker for a Shared cardholder', () => {
    const csv = convertMbnaTransactionsToMonarchCSV(
      [mbnaTx({ cardholderOwner: 'Shared', cardholderOwnerUserId: null })],
      'MBNA Card',
    );

    expect(field(csv, 0, 'Tags')).toBe('');
  });
});