/**
 * Tests for Wealthsimple Transaction Rules Engine - Investment Interest & Options Rules
 *
 * Covers: INVESTMENT_INTEREST_TRANSACTION_RULES, formatPrettyDate,
 * formatOptionsOrderNotes, INVESTMENT_BUY_SELL_TRANSACTION_RULES (OPTIONS),
 * formatTransferNotes
 */

import {
  INVESTMENT_INTEREST_TRANSACTION_RULES,
  INVESTMENT_BUY_SELL_TRANSACTION_RULES,
  formatPrettyDate,
  formatOptionsOrderNotes,
  formatTransferNotes,
} from '../../../src/services/wealthsimple/transactionRules';

describe('Wealthsimple Transaction Rules Engine - Investment Interest & Options', () => {
  describe('INVESTMENT_INTEREST_TRANSACTION_RULES', () => {
    describe('FPL_INTEREST rule matching', () => {
      it('should match transactions with type INTEREST and subType FPL_INTEREST', () => {
        const transaction = {
          externalCanonicalId: 'fpl-interest-123',
          type: 'INTEREST',
          subType: 'FPL_INTEREST',
          amount: 2.50,
          currency: 'CAD',
        };

        const rule = INVESTMENT_INTEREST_TRANSACTION_RULES.find((r) => r.id === 'fpl-interest');
        expect(rule.match(transaction)).toBe(true);
      });

      it('should not match INTEREST with different subType', () => {
        const rule = INVESTMENT_INTEREST_TRANSACTION_RULES.find((r) => r.id === 'fpl-interest');

        expect(rule.match({ type: 'INTEREST', subType: 'SAVINGS_INTEREST' })).toBe(false);
        expect(rule.match({ type: 'INTEREST', subType: null })).toBe(false);
        expect(rule.match({ type: 'INTEREST', subType: undefined })).toBe(false);
      });

      it('should not match FPL_INTEREST with different type', () => {
        const rule = INVESTMENT_INTEREST_TRANSACTION_RULES.find((r) => r.id === 'fpl-interest');

        expect(rule.match({ type: 'DEPOSIT', subType: 'FPL_INTEREST' })).toBe(false);
        expect(rule.match({ type: 'DIVIDEND', subType: 'FPL_INTEREST' })).toBe(false);
      });
    });

    describe('FPL_INTEREST transaction processing', () => {
      it('should process INTEREST/FPL_INTEREST with CAD currency correctly', () => {
        const transaction = {
          externalCanonicalId: 'fpl-interest-cad',
          type: 'INTEREST',
          subType: 'FPL_INTEREST',
          amount: 5.25,
          currency: 'CAD',
        };

        const rule = INVESTMENT_INTEREST_TRANSACTION_RULES.find((r) => r.id === 'fpl-interest');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Stock Lending');
        expect(result.merchant).toBe('Stock Lending Earnings (CAD)');
        expect(result.originalStatement).toBe('INTEREST:FPL_INTEREST:CAD');
        expect(result.notes).toBe('');
        expect(result.technicalDetails).toBe('');
      });

      it('should process INTEREST/FPL_INTEREST with USD currency correctly', () => {
        const transaction = {
          externalCanonicalId: 'fpl-interest-usd',
          type: 'INTEREST',
          subType: 'FPL_INTEREST',
          amount: 3.75,
          currency: 'USD',
        };

        const rule = INVESTMENT_INTEREST_TRANSACTION_RULES.find((r) => r.id === 'fpl-interest');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Stock Lending');
        expect(result.merchant).toBe('Stock Lending Earnings (USD)');
        expect(result.originalStatement).toBe('INTEREST:FPL_INTEREST:USD');
      });

      it('should handle missing currency with CAD fallback', () => {
        const transaction = {
          externalCanonicalId: 'fpl-interest-no-currency',
          type: 'INTEREST',
          subType: 'FPL_INTEREST',
          amount: 2.00,
          currency: null,
        };

        const rule = INVESTMENT_INTEREST_TRANSACTION_RULES.find((r) => r.id === 'fpl-interest');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.merchant).toBe('Stock Lending Earnings (CAD)');
        expect(result.originalStatement).toBe('INTEREST:FPL_INTEREST:CAD');
      });

      it('should handle undefined currency with CAD fallback', () => {
        const transaction = {
          externalCanonicalId: 'fpl-interest-undef-currency',
          type: 'INTEREST',
          subType: 'FPL_INTEREST',
          amount: 1.50,
        };

        const rule = INVESTMENT_INTEREST_TRANSACTION_RULES.find((r) => r.id === 'fpl-interest');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.merchant).toBe('Stock Lending Earnings (CAD)');
        expect(result.originalStatement).toBe('INTEREST:FPL_INTEREST:CAD');
      });

      it('should not set needsCategoryMapping flag (auto-categorized)', () => {
        const transaction = {
          externalCanonicalId: 'fpl-interest-no-mapping',
          type: 'INTEREST',
          subType: 'FPL_INTEREST',
          currency: 'CAD',
        };

        const rule = INVESTMENT_INTEREST_TRANSACTION_RULES.find((r) => r.id === 'fpl-interest');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.needsCategoryMapping).toBeUndefined();
      });

      it('should have empty notes and technicalDetails', () => {
        const transaction = {
          externalCanonicalId: 'fpl-interest-notes',
          type: 'INTEREST',
          subType: 'FPL_INTEREST',
          currency: 'CAD',
        };

        const rule = INVESTMENT_INTEREST_TRANSACTION_RULES.find((r) => r.id === 'fpl-interest');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.notes).toBe('');
        expect(result.technicalDetails).toBe('');
      });
    });

    describe('Generic INTEREST rule matching', () => {
      it('should match transactions with type INTEREST and any non-FPL subType', () => {
        const rule = INVESTMENT_INTEREST_TRANSACTION_RULES.find((r) => r.id === 'interest');

        expect(rule.match({ type: 'INTEREST', subType: 'SAVINGS_INTEREST' })).toBe(true);
        expect(rule.match({ type: 'INTEREST', subType: 'PROMO_INTEREST' })).toBe(true);
        expect(rule.match({ type: 'INTEREST', subType: null })).toBe(true);
        expect(rule.match({ type: 'INTEREST', subType: undefined })).toBe(true);
      });

      it('should also match FPL_INTEREST (but fpl-interest rule should be first)', () => {
        const rule = INVESTMENT_INTEREST_TRANSACTION_RULES.find((r) => r.id === 'interest');
        // The generic rule matches any INTEREST type
        expect(rule.match({ type: 'INTEREST', subType: 'FPL_INTEREST' })).toBe(true);
      });

      it('should not match transactions with different type', () => {
        const rule = INVESTMENT_INTEREST_TRANSACTION_RULES.find((r) => r.id === 'interest');

        expect(rule.match({ type: 'DEPOSIT', subType: 'INTEREST' })).toBe(false);
        expect(rule.match({ type: 'DIVIDEND', subType: 'SAVINGS_INTEREST' })).toBe(false);
        expect(rule.match({ type: 'MANAGED_BUY', subType: null })).toBe(false);
      });
    });

    describe('Generic INTEREST transaction processing', () => {
      it('should process INTEREST with SAVINGS_INTEREST subType correctly', () => {
        const transaction = {
          externalCanonicalId: 'interest-savings-123',
          type: 'INTEREST',
          subType: 'SAVINGS_INTEREST',
          amount: 10.00,
          currency: 'CAD',
        };

        const rule = INVESTMENT_INTEREST_TRANSACTION_RULES.find((r) => r.id === 'interest');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Interest');
        expect(result.merchant).toBe('Savings interest (CAD)');
        expect(result.originalStatement).toBe('INTEREST:SAVINGS_INTEREST:CAD');
        expect(result.notes).toBe('');
        expect(result.technicalDetails).toBe('');
      });

      it('should process INTEREST with PROMO_INTEREST subType correctly', () => {
        const transaction = {
          externalCanonicalId: 'interest-promo-123',
          type: 'INTEREST',
          subType: 'PROMO_INTEREST',
          amount: 25.00,
          currency: 'CAD',
        };

        const rule = INVESTMENT_INTEREST_TRANSACTION_RULES.find((r) => r.id === 'interest');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Interest');
        expect(result.merchant).toBe('Promo interest (CAD)');
        expect(result.originalStatement).toBe('INTEREST:PROMO_INTEREST:CAD');
      });

      it('should handle null subType with Interest fallback', () => {
        const transaction = {
          externalCanonicalId: 'interest-null-subtype',
          type: 'INTEREST',
          subType: null,
          amount: 5.00,
          currency: 'CAD',
        };

        const rule = INVESTMENT_INTEREST_TRANSACTION_RULES.find((r) => r.id === 'interest');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Interest');
        expect(result.merchant).toBe('Interest (CAD)');
        expect(result.originalStatement).toBe('INTEREST::CAD');
      });

      it('should handle undefined subType with Interest fallback', () => {
        const transaction = {
          externalCanonicalId: 'interest-undef-subtype',
          type: 'INTEREST',
          amount: 3.00,
          currency: 'CAD',
        };

        const rule = INVESTMENT_INTEREST_TRANSACTION_RULES.find((r) => r.id === 'interest');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Interest');
        expect(result.merchant).toBe('Interest (CAD)');
        expect(result.originalStatement).toBe('INTEREST::CAD');
      });

      it('should handle empty string subType with Interest fallback', () => {
        const transaction = {
          externalCanonicalId: 'interest-empty-subtype',
          type: 'INTEREST',
          subType: '',
          amount: 4.00,
          currency: 'CAD',
        };

        const rule = INVESTMENT_INTEREST_TRANSACTION_RULES.find((r) => r.id === 'interest');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Interest');
        expect(result.merchant).toBe('Interest (CAD)');
        expect(result.originalStatement).toBe('INTEREST::CAD');
      });

      it('should handle USD currency', () => {
        const transaction = {
          externalCanonicalId: 'interest-usd',
          type: 'INTEREST',
          subType: 'SAVINGS_INTEREST',
          amount: 15.00,
          currency: 'USD',
        };

        const rule = INVESTMENT_INTEREST_TRANSACTION_RULES.find((r) => r.id === 'interest');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.merchant).toBe('Savings interest (USD)');
        expect(result.originalStatement).toBe('INTEREST:SAVINGS_INTEREST:USD');
      });

      it('should handle missing currency with CAD fallback', () => {
        const transaction = {
          externalCanonicalId: 'interest-no-currency',
          type: 'INTEREST',
          subType: 'PROMO_INTEREST',
          amount: 8.00,
          currency: null,
        };

        const rule = INVESTMENT_INTEREST_TRANSACTION_RULES.find((r) => r.id === 'interest');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.merchant).toBe('Promo interest (CAD)');
        expect(result.originalStatement).toBe('INTEREST:PROMO_INTEREST:CAD');
      });

      it('should handle undefined currency with CAD fallback', () => {
        const transaction = {
          externalCanonicalId: 'interest-undef-currency',
          type: 'INTEREST',
          subType: 'SAVINGS_INTEREST',
          amount: 6.00,
        };

        const rule = INVESTMENT_INTEREST_TRANSACTION_RULES.find((r) => r.id === 'interest');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.merchant).toBe('Savings interest (CAD)');
        expect(result.originalStatement).toBe('INTEREST:SAVINGS_INTEREST:CAD');
      });

      it('should not set needsCategoryMapping flag (auto-categorized)', () => {
        const transaction = {
          externalCanonicalId: 'interest-no-mapping',
          type: 'INTEREST',
          subType: 'SAVINGS_INTEREST',
          currency: 'CAD',
        };

        const rule = INVESTMENT_INTEREST_TRANSACTION_RULES.find((r) => r.id === 'interest');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.needsCategoryMapping).toBeUndefined();
      });

      it('should have empty notes and technicalDetails', () => {
        const transaction = {
          externalCanonicalId: 'interest-notes',
          type: 'INTEREST',
          subType: 'PROMO_INTEREST',
          currency: 'CAD',
        };

        const rule = INVESTMENT_INTEREST_TRANSACTION_RULES.find((r) => r.id === 'interest');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.notes).toBe('');
        expect(result.technicalDetails).toBe('');
      });
    });

    describe('Rule ordering', () => {
      it('should have FPL_INTEREST rule before generic INTEREST rule', () => {
        const fplIndex = INVESTMENT_INTEREST_TRANSACTION_RULES.findIndex((r) => r.id === 'fpl-interest');
        const genericIndex = INVESTMENT_INTEREST_TRANSACTION_RULES.findIndex((r) => r.id === 'interest');

        expect(fplIndex).toBeLessThan(genericIndex);
      });

      it('should match FPL_INTEREST rule first for FPL_INTEREST transactions', () => {
        const transaction = {
          type: 'INTEREST',
          subType: 'FPL_INTEREST',
          currency: 'CAD',
        };

        // Simulate the rules engine by iterating through rules in order
        let matchedRule = null;
        for (const rule of INVESTMENT_INTEREST_TRANSACTION_RULES) {
          if (rule.match(transaction)) {
            matchedRule = rule;
            break;
          }
        }

        expect(matchedRule).not.toBeNull();
        expect(matchedRule.id).toBe('fpl-interest');
      });

      it('should match generic INTEREST rule for non-FPL INTEREST transactions', () => {
        const transaction = {
          type: 'INTEREST',
          subType: 'SAVINGS_INTEREST',
          currency: 'CAD',
        };

        // Simulate the rules engine by iterating through rules in order
        let matchedRule = null;
        for (const rule of INVESTMENT_INTEREST_TRANSACTION_RULES) {
          if (rule.match(transaction)) {
            matchedRule = rule;
            break;
          }
        }

        expect(matchedRule).not.toBeNull();
        expect(matchedRule.id).toBe('interest');
      });
    });

    describe('Rule structure', () => {
      it('should have all required properties for each rule', () => {
        INVESTMENT_INTEREST_TRANSACTION_RULES.forEach((rule) => {
          expect(rule).toHaveProperty('id');
          expect(rule).toHaveProperty('description');
          expect(rule).toHaveProperty('match');
          expect(rule).toHaveProperty('process');
          expect(typeof rule.id).toBe('string');
          expect(typeof rule.description).toBe('string');
          expect(typeof rule.match).toBe('function');
          expect(typeof rule.process).toBe('function');
        });
      });

      it('should have unique rule IDs', () => {
        const ids = INVESTMENT_INTEREST_TRANSACTION_RULES.map((r) => r.id);
        const uniqueIds = [...new Set(ids)];
        expect(ids.length).toBe(uniqueIds.length);
      });

      it('should have exactly 2 rules', () => {
        expect(INVESTMENT_INTEREST_TRANSACTION_RULES.length).toBe(2);
      });
    });
  });

  describe('formatPrettyDate', () => {
    it('should format date from YYYY-MM-DD to "Mon DD, YYYY" format', () => {
      expect(formatPrettyDate('2026-01-16')).toBe('Jan 16, 2026');
    });

    it('should format various months correctly', () => {
      expect(formatPrettyDate('2026-06-15')).toBe('Jun 15, 2026');
      expect(formatPrettyDate('2026-12-25')).toBe('Dec 25, 2026');
      expect(formatPrettyDate('2026-03-01')).toBe('Mar 1, 2026');
    });

    it('should return empty string for null input', () => {
      expect(formatPrettyDate(null)).toBe('');
    });

    it('should return empty string for undefined input', () => {
      expect(formatPrettyDate(undefined)).toBe('');
    });

    it('should return empty string for empty string input', () => {
      expect(formatPrettyDate('')).toBe('');
    });

    it('should return empty string for invalid date format', () => {
      expect(formatPrettyDate('invalid')).toBe('');
      expect(formatPrettyDate('2026/01/16')).toBe('');
      expect(formatPrettyDate('not-a-date')).toBe('');
    });
  });

  describe('formatOptionsOrderNotes', () => {
    it('should format OPTIONS_BUY LIMIT_ORDER notes correctly', () => {
      const activity = {
        currency: 'CAD',
        assetSymbol: 'AAPL',
        assetQuantity: 5,
        strikePrice: 200,
        contractType: 'CALL',
        expiryDate: '2026-01-16',
        amount: 1250,
        subType: 'LIMIT_ORDER',
      };
      const extendedOrder = {
        optionMultiplier: 100,
        filledQuantity: 5,
        averageFilledPrice: 2.45,
        filledTotalFee: 4.95,
        timeInForce: 'GTC',
        limitPrice: 2.50,
      };

      const result = formatOptionsOrderNotes(activity, extendedOrder, false);

      expect(result).toBe('Limit Buy 5 AAPL 200 CALL contracts (100 share lots at CAD$2.5 per share) with expiry date 2026-01-16 (Gtc order)\nFilled 5 contracts at CAD$2.45, fees: CAD$4.95\nTotal CAD$1250');
    });

    it('should format OPTIONS_SELL LIMIT_ORDER notes correctly', () => {
      const activity = {
        currency: 'CAD',
        assetSymbol: 'AAPL',
        assetQuantity: 10,
        strikePrice: 150,
        contractType: 'PUT',
        expiryDate: '2026-02-20',
        amount: 2500,
        subType: 'LIMIT_ORDER',
      };
      const extendedOrder = {
        optionMultiplier: 100,
        filledQuantity: 10,
        averageFilledPrice: 2.50,
        filledTotalFee: 9.95,
        timeInForce: 'DAY',
        limitPrice: 2.55,
      };

      const result = formatOptionsOrderNotes(activity, extendedOrder, true);

      expect(result).toBe('Limit Sell 10 AAPL 150 PUT contracts (100 share lots at CAD$2.55 per share) with expiry date 2026-02-20 (Day order)\nFilled 10 contracts at CAD$2.5, fees: CAD$9.95\nTotal CAD$2500');
    });

    it('should format OPTIONS_BUY MARKET_ORDER notes correctly', () => {
      const activity = {
        currency: 'USD',
        assetSymbol: 'MSFT',
        assetQuantity: 2,
        strikePrice: 400,
        contractType: 'CALL',
        expiryDate: '2026-03-21',
        amount: 500,
        subType: 'MARKET_ORDER',
      };
      const extendedOrder = {
        optionMultiplier: 100,
        filledQuantity: 2,
        averageFilledPrice: 2.50,
        filledTotalFee: 1.95,
        timeInForce: 'GTC',
      };

      const result = formatOptionsOrderNotes(activity, extendedOrder, false);

      expect(result).toBe('Market order: Buy 2 MSFT 400 CALL contracts (100 share lots) with expiry date 2026-03-21 (Gtc order)\nFilled 2 contracts at USD$2.5, fees: USD$1.95\nTotal USD$500');
    });

    it('should format OPTIONS_SELL MARKET_ORDER notes correctly', () => {
      const activity = {
        currency: 'USD',
        assetSymbol: 'TSLA',
        assetQuantity: 1,
        strikePrice: 250,
        contractType: 'PUT',
        expiryDate: '2026-04-17',
        amount: 150,
        subType: 'MARKET_ORDER',
      };
      const extendedOrder = {
        optionMultiplier: 100,
        filledQuantity: 1,
        averageFilledPrice: 1.50,
        filledTotalFee: 0.95,
        timeInForce: 'DAY',
      };

      const result = formatOptionsOrderNotes(activity, extendedOrder, true);

      expect(result).toBe('Market order: Sell 1 TSLA 250 PUT contracts (100 share lots) with expiry date 2026-04-17 (Day order)\nFilled 1 contracts at USD$1.5, fees: USD$0.95\nTotal USD$150');
    });

    it('should return minimal notes when extendedOrder is null', () => {
      const activity = {
        currency: 'CAD',
        assetSymbol: 'AAPL',
        amount: 500,
        subType: 'LIMIT_ORDER',
      };

      const result = formatOptionsOrderNotes(activity, null, false);

      expect(result).toBe('Limit order AAPL\nTotal CAD$500');
    });

    it('should return empty string for null activity', () => {
      expect(formatOptionsOrderNotes(null, null, false)).toBe('');
    });

    it('should handle missing fields with defaults', () => {
      const activity = {
        type: 'OPTIONS_BUY',
        subType: 'LIMIT_ORDER',
      };
      const extendedOrder = {
        optionMultiplier: 100,
      };

      const result = formatOptionsOrderNotes(activity, extendedOrder, false);

      expect(result).toContain('Limit Buy');
      expect(result).toContain('N/A');
      expect(result).toContain('CAD$');
    });
  });

  describe('INVESTMENT_BUY_SELL_TRANSACTION_RULES - OPTIONS', () => {
    describe('OPTIONS_BUY rule matching', () => {
      it('should match transactions with type OPTIONS_BUY', () => {
        const transaction = {
          externalCanonicalId: 'order-123',
          type: 'OPTIONS_BUY',
          subType: 'LIMIT_ORDER',
          assetSymbol: 'AAPL',
          strikePrice: 200,
          contractType: 'CALL',
          expiryDate: '2026-01-16',
        };

        const rule = INVESTMENT_BUY_SELL_TRANSACTION_RULES.find((r) => r.id === 'options-buy');
        expect(rule.match(transaction)).toBe(true);
      });

      it('should not match transactions with different type', () => {
        const rule = INVESTMENT_BUY_SELL_TRANSACTION_RULES.find((r) => r.id === 'options-buy');

        expect(rule.match({ type: 'DIY_BUY', subType: 'LIMIT_ORDER' })).toBe(false);
        expect(rule.match({ type: 'OPTIONS_SELL', subType: 'LIMIT_ORDER' })).toBe(false);
        expect(rule.match({ type: 'MANAGED_BUY', subType: null })).toBe(false);
      });
    });

    describe('OPTIONS_BUY transaction processing', () => {
      it('should process OPTIONS_BUY with all fields correctly', () => {
        const transaction = {
          externalCanonicalId: 'order-buy-123',
          type: 'OPTIONS_BUY',
          subType: 'LIMIT_ORDER',
          assetSymbol: 'AAPL',
          strikePrice: 200,
          contractType: 'CALL',
          expiryDate: '2026-01-16',
          currency: 'CAD',
          assetQuantity: 5,
          amount: 1250,
        };

        const extendedOrderMap = new Map();
        extendedOrderMap.set('order-buy-123', {
          optionMultiplier: 100,
          filledQuantity: 5,
          averageFilledPrice: 2.45,
          filledTotalFee: 4.95,
          timeInForce: 'GTC',
          limitPrice: 2.50,
        });

        const rule = INVESTMENT_BUY_SELL_TRANSACTION_RULES.find((r) => r.id === 'options-buy');
        const result = rule.process(transaction, extendedOrderMap);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Buy');
        expect(result.merchant).toBe('AAPL Jan 16, 2026 CAD$200 Call');
        expect(result.originalStatement).toBe('OPTIONS_BUY:LIMIT_ORDER:AAPL:2026-01-16:200:CALL');
        expect(result.notes).toContain('Limit Buy');
        expect(result.notes).toContain('5 AAPL');
      });

      it('should handle missing extended order data', () => {
        const transaction = {
          externalCanonicalId: 'order-buy-no-ext',
          type: 'OPTIONS_BUY',
          subType: 'MARKET_ORDER',
          assetSymbol: 'MSFT',
          strikePrice: 400,
          contractType: 'PUT',
          expiryDate: '2026-06-20',
          currency: 'USD',
        };

        const rule = INVESTMENT_BUY_SELL_TRANSACTION_RULES.find((r) => r.id === 'options-buy');
        const result = rule.process(transaction, new Map());

        expect(result).not.toBeNull();
        expect(result.category).toBe('Buy');
        expect(result.merchant).toBe('MSFT Jun 20, 2026 USD$400 Put');
        expect(result.originalStatement).toBe('OPTIONS_BUY:MARKET_ORDER:MSFT:2026-06-20:400:PUT');
      });

      it('should handle missing fields with defaults', () => {
        const transaction = {
          externalCanonicalId: 'order-buy-minimal',
          type: 'OPTIONS_BUY',
          subType: 'LIMIT_ORDER',
        };

        const rule = INVESTMENT_BUY_SELL_TRANSACTION_RULES.find((r) => r.id === 'options-buy');
        const result = rule.process(transaction, null);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Buy');
        expect(result.merchant).toContain('Unknown');
        expect(result.merchant).toContain('CAD$0');
      });
    });

    describe('OPTIONS_SELL rule matching', () => {
      it('should match transactions with type OPTIONS_SELL', () => {
        const transaction = {
          externalCanonicalId: 'order-456',
          type: 'OPTIONS_SELL',
          subType: 'LIMIT_ORDER',
          assetSymbol: 'AAPL',
          strikePrice: 200,
          contractType: 'CALL',
          expiryDate: '2026-01-16',
        };

        const rule = INVESTMENT_BUY_SELL_TRANSACTION_RULES.find((r) => r.id === 'options-sell');
        expect(rule.match(transaction)).toBe(true);
      });

      it('should not match transactions with different type', () => {
        const rule = INVESTMENT_BUY_SELL_TRANSACTION_RULES.find((r) => r.id === 'options-sell');

        expect(rule.match({ type: 'DIY_SELL', subType: 'LIMIT_ORDER' })).toBe(false);
        expect(rule.match({ type: 'OPTIONS_BUY', subType: 'LIMIT_ORDER' })).toBe(false);
        expect(rule.match({ type: 'MANAGED_SELL', subType: null })).toBe(false);
      });
    });

    describe('OPTIONS_SELL transaction processing', () => {
      it('should process OPTIONS_SELL with all fields correctly', () => {
        const transaction = {
          externalCanonicalId: 'order-sell-123',
          type: 'OPTIONS_SELL',
          subType: 'LIMIT_ORDER',
          assetSymbol: 'TSLA',
          strikePrice: 250,
          contractType: 'PUT',
          expiryDate: '2026-03-21',
          currency: 'USD',
          assetQuantity: 10,
          amount: 2500,
        };

        const extendedOrderMap = new Map();
        extendedOrderMap.set('order-sell-123', {
          optionMultiplier: 100,
          filledQuantity: 10,
          averageFilledPrice: 2.50,
          filledTotalFee: 9.95,
          timeInForce: 'DAY',
          limitPrice: 2.55,
        });

        const rule = INVESTMENT_BUY_SELL_TRANSACTION_RULES.find((r) => r.id === 'options-sell');
        const result = rule.process(transaction, extendedOrderMap);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Sell');
        expect(result.merchant).toBe('TSLA Mar 21, 2026 USD$250 Put');
        expect(result.originalStatement).toBe('OPTIONS_SELL:LIMIT_ORDER:TSLA:2026-03-21:250:PUT');
        expect(result.notes).toContain('Limit Sell');
        expect(result.notes).toContain('10 TSLA');
      });

      it('should handle missing extended order data', () => {
        const transaction = {
          externalCanonicalId: 'order-sell-no-ext',
          type: 'OPTIONS_SELL',
          subType: 'MARKET_ORDER',
          assetSymbol: 'GOOGL',
          strikePrice: 150,
          contractType: 'CALL',
          expiryDate: '2026-12-18',
          currency: 'USD',
        };

        const rule = INVESTMENT_BUY_SELL_TRANSACTION_RULES.find((r) => r.id === 'options-sell');
        const result = rule.process(transaction, new Map());

        expect(result).not.toBeNull();
        expect(result.category).toBe('Sell');
        expect(result.merchant).toBe('GOOGL Dec 18, 2026 USD$150 Call');
        expect(result.originalStatement).toBe('OPTIONS_SELL:MARKET_ORDER:GOOGL:2026-12-18:150:CALL');
      });

      it('should handle missing fields with defaults', () => {
        const transaction = {
          externalCanonicalId: 'order-sell-minimal',
          type: 'OPTIONS_SELL',
          subType: 'LIMIT_ORDER',
        };

        const rule = INVESTMENT_BUY_SELL_TRANSACTION_RULES.find((r) => r.id === 'options-sell');
        const result = rule.process(transaction, null);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Sell');
        expect(result.merchant).toContain('Unknown');
        expect(result.merchant).toContain('CAD$0');
      });
    });
  });

  describe('formatTransferNotes', () => {
    it('should format notes with currency and amount', () => {
      const transaction = {
        currency: 'CAD',
        amount: 500.25,
      };

      const result = formatTransferNotes(transaction);
      expect(result).toBe('Transfer of CAD$500.25');
    });

    it('should append existing note on new line', () => {
      const transaction = {
        currency: 'USD',
        amount: 1000,
      };

      const result = formatTransferNotes(transaction, 'User annotation here');
      expect(result).toBe('Transfer of USD$1000\nUser annotation here');
    });

    it('should use CAD as default currency when missing', () => {
      const transaction = {
        amount: 250,
      };

      const result = formatTransferNotes(transaction);
      expect(result).toBe('Transfer of CAD$250');
    });

    it('should use 0 as default amount when missing', () => {
      const transaction = {
        currency: 'CAD',
      };

      const result = formatTransferNotes(transaction);
      expect(result).toBe('Transfer of CAD$0');
    });

    it('should handle null amount', () => {
      const transaction = {
        currency: 'CAD',
        amount: null,
      };

      const result = formatTransferNotes(transaction);
      expect(result).toBe('Transfer of CAD$0');
    });

    it('should handle null currency', () => {
      const transaction = {
        currency: null,
        amount: 100,
      };

      const result = formatTransferNotes(transaction);
      expect(result).toBe('Transfer of CAD$100');
    });

    it('should not append note when existingNote is empty string', () => {
      const transaction = {
        currency: 'CAD',
        amount: 500,
      };

      const result = formatTransferNotes(transaction, '');
      expect(result).toBe('Transfer of CAD$500');
    });

    it('should not append note when existingNote is null', () => {
      const transaction = {
        currency: 'CAD',
        amount: 500,
      };

      const result = formatTransferNotes(transaction, null);
      expect(result).toBe('Transfer of CAD$500');
    });

    it('should format decimal amounts correctly', () => {
      const transaction = {
        currency: 'USD',
        amount: 123.45,
      };

      const result = formatTransferNotes(transaction);
      expect(result).toBe('Transfer of USD$123.45');
    });

    it('should handle all fields missing', () => {
      const transaction = {};

      const result = formatTransferNotes(transaction);
      expect(result).toBe('Transfer of CAD$0');
    });

    it('should handle amount of 0', () => {
      const transaction = {
        currency: 'CAD',
        amount: 0,
      };

      const result = formatTransferNotes(transaction);
      expect(result).toBe('Transfer of CAD$0');
    });
  });
});
