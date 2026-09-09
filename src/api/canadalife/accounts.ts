/**
 * Canada Life account (plan) loading.
 *
 * As of 2026 Canada Life serves the member portal from its own non-namespaced
 * Apex controllers. The previous Vlocity-package route
 * (`vlocity_ins.BusinessProcessDisplayController.GenericInvoke2NoCont` →
 * `grsa_GetMemberPlans`) now fails with `System.LicenseException`.
 *
 * @module api/canadalife/accounts
 */

import { STORAGE } from '../../core/config';
import { debugLog } from '../../core/utils';
import toast from '../../ui/toast';
import { CanadaLifeApiError } from './errors';
import { buildApexActionPayload, makeAuraApiCall } from './auraClient';
import type {
  CanadaLifeAccount,
  CanadaLifeConsolidatedAccount,
  LoadAccountsOptions,
  SponsorInfo,
} from './types';

/** Apex controller serving the plan selection + activity report screens */
const PLANS_CONTROLLER = 'MclawGrsaActivityPlansController';

/** Apex controller serving sponsor/session details */
const SPONSOR_CONTROLLER = 'IMSCommunityHelperSfiLwc';

/** Language code sent with plan requests */
const LANGUAGE = 'en';

/** Legacy cache key superseded by consolidated storage */
const LEGACY_ACCOUNTS_CACHE_KEY = 'canadalife_accounts';

/** Session-level cache for sponsor info (adminSystemId is stable per session) */
let cachedSponsorInfo: SponsorInfo | null = null;

/**
 * Fetch sponsor info from Canada Life via `IMSCommunityHelperSfiLwc.getSponsorInfo`.
 *
 * The response contains `GRS_ParticId__c` — the encrypted participant id used
 * as `adminSystemId` when requesting the plan list. It is user/session-specific
 * and cannot be hardcoded.
 *
 * Results are cached in memory for the lifetime of the page.
 *
 * @returns Sponsor info including `adminSystemId`
 * @throws `CanadaLifeApiError` if `GRS_ParticId__c` is absent from the response
 */
export async function getSponsorInfo(): Promise<SponsorInfo> {
  if (cachedSponsorInfo) {
    debugLog('Using cached sponsor info', {
      adminSystemId: `${cachedSponsorInfo.adminSystemId.substring(0, 20)}...`,
    });
    return cachedSponsorInfo;
  }

  debugLog('Fetching sponsor info from getSponsorInfo API...');

  // Note: getSponsorInfo takes no arguments — `params` must be omitted entirely.
  const payload = buildApexActionPayload({
    id: '99;a',
    classname: SPONSOR_CONTROLLER,
    method: 'getSponsorInfo',
  });

  const response = await makeAuraApiCall(payload, { extractNestedResponse: true });

  const sponsorData = response?.getSponsorInfo;

  if (!sponsorData?.GRS_ParticId__c) {
    debugLog('getSponsorInfo response missing GRS_ParticId__c:', response);
    throw new CanadaLifeApiError(
      'Could not extract adminSystemId (GRS_ParticId__c) from getSponsorInfo response. '
      + 'Please ensure you are logged in to Canada Life.',
      response,
    );
  }

  cachedSponsorInfo = {
    adminSystemId: sponsorData.GRS_ParticId__c,
    sponsorName: sponsorData.User_Sponsor_Name__c || '',
    sponsorId: sponsorData.SponsorId__c || '',
  };

  debugLog('Fetched sponsor info successfully', {
    adminSystemId: `${cachedSponsorInfo.adminSystemId.substring(0, 20)}...`,
    sponsorName: cachedSponsorInfo.sponsorName,
  });

  return cachedSponsorInfo;
}

/**
 * Clear the cached sponsor info (useful for testing or forced refresh).
 */
export function clearSponsorInfoCache(): void {
  cachedSponsorInfo = null;
}

