/**
 * Real Canada Life API response fixtures.
 *
 * Captured from my.canadalife.com in 2026 after Canada Life migrated the member
 * portal off the Vlocity Insurance AppExchange package onto their own
 * non-namespaced `Mclaw*` Apex controllers. Values are anonymised but the
 * structure is verbatim.
 */

/** The encrypted participant id (`GRS_ParticId__c`) used as `adminSystemId` */
export const ADMIN_SYSTEM_ID = 'ENC_UFJELVBSSS0yMDEzLjA3LjMwLjE5LjQ5LjIxLjkzNjpKY3c2eGNRS2hyNmdPdG1FU01GQ2dRPT0';

/** Framework version UID echoed back by the server in `context.fwuid` */
export const SERVER_FWUID = 'WUdfaXlIZDNDQ0lZLWNFZDMtVGZ3d2tVMjdnTGFERUU2S3FfSVdrcU92bkExNC4xOTIuODM4ODYwOA';

/** Agreement ids for the two captured plans */
export const DPSP_AGREEMENT_ID = 'ENC_MjjbN1DY5Gdqw';
export const RRSP_AGREEMENT_ID = 'ENC_MM5g3LjL8vdoQ';

/**
 * The `context` block every Aura response carries.
 * @returns Context object including the server's authoritative fwuid
 */
export function buildResponseContext() {
  return {
    mode: 'PROD',
    app: 'siteforce:communityApp',
    contextPath: '/s/sfsites',
    pathPrefix: '',
    fwuid: SERVER_FWUID,
    mlr: 1,
    uad: 1,
    coos: 1,
    loaded: { 'APPLICATION@markup://siteforce:communityApp': '1712_xZHiuQoc1HHcvGz4vs6mGA' },
    rns: ['vlocity_ins'],
  };
}

/**
 * Wrap a nested payload in the Aura action envelope.
 *
 * The current Mclaw controllers return `returnValue.returnValue` as a plain
 * object (the retired Vlocity ones returned a JSON string).
 *
 * @param {Object} nested - Inner payload
 * @param {string} id - Aura action id
 * @returns {Object} Full Aura response body
 */
export function wrapAuraSuccess(nested, id = '141;a') {
  return {
    actions: [{
      id,
      state: 'SUCCESS',
      returnValue: { returnValue: nested, cacheable: false },
      error: [],
    }],
    context: buildResponseContext(),
  };
}

/**
 * Build a failing Aura action envelope.
 * @param {Object} options - Error details
 * @param {string} options.exceptionType - Apex exception type
 * @param {string} options.message - Apex exception message
 * @param {string} options.id - Aura action id
 * @param {boolean} options.includeCoose - Append a COOSE warning action
 * @returns {Object} Full Aura response body with a failed action
 */
export function wrapAuraError({
  exceptionType,
  message,
  id = '113;a',
  includeCoose = false,
} = {}) {
  const actions = [{
    id,
    state: 'ERROR',
    returnValue: { cacheable: false },
    error: [{
      exceptionType,
      isUserDefinedException: false,
      message,
    }],
  }];

  if (includeCoose) {
    actions.push({
      id: 'COOSE',
      state: 'warning',
      coos: 'This page has changes since the last refresh. To get the latest updates, '
        + 'save your work and finish your conversations before refreshing the page.',
    });
  }

  return { actions, context: buildResponseContext() };
}

/**
 * The exact `System.LicenseException` that broke the integration: the Vlocity
 * package licence was revoked, making every legacy call fail.
 * @returns {Object} Aura response body
 */
export function buildLicenseExceptionResponse() {
  return wrapAuraError({
    exceptionType: 'System.LicenseException',
    message: 'The Apex Class BusinessProcessDisplayController is part of the AppExchange Package '
      + 'Vlocity Insurance, and requires a license to use',
    includeCoose: true,
  });
}

/**
 * Real `IMSCommunityHelperSfiLwc.getSponsorInfo` response.
 * @param {string} adminSystemId - Value for `GRS_ParticId__c`
 * @returns {Object} Aura response body
 */
