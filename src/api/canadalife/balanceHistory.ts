/**
 * Canada Life historical balance loading.
 *
 * Canada Life exposes only per-date-range activity reports, so a balance
 * history has to be assembled from many calls. Two optimisations halve the
 * request count:
 *
 * 1. **Weekends are skipped** — unit values do not change on non-business days,
 *    so weekend balances are back-filled from the preceding business day.
 * 2. **Two days per call** — a report's *opening* balance equals the previous
 *    business day's *closing* balance, so requesting every other business day
 *    yields both.
 *
 * @module api/canadalife/balanceHistory
 */

import { debugLog, parseLocalDate, formatDate } from '../../core/utils';
import toast from '../../ui/toast';
import { loadAccountActivityReport } from './activityReports';
import type { BalanceHistoryData, CanadaLifeAccount } from './types';

/** CSV header row prepended to the balance data */
const HEADER_ROW: [string, string, string] = ['Date', 'Closing Balance', 'Account Name'];

/** Progress callback signature */
type ProgressCallback = (current: number, total: number, percentage: number) => void;

/**
 * Check whether a date falls on a Saturday or Sunday.
 * @param date - Date to test
 * @returns True for weekend days
 */
function isWeekend(date: Date): boolean {
  const dayOfWeek = date.getDay();
  return dayOfWeek === 0 || dayOfWeek === 6;
}

/**
 * List every day between two dates, optionally excluding weekends.
 * @param startDate - Start date in YYYY-MM-DD format
 * @param endDate - End date in YYYY-MM-DD format
 * @param businessOnly - When true, weekends are omitted
 * @returns Array of dates in YYYY-MM-DD format
 */
function generateDays(startDate: string, endDate: string, businessOnly: boolean): string[] {
  const days: string[] = [];
  const current = parseLocalDate(startDate);
  const end = parseLocalDate(endDate);

  while (current <= end) {
    if (!businessOnly || !isWeekend(current)) {
      days.push(formatDate(current));
    }
    current.setDate(current.getDate() + 1);
  }

  return days;
}

/**
 * Validate the arguments for a balance history request.
 * @param account - Canada Life account object
 * @param startDate - Start date in YYYY-MM-DD format
 * @param endDate - End date in YYYY-MM-DD format
 * @throws If the account is unusable or the range is invalid
 */
function validateBalanceHistoryArgs(
  account: CanadaLifeAccount,
  startDate: string,
  endDate: string,
): void {
  if (!account || !account.EnglishShortName || !account.agreementId) {
    throw new Error('Invalid account object provided');
  }

  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    throw new Error('Start date must be in YYYY-MM-DD format');
  }

  if (!endDate || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new Error('End date must be in YYYY-MM-DD format');
  }

  if (new Date(startDate) > new Date(endDate)) {
    throw new Error('Start date must be before or equal to end date');
  }
}

/**
 * Build the empty result returned when a range contains no business days
 * (for example a weekend-only sync).
 *
 * @param account - Canada Life account object
 * @param startDate - Start date in YYYY-MM-DD format
 * @param endDate - End date in YYYY-MM-DD format
 * @returns Balance history containing only the header row
 */
function buildEmptyResult(
  account: CanadaLifeAccount,
  startDate: string,
  endDate: string,
): BalanceHistoryData {
  return {
    data: [HEADER_ROW],
    account: {
      shortName: account.EnglishShortName,
      name: account.LongNameEnglish || account.EnglishShortName,
      agreementId: account.agreementId,
    },
    dateRange: { startDate, endDate },
    totalDays: 0,
    businessDays: 0,
    apiCallsMade: 0,
  };
}

/**
 * Fetch balances for every business day, requesting every other day and using
 * each report's opening balance to fill in the day before it.
 *
 * Per-day failures are warned about and skipped rather than aborting the sync.
 *
 * @param account - Canada Life account object
 * @param businessDays - Business days to cover, in ascending order
 * @param progressCallback - Optional progress reporter
 * @param signal - Optional abort signal
 * @returns Map of date → closing balance, plus the number of API calls made
 */
