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
 */

import { buildMonarchColumnMapping, MONARCH_CSV_COLUMNS } from '../../src/utils/csv';

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
  STORAGE: { MONARCH_CSV_OWNER_KEY: 'monarch_csv_owner_key' },
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
}));

const parseMapping = () => JSON.parse(buildMonarchColumnMapping());

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

  describe('Owner key override', () => {
    it('uses the stored override key when present', () => {
      // The escape hatch for re-probing if Monarch ever adds an owner column
      global.GM_getValue = jest.fn(() => 'owner');

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
  });
});