export function buildSponsorInfoResponse(adminSystemId = ADMIN_SYSTEM_ID) {
  return wrapAuraSuccess({
    getSponsorInfo: {
      Id: 'aALOH000011i2mo4AA',
      SponsorId__c: 'ENC_MymyQ1Gdy5yOJy',
      Order_Id__c: 1,
      User_Sponsor_Name__c: 'AMAZON CANADA FULFILLMENT SERVICES',
      isMultiSponsor__c: false,
      isDefault__c: false,
      GRS_ParticId__c: adminSystemId,
      GLH_PartyKey__c: 'ENC_UFJELVBSSS0yMDEzLjA3LjMwOkRYK056dG1pYjdqcVJQYWZLWWY0Q3c9PQ',
      Name: 'USS-127779145',
      GRSPlan__c: '63251',
    },
    pshcpLeftNavInfoHide: false,
    isPSHCP: false,
  }, '99;a');
}

/**
 * Real `MclawGrsaActivityPlansController.getPlanSelectionScreenData` response.
 *
 * `plansList[]` replaces the legacy `IPResult.MemberPlans[]`, carrying the same
 * `agreementId` / `EnglishShortName` / `LongNameEnglish` / `EnrollmentDate`
 * fields the consolidated account model stores.
 *
 * @returns {Object} Aura response body
 */
export function buildPlanSelectionResponse() {
  return wrapAuraSuccess({
    defaultPlanCode: 'DPSP',
    planOptionsList: [
      {
        agreementId: DPSP_AGREEMENT_ID,
        label: 'DEFERRED PROFIT SHARING PLAN (DPSP)',
        languageAgnosticLabel: 'DPSP',
        value: 'DPSP',
        isSelected: true,
      },
      {
        agreementId: RRSP_AGREEMENT_ID,
        label: 'REGISTERED RETIREMENT SAVINGS PLAN (RRSP)',
        languageAgnosticLabel: 'RRSP',
        value: 'RRSP',
      },
    ],
    plansList: [
      {
        SpousalPlan: { IsRelatedSpousalPlan: false },
        LegalNameEnglish: 'DEFERRED PROFIT SHARING PLAN FOR THE EMPLOYEES OF EXAMPLE CO',
        ModelCode: 7,
        PlanCode: '7',
        StatusCode: 'A',
        IsRegistered: true,
        EnglishShortName: 'DPSP',
        FrenchShortName: 'RPDB',
        EnrollmentDate: '2014-07-28T00:00:00',
        Model: 'DPSP',
        LongNameEnglish: 'DEFERRED PROFIT SHARING PLAN',
        agreementId: DPSP_AGREEMENT_ID,
        AccountFundBalances: [{
          MemberDefinedAccount: true,
          AccountCode: 'EMPR',
          InvestmentVehicleBalances: [
            { InvestmentVehicleShortName: 'LUSET', AssetClassName: 'Foreign Equity Funds', Balance: 85074.11 },
            { InvestmentVehicleShortName: 'LIEIT', AssetClassName: 'Foreign Equity Funds', Balance: 69347.73 },
          ],
        }],
      },
      {
        SpousalPlan: { IsRelatedSpousalPlan: false },
        LegalNameEnglish: '',
        ModelCode: 1,
        PlanCode: '1',
        StatusCode: 'A',
        IsRegistered: true,
        EnglishShortName: 'RRSP',
        FrenchShortName: 'REER',
        EnrollmentDate: '2015-11-27T00:00:00',
        Model: 'RSP',
        LongNameEnglish: 'REGISTERED RETIREMENT SAVINGS PLAN',
        agreementId: RRSP_AGREEMENT_ID,
        AccountFundBalances: [{
          MemberDefinedAccount: true,
          AccountCode: 'MEM',
          InvestmentVehicleBalances: [
            { InvestmentVehicleShortName: 'S120', AssetClassName: 'Canadian Equity Funds', Balance: 48921.27 },
          ],
        }],
      },
    ],
    isSuccess: true,
  });
}

