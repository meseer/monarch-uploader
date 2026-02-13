/**
 * Tests for Wealthsimple Transaction Service - Crypto, Skip Categorization & Format
 *
 * Covers: fetchAndProcessInvestmentTransactions - crypto transactions,
 * reconcilePendingTransactions - crypto, skip categorization, formatReconciliationMessage
 */

import {
  fetchAndProcessCreditCardTransactions,
  fetchAndProcessCashTransactions,
  fetchAndProcessLineOfCreditTransactions,
  fetchAndProcessInvestmentTransactions,
  reconcilePendingTransactions,
  formatReconciliationMessage,
} from '../../../src/services/wealthsimple/transactions';
import wealthsimpleApi from '../../../src/api/wealthsimple';
import monarchApi from '../../../src/api/monarch';
import { applyWealthsimpleCategoryMapping } from '../../../src/mappers/category';
import { showManualTransactionCategorization, showMonarchCategorySelector } from '../../../src/ui/components/categorySelector';

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

describe('Wealthsimple Transaction Service - Crypto, Skip & Format', () => {
  describe('fetchAndProcessInvestmentTransactions - crypto transactions', () => {
    const mockCryptoAccount = {
      wealthsimpleAccount: {
        id: 'crypto-account-id',
        nickname: 'My Crypto',
        type: 'SELF_DIRECTED_CRYPTO',
      },
    };

    beforeEach(() => {
      jest.clearAllMocks();
      global.GM_getValue = jest.fn().mockReturnValue(JSON.stringify([
        {
          wealthsimpleAccount: {
            id: 'crypto-account-id',
            nickname: 'My Crypto',
            type: 'SELF_DIRECTED_CRYPTO',
          },
        },
      ]));
    });

    it('should process CRYPTO_BUY transactions with COMPLETED status', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'crypto-buy-order-123',
          occurredAt: '2026-01-15T10:30:00.000000+00:00',
          type: 'CRYPTO_BUY',
          status: 'posted',
          unifiedStatus: 'COMPLETED',
          assetSymbol: 'BTC',
          amount: 1000.00,
          amountSign: 'negative',
          assetQuantity: 0.015,
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);
      wealthsimpleApi.fetchSpendTransactions.mockResolvedValue(new Map());

      const result = await fetchAndProcessInvestmentTransactions(
        mockCryptoAccount,
        '2026-01-01',
        '2026-01-31',
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'crypto-buy-order-123',
        date: '2026-01-15',
        merchant: 'BTC',
        amount: -1000.00,
        resolvedMonarchCategory: 'Buy',
        ruleId: 'crypto-buy',
        isPending: false,
      });
    });

    it('should process CRYPTO_SELL transactions with COMPLETED status', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'crypto-sell-order-456',
          occurredAt: '2026-01-16T14:30:00.000000+00:00',
          type: 'CRYPTO_SELL',
          status: 'posted',
          unifiedStatus: 'COMPLETED',
          assetSymbol: 'ETH',
          amount: 2000.00,
          amountSign: 'positive',
          assetQuantity: 0.8,
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);
      wealthsimpleApi.fetchSpendTransactions.mockResolvedValue(new Map());

      const result = await fetchAndProcessInvestmentTransactions(
        mockCryptoAccount,
        '2026-01-01',
        '2026-01-31',
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'crypto-sell-order-456',
        date: '2026-01-16',
        merchant: 'ETH',
        amount: 2000.00,
        resolvedMonarchCategory: 'Sell',
        ruleId: 'crypto-sell',
        isPending: false,
      });
    });

    it('should include CRYPTO_BUY transactions with IN_PROGRESS status as pending when includePendingTransactions is true', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'crypto-buy-pending',
          occurredAt: '2026-01-17T09:00:00.000000+00:00',
          type: 'CRYPTO_BUY',
          status: 'pending',
          unifiedStatus: 'IN_PROGRESS',
          assetSymbol: 'BTC',
          amount: 500.00,
          amountSign: 'negative',
          assetQuantity: 0.007,
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);
      wealthsimpleApi.fetchSpendTransactions.mockResolvedValue(new Map());

      const result = await fetchAndProcessInvestmentTransactions(
        { ...mockCryptoAccount, includePendingTransactions: true },
        '2026-01-01',
        '2026-01-31',
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'crypto-buy-pending',
        merchant: 'BTC',
        amount: -500.00,
        resolvedMonarchCategory: 'Buy',
        ruleId: 'crypto-buy',
        isPending: true,
        unifiedStatus: 'IN_PROGRESS',
      });
    });

    it('should include CRYPTO_SELL transactions with PENDING status as pending when includePendingTransactions is true', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'crypto-sell-pending',
          occurredAt: '2026-01-18T11:00:00.000000+00:00',
          type: 'CRYPTO_SELL',
          status: null,
          unifiedStatus: 'PENDING',
          assetSymbol: 'ETH',
          amount: 1500.00,
          amountSign: 'positive',
          assetQuantity: 0.6,
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);
      wealthsimpleApi.fetchSpendTransactions.mockResolvedValue(new Map());

      const result = await fetchAndProcessInvestmentTransactions(
        { ...mockCryptoAccount, includePendingTransactions: true },
        '2026-01-01',
        '2026-01-31',
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'crypto-sell-pending',
        merchant: 'ETH',
        amount: 1500.00,
        resolvedMonarchCategory: 'Sell',
        ruleId: 'crypto-sell',
        isPending: true,
        unifiedStatus: 'PENDING',
      });
    });

    it('should exclude crypto transactions with IN_PROGRESS status when includePendingTransactions is false', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'crypto-completed',
          occurredAt: '2026-01-15T10:00:00.000000+00:00',
          type: 'CRYPTO_BUY',
          status: 'posted',
          unifiedStatus: 'COMPLETED',
          assetSymbol: 'BTC',
          amount: 1000.00,
          amountSign: 'negative',
        },
        {
          externalCanonicalId: 'crypto-pending',
          occurredAt: '2026-01-16T10:00:00.000000+00:00',
          type: 'CRYPTO_BUY',
          status: 'pending',
          unifiedStatus: 'IN_PROGRESS',
          assetSymbol: 'ETH',
          amount: 500.00,
          amountSign: 'negative',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);
      wealthsimpleApi.fetchSpendTransactions.mockResolvedValue(new Map());

      const result = await fetchAndProcessInvestmentTransactions(
        { ...mockCryptoAccount, includePendingTransactions: false },
        '2026-01-01',
        '2026-01-31',
      );

      // Should only include COMPLETED transaction
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('crypto-completed');
      expect(result[0].isPending).toBe(false);
    });

    it('should exclude crypto transactions with CANCELLED status', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'crypto-completed',
          occurredAt: '2026-01-15T10:00:00.000000+00:00',
          type: 'CRYPTO_BUY',
          status: 'posted',
          unifiedStatus: 'COMPLETED',
          assetSymbol: 'BTC',
          amount: 1000.00,
          amountSign: 'negative',
        },
        {
          externalCanonicalId: 'crypto-cancelled',
          occurredAt: '2026-01-16T10:00:00.000000+00:00',
          type: 'CRYPTO_SELL',
          status: 'cancelled',
          unifiedStatus: 'CANCELLED',
          assetSymbol: 'ETH',
          amount: 2000.00,
          amountSign: 'positive',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);
      wealthsimpleApi.fetchSpendTransactions.mockResolvedValue(new Map());

      const result = await fetchAndProcessInvestmentTransactions(
        { ...mockCryptoAccount, includePendingTransactions: true },
        '2026-01-01',
        '2026-01-31',
      );

      // Should only include COMPLETED transaction
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('crypto-completed');
    });

    it('should exclude crypto transactions with REJECTED status', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'crypto-rejected',
          occurredAt: '2026-01-15T10:00:00.000000+00:00',
          type: 'CRYPTO_BUY',
          status: null,
          unifiedStatus: 'REJECTED',
          assetSymbol: 'BTC',
          amount: 1000.00,
          amountSign: 'negative',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);
      wealthsimpleApi.fetchSpendTransactions.mockResolvedValue(new Map());

      const result = await fetchAndProcessInvestmentTransactions(
        { ...mockCryptoAccount, includePendingTransactions: true },
        '2026-01-01',
        '2026-01-31',
      );

      // Should exclude REJECTED transaction
      expect(result).toEqual([]);
    });

    it('should exclude crypto transactions with EXPIRED status', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'crypto-expired',
          occurredAt: '2026-01-15T10:00:00.000000+00:00',
          type: 'CRYPTO_SELL',
          status: null,
          unifiedStatus: 'EXPIRED',
          assetSymbol: 'ETH',
          amount: 2000.00,
          amountSign: 'positive',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);
      wealthsimpleApi.fetchSpendTransactions.mockResolvedValue(new Map());

      const result = await fetchAndProcessInvestmentTransactions(
        { ...mockCryptoAccount, includePendingTransactions: true },
        '2026-01-01',
        '2026-01-31',
      );

      // Should exclude EXPIRED transaction
      expect(result).toEqual([]);
    });

    it('should process mix of crypto buy and sell transactions', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'crypto-buy-1',
          occurredAt: '2026-01-15T10:00:00.000000+00:00',
          type: 'CRYPTO_BUY',
          status: 'posted',
          unifiedStatus: 'COMPLETED',
          assetSymbol: 'BTC',
          amount: 1000.00,
          amountSign: 'negative',
        },
        {
          externalCanonicalId: 'crypto-sell-1',
          occurredAt: '2026-01-16T11:00:00.000000+00:00',
          type: 'CRYPTO_SELL',
          status: 'posted',
          unifiedStatus: 'COMPLETED',
          assetSymbol: 'ETH',
          amount: 2000.00,
          amountSign: 'positive',
        },
        {
          externalCanonicalId: 'crypto-buy-pending',
          occurredAt: '2026-01-17T12:00:00.000000+00:00',
          type: 'CRYPTO_BUY',
          status: 'pending',
          unifiedStatus: 'IN_PROGRESS',
          assetSymbol: 'SOL',
          amount: 500.00,
          amountSign: 'negative',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);
      wealthsimpleApi.fetchSpendTransactions.mockResolvedValue(new Map());

      const result = await fetchAndProcessInvestmentTransactions(
        { ...mockCryptoAccount, includePendingTransactions: true },
        '2026-01-01',
        '2026-01-31',
      );

      expect(result).toHaveLength(3);
      
      // CRYPTO_BUY completed
      expect(result[0]).toMatchObject({
        id: 'crypto-buy-1',
        merchant: 'BTC',
        amount: -1000.00,
        resolvedMonarchCategory: 'Buy',
        ruleId: 'crypto-buy',
        isPending: false,
      });

      // CRYPTO_SELL completed
      expect(result[1]).toMatchObject({
        id: 'crypto-sell-1',
        merchant: 'ETH',
        amount: 2000.00,
        resolvedMonarchCategory: 'Sell',
        ruleId: 'crypto-sell',
        isPending: false,
      });

      // CRYPTO_BUY pending
      expect(result[2]).toMatchObject({
        id: 'crypto-buy-pending',
        merchant: 'SOL',
        amount: -500.00,
        resolvedMonarchCategory: 'Buy',
        ruleId: 'crypto-buy',
        isPending: true,
      });
    });

    it('should handle crypto transactions with missing assetSymbol', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'crypto-buy-no-symbol',
          occurredAt: '2026-01-15T10:00:00.000000+00:00',
          type: 'CRYPTO_BUY',
          status: 'posted',
          unifiedStatus: 'COMPLETED',
          assetSymbol: null,
          amount: 1000.00,
          amountSign: 'negative',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);
      wealthsimpleApi.fetchSpendTransactions.mockResolvedValue(new Map());

      const result = await fetchAndProcessInvestmentTransactions(
        mockCryptoAccount,
        '2026-01-01',
        '2026-01-31',
      );

      expect(result).toHaveLength(1);
      expect(result[0].merchant).toBe('Unknown');
    });

    it('should skip already-uploaded crypto transactions', async () => {
      const mockRawTransactions = [
        {
          externalCanonicalId: 'crypto-already-uploaded',
          occurredAt: '2026-01-15T10:00:00.000000+00:00',
          type: 'CRYPTO_BUY',
          status: 'posted',
          unifiedStatus: 'COMPLETED',
          assetSymbol: 'BTC',
          amount: 1000.00,
          amountSign: 'negative',
        },
        {
          externalCanonicalId: 'crypto-new',
          occurredAt: '2026-01-16T10:00:00.000000+00:00',
          type: 'CRYPTO_SELL',
          status: 'posted',
          unifiedStatus: 'COMPLETED',
          assetSymbol: 'ETH',
          amount: 2000.00,
          amountSign: 'positive',
        },
      ];

      wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);
      wealthsimpleApi.fetchSpendTransactions.mockResolvedValue(new Map());

      const uploadedIds = new Set(['crypto-already-uploaded']);

      const result = await fetchAndProcessInvestmentTransactions(
        mockCryptoAccount,
        '2026-01-01',
        '2026-01-31',
        { uploadedTransactionIds: uploadedIds },
      );

      // Should only process the new transaction
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('crypto-new');
    });
  });

  describe('reconcilePendingTransactions - crypto transactions', () => {
    const mockMonarchAccountId = 'monarch-crypto-123';
    const mockPendingTagId = 'pending-tag-456';

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should reconcile CRYPTO_BUY transactions using unifiedStatus field', async () => {
      monarchApi.getTagByName.mockResolvedValue({ id: mockPendingTagId, name: 'Pending' });
      monarchApi.getTransactionsList.mockResolvedValue({
        results: [
          {
            id: 'monarch-tx-1',
            amount: -1000.00,
            date: '2026-01-10',
            notes: 'ws-tx:crypto-buy-order-123',
            ownedByUser: { id: 'user-123' },
          },
        ],
      });
      monarchApi.updateTransaction.mockResolvedValue({});
      monarchApi.setTransactionTags.mockResolvedValue({});

      const wealthsimpleTransactions = [
        {
          externalCanonicalId: 'crypto-buy-order-123',
          type: 'CRYPTO_BUY',
          status: 'posted',
          unifiedStatus: 'COMPLETED',
          amount: 1000.00,
          amountSign: 'negative',
        },
      ];

      const result = await reconcilePendingTransactions(
        mockMonarchAccountId,
        wealthsimpleTransactions,
        30,
        'SELF_DIRECTED_CRYPTO',
      );

      expect(result.success).toBe(true);
      expect(result.settled).toBe(1);
      expect(result.cancelled).toBe(0);
      expect(monarchApi.setTransactionTags).toHaveBeenCalledWith('monarch-tx-1', []);
    });

    it('should skip CRYPTO_BUY when unifiedStatus is IN_PROGRESS', async () => {
      monarchApi.getTagByName.mockResolvedValue({ id: mockPendingTagId, name: 'Pending' });
      monarchApi.getTransactionsList.mockResolvedValue({
        results: [
          {
            id: 'monarch-tx-1',
            amount: -500.00,
            date: '2026-01-10',
            notes: 'ws-tx:crypto-buy-pending',
            ownedByUser: { id: 'user-123' },
          },
        ],
      });

      const wealthsimpleTransactions = [
        {
          externalCanonicalId: 'crypto-buy-pending',
          type: 'CRYPTO_BUY',
          status: 'pending',
          unifiedStatus: 'IN_PROGRESS',
          amount: 500.00,
          amountSign: 'negative',
        },
      ];

      const result = await reconcilePendingTransactions(
        mockMonarchAccountId,
        wealthsimpleTransactions,
        30,
        'SELF_DIRECTED_CRYPTO',
      );

      expect(result.success).toBe(true);
      expect(result.settled).toBe(0);
      expect(result.cancelled).toBe(0);
      expect(monarchApi.updateTransaction).not.toHaveBeenCalled();
    });

    it('should delete CRYPTO_SELL when unifiedStatus is CANCELLED', async () => {
      monarchApi.getTagByName.mockResolvedValue({ id: mockPendingTagId, name: 'Pending' });
      monarchApi.getTransactionsList.mockResolvedValue({
        results: [
          {
            id: 'monarch-tx-1',
            amount: 2000.00,
            date: '2026-01-10',
            notes: 'ws-tx:crypto-sell-cancelled',
            ownedByUser: null,
          },
        ],
      });
      monarchApi.deleteTransaction.mockResolvedValue(true);

      const wealthsimpleTransactions = [
        {
          externalCanonicalId: 'crypto-sell-cancelled',
          type: 'CRYPTO_SELL',
          status: 'cancelled',
          unifiedStatus: 'CANCELLED',
          amount: 2000.00,
          amountSign: 'positive',
        },
      ];

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
  });

  describe('skip categorization', () => {
    describe('credit card - skipCategorization setting', () => {
      it('should set empty category for unresolved transactions when skipCategorization is true', async () => {
        const mockRawTransactions = [
          {
            externalCanonicalId: 'tx-1',
            occurredAt: '2025-01-15T10:30:00.000000+00:00',
            type: 'CREDIT_CARD',
            subType: 'PURCHASE',
            status: 'settled',
            spendMerchant: 'Unknown Merchant',
            amount: 50.00,
            amountSign: 'negative',
          },
          {
            externalCanonicalId: 'tx-2',
            occurredAt: '2025-01-16T10:30:00.000000+00:00',
            type: 'CREDIT_CARD',
            subType: 'PAYMENT',
            status: 'settled',
            spendMerchant: null,
            amount: 100.00,
            amountSign: 'positive',
          },
        ];

        wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);
        monarchApi.getCategoriesAndGroups.mockResolvedValue({ categories: [] });

        const accountWithSkip = {
          wealthsimpleAccount: {
            id: 'test-account-id',
            nickname: 'Test Credit Card',
            type: 'CREDIT_CARD',
          },
          skipCategorization: true,
        };

        const result = await fetchAndProcessCreditCardTransactions(
          accountWithSkip,
          '2025-01-01',
          '2025-01-31',
        );

        // Should NOT show category selector
        expect(showMonarchCategorySelector).not.toHaveBeenCalled();

        // PAYMENT is auto-categorized, should keep its category
        const paymentTx = result.find((tx) => tx.subType === 'PAYMENT');
        expect(paymentTx.resolvedMonarchCategory).toBe('Credit Card Payment');

        // PURCHASE should have Uncategorized (skip categorization)
        const purchaseTx = result.find((tx) => tx.subType === 'PURCHASE');
        expect(purchaseTx.resolvedMonarchCategory).toBe('Uncategorized');
      });
    });

    describe('credit card - skipAll from category selector', () => {
      it('should set empty category for remaining transactions when user clicks Skip All', async () => {
        const mockRawTransactions = [
          {
            externalCanonicalId: 'tx-1',
            occurredAt: '2025-01-15T10:30:00.000000+00:00',
            type: 'CREDIT_CARD',
            subType: 'PURCHASE',
            status: 'settled',
            spendMerchant: 'Merchant A',
            amount: 50.00,
            amountSign: 'negative',
          },
          {
            externalCanonicalId: 'tx-2',
            occurredAt: '2025-01-16T10:30:00.000000+00:00',
            type: 'CREDIT_CARD',
            subType: 'PURCHASE',
            status: 'settled',
            spendMerchant: 'Merchant B',
            amount: 75.00,
            amountSign: 'negative',
          },
        ];

        wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);
        monarchApi.getCategoriesAndGroups.mockResolvedValue({ categories: [] });

        // Both merchants need manual selection
        applyWealthsimpleCategoryMapping.mockReturnValue({
          needsManualSelection: true,
          bankCategory: 'test',
          suggestedCategory: null,
          similarityScore: 0,
        });

        // User clicks "Skip All" on the first prompt
        showMonarchCategorySelector.mockImplementation((bankCategory, callback) => {
          callback({ skipAll: true });
        });

        const accountNoSkip = {
          wealthsimpleAccount: {
            id: 'test-account-id',
            nickname: 'Test CC',
            type: 'CREDIT_CARD',
          },
        };

        const result = await fetchAndProcessCreditCardTransactions(
          accountNoSkip,
          '2025-01-01',
          '2025-01-31',
        );

        // Both transactions should have Uncategorized
        expect(result).toHaveLength(2);
        expect(result[0].resolvedMonarchCategory).toBe('Uncategorized');
        expect(result[1].resolvedMonarchCategory).toBe('Uncategorized');

        // Should only show selector once (skipAll stops further prompts)
        expect(showMonarchCategorySelector).toHaveBeenCalledTimes(1);
      });
    });

    describe('cash - skipCategorization setting', () => {
      const mockCashAccount = {
        wealthsimpleAccount: {
          id: 'cash-account-id',
          nickname: 'Cash Account',
          type: 'CASH',
        },
        skipCategorization: true,
      };

      it('should skip manual categorization for unmatched transactions when skipCategorization is true', async () => {
        const mockRawTransactions = [
          {
            externalCanonicalId: 'tx-unknown',
            type: 'UNKNOWN_TYPE',
            subType: 'UNKNOWN_SUBTYPE',
            unifiedStatus: 'COMPLETED',
            amount: 25.00,
            amountSign: 'negative',
            occurredAt: '2026-01-15T10:00:00.000000+00:00',
          },
          {
            externalCanonicalId: 'tx-etransfer',
            type: 'DEPOSIT',
            subType: 'E_TRANSFER',
            unifiedStatus: 'COMPLETED',
            eTransferName: 'John',
            amount: 100.00,
            amountSign: 'positive',
            occurredAt: '2026-01-16T10:00:00.000000+00:00',
          },
        ];

        wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);

        const result = await fetchAndProcessCashTransactions(
          mockCashAccount,
          '2026-01-01',
          '2026-01-31',
        );

        // Should NOT show manual categorization dialog
        expect(showManualTransactionCategorization).not.toHaveBeenCalled();

        // e-transfer should keep its rule-based category
        const etransferTx = result.find((tx) => tx.id === 'tx-etransfer');
        expect(etransferTx.resolvedMonarchCategory).toBe('Transfer');

        // Unknown transaction should have Uncategorized
        const unknownTx = result.find((tx) => tx.id === 'tx-unknown');
        expect(unknownTx.resolvedMonarchCategory).toBe('Uncategorized');
        expect(unknownTx.ruleId).toBe('skip-categorization');
      });
    });

    describe('investment - skipCategorization setting', () => {
      const mockInvestmentAccount = {
        wealthsimpleAccount: {
          id: 'investment-account-id',
          nickname: 'My TFSA',
          type: 'MANAGED_TFSA',
        },
        skipCategorization: true,
      };

      beforeEach(() => {
        global.GM_getValue = jest.fn().mockReturnValue(JSON.stringify([
          {
            wealthsimpleAccount: {
              id: 'investment-account-id',
              nickname: 'My TFSA',
              type: 'MANAGED_TFSA',
            },
          },
        ]));
      });

      it('should skip manual categorization for unmatched transactions when skipCategorization is true', async () => {
        const mockRawTransactions = [
          {
            externalCanonicalId: 'tx-unknown-invest',
            type: 'UNKNOWN_TYPE',
            subType: 'UNKNOWN_SUBTYPE',
            status: 'completed',
            amount: 50.00,
            amountSign: 'negative',
            occurredAt: '2026-01-15T10:00:00.000000+00:00',
          },
        ];

        wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);

        const result = await fetchAndProcessInvestmentTransactions(
          mockInvestmentAccount,
          '2026-01-01',
          '2026-01-31',
        );

        // Should NOT show manual categorization dialog
        expect(showManualTransactionCategorization).not.toHaveBeenCalled();

        expect(result).toHaveLength(1);
        expect(result[0].resolvedMonarchCategory).toBe('Uncategorized');
        expect(result[0].ruleId).toBe('skip-categorization');
      });
    });

    describe('credit card - skipCategorization via options', () => {
      it('should skip category resolution when skipCategorization is passed in options (balance reconstruction)', async () => {
        const mockRawTransactions = [
          {
            externalCanonicalId: 'tx-1',
            occurredAt: '2025-01-15T10:30:00.000000+00:00',
            type: 'CREDIT_CARD',
            subType: 'PURCHASE',
            status: 'settled',
            spendMerchant: 'Unknown Merchant',
            amount: 50.00,
            amountSign: 'negative',
          },
          {
            externalCanonicalId: 'tx-2',
            occurredAt: '2025-01-16T10:30:00.000000+00:00',
            type: 'CREDIT_CARD',
            subType: 'PAYMENT',
            status: 'settled',
            spendMerchant: null,
            amount: 100.00,
            amountSign: 'positive',
          },
        ];

        wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);
        monarchApi.getCategoriesAndGroups.mockResolvedValue({ categories: [] });

        // Account does NOT have skipCategorization set
        const accountNoSkip = {
          wealthsimpleAccount: {
            id: 'test-account-id',
            nickname: 'Test Credit Card',
            type: 'CREDIT_CARD',
          },
        };

        // Pass skipCategorization via options (as balance reconstruction would)
        const result = await fetchAndProcessCreditCardTransactions(
          accountNoSkip,
          '2025-01-01',
          '2025-01-31',
          { skipCategorization: true },
        );

        // Should NOT show category selector
        expect(showMonarchCategorySelector).not.toHaveBeenCalled();

        // PAYMENT is auto-categorized, should keep its category
        const paymentTx = result.find((tx) => tx.subType === 'PAYMENT');
        expect(paymentTx.resolvedMonarchCategory).toBe('Credit Card Payment');

        // PURCHASE should have Uncategorized (skip categorization via options)
        const purchaseTx = result.find((tx) => tx.subType === 'PURCHASE');
        expect(purchaseTx.resolvedMonarchCategory).toBe('Uncategorized');
      });
    });

    describe('cash - skipCategorization via options', () => {
      it('should skip manual categorization when skipCategorization is passed in options', async () => {
        const mockRawTransactions = [
          {
            externalCanonicalId: 'tx-unknown',
            type: 'UNKNOWN_TYPE',
            subType: 'UNKNOWN_SUBTYPE',
            unifiedStatus: 'COMPLETED',
            amount: 25.00,
            amountSign: 'negative',
            occurredAt: '2026-01-15T10:00:00.000000+00:00',
          },
        ];

        wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);

        // Account does NOT have skipCategorization set
        const cashAccount = {
          wealthsimpleAccount: {
            id: 'cash-account-id',
            nickname: 'Cash Account',
            type: 'CASH',
          },
        };

        const result = await fetchAndProcessCashTransactions(
          cashAccount,
          '2026-01-01',
          '2026-01-31',
          { skipCategorization: true },
        );

        expect(showManualTransactionCategorization).not.toHaveBeenCalled();
        expect(result).toHaveLength(1);
        expect(result[0].resolvedMonarchCategory).toBe('Uncategorized');
        expect(result[0].ruleId).toBe('skip-categorization');
      });
    });

    describe('line of credit - skipCategorization setting', () => {
      const mockLocAccount = {
        wealthsimpleAccount: {
          id: 'loc-account-id',
          nickname: 'Portfolio LOC',
          type: 'PORTFOLIO_LINE_OF_CREDIT',
        },
        skipCategorization: true,
      };

      it('should skip manual categorization for unmatched transactions when skipCategorization is true', async () => {
        const mockRawTransactions = [
          {
            externalCanonicalId: 'loc-unknown',
            type: 'INTEREST',
            subType: 'MARGIN_INTEREST',
            status: 'completed',
            amount: 50.00,
            amountSign: 'negative',
            occurredAt: '2026-01-15T10:00:00.000000+00:00',
          },
          {
            externalCanonicalId: 'loc-borrow',
            type: 'INTERNAL_TRANSFER',
            subType: 'SOURCE',
            status: 'completed',
            amount: 5000.00,
            amountSign: 'negative',
            occurredAt: '2026-01-16T10:00:00.000000+00:00',
          },
        ];

        wealthsimpleApi.fetchTransactions.mockResolvedValue(mockRawTransactions);

        const result = await fetchAndProcessLineOfCreditTransactions(
          mockLocAccount,
          '2026-01-01',
          '2026-01-31',
        );

        // Should NOT show manual categorization dialog
        expect(showManualTransactionCategorization).not.toHaveBeenCalled();

        // Rule-matched transaction should keep its category
        const borrowTx = result.find((tx) => tx.id === 'loc-borrow');
        expect(borrowTx.resolvedMonarchCategory).toBe('Transfer');

        // Unknown transaction should have Uncategorized
        const unknownTx = result.find((tx) => tx.id === 'loc-unknown');
        expect(unknownTx.resolvedMonarchCategory).toBe('Uncategorized');
        expect(unknownTx.ruleId).toBe('skip-categorization');
      });
    });
  });

  describe('formatReconciliationMessage', () => {
    it('should return "No pending transactions" when noPendingTag is true', () => {
      const result = formatReconciliationMessage({ noPendingTag: true });
      expect(result).toBe('No pending transactions');
    });

    it('should return "No pending transactions" when noPendingTransactions is true', () => {
      const result = formatReconciliationMessage({ noPendingTransactions: true });
      expect(result).toBe('No pending transactions');
    });

    it('should return "No pending transactions" when all counts are 0', () => {
      const result = formatReconciliationMessage({ settled: 0, cancelled: 0, failed: 0 });
      expect(result).toBe('No pending transactions');
    });

    it('should format message with only settled count', () => {
      const result = formatReconciliationMessage({ settled: 3, cancelled: 0, failed: 0 });
      expect(result).toBe('3 settled');
    });

    it('should format message with only cancelled count', () => {
      const result = formatReconciliationMessage({ settled: 0, cancelled: 2, failed: 0 });
      expect(result).toBe('2 cancelled');
    });

    it('should format message with only failed count', () => {
      const result = formatReconciliationMessage({ settled: 0, cancelled: 0, failed: 2 });
      expect(result).toBe('2 failed');
    });

    it('should format message with both settled and cancelled counts', () => {
      const result = formatReconciliationMessage({ settled: 3, cancelled: 2, failed: 0 });
      expect(result).toBe('3 settled, 2 cancelled');
    });

    it('should format message with settled, cancelled, and failed counts', () => {
      const result = formatReconciliationMessage({ settled: 3, cancelled: 2, failed: 1 });
      expect(result).toBe('3 settled, 2 cancelled, 1 failed');
    });

    it('should format message with settled and failed counts', () => {
      const result = formatReconciliationMessage({ settled: 5, cancelled: 0, failed: 2 });
      expect(result).toBe('5 settled, 2 failed');
    });
  });
});