async function fetchBalancesForBusinessDays(
  account: CanadaLifeAccount,
  businessDays: string[],
  progressCallback: ProgressCallback | null,
  signal: AbortSignal | null,
): Promise<{ balanceMap: Map<string, number>; apiCallsMade: number }> {
  const balanceMap = new Map<string, number>();
  let apiCallsMade = 0;

  for (let i = 0; i < businessDays.length; i += 2) {
    if (signal?.aborted) {
      throw new Error('Operation cancelled by user');
    }

    const currentDate = businessDays[i];

    try {
      if (progressCallback) {
        const currentProgress = Math.min(i + 1, businessDays.length);
        const percentage = Math.round((currentProgress / businessDays.length) * 100);
        progressCallback(currentProgress, businessDays.length, percentage);
      }

      debugLog(`Making API call for ${currentDate}`);
      const balanceData = await loadAccountActivityReport(account, currentDate, currentDate, signal);
      apiCallsMade += 1;

      debugLog(`Received balance data for ${currentDate}:`, {
        opening: balanceData.openingBalance,
        closing: balanceData.closingBalance,
      });

      balanceMap.set(currentDate, balanceData.closingBalance);

      // A report's opening balance is the previous business day's closing balance
      if (i > 0 && !balanceMap.has(businessDays[i - 1])) {
        const prevBusinessDay = businessDays[i - 1];
        debugLog(`Adding previous day ${prevBusinessDay} with opening balance ${balanceData.openingBalance}`);
        balanceMap.set(prevBusinessDay, balanceData.openingBalance);
      }
    } catch (error) {
      debugLog(`Error loading balance for ${currentDate}:`, error);
      toast.show(`Warning: Could not load balance for ${currentDate}`, 'warning');
    }
  }

  return { balanceMap, apiCallsMade };
}

/**
 * Fetch any business days the paired-call optimisation left uncovered
 * (which happens when a paired call failed).
 *
 * @param account - Canada Life account object
 * @param businessDays - All business days in the range
 * @param balanceMap - Balances gathered so far (mutated)
 * @returns Number of additional API calls made
 */
async function fetchMissingBusinessDays(
  account: CanadaLifeAccount,
  businessDays: string[],
  balanceMap: Map<string, number>,
): Promise<number> {
  let apiCallsMade = 0;

  for (const businessDay of businessDays) {
    if (balanceMap.has(businessDay)) {
      continue;
    }

    debugLog(`Processing missing day: ${businessDay}`);
    try {
      const balanceData = await loadAccountActivityReport(account, businessDay, businessDay);
      apiCallsMade += 1;
      balanceMap.set(businessDay, balanceData.closingBalance);
      debugLog(`Added missing day balance: ${businessDay} = ${balanceData.closingBalance}`);
    } catch (error) {
      debugLog(`Error loading balance for missing day ${businessDay}:`, error);
      toast.show(`Warning: Could not load balance for ${businessDay}`, 'warning');
    }
  }

  return apiCallsMade;
}

/**
 * Expand business-day balances across every calendar day, carrying the last
 * known balance forward through weekends.
 *
 * @param allDays - Every calendar day in the range, ascending
 * @param businessDayBalances - Map of business day → closing balance
 * @param accountName - Account short name for the third CSV column
 * @returns Data rows covering every day that has a known balance
 */
function extendBalancesAcrossWeekends(
  allDays: string[],
  businessDayBalances: Map<string, number | string>,
  accountName: string,
): Array<[string, number | string, string]> {
  const extendedRows: Array<[string, number | string, string]> = [];
  let lastBusinessDayBalance: number | string | null = null;

  for (const currentDate of allDays) {
    if (businessDayBalances.has(currentDate)) {
      const balance = businessDayBalances.get(currentDate)!;
      extendedRows.push([currentDate, balance, accountName]);
      lastBusinessDayBalance = balance;
      debugLog(`Added business day: ${currentDate} = ${balance}`);
    } else if (lastBusinessDayBalance !== null) {
      extendedRows.push([currentDate, lastBusinessDayBalance, accountName]);
      debugLog(`Extended weekend: ${currentDate} = ${lastBusinessDayBalance} (carried from previous business day)`);
    } else {
      debugLog(`Warning: No previous business day balance to extend for ${currentDate}`);
    }
  }

  return extendedRows;
}

