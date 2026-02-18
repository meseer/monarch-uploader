/**
 * MBNA API Client
 *
 * Tampermonkey-agnostic API client for MBNA. Receives injected httpClient
 * and auth handler. All MBNA API endpoints live under /waw/mbna/.
 *
 * Returns raw MBNA data. Does NOT transform data into Monarch format.
 *
 * @module integrations/mbna/api
 */

/**
 * MBNA API base URL
 */
const BASE_URL = 'https://service.mbna.ca/waw/mbna';

/**
 * Standard headers sent with every MBNA API request.
 * Note: No Cookie header needed — GM_xmlhttpRequest automatically
 * includes browser cookies (including HttpOnly) for same-origin requests.
 */
const STANDARD_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  Referer: 'https://service.mbna.ca/waw/mbna/index.html',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
};

/**
 * Extract English card name from account info response
 * @param {Object} data - Raw account info response
 * @returns {string|null} Card name or null
 */
function extractCardName(data) {
  const cardArtInfos = data.cardSummary?.cardArtInfos;
  if (!Array.isArray(cardArtInfos)) {
    return null;
  }

  const englishCard = cardArtInfos.find((info) => info.language === 'en');
  return englishCard?.cardName || null;
}

/**
 * Normalize a single account summary entry from /accounts/summary
 * @param {Object} entry - Raw account summary entry
 * @returns {Object} Normalized account object
 */
function normalizeAccountSummary(entry) {
  return {
    accountId: entry.accountId || null,
    endingIn: entry.endingIn || null,
    cardName: entry.cardName || null,
    cardNameShort: entry.cardNameShort || null,
    displayName: entry.cardName && entry.endingIn
      ? `${entry.cardName} (${entry.endingIn})`
      : entry.cardName || null,
    primaryCardHolder: entry.primaryCardHolder ?? false,
    raw: entry,
  };
}

/**
 * Create an MBNA API client
 *
 * @param {import('../../core/httpClient').HttpClient} httpClient - Injected HTTP client
 * @param {Object} auth - Auth handler with getCredentials()
 * @returns {Object} API client instance
 */
export function createApi(httpClient, _auth) {
  /**
   * Make an authenticated GET request to the MBNA API.
   * All MBNA endpoints use the same GET pattern.
   * Cookies (including HttpOnly JSESSIONID) are forwarded automatically
   * by GM_xmlhttpRequest for same-origin requests.
   *
   * @param {string} path - API path relative to /waw/mbna/ (e.g., '/current-account')
   * @returns {Promise<Object>} Parsed JSON response
   * @throws {Error} On auth failure, HTTP errors, or parse errors
   */
  async function mbnaGet(path) {
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
      throw new Error(`Failed to parse MBNA API response: ${error.message}`);
    }
  }

  return {
    /**
     * Fetch accounts summary (list of all accounts).
     * GET /waw/mbna/accounts/summary
     *
     * This is the primary endpoint for discovering accounts and serves
     * as a connection probe during initialization.
     *
     * @returns {Promise<Object[]>} Array of normalized account objects
     */
    async getAccountsSummary() {
      const data = await mbnaGet('/accounts/summary');

      if (!Array.isArray(data)) {
        throw new Error('Unexpected MBNA accounts summary format: expected array');
      }

      return data.map(normalizeAccountSummary);
    },

    /**
     * Fetch current account info (detailed, single-account view).
     * GET /waw/mbna/current-account
     *
     * @returns {Promise<Object>} Account info with accountId, card details, balance
     */
    async getAccountInfo() {
      const data = await mbnaGet('/current-account');

      const cardName = extractCardName(data);
      const endingIn = data.cardSummary?.endingIn || null;

      return {
        accountId: data.accountNumber || null,
        endingIn,
        cardName,
        displayName: cardName && endingIn ? `${cardName} (${endingIn})` : cardName || null,
        currentBalance: data.cardSummary?.currentBalance ?? null,
        creditAvailable: data.cardSummary?.creditAvailable ?? null,
        raw: data,
      };
    },

    /**
     * Fetch account snapshot (balance, credit limit, transactions summary).
     * GET /waw/mbna/accounts/{accountId}/snapshot
     *
     * @param {string} accountId - MBNA account ID
     * @returns {Promise<Object>} Account snapshot
     */
    async getAccountSnapshot(accountId) {
      if (!accountId) {
        throw new Error('Account ID is required');
      }

      return mbnaGet(`/accounts/${accountId}/snapshot`);
    },

    /**
     * Fetch current balance for an account.
     * Delegates to getAccountSnapshot and extracts balance fields.
     *
     * @param {string} accountId - MBNA account ID
     * @returns {Promise<Object>} Balance data { currentBalance, creditAvailable, creditLimit, currency }
     */
    async getBalance(accountId) {
      const data = await this.getAccountSnapshot(accountId);
      return {
        currentBalance: data?.accountBalances?.currentBalance ?? null,
        creditAvailable: data?.accountBalances?.creditAvailable ?? null,
        creditLimit: data?.accountSnapshotBalances?.creditLimit ?? null,
        currency: 'CAD',
        raw: data,
      };
    },

    /**
     * Fetch credit limit for an account.
     * Delegates to getAccountSnapshot and extracts credit limit.
     *
     * @param {string} accountId - MBNA account ID
     * @returns {Promise<number|null>} Credit limit or null
     */
    async getCreditLimit(accountId) {
      const data = await this.getAccountSnapshot(accountId);
      return data?.accountSnapshotBalances?.creditLimit ?? null;
    },

    /**
     * Fetch transactions for an account within a date range.
     *
     * @param {string} _accountId - MBNA account ID
     * @param {string} _startDate - Start date (YYYY-MM-DD)
     * @param {string} _endDate - End date (YYYY-MM-DD)
     * @returns {Promise<Object[]>} Array of raw transaction objects
     */
    async getTransactions(_accountId, _startDate, _endDate) {
      // TODO: Milestone 5 — implement transaction fetching
      return [];
    },
  };
}

export default { createApi };