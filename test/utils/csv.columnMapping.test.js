/**
 * Tests for the Monarch `columnMapping` builder
 *
 * Monarch's statement parser reads ONLY the CSV columns named in this mapping.
 * An unmapped column is silently ignored, but an INVALID key rejects the whole
 * upload:
 *
 *   "Invalid column mapping: 'owned_by_user' is not a valid column.
 *    Valid columns: ['account', 'amount', 'category',
 *    'data_provider_description', 'date', 'id', 'merchant_name', 'notes',
 *    'tags']"
 *
 * So `Owner` must NOT appear in the mapping — the owner is applied after upload
 * by `services/common/ownerSync`. These tests guard both halves: every valid
 * column stays mapped, and Owner stays out.
 *
 * The mapping is also INDEX-based, and not every CSV we upload uses the full
 * canonical column list (Questrade omits `Id`; the Canada Life and MBNA
 * formatters emit 8 columns). It is therefore derived from the uploaded CSV's
 * own header row, and these tests pin that too — mapping an index a CSV does not
 * have would silently corrupt the import.
 */

import {
  buildMonarchColumnMapping,
  extractCSVHeaderColumns,
  MONARCH_CSV_COLUMNS,
  MONARCH_CSV_COLUMNS_WITHOUT_ID,
} from '../../src/utils/csv';

jest.mock('../../src/core/utils', () => ({
  debugLog: jest.fn(),
}));

jest.mock('../../src/mappers/merchant', () => ({
  applyMerchantMapping: jest.fn((m) => m),
}));

jest.mock('../../src/mappers/category', () => ({
  applyCategoryMapping: jest.fn((c) => c),
}));

jest.mock('../../src/core/config', () => ({
  STORAGE: {
    MONARCH_CSV_OWNER_KEY: 'monarch_csv_owner_key',
    MONARCH_CSV_ID_KEY: 'monarch_csv_id_key',
  },
  MONARCH_CSV_FIELD_KEYS: {
    Date: 'date',
    Merchant: 'merchant_name',
    Category: 'category',
    'Original Statement': 'data_provider_description',
    Notes: 'notes',
    Amount: 'amount',
    Tags: 'tags',
  },
  // Empty: Monarch has no owner column. The override plumbing is retained only
  // so the closed avenue can be re-probed if Monarch ever adds one.
  MONARCH_CSV_OWNER_FIELD_KEY: '',
  // `id` IS a valid Monarch column and its importer can match transactions on it.
  MONARCH_CSV_ID_FIELD_KEY: 'id',
  MARKER_TAGS: { PENDING: 'Pending', PENDING_OWNER_UPDATE: 'pendingOwnerUpdate' },
}));

const parseMapping = (columns) => JSON.parse(
  columns === undefined ? buildMonarchColumnMapping() : buildMonarchColumnMapping(columns),
);

beforeEach(() => {
  jest.clearAllMocks();
  // Default: no override stored
  global.GM_getValue = jest.fn((_key, fallback) => fallback);
});

