/**
 * Canada Life API — sponsor info and account (plan) loading
 */

import {
  getSponsorInfo,
  clearSponsorInfoCache,
  loadCanadaLifeAccounts,
  CanadaLifeApiError,
} from '../../../src/api/canadalife';

import stateManager from '../../../src/core/state';
import toast from '../../../src/ui/toast';
import { debugLog } from '../../../src/core/utils';
import { installCanadaLifeTestGlobals, readActionParams } from './harness';
import {
  ADMIN_SYSTEM_ID,
  DPSP_AGREEMENT_ID,
  RRSP_AGREEMENT_ID,
  buildLicenseExceptionResponse,
  buildPlanSelectionResponse,
  buildSponsorInfoResponse,
  mockFetchResponse,
  wrapAuraSuccess,
} from './fixtures';

jest.mock('../../../src/core/state', () => {
  const { buildStateMock: build } = jest.requireActual('./harness');
  return build();
});
jest.mock('../../../src/core/utils', () => {
  const { buildUtilsMock: build } = jest.requireActual('./harness');
  return build();
});
jest.mock('../../../src/ui/toast', () => {
  const { buildToastMock: build } = jest.requireActual('./harness');
  return build();
});

installCanadaLifeTestGlobals();

/** Queue the sponsor-info + plan-selection call pair that account loading makes */
function mockAccountsApiFetch(planResponse = buildPlanSelectionResponse()) {
  global.fetch
    .mockResolvedValueOnce(mockFetchResponse(buildSponsorInfoResponse()))
    .mockResolvedValueOnce(mockFetchResponse(planResponse));
}

/** Make GM_getValue return the given consolidated account list */
function mockStoredAccounts(accounts) {
  global.GM_getValue.mockImplementation((key, defaultVal) => {
    if (key === 'canadalife_accounts_list') {
      return JSON.stringify(accounts);
    }
    return defaultVal;
  });
}

/** Build a legacy Vlocity plan-list response for backward-compatibility tests */
function buildLegacyMemberPlansResponse(apiAccounts) {
  return {
    actions: [{ returnValue: { returnValue: JSON.stringify({ IPResult: { MemberPlans: apiAccounts } }) } }],
  };
}

