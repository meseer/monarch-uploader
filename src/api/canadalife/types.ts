/**
 * Shared types for the Canada Life API client.
 *
 * @module api/canadalife/types
 */

/** Result of a Canada Life authentication check */
export interface CanadaLifeAuthStatus {
  authenticated: boolean;
  token: string | null;
  source: string | null;
}

/**
 * A Canada Life plan/account as returned by the member portal.
 *
 * Field names are identical between the legacy Vlocity `grsa_GetMemberPlans`
 * response (`IPResult.MemberPlans[]`) and the current
 * `MclawGrsaActivityPlansController.getPlanSelectionScreenData` response
 * (`plansList[]`), so a single shape covers both.
 */
export interface CanadaLifeAccount {
  EnglishShortName: string;
  LongNameEnglish?: string;
  agreementId: string;
  EnrollmentDate?: string;
  [key: string]: unknown;
}

/** Consolidated account entry persisted in `canadalife_accounts_list` */
export interface CanadaLifeConsolidatedAccount {
  canadalifeAccount: {
    id: string;
    agreementId: string;
    nickname: string;
    EnglishShortName: string;
    LongNameEnglish?: string;
    EnrollmentDate?: string;
    [key: string]: unknown;
  };
  monarchAccount: Record<string, unknown> | null;
  syncEnabled: boolean;
  lastSyncDate: string | null;
  lastSyncBalance: number | null;
  uploadedTransactions: Array<{ id: string; date?: string }>;
  successfulSyncCount: number;
}

/** Historical balance data with CSV-ready rows (first row is the header) */
export interface BalanceHistoryData {
  data: Array<[string, number | string, string]>;
  account: {
    shortName: string;
    name: string;
    agreementId: string;
  };
  dateRange: {
    startDate: string;
    endDate: string;
  };
  totalDays: number;
  businessDays: number;
  apiCallsMade: number;
}

/**
 * A single Canada Life activity row.
 *
 * The shape is unchanged between the legacy Vlocity API
 * (`IPResult.Activities[]`) and the current Mclaw API
 * (`activityReportMap.data.Activities[]`). This matters because
 * `generateActivityHash()` derives deduplication IDs from these exact field
 * names — renaming any of them would orphan every previously uploaded
 * transaction.
 */
export interface CanadaLifeActivity {
  InvestmentVehicleAndAccountLongName?: string;
  IsStockFund?: boolean;
  Date?: string;
  Activity?: string;
  Amount?: number;
  InterestRateOrUnitPrice?: number;
  Units?: number | null;
  [key: string]: unknown;
}

/** Normalised activity report for a single date range */
export interface ActivityReportData {
  account: {
    name: string;
    shortName: string;
    agreementId: string;
  };
  date: string;
  startDate: string;
  endDate: string;
  openingBalance: number;
  closingBalance: number;
  change: number;
  activities: CanadaLifeActivity[];
  rawResponse: unknown;
}

/** Options accepted by `makeAuraApiCall` */
export interface AuraApiCallOptions {
  /** Unwrap `actions[0].returnValue.returnValue` before returning */
  extractNestedResponse?: boolean;
  /** Internal flag marking a post-token-refresh retry */
  isRetry?: boolean;
  /** Abort signal for cancellation support */
  signal?: AbortSignal;
}

/** Sponsor details, including the encrypted participant id used as adminSystemId */
export interface SponsorInfo {
  adminSystemId: string;
  sponsorName: string;
  sponsorId: string;
}

/** Options accepted by `loadCanadaLifeAccounts` */
export interface LoadAccountsOptions {
  /** Whether to force refresh from API (ignore cache). Default: false */
  forceRefresh?: boolean;
  /** When true, suppresses toast notifications (for background retries). Default: false */
  silent?: boolean;
}