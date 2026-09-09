/**
 * Canada Life API — activity reports (balances + transactions for a range)
 */

import {
  loadAccountActivityReport,
  CanadaLifeApiError,
} from '../../../src/api/canadalife';

import stateManager from '../../../src/core/state';
import { debugLog } from '../../../src/core/utils';
import { installCanadaLifeTestGlobals, readActionParams } from './harness';
import {
  DPSP_AGREEMENT_ID,
  buildActivities,
  buildActivityReportFailureResponse,
  buildActivityReportResponse,
  buildLicenseExceptionResponse,
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

const mockAccount = {
  agreementId: DPSP_AGREEMENT_ID,
  EnglishShortName: 'DPSP',
  LongNameEnglish: 'DEFERRED PROFIT SHARING PLAN',
};

/** Build a legacy Vlocity activity report response */
function buildLegacyReportResponse(openingBalance, closingBalance, activities = []) {
  return wrapAuraSuccess({
    IPResult: {
      Summary: {
        Total: { Value: closingBalance },
        Details: [{ Description: 'Value of this plan on 2024-01-15', Value: openingBalance }],
      },
      Activities: activities,
    },
  }, '184;a');
}

describe('Canada Life API - loadAccountActivityReport request shape', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stateManager.getState.mockReturnValue({
      auth: { canadalife: { token: 'valid-aura-token' } },
    });
  });

  // Canada Life moved this off the licence-gated
  // vlocity_ins.BusinessProcessDisplayController onto their own controller.
  test('calls the non-namespaced MclawGrsaActivityPlansController', async () => {
    global.fetch.mockResolvedValue(mockFetchResponse(buildActivityReportResponse()));

    await loadAccountActivityReport(mockAccount, '2026-08-21', '2026-09-08');

    const params = readActionParams();
    expect(params.namespace).toBe('');
    expect(params.classname).toBe('MclawGrsaActivityPlansController');
    expect(params.method).toBe('getActivityReportByPlanCode');
  });

  // The new controller keys off agreementId alone; planCode is no longer sent.
  test('sends language, agreementId and the date range', async () => {
    global.fetch.mockResolvedValue(mockFetchResponse(buildActivityReportResponse()));

    await loadAccountActivityReport(mockAccount, '2026-08-21', '2026-09-08');

    expect(readActionParams().params).toEqual({
      language: 'en',
      agreementId: DPSP_AGREEMENT_ID,
      startDate: '2026-08-21',
      endDate: '2026-09-08',
    });
  });

  test('no longer sends the retired Vlocity integration-procedure fields', async () => {
    global.fetch.mockResolvedValue(mockFetchResponse(buildActivityReportResponse()));

    await loadAccountActivityReport(mockAccount, '2026-08-21', '2026-09-08');

    const params = readActionParams();
    expect(params.params).not.toHaveProperty('input');
    expect(params.params).not.toHaveProperty('sClassName');
    expect(params.params).not.toHaveProperty('planCode');
    expect(params.params).not.toHaveProperty('grsAgreementId');
  });

  test('forwards the abort signal', async () => {
    const { signal } = new AbortController();
    global.fetch.mockResolvedValue(mockFetchResponse(buildActivityReportResponse()));

    await loadAccountActivityReport(mockAccount, '2026-08-21', '2026-09-08', signal);

    expect(global.fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ signal }));
  });
});

describe('Canada Life API - loadAccountActivityReport parsing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stateManager.getState.mockReturnValue({
      auth: { canadalife: { token: 'valid-aura-token' } },
    });
  });

  test('reads balances and activities from activityReportMap.data', async () => {
    global.fetch.mockResolvedValue(mockFetchResponse(buildActivityReportResponse()));

    const result = await loadAccountActivityReport(mockAccount, '2026-08-21', '2026-09-08');

    expect(result).toEqual({
      account: {
        name: 'DEFERRED PROFIT SHARING PLAN',
        shortName: 'DPSP',
        agreementId: DPSP_AGREEMENT_ID,
      },
      date: '2026-09-08',
      startDate: '2026-08-21',
      endDate: '2026-09-08',
      openingBalance: 153387.73,
      closingBalance: 154421.97,
      change: expect.closeTo(1034.24, 2),
      activities: buildActivities(),
      rawResponse: expect.any(Object),
    });
  });

  // The Activities[] row shape is unchanged from the Vlocity era. This matters
  // because generateActivityHash() derives dedup IDs from these exact field
  // names — a rename would orphan every previously uploaded transaction.
  test('returns activity rows with their original field names intact', async () => {
    global.fetch.mockResolvedValue(mockFetchResponse(buildActivityReportResponse()));

    const { activities } = await loadAccountActivityReport(mockAccount, '2026-08-21', '2026-09-08');

    expect(activities).toHaveLength(2);
    expect(activities[0]).toEqual({
      InvestmentVehicleAndAccountLongName: 'International Equity Index (TDAM)-Employer',
      IsStockFund: false,
      Date: '2026-08-28T00:00:00',
      Activity: 'New contribution',
      Amount: 193.92,
      InterestRateOrUnitPrice: 378.429806,
      Units: 0.512433,
    });
  });

  test('returns an empty activities array for a quiet period', async () => {
    global.fetch.mockResolvedValue(mockFetchResponse(buildActivityReportResponse({
      activities: null,
      openingBalance: 155254.27,
      closingBalance: 154421.97,
    })));

    const result = await loadAccountActivityReport(mockAccount, '2026-09-01', '2026-09-08');

    expect(result.activities).toEqual([]);
    expect(result.openingBalance).toBe(155254.27);
    expect(result.closingBalance).toBe(154421.97);
  });

  test('matches the opening balance row case-insensitively', async () => {
    global.fetch.mockResolvedValue(mockFetchResponse(buildActivityReportResponse({
      openingBalance: 1000,
      closingBalance: 1100,
      startDate: 'January 15, 2024',
    })));

    const result = await loadAccountActivityReport(mockAccount, '2024-01-15', '2024-01-16');

    expect(result.openingBalance).toBe(1000);
    expect(result.change).toBe(100);
  });

  test('falls back to the first detail row when the description does not match', async () => {
    global.fetch.mockResolvedValue(mockFetchResponse(wrapAuraSuccess({
      activityReportMap: {
        success: true,
        data: {
          Summary: {
            Total: { Value: 10100 },
            Details: [{ Description: 'Some other description', Value: 10000 }],
          },
        },
      },
      isSuccess: true,
    }, '180;a')));

    const result = await loadAccountActivityReport(mockAccount, '2024-01-15', '2024-01-15');

    expect(result.openingBalance).toBe(10000);
    expect(debugLog).toHaveBeenCalledWith('Using first Details entry as opening balance (pattern match failed)');
  });

  test('still reads the legacy IPResult shape', async () => {
    global.fetch.mockResolvedValue(mockFetchResponse(
      buildLegacyReportResponse(10000, 10100, buildActivities()),
    ));

    const result = await loadAccountActivityReport(mockAccount, '2024-01-15', '2024-01-15');

    expect(result.openingBalance).toBe(10000);
    expect(result.closingBalance).toBe(10100);
    expect(result.activities).toHaveLength(2);
  });

  test('unwraps /*-secure- wrapped report responses', async () => {
    global.fetch.mockResolvedValue(mockFetchResponse(buildActivityReportResponse(), true));

    const result = await loadAccountActivityReport(mockAccount, '2026-08-21', '2026-09-08');

    expect(result.closingBalance).toBe(154421.97);
  });
});