describe('Canada Life API - getSponsorInfo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearSponsorInfoCache();
    stateManager.getState.mockReturnValue({
      auth: { canadalife: { token: 'valid-aura-token' } },
    });
  });

  // Canada Life moved this off the licence-gated
  // vlocity_ins.BusinessProcessDisplayController onto their own controller.
  test('calls the non-namespaced IMSCommunityHelperSfiLwc controller', async () => {
    global.fetch.mockResolvedValueOnce(mockFetchResponse(buildSponsorInfoResponse()));

    await getSponsorInfo();

    const params = readActionParams();
    expect(params.namespace).toBe('');
    expect(params.classname).toBe('IMSCommunityHelperSfiLwc');
    expect(params.method).toBe('getSponsorInfo');
  });

  // getSponsorInfo takes no arguments; sending a params key breaks the call.
  test('sends no params key for the zero-argument method', async () => {
    global.fetch.mockResolvedValueOnce(mockFetchResponse(buildSponsorInfoResponse()));

    await getSponsorInfo();

    expect(readActionParams()).not.toHaveProperty('params');
  });

  test('extracts adminSystemId from GRS_ParticId__c', async () => {
    global.fetch.mockResolvedValueOnce(mockFetchResponse(buildSponsorInfoResponse()));

    const result = await getSponsorInfo();

    expect(result.adminSystemId).toBe(ADMIN_SYSTEM_ID);
    expect(result.sponsorName).toBe('AMAZON CANADA FULFILLMENT SERVICES');
    expect(result.sponsorId).toBe('ENC_MymyQ1Gdy5yOJy');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('caches the result for the session', async () => {
    global.fetch.mockResolvedValueOnce(mockFetchResponse(buildSponsorInfoResponse('ENC_CACHED')));

    const first = await getSponsorInfo();
    const second = await getSponsorInfo();

    expect(first.adminSystemId).toBe('ENC_CACHED');
    expect(second.adminSystemId).toBe('ENC_CACHED');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(debugLog).toHaveBeenCalledWith('Using cached sponsor info', expect.any(Object));
  });

  test('clearSponsorInfoCache forces a fresh fetch', async () => {
    global.fetch.mockResolvedValueOnce(mockFetchResponse(buildSponsorInfoResponse('ENC_FIRST')));
    await getSponsorInfo();

    clearSponsorInfoCache();

    global.fetch.mockResolvedValueOnce(mockFetchResponse(buildSponsorInfoResponse('ENC_SECOND')));
    expect((await getSponsorInfo()).adminSystemId).toBe('ENC_SECOND');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('throws when GRS_ParticId__c is missing', async () => {
    global.fetch.mockResolvedValueOnce(mockFetchResponse(wrapAuraSuccess({
      getSponsorInfo: { User_Sponsor_Name__c: 'TEST' },
    }, '99;a')));

    await expect(getSponsorInfo()).rejects.toThrow(CanadaLifeApiError);
  });

  test('throws when the getSponsorInfo key is absent', async () => {
    global.fetch.mockResolvedValueOnce(mockFetchResponse(wrapAuraSuccess({
      someOtherData: true,
      error: 'OK',
    }, '99;a')));

    await expect(getSponsorInfo()).rejects.toThrow(CanadaLifeApiError);
  });

  test('surfaces a license exception rather than a missing-value error', async () => {
    global.fetch.mockResolvedValueOnce(mockFetchResponse(buildLicenseExceptionResponse()));

    await expect(getSponsorInfo()).rejects.toThrow(/Canada Life changed their portal API/);
  });
});

describe('Canada Life API - loadCanadaLifeAccounts request shape', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearSponsorInfoCache();
    global.GM_getValue.mockReturnValue('[]');
    stateManager.getState.mockReturnValue({
      auth: { canadalife: { token: 'valid-aura-token' } },
    });
  });

  test('calls getPlanSelectionScreenData with the dynamic adminSystemId', async () => {
    mockAccountsApiFetch();

    await loadCanadaLifeAccounts();

    const params = readActionParams(1);
    expect(params.namespace).toBe('');
    expect(params.classname).toBe('MclawGrsaActivityPlansController');
    expect(params.method).toBe('getPlanSelectionScreenData');
    expect(params.params).toEqual({
      adminSystemId: ADMIN_SYSTEM_ID,
      language: 'en',
    });
  });

  test('no longer sends the retired Vlocity integration-procedure options', async () => {
    mockAccountsApiFetch();

    await loadCanadaLifeAccounts();

    const params = readActionParams(1);
    expect(params.params).not.toHaveProperty('options');
    expect(params.params).not.toHaveProperty('sClassName');
    expect(params.params).not.toHaveProperty('sMethodName');
  });
});

describe('Canada Life API - loadCanadaLifeAccounts mapping', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearSponsorInfoCache();
    stateManager.getState.mockReturnValue({
      auth: { canadalife: { token: 'valid-aura-token' } },
    });
  });

  test('maps plansList entries into the consolidated structure', async () => {
    global.GM_getValue.mockReturnValue('[]');
    mockAccountsApiFetch();

    const result = await loadCanadaLifeAccounts();

    expect(result).toHaveLength(2);

    const [dpsp, rrsp] = result;
    expect(dpsp.canadalifeAccount.id).toBe(DPSP_AGREEMENT_ID);
    expect(dpsp.canadalifeAccount.agreementId).toBe(DPSP_AGREEMENT_ID);
    expect(dpsp.canadalifeAccount.EnglishShortName).toBe('DPSP');
    expect(dpsp.canadalifeAccount.LongNameEnglish).toBe('DEFERRED PROFIT SHARING PLAN');
    expect(dpsp.canadalifeAccount.EnrollmentDate).toBe('2014-07-28T00:00:00');
    expect(dpsp.canadalifeAccount.nickname).toBe('DPSP');
    expect(dpsp.monarchAccount).toBeNull();
    expect(dpsp.syncEnabled).toBe(true);

    expect(rrsp.canadalifeAccount.id).toBe(RRSP_AGREEMENT_ID);
    expect(rrsp.canadalifeAccount.EnglishShortName).toBe('RRSP');
  });

  test('persists the mapped accounts and reports them', async () => {
    global.GM_getValue.mockReturnValue('[]');
    mockAccountsApiFetch();

    await loadCanadaLifeAccounts();

    expect(global.GM_setValue).toHaveBeenCalledWith('canadalife_accounts_list', expect.any(String));
    expect(toast.show).toHaveBeenCalledWith('Loading Canada Life accounts...', 'debug');
    expect(toast.show).toHaveBeenCalledWith('Loaded Canada Life accounts: DPSP, RRSP', 'debug');
  });

  test('still reads the legacy IPResult.MemberPlans shape', async () => {
    global.GM_getValue.mockReturnValue('[]');
    mockAccountsApiFetch(buildLegacyMemberPlansResponse([
      { EnglishShortName: 'RRSP', LongNameEnglish: 'RRSP Account', agreementId: '123' },
    ]));

    const result = await loadCanadaLifeAccounts();

    expect(result).toHaveLength(1);
    expect(result[0].canadalifeAccount.id).toBe('123');
  });

  test('throws when the response carries no recognisable plan list', async () => {
    global.GM_getValue.mockReturnValue('[]');
    mockAccountsApiFetch(wrapAuraSuccess({ defaultPlanCode: 'DPSP', isSuccess: true }));

    await expect(loadCanadaLifeAccounts()).rejects.toThrow(/No plans found/);
  });
});

