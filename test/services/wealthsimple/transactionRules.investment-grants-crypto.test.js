/**
 * Tests for Wealthsimple Transaction Rules Engine - Investment Grants & Crypto Rules
 *
 * Covers: INVESTMENT_RESP_GRANT_TRANSACTION_RULES, formatManagedOrderNotes,
 * CRYPTO_BUY/CRYPTO_SELL rules, formatCryptoOrderNotes,
 * OPTIONS_SHORT_EXPIRY rule
 */

import {
  INVESTMENT_RESP_GRANT_TRANSACTION_RULES,
  INVESTMENT_BUY_SELL_TRANSACTION_RULES,
  formatManagedOrderNotes,
  formatCryptoOrderNotes,
  formatCryptoSwapNotes,
} from '../../../src/services/wealthsimple/transactionRules';
import { STORAGE } from '../../../src/core/config';

describe('Wealthsimple Transaction Rules Engine - Investment Grants & Crypto', () => {
  describe('INVESTMENT_RESP_GRANT_TRANSACTION_RULES', () => {
    // Helper to set up mock accounts in GM storage
    const setupMockAccounts = (accounts) => {
      const consolidatedAccounts = accounts.map((acc) => ({
        wealthsimpleAccount: {
          id: acc.id,
          nickname: acc.nickname,
        },
      }));
      global.GM_getValue = jest.fn((key, defaultValue) => {
        if (key === STORAGE.WEALTHSIMPLE_ACCOUNTS_LIST) {
          return JSON.stringify(consolidatedAccounts);
        }
        return defaultValue;
      });
    };

    beforeEach(() => {
      setupMockAccounts([{ id: 'account-resp-123', nickname: 'Family RESP' }]);
    });

    describe('RESP_GRANT rule matching', () => {
      it('should match transactions with type RESP_GRANT', () => {
        const transaction = {
          externalCanonicalId: 'resp-grant-123',
          type: 'RESP_GRANT',
          subType: 'CESG',
          accountId: 'account-resp-123',
          amount: 500.0,
          currency: 'CAD',
        };

        const rule = INVESTMENT_RESP_GRANT_TRANSACTION_RULES.find((r) => r.id === 'resp-grant');
        expect(rule.match(transaction)).toBe(true);
      });

      it('should match RESP_GRANT with any subType', () => {
        const rule = INVESTMENT_RESP_GRANT_TRANSACTION_RULES.find((r) => r.id === 'resp-grant');

        expect(rule.match({ type: 'RESP_GRANT', subType: 'CESG' })).toBe(true);
        expect(rule.match({ type: 'RESP_GRANT', subType: 'CLB' })).toBe(true);
        expect(rule.match({ type: 'RESP_GRANT', subType: null })).toBe(true);
        expect(rule.match({ type: 'RESP_GRANT', subType: undefined })).toBe(true);
      });

      it('should not match transactions with different type', () => {
        const rule = INVESTMENT_RESP_GRANT_TRANSACTION_RULES.find((r) => r.id === 'resp-grant');

        expect(rule.match({ type: 'DEPOSIT', subType: 'RESP_GRANT' })).toBe(false);
        expect(rule.match({ type: 'DIVIDEND', subType: 'CESG' })).toBe(false);
        expect(rule.match({ type: 'INTEREST', subType: null })).toBe(false);
      });
    });

    describe('RESP_GRANT transaction processing with subType', () => {
      it('should process RESP_GRANT with subType CESG correctly', () => {
        const transaction = {
          externalCanonicalId: 'resp-cesg-123',
          type: 'RESP_GRANT',
          subType: 'CESG',
          assetSymbol: 'CAD',
          accountId: 'account-resp-123',
          amount: 500.0,
          currency: 'CAD',
        };

        const rule = INVESTMENT_RESP_GRANT_TRANSACTION_RULES.find((r) => r.id === 'resp-grant');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Grant');
        expect(result.merchant).toBe('RESP Grant: Cesg');
        expect(result.originalStatement).toBe('RESP_GRANT:CESG:CAD:CAD');
        expect(result.notes).toBe('');
        expect(result.technicalDetails).toBe('');
      });

      it('should process RESP_GRANT with subType CLB correctly', () => {
        const transaction = {
          externalCanonicalId: 'resp-clb-123',
          type: 'RESP_GRANT',
          subType: 'CLB',
          assetSymbol: 'CAD',
          accountId: 'account-resp-123',
          amount: 500.0,
          currency: 'CAD',
        };

        const rule = INVESTMENT_RESP_GRANT_TRANSACTION_RULES.find((r) => r.id === 'resp-grant');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Grant');
        expect(result.merchant).toBe('RESP Grant: Clb');
        expect(result.originalStatement).toBe('RESP_GRANT:CLB:CAD:CAD');
      });
    });

    describe('RESP_GRANT transaction processing without subType', () => {
      it('should process RESP_GRANT with null subType correctly', () => {
        const transaction = {
          externalCanonicalId: 'resp-null-subtype',
          type: 'RESP_GRANT',
          subType: null,
          assetSymbol: 'CAD',
          accountId: 'account-resp-123',
          amount: 250.0,
          currency: 'CAD',
        };

        const rule = INVESTMENT_RESP_GRANT_TRANSACTION_RULES.find((r) => r.id === 'resp-grant');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Grant');
        expect(result.merchant).toBe('RESP Grant');
        expect(result.originalStatement).toBe('RESP_GRANT::CAD:CAD');
      });

      it('should process RESP_GRANT with empty subType correctly', () => {
        const transaction = {
          externalCanonicalId: 'resp-empty-subtype',
          type: 'RESP_GRANT',
          subType: '',
          assetSymbol: 'CAD',
          accountId: 'account-resp-123',
          amount: 100.0,
          currency: 'CAD',
        };

        const rule = INVESTMENT_RESP_GRANT_TRANSACTION_RULES.find((r) => r.id === 'resp-grant');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.merchant).toBe('RESP Grant');
        expect(result.originalStatement).toBe('RESP_GRANT::CAD:CAD');
      });
    });

    describe('RESP_GRANT edge cases', () => {
      it('should handle all fields missing with appropriate fallbacks', () => {
        setupMockAccounts([]);

        const transaction = {
          externalCanonicalId: 'resp-all-missing',
          type: 'RESP_GRANT',
        };

        const rule = INVESTMENT_RESP_GRANT_TRANSACTION_RULES.find((r) => r.id === 'resp-grant');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Grant');
        expect(result.merchant).toBe('RESP Grant');
        expect(result.originalStatement).toBe('RESP_GRANT:::CAD');
      });

      it('should not set needsCategoryMapping flag (auto-categorized)', () => {
        const transaction = {
          externalCanonicalId: 'resp-no-mapping',
          type: 'RESP_GRANT',
          subType: 'CESG',
          accountId: 'account-resp-123',
        };

        const rule = INVESTMENT_RESP_GRANT_TRANSACTION_RULES.find((r) => r.id === 'resp-grant');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.needsCategoryMapping).toBeUndefined();
      });
    });

    describe('Rule structure', () => {
      it('should have required properties', () => {
        const rule = INVESTMENT_RESP_GRANT_TRANSACTION_RULES.find((r) => r.id === 'resp-grant');

        expect(rule).toHaveProperty('id');
        expect(rule).toHaveProperty('description');
        expect(rule).toHaveProperty('match');
        expect(rule).toHaveProperty('process');
      });

      it('should have exactly 1 rule', () => {
        expect(INVESTMENT_RESP_GRANT_TRANSACTION_RULES.length).toBe(1);
      });
    });
  });

  describe('formatManagedOrderNotes', () => {
    it('should return empty string for null activity', () => {
      expect(formatManagedOrderNotes(null, null)).toBe('');
    });

    it('should return empty string for undefined activity', () => {
      expect(formatManagedOrderNotes(undefined, null)).toBe('');
    });

    it('should format buy order with all fields correctly', () => {
      const activity = {
        currency: 'CAD',
        assetSymbol: 'EEMV',
        assetQuantity: 0.8257,
        amount: 9.22,
        assetName: 'iShares Edge MSCI Min Vol Emerging Mkt ETF',
      };
      const managedActivity = {
        quantity: '0.8257',
        fxRate: '1.0',
        marketPrice: { amount: '11.165', currency: 'CAD' },
      };

      const result = formatManagedOrderNotes(activity, managedActivity, false);

      expect(result).toBe('Bought 0.8257 shares of iShares Edge MSCI Min Vol Emerging Mkt ETF (EEMV) at CAD$11.165 per share\nTotal CAD$9.22');
    });

    it('should format sell order with all fields correctly', () => {
      const activity = {
        currency: 'CAD',
        assetSymbol: 'XAW',
        assetQuantity: 5.5,
        amount: 150.25,
        assetName: 'iShares Core MSCI All Country World ex Canada Index ETF',
      };
      const managedActivity = {
        quantity: '5.5',
        fxRate: '1.0',
        marketPrice: { amount: '27.32', currency: 'CAD' },
      };

      const result = formatManagedOrderNotes(activity, managedActivity, true);

      expect(result).toBe('Sold 5.5 shares of iShares Core MSCI All Country World ex Canada Index ETF (XAW) at CAD$27.32 per share\nTotal CAD$150.25');
    });

    it('should handle USD currency', () => {
      const activity = {
        currency: 'USD',
        assetSymbol: 'VTI',
        assetQuantity: 2.0,
        amount: 500.00,
        assetName: 'Vanguard Total Stock Market ETF',
      };
      const managedActivity = {
        quantity: '2.0',
        fxRate: '1.35',
        marketPrice: { amount: '250.00', currency: 'USD' },
      };

      const result = formatManagedOrderNotes(activity, managedActivity, false);

      expect(result).toBe('Bought 2 shares of Vanguard Total Stock Market ETF (VTI) at USD$250 per share\nTotal USD$500');
    });

    it('should return basic notes when managedActivity is null', () => {
      const activity = {
        currency: 'CAD',
        assetSymbol: 'EEMV',
        assetQuantity: 1,
        amount: 15.00,
        assetName: 'iShares Edge MSCI Min Vol Emerging Mkt ETF',
      };

      const result = formatManagedOrderNotes(activity, null, false);

      expect(result).toBe('Buy order EEMV\nTotal CAD$15');
    });

    it('should return basic notes for sell when managedActivity is null', () => {
      const activity = {
        currency: 'CAD',
        assetSymbol: 'XAW',
        assetQuantity: 2,
        amount: 50.00,
        assetName: 'Some ETF',
      };

      const result = formatManagedOrderNotes(activity, null, true);

      expect(result).toBe('Sell order XAW\nTotal CAD$50');
    });

    it('should handle missing assetName with symbol only', () => {
      const activity = {
        currency: 'CAD',
        assetSymbol: 'VFV',
        assetQuantity: 3,
        amount: 300.00,
        assetName: null,
      };
      const managedActivity = {
        quantity: '3',
        fxRate: '1.0',
        marketPrice: { amount: '100.00', currency: 'CAD' },
      };

      const result = formatManagedOrderNotes(activity, managedActivity, false);

      expect(result).toBe('Bought 3 shares of VFV at CAD$100 per share\nTotal CAD$300');
    });

    it('should handle missing marketPrice', () => {
      const activity = {
        currency: 'CAD',
        assetSymbol: 'EEMV',
        assetQuantity: 1,
        amount: 15.00,
        assetName: 'Some ETF',
      };
      const managedActivity = {
        quantity: '1',
        fxRate: '1.0',
        marketPrice: null,
      };

      const result = formatManagedOrderNotes(activity, managedActivity, false);

      expect(result).toBe('Buy order EEMV\nTotal CAD$15');
    });

    it('should handle all fields missing with defaults', () => {
      const activity = {
        type: 'MANAGED_BUY',
      };

      const result = formatManagedOrderNotes(activity, null, false);

      expect(result).toContain('Buy order');
      expect(result).toContain('N/A');
      expect(result).toContain('CAD$');
    });

    it('should use quantity from managedActivity when available', () => {
      const activity = {
        currency: 'CAD',
        assetSymbol: 'VFV',
        assetQuantity: 5, // This should be ignored
        amount: 500.00,
        assetName: 'Vanguard S&P 500 Index ETF',
      };
      const managedActivity = {
        quantity: '3.5', // Use this instead
        fxRate: '1.0',
        marketPrice: { amount: '142.86', currency: 'CAD' },
      };

      const result = formatManagedOrderNotes(activity, managedActivity, false);

      expect(result).toBe('Bought 3.5 shares of Vanguard S&P 500 Index ETF (VFV) at CAD$142.86 per share\nTotal CAD$500');
    });
  });

  describe('CRYPTO_BUY rule', () => {
    it('should match transactions with type CRYPTO_BUY', () => {
      const rule = INVESTMENT_BUY_SELL_TRANSACTION_RULES.find((r) => r.id === 'crypto-buy');
      expect(rule.match({ type: 'CRYPTO_BUY' })).toBe(true);
    });

    it('should not match transactions with different type', () => {
      const rule = INVESTMENT_BUY_SELL_TRANSACTION_RULES.find((r) => r.id === 'crypto-buy');

      expect(rule.match({ type: 'DIY_BUY' })).toBe(false);
      expect(rule.match({ type: 'CRYPTO_SELL' })).toBe(false);
      expect(rule.match({ type: 'MANAGED_BUY' })).toBe(false);
    });

    it('should process CRYPTO_BUY with all fields correctly', () => {
      const transaction = {
        externalCanonicalId: 'crypto-buy-123',
        type: 'CRYPTO_BUY',
        subType: 'MARKET_ORDER',
        assetSymbol: 'BTC',
        amount: 1000,
        currency: 'CAD',
        assetQuantity: 0.015,
      };

      const rule = INVESTMENT_BUY_SELL_TRANSACTION_RULES.find((r) => r.id === 'crypto-buy');
      const result = rule.process(transaction, null);

      expect(result).not.toBeNull();
      expect(result.category).toBe('Buy');
      expect(result.merchant).toBe('BTC');
      expect(result.originalStatement).toBe('CRYPTO_BUY:MARKET_ORDER:BTC');
      expect(result.notes).toContain('BTC');
      expect(result.technicalDetails).toBe('');
    });

    it('should handle missing assetSymbol with Unknown fallback', () => {
      const transaction = {
        externalCanonicalId: 'crypto-buy-no-symbol',
        type: 'CRYPTO_BUY',
        subType: 'LIMIT_ORDER',
        assetSymbol: null,
        amount: 500,
        currency: 'CAD',
      };

      const rule = INVESTMENT_BUY_SELL_TRANSACTION_RULES.find((r) => r.id === 'crypto-buy');
      const result = rule.process(transaction, null);

      expect(result).not.toBeNull();
      expect(result.merchant).toBe('Unknown');
      expect(result.originalStatement).toBe('CRYPTO_BUY:LIMIT_ORDER:Unknown');
    });

    it('should use extended order data when available', () => {
      const transaction = {
        externalCanonicalId: 'crypto-buy-extended',
        type: 'CRYPTO_BUY',
        subType: 'MARKET_ORDER',
        assetSymbol: 'ETH',
        amount: 2000,
        currency: 'CAD',
      };

      const enrichmentMap = new Map();
      enrichmentMap.set('crypto-buy-extended', {
        orderType: 'BUY',
        submittedQuantity: 1.5,
        filledQuantity: 1.5,
        averageFilledPrice: 1333.33,
        filledTotalFee: 0,
      });

      const rule = INVESTMENT_BUY_SELL_TRANSACTION_RULES.find((r) => r.id === 'crypto-buy');
      const result = rule.process(transaction, enrichmentMap);

      expect(result).not.toBeNull();
      expect(result.category).toBe('Buy');
      expect(result.merchant).toBe('ETH');
      expect(result.notes).toContain('ETH');
    });
  });

  describe('CRYPTO_SELL rule', () => {
    it('should match transactions with type CRYPTO_SELL', () => {
      const rule = INVESTMENT_BUY_SELL_TRANSACTION_RULES.find((r) => r.id === 'crypto-sell');
      expect(rule.match({ type: 'CRYPTO_SELL' })).toBe(true);
    });

    it('should not match transactions with different type', () => {
      const rule = INVESTMENT_BUY_SELL_TRANSACTION_RULES.find((r) => r.id === 'crypto-sell');

      expect(rule.match({ type: 'DIY_SELL' })).toBe(false);
      expect(rule.match({ type: 'CRYPTO_BUY' })).toBe(false);
      expect(rule.match({ type: 'MANAGED_SELL' })).toBe(false);
    });

    it('should process CRYPTO_SELL with all fields correctly', () => {
      const transaction = {
        externalCanonicalId: 'crypto-sell-123',
        type: 'CRYPTO_SELL',
        subType: 'MARKET_ORDER',
        assetSymbol: 'BTC',
        amount: 1500,
        currency: 'CAD',
        assetQuantity: 0.02,
      };

      const rule = INVESTMENT_BUY_SELL_TRANSACTION_RULES.find((r) => r.id === 'crypto-sell');
      const result = rule.process(transaction, null);

      expect(result).not.toBeNull();
      expect(result.category).toBe('Sell');
      expect(result.merchant).toBe('BTC');
      expect(result.originalStatement).toBe('CRYPTO_SELL:MARKET_ORDER:BTC');
      expect(result.notes).toContain('BTC');
      expect(result.technicalDetails).toBe('');
    });

    it('should handle missing assetSymbol with Unknown fallback', () => {
      const transaction = {
        externalCanonicalId: 'crypto-sell-no-symbol',
        type: 'CRYPTO_SELL',
        subType: 'LIMIT_ORDER',
        assetSymbol: null,
        amount: 750,
        currency: 'CAD',
      };

      const rule = INVESTMENT_BUY_SELL_TRANSACTION_RULES.find((r) => r.id === 'crypto-sell');
      const result = rule.process(transaction, null);

      expect(result).not.toBeNull();
      expect(result.merchant).toBe('Unknown');
      expect(result.originalStatement).toBe('CRYPTO_SELL:LIMIT_ORDER:Unknown');
    });

    it('should use extended order data when available', () => {
      const transaction = {
        externalCanonicalId: 'crypto-sell-extended',
        type: 'CRYPTO_SELL',
        subType: 'MARKET_ORDER',
        assetSymbol: 'SOL',
        amount: 500,
        currency: 'CAD',
      };

      const enrichmentMap = new Map();
      enrichmentMap.set('crypto-sell-extended', {
        orderType: 'SELL',
        submittedQuantity: 5,
        filledQuantity: 5,
        averageFilledPrice: 100,
        filledTotalFee: 0,
      });

      const rule = INVESTMENT_BUY_SELL_TRANSACTION_RULES.find((r) => r.id === 'crypto-sell');
      const result = rule.process(transaction, enrichmentMap);

      expect(result).not.toBeNull();
      expect(result.category).toBe('Sell');
      expect(result.merchant).toBe('SOL');
      expect(result.notes).toContain('SOL');
    });
  });

  describe('formatCryptoOrderNotes', () => {
    it('should return empty string for null activity', () => {
      expect(formatCryptoOrderNotes(null, null)).toBe('');
    });

    it('should return minimal notes when no crypto order data', () => {
      const activity = {
        type: 'CRYPTO_BUY',
        assetSymbol: 'BTC',
        amount: 10,
        currency: 'CAD',
      };

      const result = formatCryptoOrderNotes(activity, null);
      expect(result).toBe('Buy BTC\nTotal CAD$10');
    });

    it('should return minimal sell notes when no crypto order data', () => {
      const activity = {
        type: 'CRYPTO_SELL',
        assetSymbol: 'ETH',
        amount: 500,
        currency: 'USD',
      };

      const result = formatCryptoOrderNotes(activity, null);
      expect(result).toBe('Sell ETH\nTotal USD$500');
    });

    it('should format market order buy with full crypto order data', () => {
      const activity = {
        type: 'CRYPTO_BUY',
        assetSymbol: 'BTC',
        amount: 10,
        currency: 'CAD',
      };
      const cryptoOrder = {
        quantity: '0.000109',
        executedQuantity: '0.00010891',
        price: '91358.8685646',
        currency: 'CAD',
        limitPrice: null,
        fee: '0.04',
        swapFee: '0.0497908481',
        totalCost: '10.0',
      };

      const result = formatCryptoOrderNotes(activity, cryptoOrder);

      expect(result).toBe(
        'Market order Buy 0.000109 BTC\n' +
        'Filled 0.00010891 @ CAD$91358.8685646, fees: CAD$0.0897908481 (fee: CAD$0.04, swap: CAD$0.0497908481)\n' +
        'Total CAD$10',
      );
    });

    it('should format limit order buy with full crypto order data', () => {
      const activity = {
        type: 'CRYPTO_BUY',
        assetSymbol: 'BTC',
        amount: 89.59,
        currency: 'CAD',
      };
      const cryptoOrder = {
        quantity: '0.001',
        executedQuantity: '0.001',
        price: '89500',
        currency: 'CAD',
        limitPrice: '90000',
        timeInForce: 'day',
        fee: '0.04',
        swapFee: '0.05',
        totalCost: '89.59',
      };

      const result = formatCryptoOrderNotes(activity, cryptoOrder);

      expect(result).toBe(
        'Limit order Buy 0.001 BTC @ 90000 Limit day\n' +
        'Filled 0.001 @ CAD$89500, fees: CAD$0.09 (fee: CAD$0.04, swap: CAD$0.05)\n' +
        'Total CAD$89.59',
      );
    });

    it('should format market order sell correctly', () => {
      const activity = {
        type: 'CRYPTO_SELL',
        assetSymbol: 'ETH',
        amount: 500,
        currency: 'CAD',
      };
      const cryptoOrder = {
        quantity: '0.15',
        executedQuantity: '0.15',
        price: '3300',
        currency: 'CAD',
        limitPrice: null,
        fee: '0.1',
        swapFee: '0.2',
        totalCost: '500',
      };

      const result = formatCryptoOrderNotes(activity, cryptoOrder);

      expect(result).toContain('Market order Sell 0.15 ETH');
      expect(result).toContain('Filled 0.15 @ CAD$3300');
      expect(result).toContain('fees: CAD$0.3 (fee: CAD$0.1, swap: CAD$0.2)');
      expect(result).toContain('Total CAD$500');
    });

    it('should handle missing fields with defaults', () => {
      const activity = {
        type: 'CRYPTO_BUY',
        assetSymbol: null,
        amount: null,
        currency: null,
      };
      const cryptoOrder = {
        quantity: null,
        executedQuantity: null,
        price: null,
        currency: null,
        limitPrice: null,
        fee: null,
        swapFee: null,
        totalCost: null,
      };

      const result = formatCryptoOrderNotes(activity, cryptoOrder);

      expect(result).toContain('Market order Buy 0 N/A');
      expect(result).toContain('Filled 0 @ CAD$0');
      expect(result).toContain('Total CAD$0');
    });

    it('should use crypto order currency over activity currency', () => {
      const activity = {
        type: 'CRYPTO_BUY',
        assetSymbol: 'BTC',
        amount: 100,
        currency: 'USD',
      };
      const cryptoOrder = {
        quantity: '0.001',
        executedQuantity: '0.001',
        price: '95000',
        currency: 'CAD',
        limitPrice: null,
        fee: '0.05',
        swapFee: '0.05',
        totalCost: '100',
      };

      const result = formatCryptoOrderNotes(activity, cryptoOrder);

      expect(result).toContain('CAD$95000');
      expect(result).toContain('Total CAD$100');
    });
  });

  describe('CRYPTO_BUY/CRYPTO_SELL rules with crypto order enrichment', () => {
    it('should use formatCryptoOrderNotes with crypto order data for CRYPTO_BUY', () => {
      const transaction = {
        externalCanonicalId: 'order-crypto123',
        type: 'CRYPTO_BUY',
        subType: 'MARKET_ORDER',
        assetSymbol: 'BTC',
        amount: 10,
        currency: 'CAD',
      };

      const enrichmentMap = new Map();
      enrichmentMap.set('order-crypto123', {
        isCryptoOrderData: true,
        quantity: '0.000109',
        executedQuantity: '0.00010891',
        price: '91358.8685646',
        currency: 'CAD',
        limitPrice: null,
        fee: '0.04',
        swapFee: '0.0497908481',
        totalCost: '10.0',
      });

      const rule = INVESTMENT_BUY_SELL_TRANSACTION_RULES.find((r) => r.id === 'crypto-buy');
      const result = rule.process(transaction, enrichmentMap);

      expect(result.notes).toContain('Market order Buy 0.000109 BTC');
      expect(result.notes).toContain('Filled 0.00010891 @ CAD$91358.8685646');
      expect(result.notes).toContain('Total CAD$10');
    });

    it('should use formatCryptoOrderNotes with crypto order data for CRYPTO_SELL', () => {
      const transaction = {
        externalCanonicalId: 'order-cryptosell',
        type: 'CRYPTO_SELL',
        subType: 'MARKET_ORDER',
        assetSymbol: 'ETH',
        amount: 500,
        currency: 'CAD',
      };

      const enrichmentMap = new Map();
      enrichmentMap.set('order-cryptosell', {
        isCryptoOrderData: true,
        quantity: '0.15',
        executedQuantity: '0.15',
        price: '3300',
        currency: 'CAD',
        limitPrice: null,
        fee: '0.1',
        swapFee: '0.2',
        totalCost: '500',
      });

      const rule = INVESTMENT_BUY_SELL_TRANSACTION_RULES.find((r) => r.id === 'crypto-sell');
      const result = rule.process(transaction, enrichmentMap);

      expect(result.notes).toContain('Market order Sell 0.15 ETH');
      expect(result.notes).toContain('Filled 0.15 @ CAD$3300');
    });

    it('should fall back to minimal notes when no enrichment data', () => {
      const transaction = {
        externalCanonicalId: 'order-noenrich',
        type: 'CRYPTO_BUY',
        subType: 'MARKET_ORDER',
        assetSymbol: 'SOL',
        amount: 200,
        currency: 'CAD',
      };

      const rule = INVESTMENT_BUY_SELL_TRANSACTION_RULES.find((r) => r.id === 'crypto-buy');
      const result = rule.process(transaction, new Map());

      expect(result.notes).toBe('Buy SOL\nTotal CAD$200');
    });

    it('should fall back to minimal notes when enrichment is not crypto order data', () => {
      const transaction = {
        externalCanonicalId: 'order-notcrypto',
        type: 'CRYPTO_BUY',
        subType: 'MARKET_ORDER',
        assetSymbol: 'BTC',
        amount: 100,
        currency: 'CAD',
      };

      const enrichmentMap = new Map();
      enrichmentMap.set('order-notcrypto', {
        // No isCryptoOrderData marker
        orderType: 'BUY',
        submittedQuantity: 1,
      });

      const rule = INVESTMENT_BUY_SELL_TRANSACTION_RULES.find((r) => r.id === 'crypto-buy');
      const result = rule.process(transaction, enrichmentMap);

      expect(result.notes).toBe('Buy BTC\nTotal CAD$100');
    });
  });

  describe('CRYPTO_SWAP rule', () => {
    it('should match CRYPTO_BUY with subType SWAP_MARKET_ORDER', () => {
      const rule = INVESTMENT_BUY_SELL_TRANSACTION_RULES.find((r) => r.id === 'crypto-swap');
      expect(rule.match({ type: 'CRYPTO_BUY', subType: 'SWAP_MARKET_ORDER' })).toBe(true);
    });

    it('should not match CRYPTO_BUY with subType MARKET_ORDER', () => {
      const rule = INVESTMENT_BUY_SELL_TRANSACTION_RULES.find((r) => r.id === 'crypto-swap');
      expect(rule.match({ type: 'CRYPTO_BUY', subType: 'MARKET_ORDER' })).toBe(false);
    });

    it('should not match CRYPTO_BUY with null subType', () => {
      const rule = INVESTMENT_BUY_SELL_TRANSACTION_RULES.find((r) => r.id === 'crypto-swap');
      expect(rule.match({ type: 'CRYPTO_BUY', subType: null })).toBe(false);
    });

    it('should not match CRYPTO_SELL with subType SWAP_MARKET_ORDER', () => {
      const rule = INVESTMENT_BUY_SELL_TRANSACTION_RULES.find((r) => r.id === 'crypto-swap');
      expect(rule.match({ type: 'CRYPTO_SELL', subType: 'SWAP_MARKET_ORDER' })).toBe(false);
    });

    it('should not match DIY_BUY', () => {
      const rule = INVESTMENT_BUY_SELL_TRANSACTION_RULES.find((r) => r.id === 'crypto-swap');
      expect(rule.match({ type: 'DIY_BUY', subType: 'SWAP_MARKET_ORDER' })).toBe(false);
    });

    it('should appear before crypto-buy in rule order', () => {
      const swapIndex = INVESTMENT_BUY_SELL_TRANSACTION_RULES.findIndex((r) => r.id === 'crypto-swap');
      const buyIndex = INVESTMENT_BUY_SELL_TRANSACTION_RULES.findIndex((r) => r.id === 'crypto-buy');
      expect(swapIndex).toBeLessThan(buyIndex);
    });

    it('should process swap transaction with correct category and merchant', () => {
      const transaction = {
        externalCanonicalId: 'order-swap123',
        type: 'CRYPTO_BUY',
        subType: 'SWAP_MARKET_ORDER',
        assetSymbol: 'BTC',
        counterAssetSymbol: 'ETH',
        assetQuantity: 0.003605,
        amount: 10.11,
        currency: 'CAD',
      };

      const rule = INVESTMENT_BUY_SELL_TRANSACTION_RULES.find((r) => r.id === 'crypto-swap');
      const result = rule.process(transaction, null);

      expect(result.category).toBe('Swap');
      expect(result.merchant).toBe('BTC -> ETH');
      expect(result.originalStatement).toBe('CRYPTO_BUY:SWAP_MARKET_ORDER:BTC:ETH');
      expect(result.notes).toBe('Swapped BTC for ETH');
      expect(result.technicalDetails).toBe('');
    });

    it('should process swap transaction with enrichment data', () => {
      const transaction = {
        externalCanonicalId: 'order-swap456',
        type: 'CRYPTO_BUY',
        subType: 'SWAP_MARKET_ORDER',
        assetSymbol: 'BTC',
        counterAssetSymbol: 'ETH',
        assetQuantity: 0.003605,
        amount: 10.11,
        currency: 'CAD',
      };

      const enrichmentMap = new Map();
      enrichmentMap.set('order-swap456', {
        isCryptoOrderData: true,
        quantity: '0.00360523',
        executedQuantity: '0.00360523',
        executedValue: '0.00010745',
        price: '2793.1643750884',
        currency: 'CAD',
        limitPrice: null,
        fee: '0.04',
        swapFee: '0.00000053',
        totalCost: '10.11',
      });

      const rule = INVESTMENT_BUY_SELL_TRANSACTION_RULES.find((r) => r.id === 'crypto-swap');
      const result = rule.process(transaction, enrichmentMap);

      expect(result.category).toBe('Swap');
      expect(result.merchant).toBe('BTC -> ETH');
      expect(result.notes).toContain('Swapped 0.00010745 BTC for 0.003605 ETH');
      expect(result.notes).toContain('Fees:');
      expect(result.notes).toContain('fee: CAD$0.04');
    });

    it('should handle missing assetSymbol and counterAssetSymbol', () => {
      const transaction = {
        externalCanonicalId: 'order-swap-missing',
        type: 'CRYPTO_BUY',
        subType: 'SWAP_MARKET_ORDER',
        assetSymbol: null,
        counterAssetSymbol: null,
        amount: 5,
        currency: 'CAD',
      };

      const rule = INVESTMENT_BUY_SELL_TRANSACTION_RULES.find((r) => r.id === 'crypto-swap');
      const result = rule.process(transaction, null);

      expect(result.category).toBe('Swap');
      expect(result.merchant).toBe('Unknown -> Unknown');
      expect(result.notes).toBe('Swapped Unknown for Unknown');
    });

    it('should fall back to minimal notes when enrichment is not crypto order data', () => {
      const transaction = {
        externalCanonicalId: 'order-swap-notcrypto',
        type: 'CRYPTO_BUY',
        subType: 'SWAP_MARKET_ORDER',
        assetSymbol: 'SOL',
        counterAssetSymbol: 'BTC',
        assetQuantity: 1.5,
        amount: 100,
        currency: 'CAD',
      };

      const enrichmentMap = new Map();
      enrichmentMap.set('order-swap-notcrypto', {
        // No isCryptoOrderData marker
        orderType: 'BUY',
      });

      const rule = INVESTMENT_BUY_SELL_TRANSACTION_RULES.find((r) => r.id === 'crypto-swap');
      const result = rule.process(transaction, enrichmentMap);

      expect(result.notes).toBe('Swapped SOL for BTC');
    });
  });

  describe('formatCryptoSwapNotes', () => {
    it('should return empty string for null activity', () => {
      expect(formatCryptoSwapNotes(null, null)).toBe('');
    });

    it('should return empty string for undefined activity', () => {
      expect(formatCryptoSwapNotes(undefined, null)).toBe('');
    });

    it('should return minimal notes without crypto order data', () => {
      const activity = {
        type: 'CRYPTO_BUY',
        subType: 'SWAP_MARKET_ORDER',
        assetSymbol: 'BTC',
        counterAssetSymbol: 'ETH',
        assetQuantity: 0.003605,
        amount: 10.11,
        currency: 'CAD',
      };

      const result = formatCryptoSwapNotes(activity, null);
      expect(result).toBe('Swapped BTC for ETH');
    });

    it('should format swap notes with full crypto order data', () => {
      const activity = {
        type: 'CRYPTO_BUY',
        subType: 'SWAP_MARKET_ORDER',
        assetSymbol: 'BTC',
        counterAssetSymbol: 'ETH',
        assetQuantity: 0.003605,
        amount: 10.11,
        currency: 'CAD',
      };
      const cryptoOrder = {
        quantity: '0.00360523',
        executedQuantity: '0.00360523',
        executedValue: '0.00010745',
        price: '2793.1643750884',
        currency: 'CAD',
        limitPrice: null,
        fee: '0.04',
        swapFee: '0.00000053',
        totalCost: '10.11',
      };

      const result = formatCryptoSwapNotes(activity, cryptoOrder);

      expect(result).toContain('Swapped 0.00010745 BTC for 0.003605 ETH');
      expect(result).toContain('Fees: CAD$');
      expect(result).toContain('fee: CAD$0.04');
      expect(result).toContain('swap: CAD$');
    });

    it('should handle missing symbols with Unknown fallback', () => {
      const activity = {
        type: 'CRYPTO_BUY',
        subType: 'SWAP_MARKET_ORDER',
        assetSymbol: null,
        counterAssetSymbol: null,
        assetQuantity: null,
        amount: 0,
        currency: null,
      };

      const result = formatCryptoSwapNotes(activity, null);
      expect(result).toBe('Swapped Unknown for Unknown');
    });

    it('should handle missing fields with defaults when crypto order provided', () => {
      const activity = {
        type: 'CRYPTO_BUY',
        subType: 'SWAP_MARKET_ORDER',
        assetSymbol: null,
        counterAssetSymbol: null,
        assetQuantity: null,
        amount: 0,
        currency: null,
      };
      const cryptoOrder = {
        quantity: null,
        fee: null,
        swapFee: null,
        currency: null,
      };

      const result = formatCryptoSwapNotes(activity, cryptoOrder);

      expect(result).toContain('Swapped 0 Unknown for 0 Unknown');
      expect(result).toContain('Fees: CAD$0');
    });

    it('should use crypto order currency over activity currency', () => {
      const activity = {
        type: 'CRYPTO_BUY',
        subType: 'SWAP_MARKET_ORDER',
        assetSymbol: 'SOL',
        counterAssetSymbol: 'BTC',
        assetQuantity: 5.0,
        amount: 100,
        currency: 'USD',
      };
      const cryptoOrder = {
        quantity: '0.001',
        currency: 'CAD',
        fee: '0.05',
        swapFee: '0.01',
      };

      const result = formatCryptoSwapNotes(activity, cryptoOrder);

      expect(result).toContain('CAD$');
      expect(result).not.toContain('USD$');
    });
  });

  describe('CRYPTO_BUY rule should not match SWAP_MARKET_ORDER', () => {
    it('should not match SWAP_MARKET_ORDER because crypto-swap comes first', () => {
      // Verify that when iterating rules in order, crypto-swap matches first
      const swapTx = { type: 'CRYPTO_BUY', subType: 'SWAP_MARKET_ORDER' };
      const swapRule = INVESTMENT_BUY_SELL_TRANSACTION_RULES.find((r) => r.id === 'crypto-swap');
      const buyRule = INVESTMENT_BUY_SELL_TRANSACTION_RULES.find((r) => r.id === 'crypto-buy');

      // Both rules would technically match, but crypto-swap is first
      expect(swapRule.match(swapTx)).toBe(true);
      expect(buyRule.match(swapTx)).toBe(true); // Would also match, but rule order prevents this

      // Find the FIRST matching rule (simulating the rules engine behavior)
      const firstMatchingRule = INVESTMENT_BUY_SELL_TRANSACTION_RULES.find((r) => r.match(swapTx));
      expect(firstMatchingRule.id).toBe('crypto-swap');
    });

    it('should still match regular CRYPTO_BUY with MARKET_ORDER subType', () => {
      const regularTx = { type: 'CRYPTO_BUY', subType: 'MARKET_ORDER' };
      const firstMatchingRule = INVESTMENT_BUY_SELL_TRANSACTION_RULES.find((r) => r.match(regularTx));
      expect(firstMatchingRule.id).toBe('crypto-buy');
    });
  });

  describe('OPTIONS_SHORT_EXPIRY rule', () => {
    it('should match transactions with type OPTIONS_SHORT_EXPIRY', () => {
      const rule = INVESTMENT_BUY_SELL_TRANSACTION_RULES.find((r) => r.id === 'options-short-expiry');
      expect(rule.match({ type: 'OPTIONS_SHORT_EXPIRY' })).toBe(true);
    });

    it('should not match other transaction types', () => {
      const rule = INVESTMENT_BUY_SELL_TRANSACTION_RULES.find((r) => r.id === 'options-short-expiry');
      expect(rule.match({ type: 'OPTIONS_SELL' })).toBe(false);
      expect(rule.match({ type: 'OPTIONS_BUY' })).toBe(false);
    });

    it('should process OPTIONS_SHORT_EXPIRY with all fields', () => {
      const transaction = {
        externalCanonicalId: 'oe-abc123',
        type: 'OPTIONS_SHORT_EXPIRY',
        subType: null,
        assetSymbol: 'PSNY',
        expiryDate: '2026-01-16',
        strikePrice: 1,
        contractType: 'CALL',
        currency: 'USD',
        amount: null,
      };

      const enrichmentMap = new Map();
      enrichmentMap.set('oe-abc123', {
        expiryDetail: { decision: 'EXPIRE', reason: 'OUT_OF_THE_MONEY', deliverables: [] },
        securityCache: new Map(),
      });

      const rule = INVESTMENT_BUY_SELL_TRANSACTION_RULES.find((r) => r.id === 'options-short-expiry');
      const result = rule.process(transaction, enrichmentMap);

      expect(result.category).toBe('Options Expired');
      expect(result.merchant).toBe('PSNY Jan 16, 2026 USD$1 Call');
      expect(result.originalStatement).toBe('OPTIONS_SHORT_EXPIRY::PSNY:2026-01-16:1:CALL');
      expect(result.notes).toContain('Decision: EXPIRE');
    });

    it('should handle null amount (expired worthless)', () => {
      const transaction = {
        externalCanonicalId: 'oe-worthless',
        type: 'OPTIONS_SHORT_EXPIRY',
        assetSymbol: 'TEST',
        expiryDate: '2026-02-20',
        strikePrice: 50,
        contractType: 'PUT',
        currency: 'CAD',
        amount: null,
      };

      const rule = INVESTMENT_BUY_SELL_TRANSACTION_RULES.find((r) => r.id === 'options-short-expiry');
      const result = rule.process(transaction, null);

      expect(result.category).toBe('Options Expired');
      expect(result.merchant).toBe('TEST Feb 20, 2026 CAD$50 Put');
    });
  });
});
