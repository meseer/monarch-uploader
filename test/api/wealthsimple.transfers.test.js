/**
 * Tests for Wealthsimple API Client - Transfers & Positions
 *
 * Covers: fetchInternalTransfer, fetchFundsTransfer, fetchShortOptionPositionExpiryDetail,
 * fetchManagedPortfolioPositions, fetchActivityByOrdersServiceOrderId, fetchExtendedOrder
 */

import wealthsimpleApi from '../../src/api/wealthsimple';
import { STORAGE, API } from '../../src/core/config';

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

describe('Wealthsimple API Client - Transfers & Positions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    document.cookie = '';
    jest.clearAllTimers();
  });

  describe('fetchInternalTransfer', () => {
    beforeEach(() => {
      const futureDate = new Date(Date.now() + 3600000).toISOString();
      GM_getValue.mockImplementation((key) => {
        if (key === STORAGE.WEALTHSIMPLE_ACCESS_TOKEN) return 'test-token';
        if (key === STORAGE.WEALTHSIMPLE_IDENTITY_ID) return 'identity-123';
        if (key === STORAGE.WEALTHSIMPLE_TOKEN_EXPIRES_AT) return futureDate;
        return null;
      });
    });

    it('should return null for null input', async () => {
      const result = await wealthsimpleApi.fetchInternalTransfer(null);
      expect(result).toBeNull();
      expect(GM_xmlhttpRequest).not.toHaveBeenCalled();
    });

    it('should return null for empty string input', async () => {
      const result = await wealthsimpleApi.fetchInternalTransfer('');
      expect(result).toBeNull();
      expect(GM_xmlhttpRequest).not.toHaveBeenCalled();
    });

    it('should fetch internal transfer details successfully', async () => {
      const mockResponse = {
        internalTransfer: {
          id: 'funding_intent-RHgNxU9iOg99IbPmQwSErvXLL0n',
          amount: '19.68',
          currency: 'CAD',
          fxRate: null,
          fxAdjustedAmount: null,
          reportedFxAdjustedAmount: null,
          fxFeeRate: null,
          isCancellable: false,
          status: 'completed',
          transferType: 'partial_in_cash',
          instantEligibility: {
            status: 'eligible',
            amount: '19.68',
            __typename: 'InternalTransferInstantEligibility',
          },
          tax_detail: null,
          annotation: 'additional payment landed in wrong account',
          reason: null,
          __typename: 'InternalTransfer',
          source_account: {
            id: 'ca-cash-msb-4IX85yCxIw',
            unifiedAccountType: 'CASH',
            __typename: 'Account',
          },
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchInternalTransfer('funding_intent-RHgNxU9iOg99IbPmQwSErvXLL0n');

      expect(result).not.toBeNull();
      expect(result.id).toBe('funding_intent-RHgNxU9iOg99IbPmQwSErvXLL0n');
      expect(result.annotation).toBe('additional payment landed in wrong account');
      expect(result.status).toBe('completed');
      expect(result.transferType).toBe('partial_in_cash');
    });

    it('should NOT inject identity ID into request', async () => {
      const mockResponse = {
        internalTransfer: {
          id: 'funding_intent-test123',
          annotation: 'test annotation',
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ data, onload }) => {
        const parsedData = JSON.parse(data);
        expect(parsedData.operationName).toBe('FetchInternalTransfer');
        // FetchInternalTransfer should NOT have identityId injected
        expect(parsedData.variables.identityId).toBeUndefined();
        expect(parsedData.variables.id).toBe('funding_intent-test123');

        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      await wealthsimpleApi.fetchInternalTransfer('funding_intent-test123');
    });

    it('should return null when no internalTransfer in response', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: {} }),
        });
      });

      const result = await wealthsimpleApi.fetchInternalTransfer('funding_intent-abc123');
      expect(result).toBeNull();
    });

    it('should return null on API error without failing', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({ status: 500 });
      });

      // Should not throw, just return null
      const result = await wealthsimpleApi.fetchInternalTransfer('funding_intent-abc123');
      expect(result).toBeNull();
    });

    it('should return null on network error without failing', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onerror }) => {
        onerror(new Error('Network failure'));
      });

      // Should not throw, just return null
      const result = await wealthsimpleApi.fetchInternalTransfer('funding_intent-abc123');
      expect(result).toBeNull();
    });

    it('should handle internal transfer without annotation', async () => {
      const mockResponse = {
        internalTransfer: {
          id: 'funding_intent-no-annotation',
          amount: '100.00',
          currency: 'CAD',
          status: 'completed',
          annotation: null,
          reason: null,
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchInternalTransfer('funding_intent-no-annotation');

      expect(result).not.toBeNull();
      expect(result.annotation).toBeNull();
    });
  });

  describe('fetchFundsTransfer', () => {
    beforeEach(() => {
      const futureDate = new Date(Date.now() + 3600000).toISOString();
      GM_getValue.mockImplementation((key) => {
        if (key === STORAGE.WEALTHSIMPLE_ACCESS_TOKEN) return 'test-token';
        if (key === STORAGE.WEALTHSIMPLE_IDENTITY_ID) return 'identity-123';
        if (key === STORAGE.WEALTHSIMPLE_TOKEN_EXPIRES_AT) return futureDate;
        return null;
      });
    });

    it('should return null for null input', async () => {
      const result = await wealthsimpleApi.fetchFundsTransfer(null);
      expect(result).toBeNull();
      expect(GM_xmlhttpRequest).not.toHaveBeenCalled();
    });

    it('should return null for empty string input', async () => {
      const result = await wealthsimpleApi.fetchFundsTransfer('');
      expect(result).toBeNull();
      expect(GM_xmlhttpRequest).not.toHaveBeenCalled();
    });

    it('should fetch funds transfer details successfully', async () => {
      const mockResponse = {
        fundsTransfer: {
          id: 'funding_intent-OJbdrSdcFlCIPm3hagqmOM0sNhV',
          status: 'accepted',
          cancellable: false,
          annotation: null,
          rejectReason: null,
          schedule: null,
          destination: {
            bankAccount: {
              id: 'bank_account-2csO3N2RLuYwBZ6JIs8MHWH6bM',
              accountName: 'Tax Stash',
              corporate: false,
              createdAt: '2024-09-12T05:03:03.753780Z',
              currency: 'CAD',
              institutionName: 'EQ Bank',
              jurisdiction: 'CA',
              nickname: 'Tax Stash',
              type: 'savings',
              updatedAt: '2024-09-12T05:03:03.753780Z',
              accountNumber: '****6297',
              __typename: 'CaBankAccount',
            },
            __typename: 'BankAccountOwner',
          },
          reason: null,
          tax_detail: null,
          __typename: 'Withdrawal',
          source: {
            id: 'ca-cash-msb-iusfagkx',
            nickname: '💳 Cash',
            currency: 'CAD',
            status: 'open',
            type: 'ca_cash_msb',
            __typename: 'Account',
          },
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchFundsTransfer('funding_intent-OJbdrSdcFlCIPm3hagqmOM0sNhV');

      expect(result).not.toBeNull();
      expect(result.id).toBe('funding_intent-OJbdrSdcFlCIPm3hagqmOM0sNhV');
      expect(result.status).toBe('accepted');
      expect(result.destination.bankAccount.institutionName).toBe('EQ Bank');
      expect(result.destination.bankAccount.nickname).toBe('Tax Stash');
      expect(result.destination.bankAccount.accountNumber).toBe('****6297');
      expect(result.destination.bankAccount.currency).toBe('CAD');
      expect(result.source.nickname).toBe('💳 Cash');
    });

    it('should NOT inject identity ID into request', async () => {
      const mockResponse = {
        fundsTransfer: {
          id: 'funding_intent-test123',
          status: 'accepted',
          annotation: 'test annotation',
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ data, onload }) => {
        const parsedData = JSON.parse(data);
        expect(parsedData.operationName).toBe('FetchFundsTransfer');
        // FetchFundsTransfer should NOT have identityId injected
        expect(parsedData.variables.identityId).toBeUndefined();
        expect(parsedData.variables.id).toBe('funding_intent-test123');

        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      await wealthsimpleApi.fetchFundsTransfer('funding_intent-test123');
    });

    it('should return null when no fundsTransfer in response', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: {} }),
        });
      });

      const result = await wealthsimpleApi.fetchFundsTransfer('funding_intent-abc123');
      expect(result).toBeNull();
    });

    it('should return null on API error without failing', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({ status: 500 });
      });

      // Should not throw, just return null
      const result = await wealthsimpleApi.fetchFundsTransfer('funding_intent-abc123');
      expect(result).toBeNull();
    });

    it('should return null on network error without failing', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onerror }) => {
        onerror(new Error('Network failure'));
      });

      // Should not throw, just return null
      const result = await wealthsimpleApi.fetchFundsTransfer('funding_intent-abc123');
      expect(result).toBeNull();
    });

    it('should handle funds transfer with annotation', async () => {
      const mockResponse = {
        fundsTransfer: {
          id: 'funding_intent-with-annotation',
          status: 'accepted',
          cancellable: false,
          annotation: 'Monthly savings transfer',
          rejectReason: null,
          destination: {
            bankAccount: {
              id: 'bank_account-xyz',
              institutionName: 'TD Bank',
              nickname: 'Savings',
              accountNumber: '****1234',
              currency: 'CAD',
            },
          },
          source: {
            id: 'ca-cash-account',
            nickname: 'Cash',
          },
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchFundsTransfer('funding_intent-with-annotation');

      expect(result).not.toBeNull();
      expect(result.annotation).toBe('Monthly savings transfer');
    });

    it('should handle funds transfer without destination bank account', async () => {
      const mockResponse = {
        fundsTransfer: {
          id: 'funding_intent-no-dest-bank',
          status: 'accepted',
          annotation: null,
          destination: {
            bankAccount: null,
            __typename: 'BankAccountOwner',
          },
          source: {
            id: 'ca-cash-account',
            nickname: 'Cash',
          },
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchFundsTransfer('funding_intent-no-dest-bank');

      expect(result).not.toBeNull();
      expect(result.destination.bankAccount).toBeNull();
    });

    it('should handle deposit type funds transfer (source has bank account)', async () => {
      const mockResponse = {
        fundsTransfer: {
          id: 'funding_intent-deposit',
          status: 'accepted',
          cancellable: false,
          annotation: null,
          rejectReason: null,
          source: {
            bankAccount: {
              id: 'bank_account-source',
              institutionName: 'RBC',
              nickname: 'Chequing',
              accountNumber: '****5678',
              currency: 'CAD',
            },
          },
          destination: {
            id: 'ca-cash-dest',
            nickname: 'Wealthsimple Cash',
          },
          __typename: 'Deposit',
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchFundsTransfer('funding_intent-deposit');

      expect(result).not.toBeNull();
      expect(result.source.bankAccount.institutionName).toBe('RBC');
      expect(result.source.bankAccount.accountNumber).toBe('****5678');
    });

    it('should return full object with all fields for future use', async () => {
      const mockResponse = {
        fundsTransfer: {
          id: 'funding_intent-full',
          status: 'accepted',
          cancellable: false,
          annotation: 'Test annotation',
          rejectReason: null,
          schedule: {
            id: 'schedule-123',
            is_skippable: true,
            recurrence: {
              events: ['2026-01-15', '2026-02-15', '2026-03-15'],
            },
          },
          destination: {
            bankAccount: {
              id: 'bank_account-full',
              accountName: 'Full Account',
              corporate: false,
              createdAt: '2024-01-01T00:00:00.000000Z',
              currency: 'CAD',
              institutionName: 'Test Bank',
              jurisdiction: 'CA',
              nickname: 'Full Nickname',
              type: 'chequing',
              updatedAt: '2024-06-01T00:00:00.000000Z',
              verificationDocuments: [],
              verifications: [],
              accountNumber: '****9999',
              __typename: 'CaBankAccount',
            },
            __typename: 'BankAccountOwner',
          },
          reason: 'planned_expense',
          tax_detail: null,
          __typename: 'Withdrawal',
          source: {
            id: 'ca-cash-full',
            archivedAt: null,
            branch: 'WS',
            closedAt: null,
            createdAt: '2021-07-12T21:35:38.853909Z',
            currency: 'CAD',
            nickname: 'Full Cash',
            status: 'open',
            type: 'ca_cash_msb',
            __typename: 'Account',
          },
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchFundsTransfer('funding_intent-full');

      expect(result).not.toBeNull();
      // Verify the full object is returned for future use
      expect(result.schedule).not.toBeNull();
      expect(result.schedule.id).toBe('schedule-123');
      expect(result.schedule.recurrence.events).toHaveLength(3);
      expect(result.destination.bankAccount.verificationDocuments).toEqual([]);
      expect(result.reason).toBe('planned_expense');
      expect(result.source.branch).toBe('WS');
    });
  });

  describe('fetchShortOptionPositionExpiryDetail', () => {
    beforeEach(() => {
      const futureDate = new Date(Date.now() + 3600000).toISOString();
      GM_getValue.mockImplementation((key) => {
        if (key === STORAGE.WEALTHSIMPLE_ACCESS_TOKEN) return 'test-token';
        if (key === STORAGE.WEALTHSIMPLE_IDENTITY_ID) return 'identity-123';
        if (key === STORAGE.WEALTHSIMPLE_TOKEN_EXPIRES_AT) return futureDate;
        return null;
      });
    });

    it('should return null for null input', async () => {
      const result = await wealthsimpleApi.fetchShortOptionPositionExpiryDetail(null);
      expect(result).toBeNull();
      expect(GM_xmlhttpRequest).not.toHaveBeenCalled();
    });

    it('should return null for empty string input', async () => {
      const result = await wealthsimpleApi.fetchShortOptionPositionExpiryDetail('');
      expect(result).toBeNull();
      expect(GM_xmlhttpRequest).not.toHaveBeenCalled();
    });

    it('should fetch short option position expiry detail successfully', async () => {
      const mockResponse = {
        shortOptionPositionExpiryDetail: {
          id: 'oe-c8861ccc2c9905f176b8946b5bedfaae4b0b2cde',
          decision: 'EXPIRE',
          reason: 'EXPIRE',
          fxRate: '1.3531',
          custodianAccountId: 'H10739748CAD',
          deliverables: [
            {
              quantity: '3.3333',
              securityId: 'sec-s-555ffa9de9ad47d2925dda6a2032c225',
              __typename: 'Deliverable',
            },
          ],
          securityCurrency: 'USD',
          __typename: 'ShortPositionExpiryDetail',
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchShortOptionPositionExpiryDetail('oe-c8861ccc2c9905f176b8946b5bedfaae4b0b2cde');

      expect(result).not.toBeNull();
      expect(result.id).toBe('oe-c8861ccc2c9905f176b8946b5bedfaae4b0b2cde');
      expect(result.decision).toBe('EXPIRE');
      expect(result.reason).toBe('EXPIRE');
      expect(result.fxRate).toBe('1.3531');
      expect(result.custodianAccountId).toBe('H10739748CAD');
      expect(result.securityCurrency).toBe('USD');
      expect(result.deliverables).toHaveLength(1);
      expect(result.deliverables[0].quantity).toBe('3.3333');
      expect(result.deliverables[0].securityId).toBe('sec-s-555ffa9de9ad47d2925dda6a2032c225');
    });

    it('should pass correct ID in GraphQL query', async () => {
      const mockResponse = {
        shortOptionPositionExpiryDetail: {
          id: 'oe-test123',
          decision: 'ASSIGN',
          reason: 'ASSIGN',
          fxRate: '1.0000',
          custodianAccountId: 'H12345678CAD',
          deliverables: [],
          securityCurrency: 'CAD',
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ data, onload }) => {
        const parsedData = JSON.parse(data);
        expect(parsedData.operationName).toBe('FetchShortOptionPositionExpiryDetail');
        expect(parsedData.variables.id).toBe('oe-test123');

        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      await wealthsimpleApi.fetchShortOptionPositionExpiryDetail('oe-test123');
    });

    it('should return null when no shortOptionPositionExpiryDetail in response', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: {} }),
        });
      });

      const result = await wealthsimpleApi.fetchShortOptionPositionExpiryDetail('oe-abc123');
      expect(result).toBeNull();
    });

    it('should return null on API error without failing', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({ status: 500 });
      });

      // Should not throw, just return null
      const result = await wealthsimpleApi.fetchShortOptionPositionExpiryDetail('oe-abc123');
      expect(result).toBeNull();
    });

    it('should return null on network error without failing', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onerror }) => {
        onerror(new Error('Network failure'));
      });

      // Should not throw, just return null
      const result = await wealthsimpleApi.fetchShortOptionPositionExpiryDetail('oe-abc123');
      expect(result).toBeNull();
    });

    it('should handle expiry detail with empty deliverables array', async () => {
      const mockResponse = {
        shortOptionPositionExpiryDetail: {
          id: 'oe-empty-deliverables',
          decision: 'EXPIRE',
          reason: 'OUT_OF_THE_MONEY',
          fxRate: '1.4000',
          custodianAccountId: 'H98765432CAD',
          deliverables: [],
          securityCurrency: 'USD',
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchShortOptionPositionExpiryDetail('oe-empty-deliverables');

      expect(result).not.toBeNull();
      expect(result.deliverables).toEqual([]);
    });

    it('should handle expiry detail with multiple deliverables', async () => {
      const mockResponse = {
        shortOptionPositionExpiryDetail: {
          id: 'oe-multi-deliverables',
          decision: 'ASSIGN',
          reason: 'ASSIGN',
          fxRate: '1.3500',
          custodianAccountId: 'H11111111CAD',
          deliverables: [
            {
              quantity: '100.0000',
              securityId: 'sec-s-aaaa',
              __typename: 'Deliverable',
            },
            {
              quantity: '50.0000',
              securityId: 'sec-s-bbbb',
              __typename: 'Deliverable',
            },
          ],
          securityCurrency: 'USD',
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchShortOptionPositionExpiryDetail('oe-multi-deliverables');

      expect(result).not.toBeNull();
      expect(result.deliverables).toHaveLength(2);
      expect(result.deliverables[0].quantity).toBe('100.0000');
      expect(result.deliverables[1].quantity).toBe('50.0000');
    });

    it('should handle expiry detail with null fxRate (same currency)', async () => {
      const mockResponse = {
        shortOptionPositionExpiryDetail: {
          id: 'oe-cad-currency',
          decision: 'EXPIRE',
          reason: 'EXPIRE',
          fxRate: null,
          custodianAccountId: 'H22222222CAD',
          deliverables: [],
          securityCurrency: 'CAD',
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchShortOptionPositionExpiryDetail('oe-cad-currency');

      expect(result).not.toBeNull();
      expect(result.fxRate).toBeNull();
      expect(result.securityCurrency).toBe('CAD');
    });

    it('should handle GraphQL errors', async () => {
      const errorResponse = {
        errors: [
          { message: 'Short option position expiry detail not found' },
        ],
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify(errorResponse),
        });
      });

      // Should return null on GraphQL error (graceful failure)
      const result = await wealthsimpleApi.fetchShortOptionPositionExpiryDetail('oe-not-found');
      expect(result).toBeNull();
    });
  });

  describe('fetchManagedPortfolioPositions', () => {
    beforeEach(() => {
      const futureDate = new Date(Date.now() + 3600000).toISOString();
      GM_getValue.mockImplementation((key) => {
        if (key === STORAGE.WEALTHSIMPLE_ACCESS_TOKEN) return 'test-token';
        if (key === STORAGE.WEALTHSIMPLE_IDENTITY_ID) return 'identity-123';
        if (key === STORAGE.WEALTHSIMPLE_TOKEN_EXPIRES_AT) return futureDate;
        return null;
      });
    });

    it('should require accountId parameter', async () => {
      await expect(
        wealthsimpleApi.fetchManagedPortfolioPositions(null),
      ).rejects.toThrow('Account ID is required');

      await expect(
        wealthsimpleApi.fetchManagedPortfolioPositions(''),
      ).rejects.toThrow('Account ID is required');
    });

    it('should fetch managed portfolio positions successfully', async () => {
      const mockResponse = {
        account: {
          id: 'resp-gjp2y-3a',
          positions: [
            { id: 'pos-1', symbol: 'CAD', quantity: '354.18', type: 'currency', name: 'CAD', value: '354.18' },
            { id: 'pos-2', symbol: 'EEMV', quantity: '57.3763', type: 'exchange_traded_fund', name: 'iShares ETF', value: '5284.35' },
          ],
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({ status: 200, responseText: JSON.stringify({ data: mockResponse }) });
      });

      const result = await wealthsimpleApi.fetchManagedPortfolioPositions('resp-gjp2y-3a');

      expect(result).toHaveLength(2);
      expect(result[0].symbol).toBe('CAD');
      expect(result[0].quantity).toBe('354.18');
      expect(result[1].symbol).toBe('EEMV');
    });

    it('should return empty array when no positions', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({ status: 200, responseText: JSON.stringify({ data: { account: { positions: [] } } }) });
      });

      const result = await wealthsimpleApi.fetchManagedPortfolioPositions('test-account');
      expect(result).toEqual([]);
    });

    it('should return empty array when no account in response', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({ status: 200, responseText: JSON.stringify({ data: {} }) });
      });

      const result = await wealthsimpleApi.fetchManagedPortfolioPositions('test-account');
      expect(result).toEqual([]);
    });
  });

  describe('fetchActivityByOrdersServiceOrderId', () => {
    beforeEach(() => {
      const futureDate = new Date(Date.now() + 3600000).toISOString();
      GM_getValue.mockImplementation((key) => {
        if (key === STORAGE.WEALTHSIMPLE_ACCESS_TOKEN) return 'test-token';
        if (key === STORAGE.WEALTHSIMPLE_IDENTITY_ID) return 'identity-123';
        if (key === STORAGE.WEALTHSIMPLE_TOKEN_EXPIRES_AT) return futureDate;
        return null;
      });
    });

    it('should return null for null accountId', async () => {
      const result = await wealthsimpleApi.fetchActivityByOrdersServiceOrderId(null, 'order-123');
      expect(result).toBeNull();
      expect(GM_xmlhttpRequest).not.toHaveBeenCalled();
    });

    it('should return null for null ordersServiceOrderId', async () => {
      const result = await wealthsimpleApi.fetchActivityByOrdersServiceOrderId('resp-gjp2y-3a', null);
      expect(result).toBeNull();
      expect(GM_xmlhttpRequest).not.toHaveBeenCalled();
    });

    it('should return null for empty accountId', async () => {
      const result = await wealthsimpleApi.fetchActivityByOrdersServiceOrderId('', 'order-123');
      expect(result).toBeNull();
      expect(GM_xmlhttpRequest).not.toHaveBeenCalled();
    });

    it('should return null for empty ordersServiceOrderId', async () => {
      const result = await wealthsimpleApi.fetchActivityByOrdersServiceOrderId('resp-gjp2y-3a', '');
      expect(result).toBeNull();
      expect(GM_xmlhttpRequest).not.toHaveBeenCalled();
    });

    it('should fetch activity by orders service order ID successfully', async () => {
      const mockResponse = {
        account: {
          id: 'resp-gjp2y-3a',
          activityByOrdersServiceOrderId: {
            id: 'custodian_account_activity-6cjmdMiO9VzGoLt_l8pKqGcvdxU',
            quantity: '0.8257',
            fxRate: '1.0',
            marketPrice: {
              amount: '11.165',
              currency: 'CAD',
              __typename: 'Amount',
            },
            __typename: 'PaginatedActivity',
          },
          __typename: 'Account',
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchActivityByOrdersServiceOrderId('resp-gjp2y-3a', 'order-00YDx9aoiwh1');

      expect(result).not.toBeNull();
      expect(result.id).toBe('custodian_account_activity-6cjmdMiO9VzGoLt_l8pKqGcvdxU');
      expect(result.quantity).toBe('0.8257');
      expect(result.fxRate).toBe('1.0');
      expect(result.marketPrice.amount).toBe('11.165');
      expect(result.marketPrice.currency).toBe('CAD');
    });

    it('should pass correct variables in GraphQL query', async () => {
      const mockResponse = {
        account: {
          id: 'test-account-id',
          activityByOrdersServiceOrderId: {
            id: 'activity-123',
            quantity: '1.0',
            fxRate: '1.35',
            marketPrice: { amount: '50.00', currency: 'USD' },
          },
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ data, onload }) => {
        const parsedData = JSON.parse(data);
        expect(parsedData.operationName).toBe('FetchActivityByOrdersServiceOrderId');
        expect(parsedData.variables.id).toBe('test-account-id');
        expect(parsedData.variables.ordersServiceOrderId).toBe('order-test123');
        // FetchActivityByOrdersServiceOrderId should NOT have identityId injected
        expect(parsedData.variables.identityId).toBeUndefined();

        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      await wealthsimpleApi.fetchActivityByOrdersServiceOrderId('test-account-id', 'order-test123');
    });

    it('should return null when no account in response', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: {} }),
        });
      });

      const result = await wealthsimpleApi.fetchActivityByOrdersServiceOrderId('resp-gjp2y-3a', 'order-123');
      expect(result).toBeNull();
    });

    it('should return null when no activityByOrdersServiceOrderId in response', async () => {
      const mockResponse = {
        account: {
          id: 'resp-gjp2y-3a',
          activityByOrdersServiceOrderId: null,
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchActivityByOrdersServiceOrderId('resp-gjp2y-3a', 'order-not-found');
      expect(result).toBeNull();
    });

    it('should return null on API error without failing', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({ status: 500 });
      });

      // Should not throw, just return null
      const result = await wealthsimpleApi.fetchActivityByOrdersServiceOrderId('resp-gjp2y-3a', 'order-error');
      expect(result).toBeNull();
    });

    it('should return null on network error without failing', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onerror }) => {
        onerror(new Error('Network failure'));
      });

      // Should not throw, just return null
      const result = await wealthsimpleApi.fetchActivityByOrdersServiceOrderId('resp-gjp2y-3a', 'order-network-error');
      expect(result).toBeNull();
    });

    it('should handle activity with different FX rate', async () => {
      const mockResponse = {
        account: {
          id: 'rrsp-abc123',
          activityByOrdersServiceOrderId: {
            id: 'activity-fx',
            quantity: '5.5',
            fxRate: '1.3567',
            marketPrice: {
              amount: '100.50',
              currency: 'USD',
            },
          },
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchActivityByOrdersServiceOrderId('rrsp-abc123', 'order-fx-test');

      expect(result).not.toBeNull();
      expect(result.fxRate).toBe('1.3567');
      expect(result.marketPrice.currency).toBe('USD');
    });
  });

  describe('fetchExtendedOrder', () => {
    beforeEach(() => {
      const futureDate = new Date(Date.now() + 3600000).toISOString();
      GM_getValue.mockImplementation((key) => {
        if (key === STORAGE.WEALTHSIMPLE_ACCESS_TOKEN) return 'test-token';
        if (key === STORAGE.WEALTHSIMPLE_IDENTITY_ID) return 'identity-123';
        if (key === STORAGE.WEALTHSIMPLE_TOKEN_EXPIRES_AT) return futureDate;
        return null;
      });
    });

    it('should return null for null externalId', async () => {
      const result = await wealthsimpleApi.fetchExtendedOrder(null);
      expect(result).toBeNull();
      expect(GM_xmlhttpRequest).not.toHaveBeenCalled();
    });

    it('should return null for empty externalId', async () => {
      const result = await wealthsimpleApi.fetchExtendedOrder('');
      expect(result).toBeNull();
      expect(GM_xmlhttpRequest).not.toHaveBeenCalled();
    });

    it('should fetch extended order for stock order successfully', async () => {
      const mockResponse = {
        soOrdersExtendedOrder: {
          averageFilledPrice: '620.9154',
          filledExchangeRate: '1.000000',
          filledQuantity: '11.6131',
          filledCommissionFee: null,
          filledTotalFee: '0.00',
          firstFilledAtUtc: '2025-11-04T14:40:29.233Z',
          lastFilledAtUtc: '2025-11-04T14:40:29.233Z',
          limitPrice: null,
          openClose: null,
          orderType: 'BUY_VALUE',
          optionMultiplier: null,
          rejectionCause: null,
          rejectionCode: null,
          securityCurrency: 'USD',
          status: 'posted',
          stopPrice: null,
          submittedAtUtc: '2025-11-04T14:40:28.998Z',
          submittedExchangeRate: '1.000000',
          submittedNetValue: '7211.02',
          submittedQuantity: '11.6131',
          submittedTotalFee: '0.00',
          timeInForce: 'DAY',
          accountId: 'H10739748CAD',
          canonicalAccountId: 'rrsp-qthtmh-s',
          cancellationCutoff: null,
          tradingSession: 'REGULAR',
          expiredAtUtc: '2025-11-04T21:00:00.000Z',
          __typename: 'SoOrders_ExtendedOrderResponse',
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchExtendedOrder('order-3f73016b-5af3-4f03-ba22-9ef5e45fbb3d');

      expect(result).not.toBeNull();
      expect(result.averageFilledPrice).toBe('620.9154');
      expect(result.filledQuantity).toBe('11.6131');
      expect(result.orderType).toBe('BUY_VALUE');
      expect(result.status).toBe('posted');
      expect(result.securityCurrency).toBe('USD');
      expect(result.timeInForce).toBe('DAY');
      expect(result.tradingSession).toBe('REGULAR');
      expect(result.optionMultiplier).toBeNull();
      expect(result.openClose).toBeNull();
    });

    it('should fetch extended order for options order successfully', async () => {
      const mockResponse = {
        soOrdersExtendedOrder: {
          averageFilledPrice: '0.0600',
          filledExchangeRate: '1.000000',
          filledQuantity: '9.0000',
          filledCommissionFee: '0.00',
          filledTotalFee: '0.00',
          firstFilledAtUtc: '2025-11-12T15:36:10.201Z',
          lastFilledAtUtc: '2025-11-12T15:36:10.201Z',
          limitPrice: '0.0600',
          openClose: 'OPEN',
          orderType: 'SELL_QUANTITY',
          optionMultiplier: '100.00',
          rejectionCause: null,
          rejectionCode: null,
          securityCurrency: 'USD',
          status: 'posted',
          stopPrice: null,
          submittedAtUtc: '2025-11-12T15:30:30.080Z',
          submittedExchangeRate: '1.000000',
          submittedNetValue: '54.00',
          submittedQuantity: '9.0000',
          submittedTotalFee: '0.00',
          timeInForce: 'DAY',
          accountId: 'H10739748CAD',
          canonicalAccountId: 'rrsp-qthtmh-s',
          cancellationCutoff: null,
          tradingSession: 'REGULAR',
          expiredAtUtc: '2025-11-12T21:00:00.000Z',
          __typename: 'SoOrders_ExtendedOrderResponse',
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchExtendedOrder('order-options-123');

      expect(result).not.toBeNull();
      expect(result.averageFilledPrice).toBe('0.0600');
      expect(result.filledQuantity).toBe('9.0000');
      expect(result.orderType).toBe('SELL_QUANTITY');
      expect(result.openClose).toBe('OPEN');
      expect(result.optionMultiplier).toBe('100.00');
      expect(result.limitPrice).toBe('0.0600');
    });

    it('should NOT inject identityId into request', async () => {
      const mockResponse = {
        soOrdersExtendedOrder: {
          status: 'posted',
          orderType: 'BUY_VALUE',
          __typename: 'SoOrders_ExtendedOrderResponse',
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ data, onload }) => {
        const parsedData = JSON.parse(data);
        expect(parsedData.operationName).toBe('FetchSoOrdersExtendedOrder');
        // FetchSoOrdersExtendedOrder should NOT have identityId injected
        expect(parsedData.variables.identityId).toBeUndefined();
        expect(parsedData.variables.branchId).toBe('TR');
        expect(parsedData.variables.externalId).toBe('order-test123');

        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      await wealthsimpleApi.fetchExtendedOrder('order-test123');
    });

    it('should return null when no soOrdersExtendedOrder in response', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: {} }),
        });
      });

      const result = await wealthsimpleApi.fetchExtendedOrder('order-not-found');
      expect(result).toBeNull();
    });

    it('should return null on API error without failing', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({ status: 500 });
      });

      // Should not throw, just return null
      const result = await wealthsimpleApi.fetchExtendedOrder('order-error');
      expect(result).toBeNull();
    });

    it('should return null on network error without failing', async () => {
      GM_xmlhttpRequest.mockImplementation(({ onerror }) => {
        onerror(new Error('Network failure'));
      });

      // Should not throw, just return null
      const result = await wealthsimpleApi.fetchExtendedOrder('order-network-error');
      expect(result).toBeNull();
    });

    it('should handle order with rejection details', async () => {
      const mockResponse = {
        soOrdersExtendedOrder: {
          averageFilledPrice: null,
          filledExchangeRate: null,
          filledQuantity: '0.0000',
          filledCommissionFee: null,
          filledTotalFee: null,
          firstFilledAtUtc: null,
          lastFilledAtUtc: null,
          limitPrice: '100.00',
          openClose: null,
          orderType: 'BUY_QUANTITY',
          optionMultiplier: null,
          rejectionCause: 'insufficient_funds',
          rejectionCode: 'INS_FUNDS',
          securityCurrency: 'USD',
          status: 'rejected',
          stopPrice: null,
          submittedAtUtc: '2025-11-04T14:40:28.998Z',
          submittedExchangeRate: '1.000000',
          submittedNetValue: '1000.00',
          submittedQuantity: '10.0000',
          submittedTotalFee: '0.00',
          timeInForce: 'DAY',
          accountId: 'H10739748CAD',
          canonicalAccountId: 'rrsp-qthtmh-s',
          cancellationCutoff: null,
          tradingSession: 'REGULAR',
          expiredAtUtc: '2025-11-04T21:00:00.000Z',
          __typename: 'SoOrders_ExtendedOrderResponse',
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchExtendedOrder('order-rejected');

      expect(result).not.toBeNull();
      expect(result.status).toBe('rejected');
      expect(result.rejectionCause).toBe('insufficient_funds');
      expect(result.rejectionCode).toBe('INS_FUNDS');
      expect(result.filledQuantity).toBe('0.0000');
    });

    it('should handle pending order', async () => {
      const mockResponse = {
        soOrdersExtendedOrder: {
          averageFilledPrice: null,
          filledExchangeRate: null,
          filledQuantity: '0.0000',
          filledCommissionFee: null,
          filledTotalFee: null,
          firstFilledAtUtc: null,
          lastFilledAtUtc: null,
          limitPrice: '500.00',
          openClose: null,
          orderType: 'BUY_QUANTITY',
          optionMultiplier: null,
          rejectionCause: null,
          rejectionCode: null,
          securityCurrency: 'USD',
          status: 'pending',
          stopPrice: '490.00',
          submittedAtUtc: '2025-11-04T14:40:28.998Z',
          submittedExchangeRate: '1.000000',
          submittedNetValue: '5000.00',
          submittedQuantity: '10.0000',
          submittedTotalFee: '0.00',
          timeInForce: 'GTC',
          accountId: 'H10739748CAD',
          canonicalAccountId: 'rrsp-qthtmh-s',
          cancellationCutoff: '2025-11-04T20:00:00.000Z',
          tradingSession: 'REGULAR',
          expiredAtUtc: null,
          __typename: 'SoOrders_ExtendedOrderResponse',
        },
      };

      GM_xmlhttpRequest.mockImplementation(({ onload }) => {
        onload({
          status: 200,
          responseText: JSON.stringify({ data: mockResponse }),
        });
      });

      const result = await wealthsimpleApi.fetchExtendedOrder('order-pending');

      expect(result).not.toBeNull();
      expect(result.status).toBe('pending');
      expect(result.stopPrice).toBe('490.00');
      expect(result.timeInForce).toBe('GTC');
      expect(result.cancellationCutoff).toBe('2025-11-04T20:00:00.000Z');
      expect(result.expiredAtUtc).toBeNull();
    });
  });
});
