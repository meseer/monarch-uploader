/**
 * Tests for Wealthsimple API Client - Credit Card Queries
 *
 * Covers: fetchCreditCardActivity, fetchCreditCardAccountSummary
 */

import wealthsimpleApi from '../../src/api/wealthsimple';
import { STORAGE } from '../../src/core/config';

global.GM_getValue = jest.fn();
global.GM_setValue = jest.fn();
global.GM_deleteValue = jest.fn();
global.GM_xmlhttpRequest = jest.fn();

Object.defineProperty(document, 'cookie', {
  writable: true,
  value: '',
});

jest.mock('../../src/core/state', () => ({
  __esModule: true,
  default: {
    setWealthsimpleAuth: jest.fn(),
  },
}));

/**
 * Helper to set up GM_getValue mock with Wealthsimple auth in configStore format.
 */
function setupConfigStoreAuth(authData) {
  GM_getValue.mockImplementation((key, defaultValue) => {
    if (key === STORAGE.WEALTHSIMPLE_CONFIG) {
      if (!authData) return '{}';
      return JSON.stringify({ auth: authData });
    }
    if (key === 'debug_log_level') return 'info';
    return defaultValue !== undefined ? defaultValue : null;
  });
}

/** Activity ID matching the real card-activity ID format */
const ACTIVITY_ID = 'card-activity-00000000527000993851-VI-00-0306231535741989-QIRIAS-0tk4pfcsob83';

/** Full settled foreign purchase response as returned by Wealthsimple */
function buildForeignActivityResponse(overrides = {}) {
  return {
    creditCardActivity: {
      id: ACTIVITY_ID,
      type: 'purchase',
      amount: '-47.16',
      originalAmount: '-29.29',
      isForeign: true,
      foreignAmount: -29,
      foreignCurrency: 'EUR',
      foreignExchangeRate: '1.610106',
      originalCurrency: 'EUR',
      currency: 'CAD',
      settledAt: '2026-08-21 16:50:00 UTC',
      descriptor: 'purchase',
      status: 'settled',
      cardNumber: '6903',
      cardVariant: 'primary',
      cardholderFirstName: 'Mykhailo',
      fees: [],
      creditReward: {
        rewardAmount: '0.94',
        rewardRate: '0.02',
        __typename: 'CreditReward',
      },
      surchargeAmount: null,
      surchargeCurrency: null,
      disputable: true,
      __typename: 'CreditCardActivity',
      ...overrides,
    },
  };
}

