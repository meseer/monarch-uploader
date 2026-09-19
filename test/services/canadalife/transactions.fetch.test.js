/**
 * Tests for Canada Life activity fetching (chunked date ranges)
 *
 * Focus: the completeness signal. A chunk request that fails used to be toasted
 * and then silently dropped, so the caller received a partial activity list it
 * believed was authoritative and reconciliation deleted every pending Monarch
 * transaction that happened to live in the missing chunk.
 */

import { fetchActivitiesForDateRange, fetchAndProcessTransactions } from '../../../src/services/canadalife/transactions';

jest.mock('../../../src/api/canadalife', () => ({
  __esModule: true,
  default: {
    loadAccountActivityReport: jest.fn(),
  },
}));

jest.mock('../../../src/ui/toast', () => ({
  __esModule: true,
  default: {
    show: jest.fn(),
  },
}));

const getCanadaLifeApi = () => require('../../../src/api/canadalife').default;
const getToast = () => require('../../../src/ui/toast').default;

const account = {
  EnglishShortName: 'RRSP',
  LongNameEnglish: 'Registered Retirement Savings Plan',
};

const makeActivity = (name, amount) => ({
  Date: '2026-03-01',
  Activity: name,
  Amount: amount,
  InvestmentVehicleAndAccountLongName: 'Canadian Equity Index (TDAM)-Member',
  Units: 10,
  InterestRateOrUnitPrice: 5,
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('fetchActivitiesForDateRange', () => {
  test('reports complete: true with no failed chunks on a fully successful fetch', async () => {
    const canadalife = getCanadaLifeApi();
    canadalife.loadAccountActivityReport.mockResolvedValue({
      activities: [makeActivity('New contribution', 100)],
    });

    const result = await fetchActivitiesForDateRange(account, '2026-01-01', '2026-03-01');

    expect(result.complete).toBe(true);
    expect(result.failedChunks).toEqual([]);
    expect(result.activities).toHaveLength(1);
  });

  test('reports complete: false and the failing range when a chunk request throws', async () => {
    const canadalife = getCanadaLifeApi();
    // 3 calendar-year chunks: first succeeds, second fails, third succeeds
    canadalife.loadAccountActivityReport
      .mockResolvedValueOnce({ activities: [makeActivity('New contribution', 100)] })
      .mockRejectedValueOnce(new Error('HTTP 500'))
      .mockResolvedValueOnce({ activities: [makeActivity('You switched from another investment', 50)] });

    const result = await fetchActivitiesForDateRange(account, '2023-01-01', '2026-01-01');

    expect(canadalife.loadAccountActivityReport).toHaveBeenCalledTimes(3);
    expect(result.complete).toBe(false);
    expect(result.failedChunks).toHaveLength(1);
    expect(result.failedChunks[0]).toEqual(
      expect.objectContaining({ start: '2024-01-02', end: '2025-01-02', error: 'HTTP 500' }),
    );
    // The surviving chunks' activities are still returned — just flagged as partial
    expect(result.activities).toHaveLength(2);
  });

  test('still warns the user about a failed chunk', async () => {
    const canadalife = getCanadaLifeApi();
    const toast = getToast();
    canadalife.loadAccountActivityReport.mockRejectedValue(new Error('timeout'));

    const result = await fetchActivitiesForDateRange(account, '2026-01-01', '2026-02-01');

    expect(toast.show).toHaveBeenCalledWith(
      expect.stringContaining('Could not fetch activities'),
      'warning',
    );
    expect(result.complete).toBe(false);
  });

  test('records a fallback message when the failure carries no message', async () => {
    const canadalife = getCanadaLifeApi();
    canadalife.loadAccountActivityReport.mockRejectedValue(new Error(''));

    const result = await fetchActivitiesForDateRange(account, '2026-01-01', '2026-02-01');

    expect(result.failedChunks[0].error).toBe('Unknown error');
  });

  test('deduplicates activities repeated across chunk boundaries', async () => {
    const canadalife = getCanadaLifeApi();
    const duplicated = makeActivity('New contribution', 100);
    canadalife.loadAccountActivityReport
      .mockResolvedValueOnce({ activities: [duplicated] })
      .mockResolvedValueOnce({ activities: [{ ...duplicated }] });

    const result = await fetchActivitiesForDateRange(account, '2024-01-01', '2026-01-01');

    expect(result.activities).toHaveLength(1);
    expect(result.complete).toBe(true);
  });

  test('treats a missing activities field as an empty chunk, not a failure', async () => {
    const canadalife = getCanadaLifeApi();
    canadalife.loadAccountActivityReport.mockResolvedValue({});

    const result = await fetchActivitiesForDateRange(account, '2026-01-01', '2026-02-01');

    expect(result.activities).toEqual([]);
    expect(result.complete).toBe(true);
  });

  test('propagates cancellation instead of recording it as a failed chunk', async () => {
    const canadalife = getCanadaLifeApi();
    const controller = new AbortController();
    controller.abort();

    await expect(
      fetchActivitiesForDateRange(account, '2026-01-01', '2026-02-01', { signal: controller.signal }),
    ).rejects.toThrow('Operation cancelled by user');
    expect(canadalife.loadAccountActivityReport).not.toHaveBeenCalled();
  });

  test('reports progress per chunk', async () => {
    const canadalife = getCanadaLifeApi();
    canadalife.loadAccountActivityReport.mockResolvedValue({
      activities: [makeActivity('New contribution', 100)],
    });
    const onProgress = jest.fn();

    await fetchActivitiesForDateRange(account, '2026-01-01', '2026-02-01', { onProgress });

    expect(onProgress).toHaveBeenCalledWith(1, 1, 1);
  });
});

describe('fetchAndProcessTransactions', () => {
  test('still resolves to processed transactions from the fetched activities', async () => {
    const canadalife = getCanadaLifeApi();
    canadalife.loadAccountActivityReport.mockResolvedValue({
      activities: [makeActivity('New contribution', 100)],
    });

    const transactions = await fetchAndProcessTransactions(account, '2026-01-01', '2026-02-01');

    expect(Array.isArray(transactions)).toBe(true);
    expect(transactions).toHaveLength(1);
    expect(transactions[0].merchant).toBe('Canadian Equity Index (TDAM)');
  });
});
