/**
 * Canada Life activity reports (balances + transactions for a date range).
 *
 * As of 2026 this is served by `MclawGrsaActivityPlansController`. The retired
 * Vlocity route (`grsa_GetActivityReportsByPlanCode`) now fails with
 * `System.LicenseException`.
 *
 * The response `Summary` and `Activities` shapes are unchanged from the Vlocity
 * era; only their location in the envelope moved
 * (`IPResult.*` → `activityReportMap.data.*`). Keeping the activity field names
 * intact is important: `generateActivityHash()` derives deduplication IDs from
 * them, so renaming any would orphan every previously uploaded transaction.
 *
 * @module api/canadalife/activityReports
 */

import { debugLog } from '../../core/utils';
import { CanadaLifeApiError } from './errors';
import { buildApexActionPayload, makeAuraApiCall } from './auraClient';
import type { ActivityReportData, CanadaLifeAccount, CanadaLifeActivity } from './types';

/** Apex controller serving the plan selection + activity report screens */
const PLANS_CONTROLLER = 'MclawGrsaActivityPlansController';

/** Language code sent with activity report requests */
const LANGUAGE = 'en';

/** Matches the "Value of this plan on <date>" opening-balance row */
const OPENING_BALANCE_DESCRIPTION = 'value of this plan on';

/** Report summary as returned by Canada Life */
interface ReportSummary {
  Total?: { Value?: number; Description?: string };
  Details?: Array<{ Description?: string; Value?: number }>;
}

/**
 * Validate the account and date arguments for an activity report request.
 * @param account - Canada Life account object
 * @param startDate - Start date in YYYY-MM-DD format
 * @param endDate - End date in YYYY-MM-DD format
 * @throws If the account is unusable or a date is malformed
 */
function validateActivityReportArgs(
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
}

/**
 * Locate the report body within the response envelope.
 *
 * Supports the current shape (`activityReportMap.data`) and the retired Vlocity
 * shape (`IPResult`).
 *
 * @param responseData - Unwrapped response payload
 * @returns Report body containing `Summary` and optionally `Activities`
 * @throws `CanadaLifeApiError` if neither shape is present
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractReportBody(responseData: any): Record<string, unknown> {
  const current = responseData?.activityReportMap?.data;
  if (current) {
    return current;
  }

  // Backward compatibility with the retired Vlocity response shape
  if (responseData?.IPResult) {
    return responseData.IPResult;
  }

  debugLog('No activity report data found in response:', responseData);
  throw new CanadaLifeApiError(
    'No activity report data found in Canada Life API response',
    responseData,
  );
}

/**
 * Extract the closing balance (the plan's value at the end of the range).
 * @param summary - Report summary block
 * @returns Closing balance
 * @throws If the value is absent or non-numeric
 */
function extractClosingBalance(summary: ReportSummary): number {
  const closingBalance = summary.Total?.Value;

  if (typeof closingBalance !== 'number') {
    throw new Error('Could not extract closing balance from API response');
  }

  return closingBalance;
}

/**
 * Extract the opening balance (the plan's value at the start of the range).
 *
 * Prefers the "Value of this plan on <date>" row; falls back to the first
 * detail row, which is where Canada Life has always placed it.
 *
 * @param summary - Report summary block
 * @returns Opening balance
 * @throws If no numeric opening balance can be found
 */
function extractOpeningBalance(summary: ReportSummary): number {
  const details = Array.isArray(summary.Details) ? summary.Details : [];

  const openingEntry = details.find(
    (detail) => typeof detail.Description === 'string'
      && detail.Description.toLowerCase().includes(OPENING_BALANCE_DESCRIPTION),
  );

  if (openingEntry && typeof openingEntry.Value === 'number') {
    return openingEntry.Value;
  }

  const firstDetail = details[0];
  if (firstDetail && typeof firstDetail.Value === 'number') {
    debugLog('Using first Details entry as opening balance (pattern match failed)');
    return firstDetail.Value;
  }

  throw new Error('Could not extract opening balance from API response');
}

/**
 * Load the activity report for a Canada Life account over a date range.
 *
 * Canada Life rejects ranges longer than one calendar year, so callers fetching
 * long histories must chunk their requests (see
 * `services/canadalife/transactions.generateDateChunks`).
 *
 * @param account - Canada Life account object
 * @param startDate - Start date in YYYY-MM-DD format
 * @param endDate - End date in YYYY-MM-DD format
 * @param signal - Optional abort signal for cancellation support
 * @returns Opening/closing balances plus the activities in the range
 */
export async function loadAccountActivityReport(
  account: CanadaLifeAccount,
  startDate: string,
  endDate: string,
  signal: AbortSignal | null = null,
): Promise<ActivityReportData> {
  try {
    debugLog('Loading account activity report:', {
      account: account?.EnglishShortName,
      startDate,
      endDate,
    });

    validateActivityReportArgs(account, startDate, endDate);

    const payload = buildApexActionPayload({
      id: '180;a',
      classname: PLANS_CONTROLLER,
      method: 'getActivityReportByPlanCode',
      params: {
        language: LANGUAGE,
        agreementId: account.agreementId,
        startDate,
        endDate,
      },
    });

    debugLog('Activity report API payload:', payload);

    const responseData = await makeAuraApiCall(payload, {
      extractNestedResponse: true,
      signal: signal ?? undefined,
    });

    const reportBody = extractReportBody(responseData);
    const summary = reportBody.Summary as ReportSummary | undefined;

    if (!summary) {
      throw new CanadaLifeApiError(
        'No Summary found in Canada Life activity report response',
        responseData,
      );
    }

    const closingBalance = extractClosingBalance(summary);
    const openingBalance = extractOpeningBalance(summary);
    const activities = (reportBody.Activities || []) as CanadaLifeActivity[];

    const balanceData: ActivityReportData = {
      account: {
        name: account.LongNameEnglish || account.EnglishShortName,
        shortName: account.EnglishShortName,
        agreementId: account.agreementId,
      },
      date: endDate,
      startDate,
      endDate,
      openingBalance,
      closingBalance,
      change: closingBalance - openingBalance,
      activities,
      rawResponse: responseData,
    };

    debugLog('Successfully loaded account balance:', {
      ...balanceData,
      activityCount: activities.length,
    });

    return balanceData;
  } catch (error) {
    debugLog('Error loading account balance:', error);
    throw error;
  }
}