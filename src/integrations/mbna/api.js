/**
 * MBNA API Client
 *
 * Tampermonkey-agnostic API client for MBNA. Receives injected httpClient
 * and storage adapters — never calls GM_* directly.
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
 * Create an MBNA API client
 *
 * @param {import('../../core/httpClient').HttpClient} httpClient - Injected HTTP client
 * @param {import('../../core/storageAdapter').StorageAdapter} storage - Injected storage adapter
 * @returns {import('../types').IntegrationApi} API client instance
 */
export function createApi(httpClient, _storage) {
  /**
   * Make a GET request to the MBNA API
   * @param {string} path - API path (appended to BASE_URL)
   * @param {Object} [options] - Additional options
   * @returns {Promise<Object>} Parsed JSON response
   */
  async function get(path, options = {}) {
    const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;

    const response = await httpClient.request({
      method: 'GET',
      url,
      headers: {
        accept: 'application/json, text/plain, */*',
        ...options.headers,
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
     * Fetch current account info.
     * GET /waw/mbna/current-account
     *
     * @returns {Promise<Object>} Account info with accountNumber, cardSummary
     */
    async getAccountInfo() {
      const data = await get('/current-account');

      return {
        accountNumber: data.accountNumber || null,
        endingIn: data.cardSummary?.endingIn || null,
        cardName: extractCardName(data) || null,
        raw: data,
      };
    },

    /**
     * Fetch account snapshot (balance, credit limit, transactions summary).
     * GET /waw/mbna/accounts/{accountNumber}/snapshot
     *
     * @param {string} accountNumber - MBNA account number
     * @returns {Promise<Object>} Account snapshot
     */
    async getAccountSnapshot(accountNumber) {
      if (!accountNumber) {
        throw new Error('Account number is required');
      }

      const data = await get(`/accounts/${accountNumber}/snapshot`);
      return data;
    },

    /**
     * Fetch current balance for an account.
     * Delegates to getAccountSnapshot and extracts balance.
     *
     * @param {string} accountNumber - MBNA account number
     * @returns {Promise<Object>} Balance data { amount, currency }
     */
    async getBalance(accountNumber) {
      // TODO: Milestone 4 — implement using getAccountSnapshot()
      const data = await this.getAccountSnapshot(accountNumber);
      return {
        amount: null, // Will be extracted from snapshot
        currency: 'CAD',
        raw: data,
      };
    },

    /**
     * Fetch credit limit for an account.
     * Delegates to getAccountSnapshot and extracts credit limit.
     *
     * @param {string} accountNumber - MBNA account number
     * @returns {Promise<number|null>} Credit limit or null
     */
    async getCreditLimit(accountNumber) {
      // TODO: Milestone 4 — implement using getAccountSnapshot()
      await this.getAccountSnapshot(accountNumber);
      return null; // Will be extracted from snapshot
    },

    /**
     * Fetch transactions for an account within a date range.
     *
     * @param {string} accountNumber - MBNA account number
     * @param {string} startDate - Start date (YYYY-MM-DD)
     * @param {string} endDate - End date (YYYY-MM-DD)
     * @returns {Promise<Object[]>} Array of raw transaction objects
     */
    async getTransactions(_accountNumber, _startDate, endDate) {
      // TODO: Milestone 5 — implement transaction fetching
      // Endpoint and response format TBD
      return [];
    },
  };
}

/**
 * Extract English card name from account info response
 * @param {Object} data - Raw account info response
 * @returns {string|null} Card name or null
 */
function extractCardName(data) {
  const cardArtInfo = data.cardSummary?.cardArtInfo;
  if (!Array.isArray(cardArtInfo)) {
    return null;
  }

  const englishCard = cardArtInfo.find((info) => info.language === 'en');
  return englishCard?.cardName || null;
}

export default { createApi };