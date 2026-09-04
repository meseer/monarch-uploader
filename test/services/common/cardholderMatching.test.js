/**
 * Tests for cardholder → Monarch household member matching strategies
 *
 * These are pure functions with no mocks needed beyond core/utils.
 */

import { findBestMemberMatch, describeMatchType } from '../../../src/services/common/cardholderMatching';

jest.mock('../../../src/core/utils', () => ({
  normalizePersonName: jest.fn((name) => {
    if (!name || typeof name !== 'string') return '';
    return name.trim().replace(/\s+/g, ' ').toLowerCase();
  }),
}));

/** Build a household member with sensible defaults */
const member = (overrides = {}) => ({
  id: 'user-1',
  name: 'Mykhailo Delegan',
  displayName: 'Mykhailo',
  householdRole: 'OWNER',
  profilePictureUrl: null,
  avatarColor: null,
  ...overrides,
});

describe('findBestMemberMatch', () => {
  describe('exact name match', () => {
    it('matches an uppercase cardholder name to the member full name', () => {
      const members = [member()];
      const result = findBestMemberMatch('MYKHAILO DELEGAN', members);

      expect(result).toEqual({ member: members[0], matchType: 'exact-name' });
    });

    it('is insensitive to irregular whitespace', () => {
      const members = [member()];
      const result = findBestMemberMatch('  MYKHAILO   DELEGAN  ', members);

      expect(result.matchType).toBe('exact-name');
    });

    it('prefers full-name match over display-name match', () => {
      const members = [
        member({ id: 'display-match', name: 'Someone Else', displayName: 'Mykhailo Delegan' }),
        member({ id: 'name-match', name: 'Mykhailo Delegan', displayName: 'Mike' }),
      ];

      const result = findBestMemberMatch('MYKHAILO DELEGAN', members);

      expect(result.member.id).toBe('name-match');
      expect(result.matchType).toBe('exact-name');
    });
  });

  describe('display name match', () => {
    it('matches a single-word cardholder name to a display name', () => {
      const members = [member({ name: 'Mykhailo Delegan', displayName: 'Mykhailo' })];
      const result = findBestMemberMatch('MYKHAILO', members);

      // First-name strategies could also match here; display name is checked first
      expect(result.member.id).toBe('user-1');
      expect(result.matchType).toBe('exact-display');
    });
  });

  describe('first name + last initial match', () => {
    it('matches an abbreviated cardholder name', () => {
      const members = [member({ name: 'Mykhailo Delegan' })];
      const result = findBestMemberMatch('MYKHAILO D', members);

      expect(result).toEqual({ member: members[0], matchType: 'initial' });
    });

    it('matches when the member is the abbreviated one', () => {
      const members = [member({ name: 'Mykhailo D', displayName: 'Mykhailo D' })];
      const result = findBestMemberMatch('MYKHAILO DELEGAN', members);

      expect(result.matchType).toBe('initial');
    });

    it('does NOT match when two members share first name and last initial', () => {
      const members = [
        member({ id: 'a', name: 'Alex Doe', displayName: 'Alex Doe' }),
        member({ id: 'b', name: 'Alex Davis', displayName: 'Alex Davis' }),
      ];

      const result = findBestMemberMatch('ALEX D', members);

      expect(result).toBeNull();
    });
  });

  describe('first name only match', () => {
    it('matches when exactly one member shares the first name', () => {
      const members = [
        member({ id: 'a', name: 'Alex Doe', displayName: 'Alex Doe' }),
        member({ id: 'b', name: 'Sam Smith', displayName: 'Sam Smith' }),
      ];

      const result = findBestMemberMatch('ALEX WILSON', members);

      expect(result.member.id).toBe('a');
      expect(result.matchType).toBe('first-name');
    });

    it('does NOT guess when two members share a first name', () => {
      const members = [
        member({ id: 'a', name: 'Alex Doe', displayName: 'Alex Doe' }),
        member({ id: 'b', name: 'Alex Smith', displayName: 'Alex Smith' }),
      ];

      const result = findBestMemberMatch('ALEX WILSON', members);

      expect(result).toBeNull();
    });
  });

  describe('no match', () => {
    it('returns null when nothing matches', () => {
      const members = [member({ name: 'Mykhailo Delegan', displayName: 'Mykhailo' })];

      expect(findBestMemberMatch('LIUBOV MONSAR', members)).toBeNull();
    });

    it('returns null for an empty member list', () => {
      expect(findBestMemberMatch('MYKHAILO DELEGAN', [])).toBeNull();
    });

    it('returns null for a non-array member list', () => {
      expect(findBestMemberMatch('MYKHAILO DELEGAN', null)).toBeNull();
    });

    it.each([
      ['null', null],
      ['undefined', undefined],
      ['empty string', ''],
      ['whitespace only', '   '],
    ])('returns null for a %s cardholder name', (_label, value) => {
      expect(findBestMemberMatch(value, [member()])).toBeNull();
    });
  });
});

describe('describeMatchType', () => {
  it.each([
    ['exact-name', 'Exact name match'],
    ['exact-display', 'Matched display name'],
    ['initial', 'Matched first name + last initial'],
    ['first-name', 'Matched first name'],
    ['manual', 'Set manually'],
    ['unresolved', 'Not mapped'],
  ])('describes %s', (matchType, expected) => {
    expect(describeMatchType(matchType)).toBe(expected);
  });

  it('falls back to "Not mapped" for an unknown match type', () => {
    expect(describeMatchType('something-else')).toBe('Not mapped');
  });
});