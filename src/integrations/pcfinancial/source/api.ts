/**
 * PC Financial REST API client.
 *
 * Communicates with `https://app.pcfinancial.ca/inet/banking/v2.0/accounts/...`
 * using the signed-in session tokens read on demand from `sessionStorage` on
 * `https://secure.pcfinancial.ca`.
 *
 * @module integrations/pcfinancial/source/api
 */

import type { HttpClient, HttpResponse } from '../../../core/httpClient';
import { extractResponseErrorDetail, parseJsonBody } from '../../../core/httpResponse';
import { debugLog, formatDate } from '../../../core/utils';
import { readSessionCredentials } from './auth';

const BASE_URL = 'https://app.pcfinancial.ca/inet/banking/v2.0/accounts';
const PAGE_SIZE = 20;
const MAX_VERIFIER_ATTEMPTS = 3;
const VERIFIER_RETRY_DELAY_MS = 250;

/**
 * Buffer (in days) subtracted from `fromDate` before stopping descending
 * transaction pagination, because PC Financial orders by `TRANSACTION_DATE`
 * while filtering uses `postedDate`.
 */
export const LATE_POSTING_BUFFER_DAYS = 7;

export type PcFinancialAccountType = 'credit' | 'depository';

export interface PcFinancialAccount extends Record<string, unknown> {
  accountId: string;
  accountType: PcFinancialAccountType;
  accountSubtype: 'credit_card' | 'checking';
  productType: string;
  productCode: string;
  maskedCardNumber?: string;
  endingIn?: string;
  dateOpened?: string;
  displayName: string;
}

export interface PcFinancialAccountDetails {
  accountId: string;
  productType: string;
  productCode?: string;
  maskedCardNumber?: string;
  ledgerAccountNumber?: string;
  currentUserRole?: string;
  dateOpened?: string;
  balance: number;
  currency?: string;
  availableCredit?: number;
  creditLimit?: number | null;
  pendingAmount?: number;
}

interface PcFinancialConfigResponse {
  accountConfigurationList?: Array<{
    accountId?: string;
    pastDueFlag?: boolean;
  }>;
}

interface PcFinancialCardSummary {
  accountId?: string;
  maskedCardNumber?: string;
  productType?: string;
  productCode?: string;
  firstName?: string;
  lastName?: string;
}

interface PcFinancialCardsResponse {
  cards?: PcFinancialCardSummary[];
}

export interface PcFinancialTransaction extends Record<string, unknown> {
  accountId: string;
  transactionId: string;
  postedDate: string;
  transactionTimestamp?: string;
  debitCredit: 'DEBIT' | 'CREDIT';
  currencyCode: string;
  merchantName?: string;
  description?: string;
  signedFinalAmount: number;
}

interface TransactionPage {
  transactions: PcFinancialTransaction[];
  pagination: { totalCount: number; freezeMarker?: string };
}

export interface PcFinancialApiClient {
  getAccounts(): Promise<PcFinancialAccount[]>;
  getAccountsSummary(): Promise<PcFinancialAccount[]>;
  getAccountOpenedDate(accountId: string): Promise<string | null>;
  getBalance(accountId: string): Promise<{ currentBalance: number; currency: string }>;
  getCreditLimit(accountId: string): Promise<number | null>;
  getPostedTransactions(accountId: string, fromDate: string): Promise<PcFinancialTransaction[]>;
}

/**
 * Compute an ISO date string (`YYYY-MM-DD`) `days` earlier than `isoDate`.
 *
 * @param isoDate - Date in `YYYY-MM-DD` format
 * @param days - Number of days to subtract
 * @returns Earlier date in `YYYY-MM-DD` format
 */
function subtractDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00`);
  date.setDate(date.getDate() - days);
  return formatDate(date);
}

/**
 * Generate a 32-character hex UUID (without hyphens) for PC Financial headers.
 *
 * @returns 32-character lowercase hex string
 */
function generateHexId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

/**
 * Build the required request headers using credentials from `sessionStorage`.
 *
 * @returns Header map for `app.pcfinancial.ca` requests
 */
function buildRequestHeaders(): Record<string, string> {
  const credentials = readSessionCredentials();
  if (!credentials) {
    throw new Error('PC Financial session not found. Please log in to PC Financial and try again.');
  }

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Toronto';
  return {
    accept: 'application/json',
    authorization: `Bearer ${credentials.accessToken}`,
    'x-pcf-csrf-token': credentials.csrfToken,
    'uservice-correlation-id': credentials.correlationId || generateHexId(),
    'uservice-message-id': generateHexId(),
    'uservice-traceability-id': generateHexId(),
    'x-nonce': crypto.randomUUID(),
    'channel-timezone-name': timezone,
    language: 'en',
    'uservice-api-version': '1',
    'uservice-channel-type': 'DESKTOP_WEB',
  };
}

/**
 * Validate a posted transactions page before any transaction can reach Monarch.
 *
 * @param value - Parsed JSON response
 * @param accountId - Expected account ID
 * @returns Validated transaction page
 */
export function parseTransactionPage(value: unknown, accountId: string): TransactionPage {
  const page = value as Partial<TransactionPage>;
  if (!page || !Array.isArray(page.transactions)
      || !Number.isInteger(page.pagination?.totalCount)
      || (page.pagination?.totalCount ?? -1) < 0) {
    throw new Error('Unexpected PC Financial transaction response: transactions or pagination missing');
  }

  for (const transaction of page.transactions) {
    if (transaction.accountId !== accountId
        || !transaction.transactionId
        || !/^\d{4}-\d{2}-\d{2}$/.test(transaction.postedDate)
        || typeof transaction.signedFinalAmount !== 'number'
        || !Number.isFinite(transaction.signedFinalAmount)
        || transaction.currencyCode !== 'CAD'
        || !['DEBIT', 'CREDIT'].includes(transaction.debitCredit)
        || (transaction.debitCredit === 'DEBIT' && transaction.signedFinalAmount > 0)
        || (transaction.debitCredit === 'CREDIT' && transaction.signedFinalAmount < 0)) {
      throw new Error('Unexpected PC Financial transaction fields; sync stopped before upload');
    }
  }
  return page as TransactionPage;
}

/**
 * Extract a trimmed `ledgerAccountNumber` from account details, if present.
 *
 * @param details - Account details payload
 * @returns Trimmed ledger account number or empty string
 */
function extractLedgerAccountNumber(details: PcFinancialAccountDetails): string {
  return typeof details.ledgerAccountNumber === 'string' ? details.ledgerAccountNumber.trim() : '';
}

/**
 * Build a human-readable display name for a PC Financial account.
 *
 * @param details - Account details payload
 * @param card - Optional card summary entry
 * @returns Display name such as `PC Mastercard (5570)` or `PC Money (a53a)`
 */
function buildAccountDisplayName(
  details: PcFinancialAccountDetails,
  card?: PcFinancialCardSummary,
): string {
  const isCredit = details.productType === 'CREDIT-CARD';
  const fallbackId = extractLedgerAccountNumber(details) || details.accountId;
  const suffix = details.maskedCardNumber || card?.maskedCardNumber || fallbackId.slice(-4);
  const label = isCredit ? 'PC Mastercard' : 'PC Money';
  return `${label} (${suffix})`;
}

/**
 * Create the PC Financial API client.
 *
 * @param httpClient - Injected HTTP client adapter
 * @param _storage - Unused storage adapter (kept for factory signature compatibility)
 * @returns PC Financial API client
 */
export function createApi(httpClient: HttpClient, _storage?: unknown): PcFinancialApiClient {
  const detailsCache = new Map<string, PcFinancialAccountDetails>();
  // Maps stable accountId (ledgerAccountNumber) -> ephemeral session accountId (s1d-...)
  const sessionAccountIds = new Map<string, string>();

  function resolveSessionAccountId(accountId: string): string {
    return sessionAccountIds.get(accountId) ?? accountId;
  }

  async function requestJson<T>(path: string, label: string): Promise<T> {
    let response: HttpResponse | null = null;

    for (let attempt = 1; attempt <= MAX_VERIFIER_ATTEMPTS; attempt++) {
      response = await httpClient.request({
        method: 'GET',
        url: `${BASE_URL}${path}`,
        headers: buildRequestHeaders(),
      });

      const isTransientVerifierError = response.status === 400
        && response.responseText.includes('invalid_verifier');
      if (!isTransientVerifierError || attempt === MAX_VERIFIER_ATTEMPTS) {
        break;
      }

      debugLog(`[PC Financial] Retrying ${label} after invalid_verifier (attempt ${attempt}/${MAX_VERIFIER_ATTEMPTS})`);
      await new Promise((resolve) => { setTimeout(resolve, VERIFIER_RETRY_DELAY_MS); });
    }

    if (!response) {
      throw new Error(`PC Financial API Error: ${label} did not return a response`);
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error('PC Financial session expired. Please refresh the page and log in again.');
    }
    if (response.status < 200 || response.status >= 300) {
      const detail = extractResponseErrorDetail(response.responseText);
      throw new Error(`PC Financial ${label} request failed: HTTP ${response.status}${detail ? ` — ${detail}` : ''}`);
    }

    return parseJsonBody<T>(response.responseText, `PC Financial API Error: ${label}`);
  }

  async function fetchAccountDetails(accountId: string, useCache = false): Promise<PcFinancialAccountDetails> {
    if (useCache && detailsCache.has(accountId)) {
      return detailsCache.get(accountId)!;
    }

    const data = await requestJson<Partial<PcFinancialAccountDetails>>(
      `/${encodeURIComponent(accountId)}/details`,
      'AccountDetails',
    );

    if (!data || data.accountId !== accountId
        || typeof data.productType !== 'string'
        || typeof data.balance !== 'number'
        || !Number.isFinite(data.balance)) {
      throw new Error('Unexpected PC Financial account details response');
    }

    const details = data as PcFinancialAccountDetails;
    detailsCache.set(accountId, details);
    return details;
  }

  async function getPage(
    accountId: string,
    offset: number,
    limit: number,
    freezeMarker?: string,
  ): Promise<TransactionPage> {
    const query = new URLSearchParams({
      offset: String(offset),
      limit: String(limit),
      sortField: 'TRANSACTION_DATE',
      orderDirection: 'DESCENDING',
    });
    if (freezeMarker) query.set('freezeMarker', freezeMarker);

    const data = await requestJson<unknown>(
      `/${encodeURIComponent(accountId)}/posted-transactions?${query}`,
      'PostedTransactions',
    );
    return parseTransactionPage(data, accountId);
  }

  async function getAccounts(): Promise<PcFinancialAccount[]> {
    const config = await requestJson<PcFinancialConfigResponse>('/config', 'AccountsConfig');
    const configuredIds = (config?.accountConfigurationList || [])
      .map((entry) => entry.accountId)
      .filter((id): id is string => Boolean(id));

    let cardsByAccountId = new Map<string, PcFinancialCardSummary>();
    try {
      const cardsData = await requestJson<PcFinancialCardsResponse>('/cards', 'AccountCards');
      cardsByAccountId = new Map(
        (cardsData?.cards || [])
          .filter((card): card is PcFinancialCardSummary & { accountId: string } => Boolean(card.accountId))
          .map((card) => [card.accountId, card]),
      );
    } catch (error) {
      debugLog('[PC Financial] Could not fetch /accounts/cards, continuing with /details:', (error as Error).message);
    }

    const allAccountIds = [...new Set([...configuredIds, ...cardsByAccountId.keys()])];
    detailsCache.clear();
    sessionAccountIds.clear();

    const accounts: PcFinancialAccount[] = [];
    for (const sessionAccountId of allAccountIds) {
      const details = await fetchAccountDetails(sessionAccountId, false);
      const card = cardsByAccountId.get(sessionAccountId);
      const isCredit = details.productType === 'CREDIT-CARD';
      const maskedCardNumber = details.maskedCardNumber || card?.maskedCardNumber;
      const ledgerAccountNumber = extractLedgerAccountNumber(details);
      const stableAccountId = ledgerAccountNumber || sessionAccountId;
      if (!ledgerAccountNumber) {
        debugLog(`[PC Financial] Account ${sessionAccountId} missing ledgerAccountNumber; falling back to session accountId`);
      }
      sessionAccountIds.set(stableAccountId, sessionAccountId);

      accounts.push({
        accountId: stableAccountId,
        accountType: isCredit ? 'credit' : 'depository',
        accountSubtype: isCredit ? 'credit_card' : 'checking',
        productType: details.productType,
        productCode: details.productCode || card?.productCode || '',
        ...(maskedCardNumber ? { maskedCardNumber, endingIn: maskedCardNumber } : {}),
        ...(details.dateOpened && /^\d{4}-\d{2}-\d{2}$/.test(details.dateOpened)
          ? { dateOpened: details.dateOpened }
          : {}),
        displayName: buildAccountDisplayName(details, card),
      });
    }

    return accounts;
  }

  return {
    getAccounts,
    getAccountsSummary: getAccounts,

    async getAccountOpenedDate(accountId: string): Promise<string | null> {
      const details = await fetchAccountDetails(resolveSessionAccountId(accountId), true);
      if (typeof details.dateOpened === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(details.dateOpened)) {
        return details.dateOpened;
      }
      return null;
    },

    async getBalance(accountId: string): Promise<{ currentBalance: number; currency: string }> {
      const details = await fetchAccountDetails(resolveSessionAccountId(accountId), true);
      return {
        currentBalance: details.balance,
        currency: details.currency || 'CAD',
      };
    },

    async getCreditLimit(accountId: string): Promise<number | null> {
      const details = await fetchAccountDetails(resolveSessionAccountId(accountId), true);
      if (details.productType !== 'CREDIT-CARD') {
        return null;
      }
      if (typeof details.creditLimit !== 'number' || !Number.isFinite(details.creditLimit)) {
        return null;
      }
      return details.creditLimit;
    },

    async getPostedTransactions(accountId: string, fromDate: string): Promise<PcFinancialTransaction[]> {
      const sessionAccountId = resolveSessionAccountId(accountId);
      const transactions: PcFinancialTransaction[] = [];
      const cutoffDate = subtractDays(fromDate, LATE_POSTING_BUFFER_DAYS);
      let offset = 0;
      let totalCount: number;
      let freezeMarker: string | undefined;

      do {
        const page = await getPage(sessionAccountId, offset, PAGE_SIZE, freezeMarker);
        transactions.push(...page.transactions);
        totalCount = page.pagination.totalCount;
        freezeMarker = page.pagination.freezeMarker;
        offset += page.transactions.length;

        if (page.transactions.length === 0 && offset < totalCount) {
          throw new Error('PC Financial returned an empty page before all transactions were fetched');
        }

        const oldestInPage = page.transactions.at(-1);
        if (oldestInPage && oldestInPage.postedDate < cutoffDate) {
          break;
        }
      } while (offset < totalCount);

      return transactions
        .filter((tx) => tx.postedDate >= fromDate)
        .reverse();
    },
  };
}
