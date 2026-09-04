/**
 * Tests for the Monarch household members API
 *
 * The `name` field returned here is what Monarch's CSV importer matches against
 * for the Owner column, so callers must never substitute `displayName`.
 */

import { getHouseholdMembers } from '../../src/api/monarchHousehold';

jest.mock('../../src/core/utils', () => ({
  debugLog: jest.fn(),
}));

jest.mock('../../src/api/monarch', () => ({
  callMonarchGraphQL: jest.fn(),
}));

const { callMonarchGraphQL } = require('../../src/api/monarch');

/** Real-shaped response from Common_GetHouseholdMembers */
const singleMemberResponse = {
  me: { id: '162625044845828370', __typename: 'User' },
  myHousehold: {
    id: '162625044855947113',
    users: [
      {
        id: '162625044845828370',
        name: 'Mykhailo Delegan',
        displayName: 'Mykhailo',
        householdRole: 'OWNER',
        profilePictureUrl: 'https://lh3.googleusercontent.com/a/abc=s96-c',
        avatarColor: null,
        __typename: 'User',
      },
    ],
    __typename: 'Household',
  },
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getHouseholdMembers', () => {
  it('uses the Common_GetHouseholdMembers operation', async () => {
    callMonarchGraphQL.mockResolvedValue(singleMemberResponse);

    await getHouseholdMembers();

    expect(callMonarchGraphQL).toHaveBeenCalledWith(
      'Common_GetHouseholdMembers',
      expect.stringContaining('myHousehold'),
      {},
    );
  });

  it('requests the name field, which the Owner CSV column matches against', async () => {
    callMonarchGraphQL.mockResolvedValue(singleMemberResponse);

    await getHouseholdMembers();

    const query = callMonarchGraphQL.mock.calls[0][1];
    expect(query).toContain('name');
    expect(query).toContain('displayName');
    expect(query).toContain('householdRole');
  });

  it('returns the current user id, household id, and members', async () => {
    callMonarchGraphQL.mockResolvedValue(singleMemberResponse);

    const result = await getHouseholdMembers();

    expect(result.currentUserId).toBe('162625044845828370');
    expect(result.householdId).toBe('162625044855947113');
    expect(result.members).toHaveLength(1);
    expect(result.members[0]).toMatchObject({
      id: '162625044845828370',
      name: 'Mykhailo Delegan',
      displayName: 'Mykhailo',
      householdRole: 'OWNER',
    });
  });

  it('returns all members of a multi-person household', async () => {
    callMonarchGraphQL.mockResolvedValue({
      me: { id: 'user-1' },
      myHousehold: {
        id: 'hh-1',
        users: [
          { id: 'user-1', name: 'Mykhailo Delegan', displayName: 'Mykhailo', householdRole: 'OWNER' },
          { id: 'user-2', name: 'Liubov Monsar', displayName: 'Liubov', householdRole: 'MEMBER' },
        ],
      },
    });

    const result = await getHouseholdMembers();

    expect(result.members.map((m) => m.name)).toEqual(['Mykhailo Delegan', 'Liubov Monsar']);
  });

  it('returns an empty member list when the household has no users array', async () => {
    callMonarchGraphQL.mockResolvedValue({ me: { id: 'user-1' }, myHousehold: { id: 'hh-1' } });

    const result = await getHouseholdMembers();

    expect(result.members).toEqual([]);
    expect(result.householdId).toBe('hh-1');
  });

  it('returns nulls when the response has no household', async () => {
    callMonarchGraphQL.mockResolvedValue({});

    const result = await getHouseholdMembers();

    expect(result).toEqual({ currentUserId: null, householdId: null, members: [] });
  });

  it('tolerates a null response body', async () => {
    callMonarchGraphQL.mockResolvedValue(null);

    const result = await getHouseholdMembers();

    expect(result).toEqual({ currentUserId: null, householdId: null, members: [] });
  });

  it('propagates GraphQL errors so callers can degrade to Shared', async () => {
    callMonarchGraphQL.mockRejectedValue(new Error('Unauthorized'));

    await expect(getHouseholdMembers()).rejects.toThrow('Unauthorized');
  });
});