/**
 * Fetch the raw plan list from Canada Life.
 *
 * Supports both response shapes:
 *  - current: `plansList[]` from `getPlanSelectionScreenData`
 *  - legacy:  `IPResult.MemberPlans[]` from `grsa_GetMemberPlans`
 *
 * @returns Array of plan objects
 * @throws `CanadaLifeApiError` if no recognisable plan list is present
 */
async function fetchPlansFromApi(): Promise<CanadaLifeAccount[]> {
  const sponsorInfo = await getSponsorInfo();

  debugLog('Building getPlanSelectionScreenData payload', {
    adminSystemId: `${sponsorInfo.adminSystemId.substring(0, 20)}...`,
  });

  const payload = buildApexActionPayload({
    id: '141;a',
    classname: PLANS_CONTROLLER,
    method: 'getPlanSelectionScreenData',
    params: {
      adminSystemId: sponsorInfo.adminSystemId,
      language: LANGUAGE,
    },
  });

  const data = await makeAuraApiCall(payload, { extractNestedResponse: true });

  if (Array.isArray(data?.plansList)) {
    debugLog(`Loaded ${data.plansList.length} plans from plansList`);
    return data.plansList;
  }

  // Backward compatibility with the retired Vlocity response shape
  if (Array.isArray(data?.IPResult?.MemberPlans)) {
    debugLog(`Loaded ${data.IPResult.MemberPlans.length} plans from legacy IPResult.MemberPlans`);
    return data.IPResult.MemberPlans;
  }

  debugLog('No plan list found in Canada Life API response:', data);
  throw new CanadaLifeApiError('No plans found in Canada Life API response', data);
}

/**
 * Index existing consolidated accounts by their account id.
 * @param existingAccounts - Accounts currently in storage
 * @returns Map of account id → consolidated entry
 */
function indexExistingAccounts(
  existingAccounts: CanadaLifeConsolidatedAccount[],
): Map<string, CanadaLifeConsolidatedAccount> {
  const existingMap = new Map<string, CanadaLifeConsolidatedAccount>();

  existingAccounts.forEach((acc) => {
    const accountId = acc.canadalifeAccount?.id || acc.canadalifeAccount?.agreementId;
    if (accountId) {
      existingMap.set(accountId, acc);
    }
  });

  return existingMap;
}

/**
 * Merge a plan from the API with any existing stored settings for it.
 * @param apiAccount - Plan object from the API
 * @param existing - Matching stored entry, if any
 * @returns Consolidated account entry
 */
function mergeAccount(
  apiAccount: CanadaLifeAccount,
  existing: CanadaLifeConsolidatedAccount | undefined,
): CanadaLifeConsolidatedAccount {
  const accountId = apiAccount.agreementId;

  debugLog(`Account: ${apiAccount.LongNameEnglish} (${apiAccount.EnglishShortName})`, {
    agreementId: apiAccount.agreementId,
    enrollmentDate: apiAccount.EnrollmentDate,
    longName: apiAccount.LongNameEnglish,
    shortName: apiAccount.EnglishShortName,
  });

  return {
    canadalifeAccount: {
      id: accountId,
      agreementId: apiAccount.agreementId,
      nickname: apiAccount.EnglishShortName || apiAccount.LongNameEnglish || accountId,
      EnglishShortName: apiAccount.EnglishShortName,
      LongNameEnglish: apiAccount.LongNameEnglish,
      EnrollmentDate: apiAccount.EnrollmentDate,
      ...apiAccount,
    },
    monarchAccount: existing?.monarchAccount || null,
    syncEnabled: existing?.syncEnabled ?? true,
    lastSyncDate: existing?.lastSyncDate || null,
    lastSyncBalance: existing?.lastSyncBalance ?? null,
    uploadedTransactions: existing?.uploadedTransactions || [],
    successfulSyncCount: existing?.successfulSyncCount || 0,
  };
}