/**
 * Load historical account balances for a date range.
 *
 * @param account - Canada Life account object
 * @param startDate - Start date in YYYY-MM-DD format
 * @param endDate - End date in YYYY-MM-DD format
 * @param progressCallback - Optional progress callback (current, total, percentage)
 * @param signal - Optional abort signal for cancellation support
 * @returns Balance history with a CSV-style header row followed by daily rows
 */
export async function loadAccountBalanceHistory(
  account: CanadaLifeAccount,
  startDate: string,
  endDate: string,
  progressCallback: ProgressCallback | null = null,
  signal: AbortSignal | null = null,
): Promise<BalanceHistoryData> {
  try {
    debugLog('Loading historical account balance:', {
      account: account?.EnglishShortName,
      startDate,
      endDate,
    });

    validateBalanceHistoryArgs(account, startDate, endDate);

    const businessDays = generateDays(startDate, endDate, true);
    debugLog(`Generated ${businessDays.length} business days to process`);

    if (businessDays.length === 0) {
      debugLog('No business days in date range, returning empty result');
      return buildEmptyResult(account, startDate, endDate);
    }

    // Gather closing balances for every business day
    const balanceMap = new Map<string, number>();
    let apiCallsMade = 0;

    if (businessDays.length === 1) {
      progressCallback?.(0, 1, 0);

      const balanceData = await loadAccountActivityReport(account, businessDays[0], businessDays[0], signal);
      apiCallsMade = 1;
      balanceMap.set(businessDays[0], balanceData.closingBalance);

      progressCallback?.(1, 1, 100);
    } else {
      debugLog(`Processing ${businessDays.length} business days with optimization: ${businessDays}`);

      const paired = await fetchBalancesForBusinessDays(account, businessDays, progressCallback, signal);
      paired.balanceMap.forEach((balance, date) => balanceMap.set(date, balance));
      apiCallsMade += paired.apiCallsMade;

      debugLog('Balance map after optimization:', Array.from(balanceMap.entries()));

      apiCallsMade += await fetchMissingBusinessDays(account, businessDays, balanceMap);

      debugLog('Final balance map:', Array.from(balanceMap.entries()));

      progressCallback?.(businessDays.length, businessDays.length, 100);
    }

    // Carry business-day balances across weekends to produce a daily series
    const allDays = generateDays(startDate, endDate, false);
    const businessDayBalances = new Map<string, number | string>(
      businessDays
        .filter((day) => balanceMap.has(day))
        .map((day) => [day, balanceMap.get(day)!]),
    );

    debugLog('Extending weekend data:', {
      allDaysCount: allDays.length,
      businessDaysCount: businessDayBalances.size,
      businessDates: Array.from(businessDayBalances.keys()),
    });

    const extendedRows = extendBalancesAcrossWeekends(
      allDays,
      businessDayBalances,
      account.EnglishShortName,
    );

    const result: BalanceHistoryData = {
      data: [HEADER_ROW, ...extendedRows],
      account: {
        shortName: account.EnglishShortName,
        name: account.LongNameEnglish || account.EnglishShortName,
        agreementId: account.agreementId,
      },
      dateRange: { startDate, endDate },
      totalDays: allDays.length,
      businessDays: businessDays.length,
      apiCallsMade,
    };

    debugLog('Successfully loaded historical account balance:', {
      account: account.EnglishShortName,
      totalDays: result.totalDays,
      apiCallsMade: result.apiCallsMade,
      optimizationRatio: `${Math.round((1 - apiCallsMade / businessDays.length) * 100)}% fewer API calls`,
    });

    return result;
  } catch (error) {
    debugLog('Error loading historical account balance:', error);
    throw error;
  }
}