describe('Canada Life API - loadCanadaLifeAccounts caching', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearSponsorInfoCache();
    stateManager.getState.mockReturnValue({
      auth: { canadalife: { token: 'valid-aura-token' } },
    });
  });

  test('returns the consolidated cache without calling the API', async () => {
    const cached = [
      {
        canadalifeAccount: {
          id: '123', agreementId: '123', EnglishShortName: 'RRSP', nickname: 'RRSP',
        },
        monarchAccount: null,
        syncEnabled: true,
      },
    ];
    mockStoredAccounts(cached);

    expect(await loadCanadaLifeAccounts()).toEqual(cached);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(debugLog).toHaveBeenCalledWith('Loaded 1 Canada Life accounts from consolidated storage');
  });

  test('forceRefresh bypasses the cache', async () => {
    mockStoredAccounts([{
      canadalifeAccount: {
        id: '123', agreementId: '123', EnglishShortName: 'OLD', nickname: 'OLD',
      },
      monarchAccount: null,
      syncEnabled: true,
    }]);
    mockAccountsApiFetch();

    const result = await loadCanadaLifeAccounts(true);

    expect(global.fetch).toHaveBeenCalled();
    expect(result.some((a) => a.canadalifeAccount.id === DPSP_AGREEMENT_ID)).toBe(true);
  });

  test('deletes the legacy accounts cache after a refresh', async () => {
    global.GM_getValue.mockImplementation((key, defaultVal) => {
      if (key === 'canadalife_accounts') return '[{"EnglishShortName": "OLD-LEGACY"}]';
      if (key === 'canadalife_accounts_list') return '[]';
      return defaultVal;
    });
    mockAccountsApiFetch();

    await loadCanadaLifeAccounts();

    expect(global.GM_deleteValue).toHaveBeenCalledWith('canadalife_accounts');
  });
});