/**
 * Append stored accounts that the API no longer returns.
 *
 * Closed or transferred plans keep their Monarch mapping and sync history so
 * historical data stays attributable.
 *
 * @param mergedAccounts - Accounts built from the API response (mutated)
 * @param existingAccounts - Accounts currently in storage
 * @param apiAccountIds - Ids present in the API response
 */
function appendOrphanedAccounts(
  mergedAccounts: CanadaLifeConsolidatedAccount[],
  existingAccounts: CanadaLifeConsolidatedAccount[],
  apiAccountIds: Set<string>,
): void {
  existingAccounts.forEach((existing) => {
    const existingId = existing.canadalifeAccount?.id || existing.canadalifeAccount?.agreementId;
    if (existingId && !apiAccountIds.has(existingId)) {
      debugLog(`Preserving orphaned account: ${existingId} (${existing.canadalifeAccount?.nickname || 'Unknown'})`);
      mergedAccounts.push(existing);
    }
  });
}

/**
 * Load and cache Canada Life accounts using the consolidated storage structure.
 *
 * @param optionsOrForceRefresh - Options object, or boolean for backward-compat (forceRefresh)
 * @returns Array of consolidated account objects
 */
export async function loadCanadaLifeAccounts(
  optionsOrForceRefresh: boolean | LoadAccountsOptions = false,
): Promise<CanadaLifeConsolidatedAccount[]> {
  // Support legacy boolean signature: loadCanadaLifeAccounts(true)
  const opts: LoadAccountsOptions = typeof optionsOrForceRefresh === 'boolean'
    ? { forceRefresh: optionsOrForceRefresh, silent: false }
    : optionsOrForceRefresh;
  const forceRefresh = opts.forceRefresh ?? false;
  const silent = opts.silent ?? false;

  try {
    const existingAccounts: CanadaLifeConsolidatedAccount[] = JSON.parse(
      GM_getValue(STORAGE.CANADALIFE_ACCOUNTS_LIST, '[]') as string,
    );

    if (!forceRefresh && existingAccounts.length > 0) {
      debugLog(`Loaded ${existingAccounts.length} Canada Life accounts from consolidated storage`);
      return existingAccounts;
    }

    debugLog('Loading Canada Life accounts from API...');
    if (!silent) {
      toast.show('Loading Canada Life accounts...', 'debug');
    }

    const apiAccounts = await fetchPlansFromApi();
    debugLog(`Loaded ${apiAccounts.length} Canada Life accounts from API`);

    const existingMap = indexExistingAccounts(existingAccounts);
    const mergedAccounts = apiAccounts.map(
      (apiAccount) => mergeAccount(apiAccount, existingMap.get(apiAccount.agreementId)),
    );

    const apiAccountIds = new Set(apiAccounts.map((a) => a.agreementId));
    appendOrphanedAccounts(mergedAccounts, existingAccounts, apiAccountIds);

    GM_setValue(STORAGE.CANADALIFE_ACCOUNTS_LIST, JSON.stringify(mergedAccounts));
    debugLog(`Cached ${mergedAccounts.length} Canada Life accounts with consolidated structure`);

    if (GM_getValue(LEGACY_ACCOUNTS_CACHE_KEY, null)) {
      debugLog('Removing legacy canadalife_accounts cache (migrated to consolidated storage)');
      GM_deleteValue(LEGACY_ACCOUNTS_CACHE_KEY);
    }

    if (!silent) {
      const accountNames = mergedAccounts
        .filter((acc) => acc.canadalifeAccount !== null)
        .map((acc) => acc.canadalifeAccount.EnglishShortName)
        .join(', ');
      toast.show(`Loaded Canada Life accounts: ${accountNames}`, 'debug');
    }

    return mergedAccounts;
  } catch (error) {
    debugLog('Error loading Canada Life accounts:', error);
    if (!silent) {
      toast.show(`Failed to load Canada Life accounts: ${(error as Error).message}`, 'error');
    }
    throw error;
  }
}