describe('buildMonarchColumnMapping', () => {
  it('returns a JSON string', () => {
    const result = buildMonarchColumnMapping();

    expect(typeof result).toBe('string');
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it('maps each field to the index of its column in MONARCH_CSV_COLUMNS', () => {
    const mapping = parseMapping();

    expect(mapping.date).toBe(MONARCH_CSV_COLUMNS.indexOf('Date'));
    expect(mapping.merchant_name).toBe(MONARCH_CSV_COLUMNS.indexOf('Merchant'));
    expect(mapping.category).toBe(MONARCH_CSV_COLUMNS.indexOf('Category'));
    expect(mapping.data_provider_description).toBe(MONARCH_CSV_COLUMNS.indexOf('Original Statement'));
    expect(mapping.notes).toBe(MONARCH_CSV_COLUMNS.indexOf('Notes'));
    expect(mapping.amount).toBe(MONARCH_CSV_COLUMNS.indexOf('Amount'));
    expect(mapping.tags).toBe(MONARCH_CSV_COLUMNS.indexOf('Tags'));
  });

  it('omits the Owner column, which Monarch rejects as an invalid key', () => {
    const mapping = parseMapping();

    // Any key mapped to the Owner index would fail the whole upload
    expect(Object.values(mapping)).not.toContain(MONARCH_CSV_COLUMNS.indexOf('Owner'));
    expect(mapping.owned_by_user).toBeUndefined();
  });

  it('maps the Id column, which Monarch can match transactions on', () => {
    const mapping = parseMapping();

    expect(mapping.id).toBe(MONARCH_CSV_COLUMNS.indexOf('Id'));
  });

  it('maps only keys Monarch lists as valid', () => {
    // Straight from the importer's own error message
    const validColumns = [
      'account', 'amount', 'category', 'data_provider_description',
      'date', 'id', 'merchant_name', 'notes', 'tags',
    ];

    Object.keys(parseMapping()).forEach((key) => {
      expect(validColumns).toContain(key);
    });
  });

  it('preserves the known-good indices for the pre-existing fields', () => {
    // These were the values in the original hand-written literal; a change here
    // means the column order moved and existing imports would break.
    const mapping = parseMapping();

    expect(mapping).toMatchObject({
      date: 0,
      merchant_name: 1,
      category: 2,
      data_provider_description: 4,
      notes: 5,
      amount: 6,
      tags: 7,
    });
  });

  it('intentionally omits Account, which is passed separately as accountId', () => {
    const mapping = parseMapping();

    expect(Object.values(mapping)).not.toContain(MONARCH_CSV_COLUMNS.indexOf('Account'));
  });

  it('maps every index to exactly one field', () => {
    const indices = Object.values(parseMapping());

    expect(new Set(indices).size).toBe(indices.length);
  });

  describe('header-derived mapping', () => {
    // The mapping is index-based, so it must describe the columns of the CSV
    // being uploaded. Deriving it from a shared constant would point at indices
    // that shorter CSVs do not have.
    it('maps against the supplied columns rather than the canonical list', () => {
      const columns = ['Amount', 'Date', 'Notes'];

      expect(parseMapping(columns)).toEqual({ amount: 0, date: 1, notes: 2 });
    });

    it('omits Id when the CSV has no Id column (the Questrade case)', () => {
      const mapping = parseMapping(MONARCH_CSV_COLUMNS_WITHOUT_ID);

      expect(mapping.id).toBeUndefined();
      // Every other field must still map, at its own (unshifted) index
      expect(mapping.tags).toBe(MONARCH_CSV_COLUMNS_WITHOUT_ID.indexOf('Tags'));
    });

    it('never maps an index beyond the supplied column count', () => {
      // This is the corruption the header-derived mapping exists to prevent:
      // an 8-column CSV must never be told `id` lives at index 9.
      const eightColumnCsv = [
        'Date', 'Merchant', 'Category', 'Account',
        'Original Statement', 'Notes', 'Amount', 'Tags',
      ];

      Object.values(parseMapping(eightColumnCsv)).forEach((index) => {
        expect(index).toBeLessThan(eightColumnCsv.length);
      });
    });

    it('falls back to the canonical list when given an empty column array', () => {
      expect(parseMapping([])).toEqual(parseMapping(MONARCH_CSV_COLUMNS));
    });

    it('ignores columns Monarch does not recognise', () => {
      const mapping = parseMapping(['Date', 'Something Invented', 'Amount']);

      expect(mapping).toEqual({ date: 0, amount: 2 });
    });
  });

  describe('extractCSVHeaderColumns', () => {
    it('reads the header row of a CSV', () => {
      const csv = 'Date,Merchant,Amount\n2026-01-01,Amazon,-10';

      expect(extractCSVHeaderColumns(csv)).toEqual(['Date', 'Merchant', 'Amount']);
    });

    it('handles quoted header fields', () => {
      const csv = '"Date","Original Statement","Amount"\n2026-01-01,X,-10';

      expect(extractCSVHeaderColumns(csv)).toEqual(['Date', 'Original Statement', 'Amount']);
    });

    it('returns null for empty or missing input so callers can fall back', () => {
      expect(extractCSVHeaderColumns('')).toBeNull();
      expect(extractCSVHeaderColumns(null)).toBeNull();
      expect(extractCSVHeaderColumns(undefined)).toBeNull();
    });

    it('round-trips the canonical column list', () => {
      const csv = `${MONARCH_CSV_COLUMNS.join(',')}\n`;

      expect(extractCSVHeaderColumns(csv)).toEqual(MONARCH_CSV_COLUMNS);
    });
  });

  describe('Id key override (kill-switch)', () => {
    it('omits Id entirely when the override is an empty string', () => {
      // The kill-switch: stops native id matching without a rebuild.
      global.GM_getValue = jest.fn((key) => (key === 'monarch_csv_id_key' ? '' : undefined));

      const mapping = parseMapping();

      expect(mapping.id).toBeUndefined();
      expect(Object.values(mapping)).not.toContain(MONARCH_CSV_COLUMNS.indexOf('Id'));
    });

    it('still maps every other field when Id is disabled', () => {
      global.GM_getValue = jest.fn((key) => (key === 'monarch_csv_id_key' ? '' : undefined));

      const mapping = parseMapping();

      expect(Object.keys(mapping).sort()).toEqual([
        'amount',
        'category',
        'data_provider_description',
        'date',
        'merchant_name',
        'notes',
        'tags',
      ]);
    });

    it('uses a stored override key when present', () => {
      global.GM_getValue = jest.fn((key) => (key === 'monarch_csv_id_key' ? 'transaction_id' : undefined));

      const mapping = parseMapping();

      expect(mapping.transaction_id).toBe(MONARCH_CSV_COLUMNS.indexOf('Id'));
      expect(mapping.id).toBeUndefined();
    });

    it('reads the override from the documented storage key', () => {
      buildMonarchColumnMapping();

      expect(global.GM_getValue).toHaveBeenCalledWith('monarch_csv_id_key', undefined);
    });

    it('falls back to the default when storage throws', () => {
      global.GM_getValue = jest.fn(() => {
        throw new Error('storage unavailable');
      });

      // Unlike Owner, defaulting Id ON is safe: `id` is a documented valid
      // column, so mapping it cannot fail the upload.
      expect(parseMapping().id).toBe(MONARCH_CSV_COLUMNS.indexOf('Id'));
    });
  });

  describe('Owner key override', () => {
    it('uses the stored override key when present', () => {
      // The escape hatch for re-probing if Monarch ever adds an owner column.
      // Keyed deliberately: Owner and Id are both overridable, so a mock that
      // answers every key with the same value would have them collide.
      global.GM_getValue = jest.fn((key) => (key === 'monarch_csv_owner_key' ? 'owner' : undefined));

      const mapping = parseMapping();

      expect(mapping.owner).toBe(MONARCH_CSV_COLUMNS.indexOf('Owner'));
    });

    it('reads the override from the documented storage key', () => {
      global.GM_getValue = jest.fn((_key, fallback) => fallback);

      buildMonarchColumnMapping();

      expect(global.GM_getValue).toHaveBeenCalledWith('monarch_csv_owner_key', undefined);
    });

    it('omits Owner entirely when the override is an empty string', () => {
      global.GM_getValue = jest.fn(() => '');

      const mapping = parseMapping();

      expect(Object.values(mapping)).not.toContain(MONARCH_CSV_COLUMNS.indexOf('Owner'));
    });

    it('still maps the other fields when Owner is omitted', () => {
      // '' for every key disables Id as well, leaving only the static fields
      global.GM_getValue = jest.fn(() => '');

      const mapping = parseMapping();

      expect(Object.keys(mapping).sort()).toEqual([
        'amount',
        'category',
        'data_provider_description',
        'date',
        'merchant_name',
        'notes',
        'tags',
      ]);
    });

    it('falls back to the safe default (no Owner) when storage throws', () => {
      global.GM_getValue = jest.fn(() => {
        throw new Error('storage unavailable');
      });

      const mapping = parseMapping();

      // Failing closed matters here: mapping Owner would break every upload
      expect(Object.values(mapping)).not.toContain(MONARCH_CSV_COLUMNS.indexOf('Owner'));
    });

    it('lets a later column win if both overrides are set to the same key', () => {
      // Not a scenario we create, but worth pinning: the mapping is keyed by
      // Monarch field name, so two columns sharing a key collapse to one entry
      // rather than producing something malformed.
      global.GM_getValue = jest.fn(() => 'id');

      const mapping = parseMapping();

      expect(mapping.id).toBe(MONARCH_CSV_COLUMNS.indexOf('Id'));
    });
  });
});