describe('Wealthsimple API Client - Credit Card', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    document.cookie = '';

    const futureDate = new Date(Date.now() + 3600000).toISOString();
    setupConfigStoreAuth({
      accessToken: 'test-token',
      identityId: 'identity-123',
      expiresAt: futureDate,
    });
  });

  describe('fetchCreditCardActivity', () => {
    it('returns null for a null activity ID without making a request', async () => {
      const result = await wealthsimpleApi.fetchCreditCardActivity(null);

      expect(result).toBeNull();
      expect(GM_xmlhttpRequest).not.toHaveBeenCalled();
    });

    it('returns null for an empty activity ID without making a request', async () => {
      const result = await wealthsimpleApi.fetchCreditCardActivity('');

      expect(result).toBeNull();
      expect(GM_xmlhttpRequest).not.toHaveBeenCalled();
    });

    it('normalizes a settled foreign purchase including the precise original amount', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: buildForeignActivityResponse() }),
        });
      });

      const result = await wealthsimpleApi.fetchCreditCardActivity(ACTIVITY_ID);

      expect(result).not.toBeNull();
      expect(result.id).toBe(ACTIVITY_ID);
      expect(result.status).toBe('settled');
      expect(result.isForeign).toBe(true);
      // originalAmount is the precise value; foreignAmount is truncated
      expect(result.originalAmount).toBe('-29.29');
      expect(result.foreignAmount).toBe(-29);
      expect(result.originalCurrency).toBe('EUR');
      expect(result.foreignCurrency).toBe('EUR');
      expect(result.foreignExchangeRate).toBe('1.610106');
    });

    it('flags rewards and exposes the reward rate', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: buildForeignActivityResponse() }),
        });
      });

      const result = await wealthsimpleApi.fetchCreditCardActivity(ACTIVITY_ID);

      expect(result.hasReward).toBe(true);
      expect(result.rewardAmount).toBe('0.94');
      expect(result.rewardRate).toBe('0.02');
    });

    it('reports hasReward false when there is no credit reward', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({
            data: buildForeignActivityResponse({ creditReward: null }),
          }),
        });
      });

      const result = await wealthsimpleApi.fetchCreditCardActivity(ACTIVITY_ID);

      expect(result.hasReward).toBe(false);
      expect(result.rewardAmount).toBeNull();
      expect(result.rewardRate).toBeNull();
    });

    it('normalizes a pending activity with no FX values yet', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({
            data: buildForeignActivityResponse({
              status: 'authorized',
              originalAmount: null,
              foreignExchangeRate: null,
              creditReward: null,
            }),
          }),
        });
      });

      const result = await wealthsimpleApi.fetchCreditCardActivity(ACTIVITY_ID);

      expect(result.status).toBe('authorized');
      expect(result.originalAmount).toBeNull();
      expect(result.foreignExchangeRate).toBeNull();
    });

    it('normalizes a domestic purchase with isForeign false', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({
            data: buildForeignActivityResponse({
              isForeign: false,
              originalAmount: '-12.34',
              originalCurrency: 'CAD',
              foreignAmount: null,
              foreignCurrency: null,
              foreignExchangeRate: null,
            }),
          }),
        });
      });

      const result = await wealthsimpleApi.fetchCreditCardActivity(ACTIVITY_ID);

      expect(result.isForeign).toBe(false);
      expect(result.foreignCurrency).toBeNull();
    });

    it('sends the FetchCreditCardActivity operation with the activity ID', async () => {
      GM_xmlhttpRequest.mockImplementation(({ data, onload }) => {
        const parsedData = JSON.parse(data);
        expect(parsedData.operationName).toBe('FetchCreditCardActivity');
        expect(parsedData.variables.id).toBe(ACTIVITY_ID);
        expect(parsedData.query).toContain('creditCardActivity(id: $id)');
        expect(parsedData.query).toContain('originalAmount');
        expect(parsedData.query).toContain('foreignExchangeRate');

        onload({
          status: 200,
          responseText: JSON.stringify({ data: buildForeignActivityResponse() }),
        });
      });

      await wealthsimpleApi.fetchCreditCardActivity(ACTIVITY_ID);

      expect(GM_xmlhttpRequest).toHaveBeenCalledTimes(1);
    });

    it('returns null when the activity is not found', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: { creditCardActivity: null } }),
        });
      });

      const result = await wealthsimpleApi.fetchCreditCardActivity(ACTIVITY_ID);

      expect(result).toBeNull();
    });

    it('returns null (does not throw) on a GraphQL error so the sync continues', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({
            errors: [{ message: 'Forbidden', extensions: { code: 403 } }],
          }),
        });
      });

      const result = await wealthsimpleApi.fetchCreditCardActivity(ACTIVITY_ID);

      expect(result).toBeNull();
    });

    it('returns null on a network error so the sync continues', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onerror }) => {
        onerror(new Error('offline'));
      });

      const result = await wealthsimpleApi.fetchCreditCardActivity(ACTIVITY_ID);

      expect(result).toBeNull();
    });
  });

  describe('fetchCreditCardAccountSummary', () => {
    it('still resolves after being moved to the credit card module', async () => {
      GM_xmlhttpRequest.mockImplementation(({ data, onload }) => {
        const parsedData = JSON.parse(data);
        expect(parsedData.operationName).toBe('FetchCreditCardAccountSummary');

        onload({
          status: 200,
          responseText: JSON.stringify({
            data: {
              creditCardAccount: {
                id: 'ca-credit-card-FYPcSZJeLA',
                balance: { current: 123.45 },
                creditRegistrationStatus: 'registered',
                creditLimit: 5000,
                currentCards: [{ id: 'card-1', cardNumberLast4Digits: '6903', cardVariant: 'primary' }],
              },
            },
          }),
        });
      });

      const result = await wealthsimpleApi.fetchCreditCardAccountSummary('ca-credit-card-FYPcSZJeLA');

      expect(result.creditLimit).toBe(5000);
      expect(result.currentCards[0].cardNumberLast4Digits).toBe('6903');
    });

    it('throws when the account ID is missing', async () => {
      await expect(wealthsimpleApi.fetchCreditCardAccountSummary('')).rejects.toThrow('Account ID is required');
      expect(GM_xmlhttpRequest).not.toHaveBeenCalled();
    });
  });
});