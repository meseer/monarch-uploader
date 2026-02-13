/**
 * Tests for Wealthsimple Transaction Service - Line of Credit & Investment Transactions
 *
 * Covers: fetchAndProcessLineOfCreditTransactions, fetchAndProcessInvestmentTransactions,
 * reconcilePendingTransactions - investment accounts
 */

import {
  fetchAndProcessLineOfCreditTransactions,
  fetchAndProcessInvestmentTransactions,
  reconcilePendingTransactions,
} from '../../../src/services/wealthsimple/transactions';
import wealthsimpleApi from '../../../src/api/wealthsimple';
import monarchApi from '../../../src/api/monarch';
import { showManualTransactionCategorization } from '../../../src/ui/components/categorySelector';

// Mock dependencies
jest.mock('../../../src/api/wealthsimple');
jest.mock('../../../src/api/monarch');
jest.mock('../../../src/mappers/category');
jest.mock('../../../src/ui/toast', () => ({
  show: jest.fn(),
}));
jest.mock('../../../src/ui/components/categorySelector', () => ({
  showMonarchCategorySelector: jest.fn(),
  showManualTransactionCategorization: jest.fn(),
}));

// Set up default mock for fetchSpendTransactions to return empty Map
beforeEach(() => {
  wealthsimpleApi.fetchSpendTransactions = jest.fn().mockResolvedValue(new Map());
});

