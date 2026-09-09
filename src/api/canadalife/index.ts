/**
 * CanadaLife API client.
 *
 * Handles authentication, account discovery, balance history and activity
 * (transaction) retrieval for the Canada Life group retirement portal.
 *
 * This module is the public surface of the Canada Life API layer; consumers
 * should import from `api/canadalife` rather than the individual sub-modules.
 *
 * @module api/canadalife
 */

import { CanadaLifeApiError, CanadaLifeTokenExpiredError } from './errors';
import {
  attemptTokenRefresh,
  checkCanadaLifeAuth,
  checkTokenStatus,
  extractCookies,
  getCanadaLifeToken,
  setupTokenMonitoring,
} from './auth';
import { clearHarvestedAuraContext, getAuraContext, harvestAuraContext } from './auraContext';
import { buildApexActionPayload, makeAuraApiCall } from './auraClient';
import { clearSponsorInfoCache, getSponsorInfo, loadCanadaLifeAccounts } from './accounts';
import { loadAccountActivityReport } from './activityReports';
import { loadAccountBalanceHistory } from './balanceHistory';

export type {
  ActivityReportData,
  AuraApiCallOptions,
  BalanceHistoryData,
  CanadaLifeAccount,
  CanadaLifeActivity,
  CanadaLifeAuthStatus,
  CanadaLifeConsolidatedAccount,
  LoadAccountsOptions,
  SponsorInfo,
} from './types';

export {
  CanadaLifeApiError,
  CanadaLifeTokenExpiredError,
  attemptTokenRefresh,
  checkCanadaLifeAuth,
  checkTokenStatus,
  extractCookies,
  getCanadaLifeToken,
  setupTokenMonitoring,
  clearHarvestedAuraContext,
  getAuraContext,
  harvestAuraContext,
  buildApexActionPayload,
  makeAuraApiCall,
  clearSponsorInfoCache,
  getSponsorInfo,
  loadCanadaLifeAccounts,
  loadAccountActivityReport,
  loadAccountBalanceHistory,
};

export default {
  getToken: getCanadaLifeToken,
  checkAuth: checkCanadaLifeAuth,
  checkTokenStatus,
  setupTokenMonitoring,
  extractCookies,
  getAuraContext,
  getSponsorInfo,
  clearSponsorInfoCache,
  makeAuraApiCall,
  loadCanadaLifeAccounts,
  loadAccountActivityReport,
  loadAccountBalanceHistory,
  CanadaLifeTokenExpiredError,
  CanadaLifeApiError,
};