describe('Canada Life API - loadAccountActivityReport validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stateManager.getState.mockReturnValue({
      auth: { canadalife: { token: 'valid-aura-token' } },
    });
  });

  test.each([
    ['a null account', null, '2024-01-15', '2024-01-15'],
    ['an empty account', {}, '2024-01-15', '2024-01-15'],
    ['a malformed start date', mockAccount, 'invalid-date', '2024-01-15'],
    ['a null start date', mockAccount, null, '2024-01-15'],
    ['a null end date', mockAccount, '2024-01-15', null],
    ['a malformed end date', mockAccount, '2024-01-15', 'invalid-date'],
  ])('rejects %s', async (_label, account, startDate, endDate) => {
    await expect(loadAccountActivityReport(account, startDate, endDate)).rejects.toThrow();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('throws when neither response shape is present', async () => {
    global.fetch.mockResolvedValue(mockFetchResponse(wrapAuraSuccess({ isSuccess: true }, '180;a')));

    await expect(loadAccountActivityReport(mockAccount, '2024-01-15', '2024-01-15'))
      .rejects.toThrow(/No activity report data found/);
  });

  test('throws when the Summary block is missing', async () => {
    global.fetch.mockResolvedValue(mockFetchResponse(wrapAuraSuccess({
      activityReportMap: { success: true, data: { PlanShortName: 'DPSP' } },
      isSuccess: true,
    }, '180;a')));

    await expect(loadAccountActivityReport(mockAccount, '2024-01-15', '2024-01-15'))
      .rejects.toThrow(CanadaLifeApiError);
  });

  test('throws when the closing balance is not numeric', async () => {
    global.fetch.mockResolvedValue(mockFetchResponse(wrapAuraSuccess({
      activityReportMap: {
        success: true,
        data: { Summary: { Total: {}, Details: [{ Value: 100 }] } },
      },
      isSuccess: true,
    }, '180;a')));

    await expect(loadAccountActivityReport(mockAccount, '2024-01-15', '2024-01-15'))
      .rejects.toThrow(/Could not extract closing balance/);
  });

  test('throws when no opening balance can be derived', async () => {
    global.fetch.mockResolvedValue(mockFetchResponse(wrapAuraSuccess({
      activityReportMap: {
        success: true,
        data: { Summary: { Total: { Value: 100 }, Details: [] } },
      },
      isSuccess: true,
    }, '180;a')));

    await expect(loadAccountActivityReport(mockAccount, '2024-01-15', '2024-01-15'))
      .rejects.toThrow(/Could not extract opening balance/);
  });
});

describe('Canada Life API - loadAccountActivityReport errors', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stateManager.getState.mockReturnValue({
      auth: { canadalife: { token: 'valid-aura-token' } },
    });
  });

  // Canada Life caps report ranges at one calendar year and reports the
  // violation as success:false with HTTP 200.
  test('surfaces the server-side one-year range limit message', async () => {
    global.fetch.mockResolvedValue(mockFetchResponse(buildActivityReportFailureResponse()));

    await expect(loadAccountActivityReport(mockAccount, '2024-01-01', '2026-01-01'))
      .rejects.toThrow(/not more than a year/);
  });

  test('surfaces a license exception with an actionable message', async () => {
    global.fetch.mockResolvedValue(mockFetchResponse(buildLicenseExceptionResponse()));

    await expect(loadAccountActivityReport(mockAccount, '2026-08-21', '2026-09-08'))
      .rejects.toThrow(/Canada Life changed their portal API/);
  });
});
