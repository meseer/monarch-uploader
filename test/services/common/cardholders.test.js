/**
 * Tests for the generic cardholder service
 *
 * Covers discovery, additive merge, mode decisions (including the `auto` tag
 * behaviour driven by the cumulative persisted map), member-name refresh,
 * prompt orchestration, and the owner/tag annotations consumed by the CSV
 * converters.
 */

import {
  collectCardholders,
  mergeCardholders,
  getOwnerMode,
  getTagMode,
  shouldTagCardholders,
  refreshMemberNames,
  getUnmappedCardholders,
  promptForUnmappedCardholders,
  resolveOwner,
  resolveTag,
  applyCardholderFields,
  syncCardholders,
} from '../../../src/services/common/cardholders';

jest.mock('../../../src/core/utils', () => ({
  debugLog: jest.fn(),
  toTitleCase: jest.fn((name) => {
    if (!name) return '';
    return name.toLowerCase().replace(/(^|[\s\-'])([a-z])/g, (_m, p, l) => p + l.toUpperCase());
  }),
}));

jest.mock('../../../src/core/config', () => ({
  CARDHOLDER: {
    SHARED_OWNER: 'Shared',
    OWNER_MODE: { OFF: 'off', ON: 'on' },
    TAG_MODE: { OFF: 'off', AUTO: 'auto', ALWAYS: 'always' },
  },
}));

jest.mock('../../../src/core/integrationCapabilities', () => ({
  ACCOUNT_SETTINGS: {
    CARDHOLDER_OWNER_MODE: 'cardholderOwnerMode',
    CARDHOLDER_TAG_MODE: 'cardholderTagMode',
  },
  getSettingDefault: jest.fn(() => undefined),
  hasCapability: jest.fn(() => true),
}));

jest.mock('../../../src/services/common/accountService', () => ({
  __esModule: true,
  default: {
    getAccountData: jest.fn(() => ({})),
    updateAccountInList: jest.fn(() => true),
  },
}));

jest.mock('../../../src/api/monarchHousehold', () => ({
  getHouseholdMembers: jest.fn(() => Promise.resolve({
    currentUserId: 'user-1',
    householdId: 'hh-1',
    members: [],
  })),
}));

jest.mock('../../../src/services/common/cardholderMatching', () => ({
  findBestMemberMatch: jest.fn(() => null),
}));

const accountService = require('../../../src/services/common/accountService').default;
const { getHouseholdMembers } = require('../../../src/api/monarchHousehold');
const { hasCapability, getSettingDefault } = require('../../../src/core/integrationCapabilities');
const { findBestMemberMatch } = require('../../../src/services/common/cardholderMatching');

// ── Fixtures ────────────────────────────────────────────────

/** Rogers-shaped extractor (name.nameOnCard + masked cardNumber) */
const rogersExtract = (tx) => {
  const raw = tx?.name?.nameOnCard;
  if (!raw) return null;
  const digits = typeof tx.cardNumber === 'string' ? tx.cardNumber.replace(/\D/g, '') : '';
  return { name: raw, cardLast4: digits ? digits.slice(-4) : null };
};

const rogersTx = (nameOnCard, cardNumber = '************8584') => ({
  name: nameOnCard ? { nameOnCard } : undefined,
  cardNumber,
});

const entry = (overrides = {}) => ({
  label: 'Mykhailo Delegan',
  cardLast4: '8584',
  firstSeen: '2026-09-04',
  monarchUserId: null,
  monarchUserName: null,
  isShared: false,
  matchType: 'unresolved',
  ...overrides,
});

const member = (overrides = {}) => ({
  id: 'user-1',
  name: 'Mykhailo Delegan',
  displayName: 'Mykhailo',
  householdRole: 'OWNER',
  profilePictureUrl: null,
  avatarColor: null,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  hasCapability.mockReturnValue(true);
  getSettingDefault.mockReturnValue(undefined);
  accountService.getAccountData.mockReturnValue({});
  accountService.updateAccountInList.mockReturnValue(true);
  getHouseholdMembers.mockResolvedValue({ currentUserId: 'user-1', householdId: 'hh-1', members: [] });
  findBestMemberMatch.mockReturnValue(null);
});

// ── collectCardholders ──────────────────────────────────────

describe('collectCardholders', () => {
  it('discovers a single cardholder with its card last 4', () => {
    const result = collectCardholders([rogersTx('MYKHAILO DELEGAN')], rogersExtract);

    expect(result).toEqual({
      'MYKHAILO DELEGAN': { name: 'MYKHAILO DELEGAN', cardLast4: '8584' },
    });
  });

  it('discovers multiple distinct cardholders', () => {
    const result = collectCardholders([
      rogersTx('MYKHAILO DELEGAN', '************8584'),
      rogersTx('LIUBOV MONSAR', '************2142'),
      rogersTx('MYKHAILO DELEGAN', '************8584'),
    ], rogersExtract);

    expect(Object.keys(result).sort()).toEqual(['LIUBOV MONSAR', 'MYKHAILO DELEGAN']);
    expect(result['LIUBOV MONSAR'].cardLast4).toBe('2142');
  });

  it('backfills cardLast4 from a later transaction when the first lacks it', () => {
    const result = collectCardholders([
      rogersTx('MYKHAILO DELEGAN', null),
      rogersTx('MYKHAILO DELEGAN', '************8584'),
    ], rogersExtract);

    expect(result['MYKHAILO DELEGAN'].cardLast4).toBe('8584');
  });

  it('ignores transactions with no cardholder name', () => {
    const result = collectCardholders([rogersTx(null), { description: 'PAYMENT' }], rogersExtract);

    expect(result).toEqual({});
  });

  it('trims surrounding whitespace from the cardholder key', () => {
    const result = collectCardholders([rogersTx('  MYKHAILO DELEGAN  ')], rogersExtract);

    expect(Object.keys(result)).toEqual(['MYKHAILO DELEGAN']);
  });

  it('skips transactions where the extractor throws rather than aborting', () => {
    const throwingExtract = (tx) => {
      if (tx.bad) throw new Error('boom');
      return rogersExtract(tx);
    };

    const result = collectCardholders([
      { bad: true },
      rogersTx('MYKHAILO DELEGAN'),
    ], throwingExtract);

    expect(Object.keys(result)).toEqual(['MYKHAILO DELEGAN']);
  });

  it('returns an empty map for a non-array input', () => {
    expect(collectCardholders(null, rogersExtract)).toEqual({});
  });

  it('returns an empty map when no extractor is provided', () => {
    expect(collectCardholders([rogersTx('MYKHAILO DELEGAN')], undefined)).toEqual({});
  });
});

// ── mergeCardholders ────────────────────────────────────────

describe('mergeCardholders', () => {
  it('creates a new entry with a title-cased label and unresolved mapping', () => {
    const { cardholders, newlyDiscovered } = mergeCardholders(
      {},
      { 'MYKHAILO DELEGAN': { name: 'MYKHAILO DELEGAN', cardLast4: '8584' } },
      '2026-09-04',
    );

    expect(newlyDiscovered).toEqual(['MYKHAILO DELEGAN']);
    expect(cardholders['MYKHAILO DELEGAN']).toEqual({
      label: 'Mykhailo Delegan',
      cardLast4: '8584',
      firstSeen: '2026-09-04',
      monarchUserId: null,
      monarchUserName: null,
      isShared: false,
      matchType: 'unresolved',
    });
  });

  it('never overwrites a user-edited label', () => {
    const existing = { 'MYKHAILO DELEGAN': entry({ label: 'Mike' }) };

    const { cardholders, newlyDiscovered } = mergeCardholders(
      existing,
      { 'MYKHAILO DELEGAN': { name: 'MYKHAILO DELEGAN', cardLast4: '8584' } },
      '2026-10-01',
    );

    expect(cardholders['MYKHAILO DELEGAN'].label).toBe('Mike');
    expect(newlyDiscovered).toEqual([]);
  });

  it('never overwrites an existing manual member mapping', () => {
    const existing = {
      'MYKHAILO DELEGAN': entry({
        monarchUserId: 'user-1', monarchUserName: 'Mykhailo Delegan', matchType: 'manual',
      }),
    };

    const { cardholders } = mergeCardholders(
      existing,
      { 'MYKHAILO DELEGAN': { name: 'MYKHAILO DELEGAN', cardLast4: '8584' } },
      '2026-10-01',
    );

    expect(cardholders['MYKHAILO DELEGAN'].monarchUserId).toBe('user-1');
    expect(cardholders['MYKHAILO DELEGAN'].matchType).toBe('manual');
  });

  it('preserves the original firstSeen date on re-discovery', () => {
    const existing = { 'MYKHAILO DELEGAN': entry({ firstSeen: '2026-01-01' }) };

    const { cardholders } = mergeCardholders(
      existing,
      { 'MYKHAILO DELEGAN': { name: 'MYKHAILO DELEGAN', cardLast4: '8584' } },
      '2026-10-01',
    );

    expect(cardholders['MYKHAILO DELEGAN'].firstSeen).toBe('2026-01-01');
  });

  it('backfills a missing cardLast4 on an existing entry', () => {
    const existing = { 'MYKHAILO DELEGAN': entry({ cardLast4: null }) };

    const { cardholders } = mergeCardholders(
      existing,
      { 'MYKHAILO DELEGAN': { name: 'MYKHAILO DELEGAN', cardLast4: '8584' } },
      '2026-10-01',
    );

    expect(cardholders['MYKHAILO DELEGAN'].cardLast4).toBe('8584');
  });

  it('keeps previously known cardholders that are absent from this sync', () => {
    const existing = { 'LIUBOV MONSAR': entry({ label: 'Liubov Monsar', cardLast4: '2142' }) };

    const { cardholders } = mergeCardholders(
      existing,
      { 'MYKHAILO DELEGAN': { name: 'MYKHAILO DELEGAN', cardLast4: '8584' } },
      '2026-10-01',
    );

    expect(Object.keys(cardholders).sort()).toEqual(['LIUBOV MONSAR', 'MYKHAILO DELEGAN']);
  });

  it('handles a null existing map', () => {
    const { cardholders } = mergeCardholders(
      null,
      { 'MYKHAILO DELEGAN': { name: 'MYKHAILO DELEGAN', cardLast4: '8584' } },
      '2026-09-04',
    );

    expect(Object.keys(cardholders)).toEqual(['MYKHAILO DELEGAN']);
  });
});

// ── Mode decisions ──────────────────────────────────────────

describe('getOwnerMode / getTagMode', () => {
  it('reads the stored per-account owner mode', () => {
    accountService.getAccountData.mockReturnValue({ cardholderOwnerMode: 'on' });

    expect(getOwnerMode('rogersbank', 'acc-1')).toBe('on');
  });

  it('falls back to the integration default owner mode', () => {
    accountService.getAccountData.mockReturnValue({});
    getSettingDefault.mockReturnValue('on');

    expect(getOwnerMode('rogersbank', 'acc-1')).toBe('on');
  });

  it('falls back to off when neither stored value nor default exists', () => {
    accountService.getAccountData.mockReturnValue({});
    getSettingDefault.mockReturnValue(undefined);

    expect(getOwnerMode('rogersbank', 'acc-1')).toBe('off');
  });

  it('reads the stored per-account tag mode', () => {
    accountService.getAccountData.mockReturnValue({ cardholderTagMode: 'always' });

    expect(getTagMode('rogersbank', 'acc-1')).toBe('always');
  });

  it('falls back to off for the tag mode', () => {
    accountService.getAccountData.mockReturnValue({});
    getSettingDefault.mockReturnValue(undefined);

    expect(getTagMode('rogersbank', 'acc-1')).toBe('off');
  });
});

describe('shouldTagCardholders', () => {
  const one = { A: entry() };
  const two = { A: entry(), B: entry() };

  it('never tags when mode is off, even with multiple cardholders', () => {
    expect(shouldTagCardholders('off', two)).toBe(false);
  });

  it('always tags when mode is always, even with a single cardholder', () => {
    expect(shouldTagCardholders('always', one)).toBe(true);
  });

  it('does not tag in auto mode with a single cardholder', () => {
    expect(shouldTagCardholders('auto', one)).toBe(false);
  });

  it('tags in auto mode once two cardholders are known', () => {
    expect(shouldTagCardholders('auto', two)).toBe(true);
  });

  it('does not tag in auto mode with an empty map', () => {
    expect(shouldTagCardholders('auto', {})).toBe(false);
  });

  it('tolerates a null map', () => {
    expect(shouldTagCardholders('auto', null)).toBe(false);
  });
});

// ── refreshMemberNames ──────────────────────────────────────

describe('refreshMemberNames', () => {
  it('updates a stale cached member name', () => {
    const cardholders = {
      A: entry({ monarchUserId: 'user-1', monarchUserName: 'Old Name', matchType: 'manual' }),
    };

    const result = refreshMemberNames(cardholders, [member({ id: 'user-1', name: 'New Name' })]);

    expect(result.changed).toBe(true);
    expect(result.cardholders.A.monarchUserName).toBe('New Name');
    expect(result.cardholders.A.matchType).toBe('manual');
  });

  it('reports no change when the cached name still matches', () => {
    const cardholders = {
      A: entry({ monarchUserId: 'user-1', monarchUserName: 'Mykhailo Delegan' }),
    };

    const result = refreshMemberNames(cardholders, [member()]);

    expect(result.changed).toBe(false);
  });

  it('reverts to unresolved when the mapped member left the household', () => {
    const cardholders = {
      A: entry({ monarchUserId: 'gone', monarchUserName: 'Gone Person', matchType: 'manual' }),
    };

    const result = refreshMemberNames(cardholders, [member()]);

    expect(result.changed).toBe(true);
    expect(result.cardholders.A).toMatchObject({
      monarchUserId: null,
      monarchUserName: null,
      isShared: false,
      matchType: 'unresolved',
    });
  });

  it('leaves unmapped and explicitly-Shared entries untouched', () => {
    const cardholders = {
      unmapped: entry(),
      shared: entry({ isShared: true, matchType: 'manual' }),
    };

    const result = refreshMemberNames(cardholders, [member()]);

    expect(result.changed).toBe(false);
    expect(result.cardholders.shared.isShared).toBe(true);
  });
});

// ── getUnmappedCardholders ──────────────────────────────────

describe('getUnmappedCardholders', () => {
  it('returns only cardholders with neither a member nor an explicit Shared choice', () => {
    const cardholders = {
      mapped: entry({ monarchUserId: 'user-1', monarchUserName: 'Mykhailo Delegan' }),
      shared: entry({ isShared: true, matchType: 'manual' }),
      unmapped: entry(),
    };

    expect(getUnmappedCardholders(cardholders)).toEqual(['unmapped']);
  });

  it('returns an empty array for a null map', () => {
    expect(getUnmappedCardholders(null)).toEqual([]);
  });
});

// ── promptForUnmappedCardholders ────────────────────────────

describe('promptForUnmappedCardholders', () => {
  it('does not prompt when everything is already mapped', async () => {
    const prompt = jest.fn();
    const cardholders = { A: entry({ monarchUserId: 'user-1', monarchUserName: 'Mykhailo Delegan' }) };

    const result = await promptForUnmappedCardholders(cardholders, [member()], prompt);

    expect(prompt).not.toHaveBeenCalled();
    expect(result.changed).toBe(false);
  });

  it('persists a selected member as a manual mapping', async () => {
    const prompt = jest.fn(() => Promise.resolve({ member: member() }));
    const cardholders = { 'MYKHAILO DELEGAN': entry() };

    const result = await promptForUnmappedCardholders(cardholders, [member()], prompt);

    expect(result.changed).toBe(true);
    expect(result.cardholders['MYKHAILO DELEGAN']).toMatchObject({
      monarchUserId: 'user-1',
      monarchUserName: 'Mykhailo Delegan',
      isShared: false,
      matchType: 'manual',
    });
  });

  it('persists an explicit Shared choice so the user is not asked again', async () => {
    const prompt = jest.fn(() => Promise.resolve({ member: null }));
    const cardholders = { 'MYKHAILO DELEGAN': entry() };

    const result = await promptForUnmappedCardholders(cardholders, [member()], prompt);

    expect(result.cardholders['MYKHAILO DELEGAN']).toMatchObject({
      monarchUserId: null,
      monarchUserName: null,
      isShared: true,
      matchType: 'manual',
    });
  });

  it('does NOT persist anything when the prompt is cancelled', async () => {
    const prompt = jest.fn(() => Promise.resolve(null));
    const cardholders = { 'MYKHAILO DELEGAN': entry() };

    const result = await promptForUnmappedCardholders(cardholders, [member()], prompt);

    expect(result.changed).toBe(false);
    expect(result.cardholders['MYKHAILO DELEGAN'].isShared).toBe(false);
    expect(result.cardholders['MYKHAILO DELEGAN'].matchType).toBe('unresolved');
  });

  it('passes the suggested match to the prompt for pre-selection', async () => {
    findBestMemberMatch.mockReturnValue({ member: member(), matchType: 'exact-name' });
    const prompt = jest.fn(() => Promise.resolve({ member: member() }));

    await promptForUnmappedCardholders({ 'MYKHAILO DELEGAN': entry() }, [member()], prompt);

    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({
      cardholderName: 'MYKHAILO DELEGAN',
      cardLast4: '8584',
      suggestedMemberId: 'user-1',
      suggestedMatchType: 'exact-name',
    }));
  });

  it('passes a null suggestion when nothing matched', async () => {
    findBestMemberMatch.mockReturnValue(null);
    const prompt = jest.fn(() => Promise.resolve({ member: null }));

    await promptForUnmappedCardholders({ 'LIUBOV MONSAR': entry() }, [member()], prompt);

    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({
      suggestedMemberId: null,
      suggestedMatchType: null,
    }));
  });

  it('continues to the next cardholder when a prompt rejects', async () => {
    const prompt = jest.fn()
      .mockRejectedValueOnce(new Error('render failed'))
      .mockResolvedValueOnce({ member: member() });

    const cardholders = { A: entry(), B: entry() };
    const result = await promptForUnmappedCardholders(cardholders, [member()], prompt);

    expect(prompt).toHaveBeenCalledTimes(2);
    expect(result.changed).toBe(true);
  });

  it('prompts once per unmapped cardholder', async () => {
    const prompt = jest.fn(() => Promise.resolve({ member: null }));
    const cardholders = { A: entry(), B: entry(), C: entry() };

    await promptForUnmappedCardholders(cardholders, [member()], prompt);

    expect(prompt).toHaveBeenCalledTimes(3);
  });
});

// ── resolveOwner / resolveTag ───────────────────────────────

describe('resolveOwner', () => {
  it('returns the cached Monarch member name for a mapped cardholder', () => {
    const cardholders = {
      'MYKHAILO DELEGAN': entry({ monarchUserId: 'user-1', monarchUserName: 'Mykhailo Delegan' }),
    };

    expect(resolveOwner(rogersTx('MYKHAILO DELEGAN'), cardholders, rogersExtract))
      .toBe('Mykhailo Delegan');
  });

  it('returns Shared for an unmapped cardholder', () => {
    expect(resolveOwner(rogersTx('MYKHAILO DELEGAN'), { 'MYKHAILO DELEGAN': entry() }, rogersExtract))
      .toBe('Shared');
  });

  it('returns Shared for an explicitly Shared cardholder', () => {
    const cardholders = { 'MYKHAILO DELEGAN': entry({ isShared: true, matchType: 'manual' }) };

    expect(resolveOwner(rogersTx('MYKHAILO DELEGAN'), cardholders, rogersExtract)).toBe('Shared');
  });

  it('returns Shared for a transaction with no cardholder (e.g. a payment)', () => {
    expect(resolveOwner({ description: 'PAYMENT' }, {}, rogersExtract)).toBe('Shared');
  });

  it('returns Shared for a cardholder absent from the map', () => {
    expect(resolveOwner(rogersTx('UNKNOWN PERSON'), {}, rogersExtract)).toBe('Shared');
  });

  it('returns Shared when the extractor throws', () => {
    const throwing = () => { throw new Error('boom'); };

    expect(resolveOwner(rogersTx('MYKHAILO DELEGAN'), {}, throwing)).toBe('Shared');
  });
});

describe('resolveTag', () => {
  it('returns the stored label', () => {
    const cardholders = { 'MYKHAILO DELEGAN': entry({ label: 'Mike' }) };

    expect(resolveTag(rogersTx('MYKHAILO DELEGAN'), cardholders, rogersExtract)).toBe('Mike');
  });

  it('falls back to a title-cased name when the cardholder is not in the map', () => {
    expect(resolveTag(rogersTx('MYKHAILO DELEGAN'), {}, rogersExtract)).toBe('Mykhailo Delegan');
  });

  it('returns an empty string when there is no cardholder', () => {
    expect(resolveTag({ description: 'PAYMENT' }, {}, rogersExtract)).toBe('');
  });

  it('returns an empty string when the extractor throws', () => {
    const throwing = () => { throw new Error('boom'); };

    expect(resolveTag(rogersTx('MYKHAILO DELEGAN'), {}, throwing)).toBe('');
  });
});

// ── applyCardholderFields ───────────────────────────────────

describe('applyCardholderFields', () => {
  const cardholders = {
    'MYKHAILO DELEGAN': entry({ monarchUserId: 'user-1', monarchUserName: 'Mykhailo Delegan', label: 'Mike' }),
  };

  it('adds only the owner field when tagging is disabled', () => {
    const [result] = applyCardholderFields([rogersTx('MYKHAILO DELEGAN')], {
      cardholders, extract: rogersExtract, shouldTag: false, shouldMapOwner: true,
    });

    expect(result.cardholderOwner).toBe('Mykhailo Delegan');
    expect(result.cardholderTag).toBeUndefined();
  });

  it('adds only the tag field when owner mapping is disabled', () => {
    const [result] = applyCardholderFields([rogersTx('MYKHAILO DELEGAN')], {
      cardholders, extract: rogersExtract, shouldTag: true, shouldMapOwner: false,
    });

    expect(result.cardholderTag).toBe('Mike');
    expect(result.cardholderOwner).toBeUndefined();
  });

  it('adds both fields when both features are enabled', () => {
    const [result] = applyCardholderFields([rogersTx('MYKHAILO DELEGAN')], {
      cardholders, extract: rogersExtract, shouldTag: true, shouldMapOwner: true,
    });

    expect(result).toMatchObject({ cardholderOwner: 'Mykhailo Delegan', cardholderTag: 'Mike' });
  });

  it('returns the input untouched when both features are disabled', () => {
    const input = [rogersTx('MYKHAILO DELEGAN')];
    const result = applyCardholderFields(input, {
      cardholders, extract: rogersExtract, shouldTag: false, shouldMapOwner: false,
    });

    expect(result).toBe(input);
  });

  it('does not mutate the input transactions', () => {
    const input = [rogersTx('MYKHAILO DELEGAN')];
    applyCardholderFields(input, {
      cardholders, extract: rogersExtract, shouldTag: true, shouldMapOwner: true,
    });

    expect(input[0].cardholderOwner).toBeUndefined();
    expect(input[0].cardholderTag).toBeUndefined();
  });

  it('preserves existing transaction fields', () => {
    const [result] = applyCardholderFields(
      [{ ...rogersTx('MYKHAILO DELEGAN'), isPending: true, pendingId: 'rb-tx:abc' }],
      {
        cardholders, extract: rogersExtract, shouldTag: true, shouldMapOwner: true,
      },
    );

    expect(result).toMatchObject({ isPending: true, pendingId: 'rb-tx:abc' });
  });
});

// ── syncCardholders ─────────────────────────────────────────

describe('syncCardholders', () => {
  const baseParams = {
    integrationId: 'rogersbank',
    accountId: 'acc-1',
    transactions: [rogersTx('MYKHAILO DELEGAN')],
    extract: rogersExtract,
    today: '2026-09-04',
  };

  it('returns inactive without touching storage when the integration lacks the capability', async () => {
    hasCapability.mockReturnValue(false);

    const result = await syncCardholders(baseParams);

    expect(result).toEqual({ cardholders: {}, shouldTag: false, shouldMapOwner: false });
    expect(accountService.updateAccountInList).not.toHaveBeenCalled();
  });

  it('returns inactive when no extractor is provided', async () => {
    const result = await syncCardholders({ ...baseParams, extract: undefined });

    expect(result.shouldTag).toBe(false);
    expect(result.shouldMapOwner).toBe(false);
  });

  it('skips all work when both modes are off', async () => {
    accountService.getAccountData.mockReturnValue({ cardholderOwnerMode: 'off', cardholderTagMode: 'off' });

    const result = await syncCardholders(baseParams);

    expect(result).toEqual({ cardholders: {}, shouldTag: false, shouldMapOwner: false });
    expect(accountService.updateAccountInList).not.toHaveBeenCalled();
    expect(getHouseholdMembers).not.toHaveBeenCalled();
  });

  it('discovers and persists cardholders when tagging is enabled', async () => {
    accountService.getAccountData.mockReturnValue({ cardholderOwnerMode: 'off', cardholderTagMode: 'always' });

    const result = await syncCardholders(baseParams);

    expect(result.shouldTag).toBe(true);
    expect(result.cardholders['MYKHAILO DELEGAN']).toBeDefined();
    expect(accountService.updateAccountInList).toHaveBeenCalledWith('rogersbank', 'acc-1', {
      cardholders: expect.objectContaining({ 'MYKHAILO DELEGAN': expect.any(Object) }),
    });
  });

  it('does not fetch household members when owner mapping is off', async () => {
    accountService.getAccountData.mockReturnValue({ cardholderOwnerMode: 'off', cardholderTagMode: 'always' });

    await syncCardholders(baseParams);

    expect(getHouseholdMembers).not.toHaveBeenCalled();
  });

  it('fetches household members and prompts when owner mapping is on', async () => {
    accountService.getAccountData.mockReturnValue({ cardholderOwnerMode: 'on', cardholderTagMode: 'off' });
    getHouseholdMembers.mockResolvedValue({ currentUserId: 'user-1', householdId: 'hh-1', members: [member()] });
    findBestMemberMatch.mockReturnValue({ member: member(), matchType: 'exact-name' });
    const promptForMember = jest.fn(() => Promise.resolve({ member: member() }));

    const result = await syncCardholders({ ...baseParams, promptForMember });

    expect(getHouseholdMembers).toHaveBeenCalled();
    expect(promptForMember).toHaveBeenCalled();
    expect(result.shouldMapOwner).toBe(true);
    expect(result.cardholders['MYKHAILO DELEGAN'].monarchUserName).toBe('Mykhailo Delegan');
  });

  it('does not prompt for an already-mapped cardholder', async () => {
    accountService.getAccountData.mockReturnValue({
      cardholderOwnerMode: 'on',
      cardholderTagMode: 'off',
      cardholders: {
        'MYKHAILO DELEGAN': entry({ monarchUserId: 'user-1', monarchUserName: 'Mykhailo Delegan', matchType: 'manual' }),
      },
    });
    getHouseholdMembers.mockResolvedValue({ currentUserId: 'user-1', householdId: 'hh-1', members: [member()] });
    const promptForMember = jest.fn();

    await syncCardholders({ ...baseParams, promptForMember });

    expect(promptForMember).not.toHaveBeenCalled();
  });

  it('degrades to Shared and still persists when the household fetch fails', async () => {
    accountService.getAccountData.mockReturnValue({ cardholderOwnerMode: 'on', cardholderTagMode: 'off' });
    getHouseholdMembers.mockRejectedValue(new Error('network down'));

    const result = await syncCardholders(baseParams);

    expect(result.shouldMapOwner).toBe(true);
    expect(result.cardholders['MYKHAILO DELEGAN'].monarchUserName).toBeNull();
    expect(accountService.updateAccountInList).toHaveBeenCalled();
  });

  it('does not tag in auto mode while only one cardholder is known', async () => {
    accountService.getAccountData.mockReturnValue({ cardholderOwnerMode: 'off', cardholderTagMode: 'auto' });

    const result = await syncCardholders(baseParams);

    expect(result.shouldTag).toBe(false);
  });

  it('tags in auto mode as soon as a second cardholder appears in the same sync', async () => {
    accountService.getAccountData.mockReturnValue({ cardholderOwnerMode: 'off', cardholderTagMode: 'auto' });

    const result = await syncCardholders({
      ...baseParams,
      transactions: [
        rogersTx('MYKHAILO DELEGAN', '************8584'),
        rogersTx('LIUBOV MONSAR', '************2142'),
      ],
    });

    expect(result.shouldTag).toBe(true);
  });

  it('keeps tagging in auto mode when this sync only contains one known cardholder', async () => {
    // The persisted map already holds two cardholders, so a narrow sync window
    // must not cause tagging to flip back off.
    accountService.getAccountData.mockReturnValue({
      cardholderOwnerMode: 'off',
      cardholderTagMode: 'auto',
      cardholders: {
        'MYKHAILO DELEGAN': entry(),
        'LIUBOV MONSAR': entry({ label: 'Liubov Monsar', cardLast4: '2142' }),
      },
    });

    const result = await syncCardholders(baseParams);

    expect(result.shouldTag).toBe(true);
  });

  it('refreshes a stale cached member name from the live household list', async () => {
    accountService.getAccountData.mockReturnValue({
      cardholderOwnerMode: 'on',
      cardholderTagMode: 'off',
      cardholders: {
        'MYKHAILO DELEGAN': entry({ monarchUserId: 'user-1', monarchUserName: 'Old Name', matchType: 'manual' }),
      },
    });
    getHouseholdMembers.mockResolvedValue({
      currentUserId: 'user-1',
      householdId: 'hh-1',
      members: [member({ id: 'user-1', name: 'Renamed Person' })],
    });

    const result = await syncCardholders(baseParams);

    expect(result.cardholders['MYKHAILO DELEGAN'].monarchUserName).toBe('Renamed Person');
  });
});