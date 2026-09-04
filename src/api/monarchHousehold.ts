/**
 * Monarch Money API — Household Operations
 *
 * Provides access to the current user's household members, which are needed
 * to map institution cardholders to Monarch transaction owners.
 *
 * Monarch's CSV importer matches the `Owner` column against household member
 * `name` values (NOT `displayName` and NOT the user id). Any unrecognised
 * value is silently reverted to the household default, so callers must always
 * emit the exact `name` returned here.
 *
 * @module api/monarchHousehold
 */

import { debugLog } from '../core/utils';
import { callMonarchGraphQL } from './monarch';

// ── Interfaces ──────────────────────────────────────────────

/** A single member of the current user's Monarch household */
export interface HouseholdMember {
  id: string;
  /**
   * Full name — this is the value Monarch's CSV importer matches against
   * for the `Owner` column. Always use this (never `displayName`) when
   * writing an Owner value.
   */
  name: string;
  /** Short/preferred name shown in the Monarch UI */
  displayName: string;
  /** e.g. 'OWNER', 'MEMBER' */
  householdRole: string;
  profilePictureUrl: string | null;
  avatarColor: string | null;
  __typename?: string;
}

/** Result of getHouseholdMembers() */
export interface HouseholdMembersResult {
  /** User id of the currently authenticated user */
  currentUserId: string | null;
  /** Household id */
  householdId: string | null;
  /** All members of the household (may be a single user) */
  members: HouseholdMember[];
}

// ── Functions ───────────────────────────────────────────────

/**
 * Fetch the current user's household members.
 *
 * @returns Household id, current user id, and the list of members
 * @throws If the GraphQL request fails
 */
export async function getHouseholdMembers(): Promise<HouseholdMembersResult> {
  const query = `query Common_GetHouseholdMembers {
  me {
    id
    __typename
  }
  myHousehold {
    id
    users {
      id
      name
      displayName
      householdRole
      profilePictureUrl
      avatarColor
      __typename
    }
    __typename
  }
}`;

  const data = await callMonarchGraphQL('Common_GetHouseholdMembers', query, {});

  const members: HouseholdMember[] = (data?.myHousehold?.users || []) as HouseholdMember[];

  debugLog(`Retrieved ${members.length} Monarch household member(s)`);

  return {
    currentUserId: data?.me?.id ?? null,
    householdId: data?.myHousehold?.id ?? null,
    members,
  };
}

export default {
  getHouseholdMembers,
};