describe('Canada Life API - loadCanadaLifeAccounts merge behaviour', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearSponsorInfoCache();
    stateManager.getState.mockReturnValue({
      auth: { canadalife: { token: 'valid-aura-token' } },
    });
  });

  test('preserves the Monarch mapping, settings and dedup history on refresh', async () => {
    mockStoredAccounts([{
      canadalifeAccount: { id: DPSP_AGREEMENT_ID, agreementId: DPSP_AGREEMENT_ID, EnglishShortName: 'DPSP' },
      monarchAccount: { id: 'monarch-123', displayName: 'My Monarch Account' },
      syncEnabled: false,
      lastSyncDate: '2026-01-01',
      lastSyncBalance: 1000,
      uploadedTransactions: [{ id: 'cl-tx:abc', date: '2026-01-01' }],
      successfulSyncCount: 3,
    }]);
    mockAccountsApiFetch();

    const result = await loadCanadaLifeAccounts(true);

    const dpsp = result.find((a) => a.canadalifeAccount.id === DPSP_AGREEMENT_ID);
    expect(dpsp.monarchAccount).toEqual({ id: 'monarch-123', displayName: 'My Monarch Account' });
    expect(dpsp.syncEnabled).toBe(false);
    expect(dpsp.lastSyncDate).toBe('2026-01-01');
    expect(dpsp.lastSyncBalance).toBe(1000);
    expect(dpsp.uploadedTransactions).toHaveLength(1);
    expect(dpsp.successfulSyncCount).toBe(3);

    // A plan seen for the first time gets defaults
    const rrsp = result.find((a) => a.canadalifeAccount.id === RRSP_AGREEMENT_ID);
    expect(rrsp.monarchAccount).toBeNull();
    expect(rrsp.syncEnabled).toBe(true);
  });

  test('preserves accounts the API no longer returns', async () => {
    mockStoredAccounts([{
      canadalifeAccount: {
        id: '456', agreementId: '456', EnglishShortName: 'CLOSED-TFSA', nickname: 'Closed TFSA',
      },
      monarchAccount: { id: 'monarch-2', displayName: 'Monarch TFSA' },
      syncEnabled: false,
      lastSyncDate: '2025-12-15',
      uploadedTransactions: [{ id: 'cl-tx:def', date: '2025-12-15' }],
    }]);
    mockAccountsApiFetch();

    const result = await loadCanadaLifeAccounts(true);

    // Two live plans plus the orphan
    expect(result).toHaveLength(3);

    const orphan = result.find((a) => a.canadalifeAccount.id === '456');
    expect(orphan.canadalifeAccount.EnglishShortName).toBe('CLOSED-TFSA');
    expect(orphan.monarchAccount).toEqual({ id: 'monarch-2', displayName: 'Monarch TFSA' });
    expect(orphan.syncEnabled).toBe(false);
    expect(orphan.uploadedTransactions).toHaveLength(1);
  });

  test('does not duplicate entries that are already orphaned', async () => {
    mockStoredAccounts([{
      canadalifeAccount: null,
      monarchAccount: { id: 'monarch-2', displayName: 'Monarch TFSA (closed)' },
      syncEnabled: false,
    }]);
    mockAccountsApiFetch();

    const result = await loadCanadaLifeAccounts(true);

    expect(result).toHaveLength(2);
    expect(result.every((a) => a.canadalifeAccount !== null)).toBe(true);
  });
});

describe('Canada Life API - loadCanadaLifeAccounts options and errors', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearSponsorInfoCache();
    global.GM_getValue.mockReturnValue('[]');
    stateManager.getState.mockReturnValue({
      auth: { canadalife: { token: 'valid-aura-token' } },
    });
  });

  test('reports network failures via toast and rethrows', async () => {
    global.fetch.mockRejectedValue(new Error('Network error'));

    await expect(loadCanadaLifeAccounts()).rejects.toThrow('Network error');
    expect(toast.show).toHaveBeenCalledWith('Failed to load Canada Life accounts: Network error', 'error');
  });

  test('suppresses all toasts when silent is set', async () => {
    global.fetch.mockRejectedValue(new Error('Network error'));

    await expect(loadCanadaLifeAccounts({ silent: true })).rejects.toThrow('Network error');
    expect(toast.show).not.toHaveBeenCalled();
  });

  test('suppresses success toasts when silent is set', async () => {
    mockAccountsApiFetch();

    await loadCanadaLifeAccounts({ silent: true });

    expect(toast.show).not.toHaveBeenCalled();
  });

  test('accepts an options object with forceRefresh', async () => {
    mockAccountsApiFetch();

    const result = await loadCanadaLifeAccounts({ forceRefresh: true, silent: true });

    expect(global.fetch).toHaveBeenCalled();
    expect(result).toHaveLength(2);
  });

  test('supports the legacy boolean signature', async () => {
    global.fetch.mockRejectedValue(new Error('Network error'));

    await expect(loadCanadaLifeAccounts(false)).rejects.toThrow('Network error');
    expect(toast.show).toHaveBeenCalledWith('Failed to load Canada Life accounts: Network error', 'error');
  });

  // Regression test for the original report: every call was routed through the
  // licence-gated Vlocity controller, so account loading died on the first call
  // with a misleading "No return value in Canada Life API response".
  test('reports a license exception with an actionable message', async () => {
    global.fetch.mockResolvedValue(mockFetchResponse(buildLicenseExceptionResponse()));

    await expect(loadCanadaLifeAccounts()).rejects.toThrow(/Canada Life changed their portal API/);
    expect(toast.show).toHaveBeenCalledWith(
      expect.stringContaining('Failed to load Canada Life accounts'),
      'error',
    );
  });
});