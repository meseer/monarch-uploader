/**
 * Canada Life API — historical balance assembly
 */

import { loadAccountBalanceHistory } from '../../../src/api/canadalife';

import stateManager from '../../../src/core/state';
import { installCanadaLifeTestGlobals } from './harness';
import { DPSP_AGREEMENT_ID, buildActivityReportResponse, mockFetchResponse } from './fixtures';

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

const HEADER = ['Date', 'Closing Balance', 'Account Name'];

/** Queue a single report response with the given opening/closing balances */
function mockReport(openingBalance, closingBalance) {
  global.fetch.mockResolvedValueOnce(mockFetchResponse(buildActivityReportResponse({
    openingBalance,
    closingBalance,
    activities: null,
  })));
}

/** Respond to every call with the same balances */
function mockAllReports(openingBalance, closingBalance) {
  global.fetch.mockResolvedValue(mockFetchResponse(buildActivityReportResponse({
    openingBalance,
    closingBalance,
    activities: null,
  })));
}

describe('Canada Life API - loadAccountBalanceHistory weekend-only ranges', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stateManager.getState.mockReturnValue({
      auth: { canadalife: { token: 'valid-aura-token' } },
    });
  });

  test.each([
    ['a Saturday and Sunday', '2026-02-07', '2026-02-08'],
    ['a single Saturday', '2026-02-07', '2026-02-07'],
    ['a single Sunday', '2026-02-08', '2026-02-08'],
  ])('returns only the header for %s', async (_label, startDate, endDate) => {
    const result = await loadAccountBalanceHistory(mockAccount, startDate, endDate);

    expect(result.data).toEqual([HEADER]);
    expect(result.businessDays).toBe(0);
    expect(result.totalDays).toBe(0);
    expect(result.apiCallsMade).toBe(0);
    expect(result.dateRange).toEqual({ startDate, endDate });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('Canada Life API - loadAccountBalanceHistory single day', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stateManager.getState.mockReturnValue({
      auth: { canadalife: { token: 'valid-aura-token' } },
    });
  });

  test('includes the requested business day', async () => {
    mockReport(10000, 10100);

    const result = await loadAccountBalanceHistory(mockAccount, '2024-01-15', '2024-01-15');

    expect(result.data).toEqual([HEADER, ['2024-01-15', 10100, 'DPSP']]);
    expect(result.totalDays).toBe(1);
    expect(result.businessDays).toBe(1);
    expect(result.apiCallsMade).toBe(1);
  });

  test('reports progress at start and completion', async () => {
    mockReport(10000, 10100);
    const progress = jest.fn();

    await loadAccountBalanceHistory(mockAccount, '2024-01-15', '2024-01-15', progress);

    expect(progress).toHaveBeenCalledWith(0, 1, 0);
    expect(progress).toHaveBeenCalledWith(1, 1, 100);
  });
});