/**
 * The two real activity rows captured for 2026-08-21 → 2026-09-08.
 *
 * Field names are identical to the legacy Vlocity `IPResult.Activities[]`,
 * which is what keeps `generateActivityHash()` deduplication IDs stable across
 * the migration.
 *
 * @returns {Array<Object>} Activity rows
 */
export function buildActivities() {
  return [
    {
      InvestmentVehicleAndAccountLongName: 'International Equity Index (TDAM)-Employer',
      IsStockFund: false,
      Date: '2026-08-28T00:00:00',
      Activity: 'New contribution',
      Amount: 193.92,
      InterestRateOrUnitPrice: 378.429806,
      Units: 0.512433,
    },
    {
      InvestmentVehicleAndAccountLongName: 'U.S. Equity Index (TDAM)-Employer',
      IsStockFund: false,
      Date: '2026-08-28T00:00:00',
      Activity: 'New contribution',
      Amount: 193.93,
      InterestRateOrUnitPrice: 710.919015,
      Units: 0.272788,
    },
  ];
}

/**
 * Real `MclawGrsaActivityPlansController.getActivityReportByPlanCode` response.
 *
 * @param {Object} options - Overrides
 * @param {number} options.openingBalance - "Value of this plan on <start>" amount
 * @param {number} options.closingBalance - `Summary.Total.Value`
 * @param {Array<Object>} options.activities - Activity rows (omit the key for a quiet period)
 * @param {string} options.startDate - Range start, used in the opening description
 * @param {string} options.endDate - Range end, used in the total description
 * @returns {Object} Aura response body
 */
export function buildActivityReportResponse({
  openingBalance = 153387.73,
  closingBalance = 154421.97,
  activities = buildActivities(),
  startDate = 'August 21, 2026',
  endDate = 'September 8, 2026',
} = {}) {
  const data = {
    PlanShortName: 'DPSP',
    StartDate: '2026-08-21T00:00:00',
    EndDate: '2026-09-08T00:00:00',
    Summary: {
      Heading: 'Summary of activity in your DPSP',
      Details: [
        { Description: `Value of this plan on ${startDate}`, Value: openingBalance },
        { Description: 'Contributions made by the company', Value: 387.85 },
        { Description: 'Change in the market value of your investments', Value: 646.39 },
      ],
      Total: { Description: `Value of this plan on ${endDate}`, Value: closingBalance },
    },
    Breakdown: {
      AssetClasses: [{
        Name: 'Foreign Equity Funds',
        InvestmentVehicles: [{
          InvestmentVehicleLongName: 'U.S. Equity Index (TDAM)',
          Units: 121.123171,
          CurrentPrice: 702.377223,
          CurrentValue: 85074.16,
          IsStockFund: false,
        }],
      }],
      Total: closingBalance,
    },
  };

  if (activities !== null) {
    data.Activities = activities;
  }

  return wrapAuraSuccess({
    activityReportMap: { success: true, data },
    isSuccess: true,
  }, '180;a');
}

/**
 * Build a failed-envelope activity report response.
 *
 * Server-side validation failures (for example the one-year date range limit)
 * arrive as `success: false` with HTTP 200 rather than as an Apex exception.
 *
 * @param {string} message - Failure reason from the server
 * @returns {Object} Aura response body
 */
export function buildActivityReportFailureResponse(
  message = 'Make sure your date range is not more than a year.',
) {
  return wrapAuraSuccess({
    activityReportMap: { success: false, message },
    isSuccess: false,
  }, '180;a');
}

/**
 * Build a mock `fetch` Response for a parsed Aura body.
 * @param {Object} body - Response body to serialise
 * @param {boolean} secureWrapper - Wrap in the `/*-secure-` comment guard
 * @returns {Object} Mock Response object
 */
export function mockFetchResponse(body, secureWrapper = false) {
  const json = JSON.stringify(body);
  const text = secureWrapper ? `/*-secure-\n${json}\n*/` : json;

  return {
    ok: true,
    status: 200,
    statusText: '',
    url: 'https://my.canadalife.com/s/sfsites/aura',
    headers: {
      get: (name) => (name === 'content-type' ? 'application/json' : null),
      entries: () => [['content-type', 'application/json']],
    },
    text: () => Promise.resolve(text),
  };
}