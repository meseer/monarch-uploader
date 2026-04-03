/**
 * MBNA API Client
 *
 * Tampermonkey-agnostic API client for MBNA. Receives injected httpClient
 * and auth handler. All MBNA API endpoints live under /waw/mbna/.
 *
 * Returns raw MBNA data. Does NOT transform data into Monarch format.
 *
 * @module integrations/mbna/source/api
 */

import type { HttpClient } from '../../../core/httpClient';
import type { MbnaRawTransaction } from './balanceReconstruction';

// ── Interfaces ──────────────────────────────────────────────

/** Normalized account summary entry from /accounts/summary */
export interface MbnaAccountSummary {
  accountId: string | null;
  endingIn: string | null;
  cardName: string | null;
  cardNameShort: string | null;
  displayName: string | null;
  primaryCardHolder: boolean;
  raw: Record<string, unknown>;
}

/** Normalized account info from /current-account */
export interface MbnaAccountInfo {
  accountId: string | null;
  endingIn: string | null;
  cardName: string | null;
  displayName: string | null;
  currentBalance: number | null;
  creditAvailable: number | null;
  raw: Record<string, unknown>;
}

/** Balance data from /accounts/{id}/snapshot */
export interface MbnaBalanceData {
  currentBalance: number | null;
  creditAvailable: number | null;
  creditLimit: number | null;
  currency: string;
  raw: Record<string, unknown>;
}

/** Current cycle transactions (pending + settled) */
export interface MbnaCycleTransactions {
  pending: MbnaRawTransaction[];
  settled: MbnaRawTransaction[];
}

/** Normalized statement data from a specific closing date */
export interface MbnaNormalizedStatement {
  statementBalance: number | null;
  creditLimit: number | null;
  statementClosingDate: string;
  minPaymentDue: number | null;
  minPaymentDueDate: string | null;
  nextStatementClosingDate: string | null;
  transactions: MbnaRawTransaction[];
  raw: Record<string, unknown>;
}

/** Progress callback for multi-statement fetching */
type ProgressCallback = (current: number, total: number, closingDate: string) => void;

/** Options for getTransactions */
interface GetTransactionsOptions {
  onProgress?: ProgressCallback;
}

/** Full transaction result combining current cycle + historical statements */
export interface MbnaTransactionResult {
  currentCycle: MbnaCycleTransactions;
  statements: MbnaStatementSummary[];
  allSettled: MbnaRawTransaction[];
  allPending: MbnaRawTransaction[];
}

/** Summary of a fetched statement for the transaction result */
interface MbnaStatementSummary {
  closingDate: string;
  statementBalance: number | null;
  transactions: MbnaRawTransaction[];
  raw: MbnaNormalizedStatement;
}

/** MBNA API client interface */
export interface MbnaApiClient {
  getAccountsSummary(): Promise<MbnaAccountSummary[]>;
  getAccountInfo(): Promise<MbnaAccountInfo>;
  getAccountSnapshot(accountId: string): Promise<Record<string, unknown>>;
  getBalance(accountId: string): Promise<MbnaBalanceData>;
  getCreditLimit(accountId: string): Promise<number | null>;
  getCurrentCycleTransactions(accountId: string): Promise<MbnaCycleTransactions>;
  getClosingDates(accountId: string): Promise<string[]>;
  getStatementByClosingDate(accountId: string, closingDate: string): Promise<MbnaNormalizedStatement>;
  getTransactions(accountId: string, startDate: string, options?: GetTransactionsOptions): Promise<MbnaTransactionResult>;
}

// ── Constants ───────────────────────────────────────────────

/** MBNA API base URL */
const BASE_URL = 'https://service.mbna.ca/waw/mbna';

/**
 * Standard headers sent with every MBNA API request.
 * Note: No Cookie header needed — GM_xmlhttpRequest automatically
 * includes browser cookies (including HttpOnly) for same-origin requests.
 */
const STANDARD_HEADERS: Record<string, string> = {
  Accept: 'application/json, text/plain, */*',
  Referer: 'https://service.mbna.ca/waw/mbna/index.html',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
};

// ── Helpers ─────────────────────────────────────────────────

/**
 * Extract English card name from account info response
 * @param data - Raw account info response
 * @returns Card name or null
 */
function extractCardName(data: Record<string, unknown>): string | null {
  const cardSummary = data.cardSummary as Record<string, unknown> | undefined;
  const cardArtInfos = cardSummary?.cardArtInfos;
  if (!Array.isArray(cardArtInfos)) {
    return null;
  }

  const englishCard = cardArtInfos.find((info: Record<string, unknown>) => info.language === 'en');
  return (englishCard?.cardName as string) || null;
}

/**
 * Normalize a single account summary entry from /accounts/summary
 * @param entry - Raw account summary entry
 * @returns Normalized account object
 */