describe('Wealthsimple Transaction Service - LoC & Investment', () => {
  describe('fetchAndProcessLineOfCreditTransactions', () => {
    const mockLocAccount = {
      wealthsimpleAccount: {
        id: 'loc-account-id',
        nickname: 'Portfolio Line of Credit',
        type: 'PORTFOLIO_LINE_OF_CREDIT',
      },
    };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should auto-categorize INTERNAL_TRANSFER/SOURCE as borrow from LOC', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'loc-borrow-1',
          occurredAt: '2026-01-15T10:30:00.000000+00:00',
          type: 'INTERNAL_TRANSFER',
          subType: 'SOURCE',
          status: 'completed',
          amount: 5000.00,
          amountSign: 'negative',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);

      const result = await fetchAndProcessLineOfCreditTransactions(
        mockLocAccount,
        '2026-01-01',
        '2026-01-31',
      );

      // Should NOT call manual categorization (rule matched)
      expect(showManualTransactionCategorization).not.toHaveBeenCalled();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'loc-borrow-1',
        date: '2026-01-15',
        merchant: 'Borrow from Portfolio Line of Credit',
        originalMerchant: 'INTERNAL_TRANSFER:SOURCE:Borrow from Portfolio Line of Credit',
        amount: -5000.00,
        resolvedMonarchCategory: 'Transfer',
        ruleId: 'loc-borrow',
        isPending: false,
      });
    });

    it('should auto-categorize INTERNAL_TRANSFER/DESTINATION as repayment to LOC', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'loc-repay-1',
          occurredAt: '2026-01-16T10:30:00.000000+00:00',
          type: 'INTERNAL_TRANSFER',
          subType: 'DESTINATION',
          status: 'completed',
          amount: 1000.00,
          amountSign: 'positive',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);

      const result = await fetchAndProcessLineOfCreditTransactions(
        mockLocAccount,
        '2026-01-01',
        '2026-01-31',
      );

      // Should NOT call manual categorization (rule matched)
      expect(showManualTransactionCategorization).not.toHaveBeenCalled();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'loc-repay-1',
        merchant: 'Repayment to Portfolio Line of Credit',
        originalMerchant: 'INTERNAL_TRANSFER:DESTINATION:Repayment to Portfolio Line of Credit',
        amount: 1000.00,
        resolvedMonarchCategory: 'Loan Repayment',
        ruleId: 'loc-repay',
      });
    });

    it('should process unknown transaction types via manual categorization', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'loc-unknown-1',
          occurredAt: '2026-01-15T10:30:00.000000+00:00',
          type: 'INTEREST',
          subType: 'MARGIN_INTEREST',
          status: 'completed',
          amount: 50.00,
          amountSign: 'negative',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);

      // Mock manual categorization - user provides merchant and category
      showManualTransactionCategorization.mockImplementation((transaction, callback) => {
        callback({
          merchant: 'Margin Interest',
          category: { id: '1', name: 'Financial Fees' },
        });
      });

      const result = await fetchAndProcessLineOfCreditTransactions(
        mockLocAccount,
        '2026-01-01',
        '2026-01-31',
      );

      // Should have called manual categorization for unknown type
      expect(showManualTransactionCategorization).toHaveBeenCalledTimes(1);
      expect(showManualTransactionCategorization).toHaveBeenCalledWith(
        expect.objectContaining({
          externalCanonicalId: 'loc-unknown-1',
          type: 'INTEREST',
        }),
        expect.any(Function),
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'loc-unknown-1',
        merchant: 'Margin Interest',
        resolvedMonarchCategory: 'Financial Fees',
        ruleId: 'manual',
      });
    });

    it('should filter by status - settled, completed, and authorized only', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'loc-completed',
          occurredAt: '2026-01-15T10:30:00.000000+00:00',
          type: 'INTERNAL_TRANSFER',
          subType: 'SOURCE',
          status: 'completed', // Should be included
          amount: 5000.00,
          amountSign: 'negative',
        },
        {
          externalCanonicalId: 'loc-settled',
          occurredAt: '2026-01-16T10:30:00.000000+00:00',
          type: 'INTERNAL_TRANSFER',
          subType: 'DESTINATION',
          status: 'settled', // Should be included
          amount: 1000.00,
          amountSign: 'positive',
        },
        {
          externalCanonicalId: 'loc-authorized',
          occurredAt: '2026-01-17T10:30:00.000000+00:00',
          type: 'INTERNAL_TRANSFER',
          subType: 'SOURCE',
          status: 'authorized', // Should be included (pending)
          amount: 2000.00,
          amountSign: 'negative',
        },
        {
          externalCanonicalId: 'loc-pending',
          occurredAt: '2026-01-18T10:30:00.000000+00:00',
          type: 'INTERNAL_TRANSFER',
          subType: 'SOURCE',
          status: 'pending', // Should be excluded
          amount: 3000.00,
          amountSign: 'negative',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);

      const result = await fetchAndProcessLineOfCreditTransactions(
        { ...mockLocAccount, includePendingTransactions: true },
        '2026-01-01',
        '2026-01-31',
      );

      // Should include completed, settled, and authorized; exclude pending
      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('loc-completed');
      expect(result[0].isPending).toBe(false);
      expect(result[1].id).toBe('loc-settled');
      expect(result[1].isPending).toBe(false);
      expect(result[2].id).toBe('loc-authorized');
      expect(result[2].isPending).toBe(true);
    });

    it('should exclude authorized transactions when includePendingTransactions is false', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'loc-completed',
          occurredAt: '2026-01-15T10:30:00.000000+00:00',
          type: 'INTERNAL_TRANSFER',
          subType: 'SOURCE',
          status: 'completed',
          amount: 5000.00,
          amountSign: 'negative',
        },
        {
          externalCanonicalId: 'loc-authorized',
          occurredAt: '2026-01-16T10:30:00.000000+00:00',
          type: 'INTERNAL_TRANSFER',
          subType: 'DESTINATION',
          status: 'authorized',
          amount: 1000.00,
          amountSign: 'positive',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);

      const result = await fetchAndProcessLineOfCreditTransactions(
        { ...mockLocAccount, includePendingTransactions: false },
        '2026-01-01',
        '2026-01-31',
      );

      // Should only include completed/settled
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('loc-completed');
    });

    it('should handle negative amounts correctly for borrow transactions', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'loc-borrow',
          occurredAt: '2026-01-15T10:30:00.000000+00:00',
          type: 'INTERNAL_TRANSFER',
          subType: 'SOURCE',
          status: 'completed',
          amount: 1000.00,
          amountSign: 'negative', // Borrowing shows as negative (money leaving LOC)
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);

      const result = await fetchAndProcessLineOfCreditTransactions(
        mockLocAccount,
        '2026-01-01',
        '2026-01-31',
      );

      expect(result).toHaveLength(1);
      expect(result[0].amount).toBe(-1000.00); // Negative for borrow
    });

    it('should throw error when user cancels manual categorization', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'loc-unknown',
          occurredAt: '2026-01-15T10:30:00.000000+00:00',
          type: 'FEE',
          subType: 'ADMIN_FEE',
          status: 'completed',
          amount: 25.00,
          amountSign: 'negative',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);

      // User cancels
      showManualTransactionCategorization.mockImplementation((transaction, callback) => {
        callback(null);
      });

      await expect(
        fetchAndProcessLineOfCreditTransactions(
          mockLocAccount,
          '2026-01-01',
          '2026-01-31',
        ),
      ).rejects.toThrow('Manual categorization cancelled');
    });

    it('should return empty array when no transactions found', async () => {
      wealthsimpleApi.fetchTransactions.mockResolvedValue([]);

      const result = await fetchAndProcessLineOfCreditTransactions(
        mockLocAccount,
        '2026-01-01',
        '2026-01-31',
      );

      expect(result).toEqual([]);
      expect(showManualTransactionCategorization).not.toHaveBeenCalled();
    });

    it('should skip already-uploaded completed transactions', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'loc-already-uploaded',
          occurredAt: '2026-01-15T10:30:00.000000+00:00',
          type: 'INTERNAL_TRANSFER',
          subType: 'SOURCE',
          status: 'completed',
          amount: 5000.00,
          amountSign: 'negative',
        },
        {
          externalCanonicalId: 'loc-new',
          occurredAt: '2026-01-16T10:30:00.000000+00:00',
          type: 'INTERNAL_TRANSFER',
          subType: 'DESTINATION',
          status: 'completed',
          amount: 1000.00,
          amountSign: 'positive',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);

      // Pass already-uploaded IDs
      const uploadedIds = new Set(['loc-already-uploaded']);

      const result = await fetchAndProcessLineOfCreditTransactions(
        mockLocAccount,
        '2026-01-01',
        '2026-01-31',
        { uploadedTransactionIds: uploadedIds },
      );

      // Should only process the new transaction
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('loc-new');
    });

    it('should handle API errors gracefully', async () => {
      wealthsimpleApi.fetchTransactions.mockRejectedValue(new Error('API Error'));

      await expect(
        fetchAndProcessLineOfCreditTransactions(
          mockLocAccount,
          '2026-01-01',
          '2026-01-31',
        ),
      ).rejects.toThrow('API Error');
    });

    it('should use provided raw transactions if passed in options', async () => {
      const providedTransactions = [
        {
          externalCanonicalId: 'loc-provided',
          occurredAt: '2026-01-15T10:30:00.000000+00:00',
          type: 'INTERNAL_TRANSFER',
          subType: 'SOURCE',
          status: 'completed',
          amount: 3000.00,
          amountSign: 'negative',
        },
      ];

      const result = await fetchAndProcessLineOfCreditTransactions(
        mockLocAccount,
        '2026-01-01',
        '2026-01-31',
        { rawTransactions: providedTransactions },
      );

      // Should NOT call API since transactions were provided
      expect(wealthsimpleApi.fetchTransactions).not.toHaveBeenCalled();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('loc-provided');
      expect(result[0].merchant).toBe('Borrow from Portfolio Line of Credit');
    });

    it('should process mix of rule-matched and manual categorization transactions', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'loc-borrow',
          occurredAt: '2026-01-15T10:30:00.000000+00:00',
          type: 'INTERNAL_TRANSFER',
          subType: 'SOURCE',
          status: 'completed',
          amount: 5000.00,
          amountSign: 'negative',
        },
        {
          externalCanonicalId: 'loc-interest',
          occurredAt: '2026-01-16T10:30:00.000000+00:00',
          type: 'INTEREST',
          subType: 'MARGIN_INTEREST',
          status: 'completed',
          amount: 25.00,
          amountSign: 'negative',
        },
        {
          externalCanonicalId: 'loc-repay',
          occurredAt: '2026-01-17T10:30:00.000000+00:00',
          type: 'INTERNAL_TRANSFER',
          subType: 'DESTINATION',
          status: 'completed',
          amount: 1000.00,
          amountSign: 'positive',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);

      // Mock manual categorization for the interest transaction
      showManualTransactionCategorization.mockImplementation((transaction, callback) => {
        callback({
          merchant: 'Interest Charge',
          category: { id: '1', name: 'Financial Fees' },
        });
      });

      const result = await fetchAndProcessLineOfCreditTransactions(
        mockLocAccount,
        '2026-01-01',
        '2026-01-31',
      );

      expect(result).toHaveLength(3);

      // Borrow - auto-categorized
      expect(result[0]).toMatchObject({
        id: 'loc-borrow',
        merchant: 'Borrow from Portfolio Line of Credit',
        resolvedMonarchCategory: 'Transfer',
        ruleId: 'loc-borrow',
      });

      // Repay - auto-categorized
      expect(result[1]).toMatchObject({
        id: 'loc-repay',
        merchant: 'Repayment to Portfolio Line of Credit',
        resolvedMonarchCategory: 'Loan Repayment',
        ruleId: 'loc-repay',
      });

      // Interest - manually categorized
      expect(result[2]).toMatchObject({
        id: 'loc-interest',
        merchant: 'Interest Charge',
        resolvedMonarchCategory: 'Financial Fees',
        ruleId: 'manual',
      });

      // Manual categorization called only for interest
      expect(showManualTransactionCategorization).toHaveBeenCalledTimes(1);
    });
  });

  describe('fetchAndProcessInvestmentTransactions', () => {
    const mockInvestmentAccount = {
      wealthsimpleAccount: {
        id: 'investment-account-id',
        nickname: 'My TFSA',
        type: 'MANAGED_TFSA',
      },
    };

    beforeEach(() => {
      jest.clearAllMocks();
      // Mock GM_getValue for account name lookup in internal transfer rule
      global.GM_getValue = jest.fn().mockReturnValue(JSON.stringify([
        {
          wealthsimpleAccount: {
            id: 'investment-account-id',
            nickname: 'My TFSA',
            type: 'MANAGED_TFSA',
          },
        },
        {
          wealthsimpleAccount: {
            id: 'cash-account-id',
            nickname: 'Cash Account',
            type: 'CASH',
          },
        },
      ]));
    });

    it('should auto-categorize INTERNAL_TRANSFER/SOURCE as transfer out', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'funding_intent-transfer-out-1',
          occurredAt: '2026-01-15T10:30:00.000000+00:00',
          type: 'INTERNAL_TRANSFER',
          subType: 'SOURCE',
          status: 'completed',
          accountId: 'investment-account-id',
          opposingAccountId: 'cash-account-id',
          amount: 500.00,
          amountSign: 'negative',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);
      wealthsimpleApi.fetchInternalTransfer.mockResolvedValue({ annotation: '' });

      const result = await fetchAndProcessInvestmentTransactions(
        mockInvestmentAccount,
        '2026-01-01',
        '2026-01-31',
      );

      // Should NOT call manual categorization (rule matched)
      expect(showManualTransactionCategorization).not.toHaveBeenCalled();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'funding_intent-transfer-out-1',
        date: '2026-01-15',
        merchant: 'Transfer Out: My TFSA → Cash Account',
        originalMerchant: 'INTERNAL_TRANSFER:SOURCE:Transfer Out: My TFSA → Cash Account',
        amount: -500.00,
        resolvedMonarchCategory: 'Transfer',
        ruleId: 'internal-transfer',
        isPending: false,
      });
    });

    it('should auto-categorize INTERNAL_TRANSFER/DESTINATION as transfer in', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'funding_intent-transfer-in-1',
          occurredAt: '2026-01-16T10:30:00.000000+00:00',
          type: 'INTERNAL_TRANSFER',
          subType: 'DESTINATION',
          status: 'completed',
          accountId: 'investment-account-id',
          opposingAccountId: 'cash-account-id',
          amount: 1000.00,
          amountSign: 'positive',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);
      wealthsimpleApi.fetchInternalTransfer.mockResolvedValue({ annotation: '' });

      const result = await fetchAndProcessInvestmentTransactions(
        mockInvestmentAccount,
        '2026-01-01',
        '2026-01-31',
      );

      // Should NOT call manual categorization (rule matched)
      expect(showManualTransactionCategorization).not.toHaveBeenCalled();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'funding_intent-transfer-in-1',
        merchant: 'Transfer In: My TFSA ← Cash Account',
        originalMerchant: 'INTERNAL_TRANSFER:DESTINATION:Transfer In: My TFSA ← Cash Account',
        amount: 1000.00,
        resolvedMonarchCategory: 'Transfer',
        ruleId: 'internal-transfer',
      });
    });

    it('should include annotation from internal transfer data in notes', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'funding_intent-transfer-with-note',
          occurredAt: '2026-01-15T10:30:00.000000+00:00',
          type: 'INTERNAL_TRANSFER',
          subType: 'DESTINATION',
          status: 'completed',
          accountId: 'investment-account-id',
          opposingAccountId: 'cash-account-id',
          amount: 500.00,
          amountSign: 'positive',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);
      wealthsimpleApi.fetchInternalTransfer.mockResolvedValue({
        annotation: 'Monthly contribution',
      });

      const result = await fetchAndProcessInvestmentTransactions(
        mockInvestmentAccount,
        '2026-01-01',
        '2026-01-31',
      );

      expect(result).toHaveLength(1);
      // Notes contain only the annotation (no transfer amount prefix per transactionRules.js implementation)
      expect(result[0].notes).toBe('Monthly contribution');
    });

    it('should process unknown transaction types via manual categorization', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'tx-unknown-type-1',
          occurredAt: '2026-01-15T10:30:00.000000+00:00',
          type: 'UNKNOWN_TYPE',
          subType: 'UNKNOWN_SUBTYPE', // Truly unknown type - no rule exists for this
          status: 'completed',
          amount: 25.00,
          amountSign: 'negative',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);

      // Mock manual categorization
      showManualTransactionCategorization.mockImplementation((transaction, callback) => {
        callback({
          merchant: 'Unknown Transaction',
          category: { id: '1', name: 'Miscellaneous' },
        });
      });

      const result = await fetchAndProcessInvestmentTransactions(
        mockInvestmentAccount,
        '2026-01-01',
        '2026-01-31',
      );

      // Should have called manual categorization
      expect(showManualTransactionCategorization).toHaveBeenCalledTimes(1);
      expect(showManualTransactionCategorization).toHaveBeenCalledWith(
        expect.objectContaining({
          externalCanonicalId: 'tx-unknown-type-1',
          type: 'UNKNOWN_TYPE',
        }),
        expect.any(Function),
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'tx-unknown-type-1',
        merchant: 'Unknown Transaction',
        resolvedMonarchCategory: 'Miscellaneous',
        ruleId: 'manual',
      });
    });

    it('should process mix of rule-matched and manual categorization transactions', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'funding_intent-transfer-in',
          occurredAt: '2026-01-15T10:30:00.000000+00:00',
          type: 'INTERNAL_TRANSFER',
          subType: 'DESTINATION',
          status: 'completed',
          accountId: 'investment-account-id',
          opposingAccountId: 'cash-account-id',
          amount: 1000.00,
          amountSign: 'positive',
        },
        {
          externalCanonicalId: 'tx-unknown-type',
          occurredAt: '2026-01-16T10:30:00.000000+00:00',
          type: 'UNKNOWN_TYPE',
          subType: 'UNKNOWN_SUBTYPE', // Truly unknown type - no rule exists
          status: 'completed',
          amount: 25.00,
          amountSign: 'negative',
        },
        {
          externalCanonicalId: 'funding_intent-transfer-out',
          occurredAt: '2026-01-17T10:30:00.000000+00:00',
          type: 'INTERNAL_TRANSFER',
          subType: 'SOURCE',
          status: 'completed',
          accountId: 'investment-account-id',
          opposingAccountId: 'cash-account-id',
          amount: 500.00,
          amountSign: 'negative',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);
      wealthsimpleApi.fetchInternalTransfer.mockResolvedValue({ annotation: '' });

      // Mock manual categorization for the unknown type transaction
      showManualTransactionCategorization.mockImplementation((transaction, callback) => {
        callback({
          merchant: 'Unknown Transaction',
          category: { id: '1', name: 'Miscellaneous' },
        });
      });

      const result = await fetchAndProcessInvestmentTransactions(
        mockInvestmentAccount,
        '2026-01-01',
        '2026-01-31',
      );

      expect(result).toHaveLength(3);

      // Transfer in - auto-categorized
      expect(result[0]).toMatchObject({
        id: 'funding_intent-transfer-in',
        merchant: 'Transfer In: My TFSA ← Cash Account',
        resolvedMonarchCategory: 'Transfer',
        ruleId: 'internal-transfer',
      });

      // Transfer out - auto-categorized
      expect(result[1]).toMatchObject({
        id: 'funding_intent-transfer-out',
        merchant: 'Transfer Out: My TFSA → Cash Account',
        resolvedMonarchCategory: 'Transfer',
        ruleId: 'internal-transfer',
      });

      // Unknown type - manually categorized
      expect(result[2]).toMatchObject({
        id: 'tx-unknown-type',
        merchant: 'Unknown Transaction',
        resolvedMonarchCategory: 'Miscellaneous',
        ruleId: 'manual',
      });

      // Manual categorization called only for the unknown type
      expect(showManualTransactionCategorization).toHaveBeenCalledTimes(1);
    });

    it('should throw error when user cancels manual categorization', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'tx-unknown',
          occurredAt: '2026-01-15T10:30:00.000000+00:00',
          type: 'UNKNOWN_TYPE',
          subType: 'UNKNOWN_SUBTYPE', // Truly unknown type - no rule exists
          status: 'completed',
          amount: 10.00,
          amountSign: 'negative',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);

      // User cancels
      showManualTransactionCategorization.mockImplementation((transaction, callback) => {
        callback(null);
      });

      await expect(
        fetchAndProcessInvestmentTransactions(
          mockInvestmentAccount,
          '2026-01-01',
          '2026-01-31',
        ),
      ).rejects.toThrow('Manual categorization cancelled');
    });

    it('should return empty array when no transactions found', async () => {
      wealthsimpleApi.fetchTransactions.mockResolvedValue([]);

      const result = await fetchAndProcessInvestmentTransactions(
        mockInvestmentAccount,
        '2026-01-01',
        '2026-01-31',
      );

      expect(result).toEqual([]);
      expect(showManualTransactionCategorization).not.toHaveBeenCalled();
    });

    it('should skip already-uploaded completed transactions', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'funding_intent-already-uploaded',
          occurredAt: '2026-01-15T10:30:00.000000+00:00',
          type: 'INTERNAL_TRANSFER',
          subType: 'DESTINATION',
          status: 'completed',
          accountId: 'investment-account-id',
          opposingAccountId: 'cash-account-id',
          amount: 500.00,
          amountSign: 'positive',
        },
        {
          externalCanonicalId: 'funding_intent-new',
          occurredAt: '2026-01-16T10:30:00.000000+00:00',
          type: 'INTERNAL_TRANSFER',
          subType: 'SOURCE',
          status: 'completed',
          accountId: 'investment-account-id',
          opposingAccountId: 'cash-account-id',
          amount: 200.00,
          amountSign: 'negative',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);
      wealthsimpleApi.fetchInternalTransfer.mockResolvedValue({ annotation: '' });

      // Pass already-uploaded IDs
      const uploadedIds = new Set(['funding_intent-already-uploaded']);

      const result = await fetchAndProcessInvestmentTransactions(
        mockInvestmentAccount,
        '2026-01-01',
        '2026-01-31',
        { uploadedTransactionIds: uploadedIds },
      );

      // Should only process the new transaction
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('funding_intent-new');
    });

    it('should handle API errors gracefully', async () => {
      wealthsimpleApi.fetchTransactions.mockRejectedValue(new Error('API Error'));

      await expect(
        fetchAndProcessInvestmentTransactions(
          mockInvestmentAccount,
          '2026-01-01',
          '2026-01-31',
        ),
      ).rejects.toThrow('API Error');
    });

    it('should use provided raw transactions if passed in options', async () => {
      const providedTransactions = [
        {
          externalCanonicalId: 'funding_intent-provided',
          occurredAt: '2026-01-15T10:30:00.000000+00:00',
          type: 'INTERNAL_TRANSFER',
          subType: 'DESTINATION',
          status: 'completed',
          accountId: 'investment-account-id',
          opposingAccountId: 'cash-account-id',
          amount: 750.00,
          amountSign: 'positive',
        },
      ];

      wealthsimpleApi.fetchInternalTransfer.mockResolvedValue({ annotation: '' });

      const result = await fetchAndProcessInvestmentTransactions(
        mockInvestmentAccount,
        '2026-01-01',
        '2026-01-31',
        { rawTransactions: providedTransactions },
      );

      // Should NOT call API since transactions were provided
      expect(wealthsimpleApi.fetchTransactions).not.toHaveBeenCalled();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('funding_intent-provided');
      expect(result[0].merchant).toBe('Transfer In: My TFSA ← Cash Account');
      expect(result[0].resolvedMonarchCategory).toBe('Transfer');
    });

    it('should filter by status - settled, completed, and authorized only', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'funding_intent-completed',
          occurredAt: '2026-01-15T10:30:00.000000+00:00',
          type: 'INTERNAL_TRANSFER',
          subType: 'DESTINATION',
          status: 'completed',
          accountId: 'investment-account-id',
          opposingAccountId: 'cash-account-id',
          amount: 500.00,
          amountSign: 'positive',
        },
        {
          externalCanonicalId: 'funding_intent-settled',
          occurredAt: '2026-01-16T10:30:00.000000+00:00',
          type: 'INTERNAL_TRANSFER',
          subType: 'SOURCE',
          status: 'settled',
          accountId: 'investment-account-id',
          opposingAccountId: 'cash-account-id',
          amount: 200.00,
          amountSign: 'negative',
        },
        {
          externalCanonicalId: 'funding_intent-pending',
          occurredAt: '2026-01-17T10:30:00.000000+00:00',
          type: 'INTERNAL_TRANSFER',
          subType: 'DESTINATION',
          status: 'pending', // Should be excluded
          accountId: 'investment-account-id',
          opposingAccountId: 'cash-account-id',
          amount: 100.00,
          amountSign: 'positive',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);
      wealthsimpleApi.fetchInternalTransfer.mockResolvedValue({ annotation: '' });

      const result = await fetchAndProcessInvestmentTransactions(
        { ...mockInvestmentAccount, includePendingTransactions: true },
        '2026-01-01',
        '2026-01-31',
      );

      // Should include completed and settled; exclude pending
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('funding_intent-completed');
      expect(result[1].id).toBe('funding_intent-settled');
    });

    it('should include authorized transactions as pending when includePendingTransactions is true', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'funding_intent-authorized',
          occurredAt: '2026-01-15T10:30:00.000000+00:00',
          type: 'INTERNAL_TRANSFER',
          subType: 'DESTINATION',
          status: 'authorized',
          accountId: 'investment-account-id',
          opposingAccountId: 'cash-account-id',
          amount: 500.00,
          amountSign: 'positive',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);
      wealthsimpleApi.fetchInternalTransfer.mockResolvedValue({ annotation: '' });

      const result = await fetchAndProcessInvestmentTransactions(
        { ...mockInvestmentAccount, includePendingTransactions: true },
        '2026-01-01',
        '2026-01-31',
      );

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('funding_intent-authorized');
      expect(result[0].isPending).toBe(true);
    });
  });

  describe('reconcilePendingTransactions - investment accounts', () => {
    const mockMonarchAccountId = 'monarch-investment-123';
    const mockPendingTagId = 'pending-tag-456';

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should reconcile investment account transactions using unifiedStatus field', async () => {
      monarchApi.getTagByName.mockResolvedValue({ id: mockPendingTagId, name: 'Pending' });
      monarchApi.getTransactionsList.mockResolvedValue({
        results: [
          {
            id: 'monarch-tx-1',
            amount: -100.00,
            date: '2026-01-10',
            notes: 'ws-tx:diy-buy-order-123',
            ownedByUser: { id: 'user-123' },
          },
        ],
      });
      monarchApi.updateTransaction.mockResolvedValue({});
      monarchApi.setTransactionTags.mockResolvedValue({});

      // Investment buy transaction uses unifiedStatus, not status
      const wealthsimpleTransactions = [
        {
          externalCanonicalId: 'diy-buy-order-123',
          type: 'DIY_BUY',
          status: null, // Investment orders often have null status
          unifiedStatus: 'COMPLETED',
          amount: 100.00,
          amountSign: 'negative',
        },
      ];

      const result = await reconcilePendingTransactions(
        mockMonarchAccountId,
        wealthsimpleTransactions,
        30,
        'SELF_DIRECTED_TFSA', // Investment account type
      );

      expect(result.success).toBe(true);
      expect(result.settled).toBe(1);
      expect(result.cancelled).toBe(0);
      expect(monarchApi.updateTransaction).toHaveBeenCalled();
      expect(monarchApi.setTransactionTags).toHaveBeenCalledWith('monarch-tx-1', []);
    });

    it('should skip investment transaction when unifiedStatus is IN_PROGRESS', async () => {
      monarchApi.getTagByName.mockResolvedValue({ id: mockPendingTagId, name: 'Pending' });
      monarchApi.getTransactionsList.mockResolvedValue({
        results: [
          {
            id: 'monarch-tx-1',
            amount: -50.00,
            date: '2026-01-10',
            notes: 'ws-tx:diy-buy-order-pending',
            ownedByUser: { id: 'user-123' },
          },
        ],
      });

      const wealthsimpleTransactions = [
        {
          externalCanonicalId: 'diy-buy-order-pending',
          type: 'DIY_BUY',
          status: null,
          unifiedStatus: 'IN_PROGRESS', // Still pending
          amount: 50.00,
          amountSign: 'negative',
        },
      ];

      const result = await reconcilePendingTransactions(
        mockMonarchAccountId,
        wealthsimpleTransactions,
        30,
        'SELF_DIRECTED_RRSP',
      );

      expect(result.success).toBe(true);
      expect(result.settled).toBe(0);
      expect(result.cancelled).toBe(0);
      expect(monarchApi.updateTransaction).not.toHaveBeenCalled();
      expect(monarchApi.deleteTransaction).not.toHaveBeenCalled();
    });

    it('should skip investment transaction when unifiedStatus is PENDING', async () => {
      monarchApi.getTagByName.mockResolvedValue({ id: mockPendingTagId, name: 'Pending' });
      monarchApi.getTransactionsList.mockResolvedValue({
        results: [
          {
            id: 'monarch-tx-1',
            amount: -75.00,
            date: '2026-01-10',
            notes: 'ws-tx:managed-buy-order-pending',
            ownedByUser: { id: 'user-123' },
          },
        ],
      });

      const wealthsimpleTransactions = [
        {
          externalCanonicalId: 'managed-buy-order-pending',
          type: 'MANAGED_BUY',
          status: null,
          unifiedStatus: 'PENDING',
          amount: 75.00,
          amountSign: 'negative',
        },
      ];

      const result = await reconcilePendingTransactions(
        mockMonarchAccountId,
        wealthsimpleTransactions,
        30,
        'MANAGED_TFSA',
      );

      expect(result.success).toBe(true);
      expect(result.settled).toBe(0);
      expect(result.cancelled).toBe(0);
    });

    it('should delete investment transaction when unifiedStatus is CANCELLED', async () => {
      monarchApi.getTagByName.mockResolvedValue({ id: mockPendingTagId, name: 'Pending' });
      monarchApi.getTransactionsList.mockResolvedValue({
        results: [
          {
            id: 'monarch-tx-1',
            amount: -200.00,
            date: '2026-01-10',
            notes: 'ws-tx:diy-sell-order-cancelled',
            ownedByUser: null,
          },
        ],
      });
      monarchApi.deleteTransaction.mockResolvedValue(true);

      const wealthsimpleTransactions = [
        {
          externalCanonicalId: 'diy-sell-order-cancelled',
          type: 'DIY_SELL',
          status: null,
          unifiedStatus: 'CANCELLED', // Order was cancelled
          amount: 200.00,
          amountSign: 'positive',
        },
      ];

      const result = await reconcilePendingTransactions(
        mockMonarchAccountId,
        wealthsimpleTransactions,
        30,
        'SELF_DIRECTED_NON_REGISTERED',
      );

      expect(result.success).toBe(true);
      expect(result.settled).toBe(0);
      expect(result.cancelled).toBe(1);
      expect(monarchApi.deleteTransaction).toHaveBeenCalledWith('monarch-tx-1');
    });

    it('should use status field for INTERNAL_TRANSFER in investment accounts', async () => {
      monarchApi.getTagByName.mockResolvedValue({ id: mockPendingTagId, name: 'Pending' });
      monarchApi.getTransactionsList.mockResolvedValue({
        results: [
          {
            id: 'monarch-tx-1',
            amount: 500.00,
            date: '2026-01-10',
            notes: 'ws-tx:funding_intent-transfer-123',
            ownedByUser: { id: 'user-123' },
          },
        ],
      });
      monarchApi.updateTransaction.mockResolvedValue({});
      monarchApi.setTransactionTags.mockResolvedValue({});

      // Internal transfers use status field even in investment accounts
      const wealthsimpleTransactions = [
        {
          externalCanonicalId: 'funding_intent-transfer-123',
          type: 'INTERNAL_TRANSFER',
          subType: 'DESTINATION',
          status: 'settled', // Internal transfers use status field
          unifiedStatus: null,
          amount: 500.00,
          amountSign: 'positive',
        },
      ];

      const result = await reconcilePendingTransactions(
        mockMonarchAccountId,
        wealthsimpleTransactions,
        30,
        'SELF_DIRECTED_TFSA',
      );

      expect(result.success).toBe(true);
      expect(result.settled).toBe(1);
      expect(monarchApi.setTransactionTags).toHaveBeenCalledWith('monarch-tx-1', []);
    });

    it('should skip internal transfer when status is authorized in investment account', async () => {
      monarchApi.getTagByName.mockResolvedValue({ id: mockPendingTagId, name: 'Pending' });
      monarchApi.getTransactionsList.mockResolvedValue({
        results: [
          {
            id: 'monarch-tx-1',
            amount: 300.00,
            date: '2026-01-10',
            notes: 'ws-tx:funding_intent-transfer-pending',
            ownedByUser: { id: 'user-123' },
          },
        ],
      });

      const wealthsimpleTransactions = [
        {
          externalCanonicalId: 'funding_intent-transfer-pending',
          type: 'INTERNAL_TRANSFER',
          subType: 'DESTINATION',
          status: 'authorized', // Still pending
          unifiedStatus: null,
          amount: 300.00,
          amountSign: 'positive',
        },
      ];

      const result = await reconcilePendingTransactions(
        mockMonarchAccountId,
        wealthsimpleTransactions,
        30,
        'MANAGED_RRSP',
      );

      expect(result.success).toBe(true);
      expect(result.settled).toBe(0);
      expect(result.cancelled).toBe(0);
      expect(monarchApi.updateTransaction).not.toHaveBeenCalled();
    });

    it('should delete investment transaction when not found in Wealthsimple', async () => {
      monarchApi.getTagByName.mockResolvedValue({ id: mockPendingTagId, name: 'Pending' });
      monarchApi.getTransactionsList.mockResolvedValue({
        results: [
          {
            id: 'monarch-tx-1',
            amount: -150.00,
            date: '2026-01-10',
            notes: 'ws-tx:cancelled-order-not-in-ws',
            ownedByUser: null,
          },
        ],
      });
      monarchApi.deleteTransaction.mockResolvedValue(true);

      // Transaction not in Wealthsimple data - was cancelled
      const wealthsimpleTransactions = [];

      const result = await reconcilePendingTransactions(
        mockMonarchAccountId,
        wealthsimpleTransactions,
        30,
        'SELF_DIRECTED_CRYPTO',
      );

      expect(result.success).toBe(true);
      expect(result.settled).toBe(0);
      expect(result.cancelled).toBe(1);
      expect(monarchApi.deleteTransaction).toHaveBeenCalledWith('monarch-tx-1');
    });

    it('should handle mixed investment transaction types correctly', async () => {
      monarchApi.getTagByName.mockResolvedValue({ id: mockPendingTagId, name: 'Pending' });
      monarchApi.getTransactionsList.mockResolvedValue({
        results: [
          {
            id: 'monarch-tx-buy',
            amount: -100.00,
            date: '2026-01-10',
            notes: 'ws-tx:diy-buy-completed',
            ownedByUser: { id: 'user-123' },
          },
          {
            id: 'monarch-tx-transfer',
            amount: 500.00,
            date: '2026-01-11',
            notes: 'ws-tx:funding_intent-transfer-settled',
            ownedByUser: { id: 'user-123' },
          },
          {
            id: 'monarch-tx-sell-pending',
            amount: 200.00,
            date: '2026-01-12',
            notes: 'ws-tx:diy-sell-in-progress',
            ownedByUser: null,
          },
        ],
      });
      monarchApi.updateTransaction.mockResolvedValue({});
      monarchApi.setTransactionTags.mockResolvedValue({});

      const wealthsimpleTransactions = [
        {
          externalCanonicalId: 'diy-buy-completed',
          type: 'DIY_BUY',
          status: null,
          unifiedStatus: 'COMPLETED', // Buy order completed
          amount: 100.00,
          amountSign: 'negative',
        },
        {
          externalCanonicalId: 'funding_intent-transfer-settled',
          type: 'INTERNAL_TRANSFER',
          subType: 'DESTINATION',
          status: 'settled', // Transfer settled (uses status)
          unifiedStatus: null,
          amount: 500.00,
          amountSign: 'positive',
        },
        {
          externalCanonicalId: 'diy-sell-in-progress',
          type: 'DIY_SELL',
          status: null,
          unifiedStatus: 'IN_PROGRESS', // Sell order still pending
          amount: 200.00,
          amountSign: 'positive',
        },
      ];

      const result = await reconcilePendingTransactions(
        mockMonarchAccountId,
        wealthsimpleTransactions,
        30,
        'SELF_DIRECTED_NON_REGISTERED',
      );

      expect(result.success).toBe(true);
      expect(result.settled).toBe(2); // Buy completed + transfer settled
      expect(result.cancelled).toBe(0);
      expect(result.failed).toBe(0);
    });
  });

});