describe('Canada Life API - loadAccountBalanceHistory paired-call optimisation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stateManager.getState.mockReturnValue({
      auth: { canadalife: { token: 'valid-aura-token' } },
    });
  });

  // Requests are made for every other business day; the report for day i also
  // yields day i-1, because its opening balance is that day's closing balance.
  test('fills the skipped day from the next report opening balance', async () => {
    mockReport(9800, 9900); // Mon: closing 9900
    mockReport(9900, 10100); // Wed: opening 9900 → Tue, closing 10100 → Wed

    const result = await loadAccountBalanceHistory(mockAccount, '2024-01-15', '2024-01-17');

    expect(result.data.slice(1)).toEqual([
      ['2024-01-15', 9900, 'DPSP'],
      ['2024-01-16', 9900, 'DPSP'],
      ['2024-01-17', 10100, 'DPSP'],
    ]);
    // Three days covered by two calls
    expect(result.apiCallsMade).toBe(2);
    expect(result.totalDays).toBe(3);
  });

  test('needs only one call for a two-day range', async () => {
    mockReport(10000, 10100);

    const result = await loadAccountBalanceHistory(mockAccount, '2024-01-16', '2024-01-17');

    const dates = result.data.slice(1).map((row) => row[0]);
    expect(dates).toEqual(['2024-01-16', '2024-01-17']);
    expect(result.apiCallsMade).toBe(1);
    expect(result.totalDays).toBe(2);
  });

  test('covers a full Monday-to-Friday week', async () => {
    mockAllReports(9900, 10000);

    const result = await loadAccountBalanceHistory(mockAccount, '2024-01-15', '2024-01-19');

    const dates = result.data.slice(1).map((row) => row[0]);
    expect(dates).toEqual([
      '2024-01-15', '2024-01-16', '2024-01-17', '2024-01-18', '2024-01-19',
    ]);
    expect(result.businessDays).toBe(5);
    expect(result.totalDays).toBe(5);
  });

  test('reports progress across the range', async () => {
    mockAllReports(9900, 10000);
    const progress = jest.fn();

    await loadAccountBalanceHistory(mockAccount, '2024-01-15', '2024-01-19', progress);

    expect(progress).toHaveBeenCalledWith(5, 5, 100);
  });

  test('re-fetches days a failed paired call left uncovered', async () => {
    // The Monday call fails, leaving Mon and Tue uncovered by the paired pass
    global.fetch.mockRejectedValueOnce(new Error('Network error'));
    mockReport(9800, 9900); // Wed, filling Tue from its opening balance
    mockReport(9700, 9800); // recovery call for Mon

    const result = await loadAccountBalanceHistory(mockAccount, '2024-01-15', '2024-01-17');

    expect(result.data.slice(1)).toEqual([
      ['2024-01-15', 9800, 'DPSP'],
      ['2024-01-16', 9800, 'DPSP'],
      ['2024-01-17', 9900, 'DPSP'],
    ]);
    // Two successful calls plus the recovery call for the failed day
    expect(result.apiCallsMade).toBe(2);
  });

  // A day whose call fails and which cannot be derived is filled by carrying
  // the previous day's balance forward rather than being dropped.
  test('carries a balance forward for a day that could not be fetched', async () => {
    mockReport(9800, 9900); // Mon succeeds
    global.fetch.mockRejectedValue(new Error('Network error')); // Wed and its retry fail

    const result = await loadAccountBalanceHistory(mockAccount, '2024-01-15', '2024-01-17');

    expect(result.data.slice(1)).toEqual([
      ['2024-01-15', 9900, 'DPSP'],
      ['2024-01-16', 9900, 'DPSP'],
      ['2024-01-17', 9900, 'DPSP'],
    ]);
    expect(result.apiCallsMade).toBe(1);
  });
});

describe('Canada Life API - loadAccountBalanceHistory weekend extension', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stateManager.getState.mockReturnValue({
      auth: { canadalife: { token: 'valid-aura-token' } },
    });
  });

  // Unit values do not change on non-business days, so weekend rows carry the
  // preceding Friday's balance forward.
  test('carries Friday balance across Saturday and Sunday', async () => {
    mockAllReports(9900, 10000);

    // Friday 2024-01-19 → Monday 2024-01-22
    const result = await loadAccountBalanceHistory(mockAccount, '2024-01-19', '2024-01-22');

    const rows = result.data.slice(1);
    expect(rows.map((row) => row[0])).toEqual([
      '2024-01-19', '2024-01-20', '2024-01-21', '2024-01-22',
    ]);
    // Saturday and Sunday reuse Friday's closing balance
    expect(rows[1][1]).toBe(rows[0][1]);
    expect(rows[2][1]).toBe(rows[0][1]);
    expect(result.businessDays).toBe(2);
    expect(result.totalDays).toBe(4);
  });

  test('omits leading weekend days that have no prior balance', async () => {
    mockAllReports(9900, 10000);

    // Saturday start — nothing to carry forward until Monday
    const result = await loadAccountBalanceHistory(mockAccount, '2024-01-20', '2024-01-22');

    const dates = result.data.slice(1).map((row) => row[0]);
    expect(dates).toEqual(['2024-01-22']);
  });
});

describe('Canada Life API - loadAccountBalanceHistory validation and cancellation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stateManager.getState.mockReturnValue({
      auth: { canadalife: { token: 'valid-aura-token' } },
    });
  });

  test.each([
    ['a null account', null, '2024-01-15', '2024-01-16'],
    ['an empty account', {}, '2024-01-15', '2024-01-16'],
    ['a malformed start date', mockAccount, 'nope', '2024-01-16'],
    ['a malformed end date', mockAccount, '2024-01-15', 'nope'],
    ['an inverted range', mockAccount, '2024-01-16', '2024-01-15'],
  ])('rejects %s', async (_label, account, startDate, endDate) => {
    await expect(loadAccountBalanceHistory(account, startDate, endDate)).rejects.toThrow();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('aborts before making any request when already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      loadAccountBalanceHistory(mockAccount, '2024-01-15', '2024-01-19', null, controller.signal),
    ).rejects.toThrow('Operation cancelled by user');

    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('returns account metadata alongside the data', async () => {
    mockReport(10000, 10100);

    const result = await loadAccountBalanceHistory(mockAccount, '2024-01-15', '2024-01-15');

    expect(result.account).toEqual({
      shortName: 'DPSP',
      name: 'DEFERRED PROFIT SHARING PLAN',
      agreementId: DPSP_AGREEMENT_ID,
    });
  });
});