function normalizeAccountSummary(entry: Record<string, unknown>): MbnaAccountSummary {
  const accountId = (entry.accountId as string) || null;
  const endingIn = (entry.endingIn as string) || null;
  const cardName = (entry.cardName as string) || null;
  const cardNameShort = (entry.cardNameShort as string) || null;

  return {
    accountId,
    endingIn,
    cardName,
    cardNameShort,
    displayName: cardName && endingIn
      ? `${cardName} (${endingIn})`
      : cardName || null,
    primaryCardHolder: (entry.primaryCardHolder as boolean) ?? false,
    raw: entry,
  };
}

// ── Factory ─────────────────────────────────────────────────

/**
 * Create an MBNA API client
 *
 * @param httpClient - Injected HTTP client
 * @param _auth - Auth handler (unused — cookies auto-forwarded)
 * @returns API client instance
 */
export function createApi(httpClient: HttpClient, _auth: unknown): MbnaApiClient {
  /**
   * Make an authenticated GET request to the MBNA API.
   * All MBNA endpoints use the same GET pattern.
   * Cookies (including HttpOnly JSESSIONID) are forwarded automatically
   * by GM_xmlhttpRequest for same-origin requests.
   *
   * @param path - API path relative to /waw/mbna/ (e.g., '/current-account')
   * @returns Parsed JSON response
   * @throws On auth failure, HTTP errors, or parse errors
   */
  async function mbnaGet(path: string): Promise<Record<string, unknown>> {
    const url = `${BASE_URL}${path}`;

    const response = await httpClient.request({
      method: 'GET',
      url,
      headers: {
        ...STANDARD_HEADERS,
      },
    });

    if (response.status === 401 || response.status === 403) {
      throw new Error('MBNA session expired. Please refresh the page and log in again.');
    }

    if (response.status === 404) {
      throw new Error(`MBNA API resource not found: ${path}`);
    }

    if (response.status >= 500) {
      throw new Error('MBNA server error. Please try again later.');
    }

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`MBNA API error: HTTP ${response.status}`);
    }

    try {
      return JSON.parse(response.responseText);
    } catch (error) {
      throw new Error(`Failed to parse MBNA API response: ${(error as Error).message}`, { cause: error });
    }
  }

  return {
    /**
     * Fetch accounts summary (list of all accounts).
     * GET /waw/mbna/accounts/summary
     */
    async getAccountsSummary(): Promise<MbnaAccountSummary[]> {
      const data = await mbnaGet('/accounts/summary');

      if (!Array.isArray(data)) {
        throw new Error('Unexpected MBNA accounts summary format: expected array');
      }

      return (data as Record<string, unknown>[]).map(normalizeAccountSummary);
    },

    /**
     * Fetch current account info (detailed, single-account view).
     * GET /waw/mbna/current-account
     */
    async getAccountInfo(): Promise<MbnaAccountInfo> {
      const data = await mbnaGet('/current-account');

      const cardName = extractCardName(data);
      const cardSummary = data.cardSummary as Record<string, unknown> | undefined;
      const endingIn = (cardSummary?.endingIn as string) || null;

      return {
        accountId: (data.accountNumber as string) || null,
        endingIn,
        cardName,
        displayName: cardName && endingIn ? `${cardName} (${endingIn})` : cardName || null,
        currentBalance: (cardSummary?.currentBalance as number) ?? null,
        creditAvailable: (cardSummary?.creditAvailable as number) ?? null,
        raw: data,
      };
    },

    /**
     * Fetch account snapshot (balance, credit limit, transactions summary).
     * GET /waw/mbna/accounts/{accountId}/snapshot
     */
    async getAccountSnapshot(accountId: string): Promise<Record<string, unknown>> {
      if (!accountId) {
        throw new Error('Account ID is required');
      }

      return mbnaGet(`/accounts/${accountId}/snapshot`);
    },

    /**
     * Fetch current balance for an account.
     * Delegates to getAccountSnapshot and extracts balance fields.
     */
    async getBalance(accountId: string): Promise<MbnaBalanceData> {
      const data = await this.getAccountSnapshot(accountId);
      const accountBalances = data.accountBalances as Record<string, unknown> | undefined;
      const snapshotBalances = data.accountSnapshotBalances as Record<string, unknown> | undefined;

      return {
        currentBalance: (accountBalances?.currentBalance as number) ?? null,
        creditAvailable: (accountBalances?.creditAvailable as number) ?? null,
        creditLimit: (snapshotBalances?.creditLimit as number) ?? null,
        currency: 'CAD',
        raw: data,
      };
    },

    /**
     * Fetch credit limit for an account.
     * Delegates to getAccountSnapshot and extracts credit limit.
     */
    async getCreditLimit(accountId: string): Promise<number | null> {
      const data = await this.getAccountSnapshot(accountId);
      const snapshotBalances = data.accountSnapshotBalances as Record<string, unknown> | undefined;
      return (snapshotBalances?.creditLimit as number) ?? null;
    },

    /**
     * Fetch transactions from the current billing cycle.
     * Extracts pending and settled transactions from the account snapshot.
     */
    async getCurrentCycleTransactions(accountId: string): Promise<MbnaCycleTransactions> {
      const data = await this.getAccountSnapshot(accountId);
      const accountTransactions = data.accountTransactions as Record<string, unknown> | undefined;

      const pending = (accountTransactions?.pendingTransactions || []) as MbnaRawTransaction[];
      const settled = (accountTransactions?.recentTransactions || []) as MbnaRawTransaction[];

      return { pending, settled };
    },

    /**
     * Fetch available statement closing dates for an account.
     * GET /waw/mbna/accounts/statement/{accountId}/closingdatedropdown
     */
    async getClosingDates(accountId: string): Promise<string[]> {
      if (!accountId) {
        throw new Error('Account ID is required');
      }

      const data = await mbnaGet(`/accounts/statement/${accountId}/closingdatedropdown`);

      const closingDateObj = data.closingDate;
      if (!closingDateObj || typeof closingDateObj !== 'object') {
        throw new Error('Unexpected closing dates format: missing closingDate object');
      }

      // Extract date keys, filtering out "mostRecentTransactions"
      const dates = Object.keys(closingDateObj as Record<string, unknown>)
        .filter((key) => key !== 'mostRecentTransactions')
        .filter((key) => /^\d{4}-\d{2}-\d{2}$/.test(key))
        .sort((a, b) => b.localeCompare(a)); // Newest first

      return dates;
    },

    /**
     * Fetch statement details for a specific closing date.
     * GET /waw/mbna/accounts/{accountId}/statement/closingdate/{closingDate}
     */
    async getStatementByClosingDate(accountId: string, closingDate: string): Promise<MbnaNormalizedStatement> {
      if (!accountId) {
        throw new Error('Account ID is required');
      }
      if (!closingDate) {
        throw new Error('Closing date is required');
      }

      const data = await mbnaGet(`/accounts/${accountId}/statement/closingdate/${closingDate}`);
      const statement = data.statement as Record<string, unknown> | undefined;

      if (!statement) {
        throw new Error('Unexpected statement format: missing statement object');
      }

      return {
        statementBalance: (statement.statementBalance as number) ?? null,
        creditLimit: (statement.creditLimit as number) ?? null,
        statementClosingDate: (statement.statementClosingDate as string) || closingDate,
        minPaymentDue: (statement.minPaymentDue as number) ?? null,
        minPaymentDueDate: (statement.minPaymentDueDate as string) || null,
        nextStatementClosingDate: (statement.nextStatementClosingDate as string) || null,
        transactions: (statement.accountTransactions || []) as MbnaRawTransaction[],
        raw: data,
      };
    },

    /**
     * Fetch all transactions for an account within a date range.
     *
     * Combines current billing cycle transactions (from snapshot) with
     * historical statement transactions. Iterates through past billing
     * cycles until all transactions within the requested date range
     * are collected.
     */
    async getTransactions(accountId: string, startDate: string, { onProgress }: GetTransactionsOptions = {}): Promise<MbnaTransactionResult> {
      if (!accountId) {
        throw new Error('Account ID is required');
      }

      // Step 1: Get current cycle transactions
      const currentCycle = await this.getCurrentCycleTransactions(accountId);

      // Step 2: Get closing dates for historical statements
      let closingDates: string[];
      try {
        closingDates = await this.getClosingDates(accountId);
      } catch (_error) {
        // If closing dates unavailable, return only current cycle
        return {
          currentCycle,
          statements: [],
          allSettled: [...currentCycle.settled],
          allPending: [...currentCycle.pending],
        };
      }

      // Step 3: Filter closing dates to those relevant for the requested range
      const relevantDates = startDate
        ? closingDates.filter((date) => date >= startDate)
        : closingDates;

      // Step 4: Fetch each relevant statement
      const statements: MbnaStatementSummary[] = [];
      for (let i = 0; i < relevantDates.length; i += 1) {
        const closingDate = relevantDates[i];

        if (onProgress) {
          onProgress(i + 1, relevantDates.length, closingDate);
        }

        const statement = await this.getStatementByClosingDate(accountId, closingDate);
        statements.push({
          closingDate,
          statementBalance: statement.statementBalance,
          transactions: statement.transactions,
          raw: statement,
        });
      }

      // Step 5: Merge all settled transactions and deduplicate by referenceNumber
      const seenRefs = new Set<string>();
      const allSettled: MbnaRawTransaction[] = [];

      // Add current cycle settled transactions first (most recent)
      for (const tx of currentCycle.settled) {
        if (tx.referenceNumber && tx.referenceNumber !== 'TEMP' && !seenRefs.has(tx.referenceNumber)) {
          seenRefs.add(tx.referenceNumber);
          allSettled.push(tx);
        }
      }

      // Add historical statement transactions
      for (const statement of statements) {
        for (const tx of statement.transactions) {
          if (tx.referenceNumber && tx.referenceNumber !== 'TEMP' && !seenRefs.has(tx.referenceNumber)) {
            seenRefs.add(tx.referenceNumber);
            allSettled.push(tx);
          }
        }
      }

      // Filter by startDate if provided
      const filteredSettled = startDate
        ? allSettled.filter((tx) => (tx.transactionDate || tx.postingDate || '') >= startDate)
        : allSettled;

      return {
        currentCycle,
        statements,
        allSettled: filteredSettled,
        allPending: [...currentCycle.pending],
      };
    },
  };
}

export default { createApi };